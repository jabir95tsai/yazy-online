import { eq } from "drizzle-orm";
import { ensureSchema, getDb } from "@/db";
import { players, rooms } from "@/db/schema";
import {
  apiError,
  cleanName,
  hashToken,
  makePlayerToken,
  makeRoomCode,
} from "@/lib/server";

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const body = (await request.json()) as { name?: string; maxPlayers?: number };
    const name = cleanName(body.name);
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

    await db.insert(rooms).values({
      id: roomId,
      code,
      maxPlayers,
      hostPlayerId: playerId,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(players).values({
      id: playerId,
      roomId,
      name,
      seat: 0,
      tokenHash: await hashToken(token),
      joinedAt: now,
    });

    return Response.json({ code, playerId, token }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
