import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { startFixture } from "./test-support.mjs";
let fx;
beforeEach(async () => {
  fx = await startFixture();
});
afterEach(async () => {
  await fx?.close();
});
const post = (path, body, headers) =>
  fx.request("POST", "/api/" + path, body, headers);
const get = (path) => fx.request("GET", "/api/" + path);
const patch = (date, body, headers) =>
  fx.request("PATCH", "/api/entry/" + date, body, headers);
const DAY = "2025-06-01",
  NEXT = "2025-06-02";
async function seed() {
  await post("entry", { date: DAY, opening: "100", actual: "150" });
  await post("confirm", { date: DAY, takeout: "50" });
}
test("GET state is read-only and does not invent an opening", async () => {
  const first = await get("state");
  const second = await get("state");
  assert.equal(first.data.hasOpening, false);
  assert.equal(second.data.revision, 0);
  const db = new DatabaseSync(join(fx.dir, "test.sqlite"));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM state").get().n, 0);
  db.close();
});
test("confirmation persists a fresh withdrawal and survives a repeat confirmation", async () => {
  await seed();
  assert.equal((await get("entry/" + DAY)).data.takeout, "50.00");
  assert.equal(
    (await post("confirm", { date: DAY })).data.openingCash,
    "100.00",
  );
});
test("editing a confirmed count updates its carry forward and dependent day", async () => {
  await seed();
  await post("entry", { date: NEXT, actual: "100" });
  await patch(DAY, { actual: "170" });
  assert.equal((await get("state")).data.openingCash, "120.00");
  const next = (await get("entry/" + NEXT)).data;
  assert.equal(next.opening, "120.00");
  assert.equal(next.variance, "-20.00");
});
test("POST on a confirmed date keeps confirmation and updates baseline", async () => {
  await seed();
  const changed = await post("entry", { date: DAY, actual: "180" });
  assert.equal(changed.data.confirmed, true);
  assert.equal((await get("state")).data.openingCash, "130.00");
});
test("a total correction clears obsolete denominations; later note edits preserve it", async () => {
  await post("entry", { date: DAY, opening: "100", denominations: { 50: 2 } });
  const changed = await patch(DAY, { actual: "95" });
  assert.equal(changed.data.actual, "95.00");
  assert.equal(changed.data.denominations, null);
  assert.equal(
    (await patch(DAY, { declared: "recounted" })).data.actual,
    "95.00",
  );
});
test("empty denomination object explicitly zeros a saved count", async () => {
  await post("entry", { date: DAY, opening: "0", actual: "40" });
  assert.equal((await patch(DAY, { denominations: {} })).data.actual, "0.00");
});
test("tip-only records round trip with their receipt metadata intact", async () => {
  await post("entry", {
    date: DAY,
    actual: "90",
    opening: "100",
    cardCashTransactions: [
      { cashGiven: "10", time: "14:00", reference: "TIP-3" },
    ],
  });
  const changed = await patch(DAY, { declared: "checked" });
  assert.equal(changed.status, 200);
  assert.equal(changed.data.cardCashTransactions[0].reference, "TIP-3");
  assert.equal(changed.data.cardCashTransactions[0].time, "14:00");
});
test("card tips excluded from POS are reconciled only when explicitly selected", async () => {
  const body = {
    date: DAY,
    actual: "90",
    opening: "100",
    posCardSales: "100",
    cardBilled: "110",
    cardCashTransactions: [{ cashGiven: "10" }],
  };
  assert.equal((await post("entry", body)).data.cardVariance, "10.00");
  const changed = await patch(DAY, { tipsOutsidePos: true });
  assert.equal(changed.data.cardVariance, "0.00");
  assert.equal(changed.data.overallMatches, true);
});
test("optimistic lock refuses stale writes without changing the entry or audit", async () => {
  await seed();
  const before = await get("state");
  await patch(DAY, { declared: "newer" });
  const stale = await patch(
    DAY,
    { declared: "stale" },
    { "If-Match": String(before.data.revision) },
  );
  assert.equal(stale.status, 409);
  assert.equal((await get("entry/" + DAY)).data.declared, "newer");
  assert.equal((await get("state")).data.revision, before.data.revision + 1);
});
test("moving a day applies edits atomically and occupied targets never overwrite", async () => {
  await seed();
  const result = await post("entry/" + DAY + "/move", {
    date: NEXT,
    actual: "190",
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.actual, "190.00");
  assert.equal((await get("entry/" + DAY)).status, 404);
  await post("entry", { date: DAY, actual: "10" });
  assert.equal(
    (await post("entry/" + NEXT + "/move", { date: DAY })).status,
    409,
  );
  assert.equal((await get("entry/" + NEXT)).data.actual, "190.00");
});
test("delete can be undone exactly, until another ledger write occurs", async () => {
  await seed();
  const removed = await fx.request("DELETE", "/api/entry/" + DAY);
  assert.equal((await get("entry/" + DAY)).status, 404);
  const restored = await post("undo", { auditId: removed.data.auditId });
  assert.equal(restored.status, 200);
  assert.equal((await get("entry/" + DAY)).data.takeout, "50.00");
  assert.equal((await get("state")).data.openingCash, "100.00");
  assert.equal(
    (await post("undo", { auditId: removed.data.auditId })).status,
    409,
  );
});
for (const body of [
  { date: "2025-02-30", actual: "1" },
  { date: "2099-01-01", actual: "1" },
  { date: DAY },
  { date: DAY, actual: "-1" },
  { date: DAY, actual: "1", takeout: "2" },
  { date: DAY, denominations: { 50: 1.2 } },
  { date: DAY, denominations: { 99: 2 } },
  { date: DAY, denominations: [] },
  { date: DAY, actual: "12.345" },
  null,
  [],
])
  test(
    "invalid entry is rejected atomically: " + JSON.stringify(body),
    async () => {
      const result = await post("entry", body);
      assert.equal(result.status, 400);
      assert.equal((await get("history")).data.entries.length, 0);
      assert.equal((await get("state")).data.revision, 0);
    },
  );
test("cross-site mutations are blocked", async () => {
  const result = await post(
    "opening",
    { opening: "100" },
    { Origin: "https://untrusted.invalid" },
  );
  assert.equal(result.status, 403);
  assert.equal((await get("state")).data.hasOpening, false);
});
test("all euro denominations, subpath assets and export remain available", async () => {
  const denoms = (await get("denominations")).data.denominations;
  assert.equal(denoms.length, 15);
  await post("entry", {
    date: DAY,
    opening: "0",
    denominations: { 100: 1, 0.05: 1, 0.02: 1, 0.01: 1 },
  });
  assert.equal((await get("entry/" + DAY)).data.actual, "100.08");
  for (const path of [
    "/till/",
    "/till/app.js",
    "/till/styles.css",
    "/till/health",
  ])
    assert.equal((await fetch(fx.base + path)).status, 200);
  const csv = await fetch(fx.base + "/api/export.csv");
  assert.match(await csv.text(), /100.08/);
});
test("history pagination does not repeat or hide entries", async () => {
  for (let i = 1; i <= 5; i++)
    await post("entry", { date: "2025-05-0" + i, actual: "0", opening: "0" });
  const first = (await get("history?limit=3")).data;
  assert.equal(first.entries.length, 3);
  assert.equal(first.hasMore, true);
  const second = (
    await get("history?limit=3&before=" + first.entries.at(-1).date)
  ).data;
  assert.equal(second.entries.length, 2);
  assert.equal(second.hasMore, false);
});

test('latest saved physical count carries forward even when unconfirmed', async () => {
  await post('entry', { date: DAY, opening: '100', actual: '125' })
  const next = await post('entry', { date: NEXT, actual: '125' })
  assert.equal(next.data.opening, '125.00')
  assert.equal(next.data.variance, '0.00')
  const state = await get('state?date=' + NEXT)
  assert.equal(state.data.openingSource.date, DAY)
  assert.equal(state.data.openingSource.confirmed, false)
  assert.equal(state.data.openingSource.provisional, true)
})

test('editing an unconfirmed physical count cascades into later openings', async () => {
  await post('entry', { date: DAY, opening: '100', actual: '125' })
  await post('entry', { date: NEXT, actual: '125' })
  await patch(DAY, { actual: '130' })
  const next = await get('entry/' + NEXT)
  assert.equal(next.data.opening, '130.00')
  assert.equal(next.data.variance, '-5.00')
})
