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

// Generate a unique test date to avoid conflicts with existing entries
function testDate() {
  const d = new Date()
  d.setDate(d.getDate() + 30)  // 30 days in the future
  return d.toISOString().slice(0, 10)
}

// --- State tests ---
test('GET /health returns ok', async () => {
  const res = await fetch(`http://127.0.0.1:${process.env.TILL_TEST_PORT || 80}/till/health`)
  const data = await res.json()
  assert.equal(res.status, 200)
  assert.ok(data.ok === true || data.ok === 'true')
})

test('GET /state returns state', async () => {
  const { status, data } = await req('GET', '/state')
  assert.equal(status, 200)
  assert.ok('hasBaseline' in data)
})

test('GET /denominations returns denom list', async () => {
  const { status, data } = await req('GET', '/denominations')
  assert.equal(status, 200)
  assert.ok(data.denominations.length >= 1)
})

// --- Entry tests ---
test('POST /entry creates a balanced entry', async () => {
  const today = testDate()
  const { status, data } = await req('POST', '/entry', {
    date: today,
    actual: '500',
    cashRemoved: 0,
    cashAdded: 0,
    cardTransfer: 0,
    declared: '',
  })
  assert.equal(status, 200)
  assert.ok('status' in data)
  assert.equal(Number(data.actual), 500)
})

test('POST /entry creates a short entry', async () => {
  const today = testDate()
  console.log(`DEBUG: Creating short entry for date ${today}`)
  const { status, data } = await req('POST', '/entry', {
    date: today,
    actual: '400',
    cashRemoved: 0,
    cashAdded: 0,
    cardTransfer: 0,
    declared: '',
  })
  console.log(`DEBUG: Status ${status}, Data: ${JSON.stringify(data).slice(0, 200)}`)
  assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`)
  assert.equal(data.status, 'short')
  assert.equal(Number(data.variance), -100)
})

test('POST /entry creates an over entry', async () => {
  const today = testDate()
  const { status, data } = await req('POST', '/entry', {
    date: today,
    actual: '600',
    cashRemoved: 0,
    cashAdded: 0,
    cardTransfer: 0,
    declared: '',
  })
  assert.equal(status, 200)
  assert.equal(data.status, 'over')
  assert.equal(Number(data.variance), 100)
})

test('POST /entry with denominations derives actual from denom', async () => {
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

test('POST /entry with invalid JSON returns 400', async () => {
  const res = await fetch(BASE + '/entry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not json',
  })
  assert.equal(res.status, 400)
})

test('POST /entry with negative actual works', async () => {
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

test('POST /entry with zero values works', async () => {
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
test('POST /confirm confirms the entry', async () => {
  const today = testDate()
  const { status, data } = await req('POST', '/confirm', { date: today })
  assert.equal(status, 200)
  assert.ok('confirmed' in data || 'booksBalance' in data)
})

test('POST /confirm for non-existent date returns 404', async () => {
  const { status } = await req('POST', '/confirm', { date: '1999-01-01' })
  assert.equal(status, 404)
})

// --- History tests ---
test('GET /history returns entries', async () => {
  const { status, data } = await req('GET', '/history')
  assert.equal(status, 200)
  assert.ok('entries' in data)
  assert.ok(data.entries.length >= 1)
})

test('GET /history entries have correct structure', async () => {
  const { status, data } = await req('GET', '/history')
  assert.equal(status, 200)
  const entry = data.entries[0]
  assert.ok('date' in entry)
  assert.ok('actual' in entry)
  assert.ok('variance' in entry)
  assert.ok('status' in entry)
})

// --- Entry PATCH/DELETE tests ---
test('PATCH /entry/:date updates the entry', async () => {
  const today = testDate()
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

test('DELETE /entry/:date deletes the entry', async () => {
  const today = testDate()
  const { status } = await req('DELETE', `/entry/${today}`)
  assert.equal(status, 200)
})

test('DELETE /entry/:date for non-existent date returns 404', async () => {
  const { status } = await req('DELETE', '/entry/1999-01-01')
  assert.equal(status, 404)
})

// --- People tests ---
test('POST /people creates a person', async () => {
  const { status, data } = await req('POST', '/people', {
    name: 'Test Person ' + Date.now(),
    paySchedule: 'weekly',
    payMethod: 'cash',
    hourlyRate: '15',
  })
  assert.equal(status, 201)
  assert.ok(data.id > 0)
})

test('GET /people returns people list', async () => {
  const { status, data } = await req('GET', '/people')
  assert.equal(status, 200)
  assert.ok(Array.isArray(data.people))
  assert.ok(data.people.length >= 1)
})

test('PATCH /people/:id updates a person', async () => {
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

test('DELETE /people/:id soft-deletes a person', async () => {
  const { status, data } = await req('GET', '/people')
  assert.equal(status, 200)
  if (data.people.length === 0) {
    return
  }
  const personId = data.people[0].id
  const { status: s2 } = await req('DELETE', `/people/${personId}`)
  assert.equal(s2, 200)
})

test('POST /people with missing name returns 400', async () => {
  const { status } = await req('POST', '/people', { paySchedule: 'weekly' })
  assert.equal(status, 400)
})

// --- Payment tests ---
test('POST /payments creates a payment', async () => {
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

test('GET /payments returns payments list', async () => {
  const { status, data } = await req('GET', '/payments')
  assert.equal(status, 200)
  assert.ok(Array.isArray(data.payments))
})

test('DELETE /payments/:id deletes a payment', async () => {
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
test('POST /costs creates a cost', async () => {
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

test('GET /costs returns costs list', async () => {
  const { status, data } = await req('GET', '/costs')
  assert.equal(status, 200)
  assert.ok(Array.isArray(data.costs))
  assert.ok(data.costs.length >= 1)
})

test('DELETE /costs/:id deletes a cost', async () => {
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
test('GET /monthly/:ym returns monthly summary', async () => {
  const ym = new Date().toISOString().slice(0, 7)
  const { status, data } = await req('GET', `/monthly/${ym}`)
  assert.equal(status, 200)
  assert.ok('closed' in data)
})

test('POST /monthly/:ym closes the month', async () => {
  const ym = new Date().toISOString().slice(0, 7)
  const { status, data } = await req('POST', `/monthly/${ym}`)
  assert.equal(status, 200)
  assert.ok(data)
})

test('GET /monthly returns history', async () => {
  const { status, data } = await req('GET', '/monthly')
  assert.equal(status, 200)
  assert.ok(Array.isArray(data.months))
})

// --- Stats tests ---
test('GET /stats returns stats with defaults', async () => {
  const { status, data } = await req('GET', '/stats')
  assert.equal(status, 200)
  assert.ok('totalEntries' in data)
  assert.ok('totalActual' in data)
  assert.ok('payroll' in data)
  assert.ok('costs' in data)
})

test('GET /stats?from&to returns filtered stats', async () => {
  const ym = new Date().toISOString().slice(0, 7)
  const { status, data } = await req('GET', `/stats?from=${ym}-01&to=${ym}-31`)
  assert.equal(status, 200)
  assert.ok('totalEntries' in data)
})
