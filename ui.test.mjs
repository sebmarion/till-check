// Browser regressions for the daily close. Every test gets its own database.
import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { startFixture } from "./test-support.mjs";
const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require(
    process.env.PLAYWRIGHT_MODULE ||
      "/home/seb/projects/hermes-agent/node_modules/playwright",
  );
}
const { chromium } = playwright;
let browser, fx, context, page, errors;
const DAY = "2025-06-02";
function executable() {
  if (existsSync(chromium.executablePath())) return chromium.executablePath();
  const root = join(homedir(), ".cache/ms-playwright");
  for (const dir of readdirSync(root)
    .filter((d) => d.startsWith("chromium-"))
    .sort()
    .reverse()) {
    const file = join(root, dir, "chrome-linux64", "chrome");
    if (existsSync(file)) return file;
  }
  throw new Error("Install a browser with: npx playwright install chromium");
}
before(async () => {
  browser = await chromium.launch({
    executablePath: executable(),
    args: ["--no-sandbox"],
  });
});
after(async () => {
  await browser?.close();
});
beforeEach(async () => {
  fx = await startFixture();
  await fx.request("POST", "/api/opening", {
    date: "2025-06-01",
    opening: "300",
  });
  context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    timezoneId: "America/Los_Angeles",
  });
  page = await context.newPage();
  page.setDefaultTimeout(7000);
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  await go();
});
afterEach(async () => {
  await context?.close();
  await fx?.close();
  assert.deepEqual(errors, [], "No browser errors");
});
async function go(date = DAY, prefix = "/") {
  await page.goto(fx.base + prefix + "?date=" + date, {
    waitUntil: "networkidle",
  });
  await page.waitForFunction(
    () => document.querySelector("#connection").textContent === "Connected",
  );
}
async function total(value = "300") {
  await page.click("#totalMode");
  await page.fill("#actual", value);
}
async function saveCount() {
  const response = page.waitForResponse(
    (r) =>
      r.url().includes("/api/entry") &&
      ["POST", "PATCH"].includes(r.request().method()),
  );
  await page.click("#checkBtn");
  if (await page.locator("#actionDialog").isVisible())
    await page.click("#dialogAccept");
  const res = await response;
  assert.equal(res.status(), 200, await res.text());
  await page.waitForFunction(
    () =>
      !document
        .querySelector("#saveStatus")
        .textContent.includes("Draft on this device"),
  );
}
async function stored(date = DAY) {
  return (await fx.request("GET", "/api/entry/" + date)).data;
}
async function confirmCount() {
  await page.click("#checkBtn");
  await page.locator("#actionDialog").waitFor();
  const response = page.waitForResponse((r) =>
    r.url().endsWith("/api/confirm"),
  );
  await page.click("#dialogAccept");
  assert.equal((await response).status(), 200);
  await page.waitForFunction(() =>
    document.querySelector("#saveStatus").textContent.startsWith("Confirmed"),
  );
}
test("initial count is empty, not silently zero or stuck saving", async () => {
  assert.equal(await page.locator("#stickyTotal").innerText(), "—");
  assert.equal(await page.locator("#checkBtn").innerText(), "Save & check →");
  assert.equal(await page.locator("#expectedNow").innerText(), "€300.00");
  assert.equal(await page.locator("#confirmBtn").isVisible(), false);
});
test("all euro denominations are accessible and small coins contribute exactly", async () => {
  assert.equal(await page.locator("[data-denom]").count(), 15);
  await page.fill('[data-denom="50"]', "6");
  await page.fill('[data-denom="0.01"]', "1");
  assert.equal(await page.locator("#stickyTotal").innerText(), "€300.01");
  assert.match(await page.locator("#resultTitle").innerText(), /0.01 extra/);
});
test("empty form cannot save; explicitly empty drawer can", async () => {
  await page.click("#checkBtn");
  assert.match(await page.locator("#errorText").innerText(), /Enter a count/);
  assert.equal(
    (await fx.request("GET", "/api/history")).data.entries.length,
    0,
  );
  await page.click("#emptyDrawer");
  await saveCount();
  assert.equal((await stored()).actual, "0.00");
});
test("comma decimals save exactly and card omission is not a full match", async () => {
  await total("299,99");
  await saveCount();
  assert.equal((await stored()).actual, "299.99");
  assert.equal((await stored()).cardMatches, null);
  assert.match(
    await page.locator("#paymentCheck").innerText(),
    /Card not checked/,
  );
});
for (const value of ["-1", "12.345", "hello", "1e2"])
  test("invalid total stays unsaved: " + value, async () => {
    await total(value);
    await page.click("#checkBtn");
    assert.equal(await page.locator("#error").isVisible(), true);
    assert.equal(
      (await fx.request("GET", "/api/history")).data.entries.length,
      0,
    );
  });
test("fractional banknote counts are rejected instead of rounded", async () => {
  await page.fill('[data-denom="50"]', "2.9");
  await page.click("#checkBtn");
  assert.match(await page.locator("#errorText").innerText(), /whole number/);
});
test("save and confirm persist closing withdrawal and opening balance", async () => {
  await total();
  await page.fill("#takeout", "80");
  await saveCount();
  await confirmCount();
  const entry = await stored();
  assert.equal(entry.confirmed, true);
  assert.equal(entry.takeout, "80.00");
  assert.equal(
    (await fx.request("GET", "/api/state")).data.openingCash,
    "220.00",
  );
  assert.equal(await page.locator("#checkBtn").isDisabled(), true);
});
test("editing after save invalidates confirmation until saved again", async () => {
  await total();
  await saveCount();
  await page.fill("#actual", "295");
  assert.equal(await page.locator("#confirmBtn").isVisible(), false);
  assert.match(await page.locator("#checkBtn").innerText(), /Save changes/);
  assert.equal((await stored()).actual, "300.00");
});
test("date arrows navigate without moving or copying the saved entry", async () => {
  await total();
  await saveCount();
  await page.click("#nextDay");
  await page.waitForFunction(
    () => document.querySelector("#entryDate").value === "2025-06-03",
  );
  assert.equal(await page.locator("#stickyTotal").innerText(), "—");
  const history = (await fx.request("GET", "/api/history")).data.entries;
  assert.equal(history.length, 1);
  assert.equal(history[0].date, DAY);
  await page.click("#previousDay");
  await page.waitForFunction(
    () => document.querySelector("#actual").value === "300.00",
  );
});
test("an unsaved draft survives reload and must be explicitly restored", async () => {
  await total("285,50");
  await go();
  assert.equal(await page.locator("#draftBanner").isVisible(), true);
  await page.click("#restoreDraft");
  assert.equal(await page.locator("#actual").inputValue(), "285,50");
  assert.equal(
    (await fx.request("GET", "/api/history")).data.entries.length,
    0,
  );
});
test("network failure preserves form and recoverable local draft", async () => {
  await total("278");
  await page.route("**/api/entry", (route) => route.abort());
  await page.click("#checkBtn");
  await page.locator("#error").waitFor();
  assert.equal(await page.locator("#actual").inputValue(), "278");
  await page.unroute("**/api/entry");
  await go();
  await page.click("#restoreDraft");
  await saveCount();
  assert.equal((await stored()).actual, "278.00");
});
test("another tab cannot be silently overwritten by a stale form", async () => {
  await total();
  await saveCount();
  await page.fill("#actual", "280");
  await fx.request("PATCH", "/api/entry/" + DAY, { actual: "290" });
  await page.click("#checkBtn");
  await page.locator("#error").waitFor();
  assert.match(await page.locator("#errorText").innerText(), /another tab/);
  assert.equal((await stored()).actual, "290.00");
  assert.equal(await page.locator("#actual").inputValue(), "280");
});
test("confirmed entry reloads its actual values and corrections require a dialog", async () => {
  await total();
  await saveCount();
  await confirmCount();
  await go();
  assert.equal(await page.locator("#actual").inputValue(), "300.00");
  await page.fill("#actual", "310");
  await page.click("#checkBtn");
  await page.locator("#actionDialog").waitFor();
  await page.click("#dialogCancel");
  assert.equal((await stored()).actual, "300.00");
  await saveCount();
  assert.equal((await stored()).actual, "310.00");
});
test("multiple movement rows use exact cents and removal updates the preview", async () => {
  await total("300");
  await page.locator("#adjustments summary").click();
  await page.fill("#expense", "10,25");
  await page.click("#addExpense");
  await page.locator("#extraExpenses input").fill("2,35");
  assert.equal(await page.locator("#expectedNow").innerText(), "€287.40");
  await page.locator("#extraExpenses button").click();
  assert.equal(await page.locator("#expectedNow").innerText(), "€289.75");
  await saveCount();
  assert.equal((await stored()).expense, "10.25");
});
test("card tip cash and explicit extra-to-POS setting produce a full match", async () => {
  await total("290");
  await page.fill("#card", "100");
  await page.fill("#cardBilled", "110");
  await page.locator("#adjustments summary").click();
  await page.click("#addCardCash");
  await page.locator(".tip-amount").fill("10");
  await page.check("#tipsOutsidePos");
  assert.match(await page.locator("#paymentCheck").innerText(), /Card matches/);
  await saveCount();
  assert.equal((await stored()).overallMatches, true);
  await go();
  assert.equal(await page.locator(".tip-amount").inputValue(), "10.00");
});
test("history deletion requires consent and offers working undo", async () => {
  await total();
  await saveCount();
  await page.click("#historyTab");
  await page.locator(".history-row").waitFor();
  await page
    .getByRole("button", { name: "Delete " + DAY, exact: true })
    .click();
  await page.locator("#actionDialog").waitFor();
  await page.click("#dialogAccept");
  await page.getByRole("button", { name: "Undo", exact: true }).waitFor();
  assert.equal(
    (await fx.request("GET", "/api/history")).data.entries.length,
    0,
  );
  await page.click("#noticeAction");
  await page.locator(".history-row").waitFor();
  assert.equal((await stored()).actual, "300.00");
});
test("date uses Barcelona calendar even when browser is in another timezone", async () => {
  assert.equal(await page.locator("#dayCalendar").innerText(), "2 June 2025");
  const data = (await fx.request("GET", "/api/state")).data;
  assert.equal(
    await page.locator("#entryDate").getAttribute("max"),
    data.today,
  );
});
for (const width of [320, 390, 768, 1440])
  test(
    "layout fits " + width + "px and primary action stays reachable",
    async () => {
      await page.setViewportSize({ width, height: 900 });
      const metrics = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
        labels: [...document.querySelectorAll("input")]
          .filter(
            (el) =>
              el.offsetParent &&
              !el.labels.length &&
              !el.getAttribute("aria-label"),
          )
          .map((el) => el.id),
        button: document
          .querySelector("#checkBtn")
          .getBoundingClientRect()
          .toJSON(),
      }));
      assert.ok(metrics.scroll <= metrics.width, "No horizontal overflow");
      assert.deepEqual(metrics.labels, []);
      assert.ok(metrics.button.width >= 44 && metrics.button.height >= 44);
      if (width < 740)
        assert.ok(
          metrics.button.bottom <= 900 && metrics.button.top >= 0,
          "Sticky action visible",
        );
    },
  );
test("subpath deployment serves scripts and saves to the correct API", async () => {
  await go(DAY, "/till/");
  await total("310");
  await saveCount();
  assert.equal((await stored()).actual, "310.00");
});
test("first run requests opening instead of pretending zero is known", async () => {
  await fx.close();
  fx = await startFixture();
  await go();
  assert.equal(await page.locator("#setup").isVisible(), true);
  assert.equal(await page.locator("#entryCard").isVisible(), false);
  await page.click("#unknownOpening");
  await total("180");
  assert.match(
    await page.locator("#resultTitle").innerText(),
    /Starting balance/,
  );
  await saveCount();
  assert.equal((await stored()).baselineOnly, true);
});
test("half-entered card check cannot be saved as a misleading match", async () => {
  await total("300");
  await page.fill("#cardBilled", "0");
  await page.click("#checkBtn");
  assert.match(
    await page.locator("#errorText").innerText(),
    /both card totals/,
  );
  assert.equal(
    (await fx.request("GET", "/api/history")).data.entries.length,
    0,
  );
});
