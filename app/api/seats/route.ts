import { and, count, eq, gt, inArray, ne } from "drizzle-orm";
import { ensureSchema, getDb } from "@/db";
import { players, rooms } from "@/db/schema";
import { apiError, hashToken } from "@/lib/server";
import { idsIn } from "@/lib/query";

type Session = { playerId?: string; token?: string };

/** A table nobody has touched for this long is no longer offered as a way back. */
const RESUMABLE_TABLE_MINUTES = 15;

/**
 * Which of this browser's remembered seats are at a table that is still open.
 *
 * One round trip for the whole list, so the landing page can offer a way back
 * after the tab that held the seat was swiped away. `gone` lists seats whose
 * room has been cleaned up, so the browser can stop remembering them. Tables
 * idle for longer than {@link RESUMABLE_TABLE_MINUTES} are simply left out.
 */
export async function POST(request: Request) {
  try {
    await ensureSchema();
    const body = (await request.json()) as { sessions?: Session[] };
    const sessions = Array.isArray(body.sessions) ? body.sessions.slice(-20) : [];
    const valid = sessions.filter(
      (session): session is Required<Session> => Boolean(session?.playerId && session.token),
    );
    if (!valid.length) return Response.json({ active: [], gone: [] });
    const db = getDb();
    const [playerRows, hashes] = await Promise.all([
      db
        .select({ id: players.id, roomId: players.roomId, tokenHash: players.tokenHash })
        .from(players)
        .where(inArray(players.id, valid.map((session) => session.playerId))),
      Promise.all(valid.map((session) => hashToken(session.token))),
    ]);
    const expected = new Map(valid.map((session, index) => [session.playerId, hashes[index]]));
    const seats = playerRows.filter((player) => player.tokenHash === expected.get(player.id));
    const found = new Set(playerRows.map((player) => player.id));
    const gone = valid.map((session) => session.playerId).filter((id) => !found.has(id));
    if (!seats.length) return Response.json({ active: [], gone });

    const cutoff = new Date(Date.now() - RESUMABLE_TABLE_MINUTES * 60_000).toISOString();

    const open = await db
      .select({
        id: rooms.id,
        code: rooms.code,
        status: rooms.status,
        players: count(players.id),
      })
      .from(rooms)
      .innerJoin(players, eq(players.roomId, rooms.id))
      .where(and(idsIn(rooms.id, seats.map((seat) => seat.roomId)), ne(rooms.status, "finished"), gt(rooms.updatedAt, cutoff)))
      .groupBy(rooms.id);
    const byId = new Map(open.map((room) => [room.id, room]));
    const active = seats.flatMap((seat) => {
      const room = byId.get(seat.roomId);
      return room
        ? [{ playerId: seat.id, code: room.code, status: room.status, players: room.players }]
        : [];
    });
    return Response.json({ active, gone });
  } catch (error) {
    return apiError(error);
  }
}
