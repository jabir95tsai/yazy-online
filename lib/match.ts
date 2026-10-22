import { categoryIds, filledCount, scoreSummary, YAZY_BONUS, YAZY_BONUS_VALUE } from "./game.ts";

export type SurrenderReason = "manual" | "automatic" | null;
export type MatchPlayer = { id: string; seat: number; surrenderReason: SurrenderReason };
export type MatchScore = { playerId: string; category: string; score: number };
const maximums = [5, 10, 15, 20, 25, 30, 30, 30, 25, 30, 40, 50, 30];

/**
 * Optimistic final total, including the upper bonus only if 63 remains
 * reachable and a +100 extra-YAZY bonus for every open box that could earn one.
 */
export function maximumFinalScore(entries: Array<{ category: string; score: number }>): number {
  const saved = new Map(entries.map((entry) => [entry.category, entry.score]));
  const open = categoryIds.length - filledCount(entries);
  if (open <= 0) return scoreSummary(entries).total;
  const yazy = saved.get("yazy");
  const futureBonus = yazy === undefined ? Math.max(0, open - 1) : yazy > 0 ? open : 0;
  return scoreSummary([...categoryIds.map((category, index) => ({
    category, score: saved.get(category) ?? maximums[index],
  })), { category: YAZY_BONUS, score: (saved.get(YAZY_BONUS) ?? 0) + futureBonus * YAZY_BONUS_VALUE }]).total;
}

/**
 * Guaranteed floor total. Any open box can still end at 0: a timed-out turn
 * is skipped into the first free box with 0, even Chance and even after the
 * third roll, so only points already on the scorecard are certain.
 */
export function minimumFinalScore(entries: Array<{ category: string; score: number }>): number {
  return scoreSummary(entries).total;
}

export function resolveMatch(players: MatchPlayer[], scores: MatchScore[], currentSeat: number,
  advance: boolean, manualPlayerId?: string) {
  const nextPlayers = players.map((player) => ({ ...player,
    surrenderReason: player.id === manualPlayerId ? "manual" as const : player.surrenderReason,
  }));
  const entries = (id: string) => scores.filter((score) => score.playerId === id);
  const filled = (id: string) => filledCount(entries(id));
  const active = nextPlayers.filter((player) => !player.surrenderReason);
  const best = Math.max(...active.map((player) => minimumFinalScore(entries(player.id))));
  // Keep ties alive and preserve complete scorecards as ordinary results.
  for (const player of active) {
    if (filled(player.id) < categoryIds.length && maximumFinalScore(entries(player.id)) < best) {
      player.surrenderReason = "automatic";
    }
  }
  const unfinished = nextPlayers.filter((player) => !player.surrenderReason && filled(player.id) < categoryIds.length);
  const ordered = [...unfinished].sort((a, b) => a.seat - b.seat);
  const current = ordered.find((player) => player.seat === currentSeat);
  const next = !advance && current ? current : ordered.find((player) => player.seat > currentSeat) ?? ordered[0];
  return { players: nextPlayers, complete: !next, nextSeat: next?.seat ?? currentSeat,
    round: next ? Math.min(13, filled(next.id) + 1) : 13 };
}

/** A concession loses to every non-conceding player, regardless of raw points. */
export function resultValue(total: number, surrenderReason?: string | null) {
  return surrenderReason ? -1 : total;
}
