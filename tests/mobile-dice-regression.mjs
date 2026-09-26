import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { mkdir } from "node:fs/promises";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const origin = process.env.TEST_ORIGIN ?? "http://localhost:3100";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const room = {
    room: { id: "mobile", code: "MOBILE", status: "playing", hostPlayerId: "me", currentSeat: 0,
      round: 1, dice: [1, 2, 3, 4, 5], held: [false, false, false, false, false], rollsUsed: 1,
      turnDeadline: new Date(Date.now() + 90000).toISOString(), updatedAt: new Date().toISOString() },
    players: [{ id: "me", name: "QA", seat: 0 }, { id: "other", name: "QB", seat: 1 }], scores: [],
  };
  let releaseHold;
  let failHold = false;
  let rolls = 0;
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/rooms/MOBILE") return route.fulfill({ json: structuredClone(room) });
    if (path.endsWith("/action")) {
      const body = route.request().postDataJSON();
      if (body.action === "hold") {
        await new Promise(resolve => { releaseHold = resolve; });
        if (failHold) return route.fulfill({ status: 503, json: { error: "Synthetic hold failure" } });
        room.room.held = body.held;
      }
      if (body.action === "roll") {
        rolls++;
        room.room.rollsUsed++;
        room.room.dice = room.room.dice.map((v, i) => room.room.held[i] ? v : 6);
      }
      room.room.updatedAt = new Date(Date.parse(room.room.updatedAt) + 1).toISOString();
      return route.fulfill({ json: { ok: true, updatedAt: room.room.updatedAt } });
    }
    if (path === "/api/history") return route.fulfill({ json: { games: [] } });
    return route.fulfill({ status: 401, json: {} });
  });
  await page.addInitScript(() => {
    localStorage.setItem("yazy-club-sessions", JSON.stringify([{ code: "MOBILE", playerId: "me", token: "synthetic", name: "QA" }]));
    sessionStorage.setItem("yazy-club-active-player:MOBILE", "me");
  });
  await page.goto(`${origin}/?room=MOBILE`);
  const dice = page.locator(".dice-tray .die");
  await dice.first().waitFor();
  await dice.first().tap();
  await page.waitForFunction(() => document.querySelector(".die.held")?.getAttribute("aria-label")?.includes("已保留"));
  await page.waitForTimeout(200);
  assert.equal(await dice.first().evaluate(el => getComputedStyle(el).transform), "matrix(1, 0, 0, 1, 0, -14)");
  await page.getByRole("button", { name: "再擲一次", exact: true }).tap();
  await page.waitForFunction(() => document.querySelectorAll(".die.rolling").length === 4);
  assert.equal(rolls, 0, "Animation must begin before the pending hold completes");
  const before = await dice.nth(1).locator("polygon").first().getAttribute("points");
  await page.waitForTimeout(150);
  assert.notEqual(await dice.nth(1).locator("polygon").first().getAttribute("points"), before);
  assert.ok(releaseHold);
  releaseHold();
  await page.waitForFunction(() => !document.querySelector(".die.rolling"));
  assert.equal(rolls, 1);
  assert.equal(room.room.dice[0], 1);
  assert.match(await dice.nth(1).getAttribute("aria-label"), /骰子 6/);
  console.log("PASS touch hold lift, immediate moving roll during slow hold, authoritative held result");

  failHold = true;
  releaseHold = null;
  await dice.nth(1).tap();
  await page.getByRole("button", { name: "再擲一次", exact: true }).tap();
  await page.waitForFunction(() => Boolean(document.querySelector(".die.rolling")));
  for (let i = 0; i < 50 && !releaseHold; i++) await page.waitForTimeout(20);
  assert.ok(releaseHold);
  releaseHold();
  await page.getByText("鎖骰狀態尚未同步，請再按一次擲骰。", { exact: true }).waitFor();
  assert.equal(await page.locator(".die.rolling").count(), 0);
  assert.equal(rolls, 1, "A failed hold must never submit a roll");
  console.log("PASS failed hold stops optimistic animation without rolling");
  await mkdir("outputs", { recursive: true });
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => innerWidth), width);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `outputs/mobile-dice-${width}.png` });
  }
  assert.deepEqual(errors, []);
  console.log("PASS 320/390/1280 layout, screenshots and no browser errors");
} finally {
  await browser.close();
}
