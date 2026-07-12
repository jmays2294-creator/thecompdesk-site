/* ===========================================================================
 * SLU ROM → %SLU engine — THE canonical implementation (2018 NY Impairment
 * Guidelines, eff. 1/1/2018). One source of truth for every surface:
 *   - Pro workspace SLURom tile (www/js/workspace/constants.js imports this
 *     into the webpack bundle; tiles.js reads window.romToSLU)
 *   - App SLU tab (www/js/ui-controller.js renderSLUCheck; loaded as a
 *     classic <script> from www/index.html)
 *   - Website workspace (ops/website/js/calc-core/slu-rom.js — byte-identical
 *     copy, loaded by workspace.html before constants.js)
 *   - ops/secretary/fee_calc_6.1/slu-rom-engine.js (thin CJS re-export)
 *
 * DO NOT fork this file per surface. Regression contract:
 *   node ops/dev/qa/slu_guidelines_fixtures.mjs
 * must be green before any commit touching this file ships (see the
 * slu-guidelines-regression skill). Fixtures are the Board's own worked
 * examples — a red fixture means a wrong number on a filed C-4.3A.
 *
 * Rewritten 2026-07-12 against ops/dev/audits/slu_rom_engine_audit_2026-07-12.md:
 *   - *Low columns wired: single-motion deficit → lower figure, both motions →
 *     higher figure (§2.4(B), §2.5(B), Table 3.4 note, Tables 9.4(A)/9.5(A)(1);
 *     Board deck slides 60-61). Pairing is per-chapter: flexion/extension for
 *     digits and toes, pronation/supination for wrist row C, abduction/adduction
 *     and internal/external rotation for hip rows A/B.
 *   - Shoulder adduction, shoulder posterior extension, hip posterior extension
 *     are flat 7½-10% notes (Table 5.4(a) notes; Table 6.4 note) — the 999
 *     sentinel rows that silently scored 0% are gone.
 *   - Ankylosis caps on every site (§1.3(7); per-table headers), with the four
 *     express exceptions (§8.5(3) ankle fusion 75%, §8.5(4) foot drop,
 *     §3.5/3.6 wrist drop, §2.5(C)(5) Dupuytren's) bypassing the cap.
 *   - Special considerations carry mode 'add' | 'standalone'.
 *   - Shoulder: Forward Flexion and Abduction are separate inputs; greater
 *     deficit governs (never summed); +10% only when BOTH are moderate-or-higher
 *     AND within 10° (Table 5.4(a) note; Board Case Study #1). Rotation adds
 *     10-15% only for marked rotation WITH muscle atrophy; Table 5.4(b) is a
 *     stand-alone track for isolated rotation injuries (incl. Complete Loss 30%).
 *   - Joint replacement (Tables 5.5/6.5/7.5) is a stand-alone scoring track —
 *     sluReplacement() — base 35%, columns scored independently ("the value
 *     that most closely matches the deficit in each column"), max 80%.
 *     Failed replacements are NOT schedulable (§1.6 item 12).
 *   - Contralateral baseline scaling (§1.3(3)(b); Board Quiz #2).
 *   - No 0.5% rounding: ⅓/⅔ carried exactly, display rounded to 2 decimals.
 *
 * Severity classification ("mild/moderate/marked") follows the Board deck
 * slide 70 ("25% loss = mild; 50% = moderate; 75% = marked"): a measurement is
 * classed by the NEAREST table anchor. That is how the Board's own Case Study
 * #1 classes abduction 100° (of 180°) as moderate.
 * =========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && typeof root === 'object') {
    Object.assign(root, {
      romToSLU: api.romToSLU,
      romJointPct: api.romJointPct,
      romJointsFor: api.romJointsFor,
      sluReplacement: api.sluReplacement,
      SLU_ROM_JOINTS: api.SLU_ROM_JOINTS,
      SLU_ROM_SPECIAL: api.SLU_ROM_SPECIAL,
      SLU_SITE_CAPS: api.SLU_SITE_CAPS,
      SLU_REPLACEMENT_TABLES: api.SLU_REPLACEMENT_TABLES,
    });
    root.CD = root.CD || {};
    root.CD.SLURom = api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  'use strict';

  // -------------------------------------------------------------------------
  // ROM tables — every anchor verified against the cited source table.
  //   normalROM / mildThresh / modThresh / markedThresh: degree anchors.
  //   *Low / *High: the range printed in the cell (lower figure = single
  //   motion deficit, higher = both — where `pair` is set).
  //   pair: 'flexExt' (digits/toes: the same joint's extension), 'pronSup'
  //   (wrist row C), 'hipAA' / 'hipRot' (sibling-row pairs resolved in the
  //   combine step).
  //   flat: [lo, hi] — a flat note value for ANY deficit (no degree bands).
  //   completeLoss: cited complete-loss value at ROM 0 (interpolated from the
  //   marked anchor down; Table 3.4 notes, Table 5.4(b), Table 8.4(c)).
  //   grade: CMC opposition is graded 1/2/3 by which finger's MCP the thumb
  //   tip reaches (§2.4(A)(3)) — NOT degrees.
  //   extrapolated: value bands the Guidelines do NOT contain (kept for
  //   continuity, surfaced as warnings — audit item 1.10).
  // -------------------------------------------------------------------------
  var SLU_ROM_JOINTS = [
    // Ch. 2 — Thumb (Table 2.4(B); pair rule §2.4(B))
    { bodyPart: 'Thumb', joint: 'IP',  normalROM: 80, mildThresh: 60, mildLow: 10, mildHigh: 15, modThresh: 40, modLow: 20, modHigh: 25, markedThresh: 25, markedLow: 40, markedHigh: 45, memberType: 'Thumb', jointOrder: 1, pair: 'flexExt' },
    { bodyPart: 'Thumb', joint: 'MCP', normalROM: 60, mildThresh: 45, mildLow: 15, mildHigh: 20, modThresh: 30, modLow: 25, modHigh: 30, markedThresh: 15, markedLow: 45, markedHigh: 50, memberType: 'Thumb', jointOrder: 2, pair: 'flexExt' },
    // CMC opposition grade (§2.4(A)(3), Table 2.4(B) row C): 1 = tip reaches
    // 3rd (ring) finger MCP, 2 = reaches 2nd, 3 = reaches 1st only.
    { bodyPart: 'Thumb', joint: 'CMC', normalROM: 0, mildThresh: 1, mildLow: 20, mildHigh: 25, modThresh: 2, modLow: 30, modHigh: 40, markedThresh: 3, markedLow: 50, markedHigh: 90, memberType: 'Thumb', jointOrder: 3,
      grade: true, gradeLabels: ['1 — tip reaches ring-finger MCP', '2 — tip reaches middle-finger MCP', '3 — tip reaches index MCP only'] },
    // Ch. 2 — Finger (Table 2.5(B); pair rule §2.5(B), Board deck slide 61)
    { bodyPart: 'Finger', joint: 'DIP', normalROM: 90,  mildThresh: 75, mildLow: 10, mildHigh: 15, modThresh: 45, modLow: 20, modHigh: 25, markedThresh: 25, markedLow: 40, markedHigh: 45, memberType: 'Finger', jointOrder: 1, pair: 'flexExt' },
    { bodyPart: 'Finger', joint: 'PIP', normalROM: 100, mildThresh: 75, mildLow: 15, mildHigh: 20, modThresh: 45, modLow: 25, modHigh: 30, markedThresh: 25, markedLow: 45, markedHigh: 50, memberType: 'Finger', jointOrder: 2, pair: 'flexExt' },
    { bodyPart: 'Finger', joint: 'MCP', normalROM: 90,  mildThresh: 75, mildLow: 20, mildHigh: 25, modThresh: 45, modLow: 30, modHigh: 40, markedThresh: 25, markedLow: 50, markedHigh: 90, memberType: 'Finger', jointOrder: 3, pair: 'flexExt' },
    // Ch. 3 — Wrist (Table 3.4; complete-loss values from §3.4 notes)
    { bodyPart: 'Wrist', joint: 'Palmar Flex', normalROM: 80, mildThresh: 60, mildLow: 7.5, mildHigh: 7.5, modThresh: 40, modLow: 12.5, modHigh: 12.5, markedThresh: 20, markedLow: 20, markedHigh: 20, memberType: 'Hand', jointOrder: 1, completeLoss: 25 },
    { bodyPart: 'Wrist', joint: 'Dorsi Flex',  normalROM: 70, mildThresh: 60, mildLow: 7.5, mildHigh: 7.5, modThresh: 35, modLow: 15,   modHigh: 15,   markedThresh: 20, markedLow: 25, markedHigh: 25, memberType: 'Hand', jointOrder: 2, completeLoss: 33.33 },
    // Row C: the asterisked pair is pronation / supination (Table 3.4 note).
    { bodyPart: 'Wrist', joint: 'Pron/Sup', normalROM: 90, mildThresh: 75, mildLow: 7.5, mildHigh: 10, modThresh: 45, modLow: 17.5, modHigh: 20, markedThresh: 25, markedLow: 25, markedHigh: 30, memberType: 'Hand', jointOrder: 3, pair: 'pronSup', completeLoss: 35, completeNeedsBoth: true },
    // Ch. 4 — Elbow (Table 4.4). Extension is a contracture angle (reversed
    // scale). No pronation/supination row here — that is wrist Table 3.4 row C.
    { bodyPart: 'Elbow', joint: 'Extension', normalROM: 0,   mildThresh: 45,  mildLow: 25,   mildHigh: 25,   modThresh: 90, modLow: 50,    modHigh: 50,    markedThresh: 125, markedLow: 85,    markedHigh: 85,    memberType: 'Arm', jointOrder: 1 },
    { bodyPart: 'Elbow', joint: 'Flexion',   normalROM: 150, mildThresh: 125, mildLow: 7.5,  mildHigh: 7.5,  modThresh: 90, modLow: 33.33, modHigh: 33.33, markedThresh: 45,  markedLow: 66.67, markedHigh: 66.67, memberType: 'Arm', jointOrder: 2 },
    // Ch. 5 — Shoulder (Table 5.4(a) is ONE row "Flexion/Abduction ROM 0-180°
    // (use greater deficit)": both motions score on the same scale and the
    // GREATER deficit governs — split into two inputs so the +10% note can see
    // both measurements. Never summed (see _combine).
    { bodyPart: 'Shoulder', joint: 'Forward Flexion', normalROM: 180, mildThresh: 135, mildLow: 20, mildHigh: 20, modThresh: 90, modLow: 40, modHigh: 40, markedThresh: 45, markedLow: 60, markedHigh: 60, memberType: 'Arm', jointOrder: 1 },
    { bodyPart: 'Shoulder', joint: 'Abduction',       normalROM: 180, mildThresh: 135, mildLow: 20, mildHigh: 20, modThresh: 90, modLow: 40, modHigh: 40, markedThresh: 45, markedLow: 60, markedHigh: 60, memberType: 'Arm', jointOrder: 2 },
    // Table 5.4(b) rows (isolated-rotation track; Complete Loss column = 15%).
    { bodyPart: 'Shoulder', joint: 'Int Rotation', normalROM: 70, mildThresh: 55, mildLow: 7.5, mildHigh: 7.5, modThresh: 35, modLow: 10, modHigh: 10, markedThresh: 20, markedLow: 12.5, markedHigh: 12.5, memberType: 'Arm', jointOrder: 3, completeLoss: 15 },
    { bodyPart: 'Shoulder', joint: 'Ext Rotation', normalROM: 90, mildThresh: 75, mildLow: 7.5, mildHigh: 7.5, modThresh: 45, modLow: 10, modHigh: 10, markedThresh: 25, markedLow: 12.5, markedHigh: 12.5, memberType: 'Arm', jointOrder: 4, completeLoss: 15 },
    // Table 5.4(a) notes: flat 7½-10% for ANY deficit — no degree bands exist.
    { bodyPart: 'Shoulder', joint: 'Adduction',      normalROM: 30, flat: [7.5, 10], memberType: 'Arm', jointOrder: 5 },
    { bodyPart: 'Shoulder', joint: 'Post Extension', normalROM: 60, flat: [7.5, 10], memberType: 'Arm', jointOrder: 6 },
    // Ch. 6 — Hip (Table 6.4). Asterisked pairs: abduction/adduction (hipAA)
    // and internal/external rotation (hipRot) — NOT flexion/extension.
    { bodyPart: 'Hip', joint: 'Abduction',    normalROM: 45, mildThresh: 35, mildLow: 7.5, mildHigh: 10, modThresh: 25, modLow: 15, modHigh: 17.5, markedThresh: 15, markedLow: 20, markedHigh: 25, memberType: 'Leg', jointOrder: 1, pair: 'hipAA' },
    { bodyPart: 'Hip', joint: 'Adduction',    normalROM: 35, mildThresh: 25, mildLow: 7.5, mildHigh: 10, modThresh: 20, modLow: 15, modHigh: 17.5, markedThresh: 10, markedLow: 20, markedHigh: 25, memberType: 'Leg', jointOrder: 2, pair: 'hipAA' },
    { bodyPart: 'Hip', joint: 'Int Rotation', normalROM: 45, mildThresh: 35, mildLow: 7.5, mildHigh: 10, modThresh: 25, modLow: 10, modHigh: 15,   markedThresh: 15, markedLow: 20, markedHigh: 25, memberType: 'Leg', jointOrder: 3, pair: 'hipRot' },
    { bodyPart: 'Hip', joint: 'Ext Rotation', normalROM: 45, mildThresh: 35, mildLow: 7.5, mildHigh: 10, modThresh: 25, modLow: 10, modHigh: 15,   markedThresh: 15, markedLow: 20, markedHigh: 25, memberType: 'Leg', jointOrder: 4, pair: 'hipRot' },
    { bodyPart: 'Hip', joint: 'Flexion',      normalROM: 120, mildThresh: 90, mildLow: 10, mildHigh: 10, modThresh: 45, modLow: 33.33, modHigh: 33.33, markedThresh: 25, markedLow: 66.67, markedHigh: 66.67, memberType: 'Leg', jointOrder: 5 },
    // Table 6.4 note: "Deficits in posterior extension equals 7½-10% loss of
    // use of the leg" — flat, monotonic by construction (audit P1-4).
    { bodyPart: 'Hip', joint: 'Post Extension', normalROM: 30, flat: [7.5, 10], memberType: 'Leg', jointOrder: 6 },
    // Ch. 7 — Knee (Table 7.4, "select one"). The extension row's moderate and
    // marked cells are BLANK in the source — the 15-20 / 25-35 values are
    // extrapolations kept for continuity and flagged (audit 1.10).
    { bodyPart: 'Knee', joint: 'Flexion',   normalROM: 140, mildThresh: 120, mildLow: 10,  mildHigh: 10, modThresh: 90, modLow: 40, modHigh: 40, markedThresh: 45, markedLow: 55, markedHigh: 55, memberType: 'Leg', jointOrder: 1 },
    { bodyPart: 'Knee', joint: 'Extension', normalROM: 0,   mildThresh: 10,  mildLow: 7.5, mildHigh: 10, modThresh: 20, modLow: 15, modHigh: 20, markedThresh: 30, markedLow: 25, markedHigh: 35, memberType: 'Leg', jointOrder: 2, extrapolatedBeyondMild: true },
    // Ch. 8 — Ankle/Foot (Tables 8.4(a)-(c)). Inversion/eversion DEGREE anchors
    // are extrapolations — Table 8.4(a) has no inv/ev degree rows; only the
    // combined band values of 8.4(b) are sourced (audit 1.10). Complete-loss
    // values from Table 8.4(c).
    { bodyPart: 'Ankle/Foot', joint: 'Plantar Flex', normalROM: 40, mildThresh: 30,   mildLow: 7.5, mildHigh: 7.5, modThresh: 20,  modLow: 15,   modHigh: 15,   markedThresh: 10, markedLow: 25,   markedHigh: 25,   memberType: 'Foot', jointOrder: 1, completeLoss: 35 },
    { bodyPart: 'Ankle/Foot', joint: 'Dorsi Flex',   normalROM: 20, mildThresh: 12.5, mildLow: 7.5, mildHigh: 7.5, modThresh: 7.5, modLow: 15,   modHigh: 15,   markedThresh: 5,  markedLow: 25,   markedHigh: 25,   memberType: 'Foot', jointOrder: 2, completeLoss: 35 },
    { bodyPart: 'Ankle/Foot', joint: 'Inversion',    normalROM: 35, mildThresh: 30,   mildLow: 7.5, mildHigh: 7.5, modThresh: 20,  modLow: 12.5, modHigh: 12.5, markedThresh: 10, markedLow: 17.5, markedHigh: 17.5, memberType: 'Foot', jointOrder: 3, completeLoss: 20, extrapolatedAnchors: true },
    { bodyPart: 'Ankle/Foot', joint: 'Eversion',     normalROM: 15, mildThresh: 12,   mildLow: 7.5, mildHigh: 7.5, modThresh: 8,   modLow: 12.5, modHigh: 12.5, markedThresh: 4,  markedLow: 17.5, markedHigh: 17.5, memberType: 'Foot', jointOrder: 4, completeLoss: 10, extrapolatedAnchors: true },
    // Ch. 9 — Great toe (Table 9.4(A)) and lesser toes (Table 9.5(A)(1)).
    // Pair rule (flexion/extension) per the tables' asterisk notes; the great
    // toe MTP pair is the two MTP rows (resolved in _combine).
    { bodyPart: 'Great Toe', joint: 'IP',       normalROM: 90, mildThresh: 75, mildLow: 10, mildHigh: 15, modThresh: 45, modLow: 20, modHigh: 25, markedThresh: 25, markedLow: 40, markedHigh: 45, memberType: 'Great Toe', jointOrder: 1, pair: 'flexExt' },
    { bodyPart: 'Great Toe', joint: 'MTP Flex', normalROM: 45, mildThresh: 35, mildLow: 15, mildHigh: 20, modThresh: 25, modLow: 25, modHigh: 30, markedThresh: 15, markedLow: 45, markedHigh: 50, memberType: 'Great Toe', jointOrder: 2, pair: 'mtpFE' },
    { bodyPart: 'Great Toe', joint: 'MTP Ext',  normalROM: 70, mildThresh: 55, mildLow: 15, mildHigh: 20, modThresh: 35, modLow: 25, modHigh: 30, markedThresh: 20, markedLow: 45, markedHigh: 50, memberType: 'Great Toe', jointOrder: 3, pair: 'mtpFE' },
    { bodyPart: 'Smaller Toes', joint: 'DIP', normalROM: 90,  mildThresh: 75, mildLow: 10, mildHigh: 15, modThresh: 45, modLow: 20, modHigh: 25, markedThresh: 25, markedLow: 40, markedHigh: 45, memberType: 'Toe', jointOrder: 1, pair: 'flexExt' },
    { bodyPart: 'Smaller Toes', joint: 'PIP', normalROM: 100, mildThresh: 75, mildLow: 15, mildHigh: 20, modThresh: 45, modLow: 25, modHigh: 30, markedThresh: 25, markedLow: 45, markedHigh: 50, memberType: 'Toe', jointOrder: 2, pair: 'flexExt' },
    { bodyPart: 'Smaller Toes', joint: 'MTP', normalROM: 90,  mildThresh: 75, mildLow: 20, mildHigh: 25, modThresh: 45, modLow: 30, modHigh: 40, markedThresh: 25, markedLow: 50, markedHigh: 90, memberType: 'Toe', jointOrder: 3, pair: 'flexExt' },
  ];

  // -------------------------------------------------------------------------
  // Ankylosis caps per site — §1.3(7) ("the total value of several range of
  // motion deficits should not exceed the value of full ankylosis of the
  // joint") + per-table values. Express exceptions bypass via bypassCap below.
  // -------------------------------------------------------------------------
  var SLU_SITE_CAPS = {
    'Thumb': 100,        // §2.4(C)(1): CMC ankylosis = 100% of thumb
    'Finger': 100,       // Table 2.5(B): "Ankylosis of multiple joints cannot exceed 100%"
    'Wrist': 55,         // Table 3.4 header: marked in all motions cannot exceed 55%
    'Elbow': 90,         // Table 4.4: ankylosis at 0° (full extension) = 90% of arm
    'Shoulder': 80,      // Table 5.4(a): ankylosis at 0° = 80% of arm
    'Hip': 80,           // Table 6.4: ankylosis = 80% of leg
    'Knee': 70,          // Table 7.4: ankylosis = 70% of leg
    'Ankle/Foot': 55,    // Table 8.4 header (marked-in-all 50-55%); ankylosis 60% — SC 3/4 bypass
    'Great Toe': 100,    // Table 9.4(A) ankylosis note
    'Smaller Toes': 100, // Table 9.5(A)(2) ankylosis note
  };

  // -------------------------------------------------------------------------
  // Special considerations. mode: 'add' (added to the ROM result) or
  // 'standalone' (REPLACES the ROM result — Board webinar: "Instructions have
  // clarified whether a condition ... is evaluated as a stand alone or as a
  // value that is added"). bypassCap marks the express cap exceptions.
  // Joint REPLACEMENT rows are intentionally absent: Tables 5.5/6.5/7.5 are a
  // separate scoring track — use sluReplacement().
  // -------------------------------------------------------------------------
  var SLU_ROM_SPECIAL = [
    { bodyPart: 'Thumb', consideration: 'None', low: 0, high: 0, mode: 'add' },
    { bodyPart: 'Thumb', consideration: 'Ankylosis CMC (100%)', low: 100, high: 100, mode: 'standalone' },        // §2.4(C)(1)
    { bodyPart: 'Thumb', consideration: 'Mild adduction (7.5%)', low: 7.5, high: 7.5, mode: 'standalone' },       // §2.4(C) note — "if no other deficits exist"
    { bodyPart: 'Thumb', consideration: 'Mild opposition (10%)', low: 10, high: 10, mode: 'standalone' },         // §2.4(C) note
    { bodyPart: 'Thumb', consideration: 'Mild radial abd (10%)', low: 10, high: 10, mode: 'standalone' },         // §2.4(C) note
    { bodyPart: 'Finger', consideration: 'None', low: 0, high: 0, mode: 'add' },
    { bodyPart: 'Finger', consideration: 'Mallet deformity (≤33⅓%)', low: 0, high: 33.33, mode: 'add' },          // §2.5(C)(1)
    { bodyPart: 'Finger', consideration: 'Trigger finger (≤33⅓%)', low: 0, high: 33.33, mode: 'add' },            // §2.5(C)(2)
    { bodyPart: 'Finger', consideration: 'Flail DIP (50%)', low: 50, high: 50, mode: 'add' },                     // §2.5(C)
    { bodyPart: 'Finger', consideration: 'Loss ≥½ distal phalanx (50%)', low: 50, high: 50, mode: 'add' },        // §2.5(C)
    { bodyPart: 'Finger', consideration: "Dupuytren's (5-7.5% hand)", low: 5, high: 7.5, mode: 'add', bypassCap: true }, // §2.5(C)(5): may exceed ankylosis of the finger
    { bodyPart: 'Wrist', consideration: 'None', low: 0, high: 0, mode: 'add' },
    { bodyPart: 'Wrist', consideration: 'Wrist drop/radial palsy (66⅔%)', low: 66.67, high: 66.67, mode: 'standalone', bypassCap: true }, // §3.5/3.6
    { bodyPart: 'Wrist', consideration: 'Partial wrist drop', low: 0, high: 66.67, mode: 'add', bypassCap: true },        // §3.5/3.6 ("less is given for partial")
    { bodyPart: 'Wrist', consideration: 'Darrach procedure (10%+)', low: 10, high: 10, mode: 'add' },
    { bodyPart: 'Wrist', consideration: 'Prox row resection (20%+)', low: 20, high: 20, mode: 'add' },
    { bodyPart: 'Wrist', consideration: 'CTS post-decompression (10-20%)', low: 10, high: 20, mode: 'add' },
    { bodyPart: 'Wrist', consideration: "De Quervain's (7.5-20%)", low: 7.5, high: 20, mode: 'add' },
    { bodyPart: 'Wrist', consideration: 'Ganglion (0-7.5%)', low: 0, high: 7.5, mode: 'add' },
    { bodyPart: 'Elbow', consideration: 'None', low: 0, high: 0, mode: 'add' },
    { bodyPart: 'Elbow', consideration: 'Loss head of radius (10%+)', low: 10, high: 10, mode: 'add' },
    { bodyPart: 'Elbow', consideration: 'Laxity/hyperextension (10-15%)', low: 10, high: 15, mode: 'add' },
    { bodyPart: 'Elbow', consideration: 'Olecranon excision (10%+)', low: 10, high: 10, mode: 'add' },
    { bodyPart: 'Shoulder', consideration: 'None', low: 0, high: 0, mode: 'add' },
    { bodyPart: 'Shoulder', consideration: 'Clavicle fracture (0-10%)', low: 0, high: 10, mode: 'add' },
    { bodyPart: 'Shoulder', consideration: 'AC/SC separation (7.5-10%)', low: 7.5, high: 10, mode: 'add' },
    { bodyPart: 'Shoulder', consideration: 'Winged scapula (15-20%)', low: 15, high: 20, mode: 'add' },
    { bodyPart: 'Shoulder', consideration: 'Clavicle resection end (10%)', low: 10, high: 10, mode: 'add' },
    { bodyPart: 'Shoulder', consideration: 'Clavicle resection entire (15%)', low: 15, high: 15, mode: 'add' },
    { bodyPart: 'Shoulder', consideration: 'Biceps rupture long head (10-15%)', low: 10, high: 15, mode: 'add' },
    { bodyPart: 'Shoulder', consideration: 'Biceps rupture distal (20%+)', low: 20, high: 33.33, mode: 'add' },
    { bodyPart: 'Hip', consideration: 'None', low: 0, high: 0, mode: 'add' },
    { bodyPart: 'Hip', consideration: 'Femur head/neck excision (50%+)', low: 50, high: 50, mode: 'add' },
    { bodyPart: 'Hip', consideration: 'Synovitis/bursitis (0-7.5%)', low: 0, high: 7.5, mode: 'add' },
    { bodyPart: 'Hip', consideration: 'Fractured pelvis (15-20%)', low: 15, high: 20, mode: 'add' },
    { bodyPart: 'Hip', consideration: 'Leg shortening ½" (5%)', low: 5, high: 5, mode: 'add' },
    { bodyPart: 'Hip', consideration: 'Leg shortening ¾" (7.5%)', low: 7.5, high: 7.5, mode: 'add' },
    { bodyPart: 'Hip', consideration: 'Leg shortening 1" (10%)', low: 10, high: 10, mode: 'add' },
    { bodyPart: 'Hip', consideration: 'Quad rupture (15-25%+)', low: 15, high: 25, mode: 'add' },
    { bodyPart: 'Hip', consideration: 'Quad atrophy (10%)', low: 10, high: 10, mode: 'add' },
    { bodyPart: 'Knee', consideration: 'None', low: 0, high: 0, mode: 'add' },
    { bodyPart: 'Knee', consideration: 'Patella total excision (15%+)', low: 15, high: 15, mode: 'add' },
    { bodyPart: 'Knee', consideration: 'Patella partial excision (7.5-10%+)', low: 7.5, high: 10, mode: 'add' },
    { bodyPart: 'Knee', consideration: 'Patella fracture w/ fixation (7.5-10%)', low: 7.5, high: 10, mode: 'add' },
    { bodyPart: 'Knee', consideration: 'Patella recurrent dislocation (10-15%)', low: 10, high: 15, mode: 'add' },
    { bodyPart: 'Knee', consideration: 'Chondromalacia patella (7.5-10%)', low: 7.5, high: 10, mode: 'add' },
    { bodyPart: 'Knee', consideration: 'Prepatellar bursitis (0-7.5%)', low: 0, high: 7.5, mode: 'add' },
    { bodyPart: 'Knee', consideration: 'Quad tendon rupture (10-15%)', low: 10, high: 15, mode: 'add' },
    { bodyPart: 'Knee', consideration: 'Tibial plateau fracture (10-15%)', low: 10, high: 15, mode: 'add' },
    { bodyPart: 'Knee', consideration: 'Osteochondritis (7.5-10%)', low: 7.5, high: 10, mode: 'add' },
    { bodyPart: 'Knee', consideration: 'Tibial shaft fracture (0-10%)', low: 0, high: 10, mode: 'add' },
    { bodyPart: 'Ankle/Foot', consideration: 'None', low: 0, high: 0, mode: 'add' },
    { bodyPart: 'Ankle/Foot', consideration: 'Os calcis fracture (33⅓-40%)', low: 33.33, high: 40, mode: 'add' }, // §8.5(2)
    { bodyPart: 'Ankle/Foot', consideration: 'Ankle fusion (75%)', low: 75, high: 75, mode: 'standalone', bypassCap: true },        // §8.5(3) — express cap exception
    { bodyPart: 'Ankle/Foot', consideration: 'Complete foot drop (66⅔%)', low: 66.67, high: 66.67, mode: 'standalone', bypassCap: true }, // §8.5(4) — express cap exception
    { bodyPart: 'Ankle/Foot', consideration: 'Partial foot drop (20-33⅓%)', low: 20, high: 33.33, mode: 'add', bypassCap: true },   // §8.5(4)
    { bodyPart: 'Ankle/Foot', consideration: 'Achilles rupture (20-25%)', low: 20, high: 25, mode: 'add' },       // §8.5(6)
    { bodyPart: 'Ankle/Foot', consideration: 'Malleolar fracture (20-30%)', low: 20, high: 30, mode: 'add' },     // §8.5(7)
    { bodyPart: 'Great Toe', consideration: 'None', low: 0, high: 0, mode: 'add' },
    { bodyPart: 'Great Toe', consideration: 'Distal phalanx amputation (50%)', low: 50, high: 50, mode: 'standalone' }, // §9.6(1)
    { bodyPart: 'Great Toe', consideration: 'MTP amputation (100%)', low: 100, high: 100, mode: 'standalone' },
    { bodyPart: 'Smaller Toes', consideration: 'None', low: 0, high: 0, mode: 'add' },
    { bodyPart: 'Smaller Toes', consideration: 'DIP amputation/ankylosis (50%)', low: 50, high: 50, mode: 'standalone' },
    { bodyPart: 'Smaller Toes', consideration: 'PIP amputation/ankylosis (75%)', low: 75, high: 75, mode: 'standalone' },
    { bodyPart: 'Smaller Toes', consideration: 'MTP amputation (90-100%)', low: 90, high: 100, mode: 'standalone' },
  ];

  // -------------------------------------------------------------------------
  // Small helpers
  // -------------------------------------------------------------------------
  var r2 = function (v) { return Math.round(v * 100) / 100; };  // display rounding only — no 0.5% convention (audit 1.9)
  var isBlank = function (x) { return x === '' || x === null || x === undefined; };

  function _bodyPartKey(site) {
    if (/1st Finger|2nd Finger|3rd Finger|4th Finger/.test(site)) return 'Finger';
    if (/2nd Toe|3rd Toe|4th Toe|5th Toe/.test(site)) return 'Smaller Toes';
    return String(site).replace(/^[LR]\s+/, '').trim();
  }

  function romJointsFor(key) {
    return SLU_ROM_JOINTS.filter(function (j) { return j.bodyPart === key; })
      .sort(function (a, b) { return a.jointOrder - b.jointOrder; });
  }

  // Severity by NEAREST anchor (Board deck slide 70: "25% loss=mild;
  // 50%=moderate and 75%=marked"). Used for UI labels, the shoulder +10% rule
  // ("moderate or higher") and the rotation add ("marked").
  function _severity(row, v) {
    if (row.flat) return 'Mild';                       // flat note values are the "mild deficit" notes
    if (row.grade) return ['Mild', 'Moderate', 'Marked'][Math.min(3, Math.max(1, Math.round(v))) - 1];
    var rev = row.normalROM < row.mildThresh;          // contracture-style scale (elbow/knee extension)
    if (rev ? v <= row.normalROM : v >= row.normalROM) return 'None';
    var d = function (a) { return Math.abs(v - a); };
    var dists = [
      { s: 'Mild', d: d(row.mildThresh) },
      { s: 'Moderate', d: d(row.modThresh) },
      { s: 'Marked', d: d(row.markedThresh) },
    ];
    if (rev ? v >= row.markedThresh : v <= row.markedThresh) return 'Marked';
    dists.sort(function (a, b) { return a.d - b.d; });
    return dists[0].s;
  }

  // Interpolate one column (lo or hi anchors) for a banded row. The
  // proportional adjustment is required by every ROM table header
  // ("percentages for ranges of motion values above/below those depicted here
  // should be adjusted proportionally").
  function _interpCol(row, v, mild, mod, marked, complete) {
    var nrm = row.normalROM, mt = row.mildThresh, odt = row.modThresh, mkt = row.markedThresh;
    var rev = nrm < mt;
    var band;
    if (rev) {
      if (v <= nrm) band = 0; else if (v >= mkt) band = 4; else if (v >= odt) band = 3; else if (v >= mt) band = 2; else band = 1;
    } else {
      if (v >= nrm) band = 0; else if (v <= mkt) band = 4; else if (v <= odt) band = 3; else if (v <= mt) band = 2; else band = 1;
    }
    if (band === 0) return null;
    var den = function (a) { return a === 0 ? 1 : Math.abs(a); };
    if (band === 4) {
      // Beyond the marked anchor: interpolate toward a cited complete-loss
      // value when one exists (Table 3.4 notes / 5.4(b) / 8.4(c)); flat
      // marked value otherwise. Not applicable on reversed (contracture) rows.
      if (!rev && complete != null && mkt > 0) {
        var t = Math.min(1, Math.max(0, (mkt - v) / mkt));
        return marked + (complete - marked) * t;
      }
      return marked;
    }
    if (band === 3) return mod + (marked - mod) * Math.abs(v - odt) / den(mkt - odt);
    if (band === 2) return mild + (mod - mild) * Math.abs(v - mt) / den(odt - mt);
    return 0 + mild * Math.abs(v - nrm) / den(mt - nrm);
  }

  /**
   * Evaluate one joint row. Returns null when no deficit, else:
   *   { lo, hi, sev, rom, contraApplied, extrapolated }
   * lo/hi are the LOWER and HIGHER figures of the printed range (equal on
   * single-value rows). Where `pair` = flexExt/pronSup the caller resolves
   * the point value: lower figure for a single-motion deficit, higher when
   * the paired motion is also deficient (§2.4(B)/§2.5(B)/Table 3.4 note;
   * Board deck slides 60-61).
   */
  function _jointVal(row, rom, opts) {
    if (isBlank(rom)) return null;
    var v = Number(rom);
    if (!isFinite(v)) return null;
    var out;
    if (row.flat) {
      // Flat note rows (shoulder adduction / post-extension, hip post-
      // extension): ANY deficit → the note's 7½-10% (Table 5.4(a) notes,
      // Table 6.4 note). Monotonic by construction.
      if (v >= row.normalROM) return null;
      out = { lo: row.flat[0], hi: row.flat[1], sev: 'Mild' };
    } else if (row.grade) {
      // CMC opposition grade picker 1/2/3 (§2.4(A)(3)) — not degrees.
      var g = Math.round(v);
      if (g <= 0) return null;
      g = Math.min(3, g);
      var vals = g === 1 ? [row.mildLow, row.mildHigh] : g === 2 ? [row.modLow, row.modHigh] : [row.markedLow, row.markedHigh];
      out = { lo: vals[0], hi: vals[1], sev: _severity(row, g) };
    } else {
      var both = !!(opts && opts.bothMotions && opts.bothMotions[row.joint]);
      var complete = (row.completeNeedsBoth && !both) ? null : (row.completeLoss != null ? row.completeLoss : null);
      var lo = _interpCol(row, v, row.mildLow, row.modLow, row.markedLow, complete);
      var hi = _interpCol(row, v, row.mildHigh, row.modHigh, row.markedHigh, complete);
      if (lo === null && hi === null) return null;
      out = { lo: lo || 0, hi: hi || 0, sev: _severity(row, v) };
      // Pair rule: resolve to a point value — lower figure for one motion,
      // higher when both flexion+extension (or pronation+supination) involved.
      if (row.pair === 'flexExt' || row.pair === 'pronSup') {
        var pt = both ? out.hi : out.lo;
        out.lo = pt; out.hi = pt;
        out.both = both;
      }
    }
    out.rom = v;
    out.extrapolated = !!(row.extrapolatedAnchors ||
      (row.extrapolatedBeyondMild && out.sev !== 'Mild' && out.sev !== 'None'));
    // Contralateral baseline (§1.3(3)(b); Board Quiz #2): the uninjured side's
    // ROM becomes the baseline and the table value scales by contra/normal.
    var contra = opts && opts.contralateral && opts.contralateral[row.joint];
    if (!isBlank(contra) && !row.flat && !row.grade && row.normalROM > 0) {
      var ratio = Math.min(1, Math.max(0, Number(contra) / row.normalROM));
      out.lo *= ratio; out.hi *= ratio;
      out.contraApplied = true;
    }
    return out;
  }

  function _special(key, label) {
    if (!label || label === 'None') return null;
    var r = SLU_ROM_SPECIAL.find(function (s) { return s.bodyPart === key && s.consideration === label; });
    return r || null;
  }

  // Resolve a sibling pair (hip abd/add, hip IR/ER, great-toe MTP flex/ext):
  // single motion → its LOWER figure; both → the HIGHER figure of the greater
  // deficit (§ pair notes; Board deck slide 60). Returns a point value or 0.
  function _pairValue(a, b) {
    if (a && b) return Math.max(a.hi, b.hi);
    var one = a || b;
    return one ? one.lo : 0;
  }

  // Table 5.4(b) "Both Internal and External" column: Mild 10, Moderate 15,
  // Marked 20-25, Complete Loss 30. Category = the worse of the two.
  function _rotBothValue(ir, er) {
    if (ir.rom <= 0 && er.rom <= 0) return { lo: 30, hi: 30 };
    var rank = { Mild: 1, Moderate: 2, Marked: 3 };
    var cat = Math.max(rank[ir.sev] || 1, rank[er.sev] || 1);
    return cat === 1 ? { lo: 10, hi: 10 } : cat === 2 ? { lo: 15, hi: 15 } : { lo: 20, hi: 25 };
  }

  // -------------------------------------------------------------------------
  // Body-part combine rules. Input: map jointName → _jointVal result (or null).
  // Output: { lo, hi, notes: [] } — UNCAPPED (the cap is applied in romToSLU).
  // -------------------------------------------------------------------------
  function _combine(key, J, opts) {
    var notes = [];
    var lo = 0, hi = 0;
    var add = function (v) { if (v) { lo += (typeof v === 'number' ? v : v.lo); hi += (typeof v === 'number' ? v : v.hi); } };

    if (key === 'Shoulder') {
      var ff = J['Forward Flexion'], ab = J['Abduction'], ir = J['Int Rotation'], er = J['Ext Rotation'];
      var ad = J['Adduction'], pe = J['Post Extension'];
      var hasFlexAbd = !!(ff || ab), hasOther = !!(ff || ab || ad || pe);
      if (hasFlexAbd) {
        // Table 5.4(a): ONE row, "use greater deficit" — never sum.
        var main = (ff && ab) ? (ff.hi >= ab.hi ? ff : ab) : (ff || ab);
        add(main);
        // Note: "if the deficit in both ranges of motion are moderate or
        // higher, and the measures are within 10° of each other, up to 10%
        // may be added". Both prongs required (Board Case Study #1).
        if (ff && ab &&
            (ff.sev === 'Moderate' || ff.sev === 'Marked') &&
            (ab.sev === 'Moderate' || ab.sev === 'Marked') &&
            Math.abs(ff.rom - ab.rom) <= 10) {
          add(10);
          notes.push('Flexion + abduction both moderate-or-higher and within 10° — +10% added (Table 5.4(a) note).');
        }
      }
      if (ir || er) {
        if (!hasOther) {
          // Table 5.4(b) — "Values below are only considered where no other
          // ROM deficits exist." Stand-alone isolated-rotation track.
          add((ir && er) ? _rotBothValue(ir, er) : (ir || er));
          notes.push('Isolated rotation deficit — scored on Table 5.4(b) (only valid when no other ROM deficits exist).');
        } else {
          // Table 5.4(a) note: never add mild rotation; 10-15% may be added
          // only for MARKED rotation deficits WITH muscle atrophy.
          var anyMarked = (ir && ir.sev === 'Marked') || (er && er.sev === 'Marked');
          if (anyMarked && opts && opts.shoulderAtrophy) {
            add({ lo: 10, hi: 15 });
            notes.push('Marked rotation deficit + muscle atrophy — 10-15% added (Table 5.4(a) note).');
          } else if (anyMarked) {
            notes.push('Marked rotation deficit NOT added — the 10-15% add requires a muscle-atrophy finding (Table 5.4(a) note).');
          } else {
            notes.push('Mild/moderate rotation deficits are not added to a flexion/abduction rating (Table 5.4(a) note).');
          }
        }
      }
      add(ad); add(pe);
      return { lo: lo, hi: hi, notes: notes };
    }

    if (key === 'Hip') {
      // Table 6.4: asterisked pairs are abd/add and IR/ER.
      add(_pairValue(J['Abduction'], J['Adduction']));
      var ir2 = J['Int Rotation'], er2 = J['Ext Rotation'];
      if (ir2 && er2 && ir2.rom <= 0 && er2.rom <= 0) {
        add(30); // Table 6.4 note: complete loss of both IR and ER = 30% of leg
        notes.push('Complete loss of both internal and external rotation — 30% (Table 6.4 note).');
      } else {
        add(_pairValue(ir2, er2));
      }
      add(J['Flexion']); add(J['Post Extension']);
      return { lo: lo, hi: hi, notes: notes };
    }

    if (key === 'Knee') {
      // Table 7.4 is "select one": flexion, extension, or the Both row.
      var kf = J['Flexion'], ke = J['Extension'];
      if (kf && ke) {
        var fb = kf.hi <= 10 ? 1 : kf.hi <= 40 ? 2 : 3;
        var eb = ke.hi <= 10 ? 1 : ke.hi <= 20 ? 2 : 3;
        var mb = Math.max(fb, eb);
        add(mb <= 1 ? { lo: 10, hi: 15 } : mb <= 2 ? { lo: 40, hi: 45 } : { lo: 66.67, hi: 66.67 });
      } else {
        add(kf || ke);
        if (ke && ke.extrapolated) notes.push('Knee extension beyond mild uses EXTRAPOLATED values — Table 7.4\'s moderate/marked extension cells are blank in the Guidelines (the source expects the "Both" row).');
      }
      return { lo: lo, hi: hi, notes: notes };
    }

    if (key === 'Ankle/Foot') {
      var pf = J['Plantar Flex'], df = J['Dorsi Flex'], inv = J['Inversion'], ev = J['Eversion'];
      var pd = { lo: (pf ? pf.lo : 0) + (df ? df.lo : 0), hi: (pf ? pf.hi : 0) + (df ? df.hi : 0) };
      if (pf && df && pf.sev === 'Marked' && df.sev === 'Marked') {
        // Table 8.4(b): marked deficits of both plantar + dorsi flexion = 40%.
        pd.lo = Math.min(pd.lo, 40); pd.hi = Math.min(pd.hi, 40);
      }
      add(pd);
      if (inv && ev) {
        if (inv.rom <= 0 && ev.rom <= 0) {
          add(35); // Table 8.4(c): complete loss of both inversion and eversion = 35%
        } else {
          // Table 8.4(b) combined bands: mild 10, moderate 17.5, marked 25.
          var rank2 = { Mild: 1, Moderate: 2, Marked: 3 };
          var c2 = Math.max(rank2[inv.sev] || 1, rank2[ev.sev] || 1);
          add(c2 === 1 ? 10 : c2 === 2 ? 17.5 : 25);
        }
      } else {
        add(inv || ev);
      }
      if ((inv || ev)) notes.push('Inversion/eversion DEGREE anchors are extrapolations — Table 8.4(a) has no inv/ev degree rows; only the combined values of Table 8.4(b)/(c) are sourced.');
      return { lo: lo, hi: hi, notes: notes };
    }

    if (key === 'Thumb') {
      // Table 2.4(B): when both IP and MCP are involved use the "Both" row
      // bands; CMC (grade) adds; §2.4(C)(1) caps at 100 (applied by caller).
      var ip = J['IP'], mcp = J['MCP'];
      if (ip && mcp) {
        var ipb = ip.hi <= 15 ? 1 : ip.hi <= 25 ? 2 : 3;
        var mcb = mcp.hi <= 20 ? 1 : mcp.hi <= 30 ? 2 : 3;
        var tb = Math.max(ipb, mcb);
        add(tb <= 1 ? { lo: 20, hi: 30 } : tb <= 2 ? { lo: 40, hi: 50 } : { lo: 80, hi: 90 });
      } else {
        add(ip || mcp);
      }
      add(J['CMC']);
      return { lo: lo, hi: hi, notes: notes };
    }

    if (key === 'Great Toe') {
      // Table 9.4(A): MTP pair (flexion/extension) resolves lower/higher, then
      // the "Both joints" bands when IP + MTP are both involved.
      var gip = J['IP'];
      var mf = J['MTP Flex'], me = J['MTP Ext'];
      var mtpVal = _pairValue(mf, me);
      if (gip && mtpVal) {
        var gib = gip.hi <= 15 ? 1 : gip.hi <= 25 ? 2 : 3;
        var gmb = mtpVal <= 20 ? 1 : mtpVal <= 30 ? 2 : 3;
        var gb = Math.max(gib, gmb);
        add(gb <= 1 ? { lo: 20, hi: 30 } : gb <= 2 ? { lo: 40, hi: 50 } : { lo: 80, hi: 90 });
      } else {
        add(gip); add(mtpVal);
      }
      return { lo: lo, hi: hi, notes: notes };
    }

    // Simple additive sites (Finger, Wrist, Elbow, Smaller Toes): add the
    // rows to the extent there are deficits (per-table instructions); the
    // site ankylosis cap is applied by the caller.
    Object.keys(J).forEach(function (k) { add(J[k]); });
    return { lo: lo, hi: hi, notes: notes };
  }

  /**
   * Top-level ROM → %SLU.
   *   site         e.g. 'R Shoulder', 'L 1st Finger (Index)'
   *   romByJoint   { jointName: degrees | '' } (CMC takes grade 1/2/3)
   *   specialLabel special-consideration label or 'None'
   *   opts         {
   *     bothMotions:  { jointName: true }  — the paired motion (extension /
   *                   supination) is ALSO deficient → higher figure applies
   *     contralateral:{ jointName: degrees } — uninjured-side baseline
   *     shoulderAtrophy: true — muscle-atrophy finding (gates the 10-15%
   *                   marked-rotation add, Table 5.4(a) note)
   *   }
   * Returns { lo, hi, display, key, group, joints, notes, standalone }.
   */
  function romToSLU(site, romByJoint, specialLabel, opts) {
    opts = opts || {};
    var key = _bodyPartKey(site);
    var rows = romJointsFor(key);
    var J = {}, detail = [], notes = [];
    rows.forEach(function (row) {
      var rom = (romByJoint && romByJoint[row.joint] !== undefined) ? romByJoint[row.joint] : '';
      var v = _jointVal(row, rom, opts);
      J[row.joint] = v;
      detail.push({
        joint: row.joint,
        normal: row.grade ? null : row.normalROM,
        grade: !!row.grade,
        flat: !!row.flat,
        rom: rom,
        pct: v ? (v.lo === v.hi ? r2(v.lo) + '%' : r2(v.lo) + '-' + r2(v.hi) + '%') : '',
        sev: v ? v.sev : '',
        extrapolated: !!(v && v.extrapolated),
      });
      if (v && v.extrapolated && key !== 'Ankle/Foot' && key !== 'Knee') {
        notes.push(row.joint + ' uses extrapolated (non-Guideline) values.');
      }
    });

    var sp = _special(key, specialLabel);
    var cap = SLU_SITE_CAPS[key];
    var lo, hi, standalone = false;

    var c = _combine(key, J, opts);
    notes = notes.concat(c.notes);

    if (sp && sp.mode === 'standalone') {
      // Stand-alone special: replaces the ROM result entirely.
      standalone = true;
      lo = sp.low; hi = sp.high;
      if (c.lo > 0 || c.hi > 0) {
        notes.push('"' + sp.consideration + '" is a STAND-ALONE value — it replaces the ROM-derived result (' + r2(c.lo) + (c.lo === c.hi ? '' : '-' + r2(c.hi)) + '% ignored).');
      }
      if (cap != null && !sp.bypassCap) { lo = Math.min(lo, cap); hi = Math.min(hi, cap); }
    } else {
      lo = c.lo; hi = c.hi;
      if (cap != null) { lo = Math.min(lo, cap); hi = Math.min(hi, cap); }
      if (sp) {
        lo += sp.low; hi += sp.high;
        if (cap != null && !sp.bypassCap) { lo = Math.min(lo, cap); hi = Math.min(hi, cap); }
        else if (sp.bypassCap) notes.push('"' + sp.consideration + '" is an express exception to the ankylosis cap.');
      }
    }

    // Contralateral scaling produces the Board's whole-percent arithmetic
    // (Quiz #2: 60% × 140/180 → 47%).
    var contraUsed = detail.some(function (d, i) { var v = J[rows[i] && rows[i].joint]; return v && v.contraApplied; });
    if (contraUsed) { lo = Math.round(lo); hi = Math.round(hi); notes.push('Scaled to the contralateral baseline (§1.3(3)(b)); rounded to a whole percent per the Board\'s worked arithmetic (Quiz #2).'); }

    lo = r2(Math.max(0, lo)); hi = r2(Math.max(0, hi));
    var display = (lo === 0 && hi === 0) ? '' : (lo === hi ? lo + '%' : lo + '-' + hi + '%');
    return { lo: lo, hi: hi, display: display, key: key, group: key, joints: detail, notes: notes, standalone: standalone };
  }

  // Back-compat single-joint string API (tile per-row display).
  function romJointPct(key, jointName, rom, both) {
    var row = SLU_ROM_JOINTS.find(function (j) { return j.bodyPart === key && j.joint === jointName; });
    if (!row) return '';
    var v = _jointVal(row, rom, both ? { bothMotions: (function (o) { o[jointName] = true; return o; })({}) } : null);
    if (!v) return '';
    return v.lo === v.hi ? r2(v.lo) + '%' : r2(v.lo) + '-' + r2(v.hi) + '%';
  }

  // -------------------------------------------------------------------------
  // Joint replacement — STAND-ALONE track (Tables 5.5 / 6.5 / 7.5).
  // "A good outcome (as described in Row A below) is a 35% Schedule Loss of
  // Use. Where deficits exceed those described in Row A, add the value for the
  // additional deficit (using the value that most closely matches the deficit
  // IN EACH COLUMN) to the base of 35%..." — columns are scored independently
  // and rows may mix (Board Quiz #3 takes Fair flexion + Poor mal-rotation).
  // This REPLACES Tables 5.4(a)/6.4/7.4 for a replaced joint. Proof the tracks
  // are separate: Table 7.5 caps at 80% of the leg while knee ankylosis is 70%.
  // -------------------------------------------------------------------------
  var SLU_REPLACEMENT_TABLES = {
    Shoulder: { base: 35, max: 80, cite: 'Table 5.5 / §5.5(9)', minMonths: 12 },
    Hip: { base: 35, max: 80, cite: 'Table 6.5 / §6.5(9)', minMonths: 12 },
    Knee: { base: 35, max: 80, cite: 'Table 7.5 / §7.5(13)', minMonths: 12 },
  };

  // Nearest-anchor pick for a replacement column ("the value that most
  // closely matches the deficit"). anchors: [{ v, add }] sorted best→worst.
  function _nearestAdd(v, anchors, worseIsLower) {
    var best = anchors[0], worst = anchors[anchors.length - 1];
    if (worseIsLower) {                       // deficit grows as v falls (ROM)
      if (v >= best.v) return best.add;
      if (v <= worst.v) return worst.add;
    } else {                                  // deficit grows as v rises (LLD, degrees, mm)
      if (v <= best.v) return best.add;
      if (v >= worst.v) return worst.add;
    }
    var pick = anchors[0], dist = Infinity;
    anchors.forEach(function (a) {
      var d = Math.abs(v - a.v);
      if (d < dist - 1e-9 || (Math.abs(d - dist) <= 1e-9 && a.add < pick.add)) { pick = a; dist = d; }
    });
    return pick.add;
  }

  /**
   * sluReplacement('Shoulder'|'Hip'|'Knee', inputs) — Tables 5.5/6.5/7.5.
   * inputs: {
   *   flexion, abduction (shoulder), extension (knee, contracture °),
   *   lldInches + malRotationDeg (hip position),
   *   malalignDeg / mlLaxityDeg / apMotionMm / legLengthIn (knee position),
   *   atrophyIn, chronicComplications: bool,
   *   monthsPostOp, hipFracture: bool, failed: bool
   * }
   * Returns { pct, base, columns:{rom,position,atrophy,complications},
   *           blocked, warnings, cite }.
   */
  function sluReplacement(joint, inp) {
    inp = inp || {};
    var T = SLU_REPLACEMENT_TABLES[joint];
    if (!T) return null;
    var warnings = [];

    if (inp.failed) {
      // §1.6 item 12: failed joint replacements are NOT schedulable — they go
      // to classification. Hard stop.
      return {
        pct: null, blocked: true, notSchedulable: true, cite: '§1.6(12)',
        warnings: ['Failed joint replacement — NOT schedulable. §1.6 item 12 sends failed total hip/knee/shoulder replacements to classification (non-schedule).'],
      };
    }
    if (inp.monthsPostOp != null && inp.monthsPostOp !== '' && Number(inp.monthsPostOp) < T.minMonths) {
      warnings.push('Replacement outcomes are assessed no sooner than 12 months post-surgery (' + T.cite + ').');
    }
    if (joint === 'Hip' && inp.hipFracture && inp.monthsPostOp != null && Number(inp.monthsPostOp) < 24) {
      warnings.push('Hip fracture cases: allow up to 2 years before rating (§6.5(8)).');
    }

    var romAdd = 0, posAdd = 0, atrAdd = 0, cmpAdd = 0;

    if (joint === 'Hip') {
      // Table 6.5 — flexion: Good >90 (+0), Fair 45 (+10), Poor <25 (+35).
      if (!isBlank(inp.flexion)) {
        romAdd = _nearestAdd(Number(inp.flexion), [{ v: 90, add: 0 }, { v: 45, add: 10 }, { v: 25, add: 35 }], true);
      }
      // Position: LLD or mal-rotation, whichever deficit is greater. The cells
      // are RANGES (Good LLD<0.5 and/or ≤10° rotation; Fair ≤0.75 / 10-15°;
      // Poor >1 / >15°) — apply them as thresholds, nearest row in the
      // 0.75-1" gap ("most closely matches").
      var lldV = isBlank(inp.lldInches) ? null : Number(inp.lldInches);
      var lldAdd = lldV === null ? 0 : (lldV < 0.5 ? 0 : lldV <= 0.875 ? 5 : 10);
      var rotV = isBlank(inp.malRotationDeg) ? null : Number(inp.malRotationDeg);
      var rotAdd = rotV === null ? 0 : (rotV <= 10 ? 0 : rotV <= 15 ? 5 : 10);
      posAdd = Math.max(lldAdd, rotAdd);
    } else if (joint === 'Knee') {
      // Table 7.5 — ROM: flexion or extension, whichever deficit is greater.
      var fAdd = isBlank(inp.flexion) ? 0 : _nearestAdd(Number(inp.flexion), [{ v: 105, add: 0 }, { v: 90, add: 10 }, { v: 30, add: 30 }], true);
      // Extension (contracture): Good <10 (+0), Fair 15 (+10), Poor ≥20 (+30).
      // The printed Poor cell reads "E: < 20°" — a source typo (it would
      // overlap Fair); treated as ≥20° per the row's ordering.
      var e = isBlank(inp.extension) ? null : Number(inp.extension);
      var eAdd = e === null ? 0 : (e < 10 ? 0 : e >= 20 ? 30 : 10);
      romAdd = Math.max(fAdd, eAdd);
      // Position: greater of malalignment / ML laxity / AP motion / leg
      // length. Cells are ranges (Good <10° / <10° / <5mm / <0.5"; Fair 15° /
      // 14° / 9mm / 0.75"; Poor >15° / >15° / >10mm / >1") — thresholds.
      var pAdds = [];
      var thr = function (v, goodBelow, poorAbove) { return v < goodBelow ? 0 : v > poorAbove ? 10 : 5; };
      if (!isBlank(inp.malalignDeg)) pAdds.push(thr(Number(inp.malalignDeg), 10, 15));
      if (!isBlank(inp.mlLaxityDeg)) pAdds.push(thr(Number(inp.mlLaxityDeg), 10, 15));
      if (!isBlank(inp.apMotionMm)) pAdds.push(thr(Number(inp.apMotionMm), 5, 10));
      if (!isBlank(inp.legLengthIn)) pAdds.push(thr(Number(inp.legLengthIn), 0.5, 1));
      posAdd = pAdds.length ? Math.max.apply(null, pAdds) : 0;
    } else { // Shoulder
      // Table 5.5 — flexion or abduction, greatest degree of impairment:
      // Good >135 (+0), Fair 90 (+10), Poor <45 (+30).
      var romVals = [];
      if (!isBlank(inp.flexion)) romVals.push(Number(inp.flexion));
      if (!isBlank(inp.abduction)) romVals.push(Number(inp.abduction));
      if (romVals.length) {
        romAdd = _nearestAdd(Math.min.apply(null, romVals), [{ v: 135, add: 0 }, { v: 90, add: 10 }, { v: 45, add: 30 }], true);
      }
    }

    // Atrophy column. Hip/knee (mid-thigh): <1" (+0), 1.5-2.5" (+5), >3" (+10).
    // Shoulder (mid-arm): <1" (+0), 1.5-2" (+5), >2.5" (+10) — the §5.5(9)
    // worked example adds +5 at 1.5" (→40%) and +10 above 2.5" (→45%).
    if (!isBlank(inp.atrophyIn)) {
      var a = Number(inp.atrophyIn);
      if (joint === 'Shoulder') atrAdd = a > 2.25 ? 10 : a >= 1.25 ? 5 : 0;
      else atrAdd = a > 2.75 ? 10 : a >= 1.25 ? 5 : 0;
    }
    if (inp.chronicComplications) cmpAdd = 10;

    var pct = Math.min(T.base + romAdd + posAdd + atrAdd + cmpAdd, T.max);
    return {
      pct: r2(pct), base: T.base, blocked: false,
      columns: { rom: romAdd, position: posAdd, atrophy: atrAdd, complications: cmpAdd },
      warnings: warnings, cite: T.cite, max: T.max,
    };
  }

  return {
    romToSLU: romToSLU,
    romJointPct: romJointPct,
    romJointsFor: romJointsFor,
    sluReplacement: sluReplacement,
    SLU_ROM_JOINTS: SLU_ROM_JOINTS,
    SLU_ROM_SPECIAL: SLU_ROM_SPECIAL,
    SLU_SITE_CAPS: SLU_SITE_CAPS,
    SLU_REPLACEMENT_TABLES: SLU_REPLACEMENT_TABLES,
  };
});
