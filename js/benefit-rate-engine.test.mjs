/**
 * benefit-rate-engine.test.mjs — Unit tests for the NY benefit rate lookup engine
 *
 * Run with: node js/benefit-rate-engine.test.mjs
 * Requires Node.js 18+ (built-in test runner).
 *
 * Covers every DOI calendar year 2018–2026, using two dates per year to exercise
 * both the pre-July and post-July rate periods.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getRatesForDOI } from './benefit-rate-engine.mjs';
import { getMaxForDate, getMinForDate } from './ny-rate-table.mjs';

// ─── Helper ───────────────────────────────────────────────────────────────────

function rates(doi) {
  const r = getRatesForDOI(doi);
  // Return only the numeric fields for concise assertions
  return { max: r.maxRate, min: r.minRate, isIndexed: r.isIndexedMin };
}

// ─── Validation ───────────────────────────────────────────────────────────────

test('missing DOI returns warning', () => {
  const r = getRatesForDOI('');
  assert.ok(r.warnings.length > 0);
  assert.strictEqual(r.maxRate, null);
});

test('invalid DOI returns warning', () => {
  const r = getRatesForDOI('not-a-date');
  assert.ok(r.warnings.some(w => /invalid/i.test(w)));
  assert.strictEqual(r.maxRate, null);
});

test('future DOI returns warning and nulls', () => {
  const r = getRatesForDOI('2099-01-01');
  assert.ok(r.warnings.some(w => /future/i.test(w)));
  assert.strictEqual(r.maxRate, null);
});

test('DOI > 10 years ago returns stale warning but still returns rates', () => {
  const r = getRatesForDOI('2010-01-01');
  assert.ok(r.warnings.some(w => /10 years/i.test(w)));
  assert.ok(r.maxRate !== null);
});

// ─── 2018: Jul 2017–Jun 2018 period AND Jul 2018–Jun 2019 period ──────────────

test('2018-01-15 → max $870.61 (Jul 2017–Jun 2018), min $150', () => {
  assert.deepStrictEqual(rates('2018-01-15'), { max: 870.61, min: 150, isIndexed: false });
});

test('2018-08-15 → max $904.74 (Jul 2018–Jun 2019), min $150', () => {
  assert.deepStrictEqual(rates('2018-08-15'), { max: 904.74, min: 150, isIndexed: false });
});

// ─── 2019 ─────────────────────────────────────────────────────────────────────

test('2019-03-01 → max $904.74 (Jul 2018–Jun 2019), min $150', () => {
  assert.deepStrictEqual(rates('2019-03-01'), { max: 904.74, min: 150, isIndexed: false });
});

test('2019-09-01 → max $934.11 (Jul 2019–Jun 2020), min $150', () => {
  assert.deepStrictEqual(rates('2019-09-01'), { max: 934.11, min: 150, isIndexed: false });
});

// ─── 2020 ─────────────────────────────────────────────────────────────────────

test('2020-02-01 → max $934.11 (Jul 2019–Jun 2020), min $150', () => {
  assert.deepStrictEqual(rates('2020-02-01'), { max: 934.11, min: 150, isIndexed: false });
});

test('2020-08-01 → max $966.78 (Jul 2020–Jun 2021), min $150', () => {
  assert.deepStrictEqual(rates('2020-08-01'), { max: 966.78, min: 150, isIndexed: false });
});

// ─── 2021 ─────────────────────────────────────────────────────────────────────

test('2021-04-01 → max $966.78 (Jul 2020–Jun 2021), min $150', () => {
  assert.deepStrictEqual(rates('2021-04-01'), { max: 966.78, min: 150, isIndexed: false });
});

test('2021-09-01 → max $1063.05 (Jul 2021–Jun 2022), min $150', () => {
  assert.deepStrictEqual(rates('2021-09-01'), { max: 1063.05, min: 150, isIndexed: false });
});

// ─── 2022 ─────────────────────────────────────────────────────────────────────

test('2022-01-15 → max $1063.05 (Jul 2021–Jun 2022), min $150', () => {
  assert.deepStrictEqual(rates('2022-01-15'), { max: 1063.05, min: 150, isIndexed: false });
});

test('2022-08-15 → max $1125.46 (Jul 2022–Jun 2023), min $150', () => {
  assert.deepStrictEqual(rates('2022-08-15'), { max: 1125.46, min: 150, isIndexed: false });
});

// ─── 2023 ─────────────────────────────────────────────────────────────────────

test('2023-06-15 → max $1125.46 (Jul 2022–Jun 2023), min $150', () => {
  assert.deepStrictEqual(rates('2023-06-15'), { max: 1125.46, min: 150, isIndexed: false });
});

test('2023-08-01 → max $1145.43 (Jul 2023–Jun 2024), min $150', () => {
  assert.deepStrictEqual(rates('2023-08-01'), { max: 1145.43, min: 150, isIndexed: false });
});

// ─── 2024: min changes Jan 1, 2024 → $275; max changes Jul 1, 2024 ───────────

test('2024-01-15 → max $1145.43 (Jul 2023–Jun 2024), min $275 (2024 statutory increase)', () => {
  assert.deepStrictEqual(rates('2024-01-15'), { max: 1145.43, min: 275, isIndexed: false });
});

test('2024-08-15 → max $1171.46 (Jul 2024–Jun 2025), min $275', () => {
  assert.deepStrictEqual(rates('2024-08-15'), { max: 1171.46, min: 275, isIndexed: false });
});

// ─── 2025: min changes Jan 1, 2025 → $325; max changes Jul 1, 2025 ───────────

test('2025-03-01 → max $1171.46 (Jul 2024–Jun 2025), min $325 (2025 statutory increase)', () => {
  assert.deepStrictEqual(rates('2025-03-01'), { max: 1171.46, min: 325, isIndexed: false });
});

test('2025-08-01 → max $1222.42 (Jul 2025–Present), min $325', () => {
  assert.deepStrictEqual(rates('2025-08-01'), { max: 1222.42, min: 325, isIndexed: false });
});

// ─── 2026: min becomes indexed (null) after Jul 1, 2026 ───────────────────────

test('2026-01-15 → max $1222.42, min $325 (still in Jan 2025–Jun 2026 period)', () => {
  assert.deepStrictEqual(rates('2026-01-15'), { max: 1222.42, min: 325, isIndexed: false });
});

// Rate-table boundary test for 2026-06-30 — tests the lookup functions directly
// so the future-date guard in getRatesForDOI doesn't interfere before that date arrives.
test('rate table: 2026-06-30 → max $1222.42, min $325 (last day of fixed-min period)', () => {
  assert.strictEqual(getMaxForDate('2026-06-30').max, 1222.42);
  assert.strictEqual(getMinForDate('2026-06-30').min, 325);
});

// Note: 2026-07-01+ min becomes indexed (null); we test the boundary but skip
// future-date validation by using dates that are past today's check. Since
// 2026-07-01 is in the future at time of writing, getRatesForDOI will reject it
// with a "future" warning. The test below verifies that boundary behaviour.
test('2026-07-01 is treated as future date if today < 2026-07-01', () => {
  const today = new Date();
  const boundary = new Date('2026-07-01T12:00:00');
  if (today < boundary) {
    const r = getRatesForDOI('2026-07-01');
    assert.ok(r.warnings.some(w => /future/i.test(w)));
    assert.strictEqual(r.maxRate, null);
  } else {
    // Once past that date, it should return the indexed-min record
    const r = getRatesForDOI('2026-07-01');
    assert.strictEqual(r.maxRate, 1222.42);
    assert.strictEqual(r.minRate, null);
    assert.strictEqual(r.isIndexedMin, true);
  }
});

// ─── Labels and notes ─────────────────────────────────────────────────────────

test('maxRateLabel is non-empty for a valid DOI', () => {
  const r = getRatesForDOI('2024-06-01');
  assert.ok(r.maxRateLabel.length > 0);
});

test('minRateLabel is non-empty for a valid DOI', () => {
  const r = getRatesForDOI('2024-06-01');
  assert.ok(r.minRateLabel.length > 0);
});

test('no warnings for a normal recent DOI', () => {
  const r = getRatesForDOI('2024-06-01');
  assert.strictEqual(r.warnings.length, 0);
});
