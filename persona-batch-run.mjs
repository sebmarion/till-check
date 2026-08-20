// Till Check — Persona-Batch UX Testing (6-month simulation) — v2
// Isolation: uses the API to clear state per persona (no concurrent DB writes).
// The shared baseline is set ONCE before the batch. Each persona clears
// their entries via DELETE, then runs 180 days.
//
// Run: node persona-batch-run.mjs   (all 30)
//      node persona-batch-run.mjs enric-gran-cuina  (single persona)

import { chromium } from '/home/seb/projects/comandero/www/node_modules/@playwright/test/index.mjs'
import fs from 'node:fs'

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:80/till'
const API = APP_URL + '/api'
const TODAY = new Date()
const START = new Date(TODAY); START.setDate(TODAY.getDate() - 180)

const PERSONAS = [{"id": "enric-gran-cuina", "name": "Enric", "background": "Enric, 53, gran cuina in Eixample, 140 covers, 18 years. Michelin-adjacent quality standards. Uses a procurement manager for supplier relations. Expects: \"Any savings need to be validated by my team before they go live.\""}, {"id": "elvira-catering", "name": "Elvira", "background": "Elvira, 46, catering company with one kitchen + two event contracts, 500+ servings/week, 8 years. Margin-sensitive, tracks food cost per plate. Expects: \"Show me the food-cost-per-plate impact of supplier changes.\""}, {"id": "alex-gastropub", "name": "Alex", "background": "Alex, 38, gastropub in Poble Nou, 60 covers, 3 years. Tech-comfortable, uses multiple food apps. Willing to experiment but hates dead ends. Expects: \"If the tool says it saved me money, show me the math.\""}, {"id": "marta-mercat", "name": "Marta", "background": "Marta, 58, traditional bar in La Boquería area, 25 covers, 20 years. Analog-minded. Trusts her supplier's phone call over any app. Expects: \"Don't surprise me with prices I didn't see coming.\""}, {"id": "ricard-vinyeta", "name": "Ricard", "background": "Ricard, 45, neighborhood restaurant in Vinyes, 45 covers, 12 years. Quality-focused, builds relationships with suppliers personally. Expects: \"Don't switch my suppliers without asking me first.\""}, {"id": "elvira-torronada", "name": "Elvira", "background": "Elvira, 60, torronada (small eatery) in Ciutat Vella, 50 covers, 22 years. First month using digital tools. Skeptical of \"optimization\" language. Expects: \"Show me what changed and why, in plain Spanish.\""}, {"id": "carles-parrilla", "name": "Carles", "background": "Carles, 52, parrilla in El Raval, 100 covers, 25 years. Traditionalist but curious. Orders from 6+ suppliers monthly. Expects: \"Don't break what's working. If you find savings, great — but don't surprise me.\""}, {"id": "pol-hamburgers", "name": "Pol", "background": "Pol, 31, burger joint in Vila de Gràcia, 150 covers/day, 3 years. High-volume, ingredient turnover is constant. Expects: \"If my beef supplier goes up 8%, show me the monthly impact before I notice.\""}, {"id": "david-backoffice", "name": "David", "background": "David, 47, back-office manager for two neighborhood restaurants in Les Corts, combined 100 covers, 8 years. Manages all supplier relationships digitally from a desktop. Expects: \"If the tool's wrong on something, I want to find out before my suppliers do.\""}, {"id": "enric-hotel", "name": "Enric", "background": "Enric, 58, hotel restaurant in Ciutat Vella, 200 covers (hotel guests + walk-ins), 20 years. Corporate procurement culture. Expects: \"Every change needs a paper trail for audit.\""}, {"id": "alex-smart", "name": "Alex", "background": "Alex, 33, smart-casual concept in Darsana, 140 covers/week, 4 years. Data-driven menu engineering, tests new suppliers often. Expects: \"Let me test a new supplier at 5% of volume before committing.\""}, {"id": "carles-obrers", "name": "Carles", "background": "Carles, 50, obra (construction-site feeding) operator in L'Hospitalet, 300 workers fed daily, 14 years. Bulk buyer, price is everything, quality is standardized. Expects: \"I buy 200kg of rice a month. Show me the cheapest reliable source.\""}, {"id": "pau-casual", "name": "Pau", "background": "Pau, 35, casual tapas bar in El Born, 40 covers, 2 years. First month using any digital tool. Overwhelmed by complexity. Expects: \"Just tell me what to buy and from where. Don't make me think.\""}, {"id": "miquel-farina", "name": "Miquel", "background": "Miquel, 58, bread-and-pasta restaurant in El Poble-sec, 95 covers, 35 years. Long-time user (2+ years). Deeply embedded, uses every feature. Expects: \"If the tool breaks something I rely on, I'll know — and I'll be frustrated.\""}, {"id": "clara-vegetariana", "name": "Clara", "background": "Clara, 36, vegetarian/vegan restaurant in El Raval, 70 covers, 4 years. Quality-focused, willing to pay more for certified suppliers. Expects: \"Don't switch my organic supplier just because it's 2€ cheaper.\""}, {"id": "violeta-fusion", "name": "Violeta", "background": "Violeta, 37, fusion restaurant in Dreta de l'Eixample, 120 covers, 5 years. Innovative, early-adopter mindset. Expects: \"If you can automate something, do it — but let me override.\""}, {"id": "marta-nova", "name": "Marta", "background": "Marta, 30, new bistró opening in El Raval, 60 covers, first month using digital ordering tools. Overwhelmed by options, needs hand-holding. Expects: \"Don't show me every feature at once. Show me what I need right now.\""}, {"id": "sara-coffee", "name": "Sara", "background": "Sara, 28, specialty coffee in El Born, 60 seats, 2 years. Mobile-first, tech-comfortable, will switch tools if it's better. Expects: \"Don't make me think about my supplier list. Show me the deal.\""}, {"id": "nuria-baker", "name": "Núria", "background": "Núria, 45, artisan bakery in El Raval, 120 loaves/day + café, 12 years. Morning-shift operator, orders from phone at 6am. Expects: \"I need to set up my order before the day starts. No surprises.\""}, {"id": "laia-barc", "name": "Laia", "background": "Laia, 36, cocktail bar in Darsana, 50 seats, 7 years. High-margin drinks, ingredient costs matter less than presentation and service speed. Expects: \"I don't care if my gin is 2€ cheaper if it tastes worse.\""}, {"id": "david-casa", "name": "David", "background": "David, 50, small casa de comidas in the hills, 30 covers, 15 years. Seasonal, busy Aug–Oct. Low-tech, prefers phone calls but willing to try if it saves time. Expects: \"Don't make me fill out forms like I'm at a government office.\""}, {"id": "laia-catering", "name": "Laia", "background": "Laia, 35, catering + restaurant duo in L'Hospitalet, 200 total covers, 6 years. High-volume events, needs bulk pricing visibility. Expects: \"Show me the per-event cost impact when suppliers change prices.\""}, {"id": "laia-brunch", "name": "Laia", "background": "Laia, 29, brunch spot in Eixample, 35 covers, 18 months. Mobile-first, orders from phone between services. Impatient with multi-step flows. Expects: \"I want to see savings before I spend 5 minutes clicking around.\""}, {"id": "sergi-costa", "name": "Sergi", "background": "Sergi, 41, upscale coastal cuisine in Santa Coloma, 150 covers, 10 years. Tech-comfortable, uses data to drive menu engineering. Expects: \"Give me the data. I'll make the call.\""}, {"id": "nuria-pizzeria", "name": "Núria", "background": "Núria, 39, pizzeria in L'Hospitalet, 120 covers, 5 years. High-volume, cost-sensitive. Uses the tool weekly now (1+ year). Expects: \"The numbers have to be right. If I can't verify them myself, I won't trust them.\""}, {"id": "marta-triple", "name": "Marta", "background": "Marta, 42, three venues (bar + bistró + catering) in Poblenou, 300 total covers, 9 years. Operates like a small business owner, not a restaurateur. Expects: \"I need per-location P&L impact, not a blended number.\""}, {"id": "jordi-pescaderia", "name": "Jordi", "background": "Jordi, 55, pescaderia in Port Olímpic, 90 covers, 30 years. Quality above all, price secondary but tracked. Expects: \"If a fish supplier goes up 10%, I want to know before I order, not after.\""}, {"id": "carles-duo", "name": "Carles", "background": "Carles, 56, two neighborhood restaurants in Sants and Les Corts, 180 total covers, 30 years. Long-time supplier relationships on both sides. Expects: \"If Location A has a great deal but Location B doesn't, let me apply it selectively.\""}, {"id": "sara-matines", "name": "Sara", "background": "Sara, 33, matí-only café in Sants, 20 seats, 4 years. Tight margins, watches every euro. No tech team, no patience for learning curves. Expects: \"Show me the price difference clearly, or I won't use it.\""}, {"id": "jordi-grup", "name": "Jordi", "background": "Jordi, 48, 2-restaurant group (casual + upscale) in Gràcia, 250 total covers, 15 years. Pragmatic, hates surprises and wasted clicks. Expects: \"One dashboard for both locations. Don't make me log in twice.\""}];

const OUT = 'output/till-personas'
fs.mkdirSync(OUT, { recursive: true })

// ---- API helpers ----
async function req(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } }
  if (body) opts.body = JSON.stringify(body)
  const r = await fetch(API + path, opts)
  const text = await r.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  if (!r.ok) { const e = new Error(data?.error || r.status); e.status = r.status; e.data = data; throw e }
  return data
}
function todayKey(d) { return (d || new Date()).toISOString().slice(0, 10) }
function denomize(amount) {
  const c = Math.round(amount * 100)
  return { '100': Math.floor(c / 10000), '50': Math.floor((c % 10000) / 5000), '20': Math.floor((c % 5000) / 2000), '10': Math.floor((c % 2000) / 1000), '5': Math.floor((c % 1000) / 500), '2': Math.floor((c % 500) / 200), '1': Math.floor((c % 200) / 100), 'coin': 0 }
}
const eur = c => Math.round(c / 100).toFixed(2)

// ---- Persona profile from background text ----
function profileFromBackground(bg, id) {
  const l = bg.toLowerCase()
  return {
    techComfortable: /tech|digital|app|tool|data|analytical|early|innovative|data-driven|data-driven|early-adopter|comfortable/.test(l),
    qualityFocused: /quality|organic|certified|sustainable|artisan|artisanal|sustainable/.test(l),
    isMobile: /mobile|phone|between service|morning-shift|matí-only|6am|6 am|from phone/.test(l),
    firstTimer: /first month|first time|new bistr|opening|new tool/.test(l),
    lowTech: /low-tech|analog|phone call|no tech|no patience|government office|form/.test(l),
    multiLocation: /two |two-|three |duo|group|both locations|per-location|per-location|combined/.test(l),
    powerUser: /2\+ years|1\+ year|long-time|every feature|uses the tool weekly|deeply embedded|data-driven|10 years|12 years|14 years|15 years|18 years|20 years|22 years|25 years|30 years|35 years/.test(l),
    marginSensitive: /tight margins|every euro|cost-sensitive|margin|price|savings|food-cost|cheapest|per-plate|per-event|per-event|per-plate/.test(l),
    auditNeed: /audit|paper trail|verify|numbers have to be right|find out before/.test(l),
  }
}

// ---- UI capture: one representative day in the real browser ----
async function captureUI(browser, persona, prof) {
  const context = await browser.newContext({ viewport: prof.isMobile ? { width: 390, height: 844 } : { width: 1280, height: 900 } })
  const page = await context.newPage()
  const notes = []
  try {
    await page.goto(APP_URL, { waitUntil: 'networkidle' })
    const bodyText = await page.locator('body').innerText().catch(() => '')
    notes.push('page loaded: ' + (bodyText.length > 0 ? 'content present (' + bodyText.length + ' chars)' : 'EMPTY'))

    // Set counts for a realistic day (~€1240)
    const target = 1240.50
    const denoms = denomize(target)
    notes.push('denom inputs: ' + await page.locator('input[data-denom]').count())
    for (const [id, count] of Object.entries(denoms)) {
      const inp = page.locator(`input[data-denom="${id}"]`)
      if (await inp.count()) await inp.fill(String(count)).catch(() => {})
    }
    await page.click('#checkBtn').catch(() => {})
    await page.waitForTimeout(800)

    const verdict = await page.locator('#verdict').innerText().catch(() => '')
    const badge = await page.locator('#vBadge').innerText().catch(() => '')
    notes.push('verdict: "' + verdict.trim().replace(/\n/g, ' | ') + '"')
    if (badge.trim() !== '✓') notes.push('FRICTION: owner sees a VARIANCE — ' + badge.trim())

    const conf = page.locator('#confirmBtn')
    const confVisible = await conf.isVisible().catch(() => false)
    const confEnabled = confVisible ? await conf.isEnabled().catch(() => false) : false
    if (confVisible && confEnabled) {
      await conf.click().catch(() => {})
      await page.waitForTimeout(400)
      notes.push('confirmed')
    } else {
      notes.push('FRICTION: confirm not available (visible=' + confVisible + ')')
    }

    const reconcileBtns = await page.locator('button:has-text("Reconcile")').count()
    const deleteBtns = await page.locator('button:has-text("Delete")').count()
    notes.push('reconcile buttons: ' + reconcileBtns + ' | delete buttons: ' + deleteBtns)
    if (reconcileBtns === 0) notes.push('FRICTION: no reconcile visible')
    if (deleteBtns === 0) notes.push('FRICTION: no delete visible')

    const shot = 'till-' + persona.id + '.png'
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {})
    notes.push('screenshot: ' + shot)
  } catch (e) {
    notes.push('UI error: ' + e.message.slice(0, 100))
  } finally {
    await context.close()
  }
  return notes
}

// ---- 6-month simulation (API-driven) ----
async function simulateLife(browser, persona) {
  const prof = profileFromBackground(persona.background, persona.id)
  const uiNotes = await captureUI(browser, persona, prof)

  const friction = []
  const totals = { reconciles: 0, deletes: 0, forgotten: 0, unconfirmed: 0, double: 0 }

  // Clear entries via API (isolation)
  let hist
  try {
    hist = await req('GET', '/history')
  } catch (e) {
    return { error: 'history fetch: ' + e.message, uiNotes, friction, totals, stats: {} }
  }
  const entries = hist.entries || []
  for (const e of entries) {
    try { await req('DELETE', '/entry/' + e.date) } catch {}
  }

  // Simulate 180 days
  for (let day = 0; day < 180; day++) {
    const d = new Date(START); d.setDate(START.getDate() + day)
    const dateStr = todayKey(d)

    // Forgot the day (~5%)
    if (Math.random() < 0.05) {
      totals.forgotten++
      friction.push({ type: 'forgotten-day', day, date: dateStr, note: 'Count skipped; app shows stale value next day' })
      continue
    }

    // Count the day
    const count = 800 + Math.round(Math.random() * 600)
    let actual = count + (Math.random() < 0.03 ? (Math.random() < 0.5 ? -15 : 15) : 0)

    let entry
    try {
      entry = await req('POST', '/entry', { date: dateStr, denominations: { '100': 0, '50': 0, '20': 0, '10': 0, '5': 0, '2': 0, '1': 0, coin: 0 }, actual: actual })
    } catch (e) {
      if (e.status === 400 && /exists/i.test(e.data?.error || '')) {
        totals.double++
        friction.push({ type: 'double-entry', day, date: dateStr, note: 'Entry already exists; must edit existing' })
      }
      continue
    }

    // Delete + re-enter (~1%)
    if (Math.random() < 0.01) {
      totals.deletes++
      friction.push({ type: 'delete-rerenter', day, date: dateStr, note: 'Deleted and re-entered' })
      try { await req('DELETE', '/entry/' + dateStr) } catch {}
      try { await req('POST', '/entry', { date: dateStr, denominations: {}, actual: actual + 5 }) } catch {}
    }

    // Confirm
    const shouldConfirm = prof.techComfortable || Math.random() < 0.85
    if (!shouldConfirm) {
      totals.unconfirmed++
      friction.push({ type: 'unconfirmed', day, date: dateStr, note: 'Day left unconfirmed' })
    } else {
      try { await req('POST', '/confirm', { date: dateStr }) } catch {}
    }

    // Reconcile (~0.5%)
    if (Math.random() < 0.005) {
      totals.reconciles++
      friction.push({ type: 'reconcile', day, date: dateStr, note: 'Corrected via reconcile' })
      try { await req('POST', '/reconcile', { date: dateStr, actual: actual + 10 }) } catch {}
    }

    // Probe: what does the owner SEE this day?
    const probe = await req('GET', '/history').catch(() => ({ entries: [] }))
    const thisEntry = (probe.entries || []).find(x => x.date === dateStr)
    if (thisEntry) {
      const status = thisEntry.status || ''
      if (status === 'variance' || status === 'unbalanced') {
        friction.push({ type: 'variance-seen', day, date: dateStr, variance: thisEntry.variance, expected: thisEntry.expected })
      }
    }
  }

  // End-of-life state
  let finalHistory
  try { finalHistory = await req('GET', '/history') } catch (e) { finalHistory = { entries: [] } }
  const finalEntries = (finalHistory.entries || []).length
  const finalConfirmed = (finalHistory.entries || []).filter(e => e.confirmed).length

  const stats = { entries: finalEntries, confirmed: finalConfirmed, payments: 0, costs: 0, closings: 0 }

  return { uiNotes, friction, totals, stats, finalEntries, finalConfirmed }
}

// ---- Main ----
const single = process.argv[2]
const browser = await chromium.launch({ headless: true })
try {
  for (const persona of (single ? PERSONAS.filter(p => p.id === single) : PERSONAS)) {
    process.stdout.write('\n=== ' + persona.name + ' (' + persona.id + ') ===\n')
    const start = Date.now()
    const result = await simulateLife(browser, persona)
    const out = {
      personaId: persona.id, name: persona.name, background: persona.background,
      profile: profileFromBackground(persona.background, persona.id),
      stats: result.stats, totals: result.totals,
      friction: result.friction, uiNotes: result.uiNotes,
      finalEntries: result.finalEntries, finalConfirmed: result.finalConfirmed,
      timeMs: Date.now() - start,
    }
    if (result.error) out.error = result.error
    fs.writeFileSync(OUT + '/owner-' + persona.id + '.json', JSON.stringify(out, null, 2))
    process.stdout.write('  entries=' + (result.stats.entries || 0) + ' confirmed=' + (result.stats.confirmed || 0) +
      ' frictions=' + result.friction.length + ' time=' + ((Date.now() - start) / 1000).toFixed(1) + 's\n')
    if (result.error) process.stdout.write('  ERROR: ' + result.error + '\n')
  }
} finally {
  await browser.close()
}
process.stdout.write('\nAll done. → ' + OUT + '\n')
