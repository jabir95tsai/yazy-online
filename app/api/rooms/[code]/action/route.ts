import { and, asc, count, eq } from "drizzle-orm";
import { ensureSchema, getD1, getDb } from "@/db";
import { players, rooms, scores } from "@/db/schema";
import { categoryIds, fairDieFromByte, scoreDice, type CategoryId } from "@/lib/game";
import { apiError, cleanCode, hashToken } from "@/lib/server";

type ActionBody = {
  action?: "start" | "roll" | "hold" | "score" | "skip";
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

function scoreMarker() {
  const suffix = new Uint32Array(1);
  crypto.getRandomValues(suffix);
  const fractionalSuffix = suffix[0].toString().padStart(10, "0").slice(-6);
  return `${new Date().toISOString().slice(0, -1)}${fractionalSuffix}Z`;
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

function nextRoomState(room: RoomRow, playerCount: number, totalScoresAfter: number) {
  const complete = totalScoresAfter >= playerCount * categoryIds.length;
  const nextSeat = (room.currentSeat + 1) % playerCount;
  return {
    complete,
    nextSeat,
    round: complete
      ? categoryIds.length
      : nextSeat === 0
        ? Math.min(categoryIds.length, room.round + 1)
        : room.round,
  };
}

async function scoreAndAdvance(input: {
  room: RoomRow;
  playerId: string;
  category: CategoryId;
  value: number;
  playerCount: number;
  scoreCountBefore: number;
}) {
  const { room, playerId, category, value, playerCount, scoreCountBefore } = input;
  const d1 = getD1();
  const marker = scoreMarker();
  const updatedAt = nextTimestamp(room.updatedAt);
  const next = nextRoomState(room, playerCount, scoreCountBefore + 1);
  const deadline = next.complete ? null : turnDeadline();
  const finishedAt = next.complete ? updatedAt : null;

  const insert = d1
    .prepare(`
      INSERT OR IGNORE INTO scores (room_id, player_id, category, score, created_at)
      SELECT ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM rooms
        WHERE id = ? AND status = 'playing'
          AND current_seat = ? AND rolls_used = ? AND updated_at = ?
      )
    `)
    .bind(
      room.id,
      playerId,
      category,
      value,
      marker,
      room.id,
      room.currentSeat,
      room.rollsUsed,
      room.updatedAt,
    );
  const update = d1
    .prepare(`
      UPDATE rooms
      SET status = ?, current_seat = ?, round = ?, dice_json = '[]',
          held_json = ?, rolls_used = 0, updated_at = ?, finished_at = ?,
          turn_deadline = ?
      WHERE id = ? AND status = 'playing'
        AND current_seat = ? AND rolls_used = ? AND updated_at = ?
        AND EXISTS (
          SELECT 1 FROM scores
          WHERE room_id = ? AND player_id = ? AND category = ? AND created_at = ?
        )
    `)
    .bind(
      next.complete ? "finished" : "playing",
      next.nextSeat,
      next.round,
      JSON.stringify(emptyHeld),
      updatedAt,
      finishedAt,
      deadline,
      room.id,
      room.currentSeat,
      room.rollsUsed,
      room.updatedAt,
      room.id,
      playerId,
      category,
      marker,
    );

  const [insertResult, updateResult] = await d1.batch([insert, update]);
  if (resultChanged(insertResult) && resultChanged(updateResult)) return next;

  if (resultChanged(insertResult)) {
    await d1
      .prepare(
        "DELETE FROM scores WHERE room_id = ? AND player_id = ? AND category = ? AND created_at = ?",
      )
      .bind(room.id, playerId, category, marker)
      .run();
  }
  return null;
}

async function advanceWithoutScore(room: RoomRow, playerCount: number, totalScores: number) {
  const next = nextRoomState(room, playerCount, totalScores);
  const updatedAt = nextTimestamp(room.updatedAt);
  const result = await getDb()
    .update(rooms)
    .set({
      status: next.complete ? "finished" : "playing",
      currentSeat: next.nextSeat,
      round: next.round,
      diceJson: "[]",
      heldJson: JSON.stringify(emptyHeld),
      rollsUsed: 0,
      updatedAt,
      finishedAt: next.complete ? updatedAt : null,
      turnDeadline: next.complete ? null : turnDeadline(),
    })
    .where(
      and(
        eq(rooms.id, room.id),
        eq(rooms.status, "playing"),
        eq(rooms.currentSeat, room.currentSeat),
        eq(rooms.rollsUsed, room.rollsUsed),
        eq(rooms.updatedAt, room.updatedAt),
      ),
    );
  return resultChanged(result) ? next : null;
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

    if (body.action === "skip") {
      if (!room.turnDeadline || Date.now() < Date.parse(room.turnDeadline)) {
        return Response.json({ error: "目前回合還沒逾時。" }, { status: 409 });
      }
      const stalled = roomPlayers.find((candidate) => candidate.seat === room.currentSeat);
      if (!stalled) {
        return Response.json({ error: "找不到目前的玩家。" }, { status: 409 });
      }
      const [taken, scoreCountRows] = await db.batch([
        db
          .select({ category: scores.category })
          .from(scores)
          .where(and(eq(scores.roomId, room.id), eq(scores.playerId, stalled.id))),
        db.select({ value: count() }).from(scores).where(eq(scores.roomId, room.id)),
      ]);
      const used = new Set(taken.map((entry) => entry.category));
      const free = categoryIds.find((category) => !used.has(category));
      const scoreCountBefore = scoreCountRows[0]?.value ?? 0;
      const next = free
        ? await scoreAndAdvance({
            room,
            playerId: stalled.id,
            category: free,
            value: 0,
            playerCount: roomPlayers.length,
            scoreCountBefore,
          })
        : await advanceWithoutScore(room, roomPlayers.length, scoreCountBefore);
      if (!next) {
        return Response.json({ error: "回合已經變更，請重新整理。" }, { status: 409 });
      }
      return Response.json({ ok: true, skippedPlayer: stalled.name, complete: next.complete });
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
      const [scoreCount] = await db
        .select({ value: count() })
        .from(scores)
        .where(eq(scores.roomId, room.id));
      const value = scoreDice(body.category, JSON.parse(room.diceJson) as number[]);
      const next = await scoreAndAdvance({
        room,
        playerId: player.id,
        category: body.category,
        value,
        playerCount: roomPlayers.length,
        scoreCountBefore: scoreCount?.value ?? 0,
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
