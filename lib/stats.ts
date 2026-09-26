import { scoreSummary } from "./game.ts";
import { resultValue } from "./match.ts";

/**
 * A player's line in a finished game, as far as the numbers care.
 *
 * `isMe` is set by the history loader for the seats belonging to the person
 * asking; `userId` is what lets the same person be recognised across games —
 * a guest seat has neither and simply counts as an opponent.
 */
export type StatsPlayer = {
  surrenderReason?: string | null;
  userId?: string | null;
  isMe?: boolean;
  scores: Array<{ category: string; score: number }>;
};

export type StatsGame = { players: StatsPlayer[] };

export type HistoryStats = {
  /** Finished games with a line of your own. */
  games: number;
  /** Of those, the ones with somebody to beat — the base of `winRate`. */
  contested: number;
  wins: number;
  losses: number;
  /** Games where the top total was shared. Neither a win nor a loss. */
  ties: number;
  /** Percentage, 0–100, of contested games won outright. */
  winRate: number;
  bestScore: number;
  averageScore: number;
  /** Games where you actually landed five of a kind. */
  yazy: number;
  /** Percentage, 0–100, of your games with a YAZY in them. */
  yazyRate: number;
};

/** Your record against one other account, across the tables you shared. */
export type VersusRecord = {
  games: number;
  wins: number;
  losses: number;
  ties: number;
  myBest: number;
  theirBest: number;
  myAverage: number;
  theirAverage: number;
  myYazy: number;
  theirYazy: number;
};

const EMPTY_STATS: HistoryStats = {
  games: 0,
  contested: 0,
  wins: 0,
  losses: 0,
  ties: 0,
  winRate: 0,
  bestScore: 0,
  averageScore: 0,
  yazy: 0,
  yazyRate: 0,
};

/** Final total for a line, upper bonus included. */
export function playerTotal(player: StatsPlayer) {
  return scoreSummary(player.scores).total;
}

/** Competition ranking: tied totals share a place, e.g. 1, 1, 3. */
export function placeFor(total: number, totals: number[]) {
  return 1 + totals.filter((other) => other > total).length;
}

export function hasYazy(player: StatsPlayer) {
  return player.scores.some((entry) => entry.category === "yazy" && entry.score > 0);
}

function percentage(part: number, whole: number) {
  return whole ? Math.round((part / whole) * 100) : 0;
}

function isMine(player: StatsPlayer, myUserId?: string) {
  return player.isMe === true || (Boolean(myUserId) && player.userId === myUserId);
}

/** The seat that belongs to you, if you sat at this table at all. */
function myLine(game: StatsGame, myUserId?: string) {
  return game.players.find((player) => isMine(player, myUserId)) ?? null;
}

/**
 * Your own numbers over a run of finished games.
 *
 * A solo table has nobody to beat, so it counts towards games played and the
 * score averages but is left out of `winRate` entirely — otherwise practising
 * alone would read as a perfect record. A shared top total is a tie rather
 * than a win, for the same reason.
 */
export function historyStats(games: StatsGame[], myUserId?: string): HistoryStats {
  let played = 0;
  let contested = 0;
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let totalScore = 0;
  let bestScore = 0;
  let yazy = 0;

  for (const game of games) {
    const mine = myLine(game, myUserId);
    if (!mine) continue;
    const total = playerTotal(mine);
    played += 1;
    totalScore += total;
    bestScore = Math.max(bestScore, total);
    if (hasYazy(mine)) yazy += 1;

    const others = game.players.filter((player) => player !== mine);
    if (!others.length) continue;
    contested += 1;
    const best = Math.max(...others.map((player) => resultValue(playerTotal(player), player.surrenderReason)));
    const result = resultValue(total, mine.surrenderReason);
    if (result > best) wins += 1;
    else if (result < best) losses += 1;
    else ties += 1;
  }

  if (!played) return EMPTY_STATS;
  return {
    games: played,
    contested,
    wins,
    losses,
    ties,
    winRate: percentage(wins, contested),
    bestScore,
    averageScore: Math.round(totalScore / played),
    yazy,
    yazyRate: percentage(yazy, played),
  };
}

/**
 * Head-to-head records, keyed by the other person's account id.
 *
 * Every table you both sat at counts, whether or not anyone else was there:
 * beating someone in a four-player game is still beating them. Seats without
 * an account are skipped, since there is no way to tell one guest from
 * another between games.
 */
export function versusRecords(games: StatsGame[], myUserId?: string) {
  const records = new Map<string, VersusRecord & { myTotal: number; theirTotal: number }>();

  for (const game of games) {
    const mine = myLine(game, myUserId);
    if (!mine) continue;
    const myScore = playerTotal(mine);
    const myYazy = hasYazy(mine) ? 1 : 0;
    const seen = new Set<string>();

    for (const player of game.players) {
      if (player === mine || !player.userId || player.userId === myUserId) continue;
      // One line each, even if somebody joined the same table twice.
      if (seen.has(player.userId)) continue;
      seen.add(player.userId);

      const theirScore = playerTotal(player);
      const record =
        records.get(player.userId) ??
        {
          games: 0,
          wins: 0,
          losses: 0,
          ties: 0,
          myBest: 0,
          theirBest: 0,
          myAverage: 0,
          theirAverage: 0,
          myYazy: 0,
          theirYazy: 0,
          myTotal: 0,
          theirTotal: 0,
        };
      record.games += 1;
      const myResult = resultValue(myScore, mine.surrenderReason);
      const theirResult = resultValue(theirScore, player.surrenderReason);
      if (myResult > theirResult) record.wins += 1;
      else if (myResult < theirResult) record.losses += 1;
      else record.ties += 1;
      record.myTotal += myScore;
      record.theirTotal += theirScore;
      record.myBest = Math.max(record.myBest, myScore);
      record.theirBest = Math.max(record.theirBest, theirScore);
      record.myYazy += myYazy;
      record.theirYazy += hasYazy(player) ? 1 : 0;
      records.set(player.userId, record);
    }
  }

  const finished = new Map<string, VersusRecord>();
  for (const [userId, record] of records) {
    const { myTotal, theirTotal, ...rest } = record;
    finished.set(userId, {
      ...rest,
      myAverage: Math.round(myTotal / record.games),
      theirAverage: Math.round(theirTotal / record.games),
    });
  }
  return finished;
}
