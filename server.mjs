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
    ).run({ ...entry, id: existing.id })
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
  const result = reconcileDay(
    {
      actual: body.actual !== undefined ? body.actual : row.actual_cents,
      cashRemoved: body.cashRemoved ?? row.cash_removed_cents,
      cashAdded: body.cashAdded ?? row.cash_added_cents,
      cardTransfer: body.cardTransfer ?? row.card_transfer_cents,
      declared: body.declared ?? row.declared_note,
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
