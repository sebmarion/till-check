// Deterministic acceptance test for the Till Check reconciliation model.
// Run with: node --test  (or: node --test reconcile.test.mjs)
//
// Acceptance sequence (from the BestPlan envelope):
//   baseline 500
//   -> day1: cash_removed 100, card_transfer 50, actual 390
//            => expected 400, variance -10 (short)
//   -> declare "lost 10" + confirm  => books 390
//   -> day2: actual 390, no moves
//            => expected 390, variance 0 (balanced)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  eurosToCents,
  centsToEuros,
  reconcileDay,
  denominationsToCents,
  DENOMINATIONS,
  STATUS,
  statusForCents,
} from "./reconcile.mjs";

test("eurosToCents parses euros into integer cents (incl. European comma)", () => {
  assert.equal(eurosToCents(500), 50000);
  assert.equal(eurosToCents("500"), 50000);
  assert.equal(eurosToCents("12.50"), 1250);
  assert.equal(eurosToCents("12,50"), 1250);
  assert.equal(eurosToCents("-3.25"), -325);
  assert.equal(eurosToCents(""), 0);
  assert.equal(eurosToCents(null), 0);
  assert.equal(eurosToCents(undefined), 0);
  assert.equal(eurosToCents("0.01"), 1);
  assert.equal(eurosToCents("0.99"), 99);
  assert.throws(() => eurosToCents("abc"));
  assert.throws(() => eurosToCents("1.234"));
});

test("centsToEuros round-trips", () => {
  assert.equal(centsToEuros(50000), "500.00");
  assert.equal(centsToEuros(1250), "12.50");
  assert.equal(centsToEuros(-325), "-3.25");
  assert.equal(centsToEuros(0), "0.00");
});

test("acceptance: day1 short 10, confirm carries forward, day2 balanced", () => {
  // Opening cash: €500 carried from yesterday.
  const OPENING_DAY1 = eurosToCents("500");
  assert.equal(OPENING_DAY1, 50000);

  // Day 1: operator removes €100 cash during the shift, card transfer of €50,
  // counts €390.
  const day1 = reconcileDay(
    {
      actual: "390",
      cashRemoved: "100",
      cashAdded: 0,
      cardTransfer: "50",
      declared: "",
    },
    OPENING_DAY1,
  );
  assert.equal(day1.expectedCents, 40000, "day1 expected should be 400.00");
  assert.equal(day1.actualCents, 39000, "day1 actual should be 390.00");
  assert.equal(
    day1.varianceCents,
    -1000,
    "day1 variance should be -10.00 (short)",
  );
  assert.equal(day1.status, STATUS.SHORT, "day1 should be short");
  // Card transfer is logged but must not touch the till-cash expected.
  assert.equal(day1.cardCents, 5000, "card transfer recorded");
  assert.equal(day1.nextOpeningCents, 39000, "confirm carries actual forward");

  // Operator declares the €10 missing (lost) and confirms the day.
  // Tomorrow's opening cash is the count: €390.
  const OPENING_DAY2 = day1.nextOpeningCents;
  assert.equal(OPENING_DAY2, 39000);

  // Day 2: no moves, count is €390.
  const day2 = reconcileDay(
    { actual: "390", cashRemoved: 0, cashAdded: 0 },
    OPENING_DAY2,
  );
  assert.equal(day2.expectedCents, 39000, "day2 expected should be 390.00");
  assert.equal(day2.varianceCents, 0, "day2 variance should be 0");
  assert.equal(day2.status, STATUS.BALANCED, "day2 should be balanced");
});

test("card-extra-for-cash transactions reduce cash target and preserve each transaction", () => {
  const result = reconcileDay(
    {
      actual: "380",
      cardCashTransactions: [
        {
          cardCharged: "110",
          cashGiven: "100",
          time: "14:30",
          reference: "T-001",
        },
        {
          cardCharged: "55",
          cashGiven: "50",
          time: "15:05",
          reference: "T-002",
        },
      ],
    },
    50000,
  );

  // Cash handed out is the only part that leaves the drawer. The card amount
  // stays outside the cash target; the €15 difference is recorded separately.
  assert.equal(result.expectedCents, 35000);
  assert.equal(result.varianceCents, 3000);
  assert.equal(result.cardCashGivenCents, 15000);
  assert.equal(result.cardCashExtraCents, 1500);
  assert.deepEqual(result.cardCashTransactions, [
    {
      cardChargedCents: 11000,
      cashGivenCents: 10000,
      extraCents: 1000,
      cardChargeProvided: true,
      time: "14:30",
      reference: "T-001",
    },
    {
      cardChargedCents: 5500,
      cashGivenCents: 5000,
      extraCents: 500,
      cardChargeProvided: true,
      time: "15:05",
      reference: "T-002",
    },
  ]);
});

test("card-extra-for-cash accepts a tip amount without card charged", () => {
  const result = reconcileDay(
    { actual: "400", cardCashTransactions: [{ cashGiven: "100" }] },
    50000,
  );
  assert.equal(result.expectedCents, 40000);
  assert.equal(result.cardCashGivenCents, 10000);
  assert.equal(result.cardCashExtraCents, 0);
  assert.deepEqual(result.cardCashTransactions, [
    {
      cardChargedCents: 10000,
      cashGivenCents: 10000,
      extraCents: 0,
      cardChargeProvided: false,
      time: "",
      reference: "",
    },
  ]);
});

test("card-extra-for-cash transactions reject missing tip or a smaller card charge", () => {
  assert.throws(
    () =>
      reconcileDay(
        { actual: "500", cardCashTransactions: [{ cardCharged: "110" }] },
        50000,
      ),
    /cash given|cardCashTransactions/i,
  );
  assert.throws(
    () =>
      reconcileDay(
        {
          actual: "500",
          cardCashTransactions: [{ cardCharged: "100", cashGiven: "110" }],
        },
        50000,
      ),
    /cardCashTransactions/i,
  );
});

test("over: actual above expected is flagged over", () => {
  const r = reconcileDay(
    { actual: "510", cashRemoved: 0, cashAdded: 0 },
    50000,
  );
  assert.equal(r.varianceCents, 1000);
  assert.equal(r.status, STATUS.OVER);
});

test("cash added raises expected; declared note is carried through", () => {
  const r = reconcileDay(
    { actual: "600", cashAdded: "100", declared: "found 3 in old float" },
    50000,
  );
  // expected = 500 + 100 = 600 -> variance 0
  assert.equal(r.expectedCents, 60000);
  assert.equal(r.varianceCents, 0);
  assert.equal(r.status, STATUS.BALANCED);
  assert.equal(r.declared, "found 3 in old float");
});

test("expense is an alias for cashRemoved and reduces expected cash", () => {
  // Opening €500, staff took €20 for ice, count €480 -> balanced.
  const viaExpense = reconcileDay({ actual: "480", expense: "20" }, 50000);
  assert.equal(viaExpense.expectedCents, 48000);
  assert.equal(viaExpense.removedCents, 2000);
  assert.equal(viaExpense.varianceCents, 0);
  assert.equal(viaExpense.status, STATUS.BALANCED);
  // Legacy field still works identically.
  const viaLegacy = reconcileDay({ actual: "480", cashRemoved: "20" }, 50000);
  assert.equal(viaLegacy.expectedCents, viaExpense.expectedCents);
  assert.equal(viaLegacy.removedCents, viaExpense.removedCents);
  // Expense wins when both are supplied (documented precedence).
  const both = reconcileDay(
    { actual: "480", expense: "20", cashRemoved: "50" },
    50000,
  );
  assert.equal(both.removedCents, 2000);
  // null/undefined expense means no removal, not a crash.
  const none = reconcileDay({ actual: "500", expense: null }, 50000);
  assert.equal(none.expectedCents, 50000);
  assert.equal(none.status, STATUS.BALANCED);
});

test("cash sales raise expected: the real check against the POS Z-report", () => {
  // Seb's model: today's POS cash sales are what the drawer SHOULD hold on
  // top of opening. expected = opening + sales - expense - drop.
  // Opening €500, €300 cash sales, count €800 -> balanced.
  const r = reconcileDay({ actual: "800", cashSales: "300" }, 50000);
  assert.equal(r.expectedCents, 80000);
  assert.equal(r.salesCents, 30000);
  assert.equal(r.varianceCents, 0);
  assert.equal(r.status, STATUS.BALANCED);
  // Missing sale shows up as short, not balanced:
  // 500 + 300 expected, counted 750 -> €50 short.
  const missing = reconcileDay({ actual: "750", cashSales: "300" }, 50000);
  assert.equal(missing.status, STATUS.SHORT);
  assert.equal(missing.varianceCents, -5000);
});

test("matching cash/card differences suggest a POS payment-method mistake", () => {
  const markedCash = reconcileDay(
    { actual: "490", posCardSales: "100", cardBilled: "110" },
    50000,
  );
  assert.equal(markedCash.posCardCents, 10000);
  assert.equal(markedCash.cardBilledCents, 11000);
  assert.equal(markedCash.cardVarianceCents, 1000);
  assert.equal(markedCash.varianceCents, -1000);
  assert.equal(
    markedCash.discrepancyReason,
    "Likely €10.00 card sale recorded as cash in POS; combined cash + card takings match.",
  );

  const markedCard = reconcileDay(
    { actual: "510", posCardSales: "110", cardBilled: "100" },
    50000,
  );
  assert.equal(
    markedCard.discrepancyReason,
    "Likely €10.00 cash sale recorded as card in POS; combined cash + card takings match.",
  );
});

test("overall match requires both cash and card totals to match", () => {
  const result = reconcileDay(
    { actual: "500", posCardSales: "110", cardBilled: "100" },
    50000,
  );
  assert.equal(result.cashMatches, true);
  assert.equal(result.cardMatches, false);
  assert.equal(result.overallMatches, false);
  assert.equal(result.overallStatus, "not_matches");
});

test("overall match is unknown when card terminal total was not entered", () => {
  const result = reconcileDay({ actual: "500" }, 50000);
  assert.equal(result.cashMatches, true);
  assert.equal(result.cardMatches, null);
  assert.equal(result.overallMatches, null);
  assert.equal(result.overallStatus, "not_checked");
});

test("card figures do not change cash and no reason is invented without an exact offset", () => {
  const unrelated = reconcileDay(
    { actual: "490", posCardSales: "100", cardBilled: "109" },
    50000,
  );
  assert.equal(
    unrelated.expectedCents,
    50000,
    "card money never changes the drawer target",
  );
  assert.match(
    unrelated.discrepancyReason,
    /Likely about €9\.00 card sale recorded as cash.*€1\.00 still differs/,
    "partial offset is useful evidence but keeps the €1 residual visible",
  );

  const notRecorded = reconcileDay(
    { actual: "490", posCardSales: "100" },
    50000,
  );
  assert.equal(notRecorded.cardBilledCents, null);
  assert.equal(notRecorded.discrepancyReason, "");
});

test("black is unrung cash IN: raises expected, stays in its own column", () => {
  // Seb's model: black = cash that went INTO the till without a receipt
  // (tracked on the guy's table). It is part of the till, so the books
  // must EXPECT it: expected = opening + added + black - expense - drop.
  // Opening €500, €50 black income, count €550 -> balanced.
  const r = reconcileDay({ actual: "550", black: "50" }, 50000);
  assert.equal(r.expectedCents, 55000);
  assert.equal(r.blackCents, 5000);
  assert.equal(r.varianceCents, 0);
  assert.equal(r.status, STATUS.BALANCED);
  // Black combines with the outflows without cross-contamination:
  // 500 + 50 black - 20 expense = 530 expected; count 530 -> balanced.
  const mix = reconcileDay(
    { actual: "530", expense: "20", black: "50" },
    50000,
  );
  assert.equal(mix.expectedCents, 53000);
  assert.equal(mix.removedCents, 2000);
  assert.equal(mix.blackCents, 5000);
  assert.equal(mix.status, STATUS.BALANCED);
  // Missing black income shows up as cash missing, not extra cash:
  // 500 + 50 expected, counted 500 -> €50 short.
  const missing = reconcileDay({ actual: "500", black: "50" }, 50000);
  assert.equal(missing.status, STATUS.SHORT);
  assert.equal(missing.varianceCents, -5000);
});

test("first-ever entry derives its own opening (baseline = first leftover)", () => {
  // Day one: no known opening. The operator only knows what was left AFTER
  // drops and expenses. So the first count IS the baseline: the day must
  // reconcile as balanced with opening = actual + outflows - inflows,
  // not against a fake €0 opening.
  const r = reconcileDay(
    {
      actual: "108.30",
      expense: "38.10",
      black: "199.10",
      preTakeout: "230",
      firstDay: true,
    },
    0,
  );
  // opening = 108.30 + 38.10 - 199.10 + 230 = 177.30
  assert.equal(r.derivedOpeningCents, 17730);
  assert.equal(
    r.expectedCents,
    r.actualCents,
    "first day must reconcile against its own derived opening",
  );
  assert.equal(r.varianceCents, 0);
  assert.equal(r.status, STATUS.BALANCED);
  // cashAdded must SUBTRACT from the derived opening (mutation: -added -> +added).
  // actual 100, added 50, black 30, removed 20, drop 10:
  // opening = 100 - 50 - 30 + 20 + 10 = 50
  const withAdded = reconcileDay(
    {
      actual: "100",
      cashAdded: "50",
      black: "30",
      expense: "20",
      preTakeout: "10",
      firstDay: true,
    },
    0,
  );
  assert.equal(withAdded.derivedOpeningCents, 5000);
  assert.equal(withAdded.status, STATUS.BALANCED);
  // A normal day (firstDay not set) is unaffected: €0 opening stays €0.
  const normal = reconcileDay({ actual: "100" }, 0);
  assert.equal(normal.derivedOpeningCents, undefined);
  assert.equal(normal.expectedCents, 0);
});

test("cent-precision: 0.01 short is a short, not a balanced float error", () => {
  const r = reconcileDay({ actual: "399.99", cashRemoved: "100" }, 50000);
  // expected = 500 - 100 = 400.00 ; actual 399.99 -> variance -0.01
  assert.equal(r.varianceCents, -1);
  assert.equal(r.status, STATUS.SHORT);
  // Symmetric edge: +0.01 over must be OVER, not balanced (mutation: > 0 -> > 1)
  const over1 = reconcileDay({ actual: "400.01", cashRemoved: "100" }, 50000);
  assert.equal(over1.varianceCents, 1);
  assert.equal(over1.status, STATUS.OVER);
});

test("pre-takeout (removed before counting) reduces expected in its own column", () => {
  // Opening €500, €80 taken out before counting, count €420 -> balanced.
  const r = reconcileDay({ actual: "420", preTakeout: "80" }, 50000);
  assert.equal(r.expectedCents, 42000);
  assert.equal(r.preTakeoutCents, 8000);
  assert.equal(r.varianceCents, 0);
  assert.equal(r.status, STATUS.BALANCED);
  // Combines with black (income) and expense without cross-contamination.
  // 500 + 50 black - 10 expense - 90 drop = 450; count 450 -> balanced.
  const mix = reconcileDay(
    { actual: "450", expense: "10", black: "50", preTakeout: "90" },
    50000,
  );
  assert.equal(mix.expectedCents, 45000);
  assert.equal(mix.removedCents, 1000);
  assert.equal(mix.blackCents, 5000);
  assert.equal(mix.preTakeoutCents, 9000);
});

test("DENOMINATIONS table is complete and in order", () => {
  assert.equal(DENOMINATIONS.length, 15);
  assert.equal(DENOMINATIONS[0].id, "500");
  assert.equal(DENOMINATIONS[14].id, "0.01");
  // Values in descending order
  for (let i = 1; i < DENOMINATIONS.length; i++) {
    assert.ok(DENOMINATIONS[i - 1].valueCents > DENOMINATIONS[i].valueCents);
  }
});

test("denominationsToCents sums counts by denomination", () => {
  const counts = { 50: 3, 20: 2, 10: 1, 1: 5, 0.5: 2, 0.2: 1, 0.1: 4 };
  // 3*50 + 2*20 + 1*10 + 5*1 + 2*0.5 + 1*0.2 + 4*0.1 = 150+40+10+5+1+0.2+0.4 = 206.60
  assert.equal(denominationsToCents(counts), 20660);
});

test("denominationsToCents rejects unknown and negative counts", () => {
  const counts = { 50: 1, 99: 5, 2: -3 }; // 99 not in table, -3 negative
  assert.throws(() => denominationsToCents(counts));
  assert.throws(() => denominationsToCents({ 99: 1 }));
});

test("reconcileDay with denominations uses derived total as actual", () => {
  // Books say €100. Owner counts 2×€50 notes = €100. Balanced.
  const r = reconcileDay({ denominations: { 50: 2 } }, 10000);
  assert.equal(r.actualCents, 10000);
  assert.equal(r.varianceCents, 0);
  assert.equal(r.status, STATUS.BALANCED);
});

test("reconcileDay with denominations short", () => {
  // Books say €100. Owner counts 1×€50 = €50. Short €50.
  const r = reconcileDay({ denominations: { 50: 1 } }, 10000);
  assert.equal(r.actualCents, 5000);
  assert.equal(r.varianceCents, -5000);
  assert.equal(r.status, STATUS.SHORT);
});

// --- statusForCents ------------------------------------------------------------

test("statusForCents maps variance sign to status", () => {
  assert.equal(statusForCents(-1), STATUS.SHORT);
  assert.equal(statusForCents(0), STATUS.BALANCED);
  assert.equal(statusForCents(1), STATUS.OVER);
  assert.equal(statusForCents(-123456), STATUS.SHORT);
});

// --- eurosToCents edge cases ---------------------------------------------------

test("eurosToCents accepts European comma and stray whitespace", () => {
  assert.equal(eurosToCents(" 12,50 "), 1250);
  assert.equal(eurosToCents("12.5"), 1250);
});

// --- denominationsToCents edge cases -------------------------------------------

test("denominationsToCents handles empty, null, and fractional counts", () => {
  assert.equal(denominationsToCents(null), 0);
  assert.equal(denominationsToCents({}), 0);
  // A fractional banknote count is invalid, never silently rounded.
  assert.throws(() => denominationsToCents({ 50: 2.9 }));
});

test("cash/card classification mistakes reconcile on combined takings", () => {
  const r = reconcileDay(
    { actual: "90", cashSales: "0", posCardSales: "100", cardBilled: "110" },
    10000,
  );
  assert.equal(r.varianceCents, -1000);
  assert.equal(r.cardVarianceCents, 1000);
  assert.equal(r.combinedVarianceCents, 0);
  assert.equal(r.paymentMethodOffsetCents, 1000);
  assert.equal(r.paymentMethodLikely, true);
  assert.equal(r.overallMatches, true);
  assert.match(r.discrepancyReason, /card sale recorded as cash/i);
});

test("partial cash/card offset identifies likely mix-up and residual discrepancy", () => {
  const r = reconcileDay(
    { actual: "93.50", posCardSales: "100", cardBilled: "126.85" },
    10000,
  );
  assert.equal(r.varianceCents, -650);
  assert.equal(r.cardVarianceCents, 2685);
  assert.equal(r.combinedVarianceCents, 2035);
  assert.equal(r.paymentMethodOffsetCents, 650);
  assert.equal(r.paymentMethodLikely, true);
  assert.equal(r.overallMatches, false);
  assert.equal(r.overallStatus, "payment_mix_suspected");
  assert.match(r.discrepancyReason, /20\.35 still differs/);
});

test("reversed card totals are detected when swapping them greatly improves reconciliation", () => {
  const r = reconcileDay(
    {
      actual: "188.10",
      cashSales: "350.20",
      black: "760.15",
      preTakeout: "745",
      posCardSales: "6219.95",
      cardBilled: "5828.20",
    },
    16000,
  );
  assert.equal(r.varianceCents, -33725);
  assert.equal(r.cardVarianceCents, -39175);
  assert.equal(r.combinedVarianceCents, -72900);
  assert.equal(r.swappedCardVarianceCents, 39175);
  assert.equal(r.swappedCombinedVarianceCents, 5450);
  assert.equal(r.cardTotalsMayBeReversed, true);
});
