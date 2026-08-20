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

const BASE = `http://127.0.0.1:${process.env.TILL_TEST_PORT || 80}/till/api`

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
  return Number(data.booksBalance || 0)
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
let testDateOffset = 30
function testDate() {
  const d = new Date()
  d.setDate(d.getDate() + testDateOffset++)
  return d.toISOString().slice(0, 10)
}

// --- State tests ---
serialTest('GET /health returns ok', async () => {
  const res = await fetch(`http://127.0.0.1:${process.env.TILL_TEST_PORT || 80}/till/health`)
  const data = await res.json()
  assert.equal(res.status, 200)
  assert.ok(data.ok === true || data.ok === 'true')
})

serialTest('GET /state returns state', async () => {
  const { status, data } = await req('GET', '/state')
  assert.equal(status, 200)
  assert.ok('hasBaseline' in data)
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
  assert.ok('confirmed' in data || 'booksBalance' in data)
})

serialTest('POST /confirm for non-existent date returns 404', async () => {
  const { status } = await req('POST', '/confirm', { date: '1999-01-01' })
  assert.equal(status, 404)
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

// --- People tests ---
serialTest('POST /people creates a person', async () => {
  const { status, data } = await req('POST', '/people', {
    name: 'Test Person ' + Date.now(),
    paySchedule: 'weekly',
    payMethod: 'cash',
    hourlyRate: '15',
  })
  assert.equal(status, 201)
  assert.ok(data.id > 0)
})

serialTest('GET /people returns people list', async () => {
  const { status, data } = await req('GET', '/people')
  assert.equal(status, 200)
  assert.ok(Array.isArray(data.people))
  assert.ok(data.people.length >= 1)
})

serialTest('PATCH /people/:id updates a person', async () => {
  const { status, data } = await req('GET', '/people')
  assert.equal(status, 200)
  if (data.people.length === 0) {
    return
  }
  const personId = data.people[0].id
  const { status: s2, data: updated } = await req('PATCH', `/people/${personId}`, {
    paySchedule: 'hourly',
    payMethod: 'transfer',
  })
  assert.equal(s2, 200)
  assert.equal(updated.paySchedule, 'hourly')
})

serialTest('DELETE /people/:id soft-deletes a person', async () => {
  const { status, data } = await req('GET', '/people')
  assert.equal(status, 200)
  if (data.people.length === 0) {
    return
  }
  const personId = data.people[0].id
  const { status: s2 } = await req('DELETE', `/people/${personId}`)
  assert.equal(s2, 200)
})

serialTest('POST /people with missing name returns 400', async () => {
  const { status } = await req('POST', '/people', { paySchedule: 'weekly' })
  assert.equal(status, 400)
})

// --- Payment tests ---
serialTest('POST /payments creates a payment', async () => {
  const { data: peopleData } = await req('GET', '/people')
  let personId = peopleData.people[0]?.id
  if (!personId) {
    const createRes = await req('POST', '/people', { name: 'Worker ' + Date.now() })
    personId = createRes.data.id
  }
  const { status, data } = await req('POST', '/payments', {
    date: new Date().toISOString().slice(0, 10),
    personId: personId,
    amount: '100',
    payMethod: 'cash',
    note: 'Test payment',
  })
  assert.equal(status, 201)
  assert.equal(Number(data.amount), 100)
})

serialTest('GET /payments returns payments list', async () => {
  const { status, data } = await req('GET', '/payments')
  assert.equal(status, 200)
  assert.ok(Array.isArray(data.payments))
})

serialTest('DELETE /payments/:id deletes a payment', async () => {
  const { status, data } = await req('GET', '/payments')
  assert.equal(status, 200)
  if (data.payments.length === 0) {
    return
  }
  const paymentId = data.payments[0].id
  const { status: s2 } = await req('DELETE', `/payments/${paymentId}`)
  assert.equal(s2, 200)
})

// --- Cost tests ---
serialTest('POST /costs creates a cost', async () => {
  const { status, data } = await req('POST', '/costs', {
    date: new Date().toISOString().slice(0, 10),
    category: 'rent',
    label: 'Test rent',
    amount: '2000',
  })
  assert.equal(status, 201)
  assert.equal(Number(data.amount), 2000)
  assert.equal(data.category, 'rent')
})

serialTest('GET /costs returns costs list', async () => {
  const { status, data } = await req('GET', '/costs')
  assert.equal(status, 200)
  assert.ok(Array.isArray(data.costs))
  assert.ok(data.costs.length >= 1)
})

serialTest('DELETE /costs/:id deletes a cost', async () => {
  const { status, data } = await req('GET', '/costs')
  assert.equal(status, 200)
  if (data.costs.length === 0) {
    return
  }
  const costId = data.costs[0].id
  const { status: s2 } = await req('DELETE', `/costs/${costId}`)
  assert.equal(s2, 200)
})

// --- Monthly closing tests ---
serialTest('GET /monthly/:ym returns monthly summary', async () => {
  const ym = new Date().toISOString().slice(0, 7)
  const { status, data } = await req('GET', `/monthly/${ym}`)
  assert.equal(status, 200)
  assert.ok('closed' in data)
})

serialTest('POST /monthly/:ym closes the month', async () => {
  const ym = new Date().toISOString().slice(0, 7)
  const { status, data } = await req('POST', `/monthly/${ym}`)
  assert.equal(status, 200)
  assert.ok(data)
})

serialTest('GET /monthly returns history', async () => {
  const { status, data } = await req('GET', '/monthly')
  assert.equal(status, 200)
  assert.ok(Array.isArray(data.months))
})

// --- Stats tests ---
serialTest('GET /stats returns stats with defaults', async () => {
  const { status, data } = await req('GET', '/stats')
  assert.equal(status, 200)
  assert.ok('totalEntries' in data)
  assert.ok('totalActual' in data)
  assert.ok('payroll' in data)
  assert.ok('costs' in data)
})

serialTest('GET /stats?from&to returns filtered stats', async () => {
  const ym = new Date().toISOString().slice(0, 7)
  const { status, data } = await req('GET', `/stats?from=${ym}-01&to=${ym}-31`)
  assert.equal(status, 200)
  assert.ok('totalEntries' in data)
})
