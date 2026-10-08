import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const origin = process.env.TEST_ORIGIN ?? "http://localhost:3100";
const live = process.env.LIVE_ROOM_ENTRY === "1" && origin === "https://yazy-online.jabir95tsai.workers.dev";
assert.ok(live || ["localhost", "127.0.0.1"].includes(new URL(origin).hostname), "Live smoke requires explicit opt-in");
const engines = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const browser = await engines.chromium.launch({ headless: true, channel: "chrome" });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  let roomReads = 0;
  let profileReads = 0;
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && /^\/api\/rooms\/[^/]+$/.test(path)) roomReads++;
    if (path === "/api/profile") profileReads++;
  });
  const stable = async label => {
    // Span a full waiting-room poll. An initialization loop used to generate
    // unbounded room/profile requests and repeatedly replace the session.
    await page.waitForTimeout(5200);
    assert.ok(roomReads <= 4, `${label}: excessive room reads (${roomReads})`);
    assert.ok(profileReads <= 2, `${label}: repeated bootstrap (${profileReads})`);
    assert.deepEqual(errors, []);
    console.log(`PASS ${label}: ${roomReads} room reads, ${profileReads} profile reads`);
    roomReads = 0;
    profileReads = 0;
  };
  await page.goto(origin);
  await page.getByLabel("你想用什麼名字").fill("Entry regression");
  await page.locator("button.primary-action").filter({ hasText: "開一桌" }).click();
  await page.getByRole("button", { name: "再等一個人", exact: true }).waitFor();
  await stable("create table");
  const code = new URL(page.url()).searchParams.get("room");
  assert.ok(code);
  await page.reload();
  await page.getByRole("button", { name: "再等一個人", exact: true }).waitFor();
  await stable("restore saved table");
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  guest.on("pageerror", error => errors.push(error.message));
  await guest.goto(`${origin}/?room=${code}`);
  await guest.getByLabel("你想用什麼名字").fill("Entry guest");
  await guest.getByRole("button", { name: "進去", exact: true }).click();
  await page.getByRole("button", { name: "開始", exact: true }).click();
  await page.locator(".game-grid").waitFor();
  await guest.locator(".game-grid").waitFor();
  assert.deepEqual(errors, []);
  console.log("PASS guest joins and both clients enter the game");
} finally {
  await browser.close();
}
