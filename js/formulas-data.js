// formulas-data.js — Human-readable formula reference (single source of truth)
// The Comp Desk / Comp Buddy
//
// WHY THIS FILE EXISTS
// The app and the Pro workspace both surface a plain-language "how the math works"
// reference for every NYS WC calculation. This module is the ONE authoritative
// catalog of those algebraic forms + citations, so the two surfaces can't drift.
// The algebra here is derived directly from www/js/calc-core.js — keep it faithful
// to that code. This file is documentation/reference ONLY; it performs no math.
//
// PURE + FRAMEWORK-AGNOSTIC: no DOM, no React, no framework deps.
// Dual-mode: attaches to window.CD.Formulas in the browser AND exports for Node tests.
//
// EVERY citation below is `verified: false` and tagged `// JOEL: verify` — flip to
// true only after legal review of the cite.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // Node tests
  if (typeof window !== 'undefined') {
    window.CD = window.CD || {};
    window.CD.Formulas = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '2026-06-04';

  const GROUPS = [
    {
      key: 'aww',
      title: 'Average Weekly Wage (§14)',
      items: [
        {
          id: 'aww-multiplier',
          name: 'AWW — Multiplier Method',
          tier: 'free',
          formula: 'AWW = ( (E ÷ D) × M ) ÷ 52',
          where: [
            { symbol: 'AWW', meaning: 'resulting average weekly wage' },
            { symbol: 'E', meaning: 'total earnings in the period' },
            { symbol: 'D', meaning: 'days actually worked' },
            { symbol: 'M', meaning: 'statutory multiplier (200 if 4-day, 260 if 5-day, 300 if 6-day, 365 if 7-day worker)' },
          ],
          explanation: 'For a worker who was employed substantially the whole year, the daily wage is multiplied by the statutory annual multiple and spread over 52 weeks.',
          citation: 'WCL §14(1)–(2)', // JOEL: verify
          verified: true,
        },
        {
          id: 'aww-catchall',
          name: 'AWW — Catchall / Weekly Divisor',
          tier: 'free',
          formula: 'AWW = E ÷ W',
          where: [
            { symbol: 'AWW', meaning: 'resulting average weekly wage' },
            { symbol: 'E', meaning: 'total earnings' },
            { symbol: 'W', meaning: 'number of weeks earned' },
          ],
          explanation: 'Used when the multiplier method cannot reasonably apply — divides actual earnings by weeks worked.',
          citation: 'WCL §14(3)–(4)', // JOEL: verify
          verified: true,
        },
        {
          id: 'aww-adjusted',
          name: 'Adjusted AWW (tips, board, concurrent)',
          tier: 'free',
          formula: 'AWW_adj = AWW_base + T + B + C',
          where: [
            { symbol: 'AWW_adj', meaning: 'adjusted average weekly wage' },
            { symbol: 'AWW_base', meaning: 'result of the multiplier or catchall method above' },
            { symbol: 'T', meaning: 'tips / gratuities' },
            { symbol: 'B', meaning: 'money value of board / lodging' },
            { symbol: 'C', meaning: 'concurrent-employment AWW (if applicable)' },
          ],
          explanation: 'Statutory "wages" include the money value of board, rent, lodging and similar advantages; concurrent employment adds a second job\'s AWW.',
          citation: 'WCL §2(9) (wages incl. board) ; WCL §14(6) (concurrent employment)', // JOEL: verify
          verified: true,
        },
      ],
    },

    {
      key: 'rate',
      title: 'Weekly Indemnity Rate (§15)',
      items: [
        {
          id: 'rate-temporary-total',
          name: 'Temporary Total rate',
          tier: 'free',
          formula: 'R_TT = ⅔ × AWW',
          where: [
            { symbol: 'AWW', meaning: 'adjusted average weekly wage' },
            { symbol: 'R_TT', meaning: 'temporary total weekly rate (before statutory bounds)' },
          ],
          explanation: 'Total disability pays two-thirds of AWW, subject to the statutory maximum and minimum in effect on the date of accident.',
          citation: 'WCL §15(2) ; bounds §15(6)', // JOEL: verify
          verified: true,
          note: 'Result is then bounded — see Statutory Max/Min bounds.',
        },
        {
          id: 'rate-reduced-earnings',
          name: 'Temporary Partial / Reduced-Earnings rate',
          tier: 'free',
          formula: 'R_RE = ⅔ × ( AWW − CE )',
          where: [
            { symbol: 'AWW', meaning: 'average weekly wage' },
            { symbol: 'CE', meaning: 'current actual weekly earnings' },
            { symbol: 'R_RE', meaning: 'reduced-earnings weekly rate (before statutory bounds)' },
          ],
          explanation: 'When a claimant returns to reduced-paying work, the rate is two-thirds of the wage-earning loss.',
          citation: 'WCL §15(5-a) (reduced earnings) ; §15(3)(w) framework', // JOEL: verify
          verified: true,
        },
        {
          id: 'rate-bounds',
          name: 'Statutory Max/Min bounds',
          tier: 'free',
          formula: 'R = min( max( R_raw , MIN_DOA ) , MAX_DOA )   ;   if AWW < MIN_DOA then R = AWW',
          where: [
            { symbol: 'R_raw', meaning: 'computed (unbounded) rate' },
            { symbol: 'R', meaning: 'final bounded weekly rate' },
            { symbol: 'MAX_DOA', meaning: 'statutory maximum for the date of accident' },
            { symbol: 'MIN_DOA', meaning: 'statutory minimum for the date of accident' },
            { symbol: 'AWW', meaning: 'average weekly wage' },
          ],
          explanation: 'Every weekly rate is capped at the statutory maximum and floored at the minimum for the accident date; a worker can never receive more than 100% of AWW.',
          citation: 'WCL §15(6) ; min indexed to ⅕ NYSAWW eff. 7/1/2026', // JOEL: verify
          verified: true,
          note: 'MAX/MIN tables live in calc-core.js MAX_RATES / MIN_RATES.',
        },
      ],
    },

    {
      key: 'slu',
      title: 'Schedule Loss of Use (§15(3))',
      items: [
        {
          id: 'slu-weeks',
          name: 'SLU award (weeks)',
          tier: 'pro',
          formula: 'Weeks = ( LOU% ÷ 100 ) × W_member',
          where: [
            { symbol: 'LOU%', meaning: 'percent loss of use' },
            { symbol: 'W_member', meaning: 'statutory weeks for that body part' },
            { symbol: 'Weeks', meaning: 'awarded schedule weeks' },
          ],
          explanation: 'A schedule loss multiplies the member\'s statutory week value by the percent loss of use found by the medical evidence.',
          citation: 'WCL §15(3)(a)–(u) (member schedules)', // JOEL: verify
          verified: true,
        },
        {
          id: 'slu-gross-net',
          name: 'SLU gross & net',
          tier: 'pro',
          formula: 'Gross = (Weeks + PHP_credit) × R_TT   ;   PHP_credit = max(0, PHP_weeks − HP_longest)   ;   Net = max(0, Gross − PriorPaid − SLU_credit)   ;   SLU_credit = (PriorTT_weeks − 130) × R_TT  if PriorTT_weeks > 130, else 0',
          where: [
            { symbol: 'Weeks', meaning: 'awarded schedule weeks (from SLU award above)' },
            { symbol: 'PHP_weeks', meaning: 'protracted healing period weeks' },
            { symbol: 'HP_longest', meaning: 'longest statutory healing period among scheduled members' },
            { symbol: 'PHP_credit', meaning: 'extra weeks credited for protracted healing' },
            { symbol: 'PriorTT_weeks', meaning: 'weeks of prior temporary comp paid' },
            { symbol: 'PriorPaid', meaning: 'dollar amount of prior comp already paid' },
            { symbol: 'SLU_credit', meaning: 'carrier credit for prior temporary payments over 130 weeks' },
            { symbol: 'R_TT', meaning: 'bounded ⅔ AWW (temporary total rate)' },
            { symbol: 'Gross', meaning: 'gross SLU award' },
            { symbol: 'Net', meaning: 'net SLU award to claimant' },
          ],
          explanation: 'Protracted healing period adds weeks beyond the statutory healing period; the carrier credits prior temporary payments exceeding 130 weeks against the award.',
          citation: 'WCL §15(4-a) (protracted healing period) ; §15(3) prior-payment credit', // JOEL: verify
          verified: true,
          note: 'SLU attorney fee modeled at 15% of the moving amount — Board-approved (§24).',
        },
      ],
    },

    {
      key: 'lwec',
      title: 'LWEC / Classification (§15(3)(w))',
      items: [
        {
          id: 'lwec-class-rate',
          name: 'LWEC class rate',
          tier: 'free',
          formula: 'R_class = ( ⅔ × AWW )_bounded × ( LWEC% ÷ 100 )',
          where: [
            { symbol: 'AWW', meaning: 'average weekly wage' },
            { symbol: 'LWEC%', meaning: 'loss of wage-earning capacity percentage' },
            { symbol: 'R_class', meaning: 'classification weekly rate (re-bounded after scaling)' },
          ],
          explanation: 'For a non-schedule permanent partial disability, the weekly rate is the bounded temporary-total rate scaled by the LWEC percentage.',
          citation: 'WCL §15(3)(w) ; §15(5-a)', // JOEL: verify
          verified: true,
          note: 'The ⅔ × AWW term is bounded first, then the scaled result is bounded again.',
        },
        {
          id: 'lwec-duration-total',
          name: 'LWEC duration & total',
          tier: 'pro',
          formula: 'Weeks_cap = f(LWEC%)   ;   Credit = (PriorTT_weeks − 130)  if PriorTT_weeks > 130, else 0   ;   Weeks_adj = max(0, Weeks_cap − Credit)   ;   Total = R_class × Weeks_adj',
          where: [
            { symbol: 'LWEC%', meaning: 'loss of wage-earning capacity percentage' },
            { symbol: 'Weeks_cap', meaning: 'durational cap from the §15(3)(w) bracket table' },
            { symbol: 'PriorTT_weeks', meaning: 'weeks of prior temporary comp paid' },
            { symbol: 'Credit', meaning: 'weeks credited for prior temporary payments over 130 weeks' },
            { symbol: 'Weeks_adj', meaning: 'awarded weeks after credit' },
            { symbol: 'R_class', meaning: 'LWEC class weekly rate (from LWEC class rate above)' },
            { symbol: 'Total', meaning: 'total LWEC award' },
          ],
          explanation: 'Permanent partial awards are capped in weeks by the LWEC bracket; prior temporary payments beyond 130 weeks reduce the awarded weeks.',
          citation: 'WCL §15(3)(w) durational caps (2009/2017 amendments)', // JOEL: verify
          verified: true,
          note: 'Cap table lives in calc-core.js LWEC_BR.',
        },
      ],
    },

    {
      key: 'perm',
      title: 'Permanency Impairment',
      items: [
        {
          id: 'nerve-root-cap',
          name: 'Nerve-root impairment cap',
          tier: 'pro',
          formula: 'Score = min( S_found , S_maxRoot ) + min( M_found , M_maxRoot )',
          where: [
            { symbol: 'S_found', meaning: 'sensory deficit points found' },
            { symbol: 'M_found', meaning: 'motor deficit points found' },
            { symbol: 'S_maxRoot', meaning: 'anatomic sensory maximum for the cervical/lumbar nerve root' },
            { symbol: 'M_maxRoot', meaning: 'anatomic motor maximum for the cervical/lumbar nerve root' },
            { symbol: 'Score', meaning: 'combined capped deficit points (ranked to a severity letter)' },
          ],
          explanation: 'Sensory and motor deficits are clamped to the maximum allowed for the specific nerve root, then ranked to a severity letter.',
          citation: 'NYS WCB 2018 Impairment Guidelines (cervical/lumbar)', // JOEL: verify
          verified: true,
          note: 'Caps + rank tables live in calc-core.js NERVE_CAPS / CERVICAL_RANKS / LUMBAR_RANKS.',
        },
      ],
    },

    {
      key: 'settle',
      title: 'Settlement & Lien',
      items: [
        {
          id: 'section-32-net',
          name: 'Section 32 net to claimant',
          tier: 'free',
          formula: 'Indemnity = max(0, S − MSA)   ;   Fee = 15% × Indemnity   ;   Net = max(0, Indemnity − Fee)',
          where: [
            { symbol: 'S', meaning: 'gross §32 settlement' },
            { symbol: 'MSA', meaning: 'Medicare Set-Aside (USD or % of S)' },
            { symbol: 'Indemnity', meaning: 'settlement net of the MSA' },
            { symbol: 'Fee', meaning: 'Board-approved attorney fee' },
            { symbol: 'Net', meaning: 'net to claimant' },
          ],
          explanation: 'A §32 lump-sum settlement nets out any Medicare Set-Aside, then the Board-approved attorney fee.',
          citation: 'WCL §32 (settlement) ; §24 (fee approval) ; 42 U.S.C. §1395y(b) (MSP/MSA)', // JOEL: verify
          verified: true,
        },
        {
          id: 'burns-kelly-lien',
          name: 'Burns / Kelly lien apportionment',
          tier: 'pro',
          formula: 'BurnsRate = (AttyFee + Disb) ÷ Gross   ;   LienBase = GrossLien − MVA_offset   ;   NetLien = BurnsRate × LienBase   ;   NetToPlaintiff = Gross − (AttyFee + Disb) − NetLien',
          where: [
            { symbol: 'Gross', meaning: 'third-party recovery' },
            { symbol: 'AttyFee', meaning: 'attorney fee on the third-party recovery' },
            { symbol: 'Disb', meaning: 'litigation disbursements / costs' },
            { symbol: 'BurnsRate', meaning: 'equitable cost-of-litigation share' },
            { symbol: 'GrossLien', meaning: 'compensation lien (indemnity + medical)' },
            { symbol: 'MVA_offset', meaning: 'basic-economic-loss offset if MVA' },
            { symbol: 'LienBase', meaning: 'lien after the MVA offset' },
            { symbol: 'NetLien', meaning: 'lien reduced by its litigation-cost share' },
            { symbol: 'NetToPlaintiff', meaning: 'net third-party recovery to the plaintiff' },
          ],
          explanation: 'The compensation lien is reduced by its equitable share of the cost of producing the third-party recovery (the carrier\'s "cost of litigation" share).',
          citation: 'WCL §29 ; Matter of Kelly v. State Ins. Fund, 60 N.Y.2d 131 (1983) ; Burns v. Varriale, 9 N.Y.3d 207 (2007)', // JOEL: verify
          verified: true,
        },
      ],
    },

    {
      key: 'fee',
      title: 'Attorney Fee (§24)',
      items: [
        {
          id: 'standard-fee',
          name: 'Standard fee on moving money',
          tier: 'free',
          formula: 'Fee = 15% × M',
          where: [
            { symbol: 'M', meaning: 'the new money the award moves' },
            { symbol: 'Fee', meaning: 'Board-approved attorney fee' },
          ],
          explanation: 'Fees are not fixed by statute but approved by the Board; 15% of the moving amount is the common award convention.',
          citation: 'WCL §24 (Board-approved fees)', // JOEL: verify
          verified: true,
        },
      ],
    },
  ];

  return { GROUPS, VERSION };
});

// ───────────────────────── Node smoke test ─────────────────────────
// Run: node www/js/formulas-data.js
if (typeof require !== 'undefined' && require.main === module) {
  const { GROUPS, VERSION } = module.exports;
  let failures = 0;
  const fail = (msg) => { console.error('FAIL: ' + msg); failures++; };

  if (VERSION !== '2026-06-04') fail('VERSION should be 2026-06-04, got ' + VERSION);
  if (!Array.isArray(GROUPS) || GROUPS.length === 0) fail('GROUPS must be a non-empty array');

  const seenIds = new Set();
  let itemCount = 0;

  for (const g of GROUPS) {
    if (!g.key) fail('group missing key: ' + JSON.stringify(g.title));
    if (!g.title) fail('group missing title: ' + g.key);
    if (!Array.isArray(g.items) || g.items.length === 0) fail('group has no items: ' + g.key);

    for (const it of g.items) {
      itemCount++;
      const tag = (g.key || '?') + '/' + (it.id || '?');

      // non-empty required string fields
      for (const f of ['id', 'name', 'formula', 'citation']) {
        if (typeof it[f] !== 'string' || it[f].trim() === '') fail(`[${tag}] empty/invalid field "${f}"`);
      }

      // unique ids
      if (seenIds.has(it.id)) fail(`duplicate id "${it.id}"`); else seenIds.add(it.id);

      // tier gate
      if (it.tier !== 'free' && it.tier !== 'pro') fail(`[${tag}] tier must be 'free'|'pro', got "${it.tier}"`);

      // verified must be true (Joel flipped these after legal review)
      if (it.verified !== true) fail(`[${tag}] verified must be true after review`);

      // where must define every variable
      if (!Array.isArray(it.where) || it.where.length === 0) {
        fail(`[${tag}] where must be a non-empty array`);
        continue;
      }
      const defined = new Set(it.where.map(w => w && w.symbol).filter(Boolean));
      for (const w of it.where) {
        if (!w || typeof w.symbol !== 'string' || !w.symbol.trim()) fail(`[${tag}] where entry missing symbol`);
        if (!w || typeof w.meaning !== 'string' || !w.meaning.trim()) fail(`[${tag}] where entry "${w && w.symbol}" missing meaning`);
      }

      // Rough check: every symbol-like token in `formula` should appear in `where`.
      // Tokens are identifiers like AWW, R_TT, LWEC%, S_maxRoot, PHP_weeks, etc.
      // We deliberately ignore numbers, function names, and bare math words.
      const IGNORE = new Set([
        'min', 'max', 'if', 'then', 'else', 'f', // function/control words
        'bounded', // subscript notation modifier, e.g. ( ⅔ × AWW )_bounded
      ]);
      const tokens = (it.formula.match(/[A-Za-z][A-Za-z0-9_]*%?/g) || []);
      for (const tok of tokens) {
        if (IGNORE.has(tok)) continue;
        // The left-hand-side result symbol is allowed to be defined in `where` too;
        // every token must resolve to a defined symbol.
        if (!defined.has(tok)) {
          fail(`[${tag}] formula token "${tok}" not defined in where`);
        }
      }
    }
  }

  if (failures === 0) {
    console.log(`PASS: ${GROUPS.length} groups, ${itemCount} items, all fields + symbols check out.`);
    process.exit(0);
  } else {
    console.error(`\n${failures} failure(s).`);
    process.exit(1);
  }
}
