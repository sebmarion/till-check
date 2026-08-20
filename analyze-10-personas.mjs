#!/usr/bin/env node
// Analyze 10-persona batch results
import fs from 'node:fs'

const PERSONAS = [
  'alex-smart', 'sara-matines', 'laia-brunch', 'marta-mercat', 'pau-casual',
  'david-casa', 'miquel-farina', 'carles-duo', 'jordi-pescaderia', 'marta-nova'
]

const results = []
for (const pid of PERSONAS) {
  const path = `output/till-personas/owner-${pid}.json`
  const data = JSON.parse(fs.readFileSync(path, 'utf8'))
  results.push({
    id: pid,
    name: data.name,
    background: data.background,
    entries: data.stats?.entries || 0,
    confirmed: data.stats?.confirmed || 0,
    unconfirmed: data.stats?.entries - data.stats?.confirmed,
    frictions: data.friction?.length || 0,
    frictionTypes: data.friction?.reduce((acc, f) => {
      acc[f.type] = (acc[f.type] || 0) + 1
      return acc
    }, {}) || {},
    uiNotes: data.uiNotes || [],
    profile: data.profile || {}
  })
}

// Aggregate stats
const totalFrictions = results.reduce((sum, r) => sum + r.frictions, 0)
const totalUnconfirmed = results.reduce((sum, r) => sum + r.unconfirmed, 0)
const avgFrictions = (totalFrictions / results.length).toFixed(1)
const avgUnconfirmed = (totalUnconfirmed / results.length).toFixed(1)

// Friction type totals across all 10
const frictionTotals = {}
for (const r of results) {
  for (const [type, count] of Object.entries(r.frictionTypes)) {
    frictionTotals[type] = (frictionTotals[type] || 0) + count
  }
}

// Who hit baseline variance?
const baselineHits = results.filter(r => r.frictionTypes['variance-seen'] > 0).length

// Who had forgotten days?
const forgottenHits = results.filter(r => r.frictionTypes['forgotten-day'] > 0).length

// Who had delete-rerenter?
const deleteHits = results.filter(r => r.frictionTypes['delete-rerenter'] > 0).length

console.log('========================================')
console.log('TILL CHECK — 10-PERSONA BATCH ANALYSIS')
console.log('========================================')
console.log('')
console.log('PERSONAS:')
console.log('')
for (const r of results) {
  console.log(`  ${r.id}`)
  console.log(`    entries=${r.entries} confirmed=${r.confirmed} unconfirmed=${r.unconfirmed}`)
  console.log(`    frictions=${r.frictions}`)
  console.log(`    profile: tech=${r.profile.techComfortable} mobile=${r.profile.isMobile} firstTimer=${r.profile.firstTimer}`)
  console.log('')
}

console.log('========================================')
console.log('AGGREGATE:')
console.log('')
console.log(`  Total frictions: ${totalFrictions}`)
console.log(`  Avg frictions/persona: ${avgFrictions}`)
console.log(`  Total unconfirmed days: ${totalUnconfirmed}`)
console.log(`  Avg unconfirmed/persona: ${avgUnconfirmed}`)
console.log('')
console.log('Friction types (total across 10 personas):')
for (const [type, count] of Object.entries(frictionTotals).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${type}: ${count}`)
}
console.log('')
console.log('========================================')
console.log('KEY FINDINGS:')
console.log('')
console.log(`  Baseline variance seen: ${baselineHits}/10 personas`)
console.log(`  Forgotten days: ${forgottenHits}/10 personas`)
console.log(`  Delete-rerenter: ${deleteHits}/10 personas`)
console.log('')
