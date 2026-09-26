import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { readdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const origin = process.env.TEST_ORIGIN ?? "http://localhost:3100";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname), "Local tests only");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
const categories = ["ones", "twos", "threes", "fours", "fives", "sixes", "threeKind", "fourKind", "fullHouse", "smallStraight", "largeStraight", "yazy", "chance"];
const post = async (path, data, expected = 200) => {
  const response = await context.request.post(`${origin}${path}`, { data });
  assert.ok(expected === 200 ? response.ok() : response.status() === expected, `${path}: HTTP ${response.status()}, expected ${expected}`);
  return response.json();
};
const get = async (identity) => (await context.request.get(`${origin}/api/rooms/${identity.code}`)).json();
const act = async (identity, action, extra = {}, expected = 200) => post(`/api/rooms/${identity.code}/action`, {
  ...identity, action, expectedUpdatedAt: (await get(identity)).room.updatedAt, ...extra,
}, expected);
const make = async (count = 2) => {
  const first = { ...await post("/api/rooms", { name: "勝者測試" }), name: "勝者測試" };
  const players = [first];
  for (let i = 1; i < count; i++) players.push({ ...await post(`/api/rooms/${first.code}/join`, { name: `投降測試${i}` }), name: `投降測試${i}` });
  await act(first, "start");
  return players;
};
const dbFolder = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
const dbFiles = readdirSync(dbFolder).filter((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite");
assert.equal(dbFiles.length, 1, "Select the local test database explicitly if multiple exist");
const db = new DatabaseSync(`${dbFolder}/${dbFiles[0]}`);
db.exec("PRAGMA busy_timeout=5000");
const errors = [];
try {
  const [winner, loser] = await make();
  await act(winner, "finish", {}, 403);
  await act(winner, "roll");
  const before = await get(winner);
  await act(loser, "surrender", { token: "invalid-synthetic-token" }, 401);
  await act(loser, "surrender"); // Out of turn must preserve winner's dice and deadline.
  const after = await get(winner);
  assert.deepEqual(after.room.dice, before.room.dice);
  assert.equal(after.room.turnDeadline, before.room.turnDeadline);
  assert.equal(after.room.rollsUsed, 1);
  assert.equal(after.room.status, "playing");
  assert.equal(after.players[1].surrenderReason, "manual");
  await act(loser, "roll", {}, 403);
  await act(loser, "finish", {}, 409);
  await act(loser, "surrender", {}, 409);
  await act(winner, "score", { category: "chance" });
  assert.equal((await get(winner)).room.currentSeat, 0);
  await act(winner, "finish");
  assert.equal((await get(winner)).room.status, "finished");
  console.log("PASS manual concession, authentication/eligibility, preserved turn, solo continuation and finish");

  const pair = await make();
  const snapshot = await get(pair[0]);
  const responses = await Promise.all(pair.map((identity) => context.request.post(`${origin}/api/rooms/${identity.code}/action`, {
    data: { ...identity, action: "surrender", expectedUpdatedAt: snapshot.room.updatedAt },
  })));
  assert.deepEqual(responses.map((response) => response.status()).sort(), [200, 409]);
  assert.equal((await get(pair[0])).players.filter((player) => !player.surrenderReason).length, 1);
  console.log("PASS concurrent concessions leave exactly one winner");
  const survivingId = (await get(pair[0])).players.find((player) => !player.surrenderReason).id;
  const survivor = pair.find((identity) => identity.playerId === survivingId);
  await act(survivor, "roll");
  const scoreSnapshot = await get(survivor);
  const scoreResponses = await Promise.all(["ones", "chance"].map((category) => context.request.post(`${origin}/api/rooms/${survivor.code}/action`, {
    data: { ...survivor, action: "score", category, expectedUpdatedAt: scoreSnapshot.room.updatedAt },
  })));
  assert.deepEqual(scoreResponses.map((response) => response.status()).sort(), [200, 409]);
  assert.equal((await get(survivor)).scores.length, 1);
  console.log("PASS competing score requests commit exactly one score and one turn");

  const [a, b, c] = await make(3);
  await act(b, "surrender");
  await act(a, "roll");
  await act(a, "score", { category: "chance" });
  assert.equal((await get(a)).room.currentSeat, 2);
  await act(c, "surrender");
  assert.equal((await get(a)).room.currentSeat, 0);
  console.log("PASS three-player turn skipping and current-player concession");

  const [autoWinner, autoLoser] = await make();
  const autoRoom = await get(autoWinner);
  // Seed only this newly created synthetic room, never existing player data.
  const insert = db.prepare("INSERT INTO scores(room_id, player_id, category, score, created_at) VALUES (?, ?, ?, ?, ?)");
  for (const category of categories.filter((id) => id !== "chance")) {
    insert.run(autoRoom.room.id, autoLoser.playerId, category, 0, new Date().toISOString());
  }
  insert.run(autoRoom.room.id, autoWinner.playerId, "yazy", 50, new Date().toISOString());
  await act(autoWinner, "roll");
  await act(autoWinner, "score", { category: "ones" });
  assert.equal((await get(autoWinner)).players[1].surrenderReason, "automatic");
  assert.equal((await get(autoWinner)).scores.filter((entry) => entry.playerId === autoLoser.playerId).length, 12);

  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((identity) => {
    localStorage.setItem("yazy-club-sessions", JSON.stringify([identity]));
    sessionStorage.setItem(`yazy-club-active-player:${identity.code}`, identity.playerId);
  }, autoWinner);
  await page.goto(`${origin}/?room=${autoWinner.code}`);
  await page.getByText("你已獲勝！", { exact: true }).waitFor();
  await page.getByRole("button", { name: "立即結算", exact: true }).waitFor();
  await mkdir("outputs", { recursive: true });
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}`);
    await page.screenshot({ path: `outputs/surrender-winner-${width}.png`, fullPage: true });
  }
  // Winner can complete all remaining categories normally after auto-concession.
  for (const category of categories.filter((id) => !["ones", "yazy"].includes(id))) {
    await act(autoWinner, "roll");
    await act(autoWinner, "score", { category });
  }
  const finished = await get(autoWinner);
  assert.equal(finished.room.status, "finished");
  assert.equal(finished.scores.filter((score) => score.playerId === autoWinner.playerId).length, 13);
  const history = await post("/api/history", { sessions: [autoLoser] });
  const historicalGame = history.games.find((game) => game.code === autoWinner.code);
  assert.equal(historicalGame.players.find((player) => player.id === autoLoser.playerId).surrenderReason, "automatic");
  await page.getByRole("heading", { name: "這局結束了" }).waitFor();
  console.log("PASS server auto-concession, retained empty categories, full winner scorecard, mobile/desktop layouts");

  const [uiA] = await make();
  const uiContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const ui = await uiContext.newPage();
  ui.on("pageerror", (error) => errors.push(error.message));
  await ui.addInitScript((identity) => {
    localStorage.setItem("yazy-club-sessions", JSON.stringify([identity]));
    sessionStorage.setItem(`yazy-club-active-player:${identity.code}`, identity.playerId);
  }, uiA);
  await ui.goto(`${origin}/?room=${uiA.code}`);
  await ui.getByRole("button", { name: "投降", exact: true }).click();
  await ui.getByRole("dialog", { name: "確認投降" }).waitFor();
  await ui.keyboard.press("Escape");
  assert.equal((await get(uiA)).players[0].surrenderReason, null);
  await ui.getByRole("button", { name: "投降", exact: true }).click();
  await ui.screenshot({ path: "outputs/surrender-confirm-mobile.png" });
  await ui.getByRole("button", { name: "確認投降", exact: true }).click();
  await ui.getByText("投降測試1已獲勝", { exact: true }).waitFor();
  assert.equal((await get(uiA)).players[0].surrenderReason, "manual");
  assert.deepEqual(errors, []);
  console.log("PASS mobile confirmation, cancel and submit, no page errors");
  await uiContext.close();
} finally {
  db.close();
  await browser.close();
}
