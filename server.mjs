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

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  reconcileDay,
  eurosToCents,
  centsToEuros,
  STATUS,
  DENOMINATIONS,
  InvalidAmountError,
} from "./reconcile.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.TILL_PORT || 3401);
const HOST = process.env.TILL_BIND || "127.0.0.1";
const DB_PATH =
  process.env.TILL_DB || path.join(__dirname, "data", "till.sqlite");

// ---------------------------------------------------------------------------
// Persistence (node:sqlite, WAL, single-file)
// ---------------------------------------------------------------------------

const dir = path.dirname(DB_PATH);
fs.mkdirSync(dir, { recursive: true });

const db = new DatabaseSync(DB_PATH, { timeout: 5000 });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
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
  card_billed_cents INTEGER,
  discrepancy_reason TEXT NOT NULL DEFAULT '',
  declared_note TEXT NOT NULL DEFAULT '',
  denominations TEXT NOT NULL DEFAULT '',
  expected_cents INTEGER NOT NULL,
  variance_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  opening_cents INTEGER,
  takeout_cents INTEGER NOT NULL DEFAULT 0,
  black_cents INTEGER NOT NULL DEFAULT 0,
  pre_takeout_cents INTEGER NOT NULL DEFAULT 0,
  card_cash_transactions TEXT NOT NULL DEFAULT '[]',
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date DESC);
`);

// Migration: add columns that may be missing from older databases.
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
ensureColumn("entries", "denominations", "TEXT NOT NULL DEFAULT ''");
ensureColumn("entries", "takeout_cents", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("entries", "opening_cents", "INTEGER");
ensureColumn("entries", "black_cents", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("entries", "pre_takeout_cents", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("entries", "card_cash_transactions", "TEXT NOT NULL DEFAULT '[]'");
ensureColumn("entries", "sales_cents", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("entries", "card_billed_cents", "INTEGER");
ensureColumn("entries", "discrepancy_reason", "TEXT NOT NULL DEFAULT ''");

// Migration: older databases have state.books_balance_cents / baseline_cents.
// Rename to the dynamic opening model on first run.
function migrateStateSchema() {
  const cols = db.prepare("PRAGMA table_info(state)").all();
  const hasOpening = cols.some((c) => c.name === "opening_cents");
  const hasBooks = cols.some((c) => c.name === "books_balance_cents");
  if (!hasOpening && hasBooks) {
    // SQLite can't rename a column while keeping the same name in a CHECK;
    // rebuild the state row under the new column names.
    db.exec("BEGIN IMMEDIATE");
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
      `);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      // Fail loud: a half-migrated DB must not boot into a broken service.
      throw new Error(`state migration failed: ${err.message}`);
    }
  } else if (!hasOpening) {
    // A pre-existing table may hold rows; adding NOT NULL without a default
    // would fail, so backfill existing rows with 0 as part of the ADD.
    try {
      db.exec(
        "ALTER TABLE state ADD COLUMN opening_cents INTEGER NOT NULL DEFAULT 0",
      );
      db.exec("UPDATE state SET opening_cents = 0 WHERE opening_cents IS NULL");
      db.exec("ALTER TABLE state ADD COLUMN opening_date TEXT");
    } catch (err) {
      throw new Error(`state migration failed: ${err.message}`);
    }
  }
}
try {
  migrateStateSchema();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

// Additive schema support for audit history. Existing values remain untouched.
ensureColumn("entries", "opening_mode", "TEXT NOT NULL DEFAULT 'legacy'");
ensureColumn("entries", "tips_outside_pos", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("state", "source", "TEXT NOT NULL DEFAULT 'legacy'");
db.exec(`CREATE TABLE IF NOT EXISTS ledger_meta (
  id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
  INSERT OR IGNORE INTO ledger_meta VALUES(1,0);
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL, date TEXT, before_json TEXT NOT NULL,
    after_json TEXT NOT NULL, created_at TEXT NOT NULL, revision INTEGER NOT NULL);`);
const nowIso = () => new Date().toISOString();
const todayKey = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const revision = () =>
  db.prepare("SELECT revision FROM ledger_meta WHERE id=1").get().revision;
const rawState = () =>
  db.prepare("SELECT * FROM state WHERE id=1").get() || null;
const getRow = (date) =>
  db.prepare("SELECT * FROM entries WHERE date=?").get(date) || null;
class ApiError extends Error {
  constructor(status, message, field) {
    super(message);
    this.status = status;
    this.field = field;
  }
}
function validDate(date) {
  if (
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number(date.slice(0, 4)) < 2000 ||
    Number.isNaN(Date.parse(date + "T12:00:00Z")) ||
    new Date(date + "T12:00:00Z").toISOString().slice(0, 10) !== date
  )
    throw new ApiError(400, "Choose a valid calendar date.", "date");
  if (date > todayKey())
    throw new ApiError(400, "You cannot count a future day.", "date");
  return date;
}
function getState() {
  const state = rawState();
  if (state)
    return {
      openingCents: state.opening_cents,
      openingDate: state.opening_date,
      source: state.source,
    };
  const row = db
    .prepare(
      "SELECT * FROM entries WHERE confirmed_at IS NOT NULL ORDER BY date DESC LIMIT 1",
    )
    .get();
  return row
    ? {
        openingCents: row.actual_cents - row.takeout_cents,
        openingDate: row.date,
        source: "confirmed",
      }
    : null;
}
function previousEntry(date) {
  return db
    .prepare("SELECT * FROM entries WHERE date<? ORDER BY date DESC LIMIT 1")
    .get(date);
}
function previousConfirmed(date) {
  return db
    .prepare("SELECT * FROM entries WHERE date<? AND confirmed_at IS NOT NULL ORDER BY date DESC LIMIT 1")
    .get(date);
}
function getOpeningForDate(date, useExisting = true) {
  const existing = useExisting && getRow(date);
  if (existing && existing.opening_cents !== null)
    return existing.opening_cents;
  const previous = previousEntry(date),
    state = getState();
  if (
    state &&
    state.source !== "confirmed" &&
    (!state.openingDate || state.openingDate <= date) &&
    (!previous || state.openingDate > previous.date)
  )
    return state.openingCents;
  if (previous) return previous.actual_cents - previous.takeout_cents;
  return 0;
}
function openingSourceForDate(date) {
  const previous = previousEntry(date);
  if (previous) {
    const days = Math.round((Date.parse(date + "T12:00:00Z") - Date.parse(previous.date + "T12:00:00Z")) / 86400000);
    return { date: previous.date, confirmed: !!previous.confirmed_at, gapDays: Math.max(0, days - 1), provisional: !previous.confirmed_at || days > 1 };
  }
  const state = getState();
  return state ? { date: state.openingDate, confirmed: state.source === "confirmed", gapDays: null, provisional: state.source !== "confirmed" } : null;
}
function setState(cents, date, source = "confirmed") {
  db.prepare(
    `INSERT INTO state(id,opening_cents,opening_date,created_at,updated_at,source) VALUES(1,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET opening_cents=excluded.opening_cents,opening_date=excluded.opening_date,updated_at=excluded.updated_at,source=excluded.source`,
  ).run(cents, date, nowIso(), nowIso(), source);
}
function snapshot() {
  return {
    state: rawState(),
    entries: db.prepare("SELECT * FROM entries ORDER BY date").all(),
  };
}
function writeRow(row) {
  const keys = Object.keys(row).filter((k) => k !== "id");
  if (row.id)
    db.prepare(
      "UPDATE entries SET " +
        keys.map((k) => k + "=@" + k).join(",") +
        " WHERE id=@id",
    ).run(row);
  else
    db.prepare(
      "INSERT INTO entries (" +
        keys.join(",") +
        ") VALUES (" +
        keys.map((k) => "@" + k).join(",") +
        ")",
    ).run(row);
  return getRow(row.date);
}
function transactionsFromRow(row) {
  if (!row?.card_cash_transactions) return [];
  return JSON.parse(row.card_cash_transactions).map((t) => ({
    cardCharged:
      t.cardChargeProvided !== false && t.cardChargedCents > t.cashGivenCents
        ? centsToEuros(t.cardChargedCents)
        : undefined,
    cashGiven: centsToEuros(t.cashGivenCents),
    extra: centsToEuros(t.cardChargedCents - t.cashGivenCents),
    time: t.time || "",
    reference: t.reference || "",
  }));
}
function rowInputs(row) {
  if (!row) return {};
  return {
    actual: centsToEuros(row.actual_cents),
    expense: centsToEuros(row.cash_removed_cents),
    cashAdded: centsToEuros(row.cash_added_cents),
    posCardSales: centsToEuros(row.card_transfer_cents),
    cardBilled:
      row.card_billed_cents === null
        ? null
        : centsToEuros(row.card_billed_cents),
    black: centsToEuros(row.black_cents),
    preTakeout: centsToEuros(row.pre_takeout_cents),
    cashSales: centsToEuros(row.sales_cents),
    declared: row.declared_note,
    cardCashTransactions: transactionsFromRow(row),
    tipsOutsidePos: !!row.tips_outside_pos,
  };
}
function makeEntry(body, date, row = null) {
  const input = { ...rowInputs(row), ...body };
  if (body.cashRemoved !== undefined && body.expense === undefined)
    input.expense = body.cashRemoved;
  if (body.cardTransfer !== undefined && body.posCardSales === undefined)
    input.posCardSales = body.cardTransfer;
  if (
    input.declared !== undefined &&
    (typeof input.declared !== "string" || input.declared.length > 4000)
  )
    throw new ApiError(
      400,
      "Notes must be text, up to 4,000 characters.",
      "declared",
    );
  if (
    body.tipsOutsidePos !== undefined &&
    typeof body.tipsOutsidePos !== "boolean"
  )
    throw new ApiError(400, "Invalid card tip setting.");
  let denoms = row?.denominations ? JSON.parse(row.denominations) : null;
  if (body.denominations !== undefined) denoms = body.denominations;
  else if (body.actual !== undefined) denoms = null;
  if (
    denoms !== null &&
    denoms !== undefined &&
    (typeof denoms !== "object" || Array.isArray(denoms))
  ) {
    throw new ApiError(
      400,
      "Denominations must be a count object.",
      "denominations",
    );
  }
  if (
    body.actual !== undefined &&
    !denoms &&
    (body.actual === null || String(body.actual).trim() === "")
  ) {
    throw new ApiError(
      400,
      "Enter an explicit cash count, including 0 for an empty drawer.",
      "actual",
    );
  }
  input.denominations = denoms;
  if (
    !row &&
    !denoms &&
    (body.actual === undefined || body.actual === null || body.actual === "")
  )
    throw new ApiError(
      400,
      "Enter a count, including an explicit 0 for an empty drawer.",
      "actual",
    );
  const explicit = body.opening !== undefined;
  const firstDay = !row && !getState() && !previousEntry(date) && !explicit;
  const opening = explicit
    ? eurosToCents(body.opening)
    : getOpeningForDate(date);
  if (explicit && opening < 0)
    throw new ApiError(400, "Opening cash cannot be negative.", "opening");
  const result = reconcileDay(
    {
      ...input,
      firstDay,
      denominations:
        row && body.denominations === undefined && body.actual === undefined
          ? undefined
          : denoms,
    },
    opening,
  );
  const takeout =
    body.takeout !== undefined
      ? eurosToCents(body.takeout)
      : row?.takeout_cents || 0;
  if (takeout < 0 || takeout > result.actualCents)
    throw new ApiError(
      400,
      "After-count withdrawal must be between 0 and the cash counted.",
      "takeout",
    );
  return {
    ...(row || {}),
    date,
    actual_cents: result.actualCents,
    cash_removed_cents: result.removedCents,
    cash_added_cents: result.addedCents,
    card_transfer_cents: result.posCardCents,
    card_billed_cents: result.cardBilledCents,
    discrepancy_reason: result.discrepancyReason,
    declared_note: result.declared,
    denominations: denoms ? JSON.stringify(denoms) : "",
    expected_cents: result.expectedCents,
    variance_cents: result.varianceCents,
    status: result.status,
    opening_cents: result.openingCents,
    takeout_cents: takeout,
    black_cents: result.blackCents,
    pre_takeout_cents: result.preTakeoutCents,
    card_cash_transactions: JSON.stringify(result.cardCashTransactions),
    sales_cents: result.salesCents,
    confirmed_at: row?.confirmed_at || null,
    created_at: row?.created_at || nowIso(),
    updated_at: nowIso(),
    opening_mode: explicit
      ? "manual"
      : row?.opening_mode || (firstDay ? "derived" : "auto"),
    tips_outside_pos: input.tipsOutsidePos ? 1 : 0,
  };
}
function entryToView(row) {
  const inputs = rowInputs(row),
    stored = JSON.parse(row.card_cash_transactions || "[]");
  const given = stored.reduce((s, t) => s + t.cashGivenCents, 0);
  const expectedCard =
    row.card_transfer_cents + (row.tips_outside_pos ? given : 0);
  const cv =
    row.card_billed_cents === null
      ? null
      : row.card_billed_cents - expectedCard;
  const match = cv === null ? null : cv === 0 && row.variance_cents === 0;
  return {
    ...inputs,
    date: row.date,
    cashRemoved: inputs.expense,
    cardTransfer: inputs.posCardSales,
    denominations: row.denominations ? JSON.parse(row.denominations) : null,
    expected: centsToEuros(row.expected_cents),
    variance: centsToEuros(row.variance_cents),
    status: row.status,
    opening:
      row.opening_cents === null ? null : centsToEuros(row.opening_cents),
    takeout: centsToEuros(row.takeout_cents),
    remaining: centsToEuros(row.actual_cents - row.takeout_cents),
    confirmed: !!row.confirmed_at,
    confirmedAt: row.confirmed_at,
    updatedAt: row.updated_at,
    baselineOnly: row.opening_mode === "derived",
    cardCashGiven: centsToEuros(given),
    cardCashExtra: centsToEuros(
      stored.reduce((s, t) => s + t.cardChargedCents - t.cashGivenCents, 0),
    ),
    expectedCard: centsToEuros(expectedCard),
    cardVariance: cv === null ? null : centsToEuros(cv),
    cashMatches: row.variance_cents === 0,
    cardMatches: cv === null ? null : cv === 0,
    overallMatches: match,
    overallStatus:
      match === null ? "not_checked" : match ? "matches" : "not_matches",
    discrepancyReason: row.discrepancy_reason,
  };
}
// Recalculate dependent openings after explicit mutations, never at startup.
function syncFollowing(fromDate) {
  for (const row of db
    .prepare("SELECT * FROM entries WHERE date>? ORDER BY date")
    .all(fromDate)) {
    if (row.opening_mode === "manual") continue;
    const previous = previousEntry(row.date);
    if (!previous) continue;
    const opening = previous.actual_cents - previous.takeout_cents;
    if (row.opening_cents === opening) continue;
    const result = reconcileDay(rowInputs(row), opening);
    writeRow({
      ...row,
      opening_cents: opening,
      expected_cents: result.expectedCents,
      variance_cents: result.varianceCents,
      status: result.status,
      discrepancy_reason: result.discrepancyReason,
      updated_at: nowIso(),
    });
  }
}
function syncState(before) {
  const latest = db
      .prepare(
        "SELECT * FROM entries WHERE confirmed_at IS NOT NULL ORDER BY date DESC LIMIT 1",
      )
      .get(),
    state = rawState();
  if (latest) {
    if (state?.source === "manual" && state.opening_date > latest.date) return;
    setState(latest.actual_cents - latest.takeout_cents, latest.date);
  } else if (
    state?.source === "confirmed" ||
    (state &&
      before?.entries.some(
        (e) => e.confirmed_at && e.date === state.opening_date,
      ))
  )
    db.prepare("DELETE FROM state WHERE id=1").run();
}
function transact(req, action, date, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const expected = req.headers["if-match"]?.replaceAll('"', "");
    if (expected !== undefined && expected !== String(revision()))
      throw new ApiError(
        409,
        "The ledger changed in another tab. Reload the latest values before saving.",
        "revision",
      );
    const before = snapshot(),
      result = fn(before),
      after = snapshot(),
      rev = revision() + 1;
    db.prepare("UPDATE ledger_meta SET revision=? WHERE id=1").run(rev);
    const id = db
      .prepare(
        "INSERT INTO audit_log(action,date,before_json,after_json,created_at,revision) VALUES(?,?,?,?,?,?)",
      )
      .run(
        action,
        date,
        JSON.stringify(before),
        JSON.stringify(after),
        nowIso(),
        rev,
      ).lastInsertRowid;
    db.exec("COMMIT");
    return { ...result, revision: rev, auditId: Number(id) };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};
function sendJson(res, code, body) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    ...SECURITY_HEADERS,
    ETag: '"' + revision() + '"',
  });
  res.end(JSON.stringify(body));
}
async function readJson(req) {
  if (
    !(req.headers["content-type"] || "")
      .toLowerCase()
      .startsWith("application/json")
  )
    throw new ApiError(415, "Send application/json.");
  let size = 0,
    chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256 * 1024)
      throw new ApiError(413, "This request is too large.");
    chunks.push(chunk);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
  } catch {
    throw new ApiError(400, "Invalid JSON body.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new ApiError(400, "Send a JSON object.");
  return body;
}
function guardOrigin(req) {
  if (req.headers["sec-fetch-site"] === "cross-site")
    throw new ApiError(403, "Cross-site changes are not allowed.");
  if (req.headers.origin) {
    const hosts = [req.headers.host, req.headers["x-forwarded-host"]].filter(
      Boolean,
    );
    let host;
    try {
      host = new URL(req.headers.origin).host;
    } catch {
      throw new ApiError(403, "Invalid origin.");
    }
    if (!hosts.includes(host))
      throw new ApiError(403, "Open Till Check directly to make changes.");
  }
}
async function handle(req, res) {
  const url = new URL(req.url, "http://localhost"),
    method = req.method;
  let pathname = url.pathname;
  if (pathname === "/till") {
    res.writeHead(308, { Location: "/till/" });
    res.end();
    return;
  }
  if (pathname.startsWith("/till/")) pathname = pathname.slice(5);
  const assets = {
    "/": "index.html",
    "/index.html": "index.html",
    "/app.js": "app.js",
    "/styles.css": "styles.css",
  };
  if ((method === "GET" || method === "HEAD") && assets[pathname]) {
    const name = assets[pathname],
      file = path.join(__dirname, "public", name);
    const type = name.endsWith(".js")
      ? "text/javascript"
      : name.endsWith(".css")
        ? "text/css"
        : "text/html";
    res.writeHead(200, {
      "Content-Type": type + "; charset=utf-8",
      ...SECURITY_HEADERS,
    });
    res.end(method === "HEAD" ? undefined : fs.readFileSync(file));
    return;
  }
  if (method === "GET" && pathname === "/health") {
    const ok =
      fs.existsSync(DB_PATH) &&
      db.prepare("SELECT COUNT(*) AS n FROM entries").get().n >= 0;
    sendJson(res, ok ? 200 : 503, {
      ok,
      db: ok,
      service: "till-check",
      version: "0.2.0",
    });
    return;
  }
  if (method === "GET") {
    if (pathname === "/api/state") {
      const date = validDate(url.searchParams.get("date") || todayKey()),
        state = getState(),
        row = getRow(date);
      sendJson(res, 200, {
        hasOpening: !!state,
        openingCash: state ? centsToEuros(state.openingCents) : null,
        openingDate: state?.openingDate || null,
        selectedOpening: centsToEuros(getOpeningForDate(date)),
        openingSource: openingSourceForDate(date),
        today: todayKey(),
        timeZone: "Europe/Madrid",
        hasTodayEntry: !!getRow(todayKey()),
        entry: row ? entryToView(row) : null,
        revision: revision(),
      });
      return;
    }
    if (pathname === "/api/denominations") {
      sendJson(res, 200, { denominations: DENOMINATIONS });
      return;
    }
    if (pathname === "/api/history") {
      const limit = Math.min(
          200,
          Math.max(1, Number(url.searchParams.get("limit")) || 90),
        ),
        before = url.searchParams.get("before") || "9999-12-31";
      const rows = db
        .prepare(
          "SELECT * FROM entries WHERE date<? ORDER BY date DESC LIMIT ?",
        )
        .all(before, limit + 1);
      sendJson(res, 200, {
        entries: rows.slice(0, limit).map(entryToView),
        hasMore: rows.length > limit,
        revision: revision(),
      });
      return;
    }
    if (pathname === "/api/audit") {
      sendJson(res, 200, {
        events: db
          .prepare(
            "SELECT id,action,date,created_at AS createdAt,revision FROM audit_log ORDER BY id DESC LIMIT 50",
          )
          .all(),
      });
      return;
    }
    if (pathname === "/api/export.csv") {
      const columns = [
        "date",
        "actual",
        "expected",
        "variance",
        "opening",
        "cashSales",
        "expense",
        "cashAdded",
        "black",
        "preTakeout",
        "cardCashGiven",
        "posCardSales",
        "cardBilled",
        "takeout",
        "remaining",
        "confirmed",
        "declared",
      ];
      const cell = (value, key) => {
        let text = String(value ?? "");
        const first = text.trimStart()[0];
        const formula =
          first &&
          (["=", "+", "@"].includes(first) ||
            (key === "declared" && first === "-"));
        if (formula || text.startsWith("\t") || text.startsWith("\r"))
          text = "'" + text;
        return '"' + text.replaceAll('"', '""') + '"';
      };
      const csv = [
        columns.join(","),
        ...db
          .prepare("SELECT * FROM entries ORDER BY date")
          .all()
          .map((row) => {
            const e = entryToView(row);
            return columns.map((k) => cell(e[k], k)).join(",");
          }),
      ].join("\r\n");
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="till-history.csv"',
        ...SECURITY_HEADERS,
      });
      res.end("\ufeff" + csv);
      return;
    }
    const match = pathname.match(/^\/api\/entry\/([^/]+)$/);
    if (match) {
      const row = getRow(validDate(decodeURIComponent(match[1])));
      if (!row) throw new ApiError(404, "No count saved for this day.");
      sendJson(res, 200, entryToView(row));
      return;
    }
  }
  if (!["POST", "PATCH", "DELETE"].includes(method))
    throw new ApiError(404, "Not found.");
  guardOrigin(req);
  const body = method === "DELETE" ? {} : await readJson(req);
  let result;
  if (pathname === "/api/opening" && method === "POST") {
    const date = validDate(body.date || todayKey()),
      opening = eurosToCents(body.opening);
    if (
      body.opening === undefined ||
      body.opening === null ||
      body.opening === "" ||
      opening < 0
    )
      throw new ApiError(
        400,
        "Enter a non-negative opening balance.",
        "opening",
      );
    result = transact(req, "opening", date, () => {
      setState(opening, date, "manual");
      return {
        ok: true,
        openingCash: centsToEuros(opening),
        openingDate: date,
      };
    });
  } else if (pathname === "/api/entry" && method === "POST") {
    const date = validDate(body.date || todayKey());
    result = transact(req, "save", date, (before) => {
      const row = writeRow(makeEntry(body, date, getRow(date)));
      syncFollowing(date);
      if (row.confirmed_at) syncState(before);
      return entryToView(getRow(date));
    });
  } else if (pathname === "/api/confirm" && method === "POST") {
    const date = validDate(body.date || todayKey());
    result = transact(req, "confirm", date, (before) => {
      const row = getRow(date);
      if (!row)
        throw new ApiError(404, "Save a count before confirming this day.");
      const takeout =
        body.takeout === undefined
          ? row.takeout_cents
          : eurosToCents(body.takeout);
      if (takeout < 0 || takeout > row.actual_cents)
        throw new ApiError(
          400,
          "Withdrawal cannot exceed the count.",
          "takeout",
        );
      writeRow({
        ...row,
        takeout_cents: takeout,
        confirmed_at: nowIso(),
        updated_at: nowIso(),
      });
      syncFollowing(date);
      syncState(before);
      const state = getState();
      return {
        confirmed: true,
        date,
        takeout: centsToEuros(takeout),
        openingAdvanced: state?.openingDate === date,
        openingCash: state ? centsToEuros(state.openingCents) : null,
      };
    });
  } else if (pathname === "/api/reconcile" && method === "POST") {
    const date = validDate(body.date);
    result = transact(req, "correct", date, (before) => {
      const row = getRow(date);
      if (!row) throw new ApiError(404, "No entry for that day.");
      writeRow(makeEntry(body, date, row));
      syncFollowing(date);
      syncState(before);
      return {
        ...entryToView(getRow(date)),
        reconciled: true,
        openingCash: getState() ? centsToEuros(getState().openingCents) : null,
        openingDate: getState()?.openingDate || null,
      };
    });
  } else if (pathname === "/api/undo" && method === "POST") {
    result = transact(req, "undo", null, () => {
      const audit = db
        .prepare("SELECT * FROM audit_log WHERE id=?")
        .get(Number(body.auditId));
      if (!audit || audit.action !== "delete" || audit.revision !== revision())
        throw new ApiError(
          409,
          "Undo is no longer safe because the ledger changed.",
        );
      const before = JSON.parse(audit.before_json),
        after = JSON.parse(audit.after_json);
      const removed = before.entries.filter(
        (row) => !after.entries.some((e) => e.id === row.id),
      );
      for (const row of removed) {
        const keys = Object.keys(row);
        db.prepare(
          "INSERT INTO entries (" +
            keys.join(",") +
            ") VALUES (" +
            keys.map((k) => "@" + k).join(",") +
            ")",
        ).run(row);
      }
      for (const row of before.entries.filter((row) =>
        after.entries.some((e) => e.id === row.id),
      ))
        writeRow(row);
      if (before.state)
        setState(
          before.state.opening_cents,
          before.state.opening_date,
          before.state.source,
        );
      else db.prepare("DELETE FROM state WHERE id=1").run();
      return { restored: true, date: audit.date };
    });
  } else {
    const match = pathname.match(/^\/api\/entry\/([^/]+)(\/move)?$/);
    if (!match) throw new ApiError(404, "Not found.");
    const date = validDate(decodeURIComponent(match[1]));
    if (method === "PATCH" && !match[2])
      result = transact(req, "edit", date, (before) => {
        const row = getRow(date);
        if (!row) throw new ApiError(404, "No entry for that day.");
        writeRow(makeEntry(body, date, row));
        syncFollowing(date);
        if (row.confirmed_at) syncState(before);
        return entryToView(getRow(date));
      });
    else if (method === "DELETE" && !match[2])
      result = transact(req, "delete", date, (before) => {
        const row = getRow(date);
        if (!row) throw new ApiError(404, "No entry for that day.");
        db.prepare("DELETE FROM entries WHERE date=?").run(date);
        syncFollowing(date);
        syncState(before);
        return { deleted: true, date };
      });
    else if (method === "POST" && match[2]) {
      const target = validDate(body.date);
      result = transact(req, "move", date, (before) => {
        const row = getRow(date);
        if (!row) throw new ApiError(404, "No entry for that day.");
        if (target !== date && getRow(target))
          throw new ApiError(
            409,
            "That day already has a count. Nothing was moved.",
          );
        const updated = makeEntry({ ...body, date: target }, date, row);
        updated.date = target;
        const predecessor = previousEntry(target);
        if (
          predecessor &&
          predecessor.id !== row.id &&
          updated.opening_mode !== "manual"
        ) {
          const r = reconcileDay(
            rowInputs(updated),
            predecessor.actual_cents - predecessor.takeout_cents,
          );
          Object.assign(updated, {
            opening_cents: r.openingCents,
            expected_cents: r.expectedCents,
            variance_cents: r.varianceCents,
            status: r.status,
            discrepancy_reason: r.discrepancyReason,
          });
        }
        writeRow(updated);
        syncFollowing(date < target ? date : target);
        syncState(before);
        return entryToView(getRow(target));
      });
    } else throw new ApiError(405, "Method not allowed.");
  }
  sendJson(res, 200, result);
}
const server = http.createServer((req, res) =>
  handle(req, res).catch((err) => {
    const code = err instanceof InvalidAmountError ? 400 : err.status || 500;
    if (code >= 500) console.error("request error:", err);
    if (!res.headersSent)
      sendJson(res, code, {
        error:
          code >= 500
            ? "Could not save. Your inputs are still here; please retry."
            : err.message,
        field: err.field,
        path: code === 404 ? req.url : undefined,
      });
  }),
);
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(PORT, HOST, () =>
  console.log(
    `till-check listening on http://${HOST}:${server.address().port} (db: ${DB_PATH})`,
  ),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
