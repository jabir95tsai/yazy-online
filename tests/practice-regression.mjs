import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { mkdir } from "node:fs/promises";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const origin = process.env.TEST_ORIGIN ?? "http://localhost:3100";
const live = process.env.LIVE_PRACTICE === "1" && origin === "https://yazy-online.jabir95tsai.workers.dev";
assert.ok(live || ["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  const roomRequests = [];
  if (live) await page.route("**/api/rooms**", route => route.abort());
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.url().includes("/api/rooms")) roomRequests.push(request.url()); });
  await page.goto(origin);
  await page.getByRole("button", { name: "測試模式", exact: true }).tap();
  await page.locator(".practice-label").waitFor();
  assert.equal(await page.locator(".concession-panel").count(), 0);
  const roll = async () => {
    await page.locator(".roll-button").tap();
    await page.waitForFunction(() => !document.querySelector(".die.rolling") && document.querySelectorAll("button.score-row").length > 0);
  };
  await roll();
  const die = page.locator(".dice-tray .die").first();
  const firstValue = (await die.getAttribute("aria-label")).match(/骰子 (\d)/)[1];
  await die.tap();
  assert.match(await die.getAttribute("aria-label"), /已保留/);
  await roll();
  assert.match(await die.getAttribute("aria-label"), new RegExp(`骰子 ${firstValue}，已保留`));
  await roll();
  assert.equal(await page.locator(".roll-button").count(), 0);
  await page.locator("button.score-row").first().tap();
  assert.match(await page.locator(".round-label").innerText(), /第 2/);
  assert.equal(await page.locator(".die.held").count(), 0);
  console.log("PASS solo entry, hold preserves result, three-roll limit, score advances turn");
  await mkdir("outputs", { recursive: true });
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => innerWidth), width);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `outputs/${live ? "live-" : ""}practice-${width}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "看全部 13 格", exact: true }).tap();
  for (let round = 2; round <= 13; round++) {
    await roll();
    await page.locator("button.score-row").first().tap();
  }
  await page.getByRole("heading", { name: "這局結束了", exact: true }).waitFor();
  await page.getByText("練習完成，本局不計入戰績。", { exact: true }).waitFor();
  await page.getByRole("button", { name: "再開一局", exact: true }).tap();
  assert.match(await page.locator(".round-label").innerText(), /第 1/);
  assert.equal(await page.locator(".score-row.scored").count(), 0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.locator(".roll-button").tap();
  await page.getByRole("button", { name: "牌桌選項", exact: true }).tap();
  await page.getByRole("menuitem", { name: "重新開始練習", exact: true }).tap();
  assert.equal(await page.locator(".die.rolling").count(), 0);
  await page.getByRole("button", { name: "回到首頁", exact: true }).tap();
  await page.getByRole("button", { name: "測試模式", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => (localStorage.getItem("yazy-club-sessions") ?? "").includes("practice")), false);
  assert.deepEqual(roomRequests, []);
  assert.deepEqual(errors, []);
  console.log("PASS complete 13 rounds, restart, reset mid-animation, exit, no room API or saved identity");
} finally { await browser.close(); }
