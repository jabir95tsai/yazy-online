import { categoryIds, scoreSummary } from "./game.ts";

export type SurrenderReason = "manual" | "automatic" | null;
export type MatchPlayer = { id: string; seat: number; surrenderReason: SurrenderReason };
export type MatchScore = { playerId: string; category: string; score: number };
const maximums = [5, 10, 15, 20, 25, 30, 30, 30, 25, 30, 40, 50, 30];

/** Optimistic final total, including the bonus only if 63 remains reachable. */
export function maximumFinalScore(entries: Array<{ category: string; score: number }>) {
  const saved = new Map(entries.map((entry) => [entry.category, entry.score]));
  return scoreSummary(categoryIds.map((category, index) => ({
    category, score: saved.get(category) ?? maximums[index],
  }))).total;
}

export function resolveMatch(players: MatchPlayer[], scores: MatchScore[], currentSeat: number,
  advance: boolean, manualPlayerId?: string) {
  const nextPlayers = players.map((player) => ({ ...player,
    surrenderReason: player.id === manualPlayerId ? "manual" as const : player.surrenderReason,
  }));
  const entries = (id: string) => scores.filter((score) => score.playerId === id);
  const active = nextPlayers.filter((player) => !player.surrenderReason);
  const best = Math.max(...active.map((player) => scoreSummary(entries(player.id)).total));
  // Keep ties alive and preserve complete scorecards as ordinary results.
  for (const player of active) {
    if (entries(player.id).length < categoryIds.length && maximumFinalScore(entries(player.id)) < best) {
      player.surrenderReason = "automatic";
    }
  }
  const unfinished = nextPlayers.filter((player) => !player.surrenderReason && entries(player.id).length < categoryIds.length);
  const ordered = [...unfinished].sort((a, b) => a.seat - b.seat);
  const current = ordered.find((player) => player.seat === currentSeat);
  const next = !advance && current ? current : ordered.find((player) => player.seat > currentSeat) ?? ordered[0];
  return { players: nextPlayers, complete: !next, nextSeat: next?.seat ?? currentSeat,
    round: next ? Math.min(13, entries(next.id).length + 1) : 13 };
}

/** A concession loses to every non-conceding player, regardless of raw points. */
export function resultValue(total: number, surrenderReason?: string | null) {
  return surrenderReason ? -1 : total;
}
