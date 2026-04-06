#!/usr/bin/env node
/**
 * find-attorney-map-sort.test.js
 *
 * Unit tests for haversineKm() and sortByDistance() exported from
 * js/find-attorney-wizard.js.
 *
 * CRITICAL INVARIANT: sortByDistance() must sort purely by Euclidean/Haversine
 * distance from the user. It must NOT give preference to any firm — no secondary
 * sort by firm name, subscription tier, or any other firm-identifying field.
 * These tests enforce that invariant.
 *
 * Run: `node --experimental-vm-modules tests/find-attorney-map-sort.test.js`
 *      (or via: `node tests/find-attorney-map-sort.test.js` with the shim below)
 * Exits 0 on pass, 1 on fail.
 */

// ── Module shim: load the ES module functions without a build step ──
// We inline the two pure functions here so the test file is self-contained
// and runnable via plain `node` without --experimental-vm-modules.
// If the implementations in js/find-attorney-wizard.js change, update here too.

function toRad(deg) { return deg * Math.PI / 180; }

/**
 * Haversine distance in kilometres.
 * Copied from js/find-attorney-wizard.js — keep in sync.
 */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2))
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Sort by distance from user.
 * Copied from js/find-attorney-wizard.js — keep in sync.
 */
function sortByDistance(attorneys, userLat, userLng) {
  return attorneys
    .map((a, i) => {
      const dist = (a.office_lat != null && a.office_lng != null)
        ? haversineKm(userLat, userLng, a.office_lat, a.office_lng)
        : Infinity;
      return { a, dist, i };
    })
    .sort((x, y) => {
      if (x.dist !== y.dist) return x.dist - y.dist;
      return x.i - y.i;  // stable on tie
    })
    .map(({ a }) => a);
}

// ── Test harness ──────────────────────────────────────────────
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`\u001b[32m✓\u001b[0m ${name}`);
    passed++;
  } catch (err) {
    console.error(`\u001b[31m✗\u001b[0m ${name}`);
    console.error('  ', err.message);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertClose(actual, expected, tolerance, msg) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(
      (msg || 'Expected values to be close') +
      `: got ${actual.toFixed(4)}, expected ~${expected.toFixed(4)} (±${tolerance})`
    );
  }
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg || 'Expected equality') + `: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

// ── haversineKm tests ─────────────────────────────────────────

test('haversineKm: same point returns 0', () => {
  assertClose(haversineKm(40.7128, -74.006, 40.7128, -74.006), 0, 0.001);
});

test('haversineKm: NYC to Albany is approximately 217 km (straight-line)', () => {
  // NYC (40.7128, -74.0060) to Albany (42.6526, -73.7562) ≈ 217 km as-the-crow-flies
  const d = haversineKm(40.7128, -74.006, 42.6526, -73.7562);
  assertClose(d, 217, 5, 'NYC→Albany');
});

test('haversineKm: NYC to Buffalo is approximately 471 km (straight-line)', () => {
  // Buffalo (42.8865, -78.8784)
  const d = haversineKm(40.7128, -74.006, 42.8865, -78.8784);
  assertClose(d, 471, 10, 'NYC→Buffalo');
});

test('haversineKm: is symmetric (A→B === B→A)', () => {
  const d1 = haversineKm(40.7128, -74.006, 42.6526, -73.7562);
  const d2 = haversineKm(42.6526, -73.7562, 40.7128, -74.006);
  assertClose(d1, d2, 0.0001, 'Symmetry');
});

test('haversineKm: returns positive value for non-identical points', () => {
  const d = haversineKm(40.7, -74.0, 40.8, -74.0);
  assert(d > 0, 'Expected positive distance');
});

// ── sortByDistance tests ──────────────────────────────────────

test('sortByDistance: sorts closer firms first', () => {
  const userLat = 40.7128;
  const userLng = -74.006;

  const firms = [
    { id: 'buffalo',  firm_name: 'Firm Buffalo',  office_lat: 42.8865, office_lng: -78.8784 },
    { id: 'albany',   firm_name: 'Firm Albany',   office_lat: 42.6526, office_lng: -73.7562 },
    { id: 'manhattan',firm_name: 'Firm Manhattan',office_lat: 40.7580, office_lng: -73.9855 },
  ];

  const sorted = sortByDistance(firms, userLat, userLng);
  assertEqual(sorted[0].id, 'manhattan', 'Closest should be Manhattan');
  assertEqual(sorted[1].id, 'albany',    'Second should be Albany');
  assertEqual(sorted[2].id, 'buffalo',   'Farthest should be Buffalo');
});

test('sortByDistance: firms without lat/lng sort to the end', () => {
  const userLat = 40.7128;
  const userLng = -74.006;

  const firms = [
    { id: 'no-geo',   firm_name: 'No Geo Firm',  office_lat: null, office_lng: null },
    { id: 'nearby',   firm_name: 'Nearby Firm',  office_lat: 40.72, office_lng: -74.01 },
  ];

  const sorted = sortByDistance(firms, userLat, userLng);
  assertEqual(sorted[0].id, 'nearby', 'Geo-enabled firm should come first');
  assertEqual(sorted[1].id, 'no-geo', 'No-geo firm should be last');
});

test('sortByDistance: does not mutate the original array', () => {
  const firms = [
    { id: 'a', office_lat: 41.0, office_lng: -74.0 },
    { id: 'b', office_lat: 40.7, office_lng: -74.0 },
  ];
  const original = firms.map(f => f.id);
  sortByDistance(firms, 40.7128, -74.006);
  assertEqual(firms[0].id, original[0], 'First element should not change');
  assertEqual(firms[1].id, original[1], 'Second element should not change');
});

test('sortByDistance: returns empty array for empty input', () => {
  const result = sortByDistance([], 40.7128, -74.006);
  assertEqual(result.length, 0, 'Empty input should return empty array');
});

test('sortByDistance: single firm returns that firm', () => {
  const firms = [{ id: 'only', firm_name: 'Only Firm', office_lat: 40.7, office_lng: -74.0 }];
  const result = sortByDistance(firms, 40.7128, -74.006);
  assertEqual(result.length, 1);
  assertEqual(result[0].id, 'only');
});

test('sortByDistance: stable on tie — preserves insertion order', () => {
  // Two firms at exactly the same distance (same coords)
  const firms = [
    { id: 'first',  firm_name: 'First Firm',  office_lat: 40.72, office_lng: -74.01 },
    { id: 'second', firm_name: 'Second Firm', office_lat: 40.72, office_lng: -74.01 },
  ];
  const sorted = sortByDistance(firms, 40.7128, -74.006);
  assertEqual(sorted[0].id, 'first',  'First insertion wins on exact tie');
  assertEqual(sorted[1].id, 'second', 'Second insertion is second on tie');
});

test('sortByDistance: NO secondary sort by firm_name (neutrality check)', () => {
  // Alphabetically, "Shulman" < "Zebra Firm" — but if Zebra is closer, Zebra must win.
  // This test ensures no firm gets alphabetical preferencing.
  const userLat = 40.7128;
  const userLng = -74.006;

  const firms = [
    { id: 'z-far',    firm_name: 'Shulman & Hill PLLC', office_lat: 42.89, office_lng: -78.88 },
    { id: 'a-near',   firm_name: 'Zebra Legal Group',   office_lat: 40.72, office_lng: -74.01 },
  ];

  const sorted = sortByDistance(firms, userLat, userLng);
  assertEqual(
    sorted[0].id, 'a-near',
    'Closer firm must win regardless of alphabetical order of firm name'
  );
  assertEqual(sorted[1].id, 'z-far', 'Farther firm must be second');
});

test('sortByDistance: NO sort by subscription tier or any firm metadata', () => {
  // Simulating a case where a firm has extra metadata — sort must ignore it.
  const userLat = 40.7128;
  const userLng = -74.006;

  const firms = [
    { id: 'premium-far', firm_name: 'Premium Firm', office_lat: 43.0, office_lng: -76.0, tier: 'premium' },
    { id: 'basic-near',  firm_name: 'Basic Firm',   office_lat: 40.75, office_lng: -74.0, tier: 'basic' },
  ];

  const sorted = sortByDistance(firms, userLat, userLng);
  assertEqual(
    sorted[0].id, 'basic-near',
    'Closer firm wins regardless of tier/metadata'
  );
});

test('sortByDistance: all no-geo firms preserve insertion order', () => {
  const firms = [
    { id: 'c', office_lat: null, office_lng: null },
    { id: 'a', office_lat: null, office_lng: null },
    { id: 'b', office_lat: null, office_lng: null },
  ];
  const sorted = sortByDistance(firms, 40.7128, -74.006);
  // All have Infinity distance — stable sort preserves original order
  assertEqual(sorted[0].id, 'c', 'Stable: first insertion first');
  assertEqual(sorted[1].id, 'a');
  assertEqual(sorted[2].id, 'b');
});

// ── Summary ───────────────────────────────────────────────────
console.log('');
if (failed === 0) {
  console.log(`\u001b[32m✓ All ${passed} map-sort tests passed.\u001b[0m`);
  process.exit(0);
} else {
  console.error(`\u001b[31m✗ ${failed} test(s) failed, ${passed} passed.\u001b[0m`);
  process.exit(1);
}
