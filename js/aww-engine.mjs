/**
 * aww-engine.mjs — NYS WCB Average Weekly Wage Calculation Engine
 *
 * Implements WCL §14(1), §14(2), §14(3), straight divisor, and hourly methods.
 * Handles concurrent employment, gratuities, board/lodging, and the 200-multiple rule.
 * No DOM dependencies — runs in both browser (ES module) and Node.js.
 */

// ─── Statutory maximum weekly rates (WCL §15) ─────────────────────────────
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

// ─── Statutory minimum weekly rates (WCL §204) ────────────────────────────
export const MIN_RATES = [
  { s: "2026-07-01", e: "2099-12-31", l: "Jul 1, 2026+",                min: null, n: "1/5 NYSAWW (indexed)" },
  { s: "2025-01-01", e: "2026-06-30", l: "Jan 1, 2025 – Jun 30, 2026",  min: 325,  n: "" },
  { s: "2024-01-01", e: "2024-12-31", l: "Jan 1, 2024 – Dec 31, 2024",  min: 275,  n: "" },
  { s: "2013-05-01", e: "2023-12-31", l: "May 1, 2013 – Dec 31, 2023",  min: 150,  n: "" },
  { s: "2007-07-01", e: "2013-04-30", l: "Jul 1, 2007 – Apr 30, 2013",  min: 100,  n: "2007 Reform" },
  { s: "1900-01-01", e: "2007-06-30", l: "Before Jul 1, 2007",           min: 40,   n: "Pre-reform" },
];

// ─── §14(2) day-schedule → statutory multiplier ───────────────────────────
export const MULTIPLIERS = { 4: 200, 5: 260, 6: 300, 7: 365 };

// ─── Rate lookup helpers ──────────────────────────────────────────────────

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

// ─── Main calculation function ────────────────────────────────────────────

/**
 * Calculate AWW and derived comp rates for a NYS workers' comp claim.
 *
 * @param {Object} inputs
 * @param {string}  inputs.doi                 - "YYYY-MM-DD" date of injury
 * @param {string}  inputs.method              - "52week" | "statutory" | "straight" | "hourly" | "similarEmployee"
 *
 * §14(1) — 52-week divisor:
 * @param {number}  [inputs.annualEarnings]    - Gross earnings in 52 weeks before injury
 *
 * §14(2) — Statutory multiplier:
 * @param {number}  [inputs.totalEarnings]     - Gross earnings in the period
 * @param {number}  [inputs.daysWorked]        - Days actually worked in the period
 * @param {number}  [inputs.daysPerWeek]       - Regular work schedule: 4 | 5 | 6 | 7
 *
 * Straight divisor:
 * @param {number}  [inputs.straightEarnings]  - Total earnings in period
 * @param {number}  [inputs.weeksWorked]       - Weeks actually worked
 *
 * Hourly quick-calc:
 * @param {number}  [inputs.hourlyRate]        - Regular hourly rate
 * @param {number}  [inputs.hoursPerWeek]      - Regular hours per week
 *
 * §14(3) — Similar employee:
 * @param {number}  [inputs.similarAnnualEarnings] - Full-year earnings of comparable worker
 *
 * Adjustments (added to base AWW after method calculation):
 * @param {number}  [inputs.tipsWeekly]        - Average weekly tips / gratuities (WCL §14)
 * @param {number}  [inputs.boardLodgingWeekly]- Fair-market weekly value of board / lodging
 * @param {number}  [inputs.concurrentAWW]     - AWW from concurrent employment
 *
 * 200-multiple rule (§14(2) only):
 * @param {boolean} [inputs.apply200Rule]      - Whether to apply the 200-multiple comparison
 * @param {number}  [inputs.similarDailyWage]  - Average daily wage of similar employee in district
 *
 * @returns {Object} result — see inline documentation
 */
export function calculateAWW(inputs) {
  const {
    doi            = '',
    method         = '52week',
    annualEarnings = 0,
    totalEarnings  = 0,
    daysWorked     = 0,
    daysPerWeek    = 5,
    straightEarnings = 0,
    weeksWorked    = 0,
    hourlyRate     = 0,
    hoursPerWeek   = 40,
    similarAnnualEarnings = 0,
    tipsWeekly         = 0,
    boardLodgingWeekly = 0,
    concurrentAWW      = 0,
    apply200Rule       = false,
    similarDailyWage   = 0,
  } = inputs;

  const warnings      = [];
  const formulaLines  = [];
  const adjustments   = [];
  let baseAWW              = 0;
  let methodLabel          = '';
  let multiplier200Applied = false;
  let multiplier200AWW     = 0;

  // ── Step 1: compute base AWW from selected method ─────────────────────

  if (method === '52week') {
    methodLabel = '§14(1) — 52-Week Divisor';
    if (annualEarnings <= 0) warnings.push('Annual earnings must be greater than 0.');
    baseAWW = annualEarnings / 52;
    formulaLines.push(`Annual earnings: $${fmt(annualEarnings)}`);
    formulaLines.push(`÷ 52 weeks = AWW: $${fmt(baseAWW)}`);

  } else if (method === 'statutory') {
    const mult = MULTIPLIERS[daysPerWeek] ?? 260;
    methodLabel = `§14(2) — Statutory Multiplier (×${mult}, ${daysPerWeek}-day schedule)`;
    if (totalEarnings <= 0) warnings.push('Total earnings must be greater than 0.');
    if (daysWorked <= 0)    warnings.push('Days worked must be greater than 0.');
    const dailyWage = daysWorked > 0 ? totalEarnings / daysWorked : 0;
    baseAWW = dailyWage * mult / 52;
    formulaLines.push(`Total earnings: $${fmt(totalEarnings)}`);
    formulaLines.push(`÷ ${daysWorked} days worked = daily wage: $${fmt(dailyWage)}`);
    formulaLines.push(`× ${mult} multiplier ÷ 52 = base AWW: $${fmt(baseAWW)}`);

    // 200-multiple rule: if the claimant's AWW < similar employee's 200-day equivalent
    if (apply200Rule && similarDailyWage > 0) {
      multiplier200AWW = similarDailyWage * 200 / 52;
      if (baseAWW < multiplier200AWW) {
        multiplier200Applied = true;
        baseAWW = multiplier200AWW;
        formulaLines.push(
          `⚑ 200-multiple rule applied: similar employee daily wage $${fmt(similarDailyWage)} × 200 ÷ 52` +
          ` = $${fmt(multiplier200AWW)} > claimant AWW — using similar employee rate`
        );
      } else {
        formulaLines.push(
          `200-multiple check: similar employee AWW $${fmt(multiplier200AWW)} ≤ claimant AWW — no adjustment`
        );
      }
    }

  } else if (method === 'straight') {
    methodLabel = 'Straight Divisor (Board Discretion)';
    if (straightEarnings <= 0) warnings.push('Earnings must be greater than 0.');
    if (weeksWorked <= 0)      warnings.push('Weeks worked must be greater than 0.');
    baseAWW = weeksWorked > 0 ? straightEarnings / weeksWorked : 0;
    formulaLines.push(`Total earnings: $${fmt(straightEarnings)}`);
    formulaLines.push(`÷ ${weeksWorked} weeks worked = AWW: $${fmt(baseAWW)}`);

  } else if (method === 'hourly') {
    methodLabel = 'Hourly Rate (Quick Calc)';
    if (hourlyRate <= 0)   warnings.push('Hourly rate must be greater than 0.');
    if (hoursPerWeek <= 0) warnings.push('Hours per week must be greater than 0.');
    baseAWW = hourlyRate * hoursPerWeek;
    formulaLines.push(`$${fmt(hourlyRate)}/hr × ${hoursPerWeek} hrs/wk = AWW: $${fmt(baseAWW)}`);

  } else if (method === 'similarEmployee') {
    methodLabel = '§14(3) — Similar Employee';
    if (similarAnnualEarnings <= 0) warnings.push('Similar employee annual earnings must be greater than 0.');
    baseAWW = similarAnnualEarnings / 52;
    formulaLines.push(`Similar employee annual earnings: $${fmt(similarAnnualEarnings)}`);
    formulaLines.push(`÷ 52 weeks = AWW: $${fmt(baseAWW)}`);

  } else {
    warnings.push(`Unknown calculation method: "${method}".`);
  }

  // ── Step 2: add adjustments ───────────────────────────────────────────

  let adjustedAWW = baseAWW;

  if (tipsWeekly > 0) {
    adjustedAWW += tipsWeekly;
    adjustments.push({ label: 'Tips / Gratuities',    value: tipsWeekly });
    formulaLines.push(`+ tips / gratuities: $${fmt(tipsWeekly)}/wk`);
  }
  if (boardLodgingWeekly > 0) {
    adjustedAWW += boardLodgingWeekly;
    adjustments.push({ label: 'Board / Lodging',       value: boardLodgingWeekly });
    formulaLines.push(`+ board / lodging (fair-market value): $${fmt(boardLodgingWeekly)}/wk`);
  }
  if (concurrentAWW > 0) {
    adjustedAWW += concurrentAWW;
    adjustments.push({ label: 'Concurrent Employment', value: concurrentAWW });
    formulaLines.push(`+ concurrent employment AWW: $${fmt(concurrentAWW)}/wk`);
  }
  if (adjustments.length > 0) {
    formulaLines.push(`Total adjusted AWW: $${fmt(adjustedAWW)}`);
  }

  // ── Step 3: rate lookup and comp-rate calculation ──────────────────────

  const maxRec = getMaxForDate(doi);
  const minRec = getMinForDate(doi);
  const maxRate = maxRec ? maxRec.max : 1222.42;
  const minRate = (minRec && minRec.min != null) ? minRec.min : null;

  const awwFinal  = r2(adjustedAWW);
  const twoThirds = r2(awwFinal * 2 / 3);

  let ttRate          = Math.min(twoThirds, maxRate);
  let minFloorApplied = false;

  // WCL §204 minimum floor: if 2/3 AWW < statutory minimum, raise to min —
  // but never above the claimant's full AWW (when AWW itself is below the minimum).
  if (minRate !== null && ttRate < minRate) {
    const floored = Math.min(minRate, awwFinal);
    if (floored > ttRate) {
      ttRate          = floored;
      minFloorApplied = true;
    }
  }
  ttRate = r2(ttRate);

  // ── Step 4: TPD (§15(6)) scenarios ───────────────────────────────────
  // Benefit = 2/3 × (AWW − reduced earning capacity), capped at TT max rate.
  const tpdScenarios = [10, 25, 50, 75, 90].map(pct => {
    const earningCapacity = r2(awwFinal * pct / 100);
    const benefit         = r2(Math.min(r2((awwFinal - earningCapacity) * 2 / 3), maxRate));
    return { pct, earningCapacity, benefit };
  });

  // ── Result object ─────────────────────────────────────────────────────
  return {
    // Core AWW
    aww:        awwFinal,
    baseAWW:    r2(baseAWW),
    method,
    methodLabel,

    // Adjustments
    adjustments,
    tipsWeekly:         tipsWeekly         > 0 ? tipsWeekly         : 0,
    boardLodgingWeekly: boardLodgingWeekly > 0 ? boardLodgingWeekly : 0,
    concurrentAWW:      concurrentAWW      > 0 ? concurrentAWW      : 0,

    // 200-multiple rule
    multiplier200Applied,
    multiplier200AWW: r2(multiplier200AWW),

    // Rate caps
    maxRate,
    maxRateLabel: maxRec ? maxRec.l : '',
    minRate,
    minRateLabel: minRec ? minRec.l : '',

    // Comp rates
    twoThirds,
    ttRate,
    minFloorApplied,

    // TPD table
    tpdScenarios,

    // Human-readable formula
    formulaLines,

    // Validation
    warnings,
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────

/** Round to 2 decimal places (cent-accurate). */
function r2(n) {
  return Math.round(n * 100) / 100;
}

/** Format number as US dollar string (no $ prefix). */
function fmt(n) {
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
