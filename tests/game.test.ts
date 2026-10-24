import assert from "node:assert/strict";
import test from "node:test";
import { dieProfile, renderThrow, renderResting, scheduleContact } from "../lib/dice-animation.ts";

test("slow roll responses keep moving and land on every authoritative face", () => {
  for (let index = 0; index < 5; index++) {
    const waiting = { startedAt: 0, airborneFace: index + 1, target: null, contactAt: null, profile: dieProfile(index) };
    assert.notDeepEqual(renderThrow(waiting, 1500), renderThrow(waiting, 1750));
    for (let target = 1; target <= 6; target++) {
      const contactAt = scheduleContact(0, 5000, 0);
      const resolved = { ...waiting, target, contactAt };
      const arrival = renderThrow(resolved, 5000);
      const before = renderThrow(waiting, 5000);
      assert.equal(arrival.transform, before.transform);
      arrival.faces.forEach((face, i) => {
        assert.equal(face.points, before.faces[i].points);
        assert.equal(face.matrix, before.faces[i].matrix);
        assert.ok(Math.abs(face.shade - before.faces[i].shade) < 1e-10);
      });
      assert.deepEqual(renderThrow(resolved, contactAt + 400), renderResting(target));
    }
  }
});
import {
  findResumableSession,
  selectBrowserSession,
  upsertBrowserSession,
  type BrowserSession,
} from "../lib/browser-session.ts";
import { abandonedRoomCutoff } from "../lib/cleanup.ts";
import { formatHistoryDate } from "../lib/history-date.ts";
import { historyResult } from "../lib/history-result.ts";

test("history distinguishes concession wins from score wins and preserves concession reasons", () => {
  const winner = { total: 1 };
  const manual = { total: 50, surrenderReason: "manual" };
  const automatic = { total: 30, surrenderReason: "automatic" };
  assert.equal(historyResult(winner, [manual, automatic]).wonBySurrender, true);
  assert.equal(historyResult(winner, [manual, automatic]).label, "對手投降獲勝");
  assert.equal(historyResult(manual, [winner]).label, "手動投降（敗）");
  assert.equal(historyResult(automatic, [winner]).label, "自動投降（敗）");
  assert.equal(historyResult({ total: 60 }, [manual, { total: 20 }]).wonBySurrender, false);
  assert.equal(historyResult({ total: 60 }, [manual, { total: 20 }]).label, "獲勝");
  assert.equal(historyResult(winner, [{ total: 1 }, manual]).label, "平手");
  assert.equal(historyResult(winner, [{ total: 2 }]).label, "落敗");
  assert.equal(historyResult(winner, []).label, "單人對局");
  assert.equal(historyResult(winner, []).wonBySurrender, false);
});

test("history dates support extended room timestamps and invalid legacy values", () => {
  const standard = "2026-09-26T12:00:00.123Z";
  const extended = "2026-09-26T12:00:00.1231234567890123456789012345678901234567890Z";
  assert.equal(formatHistoryDate(extended), formatHistoryDate(standard));
  assert.equal(formatHistoryDate("not-a-date"), "日期不明");
  assert.equal(formatHistoryDate(""), "日期不明");
});
import { maximumFinalScore, minimumFinalScore, resolveMatch, type MatchPlayer } from "../lib/match.ts";
import { addTurnScore, categoryIds, fairDieFromByte, filledCount, recommendScore, scoreDice, scoreSummary, scoreTurn } from "../lib/game.ts";
import {
  LEGACY_PBKDF2_ITERATIONS,
  parseHash,
  serializeHash,
} from "../lib/password-hash.ts";
import { historyStats, versusRecords, placeFor } from "../lib/stats.ts";
import { RequestScope, withTimeout } from "../lib/request-scope.ts";
import { idsIn } from "../lib/query.ts";
import { sql } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { DatabaseSync } from "node:sqlite";

test("room changes invalidate old responses even when the same room is reopened", () => {
  const scope = new RequestScope();
  const old = scope.signal;
  scope.reset();
  assert.equal(old.aborted, true);
  assert.equal(scope.accepts(old), false);
  assert.equal(scope.accepts(scope.signal), true);
});

test("competition places preserve ties and skip the following place", () => {
  assert.deepEqual([200, 200, 150, 100].map((score) => placeFor(score, [200, 200, 150, 100])), [1, 1, 3, 4]);
});

test("large ID sets use one parameter and match all selected rows", () => {
  const ids = Array.from({ length: 250 }, (_, i) => `room-${i}`);
  const query = new SQLiteSyncDialect().sqlToQuery(sql`SELECT value FROM json_each(${JSON.stringify(ids)}) WHERE ${idsIn(sql`value`, ids)}`);
  assert.equal(query.params.length, 2);
  const db = new DatabaseSync(":memory:");
  try {
    assert.equal(db.prepare(query.sql).all(...query.params as string[]).length, 250);
    const empty = new SQLiteSyncDialect().sqlToQuery(sql`SELECT 1 WHERE ${idsIn(sql`'room-1'`, [])}`);
    assert.equal(db.prepare(empty.sql).all(...empty.params as string[]).length, 0);
  } finally { db.close(); }
});

test("join timestamps advance atomically even with equal or earlier request clocks", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE rooms(updated_at TEXT); INSERT INTO rooms VALUES ('2026-09-13T00:00:00.999Z')");
    const update = db.prepare("UPDATE rooms SET updated_at = CASE WHEN updated_at >= ? THEN strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0.001 seconds') ELSE ? END");
    update.run("2026-09-13T00:00:00.999Z", "2026-09-13T00:00:00.999Z");
    update.run("2026-09-12T00:00:00.000Z", "2026-09-12T00:00:00.000Z");
    assert.equal(db.prepare("SELECT updated_at FROM rooms").get()?.updated_at, "2026-09-13T00:00:01.001Z");
  } finally { db.close(); }
});

test("scores upper section and combinations", () => {
  assert.equal(scoreDice("sixes", [6, 6, 6, 2, 1]), 18);
  assert.equal(scoreDice("threeKind", [4, 4, 4, 2, 1]), 15);
  assert.equal(scoreDice("fourKind", [4, 4, 4, 4, 1]), 17);
  assert.equal(scoreDice("fullHouse", [2, 2, 5, 5, 5]), 25);
  assert.equal(scoreDice("yazy", [3, 3, 3, 3, 3]), 50);
  assert.equal(scoreDice("chance", [1, 2, 3, 4, 6]), 16);
});

test("recognizes straights with duplicate dice", () => {
  assert.equal(scoreDice("smallStraight", [1, 2, 3, 4, 4]), 30);
  assert.equal(scoreDice("smallStraight", [2, 3, 4, 5, 5]), 30);
  assert.equal(scoreDice("largeStraight", [2, 3, 4, 5, 6]), 40);
  assert.equal(scoreDice("largeStraight", [1, 2, 3, 4, 4]), 0);
});

test("recommendation prefers four of a kind across all equal-scoring categories", () => {
  const previews = new Map(categoryIds.map((id) => [id, scoreDice(id, [6, 6, 6, 6, 6])]));
  assert.equal(recommendScore(previews, [])?.id, "yazy");
  assert.equal(recommendScore(previews, [{ category: "yazy", score: 0 }])?.id, "fourKind");
  assert.equal(recommendScore(previews, [
    { category: "yazy", score: 0 }, { category: "fourKind", score: 30 },
  ])?.id, "threeKind");
  assert.equal(recommendScore(new Map([...previews].reverse()), [{ category: "yazy", score: 0 }])?.id, "fourKind");
});

test("recommendation includes only a newly earned upper bonus", () => {
  const previews = new Map(categoryIds.map((id) => [id, scoreDice(id, [4, 4, 4, 5, 6])]));
  const entries = [
    { category: "fives", score: 15 }, { category: "sixes", score: 30 },
    { category: "threes", score: 6 },
  ];
  assert.deepEqual(recommendScore(previews, entries), {
    id: "fours", score: 12, gain: 47, bonusGain: 35,
  });
  assert.equal(recommendScore(previews, [{ category: "sixes", score: 30 }])?.id, "threeKind");
  const alreadyEarned = [...entries, { category: "ones", score: 4 }, { category: "twos", score: 8 }];
  assert.deepEqual(recommendScore(previews, alreadyEarned), {
    id: "threeKind", score: 23, gain: 23, bonusGain: 0,
  });
});

test("recommendation handles straights, Chance fallback, and no positive scores", () => {
  const previews = new Map(categoryIds.map((id) => [id, scoreDice(id, [1, 2, 3, 4, 5])]));
  assert.equal(recommendScore(previews, [])?.id, "largeStraight");
  assert.equal(recommendScore(previews, [{ category: "largeStraight", score: 40 }])?.id, "smallStraight");
  assert.equal(recommendScore(previews, [
    { category: "largeStraight", score: 40 }, { category: "smallStraight", score: 30 },
  ])?.id, "chance");
  assert.equal(recommendScore(new Map([["yazy", 0], ["fourKind", 0]]), []), null);
  assert.equal(recommendScore(new Map(), []), null);
});

test("adds the upper-section bonus at 63", () => {
  const summary = scoreSummary([
    { category: "ones", score: 3 },
    { category: "twos", score: 6 },
    { category: "threes", score: 9 },
    { category: "fours", score: 12 },
    { category: "fives", score: 15 },
    { category: "sixes", score: 18 },
    { category: "chance", score: 20 },
  ]);
  assert.deepEqual(summary, { upper: 63, bonus: 35, lower: 20, yazyBonus: 0, total: 118 });
});

test("every extra YAZY after a scored 50 earns +100 with Joker values", () => {
  const yazy = [4, 4, 4, 4, 4];
  assert.deepEqual(scoreTurn("yazy", yazy, []), { score: 50, bonus: 0 });
  let entries = [{ category: "yazy", score: 50 }];
  assert.deepEqual(scoreTurn("fours", yazy, entries), { score: 20, bonus: 100 });
  assert.deepEqual(scoreTurn("fullHouse", yazy, entries), { score: 25, bonus: 100 });
  assert.deepEqual(scoreTurn("largeStraight", yazy, entries), { score: 40, bonus: 100 });
  assert.deepEqual(scoreTurn("fullHouse", [2, 2, 3, 3, 3], entries), { score: 25, bonus: 0 });
  for (const category of ["fours", "fullHouse", "chance"] as const) {
    const turn = scoreTurn(category, yazy, entries);
    entries = addTurnScore(entries, { category, score: turn.score }, turn.bonus);
  }
  assert.equal(filledCount(entries), 4);
  assert.deepEqual(entries.filter((entry) => entry.category === "yazyBonus"), [{ category: "yazyBonus", score: 300 }]);
  assert.equal(scoreSummary(entries).total, 50 + 20 + 25 + 20 + 300);
  // A zeroed YAZY box still allows the Joker but never the bonus.
  assert.deepEqual(scoreTurn("smallStraight", yazy, [{ category: "yazy", score: 0 }]), { score: 30, bonus: 0 });
});

test("maps accepted random bytes evenly across all six faces", () => {
  const counts = [0, 0, 0, 0, 0, 0];
  for (let byte = 0; byte < 252; byte += 1) {
    const face = fairDieFromByte(byte);
    assert.notEqual(face, null);
    counts[(face ?? 1) - 1] += 1;
  }
  assert.deepEqual(counts, [42, 42, 42, 42, 42, 42]);
  assert.equal(fairDieFromByte(252), null);
  assert.equal(fairDieFromByte(255), null);
});

test("keeps separate player identities for two tabs in the same room", () => {
  const playerA: BrowserSession = {
    code: "ABC123",
    playerId: "player-a",
    token: "token-a",
    name: "玩家 A",
  };
  const playerB: BrowserSession = {
    code: "ABC123",
    playerId: "player-b",
    token: "token-b",
    name: "玩家 B",
  };
  const sessions = upsertBrowserSession(
    upsertBrowserSession([], playerA),
    playerB,
  );

  assert.equal(sessions.length, 2);
  assert.equal(selectBrowserSession(sessions, "ABC123", "player-a"), playerA);
  assert.equal(selectBrowserSession(sessions, "ABC123", "player-b"), playerB);
});

test("a tab with no identity of its own never adopts another tab's player", () => {
  const playerA: BrowserSession = {
    code: "ABC123",
    playerId: "player-a",
    token: "token-a",
    name: "玩家 A",
  };
  const sessions = upsertBrowserSession([], playerA);

  // A second tab opening the invite link has an empty sessionStorage. It must
  // fall through to the join form instead of silently becoming 玩家 A.
  assert.equal(selectBrowserSession(sessions, "ABC123", null), null);
  // ...but the previous identity is still offered as an explicit choice.
  assert.equal(findResumableSession(sessions, "ABC123"), playerA);
  assert.equal(findResumableSession(sessions, "ZZZ999"), null);
});

test("an unknown active player id does not fall back to another session", () => {
  const sessions = upsertBrowserSession([], {
    code: "ABC123",
    playerId: "player-a",
    token: "token-a",
    name: "玩家 A",
  });

  assert.equal(selectBrowserSession(sessions, "ABC123", "player-gone"), null);
});

test("password hashes round-trip the cost they were written with", () => {
  const stored = serializeHash(48_000, "abc123");
  assert.equal(stored, "48000:abc123");
  assert.deepEqual(parseHash(stored), { iterations: 48_000, digest: "abc123" });

  // Raising the constant later must not change how an older row is verified,
  // otherwise every existing password stops matching.
  assert.deepEqual(parseHash(serializeHash(600_000, "def456")), {
    iterations: 600_000,
    digest: "def456",
  });
});

test("password hashes written before the cost was recorded still verify", () => {
  // Bare digest, no `<iterations>:` prefix.
  assert.deepEqual(parseHash("bare-digest-no-prefix"), {
    iterations: LEGACY_PBKDF2_ITERATIONS,
    digest: "bare-digest-no-prefix",
  });
  // A malformed prefix must fall back rather than derive with NaN iterations.
  assert.equal(parseHash("notanumber:digest").iterations, LEGACY_PBKDF2_ITERATIONS);
  assert.equal(parseHash("0:digest").iterations, LEGACY_PBKDF2_ITERATIONS);
});

test("abandoned-room cutoff is an ISO-8601 UTC instant in the past", () => {
  const now = Date.parse("2026-08-02T00:00:00.000Z");
  assert.equal(abandonedRoomCutoff(now, 24), "2026-08-01T00:00:00.000Z");
  // The comparison is a string compare against `rooms.updated_at`, so the
  // format has to match exactly what the app writes.
  assert.match(abandonedRoomCutoff(now), /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  assert.ok(abandonedRoomCutoff(now) < new Date(now).toISOString());
});


/** A finished line worth `total`, optionally with a YAZY in it. */
function line(total: number, options: { me?: boolean; userId?: string; yazy?: boolean } = {}) {
  const scores = [{ category: "chance", score: options.yazy ? total - 50 : total }];
  if (options.yazy) scores.push({ category: "yazy", score: 50 });
  return { isMe: options.me ?? false, userId: options.userId ?? null, scores };
}

test("win rate counts only the games with somebody to beat", () => {
  const stats = historyStats([
    { players: [line(100, { me: true })] },
    { players: [line(110, { me: true }), line(90, { userId: "b" })] },
    { players: [line(80, { me: true }), line(120, { userId: "b" })] },
    { players: [line(100, { me: true }), line(100, { userId: "b" })] },
  ]);
  assert.equal(stats.games, 4);
  // The solo table is played but not contested, and the draw is not a win.
  assert.equal(stats.contested, 3);
  assert.deepEqual([stats.wins, stats.losses, stats.ties], [1, 1, 1]);
  assert.equal(stats.winRate, 33);
  assert.equal(stats.bestScore, 110);
  assert.equal(stats.averageScore, 98);
});

test("stats skip games you did not sit at, and count YAZY games once", () => {
  const stats = historyStats([
    { players: [line(200, { userId: "b" }), line(150, { userId: "c" })] },
    { players: [line(160, { me: true, yazy: true }), line(120, { userId: "b" })] },
    { players: [line(140, { me: true }), line(120, { userId: "b" })] },
  ]);
  assert.equal(stats.games, 2);
  assert.equal(stats.yazy, 1);
  assert.equal(stats.yazyRate, 50);
  assert.equal(stats.bestScore, 160);
});

test("head-to-head records split a shared table per opponent", () => {
  const records = versusRecords(
    [
      { players: [line(150, { me: true }), line(120, { userId: "b" }), line(170, { userId: "c" })] },
      { players: [line(100, { me: true }), line(100, { userId: "b" })] },
      // A guest with no account cannot be told apart between games.
      { players: [line(90, { me: true }), line(80)] },
    ],
    "me",
  );
  assert.deepEqual([...records.keys()].sort(), ["b", "c"]);
  const versusB = records.get("b");
  assert.deepEqual(
    [versusB?.games, versusB?.wins, versusB?.losses, versusB?.ties],
    [2, 1, 0, 1],
  );
  assert.equal(versusB?.myAverage, 125);
  assert.equal(versusB?.theirAverage, 110);
  assert.equal(records.get("c")?.losses, 1);
});

test("head-to-head can find you by account when the seats are unmarked", () => {
  const records = versusRecords(
    [{ players: [line(130, { userId: "me" }), line(110, { userId: "b" })] }],
    "me",
  );
  assert.equal(records.get("b")?.wins, 1);
  assert.equal(records.has("me"), false);
});


test("maximum score includes reachable bonus and treats zero as a filled category", () => {
  assert.equal(maximumFinalScore([]), 375 + 1200); // every box after the first YAZY could earn +100
  assert.equal(maximumFinalScore([{ category: "yazy", score: 0 }]), 325);
  assert.equal(maximumFinalScore([{ category: "yazy", score: 50 }, { category: "yazyBonus", score: 100 }]), 475 + 1200);
  const noBonus = categoryIds.slice(0, 6).map((category) => ({ category, score: 0 }));
  assert.equal(maximumFinalScore(noBonus), 235 + 600);
  const almost = [{ category: "ones", score: 3 }, { category: "twos", score: 6 },
    { category: "threes", score: 9 }, { category: "fours", score: 12 }, { category: "fives", score: 5 }];
  assert.equal(maximumFinalScore(almost), 335 + 700); // 65 upper + 35 bonus + 235 lower + 7 YAZY bonuses
  assert.equal(maximumFinalScore([...almost, { category: "sixes", score: 0 }]), 270 + 600);
});

const matchPlayers: MatchPlayer[] = [0, 1, 2].map((seat) => ({ id: `p${seat}`, seat, surrenderReason: null }));
const nearEnd = (id: string) => categoryIds.filter((id) => id !== "chance").map((category) => ({ playerId: id, category, score: 0 }));

test("minimum score counts only what is on the scorecard, since a timeout can zero any open box", () => {
  assert.equal(minimumFinalScore([]), 0);
  assert.equal(minimumFinalScore([{ category: "chance", score: 12 }]), 12);
  assert.equal(
    minimumFinalScore([
      { category: "ones", score: 3 },
      { category: "twos", score: 6 },
      { category: "threes", score: 9 },
      { category: "fours", score: 12 },
      { category: "fives", score: 15 },
      { category: "sixes", score: 18 },
    ]),
    63 + 35,
  );
});

test("automatic surrender keeps a possible tie alive and skips eliminated seats", () => {
  // p0 still has Chance open, but a timeout could fill it with 0, so no +5 floor.
  // p1 only has Chance left (maximumFinalScore = 30), so a tie at 30 is still reachable.
  const scores = [...nearEnd("p1"), { playerId: "p0", category: "fullHouse", score: 25 }];
  scores.push({ playerId: "p0", category: "ones", score: 5 });
  assert.equal(resolveMatch(matchPlayers, scores, 0, true).players[1].surrenderReason, null);
  // Once p0 banks 31, p1 can no longer catch up.
  scores.push({ playerId: "p0", category: "twos", score: 1 });
  const next = resolveMatch(matchPlayers, scores, 0, true);
  assert.equal(next.players[1].surrenderReason, "automatic");
  assert.equal(next.nextSeat, 2);
  assert.equal(next.complete, false);
});

test("a timed-out skip that zeroes Chance cannot be pre-empted by a Chance floor", () => {
  // p0 has 26 banked and only Chance open; p1 can reach 30. Before the fix p0's
  // floor was 31 and p1 was eliminated, even though skipping p0 ends them at 26.
  const p0 = categoryIds.filter((id) => id !== "chance").map((category) => ({ playerId: "p0", category, score: 0 }));
  p0.find((entry) => entry.category === "fullHouse")!.score = 25;
  p0.find((entry) => entry.category === "ones")!.score = 1;
  const scores = [...p0, ...nearEnd("p1")];
  assert.equal(resolveMatch(matchPlayers.slice(0, 2), scores, 0, false).players[1].surrenderReason, null);
});

test("auto-surrender waits for the player's score: the dice on the table do not eliminate anyone", () => {
  // p1 has Chance and Ones open, p0 banked 20. Rolling (advance=false) keeps p1 alive;
  // p1 is only eliminated once the score they pick leaves them unable to catch up.
  const p1 = nearEnd("p1").filter((entry) => entry.category !== "ones");
  const scores = [...p1, { playerId: "p0", category: "chance", score: 20 }];
  assert.equal(resolveMatch(matchPlayers.slice(0, 2), scores, 1, false).players[1].surrenderReason, null);
  const scored = [...scores, { playerId: "p1", category: "chance", score: 6 }];
  const next = resolveMatch(matchPlayers.slice(0, 2), scored, 1, true);
  assert.equal(next.players[1].surrenderReason, "automatic");
  assert.equal(next.nextSeat, 0);
});

test("manual surrender preserves another player's turn and the winner can finish a scorecard", () => {
  const next = resolveMatch(matchPlayers.slice(0, 2), [], 0, false, "p1");
  assert.equal(next.nextSeat, 0);
  assert.equal(next.complete, false);
  const finalScores = categoryIds.map((category) => ({ playerId: "p0", category, score: 0 }));
  assert.equal(resolveMatch(next.players, finalScores, 0, true).complete, true);
});

test("completed opponents remain contenders, current concession advances, and turns wrap", () => {
  const full = categoryIds.map((category) => ({ playerId: "p0", category, score: 0 }));
  assert.equal(resolveMatch(matchPlayers, full, 2, true).nextSeat, 1);
  assert.equal(resolveMatch(matchPlayers, [], 1, false, "p1").nextSeat, 2);
  const fullScores = matchPlayers.flatMap((player) => categoryIds.map((category) => ({ playerId: player.id, category, score: 0 })));
  const end = resolveMatch(matchPlayers, fullScores, 2, true);
  assert.equal(end.complete, true);
  assert.ok(end.players.every((player) => !player.surrenderReason));
});

test("concession overrides higher points in overall and head-to-head results", () => {
  const games = [{ players: [
    { userId: "me", isMe: true, surrenderReason: "manual", scores: [{ category: "yazy", score: 50 }] },
    { userId: "them", scores: [{ category: "ones", score: 1 }] },
  ] }];
  assert.equal(historyStats(games).losses, 1);
  assert.equal(historyStats(games).bestScore, 50);
  assert.equal(versusRecords(games).get("them")?.losses, 1);
});

test("withTimeout aborts on its own timer or with its parent", async () => {
  const parent = new AbortController();
  const timed = withTimeout(parent.signal, 5);
  assert.equal(timed.aborted, false);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(timed.aborted, true);
  const linked = withTimeout(parent.signal, 1_000);
  parent.abort();
  assert.equal(linked.aborted, true);
});
