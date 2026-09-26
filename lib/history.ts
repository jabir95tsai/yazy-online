import { and, desc, eq, inArray } from "drizzle-orm";
import { idsIn } from "./query.ts";
import { getDb } from "@/db";
import { players, rooms, scores } from "@/db/schema";

export { historyStats, versusRecords } from "@/lib/stats";
export type { HistoryStats, VersusRecord } from "@/lib/stats";

/** How many finished games the landing page and the record tab list. */
export const HISTORY_LIMIT = 20;
/** How far back the win rate, averages and head-to-head records look. */
export const STATS_LIMIT = 200;

export type HistoryGame = {
  code: string;
  finishedAt: string;
  players: Array<{
    id: string;
    userId: string | null;
    name: string;
    isMe: boolean;
    surrenderReason: string | null;
    scores: Array<{ category: string; score: number }>;
  }>;
};

export async function loadFinishedGames(
  roomIds: string[],
  myPlayerIds: string[] = [],
  limit = HISTORY_LIMIT,
) {
  const uniqueRoomIds = [...new Set(roomIds)];
  if (!uniqueRoomIds.length) return [] as HistoryGame[];
  const db = getDb();
  const finishedRooms = await db
    .select()
    .from(rooms)
    .where(and(idsIn(rooms.id, uniqueRoomIds), eq(rooms.status, "finished")))
    .orderBy(desc(rooms.finishedAt))
    .limit(limit);
  if (!finishedRooms.length) return [] as HistoryGame[];

  const ids = finishedRooms.map((room) => room.id);
  const [gamePlayers, gameScores] = await Promise.all([
    db
      .select({
        id: players.id,
        roomId: players.roomId,
        userId: players.userId,
        name: players.name,
        seat: players.seat,
        surrenderReason: players.surrenderReason,
      })
      .from(players)
      .where(idsIn(players.roomId, ids)),
    db
      .select({ roomId: scores.roomId, playerId: scores.playerId, category: scores.category, score: scores.score })
      .from(scores)
      .where(idsIn(scores.roomId, ids)),
  ]);
  const mine = new Set(myPlayerIds);
  const playersByRoom = Map.groupBy(gamePlayers, (player) => player.roomId);
  const scoresByPlayer = Map.groupBy(gameScores, (score) => score.playerId);

  return finishedRooms.map((room) => ({
    code: room.code,
    finishedAt: room.finishedAt ?? room.updatedAt,
    players: (playersByRoom.get(room.id) ?? [])
      .sort((a, b) => a.seat - b.seat)
      .map((player) => ({
        id: player.id,
        userId: player.userId ?? null,
        name: player.name,
        isMe: mine.has(player.id),
        surrenderReason: player.surrenderReason,
        scores: (scoresByPlayer.get(player.id) ?? [])
          .map(({ category, score }) => ({ category, score })),
      })),
  }));
}

/**
 * Every finished game on an account, newest first.
 *
 * The default reaches further back than the lists show, because the win rate
 * and the head-to-head records are only worth anything over a run of games.
 */
export async function loadUserHistory(userId: string, limit = STATS_LIMIT) {
  const db = getDb();
  const recentRooms = db.select({ id: rooms.id }).from(rooms)
    .where(and(eq(rooms.status, "finished"), inArray(rooms.id,
      db.select({ roomId: players.roomId }).from(players).where(eq(players.userId, userId)))))
    .orderBy(desc(rooms.finishedAt)).limit(limit);
  const accountPlayers = await db
    .select({ id: players.id, roomId: players.roomId })
    .from(players)
    .where(and(eq(players.userId, userId), inArray(players.roomId, recentRooms)));
  return loadFinishedGames(
    accountPlayers.map((player) => player.roomId),
    accountPlayers.map((player) => player.id),
    limit,
  );
}
