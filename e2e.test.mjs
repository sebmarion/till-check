#!/usr/bin/env node
// Till Check — End-to-End Test Suite
//
// Tests ALL scenarios against a live server instance.
// By default, tests against the running service on port 80.
//
// Usage:
//   node e2e.test.mjs              # test against default port 80
//   TILL_TEST_PORT=8080 node e2e.test.mjs  # test against a different port

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const BASE = `http://127.0.0.1:${process.env.TILL_TEST_PORT || 80}${process.env.TILL_TEST_PORT ? '' : '/till'}/api`

async function req(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(BASE + path, opts)
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

async function currentBooksBalance() {
  const { data } = await req('GET', '/state')
  return Number(data.openingCash || 0)
}

// The live service shares one mutable ledger. Queue test bodies so one test
// cannot change the books baseline while another is calculating its expected
// variance.
let testQueue = Promise.resolve()
function serialTest(name, fn) {
  test(name, async () => {
    const previous = testQueue
    let release
    testQueue = new Promise((resolve) => { release = resolve })
    await previous
    try {
      return await fn()
    } finally {
      release()
    }
  })
}

// Generate a unique test date to avoid conflicts with existing entries and
// between concurrently scheduled node:test cases.
let testDateOffset = Number(process.env.TILL_TEST_DATE_OFFSET || 30)
function testDate() {
  const d = new Date()
  d.setDate(d.getDate() + testDateOffset++)
  return d.toISOString().slice(0, 10)
}

// --- State tests ---
serialTest('GET /health returns ok', async () => {
  const healthUrl = process.env.TILL_TEST_PORT
    ? `http://127.0.0.1:${process.env.TILL_TEST_PORT}/health`
    : `http://127.0.0.1:80/till/health`
  const res = await fetch(healthUrl)
  const data = await res.json()
  assert.equal(res.status, 200)
  assert.ok(data.ok === true || data.ok === 'true')
})

serialTest('GET /state returns state', async () => {
  const { status, data } = await req('GET', '/state')
  assert.equal(status, 200)
  assert.ok('hasOpening' in data)
})

serialTest('GET /denominations returns denom list', async () => {
  const { status, data } = await req('GET', '/denominations')
  assert.equal(status, 200)
  assert.ok(data.denominations.length >= 1)
})

// --- Entry tests ---
serialTest('POST /entry creates a balanced entry', async () => {
  const today = testDate()
  const balance = await currentBooksBalance()
  const { status, data } = await req('POST', '/entry', {
    date: today,
    actual: String(balance),
    cashRemoved: 0,
    cashAdded: 0,
    cardTransfer: 0,
    declared: '',
  })
  assert.equal(status, 200)
  assert.ok('status' in data)
  assert.equal(Number(data.actual), balance)
})

serialTest('POST /entry creates a short entry', async () => {
  const today = testDate()
  const balance = await currentBooksBalance()
  const { status, data } = await req('POST', '/entry', {
    date: today,
    actual: String(balance - 100),
    cashRemoved: 0,
    cashAdded: 0,
    cardTransfer: 0,
    declared: '',
  })
  assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`)
  assert.equal(data.status, 'short')
  assert.equal(Number(data.variance), -100)
})

serialTest('POST /entry creates an over entry', async () => {
  const today = testDate()
  const balance = await currentBooksBalance()
  const { status, data } = await req('POST', '/entry', {
    date: today,
    actual: String(balance + 100),
    cashRemoved: 0,
    cashAdded: 0,
    cardTransfer: 0,
    declared: '',
  })
  assert.equal(status, 200)
  assert.equal(data.status, 'over')
  assert.equal(Number(data.variance), 100)
})

serialTest('POST /entry with denominations derives actual from denom', async () => {
  const today = testDate()
  const { status, data } = await req('POST', '/entry', {
    date: today,
    denominations: { '50': 4, '20': 5 },
    cashRemoved: 0,
    cashAdded: 0,
    cardTransfer: 0,
    declared: '',
  })
  assert.equal(status, 200)
  assert.equal(Number(data.actual), 300)
  assert.equal(Number(data.denominations['50']), 4)
})

serialTest('POST /entry with invalid JSON returns 400', async () => {
  const res = await fetch(BASE + '/entry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not json',
  })
  assert.equal(res.status, 400)
})

serialTest('POST /entry with negative actual works', async () => {
  const today = testDate()
  const { status, data } = await req('POST', '/entry', {
    date: today,
    actual: '-100',
    cashRemoved: 0,
    cashAdded: 0,
    cardTransfer: 0,
    declared: '',
  })
  assert.equal(status, 200)
})

serialTest('POST /entry with zero values works', async () => {
  const today = testDate()
  const { status, data } = await req('POST', '/entry', {
    date: today,
    actual: '0',
    cashRemoved: 0,
    cashAdded: 0,
    cardTransfer: 0,
    declared: '',
  })
  assert.equal(status, 200)
})

// --- Confirm tests ---
serialTest('POST /confirm confirms the entry', async () => {
  const today = testDate()
  const balance = await currentBooksBalance()
  const created = await req('POST', '/entry', {
    date: today,
    actual: String(balance),
    cashRemoved: 0,
    cashAdded: 0,
    cardTransfer: 0,
    declared: '',
  })
  assert.equal(created.status, 200)
  const { status, data } = await req('POST', '/confirm', { date: today })
  assert.equal(status, 200)
  assert.equal(data.confirmed, true)
})

serialTest('POST /confirm for non-existent date returns 404', async () => {
  const { status } = await req('POST', '/confirm', { date: '1999-01-01' })
  assert.equal(status, 404)
})

// --- Reconcile tests ---
serialTest('POST /reconcile corrects a confirmed day and re-derives the opening', async () => {
  const today = testDate()
  const balance = await currentBooksBalance()
  // Create an entry matching current opening, then confirm it.
  const created = await req('POST', '/entry', {
    date: today, actual: String(balance), cashRemoved: 0, cashAdded: 0, cardTransfer: 0, declared: '',
  })
  assert.equal(created.status, 200)
  const confirmed = await req('POST', '/confirm', { date: today })
  assert.equal(confirmed.status, 200)
  // Now reconcile with a corrected (higher) count — the carried opening should follow.
  const corrected = String(balance + 50)
  const rec = await req('POST', '/reconcile', { date: today, actual: corrected })
  assert.equal(rec.status, 200, `reconcile failed: ${JSON.stringify(rec.data)}`)
  assert.equal(rec.data.reconciled, true)
  assert.equal(Number(rec.data.actual), balance + 50)
  assert.equal(Number(rec.data.openingCash), balance + 50)
  // Opening cash in state should now equal the corrected actual.
  const after = await currentBooksBalance()
  assert.equal(after, balance + 50)
})

serialTest('POST /reconcile on an unconfirmed day refreshes reconciliation', async () => {
  const today = testDate()
  const balance = await currentBooksBalance()
  // Create an unconfirmed entry with a variance.
  const created = await req('POST', '/entry', {
    date: today, actual: String(balance + 75), cashRemoved: 0, cashAdded: 0, cardTransfer: 0, declared: '',
  })
  assert.equal(created.status, 200)
  // Reconcile without changing actual (just re-run reconciliation).
  const rec = await req('POST', '/reconcile', { date: today })
  assert.equal(rec.status, 200)
  assert.equal(rec.data.reconciled, true)
  assert.equal(Number(rec.data.variance), 75)
})

serialTest('POST /reconcile for non-existent date returns 404', async () => {
  const { status } = await req('POST', '/reconcile', { date: '1999-01-01', actual: '0' })
  assert.equal(status, 404)
})

serialTest('POST /reconcile without date returns 400', async () => {
  const { status } = await req('POST', '/reconcile', {})
  assert.equal(status, 400)
})

serialTest('POST /reconcile with invalid JSON returns 400', async () => {
  const res = await fetch(BASE + '/reconcile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not json',
  })
  assert.equal(res.status, 400)
})

// --- History tests ---
serialTest('GET /history returns entries', async () => {
  const { status, data } = await req('GET', '/history')
  assert.equal(status, 200)
  assert.ok('entries' in data)
  assert.ok(data.entries.length >= 1)
})

serialTest('GET /history entries have correct structure', async () => {
  const { status, data } = await req('GET', '/history')
  assert.equal(status, 200)
  const entry = data.entries[0]
  assert.ok('date' in entry)
  assert.ok('actual' in entry)
  assert.ok('variance' in entry)
  assert.ok('status' in entry)
})

// --- Entry PATCH/DELETE tests ---
serialTest('PATCH /entry/:date updates the entry', async () => {
  const today = testDate()
  const balance = await currentBooksBalance()
  const created = await req('POST', '/entry', {
    date: today,
    actual: String(balance),
    cashRemoved: 0,
    cashAdded: 0,
    cardTransfer: 0,
    declared: '',
  })
  assert.equal(created.status, 200)
  const { status, data } = await req('PATCH', `/entry/${today}`, {
    actual: '550',
    cashRemoved: 0,
    cashAdded: 0,
    cardTransfer: 0,
    declared: 'updated',
  })
  assert.equal(status, 200)
  assert.equal(Number(data.actual), 550)
})

serialTest('DELETE /entry/:date deletes the entry', async () => {
  const today = testDate()
  const balance = await currentBooksBalance()
  const created = await req('POST', '/entry', {
    date: today,
    actual: String(balance),
    cashRemoved: 0,
    cashAdded: 0,
    cardTransfer: 0,
    declared: '',
  })
  assert.equal(created.status, 200)
  const { status } = await req('DELETE', `/entry/${today}`)
  assert.equal(status, 200)
})

serialTest('DELETE /entry/:date for non-existent date returns 404', async () => {
  const { status } = await req('DELETE', '/entry/1999-01-01')
  assert.equal(status, 404)
})

serialTest('POST /entry treats a till expense as accounted cash removed', async () => {
  const day1 = testDate()
  const day2 = testDate()

  const seeded = await req('POST', '/entry', { date: day1, actual: '500' })
  assert.equal(seeded.status, 200)
  await req('POST', '/confirm', { date: day1 })

  const { status, data } = await req('POST', '/entry', {
    date: day2,
    actual: '480',
    expense: '20',
    declared: 'bags of ice',
  })

  assert.equal(status, 200)
  assert.equal(data.status, 'balanced')
  assert.equal(Number(data.expected), 480)
  assert.equal(Number(data.expense), 20)
  assert.equal(data.declared, 'bags of ice')
})

serialTest('POST /entry updates the same dated expense without duplicating the day', async () => {
  const date = testDate()

  const created = await req('POST', '/entry', { date, actual: '0' })
  const opening = Number(created.data.opening)
  const updated = await req('POST', '/entry', {
    date,
    actual: String(opening - 20),
    expense: '20',
    declared: 'more ice',
  })
  const history = await req('GET', '/history')

  assert.equal(updated.status, 200)
  assert.equal(updated.data.status, 'balanced')
  assert.equal(Number(updated.data.expense), 20)
  assert.equal(history.data.entries.filter((entry) => entry.date === date).length, 1)
})

serialTest('POST /entry uses the previous confirmed opening for a backdated day', async () => {
  const day1 = testDate()
  const day2 = testDate()
  const day3 = testDate()
  const day4 = testDate()

  await req('POST', '/entry', {
    date: day1, actual: '500',
  })
  await req('POST', '/confirm', { date: day1 })

  await req('POST', '/entry', {
    date: day2, actual: '450', expense: '50',
  })
  await req('POST', '/confirm', { date: day2 })

  await req('POST', '/entry', {
    date: day4, actual: '400', expense: '50',
  })
  await req('POST', '/confirm', { date: day4 })

  const { status, data } = await req('POST', '/entry', {
    date: day3, actual: '430', expense: '20',
  })

  assert.equal(status, 200)
  assert.equal(data.status, 'balanced')
  assert.equal(Number(data.opening), 450)
  assert.equal(Number(data.expected), 430)
})

serialTest('POST /confirm keeps a newer carried opening when confirming a backdated day', async () => {
  const day1 = testDate()
  const day2 = testDate()
  const day3 = testDate()
  const day4 = testDate()

  await req('POST', '/entry', { date: day1, actual: '500' })
  await req('POST', '/confirm', { date: day1 })

  await req('POST', '/entry', {
    date: day2, actual: '450', expense: '50',
  })
  await req('POST', '/confirm', { date: day2 })

  await req('POST', '/entry', {
    date: day4, actual: '400', expense: '50',
  })
  await req('POST', '/confirm', { date: day4 })

  await req('POST', '/entry', {
    date: day3, actual: '430', expense: '20',
  })
  const confirmed = await req('POST', '/confirm', { date: day3 })
  const state = await req('GET', '/state')

  assert.equal(confirmed.status, 200)
  assert.equal(state.data.openingDate, day4)
  assert.equal(Number(state.data.openingCash), 400)
})

serialTest('PATCH /entry/:date preserves stored amounts when only the note changes', async () => {
  const day1 = testDate()
  const day2 = testDate()

  await req('POST', '/entry', { date: day1, actual: '500' })
  await req('POST', '/confirm', { date: day1 })

  await req('POST', '/entry', {
    date: day2, actual: '480', expense: '20', declared: '',
  })

  // Edit the note only — every amount field is omitted. Stored cents must
  // round-trip unchanged instead of being reinterpreted as euros.
  const patched = await req('PATCH', `/entry/${day2}`, { declared: 'ice run' })
  const history = await req('GET', '/history')
  const entry = history.data.entries.find((e) => e.date === day2)

  assert.equal(patched.status, 200)
  assert.equal(patched.data.status, 'balanced')
  assert.equal(Number(patched.data.actual), 480)
  assert.equal(Number(patched.data.expense), 20)
  assert.equal(entry.declared, 'ice run')
})

serialTest('DELETE /entry/:date falls back to the newest confirmed day for the opening', async () => {
  const day1 = testDate()
  const day2 = testDate()
  const day3 = testDate()

  await req('POST', '/entry', { date: day1, actual: '500' })
  await req('POST', '/confirm', { date: day1 })
  await req('POST', '/entry', { date: day2, actual: '450' })
  await req('POST', '/confirm', { date: day2 })
  // Unconfirmed newer day must not be picked up when day2 is deleted.
  await req('POST', '/entry', { date: day3, actual: '999' })

  const deleted = await req('DELETE', `/entry/${day2}`)
  const state = await req('GET', '/state')

  assert.equal(deleted.status, 200)
  assert.equal(state.data.openingDate, day1)
  assert.equal(Number(state.data.openingCash), 500)
})

serialTest('UI uses a selectable reconciliation date for checking and confirming', () => {
  const html = readFileSync(new URL('./public/index.html', import.meta.url), 'utf8')

  assert.match(html, /<input id="entryDate" type="date"/)
  assert.match(html, /payload\.date = selectedDate\(\)/)
  assert.match(html, /API\.confirm, \{ date: selectedDate\(\) \}/)
})

serialTest('UI labels and submits cash spent from the till as an expense', () => {
  const html = readFileSync(new URL('./public/index.html', import.meta.url), 'utf8')

  assert.match(html, /<label for="expense">Till expense<\/label>/)
  assert.match(html, /expense: document\.getElementById\('expense'\)\.value/)
  assert.match(html, /Till expense €/)
})

serialTest('UI confirmation message does not claim an older day advanced the opening', () => {
  const html = readFileSync(new URL('./public/index.html', import.meta.url), 'utf8')

  assert.match(html, /alert\('Day confirmed\.'\);/)
})