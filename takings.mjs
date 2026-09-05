// Read-only, cents-based summary of existing reconciled entries. Not a profit calculation.
function cents(value, fallback = null) {
  if (value === null || value === undefined || String(value).trim() === '') return fallback;
  const match = String(value).trim().match(/^(-?)(\d{1,9})(?:[.,](\d{1,2}))?$/);
  if (!match) return null;
  return (match[1] ? -1 : 1) * (Number(match[2]) * 100 + Number((match[3] || '').padEnd(2, '0')));
}
export function summarizeTakings(entry, { openingProvisional = false } = {}) {
  const cashSales = cents(entry.cashSales, 0), otherCash = cents(entry.black, 0),
    tips = cents(entry.cardCashGiven, 0), posCard = cents(entry.posCardSales ?? entry.cardTransfer, 0),
    count = cents(entry.actual), opening = cents(entry.opening), added = cents(entry.cashAdded, 0),
    expense = cents(entry.expense ?? entry.cashRemoved, 0), drop = cents(entry.preTakeout, 0), terminal = cents(entry.cardBilled);
  const inputsOK = [cashSales, otherCash, tips, posCard, added, expense, drop].every(v => Number.isSafeInteger(v) && v >= 0);
  if (!inputsOK) return { source:'unavailable',totalCents:null,cashCents:null,cardCents:null,recordedCents:null,differenceCents:null,reason:'invalid_record',tipsCents:tips };
  const recordedCash = cashSales + otherCash, recordedCard = posCard - (entry.tipsOutsidePos ? 0 : tips);
  const recorded = recordedCard >= 0 ? recordedCash + recordedCard : null;
  // Before-count drops/expenses/tip payouts must be put back to reconstruct receipts.
  // Opening float and float added are not takings. Closing takeout does not enter this calculation.
  const observedCash = count === null || opening === null ? null : count - opening - added + expense + drop + tips;
  const observedCard = terminal === null ? null : terminal - tips;
  let reason = entry.baselineOnly ? 'derived_opening' : openingProvisional ? 'provisional_opening' :
    count === null || opening === null ? 'missing_cash' : terminal === null ? 'missing_terminal' :
    observedCash < 0 ? 'cash_needs_review' : observedCard < 0 ? 'tips_exceed_terminal' : null;
  const actual = reason === null ? observedCash + observedCard : null;
  const source = actual !== null ? 'actual' : recorded !== null ? 'recorded' : 'unavailable';
  return { source, totalCents:actual ?? recorded, cashCents:source==='actual'?observedCash:recordedCash,
    cardCents:source==='actual'?observedCard:recordedCard>=0?recordedCard:null, recordedCents:recorded,
    differenceCents:actual!==null && recorded!==null ? actual-recorded : null, reason,
    tipsCents:tips, otherCashCents:otherCash };
}
