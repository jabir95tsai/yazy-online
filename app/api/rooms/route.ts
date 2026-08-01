import { eq } from "drizzle-orm";
import { ensureSchema, getDb } from "@/db";
import { players, rooms } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import {
  apiError,
  cleanName,
  hashToken,
  makePlayerToken,
  makeRoomCode,
  withinRoomCreateLimit,
} from "@/lib/server";

export async function POST(request: Request) {
  try {
    // Checked before any database work, so a flood costs one binding call.
    if (!(await withinRoomCreateLimit(request))) {
      return Response.json(
        { error: "建立房間太頻繁了，請稍後再試。" },
        { status: 429, headers: { "retry-after": "60" } },
      );
    }
    await ensureSchema();
    const body = (await request.json()) as { name?: string; maxPlayers?: number };
    const account = await getCurrentUser(request);
    const name = account?.displayName ?? cleanName(body.name);
    const maxPlayers = Math.min(6, Math.max(2, Number(body.maxPlayers) || 6));
    if (!name) {
      return Response.json({ error: "先取一個玩家名稱吧。" }, { status: 400 });
    }

    const db = getDb();
    let code = makeRoomCode();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const [exists] = await db.select({ id: rooms.id }).from(rooms).where(eq(rooms.code, code)).limit(1);
      if (!exists) break;
      code = makeRoomCode();
    }

    const now = new Date().toISOString();
    const roomId = crypto.randomUUID();
    const playerId = crypto.randomUUID();
    const token = makePlayerToken();

    await db.batch([
      db.insert(rooms).values({
        id: roomId,
        code,
        maxPlayers,
        hostPlayerId: playerId,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(players).values({
        id: playerId,
        roomId,
        userId: account?.id,
        name,
        seat: 0,
        tokenHash: await hashToken(token),
        joinedAt: now,
      }),
    ]);

    return Response.json({ code, playerId, token }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
