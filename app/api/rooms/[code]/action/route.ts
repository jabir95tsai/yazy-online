import { and, asc, eq } from "drizzle-orm";
import { ensureSchema, getD1, getDb } from "@/db";
import { players, rooms, scores } from "@/db/schema";
import { categoryIds, fairDieFromByte, scoreDice, type CategoryId } from "@/lib/game";
import { resolveMatch, type MatchPlayer, type MatchScore } from "@/lib/match";
import { apiError, cleanCode, hashToken } from "@/lib/server";
import { loadFinishedGames } from "@/lib/history";

type ActionBody = {
  action?: "start" | "restart" | "roll" | "hold" | "score" | "skip" | "surrender" | "finish";
  playerId?: string;
  token?: string;
  held?: boolean[];
  category?: CategoryId;
  expectedUpdatedAt?: string;
};

type RoomRow = typeof rooms.$inferSelect;

const TURN_MS = 90_000;
const emptyHeld = [false, false, false, false, false];

function normalizeHeld(value: unknown) {
  return Array.isArray(value) && value.length === 5 ? value.map(Boolean) : null;
}

function resultChanged(result: { meta: { changes?: number } }) {
  return result.meta.changes === 1;
}

function nextTimestamp(previous: string) {
  const previousTime = Date.parse(previous);
  return new Date(Math.max(Date.now(), Number.isNaN(previousTime) ? 0 : previousTime + 1)).toISOString();
}

function turnDeadline() {
  return new Date(Date.now() + TURN_MS).toISOString();
}

function secureEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function rollDie() {
  const byte = new Uint8Array(1);
  while (true) {
    crypto.getRandomValues(byte);
    const face = fairDieFromByte(byte[0]);
    if (face !== null) return face;
  }
}

// One CAS-controlled transaction owns the room, scores and concession states.
// The unique timestamp suffix prevents a losing concurrent request from writing.
async function commitMatch(room: RoomRow, roomPlayers: MatchPlayer[], roomScores: MatchScore[],
  options: { score?: MatchScore; surrender?: string; finish?: boolean; advance?: boolean }) {
  const afterScores = options.score ? [...roomScores, options.score] : roomScores;
  const next = resolveMatch(roomPlayers, afterScores, room.currentSeat, !!options.advance, options.surrender);
  const complete = !!options.finish || next.complete;
  const resetTurn = !!options.advance || next.nextSeat !== room.currentSeat || complete;
  const suffix = Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString().padStart(10, "0")).join("");
  const updatedAt = `${nextTimestamp(room.updatedAt).slice(0, -1)}${suffix}Z`;
  const d1 = getD1();
  const statements = [d1.prepare(`
    UPDATE rooms SET status = ?, current_seat = ?, round = ?, dice_json = ?,
      held_json = ?, rolls_used = ?, updated_at = ?, finished_at = ?, turn_deadline = ?
    WHERE id = ? AND status = 'playing' AND updated_at = ?
  `).bind(complete ? "finished" : "playing", next.nextSeat, next.round,
    resetTurn ? "[]" : room.diceJson, resetTurn ? JSON.stringify(emptyHeld) : room.heldJson,
    resetTurn ? 0 : room.rollsUsed, updatedAt, complete ? updatedAt : null,
    complete ? null : resetTurn ? turnDeadline() : room.turnDeadline, room.id, room.updatedAt)];
  if (options.score) {
    const score = options.score;
    statements.push(d1.prepare(`INSERT INTO scores (room_id, player_id, category, score, created_at)
      SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM rooms WHERE id = ? AND updated_at = ?)`)
      .bind(room.id, score.playerId, score.category, score.score, updatedAt, room.id, updatedAt));
  }
  for (const player of next.players) {
    if (player.surrenderReason !== roomPlayers.find((entry) => entry.id === player.id)?.surrenderReason) {
      statements.push(d1.prepare(`UPDATE players SET surrender_reason = ? WHERE id = ? AND room_id = ?
        AND EXISTS (SELECT 1 FROM rooms WHERE id = ? AND updated_at = ?)`)
        .bind(player.surrenderReason, player.id, room.id, room.id, updatedAt));
    }
  }
  const [result] = await d1.batch(statements);
  return resultChanged(result) ? { complete } : null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    await ensureSchema();
    const code = cleanCode((await params).code);
    const body = (await request.json()) as ActionBody;
    const db = getDb();
    const [roomRows, roomPlayers] = await db.batch([
      db.select().from(rooms).where(eq(rooms.code, code)).limit(1),
      db
        .select({
          id: players.id,
          roomId: players.roomId,
          userId: players.userId,
          name: players.name,
          seat: players.seat,
          tokenHash: players.tokenHash,
          joinedAt: players.joinedAt,
          surrenderReason: players.surrenderReason,
        })
        .from(players)
        .innerJoin(rooms, eq(players.roomId, rooms.id))
        .where(eq(rooms.code, code))
        .orderBy(asc(players.seat)),
    ]);
    const room = roomRows[0];
    if (!room) return Response.json({ error: "找不到這個房間。" }, { status: 404 });
    if (!body.playerId || !body.token) {
      return Response.json({ error: "玩家憑證已失效，請重新加入。" }, { status: 401 });
    }
    const providedHash = await hashToken(body.token);
    const player = roomPlayers.find(
      (candidate) =>
        candidate.id === body.playerId && secureEqual(candidate.tokenHash, providedHash),
    );
    if (!player) {
      return Response.json({ error: "玩家憑證已失效，請重新加入。" }, { status: 401 });
    }
    if (!body.expectedUpdatedAt || body.expectedUpdatedAt !== room.updatedAt) {
      return Response.json({ error: "房間狀態已變更，請重新整理。" }, { status: 409 });
    }

    if (body.action === "restart") {
      if (player.id !== room.hostPlayerId) {
        return Response.json({ error: "只有房主能再開一局。" }, { status: 403 });
      }
      if (room.status !== "finished" || roomPlayers.length < 2) {
        return Response.json({ error: "本局結束後才能再開一局。" }, { status: 409 });
      }
      const games = await loadFinishedGames([room.id], [], 1);
      const game = games.find((entry) => entry.finishedAt === room.finishedAt);
      if (!game) return Response.json({ error: "無法保存本局戰績，請重試。" }, { status: 409 });
      const updatedAt = `${nextTimestamp(room.updatedAt).slice(0, -1)}${Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString().padStart(10, "0")).join("")}Z`;
      const d1 = getD1();
      // Snapshot and reset share a CAS-owned transaction. Losing requests cannot
      // archive twice or erase scores from the newly started game.
      const [result] = await d1.batch([
        d1.prepare(`UPDATE rooms SET status = 'playing', current_seat = 0, round = 1,
          dice_json = '[]', held_json = ?, rolls_used = 0, finished_at = NULL,
          turn_deadline = ?, updated_at = ? WHERE id = ? AND status = 'finished' AND updated_at = ?`)
          .bind(JSON.stringify(emptyHeld), turnDeadline(), updatedAt, room.id, room.updatedAt),
        d1.prepare(`INSERT INTO room_games (room_id, finished_at, game_json)
          SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM rooms WHERE id = ? AND updated_at = ?)`)
          .bind(room.id, game.finishedAt, JSON.stringify(game), room.id, updatedAt),
        d1.prepare(`DELETE FROM scores WHERE room_id = ?
          AND EXISTS (SELECT 1 FROM rooms WHERE id = ? AND updated_at = ?)`)
          .bind(room.id, room.id, updatedAt),
        d1.prepare(`UPDATE players SET surrender_reason = NULL WHERE room_id = ?
          AND EXISTS (SELECT 1 FROM rooms WHERE id = ? AND updated_at = ?)`)
          .bind(room.id, room.id, updatedAt),
      ]);
      return resultChanged(result) ? Response.json({ ok: true })
        : Response.json({ error: "房間狀態已變更，請重新整理。" }, { status: 409 });
    }

    if (body.action === "start") {
      if (room.status !== "waiting" || player.id !== room.hostPlayerId) {
        return Response.json({ error: "只有房主能開始遊戲。" }, { status: 403 });
      }
      if (roomPlayers.length < 2) {
        return Response.json({ error: "至少需要 2 位玩家才能開始。" }, { status: 409 });
      }
      const result = await db
        .update(rooms)
        .set({
          status: "playing",
          currentSeat: 0,
          round: 1,
          diceJson: "[]",
          heldJson: JSON.stringify(emptyHeld),
          rollsUsed: 0,
          turnDeadline: turnDeadline(),
          updatedAt: nextTimestamp(room.updatedAt),
        })
        .where(
          and(
            eq(rooms.id, room.id),
            eq(rooms.status, "waiting"),
            eq(rooms.updatedAt, room.updatedAt),
          ),
        );
      if (!resultChanged(result)) {
        return Response.json({ error: "遊戲已經開始，請重新整理。" }, { status: 409 });
      }
      return Response.json({ ok: true });
    }

    if (room.status !== "playing") {
      return Response.json({ error: "遊戲目前不在進行中。" }, { status: 409 });
    }

    const roomScores = ["score", "skip", "surrender", "finish"].includes(body.action ?? "")
      ? await db.select({ playerId: scores.playerId, category: scores.category, score: scores.score })
        .from(scores).where(eq(scores.roomId, room.id))
      : [];
    const active = roomPlayers.filter((entry) => !entry.surrenderReason);
    if (body.action === "surrender" || body.action === "finish") {
      if (player.surrenderReason) {
        return Response.json({ error: "你已投降，可觀看其他玩家繼續挑戰紀錄。" }, { status: 409 });
      }
      if (body.action === "finish" && (active.length !== 1 || active[0].id !== player.id)) {
        return Response.json({ error: "只有最後一位未投降玩家可以提前結算。" }, { status: 403 });
      }
      if (body.action === "surrender" && active.length <= 1) {
        return Response.json({ error: "你已獲勝，可以直接結算或繼續挑戰紀錄。" }, { status: 409 });
      }
      const next = await commitMatch(room, roomPlayers, roomScores, {
        surrender: body.action === "surrender" ? player.id : undefined,
        finish: body.action === "finish",
      });
      return next ? Response.json({ ok: true, ...next })
        : Response.json({ error: "房間狀態已變更，請重試。" }, { status: 409 });
    }

    if (body.action === "skip") {
      if (!room.turnDeadline || Date.now() < Date.parse(room.turnDeadline)) {
        return Response.json({ error: "目前回合還沒逾時。" }, { status: 409 });
      }
      const stalled = roomPlayers.find((candidate) => candidate.seat === room.currentSeat);
      if (!stalled) return Response.json({ error: "找不到目前的玩家。" }, { status: 409 });
      const used = new Set(roomScores.filter((score) => score.playerId === stalled.id).map((score) => score.category));
      const free = categoryIds.find((category) => !used.has(category));
      const next = await commitMatch(room, roomPlayers, roomScores, {
        score: free && !stalled.surrenderReason ? { playerId: stalled.id, category: free, score: 0 } : undefined,
        advance: true,
      });
      return next ? Response.json({ ok: true, skippedPlayer: stalled.name, ...next })
        : Response.json({ error: "回合已經變更，請重新整理。" }, { status: 409 });
    }

    if (player.surrenderReason) {
      return Response.json({ error: "投降後無法再擲骰或計分。" }, { status: 403 });
    }

    if (player.seat !== room.currentSeat) {
      return Response.json({ error: "現在還沒輪到你。" }, { status: 409 });
    }

    if (body.action === "hold") {
      if (room.rollsUsed < 1) {
        return Response.json({ error: "請先擲骰，再選擇要保留的骰子。" }, { status: 400 });
      }
      const held = normalizeHeld(body.held);
      if (!held) {
        return Response.json({ error: "鎖骰資料格式不正確。" }, { status: 400 });
      }
      const updatedAt = nextTimestamp(room.updatedAt);
      const result = await db
        .update(rooms)
        .set({ heldJson: JSON.stringify(held), updatedAt })
        .where(
          and(
            eq(rooms.id, room.id),
            eq(rooms.currentSeat, room.currentSeat),
            eq(rooms.rollsUsed, room.rollsUsed),
            eq(rooms.updatedAt, room.updatedAt),
          ),
        );
      if (!resultChanged(result)) {
        return Response.json({ error: "回合狀態已變更，請重新整理。" }, { status: 409 });
      }
      return Response.json({ ok: true, held, updatedAt });
    }

    if (body.action === "roll") {
      if (room.rollsUsed >= 3) {
        return Response.json({ error: "這回合已經擲滿 3 次。" }, { status: 409 });
      }
      const previous = JSON.parse(room.diceJson) as number[];
      // Which dice to keep is read from the room's own held_json, not from
      // body.held. The client isn't the source of truth for hold state — the
      // "hold" action already wrote it there. Trusting body.held instead let a
      // second tab/device signed in as the same player (e.g. via "continue
      // as") roll with its own stale, unsynced held array and silently
      // discard a hold the player had just clicked in another tab.
      const held =
        room.rollsUsed > 0 ? (JSON.parse(room.heldJson) as boolean[]) : emptyHeld;
      const nextDice = Array.from({ length: 5 }, (_, index) =>
        held[index] && previous[index] ? previous[index] : rollDie(),
      );
      const result = await db
        .update(rooms)
        .set({
          diceJson: JSON.stringify(nextDice),
          rollsUsed: room.rollsUsed + 1,
          updatedAt: nextTimestamp(room.updatedAt),
        })
        .where(
          and(
            eq(rooms.id, room.id),
            eq(rooms.currentSeat, room.currentSeat),
            eq(rooms.rollsUsed, room.rollsUsed),
            eq(rooms.updatedAt, room.updatedAt),
          ),
        );
      if (!resultChanged(result)) {
        return Response.json({ error: "回合狀態已變更，請重新整理。" }, { status: 409 });
      }
      return Response.json({ ok: true, dice: nextDice });
    }

    if (body.action === "score") {
      if (!body.category || !categoryIds.includes(body.category) || room.rollsUsed < 1) {
        return Response.json({ error: "請先擲骰，再選擇計分格。" }, { status: 400 });
      }
      if (roomScores.some((entry) => entry.playerId === player.id && entry.category === body.category)) {
        return Response.json({ error: "這個計分格已使用。" }, { status: 409 });
      }
      const value = scoreDice(body.category, JSON.parse(room.diceJson) as number[]);
      const next = await commitMatch(room, roomPlayers, roomScores, {
        score: { playerId: player.id, category: body.category, score: value }, advance: true,
      });
      if (!next) {
        return Response.json(
          { error: "計分格已使用或回合已經結束，請重新整理。" },
          { status: 409 },
        );
      }
      return Response.json({ ok: true, score: value, complete: next.complete });
    }

    return Response.json({ error: "不支援的操作。" }, { status: 400 });
  } catch (error) {
    return apiError(error);
  }
}
