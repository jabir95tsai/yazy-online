import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

// A swiped-away tab loses sessionStorage but keeps localStorage. Opening the
// bare landing page must still offer a way back to the unfinished table.
const origin = process.env.TEST_ORIGIN ?? "http://localhost:3100";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname), "Local tests only");
const engines = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const browser = process.env.TEST_BROWSER === "webkit"
  ? await engines.webkit.launch({ headless: true })
  : await engines.chromium.launch({ headless: true, channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
try {
  const olderResponse = await context.request.post(`${origin}/api/rooms`, { data: { name: "較早的房主" } });
  assert.ok(olderResponse.ok());
  const older = { ...await olderResponse.json(), name: "較早的房主" };
  const created = await context.request.post(`${origin}/api/rooms`, { data: { name: "斷線房主" } });
  assert.ok(created.ok());
  const host = { ...await created.json(), name: "斷線房主" };
  const stale = { code: "ZZZZZZ", playerId: "ghost", token: "synthetic", name: "幽靈" };

  const page = await context.newPage();
  await page.addInitScript((sessions) => {
    if (!localStorage.getItem("yazy-club-sessions")) {
      localStorage.setItem("yazy-club-sessions", JSON.stringify(sessions));
    }
  }, [stale, older, host]);
  await page.goto(origin);
  await page.getByRole("button", { name: "回到這桌" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "回到這桌" }).count(), 1, "only the most recent active room is offered");
  assert.equal(await page.locator(".resume-note").filter({ hasText: older.code }).count(), 0);
  await page.getByText("共 1 人").waitFor();
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("yazy-club-sessions")));
  assert.deepEqual(kept.map((item) => item.code), [older.code, host.code], "dead room is forgotten while valid identities remain available");

  await page.getByRole("button", { name: "回到這桌" }).click();
  await page.waitForURL(`**/?room=${host.code}`);
  assert.equal(await page.getByRole("button", { name: "回到這桌" }).count(), 0);
  console.log("rejoin regression ok");
} finally {
  await browser.close();
}
