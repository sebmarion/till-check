#!/usr/bin/env node
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
  opening_cents INTEGER NOT NULL,
  opening_date TEXT,
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
  opening_cents INTEGER,
  takeout_cents INTEGER NOT NULL DEFAULT 0,
  black_cents INTEGER NOT NULL DEFAULT 0,
  pre_takeout_cents INTEGER NOT NULL DEFAULT 0,
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
ensureColumn('entries', 'takeout_cents', 'INTEGER NOT NULL DEFAULT 0')
ensureColumn('entries', 'opening_cents', 'INTEGER')
ensureColumn('entries', 'black_cents', 'INTEGER NOT NULL DEFAULT 0')
ensureColumn('entries', 'pre_takeout_cents', 'INTEGER NOT NULL DEFAULT 0')

// Migration: older databases have state.books_balance_cents / baseline_cents.
// Rename to the dynamic opening model on first run.
function migrateStateSchema() {
  const cols = db.prepare('PRAGMA table_info(state)').all()
  const hasOpening = cols.some((c) => c.name === 'opening_cents')
  const hasBooks = cols.some((c) => c.name === 'books_balance_cents')
  if (!hasOpening && hasBooks) {
    // SQLite can't rename a column while keeping the same name in a CHECK;
    // rebuild the state row under the new column names.
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(`
        CREATE TABLE state_new (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          opening_cents INTEGER NOT NULL,
          opening_date TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO state_new (id, opening_cents, opening_date, created_at, updated_at)
          SELECT id, books_balance_cents, baseline_date, created_at, updated_at FROM state;
        DROP TABLE state;
        ALTER TABLE state_new RENAME TO state;
      `)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      // Fail loud: a half-migrated DB must not boot into a broken service.
      throw new Error(`state migration failed: ${err.message}`)
    }
  } else if (!hasOpening) {
    // A pre-existing table may hold rows; adding NOT NULL without a default
    // would fail, so backfill existing rows with 0 as part of the ADD.
    try {
      db.exec('ALTER TABLE state ADD COLUMN opening_cents INTEGER NOT NULL DEFAULT 0')
      db.exec("UPDATE state SET opening_cents = 0 WHERE opening_cents IS NULL")
      db.exec('ALTER TABLE state ADD COLUMN opening_date TEXT')
    } catch (err) {
      throw new Error(`state migration failed: ${err.message}`)
    }
  }
}
try {
  migrateStateSchema()
} catch (err) {
  console.error(err.message)
  process.exit(1)
}

function nowIso() {
  return new Date().toISOString()
}

function todayKey() {
  // Local calendar date YYYY-MM-DD (matches the day the operator is counting).
  return new Date().toISOString().slice(0, 10)
}

function getState() {
  const row = db
    .prepare('SELECT opening_cents, opening_date FROM state WHERE id = 1')
    .get()
  if (row) {
    return {
      openingCents: row.opening_cents,
      openingDate: row.opening_date,
    }
  }
  return null
}

function getOpeningForDate(date) {
  const existing = db
    .prepare('SELECT opening_cents FROM entries WHERE date = ?')
    .get(date)
  if (existing?.opening_cents !== null && existing?.opening_cents !== undefined) {
    return existing.opening_cents
  }

  // The carried opening (state) is authoritative whenever it exists and was
  // set by this date or an earlier one — the normal forward path, plus a
  // backfilled day whose successor was already confirmed. Only when state
  // is NEWER than the requested date (a true backfill into history) do we
  // reconstruct from the newest confirmed day before that date instead.
  const state = getState()
  const stateIsCurrent = state && (!state.openingDate || state.openingDate <= date)
  if (stateIsCurrent) return state.openingCents
  if (state) {
    const previous = db.prepare(
      `SELECT actual_cents, takeout_cents
         FROM entries
        WHERE date < ? AND confirmed_at IS NOT NULL
        ORDER BY date DESC
        LIMIT 1`,
    ).get(date)
    if (previous) return previous.actual_cents - previous.takeout_cents
    return 0
  }
  return 0
}

function upsertEntry(entry) {
  const existing = db.prepare('SELECT id FROM entries WHERE date = ?').get(entry.date)
  if (existing) {
    db.prepare(
      `UPDATE entries SET
         actual_cents = @actual_cents, cash_removed_cents = @cash_removed_cents,
         cash_added_cents = @cash_added_cents, card_transfer_cents = @card_transfer_cents,
         declared_note = @declared_note, denominations = @denominations,
         expected_cents = @expected_cents, variance_cents = @variance_cents,
         status = @status, opening_cents = @opening_cents, takeout_cents = @takeout_cents,
         black_cents = @black_cents, pre_takeout_cents = @pre_takeout_cents,
         updated_at = @updated_at
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
      opening_cents: entry.opening_cents,
      takeout_cents: entry.takeout_cents,
      black_cents: entry.black_cents,
      pre_takeout_cents: entry.pre_takeout_cents,
      updated_at: entry.updated_at,
    })
  } else {
    db.prepare(
      `INSERT INTO entries (date, actual_cents, cash_removed_cents, cash_added_cents,
        card_transfer_cents, declared_note, denominations, expected_cents, variance_cents, status,
        opening_cents, takeout_cents, black_cents, pre_takeout_cents, created_at, updated_at)
       VALUES (@date, @actual_cents, @cash_removed_cents, @cash_added_cents,
        @card_transfer_cents, @declared_note, @denominations, @expected_cents, @variance_cents,
        @status, @opening_cents, @takeout_cents, @black_cents, @pre_takeout_cents, @created_at, @updated_at)`,
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
  // Auto-seed: if there is no opening state yet, derive it from history —
  // the newest confirmed day's actual minus takeout — so a backfilled or
  // migrated ledger doesn't silently reconcile against today's raw count.
  // With no history at all, start from €0 (the first count IS the start).
  if (!state) {
    const seed = db.prepare(
      `SELECT actual_cents - takeout_cents AS opening, date
         FROM entries
        WHERE confirmed_at IS NOT NULL
        ORDER BY date DESC
        LIMIT 1`,
    ).get()
    const seedOpening = seed ? seed.opening : todayRow ? todayRow.actual_cents : 0
    const seedDate = seed ? seed.date : todayRow ? today : null
    db.prepare(
      'INSERT INTO state (id, opening_cents, opening_date, created_at, updated_at) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET opening_cents = excluded.opening_cents, opening_date = excluded.opening_date, updated_at = excluded.updated_at',
    ).run(seedOpening, seedDate, nowIso(), nowIso())
    return handleGetState()
  }
  return {
    hasOpening: state !== null,
    openingCash: state ? centsToEuros(state.openingCents) : null,
    openingDate: state ? state.openingDate : null,
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
  const today = body.date || todayKey()
  const declared = typeof body.declared === 'string' ? body.declared : ''
  const denominations =
    body.denominations && typeof body.denominations === 'object'
      ? body.denominations
      : null
  const state = getState()
  // Opening resolution: an explicit body.opening wins (used by tests and
  // power users); otherwise derive it from history/state for the date.
  const openingCents =
    body.opening !== undefined ? eurosToCents(body.opening) : getOpeningForDate(today)
  const result = reconcileDay(
    {
      actual: body.actual,
      expense: body.expense ?? body.cashRemoved ?? 0,
      black: body.black,
      preTakeout: body.preTakeout,
      cashAdded: body.cashAdded ?? 0,
      cardTransfer: body.cardTransfer ?? 0,
      declared,
      denominations,
    },
    openingCents,
  )
  const takeoutCents = eurosToCents(body.takeout ?? 0)
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
    opening_cents: openingCents,
    takeout_cents: takeoutCents,
    black_cents: result.blackCents,
    pre_takeout_cents: result.preTakeoutCents,
    created_at: nowIso(),
    updated_at: nowIso(),
  }
  upsertEntry(entry)
  // Seed the opening state on first run only when this entry is not older
  // than an existing confirmed day; otherwise the seed would misdate the
  // carried opening. handleGetState derives the correct seed from history.
  if (!state) {
    const priorConfirmed = db.prepare(
      'SELECT id FROM entries WHERE confirmed_at IS NOT NULL AND date > ? LIMIT 1',
    ).get(today)
    if (!priorConfirmed) {
      db.prepare(
        'INSERT INTO state (id, opening_cents, opening_date, created_at, updated_at) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET opening_cents = excluded.opening_cents, opening_date = excluded.opening_date, updated_at = excluded.updated_at',
      ).run(result.actualCents, today, nowIso(), nowIso())
    }
  }
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
    expense: centsToEuros(row.cash_removed_cents),
    cashRemoved: centsToEuros(row.cash_removed_cents),
    black: centsToEuros(row.black_cents ?? 0),
    preTakeout: centsToEuros(row.pre_takeout_cents ?? 0),
    cashAdded: centsToEuros(row.cash_added_cents),
    cardTransfer: centsToEuros(row.card_transfer_cents),
    declared: row.declared_note,
    denominations,
    expected: centsToEuros(row.expected_cents),
    variance: centsToEuros(row.variance_cents),
    status: row.status,
    opening: row.opening_cents !== null && row.opening_cents !== undefined ? centsToEuros(row.opening_cents) : null,
    takeout: centsToEuros(row.takeout_cents),
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
  // Takeout is the cash removed AFTER the count. The remainder becomes
  // tomorrow's opening cash. Stored takeout is already cents; only convert
  // when the caller supplied a fresh euros value.
  const takeoutCents =
    body.takeout !== undefined ? eurosToCents(body.takeout) : row.takeout_cents
  const openingCents = row.actual_cents - takeoutCents
  const state = getState()
  const advancesOpening = !state?.openingDate || date >= state.openingDate
  // Confirming an older backfilled day must not roll a newer carried opening
  // backward. It still marks the selected day as confirmed.
  if (advancesOpening) {
    db.prepare(
      'INSERT INTO state (id, opening_cents, opening_date, created_at, updated_at) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET opening_cents = excluded.opening_cents, opening_date = excluded.opening_date, updated_at = excluded.updated_at',
    ).run(openingCents, date, nowIso(), nowIso())
  }
  db.prepare('UPDATE entries SET confirmed_at = ? WHERE date = ?').run(nowIso(), date)
  return {
    code: 200,
    body: {
      confirmed: true,
      date,
      takeout: centsToEuros(takeoutCents),
      openingAdvanced: advancesOpening,
      openingCash: centsToEuros(advancesOpening ? openingCents : state.openingCents),
    },
  }
}

// Reconcile a day: correct its count and let the books accept the correction.
// This is the "confirmed was wrong" path — instead of deleting the entry and
// re-entering, the operator corrects the actual (and/or the moves) and the
// books baseline is re-derived from the corrected figure. If the entry being
// reconciled is the one that last set the baseline, the baseline is updated
// to the corrected actual; otherwise only the entry's reconciliation is
// refreshed against the current books balance.
async function handlePostReconcile(req) {
  const raw = await readBody(req)
  let body
  try {
    body = JSON.parse(raw || '{}')
  } catch {
    return { code: 400, body: { error: 'invalid JSON body' } }
  }
  const date = body.date
  if (!date) return { code: 400, body: { error: 'date is required' } }
  const row = db.prepare('SELECT * FROM entries WHERE date = ?').get(date)
  if (!row) {
    return { code: 404, body: { error: 'no entry for that date' } }
  }

  // Reconcile against the opening cash that was in effect when this day was
  // counted. If the entry stored an opening, use it; otherwise fall back to
  // the current opening state (or 0 on first run).
  const state = getState()
  let openingCents
  if (row.opening_cents !== null && row.opening_cents !== undefined) {
    openingCents = row.opening_cents
  } else {
    openingCents = state ? state.openingCents : 0
  }

  const declared = body.declared !== undefined ? body.declared : row.declared_note
  // Takeout: a fresh euros value from the caller wins; otherwise the stored
  // cents are kept as-is (already the right unit).
  const takeoutCents =
    body.takeout !== undefined ? eurosToCents(body.takeout) : row.takeout_cents
  const result = reconcileDay(
    {
      actual: body.actual !== undefined ? body.actual : centsToEuros(row.actual_cents),
      expense: body.expense !== undefined
        ? body.expense
        : body.cashRemoved !== undefined ? body.cashRemoved : centsToEuros(row.cash_removed_cents),
      black: body.black !== undefined ? body.black : centsToEuros(row.black_cents ?? 0),
      preTakeout: body.preTakeout !== undefined ? body.preTakeout : centsToEuros(row.pre_takeout_cents ?? 0),
      cashAdded: body.cashAdded !== undefined ? body.cashAdded : centsToEuros(row.cash_added_cents),
      cardTransfer: body.cardTransfer !== undefined ? body.cardTransfer : centsToEuros(row.card_transfer_cents),
      declared,
    },
    openingCents,
  )
  const entry = {
    id: row.id,
    date,
    actual_cents: result.actualCents,
    cash_removed_cents: result.removedCents,
    cash_added_cents: result.addedCents,
    card_transfer_cents: result.cardCents,
    declared_note: result.declared,
    denominations: row.denominations || '',
    expected_cents: result.expectedCents,
    variance_cents: result.varianceCents,
    status: result.status,
    opening_cents: openingCents,
    takeout_cents: takeoutCents,
    black_cents: result.blackCents,
    pre_takeout_cents: result.preTakeoutCents,
    created_at: row.created_at,
    updated_at: nowIso(),
  }
  upsertEntry(entry)

  // If this entry is (or remains) the source of the opening state, fold the
  // corrected actual (minus any takeout) into the opening balance so the
  // books stay consistent.
  if (state && state.openingDate === date) {
    const openingCentsAfter = result.actualCents - takeoutCents
    db.prepare(
      'UPDATE state SET opening_cents = ?, updated_at = ? WHERE id = 1'
    ).run(openingCentsAfter, nowIso())
  }

  return {
    code: 200,
    body: {
      reconciled: true,
      date,
      actual: centsToEuros(result.actualCents),
      expected: centsToEuros(result.expectedCents),
      variance: centsToEuros(result.varianceCents),
      status: result.status,
      openingCash: state && state.openingDate === date
        ? centsToEuros(result.actualCents - takeoutCents)
        : state ? centsToEuros(state.openingCents) : null,
      openingDate: state && state.openingDate === date ? date : state?.openingDate ?? null,
    },
  }
}

function handleGetHistory() {
  const rows = db.prepare('SELECT * FROM entries ORDER BY date DESC LIMIT 90').all()
  return { code: 200, body: { entries: rows.map(entryToView) } }
}

function handleDeleteEntry(date) {
  const row = db.prepare('SELECT * FROM entries WHERE date = ?').get(date)
  if (!row) return { code: 404, body: { error: 'no entry for that date' } }
  const state = getState()
  // If this was the entry that last set the opening state (confirmed),
  // revert the opening to the newest confirmed entry BEFORE this date (its
  // actual minus takeout), or clear the state when none remains. Keeps the
  // running opening consistent with what actually backs it.
  if (row.confirmed_at && state && state.openingDate === date) {
    const prev = db.prepare(
      `SELECT actual_cents, takeout_cents, date
         FROM entries
        WHERE date < ? AND confirmed_at IS NOT NULL
        ORDER BY date DESC
        LIMIT 1`,
    ).get(date)
    const newOpening = prev ? prev.actual_cents - prev.takeout_cents : 0
    db.prepare(
      'UPDATE state SET opening_cents = ?, opening_date = ?, updated_at = ? WHERE id = 1',
    ).run(newOpening, prev ? prev.date : null, nowIso())
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
  if (!state) return { code: 409, body: { error: 'no opening state set' } }
  // Denominations: preserve existing unless explicitly overridden.
  let denomObj = null
  try { denomObj = row.denominations ? JSON.parse(row.denominations) : null } catch { denomObj = null }
  if (body.denominations !== undefined) {
    denomObj = body.denominations && typeof body.denominations === 'object' ? body.denominations : null
  }
  // Use the entry's stored opening if present; otherwise fall back to the
  // current opening state (or 0 on first run).
  let openingCents
  if (row.opening_cents !== null && row.opening_cents !== undefined) {
    openingCents = row.opening_cents
  } else {
    openingCents = state.openingCents
  }
  const result = reconcileDay(
    {
      actual: body.actual !== undefined ? body.actual : centsToEuros(row.actual_cents),
      expense: body.expense ?? body.cashRemoved ?? centsToEuros(row.cash_removed_cents),
      black: body.black ?? centsToEuros(row.black_cents ?? 0),
      preTakeout: body.preTakeout ?? centsToEuros(row.pre_takeout_cents ?? 0),
      cashAdded: body.cashAdded ?? centsToEuros(row.cash_added_cents),
      cardTransfer: body.cardTransfer ?? centsToEuros(row.card_transfer_cents),
      declared: body.declared ?? row.declared_note,
      denominations: denomObj,
    },
    openingCents,
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
    opening_cents: openingCents,
    takeout_cents: row.takeout_cents,
    black_cents: result.blackCents,
    pre_takeout_cents: result.preTakeoutCents,
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
    // Fail-closed health: the DB must exist AND answer a real query. A
    // constant-true endpoint gives deploys a false green.
    let dbOk = false
    try {
      dbOk = fs.existsSync(DB_PATH) && db.prepare('SELECT COUNT(*) AS n FROM entries').get().n >= 0
    } catch {
      dbOk = false
    }
    sendJson(res, dbOk ? 200 : 503, { ok: dbOk, service: 'till-check', db: dbOk })
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

  if (pathname === '/api/reconcile' && method === 'POST') {
    const r = await handlePostReconcile(req)
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

  if (pathname === '/api/opening' && method === 'POST') {
    // Set the opening cash for the next shift (e.g. first run or manual
    // correction). Body: { opening, date }
    const raw = await readBody(req)
    let body
    try {
      body = JSON.parse(raw || '{}')
    } catch {
      sendJson(res, 400, { error: 'invalid JSON body' })
      return
    }
    const openingCents = parseAmount(body.opening)
    const openingDate = body.date || todayKey()
    db.prepare(
      'INSERT INTO state (id, opening_cents, opening_date, created_at, updated_at) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET opening_cents = excluded.opening_cents, opening_date = excluded.opening_date, updated_at = excluded.updated_at',
    ).run(openingCents, openingDate, nowIso(), nowIso())
    sendJson(res, 200, { ok: true, openingCash: centsToEuros(openingCents), openingDate })
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
