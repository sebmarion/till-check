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
//   - black         undeclared ("black") cash out — own column, also reduces
//                   expected so the day balances; tracked separately from
//                   legitimate expenses for later totals
//   - preTakeout    cash taken out BEFORE counting — the count already
//                   reflects it, so it reduces expected (own column)
//   - cashAdded     cash moved IN during the shift (loan, bank)
//   - cardTransfer  card revenue moved to the bank (logged; does NOT touch till cash)
//   - declared      free-text note for declared/unaccounted cash
//
// Expected cash at close:
//   expected = opening_cash + cashAdded - cashRemoved - black - preTakeout
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
  BALANCED: 'balanced',
  SHORT: 'short',
  OVER: 'over',
}

// Parse an input amount (euros, possibly a string like "12.50" or "12,50")
// into integer cents. Throws on non-finite / malformed values.
export function eurosToCents(amount) {
  if (amount === undefined || amount === null || amount === '') {
    return 0
  }
  const normalized = String(amount).trim()
  if (normalized === '') return 0
  // Accept "12,50" (European) and "12.50" both.
  const cleaned = normalized.replace(/\s/g, '')
  const match = cleaned.match(/^-?(\d{1,9})(?:[.,](\d{1,2}))?$/)
  if (!match) {
    throw new Error(`invalid amount: ${amount}`)
  }
  const sign = cleaned.startsWith('-') ? -1 : 1
  const whole = Number(match[1])
  const frac = match[2] ? match[2].padEnd(2, '0') : '00'
  return sign * (whole * 100 + Number(frac))
}

export function centsToEuros(cents) {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const whole = Math.floor(abs / 100)
  const frac = String(abs % 100).padStart(2, '0')
  return `${sign}${whole}.${frac}`
}

/**
 * Compute the reconciliation for one day.
 *
 * @param {object} input
 * @param {string|number} input.actual        cash counted in the till (euros)
 * @param {string|number} [input.expense]     cash spent directly from the till
 * @param {string|number} [input.cashRemoved] legacy alias for expense
 * @param {string|number} [input.black]       undeclared cash out (own column)
 * @param {string|number} [input.cashAdded]   cash moved IN during the shift
 * @param {string|number} [input.cardTransfer] card revenue moved to bank (logged)
 * @param {string}        [input.declared]    declared-cash note
 * @param {object}        [input.denominations] counts by denomination
 * @param {number} openingCents   opening cash carried from yesterday (cents)
 * @returns {{expectedCents:number, actualCents:number, varianceCents:number, status:string}}
 */

// Denomination values in cents, in counting order (large → small).
export const DENOMINATIONS = [
  { id: "50",  valueCents: 5000, label: "€50" },
  { id: "20",  valueCents: 2000, label: "€20" },
  { id: "10",  valueCents: 1000, label: "€10" },
  { id: "5",   valueCents: 500,  label: "€5"  },
  { id: "2",   valueCents: 200,  label: "€2"  },
  { id: "1",   valueCents: 100,  label: "€1"  },
  { id: "0.5", valueCents: 50,   label: "€0.50" },
  { id: "0.2", valueCents: 20,   label: "€0.20" },
  { id: "0.1", valueCents: 10,   label: "€0.10" },
];

/**
 * Sum a denominations object into integer cents.
 * @param {Record<string, number>} counts  e.g. { "50": 3, "20": 2, "1": 5 }
 * @returns {number} total in cents
 */
export function denominationsToCents(counts) {
  if (!counts) return 0;
  let total = 0;
  for (const [id, n] of Object.entries(counts)) {
    const def = DENOMINATIONS.find((d) => d.id === id);
    if (!def) continue; // ignore unknown denominations
    const count = Number(n);
    if (!Number.isFinite(count) || count < 0) continue;
    total += Math.trunc(count) * def.valueCents;
  }
  return total;
}

export function reconcileDay(
  { actual, expense, cashRemoved = 0, black = 0, preTakeout = 0, cashAdded = 0, cardTransfer = 0, declared = "", denominations },
  openingCents = 0,
) {
  // If denominations are provided, they define the actual count.
  const actualCents = denominations ? denominationsToCents(denominations) : eurosToCents(actual);
  const removedCents = eurosToCents(expense ?? cashRemoved);
  const blackCents = eurosToCents(black);
  const preTakeoutCents = eurosToCents(preTakeout);
  const addedCents = eurosToCents(cashAdded);
  const cardCents = eurosToCents(cardTransfer);
  const declaredNote = String(declared ?? "");

  const expectedCents =
    openingCents + addedCents - removedCents - blackCents - preTakeoutCents;
  const varianceCents = actualCents - expectedCents;

  const status =
    varianceCents < 0 ? STATUS.SHORT : varianceCents > 0 ? STATUS.OVER : STATUS.BALANCED;

  return {
    expectedCents,
    actualCents,
    removedCents,
    addedCents,
    cardCents,
    blackCents,
    preTakeoutCents,
    declared: declaredNote,
    varianceCents,
    status,
    // The count is the new reference for tomorrow. After a takeout, the
    // remainder becomes tomorrow's opening cash.
    nextOpeningCents: actualCents,
  };
}

export function statusForCents(varianceCents) {
  if (varianceCents < 0) return STATUS.SHORT
  if (varianceCents > 0) return STATUS.OVER
  return STATUS.BALANCED
}
