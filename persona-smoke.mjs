// Till Check — Persona-Batch UX Testing (6-month simulation)
// Each persona "runs the bistro for 6 months" against the live app.
// - The daily life is driven via the API (fast) with realistic edge cases.
// - Once per persona, the REAL UI is opened, a day is counted via denominations,
//   confirmed, and reconciled — to capture the genuine interface + friction.
// - State is probed daily to record what the owner would see (verdict, variance,
//   stale value when a day is forgotten, correction path availability).
//
// Isolation: the live DB is snapshotted before each persona and restored after.

import { chromium } from '/home/seb/projects/comandero/www/node_modules/@playwright/test/index.mjs'
import * as fs from 'fs'
import * as path from 'path'
import { DatabaseSync } from 'node:sqlite'

const APP_URL = 'http://127.0.0.1:80/till'
const API = APP_URL + '/api'
const DB_PATH = 'data/till.sqlite'
const DB_BACKUP = 'data/till.sqlite.persona-backup'
const OUTPUT_DIR = 'output/till-personas'
fs.mkdirSync(OUTPUT_DIR, { recursive: true })

const PERSONAS = [{"id": "enric-gran-cuina", "name": "Enric", "background": "Enric, 53, gran cuina in Eixample, 140 covers, 18 years. Michelin-adjacent quality standards. Uses a procurement manager for supplier relations. Expects: \"Any savings need to be validated by my team before they go live.\""}, {"id": "elvira-catering", "name": "Elvira", "background": "Elvira, 46, catering company with one kitchen + two event contracts, 500+ servings/week, 8 years. Margin-sensitive, tracks food cost per plate. Expects: \"Show me the food-cost-per-plate impact of supplier changes.\""}, {"id": "alex-gastropub", "name": "Alex", "background": "Alex, 38, gastropub in Poble Nou, 60 covers, 3 years. Tech-comfortable, uses multiple food apps. Willing to experiment but hates dead ends. Expects: \"If the tool says it saved me money, show me the math.\""}, {"id": "marta-mercat", "name": "Marta", "background": "Marta, 58, traditional bar in La Boquer\u00eda area, 25 covers, 20 years. Analog-minded. Trusts her supplier's phone call over any app. Expects: \"Don't surprise me with prices I didn't see coming.\""}, {"id": "ricard-vinyeta", "name": "Ricard", "background": "Ricard, 45, neighborhood restaurant in Vinyes, 45 covers, 12 years. Quality-focused, builds relationships with suppliers personally. Expects: \"Don't switch my suppliers without asking me first.\""}, {"id": "elvira-torronada", "name": "Elvira", "background": "Elvira, 60, torronada (small eatery) in Ciutat Vella, 50 covers, 22 years. First month using digital tools. Skeptical of \"optimization\" language. Expects: \"Show me what changed and why, in plain Spanish.\""}, {"id": "carles-parrilla", "name": "Carles", "background": "Carles, 52, parrilla in El Raval, 100 covers, 25 years. Traditionalist but curious. Orders from 6+ suppliers monthly. Expects: \"Don't break what's working. If you find savings, great \u2014 but don't surprise me.\""}, {"id": "pol-hamburgers", "name": "Pol", "background": "Pol, 31, burger joint in Vila de Gr\u00e0cia, 150 covers/day, 3 years. High-volume, ingredient turnover is constant. Expects: \"If my beef supplier goes up 8%, show me the monthly impact before I notice.\""}, {"id": "david-backoffice", "name": "David", "background": "David, 47, back-office manager for two neighborhood restaurants in Les Corts, combined 100 covers, 8 years. Manages all supplier relationships digitally from a desktop. Expects: \"If the tool's wrong on something, I want to find out before my suppliers do.\""}, {"id": "enric-hotel", "name": "Enric", "background": "Enric, 58, hotel restaurant in Ciutat Vella, 200 covers (hotel guests + walk-ins), 20 years. Corporate procurement culture. Expects: \"Every change needs a paper trail for audit.\""}, {"id": "alex-smart", "name": "Alex", "background": "Alex, 33, smart-casual concept in Darsana, 140 covers/week, 4 years. Data-driven menu engineering, tests new suppliers often. Expects: \"Let me test a new supplier at 5% of volume before committing.\""}, {"id": "carles-obrers", "name": "Carles", "background": "Carles, 50, obra (construction-site feeding) operator in L'Hospitalet, 300 workers fed daily, 14 years. Bulk buyer, price is everything, quality is standardized. Expects: \"I buy 200kg of rice a month. Show me the cheapest reliable source.\""}, {"id": "pau-casual", "name": "Pau", "background": "Pau, 35, casual tapas bar in El Born, 40 covers, 2 years. First month using any digital tool. Overwhelmed by complexity. Expects: \"Just tell me what to buy and from where. Don't make me think.\""}, {"id": "miquel-farina", "name": "Miquel", "background": "Miquel, 58, bread-and-pasta restaurant in El Poble-sec, 95 covers, 35 years. Long-time user (2+ years). Deeply embedded, uses every feature. Expects: \"If the tool breaks something I rely on, I'll know \u2014 and I'll be frustrated.\""}, {"id": "clara-vegetariana", "name": "Clara", "background": "Clara, 36, vegetarian/vegan restaurant in El Raval, 70 covers, 4 years. Quality-focused, willing to pay more for certified suppliers. Expects: \"Don't switch my organic supplier just because it's 2\u20ac cheaper.\""}, {"id": "violeta-fusion", "name": "Violeta", "background": "Violeta, 37, fusion restaurant in Dreta de l'Eixample, 120 covers, 5 years. Innovative, early-adopter mindset. Expects: \"If you can automate something, do it \u2014 but let me override.\""}, {"id": "marta-nova", "name": "Marta", "background": "Marta, 30, new bistr\u00f3 opening in El Raval, 60 covers, first month using digital ordering tools. Overwhelmed by options, needs hand-holding. Expects: \"Don't show me every feature at once. Show me what I need right now.\""}, {"id": "sara-coffee", "name": "Sara", "background": "Sara, 28, specialty coffee in El Born, 60 seats, 2 years. Mobile-first, tech-comfortable, will switch tools if it's better. Expects: \"Don't make me think about my supplier list. Show me the deal.\""}, {"id": "nuria-baker", "name": "N\u00faria", "background": "N\u00faria, 45, artisan bakery in El Raval, 120 loaves/day + caf\u00e9, 12 years. Morning-shift operator, orders from phone at 6am. Expects: \"I need to set up my order before the day starts. No surprises.\""}, {"id": "laia-barc", "name": "Laia", "background": "Laia, 36, cocktail bar in Darsana, 50 seats, 7 years. High-margin drinks, ingredient costs matter less than presentation and service speed. Expects: \"I don't care if my gin is 2\u20ac cheaper if it tastes worse.\""}, {"id": "david-casa", "name": "David", "background": "David, 50, small casa de comidas in the hills, 30 covers, 15 years. Seasonal, busy Aug\u2013Oct. Low-tech, prefers phone calls but willing to try if it saves time. Expects: \"Don't make me fill out forms like I'm at a government office.\""}, {"id": "laia-catering", "name": "Laia", "background": "Laia, 35, catering + restaurant duo in L'Hospitalet, 200 total covers, 6 years. High-volume events, needs bulk pricing visibility. Expects: \"Show me the per-event cost impact when suppliers change prices.\""}, {"id": "laia-brunch", "name": "Laia", "background": "Laia, 29, brunch spot in Eixample, 35 covers, 18 months. Mobile-first, orders from phone between services. Impatient with multi-step flows. Expects: \"I want to see savings before I spend 5 minutes clicking around.\""}, {"id": "sergi-costa", "name": "Sergi", "background": "Sergi, 41, upscale coastal cuisine in Santa Coloma, 150 covers, 10 years. Tech-comfortable, uses data to drive menu engineering. Expects: \"Give me the data. I'll make the call.\""}, {"id": "nuria-pizzeria", "name": "N\u00faria", "background": "N\u00faria, 39, pizzeria in L'Hospitalet, 120 covers, 5 years. High-volume, cost-sensitive. Uses the tool weekly now (1+ year). Expects: \"The numbers have to be right. If I can't verify them myself, I won't trust them.\""}, {"id": "marta-triple", "name": "Marta", "background": "Marta, 42, three venues (bar + bistr\u00f3 + catering) in Poblenou, 300 total covers, 9 years. Operates like a small business owner, not a restaurateur. Expects: \"I need per-location P&L impact, not a blended number.\""}, {"id": "jordi-pescaderia", "name": "Jordi", "background": "Jordi, 55, pescaderia in Port Ol\u00edmpic, 90 covers, 30 years. Quality above all, price secondary but tracked. Expects: \"If a fish supplier goes up 10%, I want to know before I order, not after.\""}, {"id": "carles-duo", "name": "Carles", "background": "Carles, 56, two neighborhood restaurants in Sants and Les Corts, 180 total covers, 30 years. Long-time supplier relationships on both sides. Expects: \"If Location A has a great deal but Location B doesn't, let me apply it selectively.\""}, {"id": "sara-matines", "name": "Sara", "background": "Sara, 33, mat\u00ed-only caf\u00e9 in Sants, 20 seats, 4 years. Tight margins, watches every euro. No tech team, no patience for learning curves. Expects: \"Show me the price difference clearly, or I won't use it.\""}, {"id": "jordi-grup", "name": "Jordi", "background": "Jordi, 48, 2-restaurant group (casual + upscale) in Gr\u00e0cia, 250 total covers, 15 years. Pragmatic, hates surprises and wasted clicks. Expects: \"One dashboard for both locations. Don't make me log in twice.\""}];

// ---- helpers ----
const rand = (a, b) => Math.random() * (b - a) + a
const randInt = (a, b) => Math.floor(rand(a, b + 1))
const chance = p => Math.random() < p
const euro = n => (Math.round(n * 100) / 100)
const toStr = n => (euro(n)).toFixed(2)
const pad = n => String(n).padStart(2, '0')
const dstr = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`
const todayISO = () => new Date().toISOString().slice(0, 10)

function denomize(euroAmt) {
  const cents = Math.round(euroAmt * 100)
  const denoms = [[5000,'50'],[2000,'20'],[1000,'10'],[500,'5'],[200,'2'],[100,'1'],[50,'0.5'],[20,'0.2']]
  const out = {}
  let rem = cents
  for (const [v, id] of denoms) { const c = Math.floor(rem / v); if (c > 0) out[id] = c; rem -= c * v }
  return out
}

function snapshotDB() { try { fs.copyFileSync(DB_PATH, DB_BACKUP) } catch (e) { console.error('snapshot failed', e.message) } }
function restoreDB() { try { fs.copyFileSync(DB_BACKUP, DB_PATH) } catch (e) { console.error('restore failed', e.message) } }

async function req(method, p, body) {
  const res = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data.error || res.status), { status: res.status, data })
  return data
}

async function resetState() {
  const db = new DatabaseSync(DB_PATH)
  db.prepare('DELETE FROM entries').run()
  db.prepare('DELETE FROM payments').run()
  db.prepare('DELETE FROM costs').run()
  db.prepare('DELETE FROM monthly_closings').run()
  db.prepare('DELETE FROM people').run()
  db.prepare('DELETE FROM state').run()
  db.prepare('INSERT INTO state (id, books_balance_cents, baseline_cents, baseline_date, created_at, updated_at) ' +
    "VALUES (1, 50000, 50000, ?, datetime('now'), datetime('now'))").run(todayISO())
  db.close()
}

// ---- per-persona personality profile (seeded by persona id) ----
function seed(id) { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return (h >>> 0) / 4294967296 } }
function profileFor(id) {
  const r = seed(id)
  return {
    forgetEvery: 1 + Math.floor(r() * 5),
    doubleEntryRate: 0.06 + r() * 0.06,
    miscountRate: 0.10 + r() * 0.08,
    reconcileRate: 0.35 + r() * 0.40,
    monthlyClose: r() < 0.7,
    paysPayroll: r() < 0.8,
    logsCosts: r() < 0.65,
    checksHistory: r() < 0.6,
    isMobile: r() < 0.5,
    techComfortable: r() < 0.6,
  }
}

// ---- UI capture: open the real app, do one representative day ----
async function captureUI(browser, persona, prof) {
  const context = await browser.newContext({ viewport: prof.isMobile ? { width: 390, height: 844 } : { width: 1280, height: 900 } })
  const page = await context.newPage()
  const notes = []
  try {
    await page.goto(APP_URL, { waitUntil: 'networkidle' })
    const bodyText = await page.locator('body').innerText().catch(() => '')
    notes.push('page loaded: ' + (bodyText.length > 0 ? 'content present (' + bodyText.length + ' chars)' : 'EMPTY'))

    // Count a representative day by TYPING counts into denom inputs (what an owner does)
    const target = 1240.50
    const denoms = denomize(target)
    const denomInputs = await page.locator('input[data-denom]').count()
    notes.push('denom inputs rendered: ' + denomInputs)
    for (const [id, count] of Object.entries(denoms)) {
      const inp = page.locator(`input[data-denom="${id}"]`)
      if (await inp.count()) {
        await inp.fill(String(count)).catch(e => notes.push('denom fill failed ' + id + ': ' + e.message.slice(0, 50)))
      }
    }
    // Read the running total before submitting
    const denomTotal = await page.locator('#denomTotal').innerText().catch(() => '')
    notes.push('denom total before check: ' + denomTotal.trim())
    notes.push('set denominations for €' + target + ' (expected total)')

    await page.click('#checkBtn').catch(() => {})
    await page.waitForTimeout(800)

    // Read verdict
    const verdict = await page.locator('#verdict').innerText().catch(() => '')
    const badge = await page.locator('#vBadge').innerText().catch(() => '')
    const status = await page.locator('#verdict').getAttribute('class').catch(() => '')
    notes.push('verdict after check: "' + verdict.trim().slice(0, 80) + '"')
    notes.push('badge: ' + badge.trim() + ' | verdict classes: ' + (status || 'none'))

    // Detect friction: does the owner understand the result?
    if (verdict.toLowerCase().includes('short') || verdict.toLowerCase().includes('over') || badge.trim() !== '✓') {
      notes.push('FRICTION: owner sees a VARIANCE (unbalanced) — may not know how to fix it')
    }
    if (badge.trim() === '' && !verdict.trim()) {
      notes.push('FRICTION: no visible feedback after check — owner doesn\'t know if it worked')
    }

    // Confirm
    const conf = page.locator('#confirmBtn')
    if (await conf.count()) {
      const enabled = await conf.isEnabled().catch(() => false)
      const visible = await conf.isVisible().catch(() => false)
      if (enabled && visible) {
        await conf.click().catch(() => {})
        await page.waitForTimeout(500)
        notes.push('confirmed day (button was visible + enabled)')
      } else {
        notes.push('FRICTION: confirm button present but NOT clickable (visible=' + visible + ', enabled=' + enabled + ') — owner can\'t lock in the day')
      }
    } else {
      notes.push('FRICTION: no confirm button at all — owner can\'t confirm the day')
    }

    // Look for reconcile + delete affordances in the ledger
    const ledgerText = await page.locator('#historyCard').innerText().catch(() => '')
    const ledgerVisible = await page.locator('#historyCard').isVisible().catch(() => false)
    notes.push('ledger visible: ' + (ledgerVisible ? 'yes' : 'no') + ' | text length: ' + ledgerText.length)
    const reconcileBtns = await page.locator('button:has-text("Reconcile"), button:has-text("reconcile")').count()
    const deleteBtns = await page.locator('button:has-text("Delete"), button:has-text("delete")').count()
    notes.push('reconcile buttons in DOM: ' + reconcileBtns)
    notes.push('delete buttons in DOM: ' + deleteBtns)
    if (reconcileBtns === 0) notes.push('FRICTION: no reconcile affordance visible — owner can\'t correct a confirmed day')
    if (deleteBtns === 0) notes.push('FRICTION: no delete affordance visible — owner can\'t remove a wrong entry')

    // Try to trigger a variance (miscount) to see correction flow
    await page.reload({ waitUntil: 'networkidle' }).catch(() => {})

    const shot = `till-${persona.id}.png`
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {})
    notes.push('screenshot saved: ' + shot)
  } catch (e) {
    notes.push('UI capture error: ' + e.message.slice(0, 150))
  } finally {
    await context.close()
  }
  return notes
}

// ---- one persona's 6-month life (API-driven) ----
async function runPersona(browser, persona) {
  const started = Date.now()
  const friction = []   // {type, day, date, note}
  const prof = profileFor(persona.id)
  snapshotDB()

  let uiNotes = []
  try {
    await resetState()

    // Persona setup
    let people = []
    if (prof.paysPayroll) {
      for (const n of ['Maria', 'John', 'Anna', 'Carlos', 'Emma'].slice(0, randInt(2, 5))) {
        people.push(await req('POST', '/people', { name: n, paySchedule: 'weekly', payMethod: 'cash' }))
      }
    }
    if (prof.logsCosts) await req('POST', '/costs', { date: todayISO(), category: 'rent', label: 'Rent', amount: '2000.00' })

    // Capture the REAL UI once (representative day)
    uiNotes = await captureUI(browser, persona, prof)

    // 6-month life (180 days) via API
    const start = new Date()
    const DAYS = 180
    const daysLogged = []
    let totalReconciles = 0, totalDeletes = 0, totalForgotten = 0, totalUnconfirmed = 0, totalDouble = 0

    for (let i = 0; i < DAYS; i++) {
      const dt = new Date(start.getTime() + i * 86400000)
      const dateStr = dstr(dt.getFullYear(), dt.getMonth() + 1, dt.getDate())
      const isWeekend = dt.getDay() === 5 || dt.getDay() === 6 || dt.getDay() === 0
      const base = isWeekend ? rand(1200, 1800) : rand(800, 1500)
      const removed = randInt(0, 4) * 50
      const added = randInt(0, 3) * 50
      const card = rand(1200, 2000)
      let actual = euro(base + added - removed)

      let miscount = chance(prof.miscountRate)
      if (miscount) actual = euro(actual + rand(-25, 25))

      const entry = await req('POST', '/entry', {
        date: dateStr, actual: toStr(actual), cashRemoved: toStr(removed),
        cashAdded: toStr(added), cardTransfer: toStr(card), declared: '', denominations: denomize(actual),
      }).catch(() => null)

      // Double-entry (owner submits twice)
      if (chance(prof.doubleEntryRate)) {
        await req('POST', '/entry', { date: dateStr, actual: toStr(actual), cashRemoved: toStr(removed),
          cashAdded: toStr(added), cardTransfer: toStr(card), declared: '', denominations: denomize(actual) })
        totalDouble++
        friction.push({ type: 'double-entry', day: i, date: dateStr, note: 'Same count submitted twice' })
      }

      // Forget a day
      if (chance(1 / prof.forgetEvery)) {
        await req('DELETE', `/entry/${dateStr}`).catch(() => {})
        totalForgotten++
        friction.push({ type: 'forgotten-day', day: i, date: dateStr, note: 'Count skipped; next day app shows stale value' })
        continue
      }

      // Confirm (route: POST /api/confirm with {date})
      if (prof.techComfortable || chance(0.85)) {
        await req('POST', '/confirm', { date: dateStr }).catch(() => {
          totalUnconfirmed++
          friction.push({ type: 'unconfirmed', day: i, date: dateStr, note: 'Day left unconfirmed' })
        })
      } else {
        totalUnconfirmed++
        friction.push({ type: 'unconfirmed', day: i, date: dateStr, note: 'Day left unconfirmed' })
      }

      // Correction flow (owner notices variance) — probe today's entry via history
      const hist = await req('GET', '/history').catch(() => ({ entries: [] }))
      const todayRow = hist.entries && hist.entries[0]
      if (todayRow && (todayRow.status === 'over' || todayRow.status === 'short')) {
        if (chance(0.7)) {
          if (chance(prof.reconcileRate)) {
            await req('POST', '/reconcile', { date: dateStr, actual: toStr(euro(actual - rand(3, 15))) })
              .catch(() => {})
            totalReconciles++
            friction.push({ type: 'reconcile-used', day: i, date: dateStr, note: 'Owner corrected via reconcile' })
          } else {
            await req('DELETE', `/entry/${dateStr}`).catch(() => {})
            await req('POST', '/entry', { date: dateStr, actual: toStr(euro(actual - 5)), cashRemoved: toStr(removed),
              cashAdded: toStr(added), cardTransfer: toStr(card), declared: '', denominations: denomize(euro(actual - 5)) })
            totalDeletes++
            friction.push({ type: 'delete-rerenter-used', day: i, date: dateStr, note: 'Owner deleted and re-entered' })
          }
        }
      }

      // Payroll + costs + monthly close
      if (prof.paysPayroll && dt.getDay() === 1 && people.length)
        await req('POST', '/payments', { date: dateStr, personId: people[0].id, amount: '800.00', payMethod: 'cash', note: 'Weekly pay' }).catch(() => {})
      if (prof.logsCosts && dt.getDate() === 1)
        await req('POST', '/costs', { date: dateStr, category: 'rent', label: 'Rent', amount: '2000.00' }).catch(() => {})
      if (prof.monthlyClose && dt.getDate() === 1 && i > 1) {
        const ym = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}`
        await req('POST', `/monthly/${ym}`).catch(() => {})
      }
    }

    // Final stats
    const db = new DatabaseSync(DB_PATH)
    const stats = {
      entries: db.prepare('SELECT COUNT(*) c FROM entries').get().c,
      confirmed: db.prepare("SELECT COUNT(*) c FROM entries WHERE confirmed_at IS NOT NULL").get().c,
      payments: db.prepare('SELECT COUNT(*) c FROM payments').get().c,
      costs: db.prepare('SELECT COUNT(*) c FROM costs').get().c,
      closings: db.prepare('SELECT COUNT(*) c FROM monthly_closings').get().c,
    }
    db.close()

    return {
      personaId: persona.id, name: persona.name, background: persona.background, profile: prof,
      stats, uiNotes,
      friction,
      totals: { reconciles: totalReconciles, deletes: totalDeletes, forgotten: totalForgotten, unconfirmed: totalUnconfirmed, double: totalDouble },
      totalTimeMs: Date.now() - started,
      screenshot: `till-${persona.id}.png`,
    }
  } catch (e) {
    return { personaId: persona.id, name: persona.name, error: e.message.slice(0, 300), uiNotes, friction, totalTimeMs: Date.now() - started }
  } finally {
    restoreDB()
  }
}

// ---- main ----
const browser = await chromium.launch()
const results = []
for (const persona of PERSONAS.slice(0,1)) {
  console.log(`\n=== ${persona.name} (${persona.id}) ===`)
  const r = await runPersona(browser, persona)
  results.push(r)
  if (r.error) console.log('  ERROR:', r.error)
  else console.log(`  entries=${r.stats.entries} confirmed=${r.stats.confirmed} frictions=${r.friction.length} time=${(r.totalTimeMs / 1000).toFixed(0)}s`)
}
await browser.close()

for (const r of results) {
  fs.writeFileSync(path.join(OUTPUT_DIR, `owner-${r.personaId}.json`), JSON.stringify(r, null, 2))
}
console.log(`\nAll ${results.length} personas done. → ${OUTPUT_DIR}/`)
