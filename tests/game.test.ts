import assert from "node:assert/strict";
import test from "node:test";
import {
  findResumableSession,
  selectBrowserSession,
  upsertBrowserSession,
  type BrowserSession,
} from "../lib/browser-session.ts";
import { fairDieFromByte, scoreDice, scoreSummary } from "../lib/game.ts";

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
  assert.deepEqual(summary, { upper: 63, bonus: 35, lower: 20, total: 118 });
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
