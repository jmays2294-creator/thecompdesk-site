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
    const fee = moving * 0.15;
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
    const fee = classRate * 15;
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
        raw = (rateMode === 'usd') ? num(manualRate) : (num(ratePct) / 100) * cappedTT;
        break;
      case 'HIA': return 0; // Held in Abeyance — no rate, no contribution
      default:   raw = num(manualRate); break;
    }
    return applyRateBounds(raw, awwN, minRate, maxRate);
  }

  // Exact weeks between two YYYY-MM-DD dates (no rounding).
  function weeksBetween(start, end) {
    if (!start || !end) return 0;
    const s = new Date(start + 'T00:00:00'), e = new Date(end + 'T00:00:00');
    const wks = (e - s) / (864e5 * 7);
    return wks > 0 ? wks : 0;
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

    const out = periods.map(p => {
      const period = Object.assign({}, p);
      if (period.desg === 'HIA') {
        return Object.assign(period, { wks:0, rawCurrentRate:0, currentRate:0, priorRate:0, rate:0, amount:0, isHia:true });
      }
      const wks = roundWeeksDown(weeksBetween(period.start, period.end), rounding);
      const rateMode = period.rateMode || 'pct';
      let rawCurrentRate = 0;
      if (period.desg === 'TT') rawCurrentRate = ttBounded;
      else if (period.desg === 'RE') rawCurrentRate = Math.max(0, (aww - num(period.curEarn)) * 2 / 3);
      else if (period.desg === 'TR') rawCurrentRate = (rateMode === 'usd') ? num(period.manualRate) : aww * (2/3) * (num(period.ratePct)/100);
      else if (period.desg === 'TP') rawCurrentRate = (rateMode === 'pct') ? ttBounded * (num(period.ratePct)/100) : num(period.manualRate);
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
  function computeSettlement({ settlement = 0, msa = 0, msaType = 'none', msaMode = 'usd', msaPct = 0, msaOn }) {
    const s = num(settlement);
    const type = msaType || (msaOn ? 'msa' : 'none');
    const hasMSA = type === 'msa' || type === 'medicare';
    const mode = msaMode || 'usd';
    const pct = num(msaPct);
    const msaUsd = !hasMSA ? 0 : (mode === 'pct' ? (s * pct / 100) : num(msa));
    const indemnity = Math.max(0, s - msaUsd);
    const fee = indemnity * 0.15;
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

  return {
    // constants
    MAX_RATES, MIN_RATES, SLU_BP, SLU_ALIASES, LWEC_BR, NERVE_CAPS, CERVICAL_RANKS, LUMBAR_RANKS,
    DAYS_MULTIPLIER,
    // lookups + helpers
    lookupMax, lookupMin, maxRateForDOA, minRateForDOA, findSLUPart,
    applyRateBounds, isAwwBelowMin, getCappedTT, lwecBracket, weeksBetween, roundWeeksDown,
    // calculators
    computeAWW, computeSLU, computeLWEC, ccpPeriodRate, computeCCP, computeBurns, computeSettlement,
    nerveCap, clampNerveScores, radRank,
  };
});
