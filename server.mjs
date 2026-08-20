#!/usrbin/env node
// Till Check — single-file, zero-dependency server.
//
// - Node stdlib only (node:http, node:sqlite, node:fs). No framework, no deps.
// - Persists to data/till.sqlite (WAL). Tables: state, entries.
// - Serves the mobile page at / and a small JSON API.
// - Binds 127.0.0.1 only; nginx proxies the public /till/ route.
//
// Run:  node server.mjs
// Env:  TILL_PORT (default 3401), TILL_DB (default ./data/till.sqlite),
//       TILL_BIND (default 127.0.0.1)

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import {
  reconcileDay,
  eurosToCents,
  centsToEuros,
  STATUS,
  DENOMINATIONS,
} from './reconcile.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.TILL_PORT || 3401)
const HOST = process.env.TILL_BIND || '127.0.0.1'
const DB_PATH =
  process.env.TILL_DB || path.join(__dirname, 'data', 'till.sqlite')

// ---------------------------------------------------------------------------
// Persistence (node:sqlite, WAL, single-file)
// ---------------------------------------------------------------------------

const dir = path.dirname(DB_PATH)
fs.mkdirSync(dir, { recursive: true })

const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA journal_mode = WAL;')
db.exec('PRAGMA foreign_keys = ON;')
db.exec(`
CREATE TABLE IF NOT EXISTS state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  books_balance_cents INTEGER NOT NULL,
  baseline_cents INTEGER NOT NULL,
  baseline_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  actual_cents INTEGER NOT NULL,
  cash_removed_cents INTEGER NOT NULL DEFAULT 0,
  cash_added_cents INTEGER NOT NULL DEFAULT 0,
  card_transfer_cents INTEGER NOT NULL DEFAULT 0,
  declared_note TEXT NOT NULL DEFAULT '',
  denominations TEXT NOT NULL DEFAULT '',
  expected_cents INTEGER NOT NULL,
  variance_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date DESC);
`)

// Migration: add columns that may be missing from older databases.
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all()
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}
ensureColumn('entries', 'denominations', "TEXT NOT NULL DEFAULT ''")

// --- Payroll, costs, and monthly closings tables (Phase 1) ---
db.exec(`
CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  pay_schedule TEXT NOT NULL DEFAULT 'weekly',
  pay_method TEXT NOT NULL DEFAULT 'cash',
  hourly_rate_cents INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_people_active ON people(active);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  person_id INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  pay_method TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(date DESC);
CREATE INDEX IF NOT EXISTS idx_payments_person ON payments(person_id);

CREATE TABLE IF NOT EXISTS costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  category TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_costs_date ON costs(date DESC);
CREATE INDEX IF NOT EXISTS idx_costs_category ON costs(category);

CREATE TABLE IF NOT EXISTS monthly_closings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year_month TEXT NOT NULL UNIQUE,
  total_cents INTEGER NOT NULL,
  payroll_cents INTEGER NOT NULL,
  costs_cents INTEGER NOT NULL,
  net_cents INTEGER NOT NULL,
  daily_count INTEGER NOT NULL,
  avg_variance_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`)

function nowIso() {
  return new Date().toISOString()
}

function todayKey() {
  // Local calendar date YYYY-MM-DD (matches the day the operator is counting).
  return new Date().toISOString().slice(0, 10)
}

function getState() {
  const row = db
    .prepare('SELECT books_balance_cents, baseline_cents, baseline_date FROM state WHERE id = 1')
    .get()
  if (row) {
    return {
      booksBalanceCents: row.books_balance_cents,
      baselineCents: row.baseline_cents,
      baselineDate: row.baseline_date,
    }
  }
  return null
}

function upsertEntry(entry) {
  const existing = db.prepare('SELECT id FROM entries WHERE date = ?').get(entry.date)
  if (existing) {
    db.prepare(
      `UPDATE entries SET
         actual_cents = @actual_cents, cash_removed_cents = @cash_removed_cents,
         cash_added_cents = @cash_added_cents, card_transfer_cents = @card_transfer_cents,
         declared_note = @declared_note, denominations = @denominations,
         expected_cents = @expected_cents,
         variance_cents = @variance_cents, status = @status, updated_at = @updated_at
       WHERE id = @id`,
    ).run({
      id: existing.id,
      actual_cents: entry.actual_cents,
      cash_removed_cents: entry.cash_removed_cents,
      cash_added_cents: entry.cash_added_cents,
      card_transfer_cents: entry.card_transfer_cents,
      declared_note: entry.declared_note,
      denominations: entry.denominations,
      expected_cents: entry.expected_cents,
      variance_cents: entry.variance_cents,
      status: entry.status,
      updated_at: entry.updated_at,
    })
  } else {
    db.prepare(
      `INSERT INTO entries (date, actual_cents, cash_removed_cents, cash_added_cents,
        card_transfer_cents, declared_note, denominations, expected_cents, variance_cents, status,
        created_at, updated_at)
       VALUES (@date, @actual_cents, @cash_removed_cents, @cash_added_cents,
        @card_transfer_cents, @declared_note, @denominations, @expected_cents, @variance_cents,
        @status, @created_at, @updated_at)`,
    ).run(entry)
  }
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
}

function sendJson(res, code, body) {
  const payload = JSON.stringify(body)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    ...SECURITY_HEADERS,
  })
  res.end(payload)
}

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

function parseAmount(raw) {
  if (raw === undefined || raw === null || raw === '') return 0
  return eurosToCents(raw)
}

// ---------------------------------------------------------------------------
// API handlers (pure; return { code, body })
// ---------------------------------------------------------------------------

function handleGetState() {
  const state = getState()
  const today = todayKey()
  const todayRow = db.prepare('SELECT * FROM entries WHERE date = ?').get(today)
  return {
    hasBaseline: state !== null,
    booksBalance: state ? centsToEuros(state.booksBalanceCents) : null,
    baselineDate: state ? state.baselineDate : null,
    today,
    hasTodayEntry: !!todayRow,
  }
}

function handleGetDenominations() {
  return { code: 200, body: { denominations: DENOMINATIONS } }
}

async function handlePostEntry(req) {
  const raw = await readBody(req)
  let body
  try {
    body = JSON.parse(raw || '{}')
  } catch {
    return { code: 400, body: { error: 'invalid JSON body' } }
  }
  const state = getState()
  if (!state) {
    return { code: 409, body: { error: 'no baseline set' } }
  }
  const today = body.date || todayKey()
  const declared = typeof body.declared === 'string' ? body.declared : ''
  // Denominations: a map like { "50": 3, "20": 2, "1": 5 } (counts per denomination).
  // When present, the total is derived from denominations (overrides `actual`).
  const denominations =
    body.denominations && typeof body.denominations === 'object'
      ? body.denominations
      : null
  const result = reconcileDay(
    {
      actual: body.actual,
      cashRemoved: body.cashRemoved ?? 0,
      cashAdded: body.cashAdded ?? 0,
      cardTransfer: body.cardTransfer ?? 0,
      declared,
      denominations,
    },
    state.booksBalanceCents,
  )
  const entry = {
    date: today,
    actual_cents: result.actualCents,
    cash_removed_cents: result.removedCents,
    cash_added_cents: result.addedCents,
    card_transfer_cents: result.cardCents,
    declared_note: result.declared,
    denominations: denominations ? JSON.stringify(denominations) : '',
    expected_cents: result.expectedCents,
    variance_cents: result.varianceCents,
    status: result.status,
    created_at: nowIso(),
    updated_at: nowIso(),
  }
  upsertEntry(entry)
  return { code: 200, body: entryToView(entry) }
}

function entryToView(row) {
  let denominations = null
  if (row.denominations) {
    try { denominations = JSON.parse(row.denominations) } catch { denominations = null }
  }
  return {
    date: row.date,
    actual: centsToEuros(row.actual_cents),
    cashRemoved: centsToEuros(row.cash_removed_cents),
    cashAdded: centsToEuros(row.cash_added_cents),
    cardTransfer: centsToEuros(row.card_transfer_cents),
    declared: row.declared_note,
    denominations,
    expected: centsToEuros(row.expected_cents),
    variance: centsToEuros(row.variance_cents),
    status: row.status,
    confirmed: !!row.confirmed_at,
  }
}

async function handlePostConfirm(req) {
  const raw = await readBody(req)
  let body
  try {
    body = JSON.parse(raw || '{}')
  } catch {
    return { code: 400, body: { error: 'invalid JSON body' } }
  }
  const date = body.date || todayKey()
  const row = db.prepare('SELECT * FROM entries WHERE date = ?').get(date)
  if (!row) {
    return { code: 404, body: { error: 'no entry for that date' } }
  }
  // Confirming folds the actual count into the books (running baseline).
  db.prepare(
    'INSERT INTO state (id, books_balance_cents, baseline_cents, baseline_date, created_at, updated_at) VALUES (1, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET books_balance_cents = excluded.books_balance_cents, baseline_date = excluded.baseline_date, updated_at = excluded.updated_at',
  ).run(row.actual_cents, row.actual_cents, date, nowIso(), nowIso())
  db.prepare('UPDATE entries SET confirmed_at = ? WHERE date = ?').run(nowIso(), date)
  return { code: 200, body: { confirmed: true, date, booksBalance: centsToEuros(row.actual_cents) } }
}

function handleGetHistory() {
  const rows = db.prepare('SELECT * FROM entries ORDER BY date DESC LIMIT 90').all()
  return { code: 200, body: { entries: rows.map(entryToView) } }
}

function handleDeleteEntry(date) {
  const row = db.prepare('SELECT * FROM entries WHERE date = ?').get(date)
  if (!row) return { code: 404, body: { error: 'no entry for that date' } }
  const state = getState()
  // If this was the entry that last set the books baseline (confirmed),
  // revert the baseline to the previous entry's actual (or the original
  // baseline if none). Keeps the running books consistent after deletion.
  if (row.confirmed_at && state && state.baseline_date === date) {
    const prev = db.prepare(
      'SELECT actual_cents FROM entries WHERE date < ? ORDER BY date DESC LIMIT 1'
    ).get(date)
    const newBalance = prev ? prev.actual_cents : state.baseline_cents
    db.prepare(
      'UPDATE state SET books_balance_cents = ?, baseline_date = ?, updated_at = ? WHERE id = 1'
    ).run(newBalance, prev ? prev.date : state.baseline_date, nowIso())
  }
  db.prepare('DELETE FROM entries WHERE date = ?').run(date)
  return { code: 200, body: { deleted: true, date } }
}

async function handlePatchEntry(req, date) {
  const row = db.prepare('SELECT * FROM entries WHERE date = ?').get(date)
  if (!row) return { code: 404, body: { error: 'no entry for that date' } }
  const raw = await readBody(req)
  let body
  try {
    body = JSON.parse(raw || '{}')
  } catch {
    return { code: 400, body: { error: 'invalid JSON body' } }
  }
  const state = getState()
  if (!state) return { code: 409, body: { error: 'no baseline set' } }
  // Denominations: preserve existing unless explicitly overridden.
  let denomObj = null
  try { denomObj = row.denominations ? JSON.parse(row.denominations) : null } catch { denomObj = null }
  if (body.denominations !== undefined) {
    denomObj = body.denominations && typeof body.denominations === 'object' ? body.denominations : null
  }
  const result = reconcileDay(
    {
      actual: body.actual !== undefined ? body.actual : row.actual_cents,
      cashRemoved: body.cashRemoved ?? row.cash_removed_cents,
      cashAdded: body.cashAdded ?? row.cash_added_cents,
      cardTransfer: body.cardTransfer ?? row.card_transfer_cents,
      declared: body.declared ?? row.declared_note,
      denominations: denomObj,
    },
    state.booksBalanceCents,
  )
  const entry = {
    id: row.id,
    date,
    actual_cents: result.actualCents,
    cash_removed_cents: result.removedCents,
    cash_added_cents: result.addedCents,
    card_transfer_cents: result.cardCents,
    declared_note: result.declared,
    denominations: denomObj ? JSON.stringify(denomObj) : '',
    expected_cents: result.expectedCents,
    variance_cents: result.varianceCents,
    status: result.status,
    created_at: row.created_at,
    updated_at: nowIso(),
  }
  upsertEntry(entry)
  return { code: 200, body: entryToView({ ...entry, confirmed_at: row.confirmed_at }) }
}

// ---------------------------------------------------------------------------
// Payroll, costs, monthly closings, and stats handlers (Phase 1)
// ---------------------------------------------------------------------------

function personToView(row) {
  return {
    id: row.id,
    name: row.name,
    paySchedule: row.pay_schedule,
    payMethod: row.pay_method,
    hourlyRate: centsToEuros(row.hourly_rate_cents),
    active: !!row.active,
    createdAt: row.created_at,
  }
}

function paymentToView(row, personName) {
  return {
    id: row.id,
    date: row.date,
    personId: row.person_id,
    personName: personName || `person ${row.person_id}`,
    amount: centsToEuros(row.amount_cents),
    payMethod: row.pay_method,
    note: row.note,
    createdAt: row.created_at,
  }
}

function costToView(row) {
  return {
    id: row.id,
    date: row.date,
    category: row.category,
    label: row.label,
    amount: centsToEuros(row.amount_cents),
    createdAt: row.created_at,
  }
}

function handleGetPeople() {
  const rows = db.prepare('SELECT * FROM people WHERE active = 1 ORDER BY name').all()
  return { code: 200, body: { people: rows.map(personToView) } }
}

async function handlePostPeople(req) {
  const raw = await readBody(req)
  let body
  try {
    body = JSON.parse(raw || '{}')
  } catch {
    return { code: 400, body: { error: 'invalid JSON body' } }
  }
  const name = (body.name || '').trim()
  if (!name) return { code: 400, body: { error: 'name is required' } }
  const paySchedule = ['weekly', 'hourly', 'monthly'].includes(body.paySchedule) ? body.paySchedule : 'weekly'
  const payMethod = ['cash', 'transfer', 'transfer_cash'].includes(body.payMethod) ? body.payMethod : 'cash'
  const hourlyRateCents = parseAmount(body.hourlyRate || 0)
  const result = db.prepare(
    'INSERT INTO people (name, pay_schedule, pay_method, hourly_rate_cents, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)'
  ).run(name, paySchedule, payMethod, hourlyRateCents, nowIso(), nowIso())
  const row = db.prepare('SELECT * FROM people WHERE id = ?').get(result.lastInsertRowid)
  return { code: 201, body: personToView(row) }
}

function handlePatchPeople(id) {
  const row = db.prepare('SELECT * FROM people WHERE id = ?').get(id)
  if (!row) return { code: 404, body: { error: 'person not found' } }
  return { code: 200, body: personToView(row) }
}

async function handlePatchPeopleBody(req, id) {
  const row = db.prepare('SELECT * FROM people WHERE id = ?').get(id)
  if (!row) return { code: 404, body: { error: 'person not found' } }
  const raw = await readBody(req)
  let body
  try {
    body = JSON.parse(raw || '{}')
  } catch {
    return { code: 400, body: { error: 'invalid JSON body' } }
  }
  const name = body.name !== undefined ? body.name.trim() : row.name
  const paySchedule = body.paySchedule !== undefined ? body.paySchedule : row.pay_schedule
  const payMethod = body.payMethod !== undefined ? body.payMethod : row.pay_method
  const hourlyRateCents = body.hourlyRate !== undefined ? parseAmount(body.hourlyRate) : row.hourly_rate_cents
  db.prepare(
    'UPDATE people SET name = ?, pay_schedule = ?, pay_method = ?, hourly_rate_cents = ?, updated_at = ? WHERE id = ?'
  ).run(name, paySchedule, payMethod, hourlyRateCents, nowIso(), id)
  const updated = db.prepare('SELECT * FROM people WHERE id = ?').get(id)
  return { code: 200, body: personToView(updated) }
}

async function handleDeletePeople(req, id) {
  const row = db.prepare('SELECT * FROM people WHERE id = ?').get(id)
  if (!row) return { code: 404, body: { error: 'person not found' } }
  db.prepare('UPDATE people SET active = 0, updated_at = ? WHERE id = ?').run(nowIso(), id)
  return { code: 200, body: { deleted: true, id } }
}

function handleGetPayments() {
  const rows = db.prepare(
    'SELECT p.*, pe.name AS person_name FROM payments p LEFT JOIN people pe ON p.person_id = pe.id ORDER BY p.date DESC LIMIT 100'
  ).all()
  return { code: 200, body: { payments: rows.map(r => paymentToView(r, r.person_name)) } }
}

async function handlePostPayment(req) {
  const raw = await readBody(req)
  let body
  try {
    body = JSON.parse(raw || '{}')
  } catch {
    return { code: 400, body: { error: 'invalid JSON body' } }
  }
  const date = body.date || todayKey()
  const personId = body.personId
  const person = db.prepare('SELECT * FROM people WHERE id = ? AND active = 1').get(personId)
  if (!person) return { code: 404, body: { error: 'person not found' } }
  const amountCents = parseAmount(body.amount || 0)
  const payMethod = body.payMethod || person.pay_method
  const note = body.note || ''
  const result = db.prepare(
    'INSERT INTO payments (date, person_id, amount_cents, pay_method, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(date, personId, amountCents, payMethod, note, nowIso(), nowIso())
  const row = db.prepare('SELECT * FROM payments WHERE id = ?').get(result.lastInsertRowid)
  return { code: 201, body: paymentToView(row, person.name) }
}

function handleDeletePayment(id) {
  const row = db.prepare('SELECT * FROM payments WHERE id = ?').get(id)
  if (!row) return { code: 404, body: { error: 'payment not found' } }
  db.prepare('DELETE FROM payments WHERE id = ?').run(id)
  return { code: 200, body: { deleted: true, id } }
}

function handleGetCosts() {
  const rows = db.prepare('SELECT * FROM costs ORDER BY date DESC LIMIT 100').all()
  return { code: 200, body: { costs: rows.map(costToView) } }
}

async function handlePostCost(req) {
  const raw = await readBody(req)
  let body
  try {
    body = JSON.parse(raw || '{}')
  } catch {
    return { code: 400, body: { error: 'invalid JSON body' } }
  }
  const date = body.date || todayKey()
  const category = body.category || 'other'
  const label = body.label || ''
  const amountCents = parseAmount(body.amount || 0)
  const result = db.prepare(
    'INSERT INTO costs (date, category, label, amount_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(date, category, label, amountCents, nowIso(), nowIso())
  const row = db.prepare('SELECT * FROM costs WHERE id = ?').get(result.lastInsertRowid)
  return { code: 201, body: costToView(row) }
}

function handleDeleteCost(id) {
  const row = db.prepare('SELECT * FROM costs WHERE id = ?').get(id)
  if (!row) return { code: 404, body: { error: 'cost not found' } }
  db.prepare('DELETE FROM costs WHERE id = ?').run(id)
  return { code: 200, body: { deleted: true, id } }
}

function handleGetMonthly(yearMonth) {
  // Compute monthly closing for a given month (YYYY-MM)
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return { code: 400, body: { error: 'invalid year_month' } }
  const startMonth = `${yearMonth}-01`
  const endMonth = `${yearMonth}-31`
  // Sum daily entries
  const daily = db.prepare(
    'SELECT COALESCE(SUM(actual_cents), 0) as total, COUNT(*) as count, COALESCE(AVG(variance_cents), 0) as avg_var FROM entries WHERE date >= ? AND date <= ?'
  ).get(startMonth, endMonth)
  const totalCents = Number(daily.total) || 0
  const avgVarianceCents = Math.round(Number(daily.avg_var) || 0)
  const dailyCount = Number(daily.count) || 0
  
  // Sum payroll
  const payroll = db.prepare('SELECT COALESCE(SUM(amount_cents), 0) as total FROM payments WHERE date >= ? AND date <= ?').get(startMonth, endMonth)
  const payrollCents = Number(payroll.total) || 0
  
  // Sum costs
  const costs = db.prepare('SELECT COALESCE(SUM(amount_cents), 0) as total FROM costs WHERE date >= ? AND date <= ?').get(startMonth, endMonth)
  const costsCents = Number(costs.total) || 0
  
  const netCents = totalCents - payrollCents - costsCents
  
  // Check if already closed
  const existing = db.prepare('SELECT * FROM monthly_closings WHERE year_month = ?').get(yearMonth)
  
  return { code: 200, body: {
    yearMonth,
    total: centsToEuros(totalCents),
    payroll: centsToEuros(payrollCents),
    costs: centsToEuros(costsCents),
    net: centsToEuros(netCents),
    dailyCount,
    avgVariance: centsToEuros(avgVarianceCents),
    closed: !!existing,
  } }
}

function handleGetMonthlyHistory() {
  const rows = db.prepare('SELECT * FROM monthly_closings ORDER BY year_month DESC').all()
  return { code: 200, body: { months: rows.map(row => ({
    yearMonth: row.year_month,
    total: centsToEuros(row.total_cents),
    payroll: centsToEuros(row.payroll_cents),
    costs: centsToEuros(row.costs_cents),
    net: centsToEuros(row.net_cents),
    dailyCount: row.daily_count,
    avgVariance: centsToEuros(row.avg_variance_cents),
    closedAt: row.updated_at,
  })) } }
}

async function handlePostMonthly(req, yearMonth) {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return { code: 400, body: { error: 'invalid year_month' } }
  const startMonth = `${yearMonth}-01`
  const endMonth = `${yearMonth}-31`
  const daily = db.prepare(
    'SELECT COALESCE(SUM(actual_cents), 0) as total, COUNT(*) as count, COALESCE(AVG(variance_cents), 0) as avg_var FROM entries WHERE date >= ? AND date <= ?'
  ).get(startMonth, endMonth)
  const payroll = db.prepare(
    'SELECT COALESCE(SUM(amount_cents), 0) as total FROM payments WHERE date >= ? AND date <= ?'
  ).get(startMonth, endMonth)
  const costs = db.prepare(
    'SELECT COALESCE(SUM(amount_cents), 0) as total FROM costs WHERE date >= ? AND date <= ?'
  ).get(startMonth, endMonth)
  const totalCents = daily.total || 0
  const payrollCents = payroll.total || 0
  const costsCents = costs.total || 0
  const netCents = totalCents - payrollCents - costsCents
  const avgVarianceCents = Math.round(daily.avg_var || 0)
  db.prepare(
    'INSERT INTO monthly_closings (year_month, total_cents, payroll_cents, costs_cents, net_cents, daily_count, avg_variance_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(year_month) DO UPDATE SET total_cents = excluded.total_cents, payroll_cents = excluded.payroll_cents, costs_cents = excluded.costs_cents, net_cents = excluded.net_cents, daily_count = excluded.daily_count, avg_variance_cents = excluded.avg_variance_cents, updated_at = excluded.updated_at'
  ).run(yearMonth, totalCents, payrollCents, costsCents, netCents, daily.count || 0, avgVarianceCents, nowIso(), nowIso())
  return { code: 200, body: { closed: true, yearMonth } }
}

function handleGetStats(req) {
  const url = new URL(req.url, 'http://127.0.0.1')
  // Default: current month if no params provided
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const from = url.searchParams.get('from') || `${currentMonth}-01`
  const to = url.searchParams.get('to') || `${now.toISOString().slice(0, 10)}`
  const rows = db.prepare(
    'SELECT * FROM entries WHERE date >= ? AND date <= ? ORDER BY date'
  ).all(from, to)
  const totalEntries = rows.length
  const totalActual = rows.reduce((sum, r) => sum + r.actual_cents, 0)
  const totalVariance = rows.reduce((sum, r) => sum + r.variance_cents, 0)
  const balancedCount = rows.filter(r => r.status === 'balanced').length
  const shortCount = rows.filter(r => r.status === 'short').length
  const overCount = rows.filter(r => r.status === 'over').length
  
  // Payroll and costs breakdown for the period
  const payments = db.prepare('SELECT COALESCE(SUM(amount_cents), 0) as total FROM payments WHERE date >= ? AND date <= ?').get(from, to)
  const costs = db.prepare('SELECT COALESCE(SUM(amount_cents), 0) as total FROM costs WHERE date >= ? AND date <= ?').get(from, to)
  
  return {
    code: 200,
    body: {
      from, to,
      totalEntries,
      totalActual: centsToEuros(totalActual),
      totalVariance: centsToEuros(totalVariance),
      balanced: balancedCount,
      short: shortCount,
      over: overCount,
      payroll: centsToEuros(payments.total),
      costs: centsToEuros(costs.total),
      net: centsToEuros(totalActual - payments.total - costs.total),
    },
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function handle(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1')
  const pathname = url.pathname
  const method = req.method

  if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf-8')
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS })
    res.end(html)
    return
  }

  if (method === 'GET' && pathname === '/health') {
    sendJson(res, 200, { ok: true, service: 'till-check', db: fs.existsSync(DB_PATH) })
    return
  }

  if (pathname === '/api/state' && method === 'GET') {
    const s = handleGetState()
    sendJson(res, 200, s)
    return
  }

  if (pathname === '/api/denominations' && method === 'GET') {
    const r = handleGetDenominations()
    sendJson(res, r.code, r.body)
    return
  }

  if (pathname === '/api/entry' && method === 'POST') {
    const r = await handlePostEntry(req)
    sendJson(res, r.code, r.body)
    return
  }

  if (pathname === '/api/confirm' && method === 'POST') {
    const r = await handlePostConfirm(req)
    sendJson(res, r.code, r.body)
    return
  }

  if (pathname === '/api/history' && method === 'GET') {
    const r = handleGetHistory()
    sendJson(res, r.code, r.body)
    return
  }

  if (pathname.startsWith('/api/entry/') && method === 'PATCH') {
    const date = pathname.split('/').pop()
    const r = await handlePatchEntry(req, decodeURIComponent(date))
    sendJson(res, r.code, r.body)
    return
  }

  if (pathname.startsWith('/api/entry/') && method === 'DELETE') {
    const date = pathname.split('/').pop()
    const r = handleDeleteEntry(decodeURIComponent(date))
    sendJson(res, r.code, r.body)
    return
  }

  if (pathname === '/api/baseline' && method === 'POST') {
    // First-run: set the baseline (books_balance) once.
    const raw = await readBody(req)
    let body
    try {
      body = JSON.parse(raw || '{}')
    } catch {
      sendJson(res, 400, { error: 'invalid JSON body' })
      return
    }
    if (getState()) {
      sendJson(res, 409, { error: 'baseline already set' })
      return
    }
    const cents = parseAmount(body.actual)
    const baselineDate = todayKey()
    db.prepare(
      'INSERT INTO state (id, books_balance_cents, baseline_cents, baseline_date, created_at, updated_at) VALUES (1, ?, ?, ?, ?, ?)',
    ).run(cents, cents, baselineDate, nowIso(), nowIso())
    sendJson(res, 200, { ok: true, booksBalance: centsToEuros(cents), baselineDate })
    return
  }

  // --- Payroll routes ---
  if (pathname === '/api/people' && method === 'GET') {
    const r = handleGetPeople()
    sendJson(res, r.code, r.body)
    return
  }

  if (pathname === '/api/people' && method === 'POST') {
    const r = await handlePostPeople(req)
    sendJson(res, r.code, r.body)
    return
  }

  if (pathname.startsWith('/api/people/') && method === 'PATCH') {
    const id = pathname.split('/').pop()
    const r = await handlePatchPeopleBody(req, Number(id))
    sendJson(res, r.code, r.body)
    return
  }

  if (pathname.startsWith('/api/people/') && method === 'DELETE') {
    const id = pathname.split('/').pop()
    const r = await handleDeletePeople(req, Number(id))
    sendJson(res, r.code, r.body)
    return
  }

  if (pathname === '/api/payments' && method === 'GET') {
    const r = handleGetPayments()
    sendJson(res, r.code, r.body)
    return
  }

  if (pathname === '/api/payments' && method === 'POST') {
    const r = await handlePostPayment(req)
    sendJson(res, r.code, r.body)
    return
  }

  if (pathname.startsWith('/api/payments/') && method === 'DELETE') {
    const id = pathname.split('/').pop()
    const r = handleDeletePayment(Number(id))
    sendJson(res, r.code, r.body)
    return
  }

  // --- Costs routes ---
  if (pathname === '/api/costs' && method === 'GET') {
    const r = handleGetCosts()
    sendJson(res, r.code, r.body)
    return
  }

  if (pathname === '/api/costs' && method === 'POST') {
    const r = await handlePostCost(req)
    sendJson(res, r.code, r.body)
    return
  }

  if (pathname.startsWith('/api/costs/') && method === 'DELETE') {
    const id = pathname.split('/').pop()
    const r = handleDeleteCost(Number(id))
    sendJson(res, r.code, r.body)
    return
  }

  // --- Monthly closings routes ---
  if (pathname === '/api/monthly' && method === 'GET') {
    // Get history
    const r = handleGetMonthlyHistory()
    sendJson(res, r.code, r.body)
    return
  }
  if (pathname.startsWith('/api/monthly/') && method === 'GET') {
    const yearMonth = pathname.split('/').pop()
    const r = handleGetMonthly(decodeURIComponent(yearMonth))
    sendJson(res, r.code, r.body)
    return
  }

  if (pathname.startsWith('/api/monthly/') && method === 'POST') {
    const yearMonth = pathname.split('/').pop()
    const r = await handlePostMonthly(req, decodeURIComponent(yearMonth))
    sendJson(res, r.code, r.body)
    return
  }

  // --- Stats routes ---
  if (pathname === '/api/stats' && method === 'GET') {
    const r = handleGetStats(req)
    sendJson(res, r.code, r.body)
    return
  }

  sendJson(res, 404, { error: 'not found', path: pathname })
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error('request error:', err)
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'internal error' })
    }
  })
})

server.listen(PORT, HOST, () => {
  console.log(`till-check listening on http://${HOST}:${PORT} (db: ${DB_PATH})`)
})
