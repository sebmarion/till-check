// Till Check — pure reconciliation core.
//
// Model
// -----
// The single source of truth is `opening_cash`: the cash carried forward
// from yesterday (after any takeout). It is dynamic, not a fixed float.
//
// Each day the operator enters:
//   - actual        cash counted in the till (the main daily number)
//   - expense       cash spent directly from the till (ice, supplies, payouts)
//   - cashRemoved   legacy alias for expense
//   - black         UNRUNG CASH IN — cash that went into the till without a
//                   receipt, tracked on an external table. It is part of the
//                   till, so it RAISES expected (own column for monthly totals)
//   - preTakeout    cash drop taken out BEFORE counting — the count already
//                   reflects it, so it reduces expected (own column)
//   - cashAdded     cash moved IN during the shift (loan, bank)
//   - posCardSales  card sales classified by the POS (logged; does NOT touch till cash)
//   - cardTransfer  legacy alias for posCardSales
//   - cardBilled    amount actually charged on the card terminal
//   - cardCashTransactions  cash tips taken after an extra card charge
//                            (the tip leaves the drawer; card amount is optional)
//   - declared      free-text note for declared/unaccounted cash
//   - firstDay      first-ever entry: no known opening, so opening is derived
//                   from this day's own numbers and the day balances by design
//
// Expected cash at close:
//   expected = opening_cash + cashAdded + black - cashRemoved - preTakeout
//              - cash given in card-extra-for-cash transactions
//
//   variance = actual - expected
//     < 0  short  (cash missing / unaccounted)
//     > 0  over   (more cash than expected)
//     == 0 balanced
//
// After close, the operator may take out cash (e.g. €700). The remainder
// becomes tomorrow's opening cash automatically.
//
// Money is stored in CENTS (integers) to avoid float drift. Inputs are accepted
// as decimal strings/numbers in euros and converted to cents.

export const STATUS = {
  BALANCED: "balanced",
  SHORT: "short",
  OVER: "over",
};

// Thrown by eurosToCents for malformed input. The server maps this to a
// clean 400 response; any other error stays a 500.
export class InvalidAmountError extends Error {}

// Parse an input amount (euros, possibly a string like "12.50" or "12,50")
// into integer cents. Throws on non-finite / malformed values.
export function eurosToCents(amount) {
  if (amount === undefined || amount === null || amount === "") {
    return 0;
  }
  if (!["string", "number"].includes(typeof amount))
    throw new InvalidAmountError("Amount must be a decimal number");
  const normalized = String(amount).trim();
  if (normalized === "") return 0;
  // Accept "12,50" (European) and "12.50" both.
  const cleaned = normalized.replace(/\s/g, "");
  const match = cleaned.match(/^-?(\d{1,9})(?:[.,](\d{1,2}))?$/);
  if (!match) {
    throw new InvalidAmountError(`invalid amount: ${amount}`);
  }
  const sign = cleaned.startsWith("-") ? -1 : 1;
  const whole = Number(match[1]);
  const frac = match[2] ? match[2].padEnd(2, "0") : "00";
  return sign * (whole * 100 + Number(frac));
}

export function centsToEuros(cents) {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}${whole}.${frac}`;
}

export function normalizeCardCashTransactions(transactions) {
  if (transactions === undefined || transactions === null) return [];
  if (!Array.isArray(transactions)) {
    throw new InvalidAmountError("cardCashTransactions must be an array");
  }
  if (transactions.length > 200)
    throw new InvalidAmountError("At most 200 card tips per day");
  return transactions.map((transaction, index) => {
    if (!transaction || typeof transaction !== "object") {
      throw new InvalidAmountError(
        `cardCashTransactions[${index}] must be an object`,
      );
    }
    const { cardCharged, cashGiven, time = "", reference = "" } = transaction;
    const hasCardCharged =
      cardCharged !== undefined &&
      cardCharged !== null &&
      String(cardCharged).trim() !== "";
    if (
      cashGiven === undefined ||
      cashGiven === null ||
      String(cashGiven).trim() === ""
    ) {
      throw new InvalidAmountError(
        `cardCashTransactions[${index}] needs tip amount`,
      );
    }
    const cashGivenCents = eurosToCents(cashGiven);
    const cardChargedCents = hasCardCharged
      ? eurosToCents(cardCharged)
      : cashGivenCents;
    if (
      cashGivenCents <= 0 ||
      (hasCardCharged && cardChargedCents <= cashGivenCents)
    ) {
      throw new InvalidAmountError(
        `cardCashTransactions[${index}] must contain a positive tip and, when entered, a larger card charge`,
      );
    }
    return {
      cardChargedCents,
      cashGivenCents,
      extraCents: cardChargedCents - cashGivenCents,
      cardChargeProvided: hasCardCharged,
      time: String(time ?? "").slice(0, 40),
      reference: String(reference ?? "").slice(0, 300),
    };
  });
}

/**
 * Compute the reconciliation for one day.
 *
 * @param {object} input
 * @param {string|number} input.actual        cash counted in the till (euros)
 * @param {string|number} [input.expense]     cash spent directly from the till
 * @param {string|number} [input.cashRemoved] legacy alias for expense
 * @param {string|number} [input.black]       other cash income (own column)
 * @param {string|number} [input.cashAdded]   cash moved IN during the shift
 * @param {string|number} [input.posCardSales] card sales classified by the POS
 * @param {string|number} [input.cardTransfer] legacy alias for posCardSales
 * @param {string|number} [input.cardBilled] actual amount charged on the card terminal
 * @param {Array<{cardCharged?:string|number,cashGiven:string|number,time?:string,reference?:string}>} [input.cardCashTransactions]
 *        each cash tip taken after an extra card charge; cashGiven leaves the drawer
 * @param {string}        [input.declared]    declared-cash note
 * @param {object}        [input.denominations] counts by denomination
 * @param {number} openingCents   opening cash carried from yesterday (cents)
 * @returns {{expectedCents:number, actualCents:number, varianceCents:number, status:string}}
 */

// Denomination values in cents, in counting order (large → small).
export const DENOMINATIONS = [
  { id: "500", valueCents: 50000, label: "€500" },
  { id: "200", valueCents: 20000, label: "€200" },
  { id: "100", valueCents: 10000, label: "€100" },
  { id: "50", valueCents: 5000, label: "€50" },
  { id: "20", valueCents: 2000, label: "€20" },
  { id: "10", valueCents: 1000, label: "€10" },
  { id: "5", valueCents: 500, label: "€5" },
  { id: "2", valueCents: 200, label: "€2" },
  { id: "1", valueCents: 100, label: "€1" },
  { id: "0.5", valueCents: 50, label: "€0.50" },
  { id: "0.2", valueCents: 20, label: "€0.20" },
  { id: "0.1", valueCents: 10, label: "€0.10" },
  { id: "0.05", valueCents: 5, label: "€0.05" },
  { id: "0.02", valueCents: 2, label: "€0.02" },
  { id: "0.01", valueCents: 1, label: "€0.01" },
];

/**
 * Sum a denominations object into integer cents.
 * @param {Record<string, number>} counts  e.g. { "50": 3, "20": 2, "1": 5 }
 * @returns {number} total in cents
 */
export function denominationsToCents(counts) {
  if (counts === null || counts === undefined) return 0;
  if (typeof counts !== "object" || Array.isArray(counts))
    throw new InvalidAmountError("Denominations must be an object");
  let total = 0;
  for (const [id, n] of Object.entries(counts)) {
    const def = DENOMINATIONS.find((d) => d.id === id);
    if (!def) throw new InvalidAmountError(`Unknown denomination: ${id}`);
    if (
      !["number", "string"].includes(typeof n) ||
      !/^\d+$/.test(String(n)) ||
      !Number.isSafeInteger(Number(n)) ||
      Number(n) > 1000000
    ) {
      throw new InvalidAmountError(
        `Count for ${def.label} must be a whole number from 0 to 1,000,000`,
      );
    }
    total += Number(n) * def.valueCents;
  }
  if (!Number.isSafeInteger(total) || total > 99999999999)
    throw new InvalidAmountError("Count is too large");
  return total;
}

export function reconcileDay(
  {
    actual,
    expense,
    cashRemoved = 0,
    black = 0,
    preTakeout = 0,
    cashAdded = 0,
    posCardSales,
    cardTransfer = 0,
    cardBilled,
    cardCashTransactions,
    cashSales = 0,
    declared = "",
    denominations,
    firstDay = false,
    tipsOutsidePos = false,
  },
  openingCents = 0,
) {
  // If denominations are provided, they define the actual count.
  const actualCents = denominations
    ? denominationsToCents(denominations)
    : eurosToCents(actual);
  const removedCents = eurosToCents(expense ?? cashRemoved);
  const blackCents = eurosToCents(black);
  const preTakeoutCents = eurosToCents(preTakeout);
  const addedCents = eurosToCents(cashAdded);
  const posCardCents = eurosToCents(posCardSales ?? cardTransfer);
  const cardBilledCents =
    cardBilled === undefined ||
    cardBilled === null ||
    String(cardBilled).trim() === ""
      ? null
      : eurosToCents(cardBilled);
  const salesCents = eurosToCents(cashSales);
  const cardCash = normalizeCardCashTransactions(cardCashTransactions);
  const cardCashGivenCents = cardCash.reduce(
    (sum, transaction) => sum + transaction.cashGivenCents,
    0,
  );
  const cardCashExtraCents = cardCash.reduce(
    (sum, transaction) => sum + transaction.extraCents,
    0,
  );
  const declaredNote = String(declared ?? "");

  let effectiveOpening = openingCents;
  let derivedOpeningCents;
  if (firstDay) {
    // First-ever entry: the operator only knows what was LEFT after drops
    // and expenses. Derive the opening that makes this day balance:
    //   opening = actual - added - black - sales + removed + preTakeout
    derivedOpeningCents =
      actualCents -
      addedCents -
      blackCents -
      salesCents +
      removedCents +
      preTakeoutCents +
      cardCashGivenCents;
    effectiveOpening = derivedOpeningCents;
  }

  const expectedCents =
    effectiveOpening +
    salesCents +
    addedCents +
    blackCents -
    removedCents -
    preTakeoutCents -
    cardCashGivenCents;
  const varianceCents = actualCents - expectedCents;
  for (const [label, value] of Object.entries({
    count: actualCents,
    expenses: removedCents,
    cashIn: blackCents,
    cashDrop: preTakeoutCents,
    added: addedCents,
    posCard: posCardCents,
    cashSales: salesCents,
    cardBilled: cardBilledCents,
  })) {
    if (value !== null && value < 0)
      throw new InvalidAmountError(`${label} cannot be negative`);
  }
  const expectedCardCents =
    posCardCents + (tipsOutsidePos ? cardCashGivenCents : 0);
  const cardVarianceCents =
    cardBilledCents === null ? null : cardBilledCents - expectedCardCents;
  const cashMatches = varianceCents === 0;
  const cardMatches =
    cardVarianceCents === null ? null : cardVarianceCents === 0;
  const overallMatches =
    cardMatches === null ? null : cashMatches && cardMatches;
  const overallStatus =
    overallMatches === true
      ? "matches"
      : overallMatches === false
        ? "not_matches"
        : "not_checked";

  let discrepancyReason = "";
  if (varianceCents !== 0 && cardVarianceCents === -varianceCents) {
    const amount = centsToEuros(Math.abs(varianceCents));
    discrepancyReason =
      varianceCents < 0
        ? `Likely €${amount} card sale recorded as cash in POS.`
        : `Likely €${amount} cash sale recorded as card in POS.`;
  }

  const status =
    varianceCents < 0
      ? STATUS.SHORT
      : varianceCents > 0
        ? STATUS.OVER
        : STATUS.BALANCED;

  return {
    expectedCents,
    actualCents,
    removedCents,
    addedCents,
    cardCents: posCardCents,
    posCardCents,
    cardBilledCents,
    expectedCardCents,
    tipsOutsidePos,
    cardVarianceCents,
    cashMatches,
    cardMatches,
    overallMatches,
    overallStatus,
    discrepancyReason,
    cardCashTransactions: cardCash,
    cardCashGivenCents,
    cardCashExtraCents,
    salesCents,
    blackCents,
    preTakeoutCents,
    declared: declaredNote,
    varianceCents,
    status,
    derivedOpeningCents,
    openingCents: effectiveOpening,
    // The count is the new reference for tomorrow. After a takeout, the
    // remainder becomes tomorrow's opening cash.
    nextOpeningCents: actualCents,
  };
}

export function statusForCents(varianceCents) {
  if (varianceCents < 0) return STATUS.SHORT;
  if (varianceCents > 0) return STATUS.OVER;
  return STATUS.BALANCED;
}
