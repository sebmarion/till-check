// Till Check — pure reconciliation core.
//
// Model
// -----
// The single source of truth is `books_balance`: the cash the books say is in
// the till. It is set once from the baseline, then (after a day is confirmed)
// it equals that day's ACTUAL count — so it never has to be re-entered.
//
// Each day the operator enters:
//   - actual        cash counted in the till (the main daily number)
//   - cashRemoved   cash taken OUT of the till during the day (bank, personal…)
//   - cashAdded     cash put INTO the till during the day (float top-up…)
//   - cardTransfer  card revenue moved to the bank (logged; does NOT touch till cash)
//   - declared      free-text note for declared/unaccounted cash (e.g. "lost €10")
//
// Expected cash in the till BEFORE the day's moves are reconciled:
//   expected = books_balance + cashAdded - cashRemoved
//
//   variance = actual - expected
//     < 0  short  (cash missing / unaccounted)
//     > 0  over   (more cash than the books predict)
//     == 0 balanced
//
// "Declared" cash (cash that moved but the books didn't record) is handled by
// the operator choosing a cashRemoved/cashAdded/declared value that makes the
// books match reality; confirming the day then folds the actual into the books.
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
 * @param {string|number} [input.cashRemoved] cash taken out during the day
 * @param {string|number} [input.cashAdded]   cash added during the day
 * @param {string|number} [input.cardTransfer] card revenue moved to bank (logged)
 * @param {string}        [input.declared]    declared-cash note
 * @param {object}        [input.denominations] counts by denomination:
 *        { "50": n, "20": n, "10": n, "5": n, "2": n, "1": n, "0.5": n, "0.2": n }
 *        where n is the count of each note/coin (integer). When present, the
 *        total derived from denominations is used as `actual` (overrides the
 *        raw `actual` field). This lets the owner count by notes/coins rather
 *        than typing a sum.
 * @param {number} booksBalanceCents   current books balance (cents)
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

export function reconcileDay({ actual, cashRemoved = 0, cashAdded = 0, cardTransfer = 0, declared = "", denominations } , booksBalanceCents) {
  // If denominations are provided, they define the actual count.
  const actualCents = denominations ? denominationsToCents(denominations) : eurosToCents(actual);
  const removedCents = eurosToCents(cashRemoved);
  const addedCents = eurosToCents(cashAdded);
  const cardCents = eurosToCents(cardTransfer);
  const declaredNote = String(declared ?? "");

  const expectedCents = booksBalanceCents + addedCents - removedCents;
  const varianceCents = actualCents - expectedCents;

  const status =
    varianceCents < 0 ? STATUS.SHORT : varianceCents > 0 ? STATUS.OVER : STATUS.BALANCED;

  return {
    expectedCents,
    actualCents,
    removedCents,
    addedCents,
    cardCents,
    declared: declaredNote,
    varianceCents,
    status,
    // After confirming, the books accept reality: the balance becomes actual.
    nextBooksBalanceCents: actualCents,
  };
}

export function statusForCents(varianceCents) {
  if (varianceCents < 0) return STATUS.SHORT
  if (varianceCents > 0) return STATUS.OVER
  return STATUS.BALANCED
}
