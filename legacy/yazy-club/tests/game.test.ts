import assert from "node:assert/strict";
import test from "node:test";
import { scoreDice, scoreSummary } from "../lib/game.ts";

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
