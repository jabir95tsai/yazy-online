import { inArray } from "drizzle-orm";
import { ensureSchema, getDb } from "@/db";
import { players } from "@/db/schema";
import { loadFinishedGames } from "@/lib/history";
import { apiError, hashToken } from "@/lib/server";

type Session = { playerId?: string; token?: string };

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const body = (await request.json()) as { sessions?: Session[] };
    const sessions = Array.isArray(body.sessions) ? body.sessions.slice(-20) : [];
    const valid = sessions.filter(
      (session): session is Required<Session> => Boolean(session.playerId && session.token),
    );
    if (!valid.length) return Response.json({ games: [] });
    const db = getDb();
    const [playerRows, hashes] = await Promise.all([
      db.select().from(players).where(inArray(players.id, valid.map((session) => session.playerId))),
      Promise.all(valid.map((session) => hashToken(session.token))),
    ]);
    const expected = new Map(
      valid.map((session, index) => [session.playerId, hashes[index]]),
    );
    const roomIds = playerRows
      .filter((player) => player.tokenHash === expected.get(player.id))
      .map((player) => player.roomId);

    const uniqueRoomIds = [...new Set(roomIds)];
    return Response.json({ games: await loadFinishedGames(uniqueRoomIds) });
  } catch (error) {
    return apiError(error);
  }
}
