#!/usr/bin/env node
// 3-Month Simulation for Till Check
// Simulates realistic bistro operations over June, July, August 2026.
//
// Staff:
//   - Maria: weekly, cash, €800/week
//   - John: hourly, transfer, €15/hr, works 30 hrs/week
//   - Anna: monthly, transfer+cash, €2500/month
//   - Carlos: hourly, cash, €12/hr, works 20 hrs/week
//   - Emma: weekly, transfer, €600/week
//
// Costs:
//   - Rent: €2000/month (1st of month)
//   - Electricity: €150/week (Fridays)
//   - Water: €80/month (15th)
//   - Internet: €50/month (1st)
//
// Daily operations:
//   - Cash sales: €800-1500/day
//   - Card sales: €1200-2000/day
//   - Cash removed: €0-200 (bank deposits)
//   - Cash added: €0-100 (float top-ups)

import { DatabaseSync } from 'node:sqlite';

const BASE = 'http://127.0.0.1:80/till/api';

async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.status), { status: res.status, data });
  return data;
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}

function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}

function dateStr(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Generate 3 months of simulation data
async function simulate() {
  console.log('=== 3-Month Simulation Starting ===\n');
  
  // Clean up any existing test data
  console.log('Cleaning up test data...');
  const db = new DatabaseSync('data/till.sqlite');
  db.prepare('DELETE FROM people').run();
  db.prepare('DELETE FROM payments').run();
  db.prepare('DELETE FROM costs').run();
  db.prepare('DELETE FROM monthly_closings').run();
  db.prepare('DELETE FROM entries').run();
  db.prepare('DELETE FROM state').run();
  console.log('Done.');

  // Set baseline
  console.log('\nSetting baseline...');
  await req('POST', '/baseline', { actual: '500.00' });
  console.log('Baseline set: €500.00');

  // Create staff
  console.log('\nCreating staff...');
  const staff = [];
  
  const maria = await req('POST', '/people', { name: 'Maria', paySchedule: 'weekly', payMethod: 'cash' });
  staff.push({ ...maria, role: 'chef' });
  
  const john = await req('POST', '/people', { name: 'John', paySchedule: 'hourly', payMethod: 'transfer', hourlyRate: '15.00' });
  staff.push({ ...john, role: 'server' });
  
  const anna = await req('POST', '/people', { name: 'Anna', paySchedule: 'monthly', payMethod: 'transfer_cash' });
  staff.push({ ...anna, role: 'manager' });
  
  const carlos = await req('POST', '/people', { name: 'Carlos', paySchedule: 'hourly', payMethod: 'cash', hourlyRate: '12.00' });
  staff.push({ ...carlos, role: 'barista' });
  
  const emma = await req('POST', '/people', { name: 'Emma', paySchedule: 'weekly', payMethod: 'transfer' });
  staff.push({ ...emma, role: 'server' });
  
  console.log(`Created ${staff.length} staff members.`);

  // Simulate 3 months: June (6), July (7), August (8) 2026
  const months = [
    { year: 2026, month: 6, days: 30 },
    { year: 2026, month: 7, days: 31 },
    { year: 2026, month: 8, days: 31 },
  ];

  let totalDays = 0;
  let totalPayments = 0;
  let totalCosts = 0;
  let totalEntries = 0;

  for (const m of months) {
    console.log(`\n=== Simulating ${m.year}-${String(m.month).padStart(2, '0')} ===`);
    
    // Monthly costs
    const costsForMonth = [];
    
    // Rent (1st)
    costsForMonth.push({ date: dateStr(m.year, m.month, 1), category: 'rent', label: `Rent ${m.month}`, amount: '2000.00' });
    
    // Internet (1st)
    costsForMonth.push({ date: dateStr(m.year, m.month, 1), category: 'internet', label: 'Internet', amount: '50.00' });
    
    // Water (15th)
    costsForMonth.push({ date: dateStr(m.year, m.month, 15), category: 'utilities_water', label: 'Water bill', amount: '80.00' });
    
    // Electricity (Fridays, ~€150/week)
    for (let day = 1; day <= m.days; day++) {
      const d = new Date(m.year, m.month - 1, day);
      if (d.getDay() === 5) { // Friday
        costsForMonth.push({ date: dateStr(m.year, m.month, day), category: 'utilities_electricity', label: 'Electricity', amount: '150.00' });
      }
    }
    
    for (const cost of costsForMonth) {
      await req('POST', '/costs', cost);
      totalCosts++;
    }
    console.log(`Recorded ${costsForMonth.length} costs.`);

    // Payroll
    const paymentsForMonth = [];
    
    // Weekly payments (every Monday)
    for (let day = 1; day <= m.days; day++) {
      const d = new Date(m.year, m.month - 1, day);
      if (d.getDay() === 1) { // Monday
        // Maria: weekly cash
        paymentsForMonth.push({ date: dateStr(m.year, m.month, day), personId: maria.id, amount: '800.00', payMethod: 'cash', note: 'Weekly pay' });
        // Emma: weekly transfer
        paymentsForMonth.push({ date: dateStr(m.year, m.month, day), personId: emma.id, amount: '600.00', payMethod: 'transfer', note: 'Weekly pay' });
      }
      
      // Hourly: John and Carlos get paid every Friday for the week
      if (d.getDay() === 5) {
        // John: 30 hrs/week @ €15 = €450
        paymentsForMonth.push({ date: dateStr(m.year, m.month, day), personId: john.id, amount: '450.00', payMethod: 'transfer', note: 'Hourly (30 hrs)' });
        // Carlos: 20 hrs/week @ €12 = €240
        paymentsForMonth.push({ date: dateStr(m.year, m.month, day), personId: carlos.id, amount: '240.00', payMethod: 'cash', note: 'Hourly (20 hrs)' });
      }
    }
    
    // Anna: monthly on the 1st
    paymentsForMonth.push({ date: dateStr(m.year, m.month, 1), personId: anna.id, amount: '2500.00', payMethod: 'transfer_cash', note: 'Monthly salary' });
    
    for (const payment of paymentsForMonth) {
      await req('POST', '/payments', payment);
      totalPayments++;
    }
    console.log(`Recorded ${paymentsForMonth.length} payments.`);

    // Daily till entries
    for (let day = 1; day <= m.days; day++) {
      const date = dateStr(m.year, m.month, day);
      const d = new Date(m.year, m.month - 1, day);
      
      // Weekends are busier
      const isWeekend = d.getDay() === 5 || d.getDay() === 6 || d.getDay() === 0;
      const baseCash = isWeekend ? rand(1200, 1800) : rand(800, 1500);
      const cashAdded = randInt(0, 3) * 50; // €0, €50, or €100
      const cashRemoved = randInt(0, 4) * 50; // €0, €50, €100, €150, or €200
      const cardTransfer = rand(1200, 2000);
      
      // Add some variance (5% of days have a discrepancy)
      let variance = 0;
      if (Math.random() < 0.05) {
        variance = randInt(-20, 20) * 100; // -€20 to +€20
      }
      
      const actual = (baseCash + cashAdded - cashRemoved) / 100 + variance / 100;
      
      // Use denominations for realism
      const denominations = {};
      let remaining = Math.round(actual * 100);
      const denomValues = [5000, 2000, 1000, 500, 200, 100, 50, 20];
      const denomIds = ['50', '20', '10', '5', '2', '1', '0.5', '0.2'];
      for (let i = 0; i < denomValues.length && remaining > 0; i++) {
        const count = Math.floor(remaining / denomValues[i]);
        if (count > 0) denominations[denomIds[i]] = count;
        remaining -= count * denomValues[i];
      }
      
      await req('POST', '/entry', {
        date,
        actual: actual.toFixed(2),
        cashRemoved: cashRemoved.toFixed(2),
        cashAdded: cashAdded.toFixed(2),
        cardTransfer: cardTransfer.toFixed(2),
        declared: '',
        denominations,
      });
      totalEntries++;
      totalDays++;
    }
    console.log(`Recorded ${m.days} daily entries.`);
    
    // Close the month
    const ym = `${m.year}-${String(m.month).padStart(2, '0')}`;
    await req('POST', `/monthly/${ym}`);
    console.log(`Closed month ${ym}.`);
  }

  console.log(`\n=== Simulation Complete ===`);
  console.log(`Total days: ${totalDays}`);
  console.log(`Total payments: ${totalPayments}`);
  console.log(`Total costs: ${totalCosts}`);
  console.log(`Total entries: ${totalEntries}`);
  
  // Verify stats
  const stats = await req('GET', '/stats');
  console.log(`\nStats: ${JSON.stringify(stats)}`);
  
  // Verify monthly closings
  for (const m of months) {
    const ym = `${m.year}-${String(m.month).padStart(2, '0')}`;
    const monthly = await req('GET', `/monthly/${ym}`);
    console.log(`Monthly ${ym}: ${JSON.stringify(monthly)}`);
  }
}

simulate().catch((e) => {
  console.error('Simulation failed:', e);
  process.exit(1);
});