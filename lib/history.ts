import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { players, rooms, scores } from "@/db/schema";
import { scoreSummary } from "@/lib/game";

export type HistoryGame = {
  code: string;
  finishedAt: string;
  players: Array<{
    id: string;
    name: string;
    isMe: boolean;
    scores: Array<{ category: string; score: number }>;
  }>;
};

export async function loadFinishedGames(roomIds: string[], myPlayerIds: string[] = []) {
  const uniqueRoomIds = [...new Set(roomIds)];
  if (!uniqueRoomIds.length) return [] as HistoryGame[];
  const db = getDb();
  const finishedRooms = await db
    .select()
    .from(rooms)
    .where(and(inArray(rooms.id, uniqueRoomIds), eq(rooms.status, "finished")))
    .orderBy(desc(rooms.finishedAt))
    .limit(20);
  if (!finishedRooms.length) return [] as HistoryGame[];

  const ids = finishedRooms.map((room) => room.id);
  const [gamePlayers, gameScores] = await Promise.all([
    db
      .select({ id: players.id, roomId: players.roomId, name: players.name, seat: players.seat })
      .from(players)
      .where(inArray(players.roomId, ids)),
    db
      .select({ roomId: scores.roomId, playerId: scores.playerId, category: scores.category, score: scores.score })
      .from(scores)
      .where(inArray(scores.roomId, ids)),
  ]);
  const mine = new Set(myPlayerIds);

  return finishedRooms.map((room) => ({
    code: room.code,
    finishedAt: room.finishedAt ?? room.updatedAt,
    players: gamePlayers
      .filter((player) => player.roomId === room.id)
      .sort((a, b) => a.seat - b.seat)
      .map((player) => ({
        id: player.id,
        name: player.name,
        isMe: mine.has(player.id),
        scores: gameScores
          .filter((score) => score.playerId === player.id)
          .map(({ category, score }) => ({ category, score })),
      })),
  }));
}

export async function loadUserHistory(userId: string) {
  const db = getDb();
  const accountPlayers = await db
    .select({ id: players.id, roomId: players.roomId })
    .from(players)
    .where(eq(players.userId, userId));
  return loadFinishedGames(
    accountPlayers.map((player) => player.roomId),
    accountPlayers.map((player) => player.id),
  );
}

export function historyStats(games: HistoryGame[]) {
  let wins = 0;
  let totalScore = 0;
  let bestScore = 0;
  let scoredGames = 0;

  for (const game of games) {
    const totals = game.players.map((player) => ({
      isMe: player.isMe,
      total: scoreSummary(player.scores).total,
    }));
    const mine = totals.find((player) => player.isMe);
    if (!mine) continue;
    scoredGames += 1;
    totalScore += mine.total;
    bestScore = Math.max(bestScore, mine.total);
    if (mine.total === Math.max(...totals.map((player) => player.total))) wins += 1;
  }

  return {
    games: scoredGames,
    wins,
    bestScore,
    averageScore: scoredGames ? Math.round(totalScore / scoredGames) : 0,
  };
}
