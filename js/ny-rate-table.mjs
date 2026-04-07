/**
 * ny-rate-table.mjs — NYS Workers' Compensation statutory rate tables
 *
 * Shared module for benefit-rate and AWW calculators.
 * Source: NYS Workers' Compensation Board; WCL §15(6)(a) (max) and WCL §204 (min).
 * No DOM dependencies — runs in browser (ES module) and Node.js.
 */

// ─── Statutory maximum weekly rates (WCL §15(6)(a)) ──────────────────────────
export const MAX_RATES = [
  { s: "2025-07-01", e: "2099-12-31", l: "Jul 1, 2025 – Present",          max: 1222.42 },
  { s: "2024-07-01", e: "2025-06-30", l: "Jul 1, 2024 – Jun 30, 2025",     max: 1171.46 },
  { s: "2023-07-01", e: "2024-06-30", l: "Jul 1, 2023 – Jun 30, 2024",     max: 1145.43 },
  { s: "2022-07-01", e: "2023-06-30", l: "Jul 1, 2022 – Jun 30, 2023",     max: 1125.46 },
  { s: "2021-07-01", e: "2022-06-30", l: "Jul 1, 2021 – Jun 30, 2022",     max: 1063.05 },
  { s: "2020-07-01", e: "2021-06-30", l: "Jul 1, 2020 – Jun 30, 2021",     max:  966.78 },
  { s: "2019-07-01", e: "2020-06-30", l: "Jul 1, 2019 – Jun 30, 2020",     max:  934.11 },
  { s: "2018-07-01", e: "2019-06-30", l: "Jul 1, 2018 – Jun 30, 2019",     max:  904.74 },
  { s: "2017-07-01", e: "2018-06-30", l: "Jul 1, 2017 – Jun 30, 2018",     max:  870.61 },
  { s: "2016-07-01", e: "2017-06-30", l: "Jul 1, 2016 – Jun 30, 2017",     max:  864.32 },
  { s: "2015-07-01", e: "2016-06-30", l: "Jul 1, 2015 – Jun 30, 2016",     max:  844.29 },
  { s: "2014-07-01", e: "2015-06-30", l: "Jul 1, 2014 – Jun 30, 2015",     max:  808.65 },
  { s: "2013-07-01", e: "2014-06-30", l: "Jul 1, 2013 – Jun 30, 2014",     max:  803.21 },
  { s: "2012-07-01", e: "2013-06-30", l: "Jul 1, 2012 – Jun 30, 2013",     max:  792.07 },
  { s: "2011-07-01", e: "2012-06-30", l: "Jul 1, 2011 – Jun 30, 2012",     max:  772.96 },
  { s: "2010-07-01", e: "2011-06-30", l: "Jul 1, 2010 – Jun 30, 2011",     max:  739.83 },
  { s: "2009-07-01", e: "2010-06-30", l: "Jul 1, 2009 – Jun 30, 2010",     max:  600.00 },
  { s: "2008-07-01", e: "2009-06-30", l: "Jul 1, 2008 – Jun 30, 2009",     max:  550.00 },
  { s: "2007-07-01", e: "2008-06-30", l: "Jul 1, 2007 – Jun 30, 2008",     max:  500.00 },
  { s: "1985-07-01", e: "2007-06-30", l: "Jul 1, 1985 – Jun 30, 2007",     max:  400.00 },
];

// ─── Statutory minimum weekly rates (WCL §204) ────────────────────────────────
export const MIN_RATES = [
  { s: "2026-07-01", e: "2099-12-31", l: "Jul 1, 2026+",                min: null, n: "1/5 NYSAWW (indexed)" },
  { s: "2025-01-01", e: "2026-06-30", l: "Jan 1, 2025 – Jun 30, 2026",  min: 325,  n: "" },
  { s: "2024-01-01", e: "2024-12-31", l: "Jan 1, 2024 – Dec 31, 2024",  min: 275,  n: "" },
  { s: "2013-05-01", e: "2023-12-31", l: "May 1, 2013 – Dec 31, 2023",  min: 150,  n: "" },
  { s: "2007-07-01", e: "2013-04-30", l: "Jul 1, 2007 – Apr 30, 2013",  min: 100,  n: "2007 Reform" },
  { s: "1900-01-01", e: "2007-06-30", l: "Before Jul 1, 2007",           min: 40,   n: "Pre-reform" },
];

// ─── Rate lookup helpers ───────────────────────────────────────────────────────

/**
 * Return the MAX_RATES record applicable to a date-of-injury string "YYYY-MM-DD".
 * Falls back to the oldest record if no match.
 */
export function getMaxForDate(doi) {
  if (!doi) return MAX_RATES[0];
  const dt = new Date(doi + 'T12:00:00');
  for (const r of MAX_RATES) {
    if (dt >= new Date(r.s + 'T00:00:00') && dt <= new Date(r.e + 'T23:59:59')) return r;
  }
  return MAX_RATES[MAX_RATES.length - 1];
}

/**
 * Return the MIN_RATES record applicable to a date-of-injury string "YYYY-MM-DD".
 * Returns null if no match (pre-1900 or future un-indexed period).
 */
export function getMinForDate(doi) {
  if (!doi) return MIN_RATES[1];
  const dt = new Date(doi + 'T12:00:00');
  for (const r of MIN_RATES) {
    if (dt >= new Date(r.s + 'T00:00:00') && dt <= new Date(r.e + 'T23:59:59')) return r;
  }
  return null;
}
