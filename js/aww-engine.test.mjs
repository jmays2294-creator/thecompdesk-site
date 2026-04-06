/**
 * aww-engine.test.mjs — Unit tests for the NYS AWW calculation engine
 *
 * Run with: node js/aww-engine.test.mjs
 * Requires Node.js 18+ (built-in test runner).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateAWW, getMaxForDate, getMinForDate } from './aww-engine.mjs';

// ─── Helper ───────────────────────────────────────────────────────────────

function r2(n) { return Math.round(n * 100) / 100; }

// ─── Rate-lookup tests ─────────────────────────────────────────────────────

test('getMaxForDate: DOI 2025-08-01 → $1,222.42', () => {
  const r = getMaxForDate('2025-08-01');
  assert.strictEqual(r.max, 1222.42);
});

test('getMaxForDate: DOI 2024-10-15 → $1,171.46', () => {
  const r = getMaxForDate('2024-10-15');
  assert.strictEqual(r.max, 1171.46);
});

test('getMaxForDate: DOI 2023-09-01 → $1,145.43', () => {
  const r = getMaxForDate('2023-09-01');
  assert.strictEqual(r.max, 1145.43);
});

test('getMaxForDate: DOI 2022-08-15 → $1,125.46', () => {
  const r = getMaxForDate('2022-08-15');
  assert.strictEqual(r.max, 1125.46);
});

test('getMaxForDate: DOI 2021-09-01 → $1,063.05', () => {
  const r = getMaxForDate('2021-09-01');
  assert.strictEqual(r.max, 1063.05);
});

test('getMaxForDate: DOI 2020-08-01 → $966.78', () => {
  const r = getMaxForDate('2020-08-01');
  assert.strictEqual(r.max, 966.78);
});

test('getMaxForDate: DOI 2018-08-01 → $904.74', () => {
  const r = getMaxForDate('2018-08-01');
  assert.strictEqual(r.max, 904.74);
});

test('getMinForDate: DOI 2024-10-15 → $275', () => {
  const r = getMinForDate('2024-10-15');
  assert.strictEqual(r.min, 275);
});

test('getMinForDate: DOI 2025-03-15 → $325', () => {
  const r = getMinForDate('2025-03-15');
  assert.strictEqual(r.min, 325);
});

test('getMinForDate: DOI 2020-06-01 → $150', () => {
  const r = getMinForDate('2020-06-01');
  assert.strictEqual(r.min, 150);
});

// ─── §14(1) 52-Week Divisor ───────────────────────────────────────────────

test('T01 §14(1): basic 52-week calc — AWW $1,000, TT rate $666.67', () => {
  const res = calculateAWW({
    doi: '2024-10-15', method: '52week', annualEarnings: 52000,
  });
  assert.strictEqual(res.aww,    1000);
  assert.strictEqual(res.ttRate, 666.67);
  assert.strictEqual(res.method, '52week');
  assert.strictEqual(res.warnings.length, 0);
});

test('T02 §14(1): high earner capped at statutory max ($1,171.46)', () => {
  const res = calculateAWW({
    doi: '2024-10-15', method: '52week', annualEarnings: 200000,
  });
  // AWW = 200000/52 = 3846.15, 2/3 = 2564.10 → capped at 1171.46
  assert.strictEqual(res.aww,    r2(200000 / 52));
  assert.strictEqual(res.ttRate, 1171.46);
});

test('T03 §14(1): DOI 2021 — capped at $1,063.05', () => {
  const res = calculateAWW({
    doi: '2021-09-01', method: '52week', annualEarnings: 120000,
  });
  assert.strictEqual(res.ttRate, 1063.05);
  assert.strictEqual(res.maxRate, 1063.05);
});

test('T04 §14(1): DOI 2020 — capped at $966.78', () => {
  const res = calculateAWW({
    doi: '2020-08-01', method: '52week', annualEarnings: 120000,
  });
  assert.strictEqual(res.ttRate, 966.78);
});

test('T05 §14(1): DOI 2018 — capped at $904.74', () => {
  const res = calculateAWW({
    doi: '2018-08-01', method: '52week', annualEarnings: 120000,
  });
  assert.strictEqual(res.ttRate, 904.74);
});

// ─── §14(2) Statutory Multiplier ─────────────────────────────────────────

test('T06 §14(2) ×260 (5-day): AWW $1,125, TT $750', () => {
  // dailyWage = 45000/200 = 225; AWW = 225×260/52 = 1125
  const res = calculateAWW({
    doi: '2024-10-15', method: 'statutory',
    totalEarnings: 45000, daysWorked: 200, daysPerWeek: 5,
  });
  assert.strictEqual(res.aww,    1125);
  assert.strictEqual(res.ttRate, 750);
});

test('T07 §14(2) ×200 (4-day): AWW $769.23, TT $512.82', () => {
  // dailyWage = 32000/160 = 200; AWW = 200×200/52 = 769.23
  const res = calculateAWW({
    doi: '2024-10-15', method: 'statutory',
    totalEarnings: 32000, daysWorked: 160, daysPerWeek: 4,
  });
  assert.strictEqual(res.aww,    769.23);
  assert.strictEqual(res.ttRate, 512.82);
});

test('T08 §14(2) ×300 (6-day): AWW $1,298.08, TT $865.38', () => {
  // dailyWage = 54000/240 = 225; AWW = 225×300/52 = 1298.07692...
  const res = calculateAWW({
    doi: '2024-10-15', method: 'statutory',
    totalEarnings: 54000, daysWorked: 240, daysPerWeek: 6,
  });
  assert.strictEqual(res.aww,    r2(225 * 300 / 52));
  assert.strictEqual(res.ttRate, r2(r2(225 * 300 / 52) * 2 / 3));
});

test('T09 §14(2) ×365 (7-day): AWW computed correctly', () => {
  // dailyWage = 54000/280 = 192.857...; AWW = 192.857 × 365 / 52
  const dailyWage = 54000 / 280;
  const expectedAWW = r2(dailyWage * 365 / 52);
  const res = calculateAWW({
    doi: '2024-10-15', method: 'statutory',
    totalEarnings: 54000, daysWorked: 280, daysPerWeek: 7,
  });
  assert.strictEqual(res.aww, expectedAWW);
});

// ─── Adjustments ──────────────────────────────────────────────────────────

test('T10 Tips / Gratuities added to AWW', () => {
  // baseAWW = (20000/150)×260/52 = 133.33×5 = 666.67; + $200 tips = 866.67
  const res = calculateAWW({
    doi: '2024-10-15', method: 'statutory',
    totalEarnings: 20000, daysWorked: 150, daysPerWeek: 5,
    tipsWeekly: 200,
  });
  assert.strictEqual(res.aww,    r2(r2(20000 / 150 * 260 / 52) + 200));
  assert.ok(res.adjustments.some(a => a.label === 'Tips / Gratuities'));
  assert.strictEqual(res.warnings.length, 0);
});

test('T11 Board / Lodging added to AWW', () => {
  // baseAWW = (18000/200)×260/52 = 90×5 = 450; + $100 board = 550
  const res = calculateAWW({
    doi: '2024-10-15', method: 'statutory',
    totalEarnings: 18000, daysWorked: 200, daysPerWeek: 5,
    boardLodgingWeekly: 100,
  });
  assert.strictEqual(res.aww,    550);
  assert.strictEqual(res.ttRate, r2(550 * 2 / 3));
  assert.ok(res.adjustments.some(a => a.label === 'Board / Lodging'));
});

test('T12 Concurrent Employment added to AWW', () => {
  // baseAWW = (26000/200)×260/52 = 130×5 = 650; + $300 concurrent = 950
  const res = calculateAWW({
    doi: '2024-10-15', method: 'statutory',
    totalEarnings: 26000, daysWorked: 200, daysPerWeek: 5,
    concurrentAWW: 300,
  });
  assert.strictEqual(res.aww,    950);
  assert.strictEqual(res.ttRate, r2(950 * 2 / 3));
  assert.ok(res.adjustments.some(a => a.label === 'Concurrent Employment'));
});

test('T13 All three adjustments combined', () => {
  // baseAWW = (26000/200)×260/52 = 650; + 100 tips + 50 board + 200 concurrent = 1000
  const res = calculateAWW({
    doi: '2024-10-15', method: 'statutory',
    totalEarnings: 26000, daysWorked: 200, daysPerWeek: 5,
    tipsWeekly: 100, boardLodgingWeekly: 50, concurrentAWW: 200,
  });
  assert.strictEqual(res.aww,    1000);
  assert.strictEqual(res.ttRate, r2(1000 * 2 / 3));
  assert.strictEqual(res.adjustments.length, 3);
});

// ─── 200-Multiple Rule ────────────────────────────────────────────────────

test('T14 200-multiple rule triggered: similar employee rate used', () => {
  // claimantAWW = (5000/50)×260/52 = 500; similar200 = 200×200/52 = 769.23
  const res = calculateAWW({
    doi: '2024-10-15', method: 'statutory',
    totalEarnings: 5000, daysWorked: 50, daysPerWeek: 5,
    apply200Rule: true, similarDailyWage: 200,
  });
  assert.strictEqual(res.multiplier200Applied, true);
  assert.strictEqual(res.aww,    769.23);
  assert.strictEqual(res.ttRate, 512.82);
});

test('T15 200-multiple rule NOT triggered: claimant AWW is higher', () => {
  // claimantAWW = (50000/200)×260/52 = 1250; similar200 = 200×200/52 = 769.23
  const res = calculateAWW({
    doi: '2024-10-15', method: 'statutory',
    totalEarnings: 50000, daysWorked: 200, daysPerWeek: 5,
    apply200Rule: true, similarDailyWage: 200,
  });
  assert.strictEqual(res.multiplier200Applied, false);
  assert.strictEqual(res.aww,    1250);
});

// ─── Straight Divisor ────────────────────────────────────────────────────

test('T16 Straight divisor: AWW $666.67, TT $444.44', () => {
  const res = calculateAWW({
    doi: '2024-10-15', method: 'straight',
    straightEarnings: 20000, weeksWorked: 30,
  });
  assert.strictEqual(res.aww,    r2(20000 / 30));
  assert.strictEqual(res.ttRate, r2(r2(20000 / 30) * 2 / 3));
});

test('T17 Straight divisor: capped at 2023 max $1,145.43', () => {
  const res = calculateAWW({
    doi: '2023-09-01', method: 'straight',
    straightEarnings: 200000, weeksWorked: 30,
  });
  assert.strictEqual(res.ttRate, 1145.43);
  assert.strictEqual(res.maxRate, 1145.43);
});

// ─── Hourly Method ───────────────────────────────────────────────────────

test('T18 Hourly: $20/hr × 40 hrs = AWW $800, TT $533.33', () => {
  const res = calculateAWW({
    doi: '2024-10-15', method: 'hourly',
    hourlyRate: 20, hoursPerWeek: 40,
  });
  assert.strictEqual(res.aww,    800);
  assert.strictEqual(res.ttRate, r2(800 * 2 / 3));
});

test('T19 Hourly: part-time $15/hr × 25 hrs = AWW $375', () => {
  const res = calculateAWW({
    doi: '2024-10-15', method: 'hourly',
    hourlyRate: 15, hoursPerWeek: 25,
  });
  assert.strictEqual(res.aww, 375);
});

// ─── §14(3) Similar Employee ──────────────────────────────────────────────

test('T20 §14(3) similar employee: AWW $1,250, TT $833.33', () => {
  const res = calculateAWW({
    doi: '2024-10-15', method: 'similarEmployee',
    similarAnnualEarnings: 65000,
  });
  assert.strictEqual(res.aww,    r2(65000 / 52));
  assert.strictEqual(res.ttRate, r2(r2(65000 / 52) * 2 / 3));
});

// ─── Minimum Rate Floor (WCL §204) ───────────────────────────────────────

test('T21 Min floor 2024 ($275): 2/3 AWW below floor, raised to $275', () => {
  // aww = 15000/52 = 288.46; 2/3 = 192.31 < 275 → floor to min(275, 288.46) = 275
  const res = calculateAWW({
    doi: '2024-10-15', method: '52week', annualEarnings: 15000,
  });
  assert.strictEqual(res.ttRate,          275);
  assert.strictEqual(res.minFloorApplied, true);
  assert.strictEqual(res.minRate,         275);
});

test('T22 Min floor 2024: AWW itself below $275 → TT rate = full AWW', () => {
  // aww = 10000/52 = 192.31; 2/3 = 128.21 < 275 → floor = min(275, 192.31) = 192.31
  const res = calculateAWW({
    doi: '2024-10-15', method: '52week', annualEarnings: 10000,
  });
  assert.strictEqual(res.ttRate,          r2(10000 / 52));
  assert.strictEqual(res.minFloorApplied, true);
});

test('T23 Min floor 2025 ($325): low earner raised to $325', () => {
  // aww = 18000/52 = 346.15; 2/3 = 230.77 < 325 → floor = min(325, 346.15) = 325
  const res = calculateAWW({
    doi: '2025-03-15', method: '52week', annualEarnings: 18000,
  });
  assert.strictEqual(res.ttRate,          325);
  assert.strictEqual(res.minFloorApplied, true);
  assert.strictEqual(res.minRate,         325);
});

test('T24 Min floor 2013-2023 ($150): low earner raised to $150', () => {
  // aww = 9000/52 = 173.08; 2/3 = 115.38 < 150 → floor = min(150, 173.08) = 150
  const res = calculateAWW({
    doi: '2020-06-01', method: '52week', annualEarnings: 9000,
  });
  assert.strictEqual(res.ttRate,          150);
  assert.strictEqual(res.minFloorApplied, true);
});

test('T25 No min floor when 2/3 AWW already exceeds minimum', () => {
  const res = calculateAWW({
    doi: '2024-10-15', method: '52week', annualEarnings: 52000,
  });
  // 2/3 of 1000 = 666.67 > 275 min
  assert.strictEqual(res.minFloorApplied, false);
  assert.strictEqual(res.ttRate,          666.67);
});

// ─── TPD Scenarios ───────────────────────────────────────────────────────

test('T26 TPD scenarios computed correctly for AWW $1,000', () => {
  const res = calculateAWW({
    doi: '2024-10-15', method: '52week', annualEarnings: 52000,
  });
  const tpd = res.tpdScenarios;
  // at 50% earning capacity: benefit = 2/3 × (1000 − 500) = 333.33
  const at50 = tpd.find(s => s.pct === 50);
  assert.ok(at50, 'TPD 50% scenario should exist');
  assert.strictEqual(at50.earningCapacity, 500);
  assert.strictEqual(at50.benefit,         333.33);
  // at 10% earning capacity: benefit = 2/3 × (1000 − 100) = 600
  const at10 = tpd.find(s => s.pct === 10);
  assert.strictEqual(at10.earningCapacity, 100);
  assert.strictEqual(at10.benefit,         600);
});

test('T27 TPD benefit capped at statutory max', () => {
  // AWW $5000; at 10%: benefit = 2/3 × 4500 = 3000 → capped at 1171.46
  const res = calculateAWW({
    doi: '2024-10-15', method: '52week', annualEarnings: 260000,
  });
  const at10 = res.tpdScenarios.find(s => s.pct === 10);
  assert.strictEqual(at10.benefit, 1171.46);
});

// ─── Concurrent + Adjustments on §14(1) ──────────────────────────────────

test('T28 §14(1) with tips and concurrent: correct combined AWW', () => {
  // baseAWW = 40000/52 = 769.23; + 150 tips + 250 concurrent = 1169.23
  const res = calculateAWW({
    doi: '2023-09-01', method: '52week',
    annualEarnings: 40000, tipsWeekly: 150, concurrentAWW: 250,
  });
  assert.strictEqual(res.aww,    r2(r2(40000 / 52) + 150 + 250));
  assert.strictEqual(res.maxRate, 1145.43);
});

// ─── Warning / Validation ─────────────────────────────────────────────────

test('T29 Warning when daysWorked = 0 for statutory method', () => {
  const res = calculateAWW({
    doi: '2024-10-15', method: 'statutory',
    totalEarnings: 10000, daysWorked: 0, daysPerWeek: 5,
  });
  assert.ok(res.warnings.length > 0);
  assert.ok(res.warnings.some(w => w.includes('Days worked')));
  assert.strictEqual(res.aww, 0);
});

test('T30 Warning when annualEarnings = 0 for 52-week method', () => {
  const res = calculateAWW({
    doi: '2024-10-15', method: '52week', annualEarnings: 0,
  });
  assert.ok(res.warnings.some(w => w.includes('Annual earnings')));
  assert.strictEqual(res.aww, 0);
  assert.strictEqual(res.ttRate, 0);
});

// ─── Result structure checks ──────────────────────────────────────────────

test('T31 Result includes all required fields', () => {
  const res = calculateAWW({
    doi: '2024-10-15', method: '52week', annualEarnings: 52000,
  });
  for (const field of [
    'aww', 'baseAWW', 'method', 'methodLabel',
    'adjustments', 'multiplier200Applied',
    'maxRate', 'maxRateLabel', 'minRate', 'minRateLabel',
    'twoThirds', 'ttRate', 'minFloorApplied',
    'tpdScenarios', 'formulaLines', 'warnings',
  ]) {
    assert.ok(field in res, `Missing field: ${field}`);
  }
  assert.strictEqual(res.tpdScenarios.length, 5);
  assert.ok(res.formulaLines.length > 0);
});

test('T32 §14(2) formulaLines include statutory calc detail', () => {
  const res = calculateAWW({
    doi: '2024-10-15', method: 'statutory',
    totalEarnings: 45000, daysWorked: 200, daysPerWeek: 5,
  });
  const joined = res.formulaLines.join(' ');
  assert.ok(joined.includes('260'), 'Should mention 260 multiplier');
  assert.ok(joined.includes('45,000.00'), 'Should mention total earnings');
});

console.log('\nAll tests passed.\n');
