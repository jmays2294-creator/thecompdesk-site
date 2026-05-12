// Constants — verbatim from brief, do not modify

const MAX_RATES = [
  { s:"2025-07-01", e:"2099-12-31", l:"Jul 1, 2025+",                 max:1222.42 },
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
  { s:"2026-07-01", e:"2099-12-31", l:"Jul 1, 2026+",                min:null, n:"1/5 NYSAWW (indexed)" },
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
      amending: false, priorMode: 'pct', priorVal: 0,
      reimbErOn: false, reimbErAmount: 0,
    }],
    ccpAmount: 0,
    priorPay: 0,
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
};

// Per-row defaults inside known nested arrays.
const TILE_ROW_DEFAULTS = {
  SLU_ROW:    () => ({ id: Date.now() + Math.random(), bp: 'Leg', pct: 0 }),
  CCP_PERIOD: () => ({
    id: Date.now() + Math.random(), start: '', end: '', desg: 'TT',
    curEarn: 0, ratePct: 100, manualRate: 0,
    amending: false, priorMode: 'pct', priorVal: 0,
    reimbErOn: false, reimbErAmount: 0,
  }),
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
  return merged;
}

function hydrateTile(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!TILE_INPUT_DEFAULTS[raw.type]) {
    console.warn('[workspace] HYDRATION_UNKNOWN_TILE_TYPE', raw.type);
    return null;
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

Object.assign(window, {
  MAX_RATES, MIN_RATES, SLU_BP, LWEC_BR, NERVE_CAPS, CERVICAL_RANKS, LUMBAR_RANKS,
  lookupMax, lookupMin, applyMinFloor, applyRateBounds, isAwwBelowMin,
  getCappedTT, lwecBracket, fmt$, fmtN,
  // Hydration contract — see ops/rd/specs/workspace_case_hydration.md
  WORKSPACE_FORMAT_VERSION,
  DEFAULT_AWW_STATE, DEFAULT_TWEAKS,
  TILE_INPUT_DEFAULTS, TILE_ROW_DEFAULTS,
  hydrateAwwState, hydrateTweaks, hydrateTileInputs, hydrateTile, hydrateTab,
  hydrateWorkspaceData,
});
