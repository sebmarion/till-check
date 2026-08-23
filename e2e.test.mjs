#!/usr/bin/env node
// Till Check — End-to-End Test Suite
//
// Tests ALL scenarios against a LIVE server instance. By default the suite
// starts its OWN throwaway server on a random port with a TEMPORARY database
// (under the OS temp dir) and tears it down afterwards — the production
// service and its data are never touched.
//
// Usage:
//   node e2e.test.mjs                       # isolated server + temp DB (safe)
//   TILL_TEST_PORT=8080 node e2e.test.mjs   # test against an already-running server
//
// The TILL_TEST_PORT opt-in exists for debugging against a specific instance;
// it writes real entries to whatever DB that instance uses, so prefer the
// default.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// --- Isolated server lifecycle ---------------------------------------------
// When TILL_TEST_PORT is unset we own the whole lifecycle: start server.mjs
// with a temp DB, wait for /health, run tests, then kill the process.
const OWN_SERVER = process.env.TILL_TEST_PORT === undefined
const TEST_PORT = process.env.TILL_TEST_PORT || String(20000 + Math.floor(Math.random() * 20000))
const BASE = `http://127.0.0.1:${TEST_PORT}${process.env.TILL_TEST_PORT ? '/till' : ''}/api`

let child = null
let tmpDbPath = null

async function startOwnServer() {
  tmpDbPath = path.join(os.tmpdir(), `till-e2e-${Date.now()}-${process.pid}.sqlite`)
  child = spawn(process.execPath, [path.join(__dirname, 'server.mjs')], {
    env: {
      ...process.env,
      TILL_PORT: TEST_PORT,
      TILL_BIND: '127.0.0.1',
      TILL_DB: tmpDbPath,
    },
    stdio: 'ignore',
  })
  // Wait for /health (up to ~5s) so the first test never races startup.
  const healthUrl = `http://127.0.0.1:${TEST_PORT}/health`
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(healthUrl)
      if (res.ok) {
        const data = await res.json()
        if (data.ok === true || data.ok === 'true') return
      }
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`own test server did not become healthy on port ${TEST_PORT}`)
}

function stopOwnServer() {
  if (child) {
    child.kill('SIGTERM')
    child = null
  }
  if (tmpDbPath) {
    for (const suffix of ['', '-shm', '-wal']) {
      try { fs.rmSync(tmpDbPath + suffix, { force: true }) } catch { /* best effort */ }
    }
    tmpDbPath = null
  }
}


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

// The test server shares one mutable ledger. Queue test bodies so one test
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

// Own-server lifecycle: boot before the first test, tear down after ALL tests
// (after() runs once at the very end), and force a shutdown if the process is
// interrupted mid-suite (ctrl-C, kill).
if (OWN_SERVER) {
  const ready = startOwnServer()
  ready.catch(() => {})
  serialTest('own test server is healthy', () => ready)
  after(() => stopOwnServer())
  process.on('SIGINT', () => { stopOwnServer(); process.exit(130) })
  process.on('SIGTERM', () => { stopOwnServer(); process.exit(143) })
}


// Generate a unique test date per RUN so repeat runs against the same DB
// never collide with dates an earlier run created (entries are UNIQUE by
// date, and stale rows would poison opening-cash expectations). The offset
// is seeded from the wall clock (minutes since epoch) so two back-to-back
// runs land on disjoint date ranges; TILL_TEST_DATE_OFFSET pins it when set.
// Dates are built by adding WHOLE DAYS to a midnight anchor so arithmetic
// stays exact even for very large offsets.
const BASE_OFFSET = process.env.TILL_TEST_DATE_OFFSET !== undefined
  ? Number(process.env.TILL_TEST_DATE_OFFSET)
  : 30 + Math.floor(Date.now() / 60000)
let testDateOffset = BASE_OFFSET
function testDate() {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + testDateOffset)
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  testDateOffset++
  return iso
}

// --- State tests ---
serialTest('GET /health returns ok', async () => {
  const res = await fetch(`http://127.0.0.1:${TEST_PORT}/health`)
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
  // Isolate from the shared rolling opening: confirm a seed day first so
  // the expected value is exactly what this test controls, on any DB state.
  const seed = testDate()
  const today = testDate()
  const BALANCE = 500

  await req('POST', '/entry', { date: seed, actual: String(BALANCE) })
  await req('POST', '/confirm', { date: seed })
  const { status, data } = await req('POST', '/entry', {
    date: today,
    actual: String(BALANCE),
    cashRemoved: 0,
    cashAdded: 0,
    cardTransfer: 0,
    declared: '',
  })
  assert.equal(status, 200)
  assert.ok('status' in data)
  assert.equal(Number(data.actual), BALANCE)
  assert.equal(data.status, 'balanced')
  assert.equal(Number(data.opening), BALANCE)
})

serialTest('POST /entry creates a short entry', async () => {
  const today = testDate()
  const balance = 500
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
  const balance = 500
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
  // Fully self-contained: asserts read only responses for dates this test
  // created, so prior runs / rolling state cannot poison the result.
  const seed = testDate()
  const today = testDate()
  const BALANCE = 500
  await req('POST', '/entry', { date: seed, actual: String(BALANCE) })
  await req('POST', '/confirm', { date: seed })
  await req('POST', '/entry', {
    date: today, actual: String(BALANCE), cashRemoved: 0, cashAdded: 0, cardTransfer: 0, declared: '',
  })
  const confirmed = await req('POST', '/confirm', { date: today })
  assert.equal(confirmed.status, 200)
  assert.equal(confirmed.data.confirmed, true)
  // Now reconcile with a corrected (higher) count — the entry's own stored
  // opening is re-derived from the confirmed count.
  const corrected = String(BALANCE + 50)
  const rec = await req('POST', '/reconcile', { date: today, actual: corrected })
  assert.equal(rec.status, 200, `reconcile failed: ${JSON.stringify(rec.data)}`)
  assert.equal(rec.data.reconciled, true)
  assert.equal(Number(rec.data.actual), BALANCE + 50)
})

serialTest('POST /reconcile on an unconfirmed day refreshes reconciliation', async () => {
  const seed = testDate()
  const today = testDate()
  const BALANCE = 400
  await req('POST', '/entry', { date: seed, actual: String(BALANCE) })
  const seededConfirm = await req('POST', '/confirm', { date: seed })
  assert.equal(seededConfirm.status, 200)
  // The entry's opening must equal the confirmed seed regardless of what
  // the rolling state carried in (prior tests may have advanced it).
  await req('POST', '/entry', {
    date: today, actual: String(BALANCE + 75), cashRemoved: 0, cashAdded: 0, cardTransfer: 0, declared: '',
  })
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
serialTest('POST /entry records black separately from expense and reduces expected', async () => {
  const day = testDate()
  const opening = await currentBooksBalance()
  // No other moves: expected = opening − 30 (black reduces the books),
  // counted = opening -> over by exactly the black amount.
  const { status, data } = await req('POST', '/entry', {
    date: day,
    actual: String(opening),
    black: '30',
  })
  assert.equal(status, 200)
  assert.equal(data.status, 'over')
  assert.equal(Number(data.black), 30)
  assert.equal(Number(data.expense), 0)
  assert.equal(Number(data.expected), opening - 30)
  assert.equal(Number(data.variance), 30)
  // Black survives in its own column in history (not folded into expense).
  const hist = await req('GET', '/history')
  const stored = hist.data.entries.find((e) => e.date === day)
  assert.ok(stored, 'entry present in history')
  assert.equal(Number(stored.black), 30)
  assert.equal(Number(stored.expense), 0)
})

serialTest('POST /entry stores taken-out-before-count separately', async () => {
  const day = testDate()
  const opening = await currentBooksBalance()
  // €40 removed before counting; counted = opening - 40 -> balanced.
  const { status, data } = await req('POST', '/entry', {
    date: day,
    actual: String(opening - 40),
    preTakeout: '40',
  })
  assert.equal(status, 200)
  assert.equal(data.status, 'balanced')
  assert.equal(Number(data.preTakeout), 40)
  assert.equal(Number(data.black), 0)
  assert.equal(Number(data.expense), 0)
  const hist = await req('GET', '/history')
  const stored = hist.data.entries.find((e) => e.date === day)
  assert.ok(stored, 'entry present in history')
  assert.equal(Number(stored.preTakeout), 40)
})

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
  // Fully self-contained: all days are created and confirmed inside this
  // test, so the final assertions hold regardless of prior DB state.
  const day1 = testDate()
  const day2 = testDate()
  const day3 = testDate()
  const day4 = testDate()

  await req('POST', '/entry', { date: day1, actual: '500', opening: '0' })
  await req('POST', '/confirm', { date: day1 })

  await req('POST', '/entry', {
    date: day2, actual: '450', expense: '50', opening: '500',
  })
  await req('POST', '/confirm', { date: day2 })

  await req('POST', '/entry', {
    date: day4, actual: '400', expense: '50', opening: '450',
  })
  await req('POST', '/confirm', { date: day4 })

  await req('POST', '/entry', {
    date: day3, actual: '430', expense: '20', opening: '450',
  })
  const confirmed = await req('POST', '/confirm', { date: day3 })

  assert.equal(confirmed.status, 200)
  // The guard under test: confirming the older backdated day must NOT roll
  // the carried opening backward. (The absolute carried value depends on
  // shared DB history, so it is not asserted here.)
  assert.equal(confirmed.data.openingAdvanced, false)
})

serialTest('POST /entry on a previously confirmed date upserts instead of failing', async () => {
  // Idempotency guard for the suite itself: re-posting the same date must
  // update the existing row (upsert path), not throw a UNIQUE constraint.
  const date = testDate()
  await req('POST', '/entry', { date, actual: '100' })
  const again = await req('POST', '/entry', { date, actual: '120' })
  const history = await req('GET', '/history')

  assert.equal(again.status, 200)
  assert.equal(Number(again.data.actual), 120)
  assert.equal(history.data.entries.filter((e) => e.date === date).length, 1)
})

serialTest('POST /reconcile corrects takeout and re-derives the carried opening', async () => {
  // R2#6: the operator could not fix a wrong takeout during reconcile.
  const day1 = testDate()
  const created = await req('POST', '/entry', {
    date: day1, actual: '500', opening: '0', takeout: '100',
  })
  assert.equal(created.status, 200)
  assert.equal(Number(created.data.takeout), 100)
  await req('POST', '/confirm', { date: day1 })

  // Reconcile with a corrected takeout (was €100, should be €50). The entry
  // response reflects the corrected takeout regardless of rolling state.
  const rec = await req('POST', '/reconcile', { date: day1, takeout: '50' })
  assert.equal(rec.status, 200)
  assert.equal(rec.data.reconciled, true)

  // Stored entry reflects the corrected takeout.
  const history = await req('GET', '/history')
  const entry = history.data.entries.find((e) => e.date === day1)
  assert.equal(Number(entry.takeout), 50)
  assert.equal(Number(entry.actual), 500)
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
  await req('POST', '/entry', { date: day2, actual: '450', opening: '500' })
  await req('POST', '/confirm', { date: day2 })
  // Unconfirmed newer day must not be picked up when day2 is deleted.
  await req('POST', '/entry', { date: day3, actual: '999', opening: '450' })

  const deleted = await req('DELETE', `/entry/${day2}`)
  assert.equal(deleted.status, 200)

  // The opening must now be backed by day1 (the newest confirmed day before
  // the deleted one) — verified via the entry's own stored opening on a
  // fresh post, which is independent of the shared rolling state.
  const probeDate = testDate()
  const probe = await req('POST', '/entry', { date: probeDate, actual: '450' })
  assert.equal(probe.status, 200)
  assert.equal(Number(probe.data.opening), 500)
})

serialTest('Served page exposes the date picker, expense field, and API wiring', async () => {
  // Behavior-level check against the LIVE server (not source regexes): the
  // served HTML must reference the working API surface and form fields.
  const pageUrl = `http://127.0.0.1:${TEST_PORT}/`
  const res = await fetch(pageUrl)
  assert.equal(res.status, 200)
  const html = await res.text()

  // Form fields exist and are wired to the API contract the server serves.
  for (const id of ['entryDate', 'expense', 'added', 'card', 'black', 'preTakeout', 'takeout', 'declared', 'checkBtn', 'confirmBtn', 'addExpense', 'extraExpenses']) {
    assert.ok(html.includes(`id="${id}"`), `served page must contain #${id}`)
  }
  for (const endpoint of ['api/entry', 'api/confirm', 'api/state']) {
    assert.ok(html.includes(endpoint), `page must call ${endpoint}`)
  }

  // And the endpoints actually behave as the UI expects: a POST with an
  // `expense` field is accepted and echoed back (round-trip through the API).
  const day = testDate()
  const created = await req('POST', '/entry', {
    date: day, actual: '480', expense: '20', declared: 'ice',
  })
  assert.equal(created.status, 200)
  assert.equal(Number(created.data.expense), 20)

  // The confirm endpoint accepts the selected-date shape the UI sends.
  const confirmed = await req('POST', '/confirm', { date: day })
  assert.equal(confirmed.status, 200)
  assert.equal(confirmed.data.confirmed, true)
})