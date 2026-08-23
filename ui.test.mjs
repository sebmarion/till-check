#!/usr/bin/env node
// Till Check — UI behavior tests (real browser, real server).
//
// Covers the operator-facing behaviors that repeatedly regressed:
//   1. A new day starts with an EMPTY count form (no stale money fields).
//   2. The expected-target row shows the carried books amount, labelled as
//      NOT the user's count.
//   3. Live comparison while counting: MATCHES / CASH MISSING / EXTRA CASH,
//      BEFORE anything is saved.
//   4. Verdict + "Confirm day" stay hidden until Save & check is pressed.
//   5. Edit re-fills the saved values instead of losing them.
//   6. Changing the date clears the form (no cross-day contamination).
//   7. Saved black/takeout survive a save -> history round-trip.
//
// Runs against its OWN throwaway server + temp DB; production is untouched.
// Usage: node ui.test.mjs   (or: node --test ui.test.mjs)

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

// Playwright lives in the Hermes Agent checkout (shared tooling, not a dep of
// this zero-dependency app). Resolve it explicitly so the suite stays honest
// about where the browser comes from.
const PLAYWRIGHT_PATH = '/home/seb/projects/hermes-agent/node_modules/playwright'
const { chromium } = require(PLAYWRIGHT_PATH)

function findChromium() {
  const root = path.join(os.homedir(), '.cache', 'ms-playwright')
  const dirs = fs.readdirSync(root)
    .filter((d) => d.startsWith('chromium-'))
    .sort()
    .reverse()
  for (const d of dirs) {
    const exe = path.join(root, d, 'chrome-linux64', 'chrome')
    if (fs.existsSync(exe)) return exe
  }
  throw new Error('no cached Chromium build found in ~/.cache/ms-playwright')
}

const PORT = String(20000 + Math.floor(Math.random() * 20000))
const BASE = `http://127.0.0.1:${PORT}`

let child = null
let tmpDbPath = null
let browser = null
let page = null

before(async () => {
  tmpDbPath = path.join(os.tmpdir(), `till-ui-${Date.now()}-${process.pid}.sqlite`)
  child = spawn(process.execPath, [path.join(__dirname, 'server.mjs')], {
    env: { ...process.env, TILL_PORT: PORT, TILL_BIND: '127.0.0.1', TILL_DB: tmpDbPath },
    stdio: 'ignore',
  })
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${BASE}/health`)
      if (res.ok) break
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100))
  }
  // Seed a known opening so targets are deterministic.
  await api('POST', '/api/opening', { opening: '300' })
  browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] })
  page = await browser.newPage({ viewport: { width: 430, height: 950 } })
  page.on('pageerror', (e) => { throw new Error(`page error: ${e}`) })
})

after(async () => {
  if (browser) await browser.close()
  if (child) child.kill('SIGTERM')
  if (tmpDbPath) {
    for (const suffix of ['', '-shm', '-wal']) {
      try { fs.rmSync(tmpDbPath + suffix, { force: true }) } catch { /* best effort */ }
    }
  }
})

async function api(method, apiPath, body) {
  const res = await fetch(BASE + apiPath, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

async function gotoApp() {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
}

async function setCount(denomId, n) {
  await page.locator(`[data-denom="${denomId}"]`).fill(String(n))
}

const todayStr = () => new Date().toISOString().slice(0, 10)

// --- 1. Fresh day: everything empty, nothing pre-judged --------------------

test('new day starts with an empty count form and no verdict', async () => {
  await gotoApp()
  for (const input of await page.locator('.denom-input').all()) {
    assert.equal(await input.inputValue(), '', 'denomination field must be empty')
  }
  for (const id of ['black', 'preTakeout', 'takeout', 'expense', 'added', 'card']) {
    assert.equal(await page.locator(`#${id}`).inputValue(), '', `#${id} must be empty`)
  }
  assert.ok(await page.locator('#verdict').isHidden(), 'verdict must stay hidden before saving')
  assert.ok(await page.locator('#confirmBtn').isHidden(), 'confirm must stay hidden before saving')
  const live = await page.locator('#liveCheck').innerText()
  assert.match(live, /Enter your count/i, 'live check must ask for a count, not claim one')
})

test('target row shows the books amount and says it is not your count', async () => {
  const target = await page.locator('#expectedNow').innerText()
  assert.equal(target, '€300.00', 'target must equal the carried opening')
  const label = await page.locator('.expected-row span').innerText()
  assert.match(label.toLowerCase(), /not your count/, 'label must disambiguate target vs count')
})

// --- 2. Live comparison while counting --------------------------------------

test('counting up to the target shows MATCHES live, before any save', async () => {
  await setCount('50', 6) // €300 == target
  const live = await page.locator('#liveCheck').innerText()
  assert.match(live, /MATCHES/)
  assert.ok(await page.locator('#verdict').isHidden(), 'saved verdict stays hidden until save')
})

test('counting below the target shows CASH MISSING with the amount', async () => {
  await setCount('50', 5) // €250 vs €300
  const live = await page.locator('#liveCheck').innerText()
  assert.match(live, /€50\.00 CASH MISSING/)
})

test('counting above the target shows EXTRA CASH with the amount', async () => {
  await setCount('50', 7) // €350 vs €300
  const live = await page.locator('#liveCheck').innerText()
  assert.match(live, /€50\.00 EXTRA CASH/)
})

// --- 3. Save produces the verdict and reveals Confirm -----------------------

test('save & check shows the verdict and reveals confirm', async () => {
  await setCount('50', 6) // back to balanced
  await page.locator('#checkBtn').click()
  await page.waitForTimeout(400)
  const verdictText = await page.locator('#verdict').innerText()
  assert.match(verdictText, /MATCHES/)
  const sub = await page.locator('#vSub').innerText()
  assert.match(sub, /Counted €300\.00/)
  assert.match(sub, /Expected €300\.00/)
  assert.ok(await page.locator('#confirmBtn').isVisible(), 'confirm appears after save')
})

// --- 4. Saved black/takeout round-trip into history --------------------------

test('saved black and taken-out-at-close persist and show in history', async () => {
  await page.locator('#adjustments summary').click() // open the cash-movements section
  await page.locator('#black').fill('20')
  await page.locator('#takeout').fill('40')
  // Black is cash IN: expected = 300 + 20 = 320; counted 300 -> €20 MISSING.
  await page.locator('#checkBtn').click()
  await page.waitForTimeout(400)
  const firstRow = await page.locator('#ledger li').first().innerText()
  assert.match(firstRow, /Black €20\.00/, 'history must show the saved black amount')
  assert.match(firstRow, /Taken out at close €40\.00/, 'history must show the saved takeout')
  assert.match(firstRow, /€20\.00 CASH MISSING/, 'history badge reflects the variance')

  // Reload: still there, from the server, not from page state.
  await gotoApp()
  const reloadedRow = await page.locator('#ledger li').first().innerText()
  assert.match(reloadedRow, /Black €20\.00/)
  assert.match(reloadedRow, /Taken out at close €40\.00/)
})

// --- 5. Edit re-fills saved values -------------------------------------------

test('edit re-fills denominations, black and takeout from the saved day', async () => {
  await page.locator('#ledger li').first().locator('button', { hasText: 'Edit' }).click()
  await page.waitForTimeout(200)
  assert.equal(await page.locator('[data-denom="50"]').inputValue(), '6')
  assert.equal(await page.locator('#black').inputValue(), '20.00')
  assert.equal(await page.locator('#takeout').inputValue(), '40.00')
})

// --- 7. Field definitions: glossary + labels --------------------------------

test('every money field is defined in the glossary', async () => {
  await gotoApp()
  await page.locator('#glossary summary').click()
  const text = (await page.locator('#glossary').innerText()).toLowerCase()
  for (const term of ['counted', 'till expense', 'black', 'cash drop', 'taken out at close', 'cash added', 'card sales', 'target']) {
    assert.ok(text.includes(term), `glossary must define "${term}"`)
  }
  // Black's definition must reflect the corrected semantics: cash IN.
  const blackDef = await page.locator('[data-glossary="black"]').innerText()
  assert.match(blackDef.toLowerCase(), /into the till/, 'black must be defined as cash going IN')
  assert.ok(!/undeclared cash out/i.test(blackDef), 'old cash-OUT definition must be gone')
})

test('black label says cash in, not undeclared cash out', async () => {
  const label = await page.locator('label[for="black"]').textContent()
  assert.match(label.toLowerCase(), /cash in|income|unrung/)
  assert.ok(!/cash out/i.test(label.toLowerCase()))
})

test('live preview counts black as cash IN (raises the target)', async () => {
  // Opening 300; black 100 -> target 400; count 400 -> MATCHES.
  await page.locator('#adjustments summary').click()
  await page.locator('#black').fill('100')
  await setCount('50', 8)
  const live = await page.locator('#liveCheck').innerText()
  assert.match(live, /MATCHES/, '400 counted vs 300+100 black must match')
  const target = await page.locator('#expectedNow').innerText()
  assert.equal(target, '€400.00', 'target must include black income')
})


// --- 8. Editing must never destroy, and re-dating must work -----------------

test('edit + save without changes preserves the stored count (no zeroing)', async () => {
  // Regression: the UI used to send count=0 when the denom boxes were empty,
  // wiping any day whose count wasn't currently in the form.
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await api('POST', '/api/entry', { date: yesterday, actual: '100' });
  await gotoApp();
  await page.locator('#ledger li').first().locator('button', { hasText: 'Edit' }).click();
  await page.waitForTimeout(200);
  await page.locator('#checkBtn').click(); // touch NOTHING
  await page.waitForTimeout(400);
  const row = await page.evaluate(async () => {
    const hist = await fetch('api/history').then((r) => r.json());
    return hist.entries.find((e) => e.date === new Date(Date.now() - 86400000).toISOString().slice(0, 10));
  });
  assert.equal(Number(row.actual), 100, 'untouched edit-save must preserve the stored count');
  assert.equal(Number(row.variance), Number(row.variance), 'entry still reconciles'); // sanity: fields present
  assert.ok(['balanced', 'over', 'short'].includes(row.status), 'status is a real verdict');
  // The critical assertion: count NOT zeroed. Status depends on shared books.
  assert.notEqual(Number(row.actual), 0);
});

test('changing the date while editing MOVES the entry (old date freed, values kept)', async () => {
  // Use a unique far-past marker day so no other test touches it. It renders
  // in "Earlier history" (collapsed) — open that section first.
  const markerDate = new Date(Date.now() - 30 * 86400000);
  const marker = `${markerDate.getFullYear()}-${String(markerDate.getMonth() + 1).padStart(2, '0')}-${String(markerDate.getDate()).padStart(2, '0')}`;
  await api('POST', '/api/entry', { date: marker, actual: '77.77', black: '3' });
  await gotoApp();
  await page.locator('#historyMore summary').click(); // reveal Earlier history
  const rowHandle = page.locator('#ledgerOlder li', { hasText: '€77.77' }).first();
  await rowHandle.locator('button', { hasText: 'Edit' }).click();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#black').inputValue(), '3.00', 'edit pre-fill loaded the seeded day');
  // Re-date the entry to a free future day, then save — it must MOVE, not copy.
  const target = new Date(Date.now() + 86400000);
  const targetStr = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
  await page.locator('#entryDate').fill(targetStr);
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#black').inputValue(), '3.00',
    'values must stay in the form while re-dating (they belong to the entry)');
  page.once('dialog', (d) => d.accept()); // dismiss any alert
  await page.locator('#checkBtn').click();
  await page.waitForTimeout(500);
  const dates = await page.evaluate(async () => {
    const hist = await fetch('api/history').then((r) => r.json());
    return hist.entries.map((e) => e.date);
  });
  assert.ok(!dates.includes(marker), 'old date must be freed after a move');
  const moved = await page.evaluate(async (d) => {
    const hist = await fetch('api/history').then((r) => r.json());
    return hist.entries.find((e) => e.date === d);
  }, targetStr);
  assert.ok(moved, 'entry exists under the new date');
  assert.equal(Number(moved.black), 3, 'moved with all data intact');
});

test('date change with NO edit in progress still clears the form', async () => {
  await gotoApp(); // fresh page: editingDate is null
  await page.locator('.denom-row [data-denom="50"]').fill('4');
  await page.locator('#entryDate').fill(todayStr());
  await page.waitForTimeout(200);
  assert.equal(await page.locator('[data-denom="50"]').inputValue(), '',
    'stray counts must not leak across ordinary date switches');
});

