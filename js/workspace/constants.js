// Constants. The statutory data tables + rate-bound helpers below are now the
// FALLBACK only — at runtime they are superseded by js/calc-core.js (the single
// source of truth shared with the mobile app), which workspace.html loads
// immediately before this file. See the Object.assign at the bottom: window gets
// calc-core's MAX_RATES / MIN_RATES / SLU_BP / LWEC_BR / NERVE_CAPS / ranks +
// lookup & rate-bound helpers. DO NOT edit the rate tables here — edit
// js/calc-core.js so the website and app stay in lockstep.
const _CALC = (typeof window !== 'undefined' && window.CD && window.CD.Calc) || null;
if (!_CALC) console.error('[workspace] CALC_CORE_MISSING — js/calc-core.js must load before constants.js');

const MAX_RATES = [
  { s:"2026-07-01", e:"2099-12-31", l:"Jul 1, 2026+",                 max:1281.50 },
  { s:"2025-07-01", e:"2026-06-30", l:"Jul 1, 2025 – Jun 30, 2026",   max:1222.42 },
  { s:"2024-07-01", e:"2025-06-30", l:"Jul 1, 2024 – Jun 30, 2025",   max:1171.46 },
  { s:"2023-07-01", e:"2024-06-30", l:"Jul 1, 2023 – Jun 30, 2024",   max:1145.43 },
  { s:"2022-07-01", e:"2023-06-30", l:"Jul 1, 2022 – Jun 30, 2023",   max:1125.46 },
  { s:"2021-07-01", e:"2022-06-30", l:"Jul 1, 2021 – Jun 30, 2022",   max:1063.05 },
  { s:"2020-07-01", e:"2021-06-30", l:"Jul 1, 2020 – Jun 30, 2021",   max: 966.78 },
  { s:"2019-07-01", e:"2020-06-30", l:"Jul 1, 2019 – Jun 30, 2020",   max: 934.11 },
  { s:"2018-07-01", e:"2019-06-30", l:"Jul 1, 2018 – Jun 30, 2019",   max: 904.74 },
  { s:"2017-07-01", e:"2018-06-30", l:"Jul 1, 2017 – Jun 30, 2018",   max: 870.61 },
  { s:"2016-07-01", e:"2017-06-30", l:"Jul 1, 2016 – Jun 30, 2017",   max: 864.32 },
  { s:"2015-07-01", e:"2016-06-30", l:"Jul 1, 2015 – Jun 30, 2016",   max: 844.29 },
  { s:"2014-07-01", e:"2015-06-30", l:"Jul 1, 2014 – Jun 30, 2015",   max: 808.65 },
  { s:"2013-07-01", e:"2014-06-30", l:"Jul 1, 2013 – Jun 30, 2014",   max: 803.21 },
  { s:"2012-07-01", e:"2013-06-30", l:"Jul 1, 2012 – Jun 30, 2013",   max: 792.07 },
  { s:"2011-07-01", e:"2012-06-30", l:"Jul 1, 2011 – Jun 30, 2012",   max: 772.96 },
  { s:"2010-07-01", e:"2011-06-30", l:"Jul 1, 2010 – Jun 30, 2011",   max: 739.83 },
  { s:"2009-07-01", e:"2010-06-30", l:"Jul 1, 2009 – Jun 30, 2010",   max: 600.00 },
  { s:"2008-07-01", e:"2009-06-30", l:"Jul 1, 2008 – Jun 30, 2009",   max: 550.00 },
  { s:"2007-07-01", e:"2008-06-30", l:"Jul 1, 2007 – Jun 30, 2008",   max: 500.00 },
  { s:"1985-07-01", e:"2007-06-30", l:"Jul 1, 1985 – Jun 30, 2007",   max: 400.00 },
];

const MIN_RATES = [
  { s:"2027-07-01", e:"2099-12-31", l:"Jul 1, 2027+",                min:null,   n:"1/5 NYSAWW (indexed)" },
  { s:"2026-07-01", e:"2027-06-30", l:"Jul 1, 2026 – Jun 30, 2027",  min:384.45, n:"1/5 NYSAWW (2025)" },
  { s:"2025-01-01", e:"2026-06-30", l:"Jan 1, 2025 – Jun 30, 2026",  min:325,  n:"" },
  { s:"2024-01-01", e:"2024-12-31", l:"Jan 1, 2024 – Dec 31, 2024",  min:275,  n:"" },
  { s:"2013-05-01", e:"2023-12-31", l:"May 1, 2013 – Dec 31, 2023",  min:150,  n:"" },
  { s:"2007-07-01", e:"2013-04-30", l:"Jul 1, 2007 – Apr 30, 2013",  min:100,  n:"2007 Reform" },
  { s:"1900-01-01", e:"2007-06-30", l:"Before Jul 1, 2007",          min:40,   n:"Pre-reform" },
];

const SLU_BP = [
  { n:"Arm",                  w:312, hp:32 },
  { n:"Hand",                 w:244, hp:32 },
  { n:"Leg",                  w:288, hp:40 },
  { n:"Foot",                 w:205, hp:32 },
  { n:"Thumb",                w: 75, hp:24 },
  { n:"1st Finger (Index)",   w: 46, hp:18 },
  { n:"2nd Finger (Middle)",  w: 30, hp:12 },
  { n:"3rd Finger (Ring)",    w: 25, hp: 8 },
  { n:"4th Finger (Pinky)",   w: 15, hp: 8 },
  { n:"Great Toe",            w: 38, hp:12 },
  { n:"Other Toe (2nd–5th)",  w: 16, hp: 8 },
  { n:"Eye",                  w:160, hp:20 },
  { n:"One Ear",              w: 60, hp: 0 },
  { n:"Binaural (Both Ears)", w:150, hp: 0 },
];

const LWEC_BR = [
  { l:"Total (Industrial)", lo:null, hi:null, mw:"Lifetime" },
  { l:"96%+",        lo:96, hi:100, mw:525 },
  { l:"91–95%",      lo:91, hi: 95, mw:500 },
  { l:"86–90%",      lo:86, hi: 90, mw:475 },
  { l:"81–85%",      lo:81, hi: 85, mw:450 },
  { l:"76–80%",      lo:76, hi: 80, mw:425 },
  { l:"71–75%",      lo:71, hi: 75, mw:400 },
  { l:"61–70%",      lo:61, hi: 70, mw:375 },
  { l:"51–60%",      lo:51, hi: 60, mw:350 },
  { l:"41–50%",      lo:41, hi: 50, mw:300 },
  { l:"31–40%",      lo:31, hi: 40, mw:275 },
  { l:"16–30%",      lo:16, hi: 30, mw:250 },
  { l:"15% or less", lo:0,  hi: 15, mw:225 },
];

const NERVE_CAPS = {
  cervical: [
    { v:'C5', label:'C5 — shoulder/upper arm',            maxSensory:0, maxMotor:10 },
    { v:'C6', label:'C6 — thumb/wrist extensors',         maxSensory:6, maxMotor:10 },
    { v:'C7', label:'C7 — middle finger/triceps',         maxSensory:6, maxMotor:10 },
    { v:'C8', label:'C8 — ring & small finger/intrinsics',maxSensory:4, maxMotor:12 },
    { v:'T1', label:'T1 — hand intrinsics',               maxSensory:0, maxMotor:12 },
  ],
  lumbar: [
    { v:'L3', label:'L3 — anterior thigh/quadriceps',     maxSensory:0, maxMotor:12 },
    { v:'L4', label:'L4 — anterior leg/tibialis ant.',    maxSensory:4, maxMotor:24 },
    { v:'L5', label:'L5 — dorsum foot/peroneals, EHL',    maxSensory:4, maxMotor:16 },
    { v:'S1', label:'S1 — plantar foot/gastrocnemius',    maxSensory:6, maxMotor:18 },
  ],
};

const CERVICAL_RANKS = [
  { letter:'C', lo:0,  hi:0  },
  { letter:'D', lo:4,  hi:16 },
  { letter:'E', lo:17, hi:32 },
  { letter:'F', lo:33, hi:48 },
  { letter:'G', lo:49, hi:64 },
  { letter:'H', lo:65, hi:80 },
];
const LUMBAR_RANKS = [
  { letter:'D', lo:0,  hi:0  },
  { letter:'E', lo:4,  hi:16 },
  { letter:'F', lo:17, hi:32 },
  { letter:'G', lo:33, hi:48 },
  { letter:'H', lo:49, hi:64 },
  { letter:'I', lo:65, hi:80 },
  { letter:'J', lo:81, hi:92 },
];

// Lookups
function lookupMax(dateStr) {
  if (!dateStr) return null;
  const d = dateStr;
  for (const r of MAX_RATES) if (d >= r.s && d <= r.e) return r;
  return null;
}
function lookupMin(dateStr) {
  if (!dateStr) return null;
  const d = dateStr;
  for (const r of MIN_RATES) if (d >= r.s && d <= r.e) return r;
  return null;
}

function applyMinFloor(rate, aww, minR) {
  if (minR > 0 && rate < minR) return Math.min(minR, aww);
  return rate;
}

// =============================================================================
// applyRateBounds(rate, aww, minRate, maxRate)
// =============================================================================
// Universal min/max enforcement for any computed weekly compensation rate
// (TT, SLU, RE, TR, LWEC class rate, manual CCP rate, etc.).
//
// Rule (May 2026, per Joel — applies to all award tiles):
//   1. If AWW for the DOA is BELOW the statutory minimum rate for the DOA,
//      the AWW itself becomes the floor AND ceiling for everything. The TT
//      rate, SLU rate, and minimum rate all collapse to the AWW. This is
//      because a worker can never receive more than 100% of their AWW, so
//      when min > AWW, the floor must drop to AWW.
//   2. Otherwise: cap the rate at the statutory max for the DOA, then floor
//      it at the statutory min. This means a 25% CCP/TR rate that computes
//      below the min floor is bumped UP to the min, and a high rate is
//      bumped DOWN to the max.
//
// Returns the bounded rate. Pass minRate/maxRate as 0 (or null/undefined) to
// skip that bound. AWW-override only fires when both aww > 0 and minRate > 0.
function applyRateBounds(rate, aww, minRate, maxRate) {
  const awwNum = Number(aww) || 0;
  const r = Number(rate) || 0;
  const minR = Number(minRate) || 0;
  const maxR = Number(maxRate) || 0;
  // Override: AWW < min → everything collapses to AWW
  if (minR > 0 && awwNum > 0 && awwNum < minR) {
    return awwNum;
  }
  let bounded = r;
  if (maxR > 0) bounded = Math.min(bounded, maxR);
  if (minR > 0 && bounded < minR) bounded = minR;
  return bounded;
}

// Whether the AWW-overrides-all rule is firing for this (aww, doi) combination.
// Useful for UI badges / equation explanations.
function isAwwBelowMin(aww, minRate) {
  const a = Number(aww) || 0;
  const m = Number(minRate) || 0;
  return m > 0 && a > 0 && a < m;
}

function getCappedTT(aww, maxRate, minRate) {
  const tt = (Number(aww) || 0) * 2 / 3;
  return applyRateBounds(tt, aww, minRate, maxRate);
}

function lwecBracket(pct) {
  const p = Number(pct) || 0;
  if (p >= 100) return LWEC_BR[0]; // Total Industrial
  for (let i = 1; i < LWEC_BR.length; i++) {
    const b = LWEC_BR[i];
    if (p >= b.lo && p <= b.hi) return b;
  }
  return LWEC_BR[LWEC_BR.length - 1];
}

const fmt$ = (n) => {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmtN = (n, d=2) => {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
};

// ============================================================================
// DATE CALCULATOR HELPERS (shared, timezone-safe) — powers the Date Calculator
// tile (js/workspace/tiles.js DateCalcTile). Mirrors timeanddate.com's
// dateadd.html (Add/Subtract) + its duration calculator (Between Dates).
//
// TIMEZONE CONTRACT: every Date here is constructed at LOCAL midnight via
// new Date(y, mIdx, d). We never touch toISOString()/new Date("yyyy-mm-dd")
// for calendar work — those parse/emit UTC and drift the day west of GMT
// (the same trap the AWW-strip deadline tool avoids). The existing
// dayAfter()/inclusiveDays() helpers in tiles.js are UTC-based; we reuse
// inclusiveDays' inclusive-count *convention* (guarded, with a local
// fallback so this file is testable standalone) but do all date construction
// locally.
// ============================================================================

// "yyyy-mm-dd" from LOCAL parts (never toISOString — that's UTC).
function toLocalISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
// Parse "yyyy-mm-dd" back to a LOCAL-midnight Date (never new Date(str) — UTC).
function fromLocalISO(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
// Normalize any Date to local midnight (drops any time component).
function _localMidnight(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// nth (1-based) weekday of a month. weekday: 0=Sun … 6=Sat.
function _nthWeekdayOfMonth(year, monthIdx, weekday, nth) {
  const first = new Date(year, monthIdx, 1);
  const shift = (weekday - first.getDay() + 7) % 7;
  return new Date(year, monthIdx, 1 + shift + (nth - 1) * 7);
}
// Last given weekday of a month (e.g. last Monday in May).
function _lastWeekdayOfMonth(year, monthIdx, weekday) {
  const last = new Date(year, monthIdx + 1, 0); // day 0 of next month = last of this
  const shift = (last.getDay() - weekday + 7) % 7;
  return new Date(year, monthIdx, last.getDate() - shift);
}
// General Election Day = first Tuesday AFTER the first Monday in November.
function _electionDay(year) {
  const firstMon = _nthWeekdayOfMonth(year, 10, 1, 1);
  return new Date(year, 10, firstMon.getDate() + 1);
}
// Weekend→observed shift for FIXED-date holidays: Sat→Fri, Sun→Mon.
function _observedShift(d) {
  const wd = d.getDay();
  if (wd === 6) return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
  if (wd === 0) return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return d;
}

// NY State public-holiday DEFINITIONS (General Construction Law §24 set that
// the WCB observes). Fixed dates get the weekend→observed shift; floating ones
// (Monday/Thursday/Tuesday rules) never need shifting. Materialized per-year by
// nyObservedHolidaySet() below.
// TODO(Joel): confirm WCB observed-holiday set
const NY_OBSERVED_HOLIDAYS = [
  { name: "New Year's Day",            type: 'fixed',        month: 1,  day: 1 },
  { name: 'Martin Luther King Jr. Day',type: 'nth-weekday',  month: 1,  weekday: 1, nth: 3 },
  { name: "Lincoln's Birthday",        type: 'fixed',        month: 2,  day: 12 },
  { name: "Washington's Birthday",     type: 'nth-weekday',  month: 2,  weekday: 1, nth: 3 },
  { name: 'Memorial Day',              type: 'last-weekday', month: 5,  weekday: 1 },
  { name: 'Juneteenth',                type: 'fixed',        month: 6,  day: 19 },
  { name: 'Independence Day',          type: 'fixed',        month: 7,  day: 4 },
  { name: 'Labor Day',                 type: 'nth-weekday',  month: 9,  weekday: 1, nth: 1 },
  { name: 'Columbus Day',              type: 'nth-weekday',  month: 10, weekday: 1, nth: 2 },
  { name: 'Election Day',              type: 'election',     month: 11 },
  { name: 'Veterans Day',              type: 'fixed',        month: 11, day: 11 },
  { name: 'Thanksgiving Day',          type: 'nth-weekday',  month: 11, weekday: 4, nth: 4 },
  { name: 'Christmas Day',             type: 'fixed',        month: 12, day: 25 },
];

const _nyHolidayCache = {};
// Set of observed-holiday "yyyy-mm-dd" strings for a given calendar year.
function nyObservedHolidaySet(year) {
  if (_nyHolidayCache[year]) return _nyHolidayCache[year];
  const set = new Set();
  for (const h of NY_OBSERVED_HOLIDAYS) {
    let dt = null;
    if (h.type === 'fixed')             dt = _observedShift(new Date(year, h.month - 1, h.day));
    else if (h.type === 'nth-weekday')  dt = _nthWeekdayOfMonth(year, h.month - 1, h.weekday, h.nth);
    else if (h.type === 'last-weekday') dt = _lastWeekdayOfMonth(year, h.month - 1, h.weekday);
    else if (h.type === 'election')     dt = _electionDay(year);
    if (dt) set.add(toLocalISO(dt));
  }
  _nyHolidayCache[year] = set;
  return set;
}

// A business day = Mon–Fri that is not an observed NY holiday.
function isBusinessDay(date) {
  const d = _localMidnight(date);
  const wd = d.getDay();
  if (wd === 0 || wd === 6) return false;
  return !nyObservedHolidaySet(d.getFullYear()).has(toLocalISO(d));
}
// Roll FORWARD to the next business day (returns the date unchanged if it is
// already a business day). Skips weekends AND NY holidays.
function rollToNextBusinessDay(date) {
  let d = _localMidnight(date);
  let guard = 0;
  while (!isBusinessDay(d) && guard++ < 3660) {
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  }
  return d;
}
// Step |n| business days from a date in the direction of sign(n).
function _stepBusinessDays(date, n) {
  let d = _localMidnight(date);
  const dir = n < 0 ? -1 : 1;
  let remaining = Math.abs(n);
  let guard = 0;
  while (remaining > 0 && guard++ < 100000) {
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + dir);
    if (isBusinessDay(d)) remaining--;
  }
  return d;
}

// Build a local-midnight Date for (year, monthIdx) with `day` clamped to that
// month's last valid day. new Date(2026, 1, 31) would roll into March; this
// pins it to Feb 28. Used for month/year addition so Jan 31 + 1 mo = Feb 28.
function clampToMonthEnd(year, monthIdx, day) {
  // Normalize month overflow/underflow into year first.
  const y = year + Math.floor(monthIdx / 12);
  const mi = ((monthIdx % 12) + 12) % 12;
  const lastDay = new Date(y, mi + 1, 0).getDate();
  return new Date(y, mi, Math.min(day, lastDay));
}

// Add (or subtract) years/months/weeks/days to a start Date.
//   parts: { y, m, w, d }
//   opts:  { sign: +1 | -1, businessDaysOnly: bool }
// Years+months apply first (with end-of-month clamp); weeks+days then apply as
// a single day delta — calendar days normally, or business days when
// businessDaysOnly is set. Returns a local-midnight Date.
function addYMWD(startDate, parts, opts) {
  const sign = (opts && opts.sign === -1) ? -1 : 1;
  const businessDaysOnly = !!(opts && opts.businessDaysOnly);
  const y = Number(parts && parts.y) || 0;
  const m = Number(parts && parts.m) || 0;
  const w = Number(parts && parts.w) || 0;
  const d = Number(parts && parts.d) || 0;
  const s = _localMidnight(startDate);
  // 1) years + months with month-end clamp
  const targetMonthIdx = s.getMonth() + sign * m;
  let result = clampToMonthEnd(s.getFullYear() + sign * y, targetMonthIdx, s.getDate());
  // 2) weeks + days as one delta
  const dayPortion = sign * (w * 7 + d);
  if (businessDaysOnly) {
    result = _stepBusinessDays(result, dayPortion);
  } else if (dayPortion !== 0) {
    result = new Date(result.getFullYear(), result.getMonth(), result.getDate() + dayPortion);
  }
  return result;
}

// Calendar years/months/days between two local-midnight dates (end exclusive).
function _ymdBetween(start, end) {
  let years = end.getFullYear() - start.getFullYear();
  let months = end.getMonth() - start.getMonth();
  let days = end.getDate() - start.getDate();
  if (days < 0) {
    months -= 1;
    const daysInPrevMonth = new Date(end.getFullYear(), end.getMonth(), 0).getDate();
    days += daysInPrevMonth;
  }
  if (months < 0) { years -= 1; months += 12; }
  return { years, months, days };
}

// Duration between two dates. includeEnd counts the end date itself (adds one
// day to the span), matching timeanddate's "include end date" checkbox.
// Returns { totalDays, weeks, remDays, years, months, days, businessDays }.
function dateDiffBreakdown(startDate, endDate, opts) {
  const includeEnd = !!(opts && opts.includeEnd);
  let s = _localMidnight(startDate);
  let e = _localMidnight(endDate);
  if (e < s) { const t = s; s = e; e = t; } // tolerate reversed inputs
  // Reuse tiles.js inclusiveDays' convention (both endpoints counted) where
  // present; fall back to a local delta so this helper works standalone.
  const localInclusive = Math.round((e - s) / 86400000) + 1;
  const inclusiveCount = (typeof inclusiveDays === 'function')
    ? inclusiveDays(toLocalISO(s), toLocalISO(e))
    : localInclusive;
  const totalDays = Math.max(0, inclusiveCount - (includeEnd ? 0 : 1));
  const weeks = Math.floor(totalDays / 7);
  const remDays = totalDays % 7;
  // y/m/d + business-day count are measured against the same effective span.
  const effEnd = includeEnd
    ? new Date(e.getFullYear(), e.getMonth(), e.getDate() + 1)
    : e;
  const { years, months, days } = _ymdBetween(s, effEnd);
  let businessDays = 0;
  let cur = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  let guard = 0;
  while (cur < effEnd && guard++ < 1000000) {
    if (isBusinessDay(cur)) businessDays++;
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
  }
  return { totalDays, weeks, remDays, years, months, days, businessDays };
}

// ============================================================================
// CASE HYDRATION (May 8, 2026)
// ============================================================================
//
// Canonical save format for attorney_workspaces.workspace_data. See
// ops/rd/specs/workspace_case_hydration.md (in TheCompDesk repo) for the
// full contract — same contract for the website + app surfaces.
//
// Fix: hydrateWorkspaceData(raw) walks the entire blob and default-merges
// every level so partial saves (and old rows missing keys added in later
// releases) render with sensible defaults instead of value={undefined}.
//
// Website-specific notes vs the app's bundle: this surface includes Burns
// and Settlement tiles, plus extra keys on SLU/LWEC (priorTTRWks) and CCP
// periods (amending, priorMode, priorVal). The defaults below are the
// authoritative shape FOR THE WEBSITE — kept in sync with ops/rd/specs/.

const WORKSPACE_FORMAT_VERSION = 2;

const DEFAULT_AWW_STATE = {
  caseName: '',
  aww: 1500,
  doi: '2024-09-15',
  maxRate: 1171.46,
  // v1.2: only 'multi' (§14(1)/(2) Multiplier) and 'straight' (§14(3)/(4)
  // Catchall) are exposed in the UI. Legacy '52week' or 'similar' values
  // from persisted v1.1 workspaces fall through to 'multi' in computeAWW.
  method: 'multi',
  daysWeek: 5,
  // §14(6) — toggle drives whether adjConcurrent is included in composite AWW.
  concurrentOn: false,
  adjTips: 0, adjBoard: 0, adjConcurrent: 0,
  method52Annual: 78000,
  methodMultiEarn: 0, methodMultiDays: 0,
  methodStraightEarn: 0, methodStraightWeeks: 0,
  methodSimilarEarn: 0,
  methodHourlyRate: 0, methodHourlyHours: 0,
};

const DEFAULT_TWEAKS = {
  theme: 'eggshell',
  iridescence: 'subtle',
  perspective: 'subtle',
  snapSize: 20,
  showGrid: false,
  preseedDemo: true,
  paletteCollapsed: false,
};

// Tile input defaults — factories so each call produces fresh row IDs.
// Mirrors the per-tile `tile.inputs || { ... }` literals in tiles.js.
const TILE_INPUT_DEFAULTS = {
  SLU:           () => ({
    rows: [{ id: Date.now(), bp: 'Leg', pct: 0 }],
    priorPay: 0,
    priorTTRWks: 0,
    phpWks: 0,
  }),
  LWEC:          () => ({ pct: 50, feePerWeek: 0, priorTTRWks: 0 }),
  CCP:           () => ({
    periods: [{
      id: Date.now(), start: '', end: '', desg: 'TT',
      curEarn: 0, ratePct: 100, manualRate: 0,
      // TR/TP $/% rate mode (5/19/26 v1): 'pct' | 'usd'
      rateMode: 'pct',
      amending: false, priorMode: 'pct', priorVal: 0,
      // REIMB ER (5/19/26 v2-v5): scope toggle + Known/Unknown + optional date range
      reimbErOn: false, reimbErAmount: 0, reimbErUnknown: false,
      reimbErScope: 'period', reimbErRangeStart: '', reimbErRangeEnd: '',
      endMode: null,
    }],
    ccpAmount: 0,
    priorPay: 0,
    // Round Weeks default — 'tenth' (Nearest 1/10 wk, round down) per 5/19/26
    // v2 spec. Attorneys can still toggle off or to 'whole' in the tile UI.
    rounding: 'tenth',
    doiAutofilled: false,
  }),
  RateLookup:    () => ({ date: '' }),
  Radiculopathy: () => ({
    region: 'lumbar', nerve: 'L5',
    imaging: 0, emg: 0, weakness: 5, atrophy: 0,
    sensory: 0, reflex: 0, tension: 0,
  }),
  Burns:         () => ({
    indemnity: 0, medical: 0, gross: 0, attyFee: 0, disbursements: 0,
    isMVA: false, mvaThreshold: 50000,
  }),
  Settlement:    () => ({ settlement: 0, msa: 0, msaType: 'none', msaMode: 'usd', msaPct: 5 }),
  DateCalc:      () => {
    const today = toLocalISO(new Date());
    return {
      mode: 'add',            // 'add' (Add/Subtract) | 'between' (Between Dates)
      direction: 'add',       // 'add' | 'subtract' (Mode A)
      start: today,           // Mode A start + Mode B start (local ISO)
      y: 0, m: 0, w: 0, d: 0, // Mode A intervals
      businessDaysOnly: false, // Mode A — count the day portion in business days
      roll: false,            // Mode A — roll a non-business-day result forward
      end: today,             // Mode B end (local ISO)
      includeEnd: false,      // Mode B — count the end date itself
    };
  },
};

// Per-row defaults inside known nested arrays.
const TILE_ROW_DEFAULTS = {
  SLU_ROW:    () => ({ id: Date.now() + Math.random(), bp: 'Leg', pct: 0 }),
  CCP_PERIOD: () => ({
    id: Date.now() + Math.random(), start: '', end: '', desg: 'TT',
    curEarn: 0, ratePct: 100, manualRate: 0,
    // TR/TP $/% rate mode (5/19/26 v1): 'pct' | 'usd'
    rateMode: 'pct',
    amending: false, priorMode: 'pct', priorVal: 0,
    // REIMB ER (5/19/26 v2-v5): scope + Known/Unknown + optional date range
    reimbErOn: false, reimbErAmount: 0, reimbErUnknown: false,
    reimbErScope: 'period', reimbErRangeStart: '', reimbErRangeEnd: '',
    endMode: null,
  }),
  // Fee Calculator 6.1 conversions (BETA).
  SLURom:        () => ({ site: 'R Shoulder', roms: {}, special: 'None' }),
  NonSchedule:   () => ({
    mode: 'spine', region: 'lumbar', nerveRoot: 'None', symptoms: true,
    imaging: false, emg: false, weakness: 5, atrophy: false,
    sensory: 'Normal', reflex: 'Normal', tension: false, brain: {}, psych: {},
  }),
  MTG:           () => ({ query: '', bodyPart: 'All', category: 'All', openKey: null }),
  Apportionment: () => {
    // Seeds the 2-case starting state (Current + Prior 1) that TILE_SPECS'
    // width is drawn for. Money fields seed to '' rather than 0 so a 7-column
    // grid doesn't open as a wall of $0.00 the attorney has to clear.
    const t = Date.now();
    const mkCase = (n) => ({
      id: t + n, caseNumber: '', aww: '', doa: '',
      weeksAtTT: '', priorTempWks: '', priorPay: '', credits: '',
    });
    return { cases: [mkCase(0), mkCase(1)], rows: [{ id: t + 10, part: 'Arm', pct: {} }], _expandW: 0 };
  },
};

function hydrateAwwState(raw) {
  return { ...DEFAULT_AWW_STATE, ...(raw && typeof raw === 'object' ? raw : {}) };
}

function hydrateTweaks(raw) {
  return { ...DEFAULT_TWEAKS, ...(raw && typeof raw === 'object' ? raw : {}) };
}

function hydrateTileInputs(type, raw) {
  const defaultsFn = TILE_INPUT_DEFAULTS[type];
  if (!defaultsFn) return raw || {};
  const defaults = defaultsFn();
  const merged = { ...defaults, ...(raw && typeof raw === 'object' ? raw : {}) };
  if (type === 'SLU' && Array.isArray(merged.rows)) {
    merged.rows = merged.rows
      .filter(r => r && typeof r === 'object')
      .map(r => ({ ...TILE_ROW_DEFAULTS.SLU_ROW(), ...r }));
    if (merged.rows.length === 0) merged.rows = [TILE_ROW_DEFAULTS.SLU_ROW()];
  }
  if (type === 'CCP' && Array.isArray(merged.periods)) {
    merged.periods = merged.periods
      .filter(p => p && typeof p === 'object')
      .map(p => ({ ...TILE_ROW_DEFAULTS.CCP_PERIOD(), ...p }));
    if (merged.periods.length === 0) merged.periods = [TILE_ROW_DEFAULTS.CCP_PERIOD()];
  }
  if (type === 'Apportionment') {
    // A tile with no case column can't render a grid — restore the seed pair.
    if (!Array.isArray(merged.cases) || merged.cases.length === 0) merged.cases = defaults.cases;
    if (!Array.isArray(merged.rows)) merged.rows = [];
  }
  return merged;
}

function hydrateTile(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!TILE_INPUT_DEFAULTS[raw.type]) {
    // FORWARD-COMPAT: a tile type this build doesn't know is PRESERVED VERBATIM,
    // never dropped. One workspace row syncs across the website, the app and both
    // native bundles under last-write-wins — so if a lagging surface dropped an
    // unknown tile it would save the truncated layout back and DELETE that tile
    // from every other surface, including the one that created it. (That is a
    // real path: the website deploy repo routinely lags the app by a release.)
    // We have no schema for these inputs, so we normalise NOTHING — every key is
    // carried through untouched and re-serialised byte-for-byte. The canvas
    // renders an inert placeholder for them (see tileSpecFor / UnavailableTile).
    console.warn('[workspace] HYDRATION_UNKNOWN_TILE_TYPE — preserved, not renderable here', raw.type);
    return {
      ...raw,
      id: (raw.id !== undefined && raw.id !== null) ? raw.id : (Date.now() + Math.random()),
      type: raw.type,
      x: typeof raw.x === 'number' ? raw.x : 20,
      y: typeof raw.y === 'number' ? raw.y : 20,
    };
  }
  return {
    id: (raw.id !== undefined && raw.id !== null) ? raw.id : (Date.now() + Math.random()),
    type: raw.type,
    x: typeof raw.x === 'number' ? raw.x : 20,
    y: typeof raw.y === 'number' ? raw.y : 20,
    instance: typeof raw.instance === 'number' ? raw.instance : 1,
    addedAt: typeof raw.addedAt === 'number' ? raw.addedAt : Date.now(),
    inputs: hydrateTileInputs(raw.type, raw.inputs),
  };
}

function _newTabId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'tab_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function hydrateTab(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const tiles = Array.isArray(raw.tiles)
    ? raw.tiles.map(hydrateTile).filter(Boolean)
    : [];
  return {
    id: raw.id || _newTabId(),
    name: raw.name || 'New Case',
    clientName: raw.clientName === undefined ? null : raw.clientName,
    wcbNumber: raw.wcbNumber === undefined ? null : raw.wcbNumber,
    awwState: hydrateAwwState(raw.awwState),
    tiles,
    synced: raw.synced !== false,
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

function hydrateWorkspaceData(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('WORKSPACE_HYDRATION_NOT_OBJECT');
  }
  const tabs = Array.isArray(raw.tabs)
    ? raw.tabs.map(hydrateTab).filter(Boolean)
    : [];
  const activeTabId =
    raw.activeTabId && tabs.find(t => t.id === raw.activeTabId)
      ? raw.activeTabId
      : (tabs[0] ? tabs[0].id : null);
  return {
    formatVersion: WORKSPACE_FORMAT_VERSION,
    tabs,
    activeTabId,
    tweaks: hydrateTweaks(raw.tweaks),
    savedAt: raw.savedAt || new Date().toISOString(),
  };
}

// Shared statutory data + rate-bound helpers come from calc-core (single source
// of truth with the app); fall back to the local definitions above only if
// calc-core failed to load (already logged loud).
const _SHARED = _CALC ? {
  MAX_RATES: _CALC.MAX_RATES, MIN_RATES: _CALC.MIN_RATES, SLU_BP: _CALC.SLU_BP,
  LWEC_BR: _CALC.LWEC_BR, NERVE_CAPS: _CALC.NERVE_CAPS,
  CERVICAL_RANKS: _CALC.CERVICAL_RANKS, LUMBAR_RANKS: _CALC.LUMBAR_RANKS,
  lookupMax: _CALC.lookupMax, lookupMin: _CALC.lookupMin,
  applyRateBounds: _CALC.applyRateBounds, isAwwBelowMin: _CALC.isAwwBelowMin,
  getCappedTT: _CALC.getCappedTT, lwecBracket: _CALC.lwecBracket,
} : {
  MAX_RATES, MIN_RATES, SLU_BP, LWEC_BR, NERVE_CAPS, CERVICAL_RANKS, LUMBAR_RANKS,
  lookupMax, lookupMin, applyRateBounds, isAwwBelowMin, getCappedTT, lwecBracket,
};
Object.assign(window, {
  ..._SHARED,
  applyMinFloor, fmt$, fmtN,
  // Date Calculator helpers (Date Calculator tile) — see the block above.
  toLocalISO, fromLocalISO, NY_OBSERVED_HOLIDAYS, nyObservedHolidaySet,
  isBusinessDay, rollToNextBusinessDay, clampToMonthEnd, addYMWD, dateDiffBreakdown,
  // Hydration contract — see ops/rd/specs/workspace_case_hydration.md
  WORKSPACE_FORMAT_VERSION,
  DEFAULT_AWW_STATE, DEFAULT_TWEAKS,
  TILE_INPUT_DEFAULTS, TILE_ROW_DEFAULTS,
  hydrateAwwState, hydrateTweaks, hydrateTileInputs, hydrateTile, hydrateTab,
  hydrateWorkspaceData,
});


// ===========================================================================
// Fee Calculator 6.1 engines.
// The SLU ROM -> %SLU engine (romToSLU / sluReplacement / romJointsFor /
// SLU_ROM_JOINTS / SLU_ROM_SPECIAL / SLU_SITE_CAPS) lives in the shared
// CANONICAL module /js/calc-core/slu-rom.js, loaded by workspace.html BEFORE
// this file. It publishes its API on window for tiles.js. Do NOT
// re-implement SLU ROM math here; the app copy is www/js/calc-core/slu-rom.js
// and the two must stay byte-identical (slu-guidelines-regression skill).
// ===========================================================================

// ===========================================================================
// Non-Schedule impairment engine (unchanged) -- wrapped in an IIFE so only
// the public API reaches window. Reads NERVE_CAPS / CERVICAL_RANKS /
// LUMBAR_RANKS from this file.
// ===========================================================================
(function(){
  // ===========================================================================
  // Non-Schedule impairment engine — Spine (Tables 11.1/11.2 + S11.4-S11.7),
  // Brain (15.1), Psych (17.3). Spine reconciled to the app's shipped
  // Radiculopathy scorer per Joel (2026-07-09): all nerve roots capped properly
  // (incl. C5), and weakness+atrophy are capped TOGETHER at the root motor max.
  // Adds the workbook's Class (1-4) + A/B severity for no-finding classes.
  // ===========================================================================

  const MOTOR_PTS = { 5:0, 4:0, 3:6, 2:18, 1:20, 0:20 };
  const ORDINAL = ['None','Minimal','Mild','Moderate','Severe'];
  const BRAINPSYCH_SEVERITY = ['None','A-C','F-L','Q-S','W-Z'];

  // ---- Spine ----
  function nonSchedSpine(inp){
    const region = inp.region || 'cervical';           // cervical | thoracic | lumbar
    const root = inp.nerveRoot || 'None';
    const imaging = inp.imaging ? 16 : 0;
    const emg = inp.emg ? 6 : 0;
    const motorRaw = (MOTOR_PTS[Number(inp.weakness)] || 0) + (inp.atrophy ? 6 : 0);
    const sensoryRaw = inp.sensory === 'Anesthesia' ? 6 : inp.sensory === 'Compromised' ? 4 : 0;
    const reflexPts = inp.reflex === 'Absent' ? 6 : inp.reflex === 'Diminished' ? 4 : 0;
    const tension = inp.tension ? 4 : 0;
    // Nerve-root caps (app-consistent): weakness+atrophy together; sensory alone.
    let motor = motorRaw, sensory = sensoryRaw, cap = null;
    if (root && root !== 'None') {
      const list = region === 'lumbar' ? NERVE_CAPS.lumbar : NERVE_CAPS.cervical;
      cap = list.find(n => n.v === root) || null;
      if (cap) { motor = Math.min(motorRaw, cap.maxMotor); sensory = Math.min(sensoryRaw, cap.maxSensory); }
    }
    const total = imaging + emg + motor + sensory + reflexPts + tension;
    const findings = (Number(inp.weakness) < 4) || (inp.sensory && inp.sensory !== 'Normal') || (inp.reflex && inp.reflex !== 'Normal') || !!inp.atrophy || !!inp.tension;
    let cls, severity;
    if (!inp.symptoms) { cls = 1; severity = 'None'; }
    else if (findings) {
      cls = 4;
      const ranks = region === 'lumbar' ? LUMBAR_RANKS : CERVICAL_RANKS;
      const rk = ranks.find(r => total >= r.lo && total <= r.hi) || ranks[ranks.length-1];
      severity = total === 0 ? '' : rk.letter;
    } else if (imaging) { cls = 3; severity = 'B'; }
    else { cls = 2; severity = 'A'; }
    return { region, root, total, motorRaw, motor, sensory, class: cls, severity, capMotor: cap?cap.maxMotor:null, capSensory: cap?cap.maxSensory:null };
  }

  // ---- Brain / Psych (max-ordinal domain model) ----
  function nonSchedDomains(domains){
    // domains: array of ordinal-word strings
    const idxs = domains.map(d => { const i = ORDINAL.indexOf(d); return i < 0 ? 0 : i; });
    const cls = Math.max(1, ...idxs.map(i => i + 1));   // None=1 .. Severe=5
    return { class: cls, severity: BRAINPSYCH_SEVERITY[cls - 1] };
  }

  Object.assign(window, {
    nonSchedSpine, nonSchedDomains,
    NONSCHED_ORDINAL: ORDINAL,
  });
})();
