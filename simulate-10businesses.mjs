#!/usr/bin/env node
// 10-Business Simulation for Till Check
// Simulates 3 months of operations for 10 different business owners.
//
// Each business has different:
//   - Staff size and mix
//   - Pay schedules and rates
//   - Cost structure
//   - Daily sales volume

const BASE = 'http://127.0.0.1:80/till/api';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

function dateStr(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Business profiles
const BUSINESS_PROFILES = [
  {
    name: 'Cozy Corner Café',
    type: 'café',
    staff: [
      { name: 'Maria', paySchedule: 'weekly', payMethod: 'cash', amount: 800 },
      { name: 'John', paySchedule: 'hourly', payMethod: 'transfer', rate: 15, hours: 30 },
      { name: 'Anna', paySchedule: 'monthly', payMethod: 'transfer_cash', amount: 2500 },
      { name: 'Carlos', paySchedule: 'hourly', payMethod: 'cash', rate: 12, hours: 20 },
    ],
    rent: 2000,
    electricity: 150,
    water: 80,
    internet: 50,
    dailySales: [800, 1500],
    cardSales: [1200, 2000],
    varianceChance: 0.05,
  },
  {
    name: 'Burger Barn',
    type: 'fast_food',
    staff: [
      { name: 'Mike', paySchedule: 'hourly', payMethod: 'cash', rate: 13, hours: 40 },
      { name: 'Lisa', paySchedule: 'hourly', payMethod: 'transfer', rate: 13, hours: 35 },
      { name: 'Tom', paySchedule: 'weekly', payMethod: 'cash', amount: 900 },
      { name: 'Sarah', paySchedule: 'hourly', payMethod: 'cash', rate: 14, hours: 25 },
      { name: 'Dave', paySchedule: 'hourly', payMethod: 'transfer', rate: 13, hours: 30 },
    ],
    rent: 3500,
    electricity: 200,
    water: 100,
    internet: 75,
    dailySales: [1500, 2500],
    cardSales: [2000, 3500],
    varianceChance: 0.08,
  },
  {
    name: 'Wine & Dine',
    type: 'restaurant',
    staff: [
      { name: 'Chef Marco', paySchedule: 'monthly', payMethod: 'transfer', amount: 4500 },
      { name: 'Sofia', paySchedule: 'weekly', payMethod: 'transfer', amount: 1200 },
      { name: 'Pierre', paySchedule: 'hourly', payMethod: 'transfer', rate: 18, hours: 35 },
      { name: 'Nina', paySchedule: 'weekly', payMethod: 'cash', amount: 800 },
      { name: 'Raj', paySchedule: 'hourly', payMethod: 'transfer', rate: 16, hours: 40 },
      { name: 'Kate', paySchedule: 'weekly', payMethod: 'transfer', amount: 1000 },
    ],
    rent: 5000,
    electricity: 300,
    water: 150,
    internet: 100,
    dailySales: [2000, 3500],
    cardSales: [3000, 5000],
    varianceChance: 0.03,
  },
  {
    name: 'Quick Bites',
    type: 'food_truck',
    staff: [
      { name: 'Alex', paySchedule: 'hourly', payMethod: 'cash', rate: 14, hours: 30 },
      { name: 'Bella', paySchedule: 'hourly', payMethod: 'transfer', rate: 13, hours: 25 },
      { name: 'Chris', paySchedule: 'weekly', payMethod: 'cash', amount: 700 },
    ],
    rent: 1200,
    electricity: 80,
    water: 50,
    internet: 40,
    dailySales: [500, 1200],
    cardSales: [800, 1500],
    varianceChance: 0.10,
  },
  {
    name: 'Sushi House',
    type: 'restaurant',
    staff: [
      { name: 'Kenji', paySchedule: 'monthly', payMethod: 'transfer', amount: 5000 },
      { name: 'Yuki', paySchedule: 'weekly', payMethod: 'transfer', amount: 1500 },
      { name: 'Hiro', paySchedule: 'hourly', payMethod: 'transfer', rate: 20, hours: 35 },
      { name: 'Mei', paySchedule: 'weekly', payMethod: 'cash', amount: 900 },
    ],
    rent: 4000,
    electricity: 250,
    water: 120,
    internet: 80,
    dailySales: [1800, 3000],
    cardSales: [2500, 4000],
    varianceChance: 0.04,
  },
  {
    name: 'Pizza Palace',
    type: 'fast_food',
    staff: [
      { name: 'Luigi', paySchedule: 'weekly', payMethod: 'cash', amount: 1100 },
      { name: 'Marco', paySchedule: 'hourly', payMethod: 'transfer', rate: 15, hours: 40 },
      { name: 'Giulia', paySchedule: 'hourly', payMethod: 'cash', rate: 14, hours: 30 },
      { name: 'Stefano', paySchedule: 'hourly', payMethod: 'transfer', rate: 13, hours: 35 },
      { name: 'Alessia', paySchedule: 'weekly', payMethod: 'transfer', amount: 800 },
    ],
    rent: 3000,
    electricity: 220,
    water: 90,
    internet: 60,
    dailySales: [1400, 2400],
    cardSales: [1800, 3000],
    varianceChance: 0.07,
  },
  {
    name: 'The Daily Grind',
    type: 'café',
    staff: [
      { name: 'Emma', paySchedule: 'hourly', payMethod: 'transfer', rate: 16, hours: 35 },
      { name: 'Jack', paySchedule: 'weekly', payMethod: 'cash', amount: 850 },
      { name: 'Olivia', paySchedule: 'hourly', payMethod: 'transfer', rate: 14, hours: 28 },
    ],
    rent: 1800,
    electricity: 120,
    water: 60,
    internet: 55,
    dailySales: [700, 1300],
    cardSales: [1000, 1800],
    varianceChance: 0.06,
  },
  {
    name: 'Taco Tuesday',
    type: 'fast_food',
    staff: [
      { name: 'Carlos', paySchedule: 'hourly', payMethod: 'cash', rate: 15, hours: 45 },
      { name: 'Rosa', paySchedule: 'weekly', payMethod: 'transfer', amount: 950 },
      { name: 'Miguel', paySchedule: 'hourly', payMethod: 'cash', rate: 14, hours: 35 },
      { name: 'Lucia', paySchedule: 'hourly', payMethod: 'transfer', rate: 13, hours: 30 },
    ],
    rent: 2500,
    electricity: 180,
    water: 70,
    internet: 50,
    dailySales: [1200, 2200],
    cardSales: [1500, 2800],
    varianceChance: 0.09,
  },
  {
    name: 'Fine Dining Co.',
    type: 'restaurant',
    staff: [
      { name: 'Chef Antoine', paySchedule: 'monthly', payMethod: 'transfer', amount: 6000 },
      { name: 'Sophie', paySchedule: 'weekly', payMethod: 'transfer', amount: 1800 },
      { name: 'Jean', paySchedule: 'hourly', payMethod: 'transfer', rate: 22, hours: 40 },
      { name: 'Marie', paySchedule: 'weekly', payMethod: 'cash', amount: 1200 },
      { name: 'Pierre', paySchedule: 'hourly', payMethod: 'transfer', rate: 18, hours: 35 },
      { name: 'Claire', paySchedule: 'weekly', payMethod: 'transfer', amount: 1000 },
    ],
    rent: 6000,
    electricity: 350,
    water: 180,
    internet: 120,
    dailySales: [2500, 4000],
    cardSales: [4000, 6000],
    varianceChance: 0.02,
  },
  {
    name: 'Breakfast Bar',
    type: 'café',
    staff: [
      { name: 'Amy', paySchedule: 'hourly', payMethod: 'transfer', rate: 15, hours: 38 },
      { name: 'Ben', paySchedule: 'weekly', payMethod: 'cash', amount: 750 },
      { name: 'Chloe', paySchedule: 'hourly', payMethod: 'transfer', rate: 14, hours: 32 },
      { name: 'Dan', paySchedule: 'hourly', payMethod: 'cash', rate: 13, hours: 25 },
    ],
    rent: 2200,
    electricity: 140,
    water: 65,
    internet: 45,
    dailySales: [900, 1600],
    cardSales: [1300, 2200],
    varianceChance: 0.07,
  },
];

async function simulateBusiness(profile) {
  console.log(`\n=== Simulating: ${profile.name} (${profile.type}) ===`);
  
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
    // Monthly costs
    const costsForMonth = [];
    
    // Rent (1st)
    costsForMonth.push({ date: dateStr(m.year, m.month, 1), category: 'rent', label: `Rent ${m.month}`, amount: profile.rent.toFixed(2) });
    
    // Internet (1st)
    costsForMonth.push({ date: dateStr(m.year, m.month, 1), category: 'internet', label: 'Internet', amount: profile.internet.toFixed(2) });
    
    // Water (15th)
    costsForMonth.push({ date: dateStr(m.year, m.month, 15), category: 'utilities_water', label: 'Water bill', amount: profile.water.toFixed(2) });
    
    // Electricity (Fridays)
    for (let day = 1; day <= m.days; day++) {
      const d = new Date(m.year, m.month - 1, day);
      if (d.getDay() === 5) {
        costsForMonth.push({ date: dateStr(m.year, m.month, day), category: 'utilities_electricity', label: 'Electricity', amount: profile.electricity.toFixed(2) });
      }
    }
    
    for (const cost of costsForMonth) {
      await req('POST', '/costs', cost);
      totalCosts++;
      await sleep(10); // Small delay to prevent connection issues
    }

    // Payroll
    const paymentsForMonth = [];
    
    for (let day = 1; day <= m.days; day++) {
      const d = new Date(m.year, m.month - 1, day);
      const date = dateStr(m.year, m.month, day);
      
      // Weekly payments (every Monday)
      if (d.getDay() === 1) {
        for (const staff of profile.staff) {
          if (staff.paySchedule === 'weekly') {
            paymentsForMonth.push({ date, personId: staff.id, amount: staff.amount.toFixed(2), payMethod: staff.payMethod, note: 'Weekly pay' });
          }
        }
      }
      
      // Hourly payments (every Friday)
      if (d.getDay() === 5) {
        for (const staff of profile.staff) {
          if (staff.paySchedule === 'hourly') {
            const weeklyPay = staff.rate * staff.hours;
            paymentsForMonth.push({ date, personId: staff.id, amount: weeklyPay.toFixed(2), payMethod: staff.payMethod, note: `Hourly (${staff.hours} hrs)` });
          }
        }
      }
    }
    
    // Monthly payments (1st)
    for (const staff of profile.staff) {
      if (staff.paySchedule === 'monthly') {
        paymentsForMonth.push({ date: dateStr(m.year, m.month, 1), personId: staff.id, amount: staff.amount.toFixed(2), payMethod: staff.payMethod, note: 'Monthly salary' });
      }
    }
    
    for (const payment of paymentsForMonth) {
      await req('POST', '/payments', payment);
      totalPayments++;
      await sleep(10); // Small delay to prevent connection issues
    }

    // Daily till entries
    for (let day = 1; day <= m.days; day++) {
      const date = dateStr(m.year, m.month, day);
      const d = new Date(m.year, m.month - 1, day);
      
      const isWeekend = d.getDay() === 5 || d.getDay() === 6 || d.getDay() === 0;
      const baseCash = isWeekend 
        ? rand(profile.dailySales[0] * 1.5, profile.dailySales[1] * 1.5)
        : rand(profile.dailySales[0], profile.dailySales[1]);
      
      const cashAdded = randInt(0, 3) * 50;
      const cashRemoved = randInt(0, 4) * 50;
      const cardTransfer = rand(profile.cardSales[0], profile.cardSales[1]);
      
      let variance = 0;
      if (Math.random() < profile.varianceChance) {
        variance = randInt(-20, 20) * 100;
      }
      
      const actual = (baseCash + cashAdded - cashRemoved) / 100 + variance / 100;
      
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
      await sleep(10); // Small delay to prevent connection issues
    }

    // Close the month
    const ym = `${m.year}-${String(m.month).padStart(2, '0')}`;
    await req('POST', `/monthly/${ym}`);
  }

  console.log(`  Days: ${totalDays}, Payments: ${totalPayments}, Costs: ${totalCosts}, Entries: ${totalEntries}`);
  
  return {
    name: profile.name,
    days: totalDays,
    payments: totalPayments,
    costs: totalCosts,
    entries: totalEntries,
  };
}

async function main() {
  console.log('=== 10-Business Simulation Starting ===\n');
  
  const results = [];
  
  for (let i = 0; i < BUSINESS_PROFILES.length; i++) {
    const profile = BUSINESS_PROFILES[i];
    console.log(`\n[${i + 1}/10] ${profile.name}`);
    
    // Clean up previous business data
    console.log('  Cleaning up...');
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync('data/till.sqlite');
    db.prepare('DELETE FROM people').run();
    db.prepare('DELETE FROM payments').run();
    db.prepare('DELETE FROM costs').run();
    db.prepare('DELETE FROM monthly_closings').run();
    db.prepare('DELETE FROM entries').run();
    db.prepare('DELETE FROM state').run();
    db.close();
    
    // Set baseline
    await req('POST', '/baseline', { actual: '500.00' });
    
    // Create staff
    for (const staff of profile.staff) {
      const person = await req('POST', '/people', { 
        name: staff.name, 
        paySchedule: staff.paySchedule, 
        payMethod: staff.payMethod,
        hourlyRate: staff.rate || 0,
      });
      staff.id = person.id;
    }
    
    // Simulate
    const result = await simulateBusiness(profile);
    results.push(result);
  }
  
  console.log('\n=== Summary ===');
  console.log('Business'.padEnd(25) + 'Days'.padEnd(8) + 'Payments'.padEnd(10) + 'Costs'.padEnd(8) + 'Entries');
  console.log('-'.repeat(60));
  for (const r of results) {
    console.log(r.name.padEnd(25) + r.days.toString().padEnd(8) + r.payments.toString().padEnd(10) + r.costs.toString().padEnd(8) + r.entries.toString());
  }
  
  console.log('\n=== 10-Business Simulation Complete ===');
}

main().catch((e) => {
  console.error('Simulation failed:', e);
  process.exit(1);
});
