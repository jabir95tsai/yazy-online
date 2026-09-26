import { and, desc, eq } from "drizzle-orm";
import { idsIn } from "./query.ts";
import { getDb } from "@/db";
import { players, rooms, scores, roomGames } from "@/db/schema";

export { historyStats, versusRecords } from "@/lib/stats";
export type { HistoryStats, VersusRecord } from "@/lib/stats";

/** How many finished games the landing page and the record tab list. */
export const HISTORY_LIMIT = 20;

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
  limit: number | null = HISTORY_LIMIT,
) {
  const uniqueRoomIds = [...new Set(roomIds)];
  if (!uniqueRoomIds.length) return [] as HistoryGame[];
  const db = getDb();
  const finishedQuery = db
    .select()
    .from(rooms)
    .where(and(idsIn(rooms.id, uniqueRoomIds), eq(rooms.status, "finished")))
    .orderBy(desc(rooms.finishedAt));
  const archiveQuery = db.select().from(roomGames)
    .where(idsIn(roomGames.roomId, uniqueRoomIds)).orderBy(desc(roomGames.finishedAt));
  // A consistent snapshot prevents a concurrent restart from mixing old room
  // metadata with the new game's empty scorecard or counting a game twice.
  const [finishedRooms, archived, gamePlayers, gameScores] = await db.batch([
    limit === null ? finishedQuery : finishedQuery.limit(limit),
    limit === null ? archiveQuery : archiveQuery.limit(limit),
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
      .where(idsIn(players.roomId, uniqueRoomIds)),
    db
      .select({ roomId: scores.roomId, playerId: scores.playerId, category: scores.category, score: scores.score })
      .from(scores)
      .where(idsIn(scores.roomId, uniqueRoomIds)),
  ]);
  const mine = new Set(myPlayerIds);
  const playersByRoom = Map.groupBy(gamePlayers, (player) => player.roomId);
  const scoresByPlayer = Map.groupBy(gameScores, (score) => score.playerId);
  const userByPlayer = new Map(gamePlayers.map((player) => [player.id, player.userId]));

  const currentGames = finishedRooms.map((room) => ({
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
  const archivedGames = archived.map((row) => {
    const game = JSON.parse(row.gameJson) as HistoryGame;
    return { ...game, players: game.players.map((player) => ({
      ...player, userId: userByPlayer.get(player.id) ?? player.userId, isMe: mine.has(player.id),
    })) };
  });
  const games = [...currentGames, ...archivedGames]
    .sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
  return limit === null ? games : games.slice(0, limit);
}

/**
 * Every finished game on an account, newest first.
 *
 * Statistics include all finished games by default; lists may request a limit.
 */
export async function loadUserHistory(userId: string, limit: number | null = null) {
  const db = getDb();
  const accountPlayers = await db
    .select({ id: players.id, roomId: players.roomId })
    .from(players)
    .where(eq(players.userId, userId));
  return loadFinishedGames(
    accountPlayers.map((player) => player.roomId),
    accountPlayers.map((player) => player.id),
    limit,
  );
}
