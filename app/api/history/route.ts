import { and, desc, eq, inArray } from "drizzle-orm";
import { ensureSchema, getDb } from "@/db";
import { players, rooms, scores } from "@/db/schema";
import { apiError, hashToken } from "@/lib/server";

type Session = { playerId?: string; token?: string };

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const body = (await request.json()) as { sessions?: Session[] };
    const sessions = Array.isArray(body.sessions) ? body.sessions.slice(-20) : [];
    const db = getDb();
    const roomIds: string[] = [];

    for (const session of sessions) {
      if (!session.playerId || !session.token) continue;
      const [player] = await db
        .select()
        .from(players)
        .where(eq(players.id, session.playerId))
        .limit(1);
      if (player && player.tokenHash === (await hashToken(session.token))) {
        roomIds.push(player.roomId);
      }
    }

    const uniqueRoomIds = [...new Set(roomIds)];
    if (!uniqueRoomIds.length) return Response.json({ games: [] });
    const finishedRooms = await db
      .select()
      .from(rooms)
      .where(and(inArray(rooms.id, uniqueRoomIds), eq(rooms.status, "finished")))
      .orderBy(desc(rooms.finishedAt))
      .limit(12);
    if (!finishedRooms.length) return Response.json({ games: [] });

    const ids = finishedRooms.map((room) => room.id);
    const gamePlayers = await db
      .select({ id: players.id, roomId: players.roomId, name: players.name, seat: players.seat })
      .from(players)
      .where(inArray(players.roomId, ids));
    const gameScores = await db
      .select({ roomId: scores.roomId, playerId: scores.playerId, category: scores.category, score: scores.score })
      .from(scores)
      .where(inArray(scores.roomId, ids));

    return Response.json({
      games: finishedRooms.map((room) => ({
        code: room.code,
        finishedAt: room.finishedAt,
        players: gamePlayers
          .filter((player) => player.roomId === room.id)
          .sort((a, b) => a.seat - b.seat)
          .map((player) => ({
            id: player.id,
            name: player.name,
            scores: gameScores.filter((score) => score.playerId === player.id),
          })),
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}
