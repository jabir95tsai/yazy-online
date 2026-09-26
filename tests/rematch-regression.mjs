import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const origin = process.env.TEST_ORIGIN ?? "http://localhost:3100";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname), "Local tests only");
const engines = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const browser = process.env.TEST_BROWSER === "webkit"
  ? await engines.webkit.launch({ headless: true })
  : await engines.chromium.launch({ headless: true, channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
const errors = [];
const post = async (path, data, expected = 200) => {
  const response = await context.request.post(`${origin}${path}`, { data });
  assert.ok(expected === 200 ? response.ok() : response.status() === expected, `${path}: HTTP ${response.status()}`);
  return response.json();
};
try {
  await post("/api/auth/register", {
    username: `rematch_${Date.now()}`, displayName: "重開房主",
    password: "Synthetic-rematch-test-2026!",
  });
  const host = { ...await post("/api/rooms", { name: "重開房主" }), name: "重開房主" };
  const guestContext = await browser.newContext();
  const joined = await guestContext.request.post(`${origin}/api/rooms/${host.code}/join`, { data: { name: "重開玩家" } });
  assert.ok(joined.ok());
  const guest = { ...await joined.json(), name: "重開玩家" };
  const get = async () => (await context.request.get(`${origin}/api/rooms/${host.code}`)).json();
  const act = async (identity, action, extra = {}, expected = 200) => post(`/api/rooms/${host.code}/action`, {
    ...identity, action, expectedUpdatedAt: (await get()).room.updatedAt, ...extra,
  }, expected);
  await act(host, "restart", {}, 409);
  await act(host, "start");
  await act(host, "restart", {}, 409);
  await act(host, "roll");
  await act(host, "score", { category: "chance" });
  await act(guest, "surrender");
  await act(host, "finish");
  const before = await get();
  await act(guest, "restart", {}, 403);
  await act(host, "restart", { token: "invalid" }, 401);
  const pages = [];
  for (const identity of [host, guest]) {
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && /RangeError|TypeError|React component/.test(message.text())) errors.push(message.text());
    });
    await page.addInitScript((session) => {
      localStorage.setItem("yazy-club-sessions", JSON.stringify([session]));
      sessionStorage.setItem(`yazy-club-active-player:${session.code}`, session.playerId);
    }, identity);
    await page.goto(`${origin}/?room=${host.code}`);
    await page.getByRole("heading", { name: "這局結束了" }).waitFor();
    pages.push(page);
  }
  assert.equal(await pages[1].getByRole("button", { name: "再開一局", exact: true }).count(), 0);
  await pages[0].getByRole("button", { name: "再開一局", exact: true }).click();
  for (const page of pages) {
    await page.getByRole("heading", { name: "這局結束了" }).waitFor({ state: "hidden", timeout: 15000 });
    await page.locator(".game-grid").waitFor({ state: "visible" });
    assert.ok(page.url().includes(host.code));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  const after = await get();
  assert.equal(after.room.code, before.room.code);
  assert.equal(after.room.hostPlayerId, host.playerId);
  assert.equal(after.room.status, "playing");
  assert.equal(after.room.round, 1);
  assert.equal(after.room.currentSeat, 0);
  assert.equal(after.room.rollsUsed, 0);
  assert.deepEqual(after.room.dice, []);
  assert.deepEqual(after.room.held, [false, false, false, false, false]);
  assert.deepEqual(after.scores, []);
  assert.deepEqual(after.players.map((p) => p.id), before.players.map((p) => p.id));
  assert.ok(after.players.every((p) => p.surrenderReason === null));
  const history = await post("/api/history", { sessions: [host] });
  assert.equal(history.games.length, 1);
  assert.equal(history.games[0].players.find((p) => p.isMe).scores[0].score, before.scores[0].score);
  await act(host, "roll");
  await act(host, "score", { category: "chance" });
  await act(guest, "surrender");
  await act(host, "finish");
  const finished = await get();
  const responses = await Promise.all([1, 2].map(() => context.request.post(`${origin}/api/rooms/${host.code}/action`, {
    data: { ...host, action: "restart", expectedUpdatedAt: finished.room.updatedAt },
  })));
  assert.deepEqual(responses.map((r) => r.status()).sort(), [200, 409]);
  assert.equal((await post("/api/history", { sessions: [host] })).games.length, 2);
  const profile = await (await context.request.get(`${origin}/api/profile`)).json();
  assert.equal(profile.games.length, 2, "Account history retains both finished games while the next is playing");
  await pages[0].goto(origin);
  await pages[0].getByRole("heading", { name: "yazy battle!", exact: true }).waitFor();
  // Wait for async history rendering too: the empty homepage shell alone did
  // not catch WebKit's crash when it formatted the saved game timestamps.
  await pages[0].waitForFunction(() => document.body.innerText.includes("月") && document.body.innerText.includes("日"));
  assert.ok((await pages[0].locator("main").innerText()).length > 100);
  assert.deepEqual(errors, []);
  console.log("PASS same-room rematch, both mobile clients, credentials, host-only, resets, history and concurrent restart");
} finally {
  await browser.close();
}
