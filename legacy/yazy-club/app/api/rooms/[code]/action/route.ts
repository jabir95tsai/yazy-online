import { and, asc, count, eq } from "drizzle-orm";
import { ensureSchema, getDb } from "@/db";
import { players, rooms, scores } from "@/db/schema";
import { categoryIds, scoreDice, type CategoryId } from "@/lib/game";
import { apiError, authenticate, cleanCode } from "@/lib/server";

type ActionBody = {
  action?: "start" | "roll" | "score";
  playerId?: string;
  token?: string;
  held?: boolean[];
  category?: CategoryId;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    await ensureSchema();
    const code = cleanCode((await params).code);
    const body = (await request.json()) as ActionBody;
    const db = getDb();
    const [room] = await db.select().from(rooms).where(eq(rooms.code, code)).limit(1);
    if (!room) return Response.json({ error: "找不到這個房間。" }, { status: 404 });
    if (!body.playerId || !body.token) {
      return Response.json({ error: "玩家憑證已失效，請重新加入。" }, { status: 401 });
    }
    const player = await authenticate(room.id, body.playerId, body.token);
    if (!player) {
      return Response.json({ error: "玩家憑證已失效，請重新加入。" }, { status: 401 });
    }

    const roomPlayers = await db
      .select()
      .from(players)
      .where(eq(players.roomId, room.id))
      .orderBy(asc(players.seat));

    if (body.action === "start") {
      if (room.status !== "waiting" || player.id !== room.hostPlayerId) {
        return Response.json({ error: "只有房主能開始遊戲。" }, { status: 403 });
      }
      if (roomPlayers.length < 2) {
        return Response.json({ error: "至少需要 2 位玩家才能開始。" }, { status: 409 });
      }
      await db
        .update(rooms)
        .set({
          status: "playing",
          currentSeat: 0,
          round: 1,
          diceJson: "[]",
          rollsUsed: 0,
          updatedAt: new Date().toISOString(),
        })
        .where(and(eq(rooms.id, room.id), eq(rooms.status, "waiting")));
      return Response.json({ ok: true });
    }

    if (room.status !== "playing") {
      return Response.json({ error: "遊戲目前不在進行中。" }, { status: 409 });
    }
    if (player.seat !== room.currentSeat) {
      return Response.json({ error: "現在還沒輪到你。" }, { status: 409 });
    }

    if (body.action === "roll") {
      if (room.rollsUsed >= 3) {
        return Response.json({ error: "這回合已經擲滿 3 次。" }, { status: 409 });
      }
      const previous = JSON.parse(room.diceJson) as number[];
      const held =
        room.rollsUsed > 0 && Array.isArray(body.held) && body.held.length === 5
          ? body.held.map(Boolean)
          : [false, false, false, false, false];
      const bytes = new Uint8Array(5);
      crypto.getRandomValues(bytes);
      const nextDice = Array.from({ length: 5 }, (_, index) =>
        held[index] && previous[index] ? previous[index] : (bytes[index] % 6) + 1,
      );
      await db
        .update(rooms)
        .set({
          diceJson: JSON.stringify(nextDice),
          rollsUsed: room.rollsUsed + 1,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(rooms.id, room.id),
            eq(rooms.currentSeat, room.currentSeat),
            eq(rooms.rollsUsed, room.rollsUsed),
          ),
        );
      return Response.json({ ok: true, dice: nextDice });
    }

    if (body.action === "score") {
      if (!body.category || !categoryIds.includes(body.category) || room.rollsUsed < 1) {
        return Response.json({ error: "請先擲骰，再選擇計分格。" }, { status: 400 });
      }
      const [used] = await db
        .select({ category: scores.category })
        .from(scores)
        .where(
          and(
            eq(scores.roomId, room.id),
            eq(scores.playerId, player.id),
            eq(scores.category, body.category),
          ),
        )
        .limit(1);
      if (used) return Response.json({ error: "這個計分格已經使用過。" }, { status: 409 });

      const dice = JSON.parse(room.diceJson) as number[];
      const value = scoreDice(body.category, dice);
      await db.insert(scores).values({
        roomId: room.id,
        playerId: player.id,
        category: body.category,
        score: value,
        createdAt: new Date().toISOString(),
      });
      const [scoreCount] = await db
        .select({ value: count() })
        .from(scores)
        .where(eq(scores.roomId, room.id));
      const complete = scoreCount.value >= roomPlayers.length * categoryIds.length;
      const nextSeat = (room.currentSeat + 1) % roomPlayers.length;
      await db
        .update(rooms)
        .set({
          status: complete ? "finished" : "playing",
          currentSeat: nextSeat,
          round: complete
            ? categoryIds.length
            : nextSeat === 0
              ? Math.min(categoryIds.length, room.round + 1)
              : room.round,
          diceJson: "[]",
          rollsUsed: 0,
          updatedAt: new Date().toISOString(),
          finishedAt: complete ? new Date().toISOString() : null,
        })
        .where(eq(rooms.id, room.id));
      return Response.json({ ok: true, score: value, complete });
    }

    return Response.json({ error: "不支援的操作。" }, { status: 400 });
  } catch (error) {
    return apiError(error);
  }
}
