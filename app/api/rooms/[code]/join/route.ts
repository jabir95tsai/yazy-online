import { and, asc, eq } from "drizzle-orm";
import { ensureSchema, getDb } from "@/db";
import { players, rooms } from "@/db/schema";
import {
  apiError,
  cleanCode,
  cleanName,
  hashToken,
  makePlayerToken,
} from "@/lib/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    await ensureSchema();
    const code = cleanCode((await params).code);
    const body = (await request.json()) as { name?: string };
    const name = cleanName(body.name);
    if (!name) {
      return Response.json({ error: "先取一個玩家名稱吧。" }, { status: 400 });
    }

    const db = getDb();
    const [room] = await db.select().from(rooms).where(eq(rooms.code, code)).limit(1);
    if (!room) return Response.json({ error: "找不到這個房間。" }, { status: 404 });
    if (room.status !== "waiting") {
      return Response.json({ error: "這局已經開始，現在不能加入。" }, { status: 409 });
    }

    const roomPlayers = await db
      .select()
      .from(players)
      .where(eq(players.roomId, room.id))
      .orderBy(asc(players.seat));
    if (roomPlayers.length >= room.maxPlayers) {
      return Response.json({ error: "房間已經滿員。" }, { status: 409 });
    }
    if (roomPlayers.some((player) => player.name.toLowerCase() === name.toLowerCase())) {
      return Response.json({ error: "房間裡已經有人使用這個名稱。" }, { status: 409 });
    }

    const playerId = crypto.randomUUID();
    const token = makePlayerToken();
    await db.insert(players).values({
      id: playerId,
      roomId: room.id,
      name,
      seat: roomPlayers.length,
      tokenHash: await hashToken(token),
      joinedAt: new Date().toISOString(),
    });
    await db
      .update(rooms)
      .set({ updatedAt: new Date().toISOString() })
      .where(and(eq(rooms.id, room.id), eq(rooms.status, "waiting")));

    return Response.json({ code, playerId, token }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
