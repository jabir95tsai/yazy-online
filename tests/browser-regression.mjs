import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { mkdir } from "node:fs/promises";

// Run against a local dev server. PLAYWRIGHT_MODULE may point to a bundled installation.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const origin = process.env.TEST_ORIGIN ?? "http://localhost:3100";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(origin).hostname), "Local tests only");
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
const errors = [];
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.message));
const waitFor = async (fn) => {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Condition timed out");
};
try {
  // Real local Worker/D1: create, join, start, roll, hold, score.
  const post = async (path, data) => {
    const response = await context.request.post(`${origin}${path}`, { data });
    assert.ok(response.ok(), `${path}: HTTP ${response.status()}`);
    return response.json();
  };
  const identity = await post("/api/rooms", { name: "Local QA A" });
  const secondIdentity = await post(`/api/rooms/${identity.code}/join`, { name: "Local QA B" });
  const getRoom = async () => (await context.request.get(`${origin}/api/rooms/${identity.code}`)).json();
  const act = async (action, extra = {}) => post(`/api/rooms/${identity.code}/action`, {
    ...identity, action, expectedUpdatedAt: (await getRoom()).room.updatedAt, ...extra,
  });
  await act("start");
  await act("roll");
  const first = await getRoom();
  await act("hold", { held: [true, false, false, false, false] });
  await act("roll");
  assert.equal((await getRoom()).room.dice[0], first.room.dice[0]);
  await act("score", { category: "chance" });
  assert.equal((await getRoom()).scores.length, 1);
  console.log("PASS local Worker/D1 create/join/start/roll/hold/score");
  const categories = ["ones", "twos", "threes", "fours", "fives", "sixes", "threeKind", "fourKind", "fullHouse", "smallStraight", "largeStraight", "yazy", "chance"];
  for (let turn = 0; turn < 25; turn++) {
    let snapshot = await getRoom();
    if (snapshot.room.status === "finished") break;
    const actor = snapshot.room.currentSeat === 0 ? identity : secondIdentity;
    await post(`/api/rooms/${identity.code}/action`, { ...actor, action: "roll", expectedUpdatedAt: snapshot.room.updatedAt });
    snapshot = await getRoom();
    const category = categories.find((category) => !snapshot.scores.some((score) => score.playerId === actor.playerId && score.category === category));
    await post(`/api/rooms/${identity.code}/action`, { ...actor, action: "score", category, expectedUpdatedAt: snapshot.room.updatedAt });
  }
  assert.equal((await getRoom()).room.status, "finished");
  await post("/api/auth/register", { username: `qa_${Date.now()}`, password: "Synthetic-QA-Only-123", displayName: "QA account", sessions: [identity] });
  const profileResponse = await context.request.get(`${origin}/api/profile`);
  assert.equal(profileResponse.status(), 200);
  const realProfile = await profileResponse.json();
  assert.equal(realProfile.stats.games, 1);
  assert.equal(realProfile.games[0].players.filter((player) => player.isMe).length, 1);
  assert.equal((await context.request.get(`${origin}/api/invites`)).status(), 200);
  await post("/api/auth/logout", {});
  console.log("PASS complete local game, account claim and profile/history/invites queries");

  // Synthetic rooms let the browser regress delayed/failed synchronization deterministically.
  const room = {
    room: { id: "room-a", code: "TESTAA", status: "playing", hostPlayerId: "me", currentSeat: 0,
      round: 1, dice: [1, 2, 3, 4, 5], held: [false, false, false, false, false], rollsUsed: 1,
      turnDeadline: new Date(Date.now() + 90000).toISOString(), createdAt: "2026-09-13T00:00:00.000Z",
      updatedAt: "2026-09-13T00:00:00.001Z", finishedAt: null },
    players: [{ id: "me", name: "QA", seat: 0 }, { id: "other", name: "QB", seat: 1 }], scores: [],
  };
  let version = 1;
  const bump = () => { room.room.updatedAt = new Date(Date.UTC(2026, 8, 13) + ++version).toISOString(); };
  let holds = 0;
  let rolls = 0;
  let failHold = true;
  let releaseHold;
  let releaseRead;
  let delayRead = false;
  let reads = 0;
  let profileStatus = 401;
  let logoutStatus = 503;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (data, status = 200) => route.fulfill({ status, json: data });
    if (path === "/api/profile") {
      if (route.request().method() === "PATCH") return json({ ok: true });
      return profileStatus === 200 ? json({
        user: { id: "account", username: "qa", displayName: "QA account", createdAt: "2026-09-13T00:00:00Z" },
        stats: { games: 0, contested: 0, wins: 0, losses: 0, ties: 0, winRate: 0, bestScore: 0, averageScore: 0, yazy: 0, yazyRate: 0 }, games: [],
      }) : json({ error: "暫時無法讀取" }, profileStatus);
    }
    if (path === "/api/auth/logout") return json({ ok: logoutStatus === 200 }, logoutStatus);
    if (path === "/api/history") return json({ games: [] });
    if (path === "/api/friends") return json({ friends: [], incoming: [], outgoing: [], invites: [] });
    if (path === "/api/rooms/TESTAA") {
      reads++;
      const snapshot = structuredClone(room);
      if (delayRead) { delayRead = false; await new Promise((resolve) => { releaseRead = resolve; }); }
      return json(snapshot);
    }
    if (path.endsWith("/action")) {
      const data = route.request().postDataJSON();
      if (data.action === "hold") {
        holds++;
        if (failHold) {
          await new Promise((resolve) => { releaseHold = resolve; });
          return json({ error: "同步失敗" }, 503);
        }
        room.room.held = data.held;
        bump();
        return json({ ok: true, updatedAt: room.room.updatedAt });
      }
      if (data.action === "roll") { rolls++; room.room.rollsUsed++; bump(); }
      return json({ ok: true });
    }
    return json({ error: "Unexpected fixture request" }, 400);
  });
  await page.addInitScript(() => {
    localStorage.setItem("yazy-club-sessions", JSON.stringify([{ code: "TESTAA", playerId: "me", token: "synthetic", name: "QA" }]));
    sessionStorage.setItem("yazy-club-active-player:TESTAA", "me");
  });
  await page.goto(`${origin}/?room=TESTAA`);
  await page.getByRole("button", { name: "骰子 1，未保留", exact: true }).click();
  await waitFor(() => holds === 1 && releaseHold);
  await page.getByRole("button", { name: "再擲一次", exact: true }).click();
  releaseHold();
  await page.getByText("鎖骰狀態尚未同步，請再按一次擲骰。", { exact: true }).waitFor();
  assert.equal(rolls, 0);
  failHold = false;
  await page.getByRole("button", { name: "再擲一次", exact: true }).click();
  await waitFor(() => rolls === 1);
  assert.equal(room.room.held[0], true);
  console.log("PASS failed in-flight hold blocks roll, retry saves hold first");

  room.room.held = [false, true, false, false, false]; bump();
  await page.getByRole("button", { name: "骰子 2，已保留", exact: true }).waitFor();
  console.log("PASS same-turn remote holds update the active player's UI");
  delayRead = true;
  await waitFor(() => releaseRead);
  const readCount = reads;
  await new Promise((resolve) => setTimeout(resolve, 1800));
  assert.equal(reads, readCount, "Polling must not overlap a slow read");
  await page.getByRole("button", { name: "回到首頁", exact: true }).click();
  releaseRead();
  await page.getByRole("heading", { name: "yazy battle!" }).waitFor();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(await page.locator(".game-grid").count(), 0);
  console.log("PASS slow polling is serialized and leaving invalidates old room reads");

  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.getByRole("dialog", { name: "設定" }).waitFor();
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest("dialog"))), true);
  await mkdir("outputs", { recursive: true });
  await page.screenshot({ path: "outputs/review-mobile-dialog.png" });
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(await page.getByRole("button", { name: "設定", exact: true }).evaluate((el) => el === document.activeElement), true);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const sizes = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(sizes.scroll <= sizes.width, `Overflow at ${width}`);
  }
  await page.screenshot({ path: "outputs/review-desktop.png" });
  profileStatus = 200;
  await page.goto(origin);
  await page.getByRole("button", { name: "QA account", exact: true }).click();
  profileStatus = 503;
  await page.getByRole("dialog", { name: "個人資料" }).getByRole("textbox").fill("Updated QA");
  await page.getByRole("button", { name: "儲存個人資料", exact: true }).click();
  await page.getByText("連線失敗，請再試一次。", { exact: true }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "QA account", exact: true }).count(), 1);
  await page.getByRole("button", { name: "登出", exact: true }).click();
  await page.getByText("尚未成功登出，請再試一次。", { exact: true }).waitFor();
  logoutStatus = 200;
  await page.getByRole("button", { name: "登出", exact: true }).click();
  await page.locator(".account-trigger").filter({ hasText: "登入" }).waitFor();
  console.log("PASS profile 503 preserves account; logout requires server success");
  assert.deepEqual(errors, []);
  console.log("PASS dialog keyboard/focus, 320/390/1280 widths, no page errors");
} finally { await browser.close(); }
