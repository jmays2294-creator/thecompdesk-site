// calc-core.js — Canonical NYS WC calculation core (single source of truth)
// The Comp Desk / Comp Buddy
//
// WHY THIS FILE EXISTS
// The website workspace (React/JSX) and the mobile app (vanilla JS) historically
// kept DUPLICATE calculator math that drifted — the website was materially more
// precise (statutory min/max bounds, SLU PHP §15(4-a), LWEC §15(3)(w) credit,
// Burns, Section 32). This module is the ONE authoritative implementation of the
// pure math + statutory constants, ported from the website's correct logic.
// Both surfaces should consume it so they can't drift again.
//
// PURE + FRAMEWORK-AGNOSTIC: no DOM, no React, no globals beyond what's passed in.
// Dual-mode: attaches to window.CD.Calc in the browser AND exports for Node tests.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // Node tests
  if (typeof window !== 'undefined') {
    window.CD = window.CD || {};
    window.CD.Calc = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ───────────────────────── STATUTORY CONSTANTS ─────────────────────────
  // MAX_RATES reconciled to the MOST precise version: the app's table carries
  // finer pre-2007 granularity (1985–1990 $300, 1990–1991 $340, 1991–1992 $350,
  // 1992–2007 $400) that the website collapsed to a single 1985–2007 $400 block.
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
    { s:"1992-07-01", e:"2007-06-30", l:"Jul 1, 1992 – Jun 30, 2007",   max: 400.00 },
    { s:"1991-07-01", e:"1992-06-30", l:"Jul 1, 1991 – Jun 30, 1992",   max: 350.00 },
    { s:"1990-07-01", e:"1991-06-30", l:"Jul 1, 1990 – Jun 30, 1991",   max: 340.00 },
    { s:"1985-07-01", e:"1990-06-30", l:"Jul 1, 1985 – Jun 30, 1990",   max: 300.00 },
  ];

  const MIN_RATES = [
    { s:"2027-07-01", e:"2099-12-31", l:"Jul 1, 2027+",               min:null,   n:"1/5 NYSAWW (indexed)" },
    { s:"2026-07-01", e:"2027-06-30", l:"Jul 1, 2026 – Jun 30, 2027", min:384.45, n:"1/5 NYSAWW (2025)" },
    { s:"2025-01-01", e:"2026-06-30", l:"Jan 1, 2025 – Jun 30, 2026", min:325,    n:"" },
    { s:"2024-01-01", e:"2024-12-31", l:"Jan 1, 2024 – Dec 31, 2024", min:275,    n:"" },
    { s:"2013-05-01", e:"2023-12-31", l:"May 1, 2013 – Dec 31, 2023", min:150,    n:"" },
    { s:"2007-07-01", e:"2013-04-30", l:"Jul 1, 2007 – Apr 30, 2013", min:100,    n:"2007 Reform" },
    { s:"1900-01-01", e:"2007-06-30", l:"Before Jul 1, 2007",         min:40,     n:"Pre-reform" },
  ];

  // SLU body parts — w = scheduled weeks, hp = statutory healing period weeks.
  // Canonical = website's consolidated "Other Toe (2nd–5th)" (legally one entry).
  // Per-toe aliases (Other Toe (2)…(5)) and "Binaural" map to the same w/hp via
  // findSLUPart() so app saved data and dropdowns keep resolving.
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
  // Aliases → canonical name (back-compat for app labels and saved rows).
  const SLU_ALIASES = {
    "Other Toe (2)":"Other Toe (2nd–5th)", "Other Toe (3)":"Other Toe (2nd–5th)",
    "Other Toe (4)":"Other Toe (2nd–5th)", "Other Toe (5)":"Other Toe (2nd–5th)",
    "Binaural":"Binaural (Both Ears)",
  };

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

  // Radiculopathy nerve-root sensory/motor caps (website-only; app lacked these).
  const NERVE_CAPS = {
    cervical: [
      { v:'C5', label:'C5 — shoulder/upper arm',             maxSensory:0, maxMotor:10 },
      { v:'C6', label:'C6 — thumb/wrist extensors',          maxSensory:6, maxMotor:10 },
      { v:'C7', label:'C7 — middle finger/triceps',          maxSensory:6, maxMotor:10 },
      { v:'C8', label:'C8 — ring & small finger/intrinsics', maxSensory:4, maxMotor:12 },
      { v:'T1', label:'T1 — hand intrinsics',                maxSensory:0, maxMotor:12 },
    ],
    lumbar: [
      { v:'L3', label:'L3 — anterior thigh/quadriceps',  maxSensory:0, maxMotor:12 },
      { v:'L4', label:'L4 — anterior leg/tibialis ant.', maxSensory:4, maxMotor:24 },
      { v:'L5', label:'L5 — dorsum foot/peroneals, EHL', maxSensory:4, maxMotor:16 },
      { v:'S1', label:'S1 — plantar foot/gastrocnemius', maxSensory:6, maxMotor:18 },
    ],
  };

  const CERVICAL_RANKS = [
    { letter:'C', lo:0, hi:0 }, { letter:'D', lo:4, hi:16 }, { letter:'E', lo:17, hi:32 },
    { letter:'F', lo:33, hi:48 }, { letter:'G', lo:49, hi:64 }, { letter:'H', lo:65, hi:80 },
  ];
  const LUMBAR_RANKS = [
    { letter:'D', lo:0, hi:0 }, { letter:'E', lo:4, hi:16 }, { letter:'F', lo:17, hi:32 },
    { letter:'G', lo:33, hi:48 }, { letter:'H', lo:49, hi:64 }, { letter:'I', lo:65, hi:80 },
    { letter:'J', lo:81, hi:92 },
  ];

  // ───────────────────────────── HELPERS ─────────────────────────────────
  const num = (v) => Number(v) || 0;

  // YYYY-MM-DD string comparison (matches the website's lookup; tolerant of bad input).
  function lookupMax(dateStr) {
    if (!dateStr) return null;
    for (const r of MAX_RATES) if (dateStr >= r.s && dateStr <= r.e) return r;
    return null;
  }
  function lookupMin(dateStr) {
    if (!dateStr) return null;
    for (const r of MIN_RATES) if (dateStr >= r.s && dateStr <= r.e) return r;
    return null;
  }
  function maxRateForDOA(dateStr) { const r = lookupMax(dateStr); return r ? r.max : 0; }
  function minRateForDOA(dateStr) { const r = lookupMin(dateStr); return r && r.min ? r.min : 0; }

  function findSLUPart(name) {
    return SLU_BP.find(b => b.n === name)
        || SLU_BP.find(b => b.n === (SLU_ALIASES[name] || ''))
        || null;
  }

  // applyRateBounds — universal min/max enforcement for any weekly comp rate.
  // Rule (Joel, May 2026): if AWW < statutory min, EVERYTHING collapses to AWW
  // (a worker can't get >100% of AWW). Otherwise cap at max, then floor at min.
  // Pass 0/null to skip a bound. AWW-override only fires when aww>0 and minRate>0.
  function applyRateBounds(rate, aww, minRate, maxRate) {
    const awwNum = num(aww), r = num(rate), minR = num(minRate), maxR = num(maxRate);
    if (minR > 0 && awwNum > 0 && awwNum < minR) return awwNum;
    let bounded = r;
    if (maxR > 0) bounded = Math.min(bounded, maxR);
    if (minR > 0 && bounded < minR) bounded = minR;
    return bounded;
  }
  // floorFee5 — THE attorney-fee rounding rule for a fee APPLICATION.
  // Joel's spec (see the identical floor5 in workspace/feeapp.js + oc400-core.js):
  // "the fee requested should automatically generate the nearest $5 number below
  // the eligible fee." $4,876.32 → $4,875; $5,000 → $5,000.
  //
  // WHY IT LIVES HERE NOW (2026-07-21): the OC-400.1 generator has ALWAYS floored
  // the "Amount Requested" field — every fee app this product has ever produced
  // carries a floored number. But the tiles displayed the exact 15%, so the fee
  // and net on screen were up to $4.99 away from what the attorney actually
  // filed off that same screen. The calculators now report the number that will
  // be requested, so display and filing agree. Idempotent, so feeapp.js's own
  // floor5 on the way to the PDF is a no-op rather than a double-rounding.
  function floorFee5(amount) {
    const v = num(amount);
    if (!isFinite(v) || v <= 0) return 0;
    return Math.floor(v / 5) * 5;
  }

  function isAwwBelowMin(aww, minRate) {
    const a = num(aww), m = num(minRate);
    return m > 0 && a > 0 && a < m;
  }
  // Bounded temporary-total rate for a DOA: 2/3 AWW, then min/max bounds.
  function getCappedTT(aww, maxRate, minRate) {
    return applyRateBounds(num(aww) * 2 / 3, aww, minRate, maxRate);
  }
  function lwecBracket(pct) {
    const p = num(pct);
    if (p >= 100) return LWEC_BR[0];
    for (let i = 1; i < LWEC_BR.length; i++) {
      const b = LWEC_BR[i];
      if (p >= b.lo && p <= b.hi) return b;
    }
    return LWEC_BR[LWEC_BR.length - 1];
  }

  // ───────────────────────────── SLU AWARD ───────────────────────────────
  // rows: [{ bp:<name>, pct:<number> }]
  // tt: the bounded total rate (use getCappedTT). priorTTRWks: case-level §15(3)(w).
  // phpWks: prior weeks @ TT for Protracted Healing Period (§15(4-a)) — credited
  // ONCE against the LONGEST healing period among the selected parts (not stacked).
  function computeSLU({ rows = [], tt = 0, priorTTRWks = 0, phpWks = 0, priorPay = 0 }) {
    const ttN = num(tt);
    let sluWeeksTotal = 0;
    const rowOut = rows.map(r => {
      const bp = findSLUPart(r.bp) || SLU_BP[0];
      const sluWks = (num(r.pct) / 100) * bp.w;
      sluWeeksTotal += sluWks;
      return { bp: bp.n, pct: num(r.pct), w: bp.w, hp: bp.hp, sluWks };
    });
    const phpInput = num(phpWks);
    const maxHp = rowOut.reduce((m, r) => Math.max(m, r.hp || 0), 0);
    const phpCreditWks = Math.max(0, phpInput - maxHp);
    const totalWeeks = sluWeeksTotal + phpCreditWks;
    const grossTotal = totalWeeks * ttN;
    const priorWks = num(priorTTRWks);
    const creditWks = priorWks > 130 ? priorWks - 130 : 0;
    const creditDollars = creditWks * ttN;
    const total = Math.max(0, grossTotal - creditDollars);
    const moving = Math.max(0, total - num(priorPay));
    // The requested fee — floored to $5 so the tile shows what gets filed.
    const fee = floorFee5(moving * 0.15);
    const net = moving - fee;
    return { rowOut, sluWeeksTotal, phpInput, maxHp, phpCreditWks, totalWeeks,
             grossTotal, creditWks, creditDollars, total, moving, fee, net };
  }

  // ───────────────────────────── LWEC ────────────────────────────────────
  // tt: 2/3 AWW (unbounded). aww/minRate/maxRate drive applyRateBounds on the
  // class rate. priorTTRWks: §15(3)(w) — weeks paid >130 credited week-for-week
  // at the class rate (reduces awarded weeks, not the rate).
  function computeLWEC({ pct = 0, aww = 0, minRate = 0, maxRate = 0, priorTTRWks = 0, feePerWeek = 0 }) {
    const p = num(pct);
    // Class rate base is the BOUNDED TT (2/3 AWW capped at max / floored at min),
    // then × LWEC% — matches the website (global.ttRate is already bounded). Using
    // the unbounded 2/3 AWW here would overstate LWEC for high earners.
    const ttBounded = applyRateBounds(num(aww) * 2 / 3, aww, minRate, maxRate);
    const rawClassRate = ttBounded * (p / 100);
    const classRate = applyRateBounds(rawClassRate, aww, minRate, maxRate);
    const bracket = lwecBracket(p);
    const isLifetime = bracket.mw === 'Lifetime';
    const priorWks = num(priorTTRWks);
    const creditWks = priorWks > 130 ? priorWks - 130 : 0;
    const grossWks = isLifetime ? null : bracket.mw;
    const adjustedWks = isLifetime ? null : Math.max(0, grossWks - creditWks);
    const grossAward = isLifetime ? null : classRate * grossWks;
    const creditDollars = isLifetime ? null : classRate * creditWks;
    const totalAward = isLifetime ? null : classRate * adjustedWks;
    // First 15 weeks at the class rate — the requested fee, floored to $5.
    const fee = floorFee5(classRate * 15);
    const weeklyNet = classRate - num(feePerWeek);
    const totalNet = isLifetime ? null : totalAward - fee;
    return { pct:p, rawClassRate, classRate, bracket, isLifetime, grossWks, creditWks,
             adjustedWks, grossAward, creditDollars, totalAward, fee, weeklyNet, totalNet };
  }

  // ───────────────────────── CCP PER-PERIOD RATE ─────────────────────────
  // Returns the bounded weekly rate for one CCP period. Unlike the app's old
  // logic (which only capped TT at max and left RE/TR unbounded), this applies
  // full min/max + AWW-below-min bounds to EVERY designation.
  function ccpPeriodRate({ desig, curEarn = 0, ratePct = 0, manualRate = 0, rateMode = 'pct',
                           aww = 0, minRate = 0, maxRate = 0 }) {
    const awwN = num(aww);
    const tt = awwN * 2 / 3;
    const cappedTT = applyRateBounds(tt, awwN, minRate, maxRate);
    let raw;
    switch (desig) {
      case 'TT': raw = cappedTT; break;
      case 'RE': raw = (2 / 3) * (awwN - num(curEarn)); break;
      case 'TR':
      case 'TP':
        // June 2026 drift fix: percentage applies to the UNCAPPED ⅔ × AWW;
        // applyRateBounds() below caps at DOA max / floors at DOA min /
        // collapses to AWW. Using cappedTT understated the rate whenever
        // ⅔ × AWW exceeded the DOA max. TP and TR are identical (label-only).
        raw = (rateMode === 'usd') ? num(manualRate) : awwN * (2 / 3) * (num(ratePct) / 100);
        break;
      case 'HIA': return 0; // Held in Abeyance — no rate, no contribution
      default:   raw = num(manualRate); break;
    }
    return applyRateBounds(raw, awwN, minRate, maxRate);
  }

  // ── Canonical date helpers (byte-identical across app + website + extension;
  // do not let them drift — see ops/secretary/calculator_fixes_scope_and_prompts.md).
  // Inclusive day span between two YYYY-MM-DD strings (both endpoints counted).
  // UTC parse is DST-immune; Math.round guards float drift.
  function inclusiveDays(start, end) {
    if (!start || !end) return 0;
    const s = new Date(start), e = new Date(end);
    if (isNaN(s) || isNaN(e) || e < s) return 0;
    return Math.round((e - s) / 86400000) + 1;
  }
  // Weeks for the period at index i within the periods array.
  // FIX #2: drop the shared boundary day when this period is exactly consecutive
  // to the immediately-prior non-HIA period (this.start === prev.end).
  function periodWeeks(periods, i) {
    const p = periods[i];
    if (!p || p.desg === 'HIA') return 0;
    let days = inclusiveDays(p.start, p.end);
    const prev = i > 0 ? periods[i - 1] : null;
    if (prev && prev.desg !== 'HIA' && p.start && prev.end && p.start === prev.end) {
      days = Math.max(0, days - 1);            // count the boundary once
    }
    return days / 7;
  }
  // FIX #1 helper: day-after a YYYY-MM-DD date (UTC, DST-immune).
  function dayAfter(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d)) return '';
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  // Inclusive weeks between two YYYY-MM-DD dates (no rounding). Reconciled to the
  // inclusive convention so the basic calc matches the workspace tile.
  function weeksBetween(start, end) {
    return inclusiveDays(start, end) / 7;
  }
  // Floor weeks to a rounding precision. 'none'=exact, 'tenth'=nearest 1/10 wk
  // rounded down (website CCP default), 'whole'=whole weeks rounded down.
  function roundWeeksDown(wks, mode) {
    const w = num(wks);
    if (mode === 'tenth') return Math.floor(w * 10) / 10;
    if (mode === 'whole') return Math.floor(w);
    return w;
  }

  // ───────────────────────────── AWW ─────────────────────────────────────
  // §14 methods + §2(9) tips/board + §14(6) concurrent. Ported from the website
  // computeAWW(). method: 'multi' (§14(1)/(2) multiplier) | 'straight'
  // (§14(3)/(4) catchall). daysWeek ∈ {4,5,6,7}.
  const DAYS_MULTIPLIER = { 4: 200, 5: 260, 6: 300, 7: 365 };
  function computeAWW(state = {}) {
    const adjTips = num(state.adjTips), adjBoard = num(state.adjBoard), adjConcur = num(state.adjConcurrent);
    let baseAww = 0, methodLabel = '', formula = '';
    if (state.method === 'straight') {
      const earn = num(state.methodStraightEarn), wks = num(state.methodStraightWeeks);
      baseAww = wks > 0 ? earn / wks : 0;
      methodLabel = '§14(3)/(4) — Catchall (Weekly Divisor)';
      formula = `$${earn} ÷ ${wks} wks`;
    } else {
      const earn = num(state.methodMultiEarn), days = num(state.methodMultiDays);
      const mult = DAYS_MULTIPLIER[state.daysWeek] || 260;
      const dailyWage = days > 0 ? earn / days : 0;
      baseAww = days > 0 ? (dailyWage * mult) / 52 : 0;
      methodLabel = `§14(1)/(2) — Multiplier ×${mult}`;
      formula = `($${earn} ÷ ${days} days) × ${mult} ÷ 52`;
    }
    const includeConcurrent = !!state.concurrentOn;
    const concurrentApplied = includeConcurrent ? adjConcur : 0;
    const adjustedAww = baseAww + adjTips + adjBoard + concurrentApplied;
    const maxRate = maxRateForDOA(state.doi), minRate = minRateForDOA(state.doi);
    const ttRate = getCappedTT(adjustedAww, maxRate, minRate);
    return {
      aww: Math.round(adjustedAww * 100) / 100,
      baseAww: Math.round(baseAww * 100) / 100,
      concurrentAww: Math.round(concurrentApplied * 100) / 100,
      isComposite: includeConcurrent && concurrentApplied > 0,
      method: state.method || 'multi', methodLabel, formula,
      adjTips, adjBoard, ttRate, maxRate, minRate,
      capped: maxRate > 0 && (adjustedAww * 2 / 3) > maxRate,
    };
  }

  // ───────────────────────────── CCP / AWARD ─────────────────────────────
  // Full two-bucket model (claimant award + employer REIMB-ER), ported from the
  // website CCP tile. periods: array of period objects; opts: { aww, minRate,
  // maxRate, rounding, ccpAmount, priorPay }. Designations: TT, RE, TR, TP,
  // NCLT, NME, HIA. Per-period fields: desg, start, end, curEarn, ratePct,
  // manualRate, rateMode('pct'|'usd'), amending, priorMode, priorVal,
  // reimbErOn, reimbErAmount, reimbErUnknown, reimbErScope('period'|'all'|'specific'),
  // reimbErRangeStart, reimbErRangeEnd.
  function computeCCP(periods = [], opts = {}) {
    const aww = num(opts.aww), minRate = num(opts.minRate), maxRate = num(opts.maxRate);
    const rounding = opts.rounding || 'none';
    const ttBase = aww * 2 / 3;                                   // uncapped 2/3 AWW
    const ttBounded = applyRateBounds(ttBase, aww, minRate, maxRate);

    const out = periods.map((p, i) => {
      const period = Object.assign({}, p);
      if (period.desg === 'HIA') {
        return Object.assign(period, { wks:0, rawCurrentRate:0, currentRate:0, priorRate:0, rate:0, amount:0, isHia:true });
      }
      // FIX #2 applied via periodWeeks (boundary day dropped before rounding).
      const wks = roundWeeksDown(periodWeeks(periods, i), rounding);
      const rateMode = period.rateMode || 'pct';
      let rawCurrentRate = 0;
      if (period.desg === 'TT') rawCurrentRate = ttBounded;
      else if (period.desg === 'RE') rawCurrentRate = Math.max(0, (aww - num(period.curEarn)) * 2 / 3);
      else if (period.desg === 'TR') rawCurrentRate = (rateMode === 'usd') ? num(period.manualRate) : aww * (2/3) * (num(period.ratePct)/100);
      // TP mirrors TR (June 2026 drift fix) — % on UNCAPPED ⅔ × AWW, then bound below.
      else if (period.desg === 'TP') rawCurrentRate = (rateMode === 'usd') ? num(period.manualRate) : aww * (2/3) * (num(period.ratePct)/100);
      else if (period.desg === 'NCLT' || period.desg === 'NME') rawCurrentRate = 0;
      else rawCurrentRate = num(period.manualRate);

      let currentRate = applyRateBounds(rawCurrentRate, aww, minRate, maxRate);
      if (period.desg === 'NCLT' || period.desg === 'NME') currentRate = 0;
      // RE: max cap only — no min floor, no AWW-collapse (5/20/26).
      if (period.desg === 'RE') currentRate = maxRate > 0 ? Math.min(rawCurrentRate, maxRate) : rawCurrentRate;

      let rate = currentRate, priorRate = 0;
      if (period.amending) {
        const priorPct = (period.priorMode === 'usd')
          ? (ttBase > 0 ? Math.min(100, (Math.max(0, num(period.priorVal)) / ttBase) * 100) : 0)
          : Math.max(0, Math.min(100, num(period.priorVal)));
        priorRate = (priorPct / 100) * ttBase;
        rate = Math.max(0, currentRate - priorRate);
      }
      return Object.assign(period, { wks, rawCurrentRate, currentRate, priorRate, rate, amount: wks * rate, isHia:false });
    });

    const totalAward = out.reduce((s, p) => s + p.amount, 0);

    // REIMB-ER: CLAIM → CAP → ACTUAL, per-period remaining capacity, scopes.
    let reimbErKnown = 0, reimbErHasUnknown = false;
    out.forEach(r => { r.remainingForReimb = r.isHia ? 0 : (num(r.amount)); });
    const resolveContributions = (carrier) => {
      const scope = carrier.reimbErScope || 'period';
      const contribs = [];
      if (scope === 'period') {
        if (!carrier.isHia) contribs.push({ p: carrier, cap: Math.min(num(carrier.amount), carrier.remainingForReimb) });
      } else if (scope === 'all') {
        out.forEach(p => { if (p.isHia) return; contribs.push({ p, cap: Math.min(num(p.amount), p.remainingForReimb) }); });
      } else if (scope === 'specific') {
        if (!carrier.reimbErRangeStart || !carrier.reimbErRangeEnd) return contribs;
        const rStart = new Date(carrier.reimbErRangeStart), rEnd = new Date(carrier.reimbErRangeEnd);
        if (isNaN(rStart.getTime()) || isNaN(rEnd.getTime()) || rEnd < rStart) return contribs;
        out.forEach(p => {
          if (p.isHia || !p.start || !p.end) return;
          const pStart = new Date(p.start), pEnd = new Date(p.end);
          if (isNaN(pStart.getTime()) || isNaN(pEnd.getTime()) || pEnd < rStart || pStart > rEnd) return;
          const oStart = pStart > rStart ? pStart : rStart, oEnd = pEnd < rEnd ? pEnd : rEnd;
          const days = (oEnd - oStart) / (864e5) + 1;
          const overlapWks = roundWeeksDown(days / 7, rounding);
          const overlapAmt = overlapWks * num(p.rate);
          contribs.push({ p, cap: Math.min(overlapAmt, p.remainingForReimb) });
        });
      }
      return contribs;
    };
    out.forEach(carrier => {
      if (!carrier.reimbErOn) return;
      if (carrier.reimbErUnknown) { reimbErHasUnknown = true; carrier.resolvedReimbErAmount = 0; return; }
      const contribs = resolveContributions(carrier);
      const claim = num(carrier.reimbErAmount);
      const availableCap = contribs.reduce((s, c) => s + Math.max(0, c.cap), 0);
      const actual = Math.min(claim, availableCap);
      carrier.resolvedReimbErAmount = actual;
      carrier.reimbErCapped = claim > availableCap + 0.005;
      if (availableCap > 0 && actual > 0) {
        contribs.forEach(c => { if (c.cap <= 0) return; c.p.remainingForReimb = Math.max(0, c.p.remainingForReimb - (c.cap / availableCap) * actual); });
      }
      reimbErKnown += actual;
    });

    const claimantMoving = Math.max(0, totalAward - num(opts.priorPay) - reimbErKnown);
    const feeOnClaimant = claimantMoving * 0.15;
    const employerMoving = reimbErKnown;
    const feeOnEmployer = employerMoving * 0.15;
    const feeOnCCP = num(opts.ccpAmount) / 3;
    const totalFee = feeOnClaimant + feeOnEmployer + feeOnCCP;
    const netToClaimant = claimantMoving - feeOnClaimant - feeOnCCP;
    const netToEmployer = employerMoving - feeOnEmployer;
    return {
      rows: out, totalAward, totalReimbEr: reimbErKnown, reimbErKnown, reimbErHasUnknown,
      claimantMoving, feeOnClaimant, employerMoving, feeOnEmployer, feeOnCCP, totalFee,
      netToClaimant, netToEmployer,
      moving: claimantMoving, feeOnAward: feeOnClaimant, net: netToClaimant,
    };
  }

  // ───────────────────────────── BURNS ───────────────────────────────────
  function computeBurns({ indemnity = 0, medical = 0, gross = 0, attyFee = 0,
                          disbursements = 0, isMVA = false, mvaThreshold = 0 }) {
    const grossLien = num(indemnity) + num(medical);
    const lienBase = isMVA ? Math.max(0, grossLien - num(mvaThreshold)) : grossLien;
    const litCosts = num(attyFee) + num(disbursements);
    const burnsRate = num(gross) > 0 ? litCosts / num(gross) : 0;
    const netLien = burnsRate * lienBase;
    const netToPlaintiff = num(gross) - litCosts - netLien;
    return { grossLien, lienBase, litCosts, burnsRate, netLien, netToPlaintiff };
  }

  // ──────────────────────── SECTION 32 SETTLEMENT ────────────────────────
  // msaType: 'none' | 'msa' | 'medicare'. msaMode: 'usd' | 'pct'.
  function computeSettlement({ settlement = 0, msa = 0, msaType, msaMode = 'usd', msaPct = 0, msaOn }) {
    const s = num(settlement);
    // NOTE: msaType has NO default — a default of 'none' would short-circuit the
    // msaOn back-compat fallback below (old saves stored msaOn:bool, not msaType).
    const type = msaType || (msaOn ? 'msa' : 'none');
    const hasMSA = type === 'msa' || type === 'medicare';
    const mode = msaMode || 'usd';
    const pct = num(msaPct);
    const msaUsd = !hasMSA ? 0 : (mode === 'pct' ? (s * pct / 100) : num(msa));
    const indemnity = Math.max(0, s - msaUsd);
    const fee = floorFee5(indemnity * 0.15);
    const net = Math.max(0, indemnity - fee);
    return { settlement:s, msaType:type, hasMSA, msaMode:mode, msaPct:pct, msa:msaUsd, indemnity, fee, net };
  }

  // ───────────────────── RADICULOPATHY NERVE CAPS ────────────────────────
  // Clamp a sensory/motor score to the nerve root's anatomic maximum.
  function nerveCap(region, nerve) {
    const list = NERVE_CAPS[region] || [];
    return list.find(n => n.v === nerve) || null;
  }
  function clampNerveScores(region, nerve, sensory, motor) {
    const cap = nerveCap(region, nerve);
    if (!cap) return { sensory: num(sensory), motor: num(motor), capped: false };
    const s = Math.min(num(sensory), cap.maxSensory);
    const m = Math.min(num(motor), cap.maxMotor);
    return { sensory: s, motor: m, capped: (s !== num(sensory) || m !== num(motor)) };
  }
  function radRank(points, region) {
    const t = region === 'lumbar' ? LUMBAR_RANKS : CERVICAL_RANKS;
    if (num(points) === 0) return t[0].letter;
    for (const r of t) if (points >= r.lo && points <= r.hi) return r.letter;
    return t[t.length - 1].letter;
  }

  // ─────────────────── MULTI-CASE SLU APPORTIONMENT ──────────────────────
  // Apportionment BETWEEN CLAIMS — one claimant, several established cases
  // with different dates of accident. This is NOT Burns v. Varick third-party
  // lien apportionment (that is computeBurns, which the UI also labels
  // "apportionment"); nothing here touches a third-party recovery.
  //
  // Each case carries its OWN AWW and its OWN DOA, so each pulls its own
  // max/min out of the rate tables — the same body part can settle at very
  // different weekly rates across two cases. Digital port of Joel's
  // "Apportionment Fee Calculator" workbook (ops/secretary/); the per-column
  // formulas are reproduced exactly EXCEPT the two places the workbook is
  // wrong, where MIN_RATES/MAX_RATES above stay authoritative:
  //   1. The workbook's Rate Table hard-codes a $150 minimum for every year.
  //      The real pre-reform minimums are $40 (before 7/1/2007) and $100
  //      (7/1/2007–4/30/2013).
  //   2. Excel's MIN() SKIPS a blank cell, so a column with no AWW reports the
  //      statutory minimum as its "rate". A case with no AWW rates at 0 here.
  //      Either way the money is identical — 0 weeks × anything is 0.
  //
  // cases[]: { label, caseNumber, aww, doa:'YYYY-MM-DD', weeksAtTT, priorPay,
  //            credits, parts:[{ part, pctSLU }] }
  //
  // parts[].pctSLU is a FRACTION (0.10 = 10%), matching the workbook's
  //   percent-formatted cells. Callers already holding whole percents may pass
  //   `pct` (0–100, computeSLU's convention) instead — supply ONE key per row,
  //   never both. Whatever the units: enter the APPORTIONED %SLU for each case
  //   — the loss SPLIT across the cases, not the full SLU repeated in every
  //   column, or the same loss is paid for more than once.
  // php — pre-permanency period = max(0, weeksAtTT − the LONGEST healing
  //   period among the parts scoring above 0% in THAT case). Credited once
  //   against the longest part, never summed; same rule as computeSLU.
  // priorTempWks — §15(3)(w) prior TEMPORARY DISABILITY weeks for that case.
  //   Scope is COMBINED temporary total AND temporary partial / reduced
  //   earnings, not TT alone — the same figure computeSLU's `priorTTRWks`
  //   takes (the SLU tile labels it "Prior TT / TR / TP Weeks (§15(3)(w))").
  //   Weeks above 130 are credited at that case's own rate and SUBTRACTED from
  //   the gross in dollars, exactly as computeSLU does it. Without this the
  //   tile could only ADD weeks (via PHP) and read high on any case with heavy
  //   prior temporary disability. The workbook has no such column.
  // fee — FLOOR(moving × 15%, $5): 15% rounded DOWN to the nearest $5, the
  //   OC-400.1 convention the workbook uses. (computeSLU leaves its 15%
  //   unrounded; these numbers go on a filed fee app, so they get rounded.)
  //   A case that has been overpaid (moving < 0) carries no fee rather than a
  //   negative one — the workbook would report a negative fee there.
  function computeApportionment({ cases = [] } = {}) {
    const perCase = (Array.isArray(cases) ? cases : []).map((raw) => {
      const c = raw || {};
      const aww = num(c.aww);
      const doa = c.doa || '';
      const maxRate = maxRateForDOA(doa);
      const minRate = minRateForDOA(doa);
      // A case rates at 0 until it has BOTH an AWW and a D/A that lands in the
      // rate table. Without the D/A guard, maxRateForDOA() returns 0, which
      // applyRateBounds reads as "no cap" — a blank or pre-1985 date would
      // silently pay the UNCAPPED ⅔ AWW (e.g. $2,000/wk on a $3,000 AWW instead
      // of the $1,125.46 statutory max), and it would do it while the attorney
      // is still filling the column in.
      const rate = (aww > 0 && maxRate > 0)
        ? applyRateBounds(aww * 2 / 3, aww, minRate, maxRate)
        : 0;

      let scheduledWeeks = 0;
      let highestHP = 0;
      const parts = (Array.isArray(c.parts) ? c.parts : []).map((rawPart) => {
        const p = rawPart || {};
        const bp = findSLUPart(p.part);
        // pctSLU is the fraction form; pct is the 0–100 form. Explicit keys,
        // no sniffing — 0.5 must never be ambiguous between 0.5% and 50%.
        const pctSLU = (p.pctSLU === undefined || p.pctSLU === null || p.pctSLU === '')
          ? num(p.pct) / 100
          : num(p.pctSLU);
        const w = bp ? bp.w : 0;
        const hp = bp ? bp.hp : 0;
        const weeks = pctSLU * w;
        scheduledWeeks += weeks;
        // Only parts actually scoring drive the healing period (workbook:
        // MAX(IF((pct>0)*(part<>""), hp, 0))).
        if (pctSLU > 0 && hp > highestHP) highestHP = hp;
        return { part: bp ? bp.n : (p.part || ''), known: !!bp, pctSLU, w, hp, weeks };
      });

      const weeksAtTT = num(c.weeksAtTT);
      // PHP protracts a SCHEDULE AWARD — with no established %SLU there is no
      // award to protract, so weeks at TT alone must never mint one. (Without
      // this, a case with 50 weeks at TT and every body part still at 0% would
      // report 50 weeks × the rate as "gross".)
      const php = scheduledWeeks > 0 ? Math.max(0, weeksAtTT - highestHP) : 0;
      const totalWeeks = scheduledWeeks + php;
      const gross = totalWeeks * rate;

      // §15(3)(w) — prior temporary disability (TT + TP/TR combined) above 130
      // weeks is credited at this case's rate. Same rule and same order of
      // operations as computeSLU: the credit comes off the GROSS in dollars,
      // clamped at 0, BEFORE prior payments and dollar credits.
      const priorTempWks = num(c.priorTempWks);
      const priorTempCreditWks = priorTempWks > 130 ? priorTempWks - 130 : 0;
      const priorTempCreditDollars = priorTempCreditWks * rate;
      const awardAfterCredit = Math.max(0, gross - priorTempCreditDollars);

      const priorPay = num(c.priorPay);
      const credits = num(c.credits);
      const moving = awardAfterCredit - priorPay - credits;
      const fee = floorFee5(moving * 0.15);
      const net = moving - fee;

      return {
        label: c.label || '', caseNumber: c.caseNumber || '',
        aww, doa, maxRate, minRate, rate,
        parts, scheduledWeeks, weeksAtTT, highestHP, php, totalWeeks,
        gross, priorTempWks, priorTempCreditWks, priorTempCreditDollars,
        awardAfterCredit, priorPay, credits, moving, fee, net,
      };
    });

    const totals = perCase.reduce((t, r) => ({
      gross:    t.gross    + r.gross,
      priorTempCreditDollars: t.priorTempCreditDollars + r.priorTempCreditDollars,
      priorPay: t.priorPay + r.priorPay,
      credits:  t.credits  + r.credits,
      moving:   t.moving   + r.moving,
      fee:      t.fee      + r.fee,
      net:      t.net      + r.net,
    }), { gross: 0, priorTempCreditDollars: 0, priorPay: 0, credits: 0,
          moving: 0, fee: 0, net: 0 });

    return { perCase, totals };
  }

  return {
    // constants
    MAX_RATES, MIN_RATES, SLU_BP, SLU_ALIASES, LWEC_BR, NERVE_CAPS, CERVICAL_RANKS, LUMBAR_RANKS,
    DAYS_MULTIPLIER,
    // lookups + helpers
    lookupMax, lookupMin, maxRateForDOA, minRateForDOA, findSLUPart,
    applyRateBounds, isAwwBelowMin, getCappedTT, lwecBracket, floorFee5, weeksBetween, roundWeeksDown,
    inclusiveDays, periodWeeks, dayAfter,
    // calculators
    computeAWW, computeSLU, computeLWEC, ccpPeriodRate, computeCCP, computeBurns, computeSettlement,
    computeApportionment,
    nerveCap, clampNerveScores, radRank,
  };
});
