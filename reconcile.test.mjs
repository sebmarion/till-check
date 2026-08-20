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

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  eurosToCents,
  centsToEuros,
  reconcileDay,
  denominationsToCents,
  DENOMINATIONS,
  STATUS,
} from './reconcile.mjs'

test('eurosToCents parses euros into integer cents (incl. European comma)', () => {
  assert.equal(eurosToCents(500), 50000)
  assert.equal(eurosToCents('500'), 50000)
  assert.equal(eurosToCents('12.50'), 1250)
  assert.equal(eurosToCents('12,50'), 1250)
  assert.equal(eurosToCents('-3.25'), -325)
  assert.equal(eurosToCents(''), 0)
  assert.equal(eurosToCents(null), 0)
  assert.equal(eurosToCents(undefined), 0)
  assert.equal(eurosToCents('0.01'), 1)
  assert.equal(eurosToCents('0.99'), 99)
  assert.throws(() => eurosToCents('abc'))
  assert.throws(() => eurosToCents('1.234'))
})

test('centsToEuros round-trips', () => {
  assert.equal(centsToEuros(50000), '500.00')
  assert.equal(centsToEuros(1250), '12.50')
  assert.equal(centsToEuros(-325), '-3.25')
  assert.equal(centsToEuros(0), '0.00')
})

test('acceptance: day1 short 10, confirm folds actual into books, day2 balanced', () => {
  // Baseline: the books start at 500.00 (entered once).
  const BOOKS_BASELINE = eurosToCents('500')
  assert.equal(BOOKS_BASELINE, 50000)

  // Day 1: operator removes 100 cash (bank), card transfer of 50, counts 390.
  const day1 = reconcileDay(
    {
      actual: '390',
      cashRemoved: '100',
      cashAdded: 0,
      cardTransfer: '50',
      declared: '',
    },
    BOOKS_BASELINE,
  )
  assert.equal(day1.expectedCents, 40000, 'day1 expected should be 400.00')
  assert.equal(day1.actualCents, 39000, 'day1 actual should be 390.00')
  assert.equal(day1.varianceCents, -1000, 'day1 variance should be -10.00 (short)')
  assert.equal(day1.status, STATUS.SHORT, 'day1 should be short')
  // Card transfer is logged but must not touch the till-cash expected.
  assert.equal(day1.cardCents, 5000, 'card transfer recorded')
  assert.equal(day1.nextBooksBalanceCents, 39000, 'confirm folds actual into books')

  // Operator declares the 10 missing (lost) and confirms the day.
  // Books now accept reality: 390.
  const BOOKS_AFTER_DAY1 = day1.nextBooksBalanceCents
  assert.equal(BOOKS_AFTER_DAY1, 39000)

  // Day 2: no moves, count is 390.
  const day2 = reconcileDay({ actual: '390', cashRemoved: 0, cashAdded: 0 }, BOOKS_AFTER_DAY1)
  assert.equal(day2.expectedCents, 39000, 'day2 expected should be 390.00')
  assert.equal(day2.varianceCents, 0, 'day2 variance should be 0')
  assert.equal(day2.status, STATUS.BALANCED, 'day2 should be balanced')
})

test('over: actual above expected is flagged over', () => {
  const r = reconcileDay({ actual: '510', cashRemoved: 0, cashAdded: 0 }, 50000)
  assert.equal(r.varianceCents, 1000)
  assert.equal(r.status, STATUS.OVER)
})

test('cash added raises expected; declared note is carried through', () => {
  const r = reconcileDay(
    { actual: '600', cashAdded: '100', declared: 'found 3 in old float' },
    50000,
  )
  // expected = 500 + 100 = 600 -> variance 0
  assert.equal(r.expectedCents, 60000)
  assert.equal(r.varianceCents, 0)
  assert.equal(r.status, STATUS.BALANCED)
  assert.equal(r.declared, 'found 3 in old float')
})

test('cent-precision: 0.01 short is a short, not a balanced float error', () => {
  const r = reconcileDay({ actual: '399.99', cashRemoved: '100' }, 50000)
  // expected = 500 - 100 = 400.00 ; actual 399.99 -> variance -0.01
  assert.equal(r.varianceCents, -1)
  assert.equal(r.status, STATUS.SHORT)
})

test('DENOMINATIONS table is complete and in order', () => {
  assert.equal(DENOMINATIONS.length, 8)
  assert.equal(DENOMINATIONS[0].id, '50')
  assert.equal(DENOMINATIONS[7].id, '0.2')
  // Values in descending order
  for (let i = 1; i < DENOMINATIONS.length; i++) {
    assert.ok(DENOMINATIONS[i - 1].valueCents > DENOMINATIONS[i].valueCents)
  }
})

test('denominationsToCents sums counts by denomination', () => {
  const counts = { "50": 3, "20": 2, "10": 1, "1": 5, "0.5": 2, "0.2": 1 }
  // 3*50 + 2*20 + 1*10 + 5*1 + 2*0.5 + 1*0.2 = 150+40+10+5+1+0.2 = 206.20
  assert.equal(denominationsToCents(counts), 20620)
})

test('denominationsToCents ignores unknown and negative counts', () => {
  const counts = { "50": 1, "99": 5, "2": -3 }  // 99 not in table, -3 negative
  assert.equal(denominationsToCents(counts), 5000)  // only the €50 counts
})

test('reconcileDay with denominations uses derived total as actual', () => {
  // Books say €100. Owner counts 2×€50 notes = €100. Balanced.
  const r = reconcileDay({ denominations: { "50": 2 } }, 10000)
  assert.equal(r.actualCents, 10000)
  assert.equal(r.varianceCents, 0)
  assert.equal(r.status, STATUS.BALANCED)
})

test('reconcileDay with denominations short', () => {
  // Books say €100. Owner counts 1×€50 = €50. Short €50.
  const r = reconcileDay({ denominations: { "50": 1 } }, 10000)
  assert.equal(r.actualCents, 5000)
  assert.equal(r.varianceCents, -5000)
  assert.equal(r.status, STATUS.SHORT)
})
