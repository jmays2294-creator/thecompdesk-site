/* Pro Attorney Calculator Workspace — app.js
 *
 * Refactored from the Claude-bundler artifact. Three substantive changes
 * relative to the source:
 *   (1) Global AWW commit bug fixed — added computeAWW() covering all five
 *       WCL §14 methods plus tips/board/concurrent adjustments, and a
 *       "Compute & Apply" button at the bottom of the AWWStrip wizard
 *       with a result preview card.
 *   (2) sessionStorage replaced with Supabase JSONB writes via
 *       window.WorkspacePersistence (see persistence.js). Realtime
 *       subscription via window.WorkspaceSync (see sync.js).
 *   (3) Chrome-style TabStrip above the AWW strip — each tab is one
 *       attorney_cases row. ⌘T/⌘W/⌘1–9, drag-reorder, middle-click close.
 *       Free tier: 1 synced + unlimited local. Pro: unlimited synced.
 */

const { useState, useEffect, useMemo, useRef, useCallback } = React;

const GRID = 20;
const CANVAS_PAD = 10;

// Sports-team themes available in the AWW header's "More Themes" dropdown.
// Used in two places: the dropdown options, and to detect whether the
// currently-active theme is "one of these" so the dropdown can echo it.
const EXTRA_THEMES = new Set(['knicks', 'yankees', 'mets', 'heat', 'bills']);

// Team theme variants surfaced by the "More themes" button under the
// onyx/eggshell/aurora pills. Values must match the EXTRA_THEMES set above
// and the [data-theme="…"] token blocks in workspace.css.
const TEAM_THEMES = [
  { v: 'knicks',  label: 'New York Knicks' },
  { v: 'yankees', label: 'New York Yankees' },
  { v: 'mets',    label: 'New York Mets' },
  { v: 'heat',    label: 'Miami Heat' },
  { v: 'bills',   label: 'Buffalo Bills' },
];

// Degree-of-disability percentages for the AWW strip "Common rates" quick list.
// Each row's weekly rate = (2/3 × AWW) × pct, then bounded by the DOI statutory
// max cap + min floor via applyRateBounds() (the same helper every award tile
// uses). 66⅔% (200/3) is the full-TT fraction; 100% returns the uncapped-here
// 2/3-AWW rate (still bounded by the statutory max/min). Recomputed on any AWW
// or DOI change.
const COMMON_RATE_PCTS = [
  { label: '25%',   v: 25 },
  { label: '33⅓%',  v: 100 / 3 },
  { label: '50%',   v: 50 },
  { label: '62.5%', v: 62.5 },
  { label: '66⅔%',  v: 200 / 3 },
  { label: '67.5%', v: 67.5 },
  { label: '75%',   v: 75 },
  { label: '87.5%', v: 87.5 },
  { label: '100%',  v: 100 },
];

// Day-count options for the AWW strip "Deadline" quick-calc dropdown.
const DEADLINE_DAY_OPTIONS = [10, 15, 30, 45, 60, 75, 90];

// ============================================================================
// SECTION 1 — AWW COMPUTATION (Task 1)
// ============================================================================
//
// WCL §14 method mapping (revised May 2026).
// §14(1) and §14(2) are unified under one method because they describe the
// claimant's OWN earnings — (1) when the claimant worked substantially the
// whole year (annual ÷ 52), (2) when the claimant did not (statutory daily-
// wage multiplier ÷ 52). The Multiplier method is kept as a distinct entry
// for the §14(2) computation when the (1)/(2) wizard alone is insufficient.
// §14(5) Apprentice is removed (rare in modern WC practice; if needed, the
// Catchall covers it). §14(3) Similar Worker is the sole "comparator" method.

const METHODS = [
  { id: 'multi',    label: 'Section 14(1), (2) & (3).',
    badge: '§14(1)/(2)/(3)',
    tip:   '§14(1), (2) & (3) — The claimant\'s own earnings via the statutory daily-wage multiplier. (Total earnings ÷ days worked) × multiplier (200 / 260 / 300 / 365), then ÷ 52. The 200, 260, 300, and 365 buttons map to 4-day (or <4-day), 5-day, 6-day, and 7-day workers respectively.' },
  { id: 'straight', label: 'Catchall (Weekly Divisor)',
    badge: '§14(3)/(4)',
    tip:   '§14(3)/§14(4) Catchall — Where neither (1)/(2) nor a similar-worker comparison reasonably applies, the Board fixes AWW by fairly approximating annual earning capacity. Implemented here as total earnings ÷ weeks actually worked.' },
];

const DAYS_MULTIPLIER = { 4: 200, 5: 260, 6: 300, 7: 365 };

function methodBadge(method, daysWeek) {
  if (method === 'straight') {
    return {
      badge: '§14(3)/(4)',
      tip: '§14(3)/(4) Catchall — total earnings ÷ weeks worked.',
    };
  }
  // 'multi' (and any legacy method id that is no longer in the workspace UI)
  const n = DAYS_MULTIPLIER[daysWeek] || 260;
  return {
    badge: `§14(1)/(2)/(3) ×${n}`,
    tip: `§14(1), (2) & (3) Multiplier — total earnings ÷ days worked × ${n} ÷ 52.`,
  };
}


/**
 * methodCitation(state) — Returns the citation suffix for the AWW header.
 * Multiplier:    "Section 14(1) or (2) × {n}"
 * Catchall:      "Section 14(3) — divisor {n}"
 * + concurrent:  "· Section 14(6) (concurrent)"
 *
 * Returned as an array of pieces so the header can stack/wrap responsively.
 */
function methodCitation(state) {
  const pieces = [];
  if (state.method === 'straight') {
    const wks = Number(state.methodStraightWeeks) || 0;
    pieces.push(`Section 14(3) — divisor ${wks || '—'}`);
  } else {
    const mult = DAYS_MULTIPLIER[state.daysWeek] || 260;
    pieces.push(`Section 14(1) or (2) × ${mult}`);
  }
  if (state.concurrentOn) pieces.push('Section 14(6) (concurrent)');
  return pieces;
}

/**
 * computeAWW(state) — Pure function. Returns the computed AWW, the §14
 * subsection used, the 2/3 rate (capped at the statutory max for the DOI),
 * and a structured breakdown so the result preview can show every step.
 *
 * Adjustments per WCL §2(9) and §14(6):
 *   - Tips/gratuities: included in "wages" if regularly received
 *   - Board, rent, housing, lodging: reasonable value added
 *   - Concurrent employment §14(6): add similar-time-AWW from concurrent job(s)
 */
function computeAWW(state) {
  const breakdown = [];
  const adjTips    = Number(state.adjTips)       || 0;
  const adjBoard   = Number(state.adjBoard)      || 0;
  const adjConcur  = Number(state.adjConcurrent) || 0;

  let baseAww = 0;
  let methodLabel = '';
  let formula = '';

  // The workspace UI exposes only two §14 paths:
  //   - 'multi'    → §14(1)/(2) statutory multiplier  (total ÷ days × N ÷ 52)
  //   - 'straight' → §14(3)/(4) catchall              (total ÷ weeks)
  // Legacy state ('52week' or 'similar' from v1.1) falls through to 'multi'
  // so old persisted tabs don't crash; the user re-applies once on load.
  switch (state.method) {
    case 'straight': {
      const earn = Number(state.methodStraightEarn)  || 0;
      const wks  = Number(state.methodStraightWeeks) || 0;
      baseAww = wks > 0 ? earn / wks : 0;
      methodLabel = '§14(3)/(4) — Catchall (Weekly Divisor)';
      formula = `${fmt$(earn)} ÷ ${fmtN(wks, 0)} weeks = ${fmt$(baseAww)}`;
      breakdown.push({ label: 'Total Earnings', value: fmt$(earn) });
      breakdown.push({ label: 'Weeks Worked',   value: fmtN(wks, 0) });
      break;
    }
    case 'multi':
    default: {
      const earn = Number(state.methodMultiEarn) || 0;
      const days = Number(state.methodMultiDays) || 0;
      const mult = DAYS_MULTIPLIER[state.daysWeek] || 260;
      const dailyWage = days > 0 ? earn / days : 0;
      baseAww = days > 0 ? (dailyWage * mult) / 52 : 0;
      methodLabel = `§14(1)/(2) — Multiplier ×${mult}`;
      formula = `(${fmt$(earn)} ÷ ${fmtN(days, 0)} days) × ${mult} ÷ 52 = ${fmt$(baseAww)}`;
      breakdown.push({ label: 'Total Earnings',  value: fmt$(earn) });
      breakdown.push({ label: 'Days Worked',     value: fmtN(days, 0) });
      breakdown.push({ label: 'Daily Wage',      value: fmt$(dailyWage) });
      breakdown.push({ label: `Multiplier (${mult})`, value: `×${mult}` });
      breakdown.push({ label: 'Divisor',         value: '÷ 52' });
      break;
    }
  }

  // Concurrent employment §14(6): include only when the toggle is ON.
  // The dollar value `state.adjConcurrent` is preserved across toggles so
  // attorneys can flip the toggle to A/B test impact without re-typing.
  const includeConcurrent = !!state.concurrentOn;
  const concurrentApplied = includeConcurrent ? adjConcur : 0;

  const adjustedAww = baseAww + adjTips + adjBoard + concurrentApplied;
  if (adjTips || adjBoard || concurrentApplied) {
    if (adjTips)            breakdown.push({ label: '+ Tips/Gratuities (§2(9))',         value: fmt$(adjTips) });
    if (adjBoard)           breakdown.push({ label: '+ Board/Lodging (§2(9))',           value: fmt$(adjBoard) });
    if (concurrentApplied)  breakdown.push({ label: '+ Concurrent Employment (§14(6))', value: fmt$(concurrentApplied) });
    if (concurrentApplied)  breakdown.push({ label: '= Composite AWW',                        value: fmt$(adjustedAww) });
  }

  const max = lookupMax(state.doi);
  const min = lookupMin(state.doi);
  const maxRate = max ? max.max : 0;
  const minRate = (min && min.min) ? min.min : 0;
  const ttRate = getCappedTT(adjustedAww, maxRate, minRate);

  return {
    aww: Math.round(adjustedAww * 100) / 100,
    baseAww: Math.round(baseAww * 100) / 100,
    concurrentAww: Math.round(concurrentApplied * 100) / 100,
    isComposite: includeConcurrent && concurrentApplied > 0,
    method: state.method,
    methodLabel,
    citation: methodCitation(state),
    formula,
    breakdown,
    ttRate,
    maxRate,
    minRate,
    capped: maxRate > 0 && (adjustedAww * 2 / 3) > maxRate,
  };
}

// ============================================================================
// SECTION 2 — AWW STRIP (with Compute & Apply)
// ============================================================================

function AWWStrip({ state, set, computed, themeName, setTheme, saveStatus, onSaveCase, onDeleteCase, saveCaseStatus, viewScale, setViewScale, onOpenFormulas }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null); // computed result, prior to apply

  // Auto-hide toolbar (Option C). The whole compact toolbar row folds into a
  // slim drawer handle a few seconds after mount (fixed timer from load — fires
  // even mid-interaction). The handle reveals/re-hides it at any time. The AWW
  // configure fields stay visible; only the toolbar (actions + settings) hides.
  // The site beta banner + nav are collapsed separately by workspace.html.
  const [hdrCollapsed, setHdrCollapsed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setHdrCollapsed(true), 5000);
    return () => clearTimeout(t);
  }, []);

  // Settings popover (Option B) — gear button gathers themes, size sliders,
  // Formulas, and Delete Case so the toolbar stays a single dense row.
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    if (!settingsOpen) return;
    const onDown = (e) => { if (!e.target.closest('.ws-settings-wrap')) setSettingsOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setSettingsOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [settingsOpen]);

  // #4 — Full Screen toggle via the browser Fullscreen API. Esc exits (handled
  // by the browser); the button label/icon reflects the live state through the
  // fullscreenchange event.
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);
  const toggleFullscreen = () => {
    try {
      if (document.fullscreenElement) {
        if (document.exitFullscreen) document.exitFullscreen();
      } else {
        const el = document.documentElement;
        if (el.requestFullscreen) el.requestFullscreen();
      }
    } catch (e) { /* requestFullscreen can reject (e.g. blocked) — non-fatal */ }
  };

  const max = lookupMax(state.doi);
  const min = lookupMin(state.doi);

  const onDoiChange = (val) => {
    const m = lookupMax(val);
    set({ doi: val, maxRate: m ? m.max : state.maxRate });
  };

  // SLU rate, TT rate, and the floor all collapse to AWW when AWW is below
  // the statutory min for the DOA (May 2026 rule). Otherwise SLU rate equals
  // the bounded TT rate (2/3 AWW capped at max, floored at min).
  const awwOverride = isAwwBelowMin(state.aww, computed.minRate);
  const sluCapped = computed.ttRate;
  const displayMin = awwOverride ? state.aww : (computed.minRate || 0);
  const badge = methodBadge(state.method, state.daysWeek);

  // ── Common rates quick-list (degree-of-disability rate table) ──────────────
  // Each row = (2/3 × AWW) × disability%, bounded by the DOI statutory max cap
  // and min floor via applyRateBounds() — the universal helper every award tile
  // uses. Recomputes on any AWW or DOI change (DOI flows in through
  // computed.minRate / computed.maxRate).
  const commonRates = useMemo(() => COMMON_RATE_PCTS.map(p => ({
    label: p.label,
    rate: applyRateBounds(state.aww * (2 / 3) * (p.v / 100), state.aww, computed.minRate, computed.maxRate),
  })), [state.aww, computed.minRate, computed.maxRate]);

  // ── Today / Deadline quick-calc ────────────────────────────────────────────
  // Today is always the user's current date (read-only). Deadline = Today + N
  // CALENDAR days, counting from the day AFTER today — so N=10 from a Monday
  // lands on the following Thursday (Monday + 10 calendar days). Building the
  // date as new Date(y, m, d + N) at local midnight handles month rollover and
  // avoids any timezone off-by-one. N is a local scratch value (not saved case
  // data), defaulting to 30.
  const [deadlineDays, setDeadlineDays] = useState(30);
  // "More themes" menu open/close, with outside-click + Escape to dismiss.
  const [moreThemesOpen, setMoreThemesOpen] = useState(false);
  useEffect(() => {
    if (!moreThemesOpen) return;
    const onDown = (e) => { if (!e.target.closest('.more-themes')) setMoreThemesOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setMoreThemesOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [moreThemesOpen]);
  const _today = new Date();
  const today = new Date(_today.getFullYear(), _today.getMonth(), _today.getDate());
  const deadlineDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + deadlineDays);
  const fmtCalDate = (d) => d.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });

  // Re-compute preview whenever wizard inputs change (only while open)
  const wizardKey = JSON.stringify({
    method: state.method,
    daysWeek: state.daysWeek,
    doi: state.doi,
    method52Annual: state.method52Annual,
    methodMultiEarn: state.methodMultiEarn,
    methodMultiDays: state.methodMultiDays,
    methodStraightEarn: state.methodStraightEarn,
    methodStraightWeeks: state.methodStraightWeeks,
    methodSimilarEarn: state.methodSimilarEarn,
    methodHourlyRate: state.methodHourlyRate,
    methodHourlyHours: state.methodHourlyHours,
    adjTips: state.adjTips, adjBoard: state.adjBoard, adjConcurrent: state.adjConcurrent,
  });
  useEffect(() => {
    if (!open) return;
    setPreview(computeAWW(state));
  }, [wizardKey, open]);

  const onApply = () => {
    const result = computeAWW(state);
    set({ aww: result.aww, maxRate: result.maxRate || state.maxRate });
    setPreview(result);
    setOpen(false);
  };

  return (
    <div className={'aww-strip' + (hdrCollapsed ? ' hdr-collapsed' : '')}>
      <button
        type="button"
        className={'hdr-collapse-handle' + (hdrCollapsed ? ' collapsed' : '')}
        onClick={() => setHdrCollapsed(c => !c)}
        aria-pressed={!hdrCollapsed}
        aria-label={hdrCollapsed ? 'Show workspace toolbar' : 'Hide workspace toolbar'}
        title={hdrCollapsed ? 'Show toolbar (Save, Full Screen, Settings)' : 'Hide toolbar'}>
        <span className="chev">▾</span>
        <span className="hdr-handle-label">{hdrCollapsed ? 'Toolbar' : ''}</span>
      </button>
      <div className="aww-row">
        <div className="ws-title-label" title="Pro Attorney Calculator Workspace — set AWW &amp; DOI once; every tile updates.">
          Pro Attorney Workspace
        </div>
        <div className="right-cluster">
          <div className="case-actions">
            <button
              type="button"
              className="btn primary tiny case-action-save"
              onClick={onSaveCase}
              disabled={saveCaseStatus === 'saving'}
              title="Save this case (AWW + every tile) to My Cases">
              {saveCaseStatus === 'saving' ? 'Saving…'
                : saveCaseStatus === 'saved' ? 'Saved ✓'
                : saveCaseStatus === 'error' ? 'Retry Save'
                : saveCaseStatus === 'no-name' ? 'Enter Case Name'
                : 'Save to My Cases'}
            </button>
            <button
              type="button"
              className="btn ghost tiny case-action-fullscreen"
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit full screen (Esc)' : 'Enter full screen'}>
              {isFullscreen ? '⤢ Exit Full Screen' : '⤢ Full Screen'}
            </button>
          </div>
          <div className={'save-indicator ' + (saveStatus === 'saving' ? 'saving' : saveStatus === 'error' ? 'error' : '')}>
            <span className="dot"></span>
            {saveStatus === 'saving' ? 'Saving…'
              : saveStatus === 'error' ? 'Save error'
              : saveStatus === 'offline' ? 'Offline'
              : 'Saved'}
          </div>
          {/* Settings gear (Option B) — themes, size sliders, Formulas, and
              Delete Case live here so the toolbar stays one dense row. */}
          <div className="ws-settings-wrap">
            <button type="button"
              className={'btn ghost tiny ws-settings-btn' + (settingsOpen ? ' active' : '')}
              aria-expanded={settingsOpen}
              aria-haspopup="true"
              onClick={() => setSettingsOpen(o => !o)}
              title="Settings — theme, sizing, formulas">
              <span className="gear">⚙</span> Settings
            </button>
            {settingsOpen && (
              <div className="ws-settings-menu" role="menu">
                <div className="ws-settings-section">
                  <div className="ws-settings-label">Theme</div>
                  <div className="theme-switch">
                    {['onyx','eggshell','aurora'].map(t => (
                      <button key={t} className={themeName === t ? 'active' : ''} onClick={() => setTheme(t)}>{t.toUpperCase()}</button>
                    ))}
                  </div>
                  <div className="more-themes">
                    <button type="button"
                      className={'more-themes-btn ' + (EXTRA_THEMES.has(themeName) ? 'active' : '')}
                      aria-expanded={moreThemesOpen}
                      onClick={() => setMoreThemesOpen(o => !o)}>
                      {EXTRA_THEMES.has(themeName)
                        ? (TEAM_THEMES.find(t => t.v === themeName) || {}).label
                        : 'More themes'} <span className="chev">▾</span>
                    </button>
                    {moreThemesOpen && (
                      <div className="more-themes-menu">
                        {TEAM_THEMES.map(t => (
                          <button key={t.v} type="button"
                            className={themeName === t.v ? 'active' : ''}
                            onClick={() => { setTheme(t.v); setMoreThemesOpen(false); }}>{t.label}</button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="ws-settings-section">
                  <div className="ws-settings-label">Size · resets on reload</div>
                  <div className="size-sliders" role="group" aria-label="Workspace sizing">
                    <label className="size-slider" title="Scale all tiles uniformly (not saved)">
                      <span>Tile</span>
                      <input type="range" min="0.7" max="1.4" step="0.05"
                        value={viewScale.tile}
                        aria-label="Tile size"
                        onChange={e => setViewScale(s => ({ ...s, tile: Number(e.target.value) }))}/>
                    </label>
                    <label className="size-slider" title="Zoom the whole canvas — tiles and spacing (not saved)">
                      <span>Zoom</span>
                      <input type="range" min="0.6" max="1.5" step="0.05"
                        value={viewScale.ws}
                        aria-label="Workspace size"
                        onChange={e => setViewScale(s => ({ ...s, ws: Number(e.target.value) }))}/>
                    </label>
                  </div>
                </div>
                <div className="ws-settings-section ws-settings-actions">
                  <button className="btn ghost tiny" onClick={() => { onOpenFormulas(); setSettingsOpen(false); }} title="Formula reference">📐 Formulas</button>
                  <button className="btn ghost tiny case-action-delete" onClick={() => { onDeleteCase(); setSettingsOpen(false); }} title="Delete this case tab.">Delete Case</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="aww-fields">
        <div className="f-group">
          <label className="f-label">Case</label>
          <input className="f-input" placeholder="Case name or WCB#" value={state.caseName || ''}
            onChange={e => set({ caseName: e.target.value })}/>
        </div>
        <div className="f-group">
          <label className="f-label">Average Weekly Wage</label>
          <div className="f-input-wrap">
            <span className="prefix">$</span>
            <input className="f-input with-prefix" type="number" min="0" step="0.01"
              value={state.aww}
              onChange={e => set({ aww: Number(e.target.value) })}/>
          </div>
        </div>
        <div className="f-group">
          <label className="f-label">Date of Injury</label>
          <input className="f-input" type="date" value={state.doi}
            onChange={e => onDoiChange(e.target.value)}/>
        </div>
        <div className="f-group">
          <label className="f-label">Statutory Max</label>
          <div className="f-input-wrap">
            <span className="prefix">$</span>
            <input className="f-input with-prefix" type="number" step="0.01" value={state.maxRate || ''}
              onChange={e => set({ maxRate: Number(e.target.value) })}
              title={max?.l || ''}/>
          </div>
        </div>
        <div className="tt-display">
          <div>
            <div className="lbl">{state.concurrentOn ? 'Composite AWW' : 'AWW'}</div>
            <div className="val">{fmt$(state.aww)}{state.concurrentOn ? <span className="composite-tag">composite</span> : null}</div>
          </div>
          <div className="sep">·</div>
          <div>
            <div className="lbl">TT Rate</div>
            <div className="val">{fmt$(computed.ttRate)}/wk</div>
          </div>
          <div className="sep">·</div>
          <div>
            <div className="lbl">SLU Rate</div>
            <div className="val">{fmt$(sluCapped)}/wk</div>
          </div>
          <div className="sep">·</div>
          <div>
            <div className="lbl">Min</div>
            <div className="val" style={{fontSize:13}}>{displayMin ? fmt$(displayMin) : '—'}</div>
          </div>
          {awwOverride && (
            <div style={{
              marginLeft:8, padding:'2px 8px', borderRadius:6,
              background:'var(--bg-soft, rgba(255,255,255,0.06))',
              color:'var(--ac-2)', fontSize:11, fontWeight:600,
              alignSelf:'center',
            }} title={`AWW ${fmt$(state.aww)} is below the statutory minimum ${fmt$(min?.min || 0)} for the DOA — AWW is the effective floor for TT, SLU, and any percentage-adjusted rate.`}>
              AWW &lt; min · AWW is floor
            </div>
          )}
          <div style={{marginLeft:'auto'}}>
            <div className="method-badge" tabIndex="0">
              {badge.badge}
              <div className="tooltip"><strong>AWW Method</strong>{badge.tip}</div>
            </div>
          </div>
        </div>

        {/* AWW-row extras: Common rates quick list + Today/Deadline calc.
            Full-width row inside the .aww-fields grid (grid-column 1/-1). */}
        <div className="aww-extras">
          <div className="common-rates">
            <div className="ce-label">
              Common rates <span className="ce-hint">⅔ AWW × disability % · DOI-bounded</span>
            </div>
            <div className="rate-chips">
              {commonRates.map(r => (
                <div className="rate-chip" key={r.label}>
                  <span className="rc-pct">{r.label}</span>
                  <span className="rc-val">{fmt$(r.rate)}<span className="rc-wk">/wk</span></span>
                </div>
              ))}
            </div>
          </div>
          <div className="deadline-tool">
            <div className="dt-field">
              <label className="f-label">Today</label>
              <div className="dt-readout">{fmtCalDate(today)}</div>
            </div>
            <div className="dt-field">
              <label className="f-label">Term</label>
              <select className="f-input dt-select" value={deadlineDays}
                onChange={e => setDeadlineDays(Number(e.target.value))}
                title="Calendar days, counting from the day after today">
                {DEADLINE_DAY_OPTIONS.map(n => (
                  <option key={n} value={n}>{n} days</option>
                ))}
              </select>
            </div>
            <div className="dt-field">
              <label className="f-label">Deadline</label>
              <div className="dt-readout dt-deadline">{fmtCalDate(deadlineDate)}</div>
            </div>
          </div>
        </div>
        <button className={'expand-toggle ' + (open ? 'open' : '')} onClick={() => setOpen(!open)}>
          Configure AWW <span className="chev">▾</span>
        </button>
      </div>

      {open && (
        <div className="aww-wizard">
          <div className="method-pills">
            {METHODS.map(m => (
              <button key={m.id}
                className={'method-pill ' + (state.method === m.id ? 'active' : '')}
                onClick={() => set({ method: m.id })}>{m.label}</button>
            ))}
          </div>

          {state.method === 'multi' && (
            <div className="f-group">
              <label className="f-label">Section 14(1), (2) &amp; (3).</label>
              <div className="days-week-toggle days-week-toggle-stacked">
                {[
                  { d: 4, n: 200, note: '4-day workers (or <4 days/wk)' },
                  { d: 5, n: 260, note: '5-day workers' },
                  { d: 6, n: 300, note: '6-day workers' },
                  { d: 7, n: 365, note: '' },
                ].map(({ d, n, note }) => (
                  <button key={d} className={state.daysWeek === d ? 'active' : ''}
                    onClick={() => set({ daysWeek: d })}
                    title={note || `${d}-day work week`}>
                    <span className="days-week-mult">{n}</span>
                    {note && <span className="days-week-note">{note}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="method-fields">
            {(state.method === 'multi' || !state.method || state.method === '52week' || state.method === 'similar') && (
              <>
                <div className="f-group">
                  <label className="f-label">Total Earnings</label>
                  <div className="f-input-wrap"><span className="prefix">$</span>
                    <input className="f-input with-prefix" type="number" value={state.methodMultiEarn || ''}
                      onChange={e => set({ methodMultiEarn: Number(e.target.value) })}/></div>
                </div>
                <div className="f-group">
                  <label className="f-label">Days Worked</label>
                  <input className="f-input" type="number" value={state.methodMultiDays || ''}
                    onChange={e => set({ methodMultiDays: Number(e.target.value) })}/>
                </div>
              </>
            )}
            {state.method === 'straight' && (
              <>
                <div className="f-group">
                  <label className="f-label">Total Earnings</label>
                  <div className="f-input-wrap"><span className="prefix">$</span>
                    <input className="f-input with-prefix" type="number" value={state.methodStraightEarn || ''}
                      onChange={e => set({ methodStraightEarn: Number(e.target.value) })}/></div>
                </div>
                <div className="f-group">
                  <label className="f-label">Weeks Worked</label>
                  <input className="f-input" type="number" value={state.methodStraightWeeks || ''}
                    onChange={e => set({ methodStraightWeeks: Number(e.target.value) })}/>
                </div>
              </>
            )}
          </div>

          <div className="method-fields">
            <div className="f-group">
              <label className="f-label">Tips / Week</label>
              <div className="f-input-wrap"><span className="prefix">$</span>
                <input className="f-input with-prefix" type="number" value={state.adjTips || 0}
                  onChange={e => set({ adjTips: Number(e.target.value) })}/></div>
            </div>
            <div className="f-group">
              <label className="f-label">Board+Lodging / Week</label>
              <div className="f-input-wrap"><span className="prefix">$</span>
                <input className="f-input with-prefix" type="number" value={state.adjBoard || 0}
                  onChange={e => set({ adjBoard: Number(e.target.value) })}/></div>
            </div>
          </div>

          {/* Concurrent employment §14(6) — toggle + conditional input.
              When ON, downstream tiles consume composite AWW = base + concurrent. */}
          <div className="concurrent-toggle-row">
            <button
              type="button"
              className={'concurrent-toggle ' + (state.concurrentOn ? 'on' : '')}
              onClick={() => set({ concurrentOn: !state.concurrentOn })}
              aria-pressed={!!state.concurrentOn}>
              <span className="concurrent-toggle-knob" aria-hidden="true">{state.concurrentOn ? '✓' : '+'}</span>
              {state.concurrentOn ? 'Concurrent Employment ON' : 'Add Concurrent Employment'}
            </button>
            {state.concurrentOn && (
              <div className="f-group concurrent-input">
                <label className="f-label">Concurrent Employer AWW</label>
                <div className="f-input-wrap"><span className="prefix">$</span>
                  <input className="f-input with-prefix" type="number" value={state.adjConcurrent || 0}
                    onChange={e => set({ adjConcurrent: Number(e.target.value) })}/></div>
                <div className="concurrent-help">§14(6) — the concurrent AWW is added to base AWW; the composite drives every downstream tile.</div>
              </div>
            )}
          </div>

          {/* Result preview + Compute & Apply */}
          {preview && (
            <div className="aww-preview-card">
              <div className="aww-preview-head">
                <strong>Preview</strong>
                <span className="aww-preview-method">{preview.methodLabel}</span>
              </div>
              <div className="aww-preview-body">
                <div className="aww-preview-row">
                  <span className="lbl">Computed AWW</span>
                  <span className="val big">{fmt$(preview.aww)}</span>
                </div>
                <div className="aww-preview-row">
                  <span className="lbl">2/3 TT Rate{preview.capped ? ' (capped at max)' : ''}</span>
                  <span className="val">{fmt$(preview.ttRate)}/wk</span>
                </div>
                <div className="aww-preview-formula">{preview.formula}</div>
                {preview.breakdown.length > 0 && (
                  <details className="aww-preview-details">
                    <summary>Show breakdown</summary>
                    <table className="aww-preview-table">
                      <tbody>
                        {preview.breakdown.map((row, i) => (
                          <tr key={i}>
                            <td className="lbl">{row.label}</td>
                            <td className="val">{row.value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}
              </div>
            </div>
          )}

          <div className="aww-wizard-actions">
            <button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn primary" onClick={onApply}>
              Compute & Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SECTION 3 — TAB STRIP (Task 3)
// ============================================================================

function TabStrip({ tabs, activeTabId, tier, onSwitch, onNew, onClose, onRename, onReorder }) {
  const [editingId, setEditingId] = useState(null);
  const [draftName, setDraftName] = useState('');
  const dragIdRef = useRef(null);
  const [dragOverId, setDragOverId] = useState(null);

  const isPro = tier === 'pro' || tier === 'firm';
  const syncedCount = tabs.filter(t => t.synced !== false).length;

  const startRename = (tab) => {
    setEditingId(tab.id);
    setDraftName(tab.name || tab.clientName || 'New Case');
  };
  const commitRename = () => {
    if (editingId) onRename(editingId, draftName.trim() || 'New Case');
    setEditingId(null);
  };

  const onDragStart = (e, id) => {
    dragIdRef.current = id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-tab-id', id);
  };
  const onDragOver = (e, id) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragIdRef.current && dragIdRef.current !== id) setDragOverId(id);
  };
  const onDragLeave = () => setDragOverId(null);
  const onDrop = (e, id) => {
    e.preventDefault();
    const fromId = dragIdRef.current;
    setDragOverId(null);
    dragIdRef.current = null;
    if (!fromId || fromId === id) return;
    onReorder(fromId, id);
  };

  const onMouseDown = (e, tab) => {
    if (e.button === 1) {
      // Middle click closes the tab
      e.preventDefault();
      onClose(tab.id);
    }
  };

  return (
    <div className="tab-strip" role="tablist" aria-label="Workspace tabs">
      <div className="tab-strip-tabs">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isSynced = tab.synced !== false;
          const locked = !isPro && !isSynced;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              className={
                'tab-chip' +
                (isActive ? ' active' : '') +
                (dragOverId === tab.id ? ' drop-target' : '') +
                (locked ? ' locked' : '')
              }
              draggable
              onDragStart={(e) => onDragStart(e, tab.id)}
              onDragOver={(e) => onDragOver(e, tab.id)}
              onDragLeave={onDragLeave}
              onDrop={(e) => onDrop(e, tab.id)}
              onMouseDown={(e) => onMouseDown(e, tab)}
              onClick={() => onSwitch(tab.id)}
              onDoubleClick={() => startRename(tab)}
              title={
                (tab.wcbNumber ? `WCB#${tab.wcbNumber} · ` : '') +
                (locked ? 'Local-only — upgrade to sync this tab' : 'Synced')
              }
            >
              <span className="tab-chip-sync" aria-hidden="true">
                {locked ? '🔒' : (isSynced ? '☁︎' : '·')}
              </span>
              {editingId === tab.id ? (
                <input
                  autoFocus
                  className="tab-chip-rename"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    else if (e.key === 'Escape') setEditingId(null);
                  }}
                />
              ) : (
                <span className="tab-chip-label">
                  {tab.name || tab.clientName || 'New Case'}
                </span>
              )}
              <button
                className="tab-chip-close"
                aria-label="Close tab"
                onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
              >
                ×
              </button>
            </div>
          );
        })}
        <button
          className="tab-strip-new"
          aria-label="New tab"
          title="New tab (⌘T)"
          onClick={() => onNew()}
        >
          +
        </button>
      </div>
      {!isPro && (
        <div className="tab-strip-tier-note">
          Free tier: 1 case at a time. Upgrade to Pro to open multiple case tabs.
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SECTION 4 — Palette / Tile / Canvas / EquationCard (unchanged from artifact)
// ============================================================================

const PALETTE_ITEMS = [
  // pro:true mirrors TILE_SPECS in tiles.js. Free users see a lock badge on
  // these palette cards and hit the Paywall on click/drop.
  // `short` is the chip label used by the collapsed rail (icons like '⚕️' or
  // 'S11' don't read as the tile name in the narrow column).
  { type: 'SLU',           name: 'SLU',           icon: 'SLU',  short: 'SLU',    desc: 'Schedule Loss of Use — multi body part awards', pro: true },
  { type: 'LWEC',          name: 'LWEC',          icon: 'LW',   short: 'LW',     desc: 'Loss of Wage Earning Capacity bracket calc' },
  { type: 'CCP',           name: 'CCP / Award',   icon: 'CCP',  short: 'CCP',    desc: 'Period-by-period builder · TT/RE/TR/TP/NCLT/NME' },
  { type: 'Burns',         name: 'Burns Rate',    icon: 'BRN',  short: 'BRN',    desc: '3rd-party lien apportionment per Burns v Varick' },
  { type: 'Settlement',    name: 'Settlement',    icon: 'S32',  short: 'S32',    desc: 'Section 32 — settlement minus MSA, 15% fee on remainder' },
  { type: 'RateLookup',    name: 'Rate Lookup',   icon: '$/wk', short: '$/Wk',   desc: 'Max + Min rate by date' },
  { type: 'Radiculopathy', name: 'Radiculopathy', icon: 'S11',  short: 'Radic.', desc: 'S11.4 point system + nerve-root caps', pro: true },
  { type: 'MTG',           name: 'MTGs',          icon: '⚕️',   short: 'MTGs',   desc: 'NYS WCB Medical Treatment Guidelines — keyword search w/ citations' },
];

function Palette({ onAdd, onDragStart, isPro, collapsed, onToggleCollapsed }) {
  return (
    <aside className={'palette' + (collapsed ? ' palette-collapsed' : '')}>
      <div className="palette-toolbar">
        {!collapsed && <h2>Tile Palette</h2>}
        <button
          type="button"
          className="palette-toggle"
          onClick={onToggleCollapsed}
          title={collapsed ? 'Expand palette' : 'Collapse palette'}
          aria-label={collapsed ? 'Expand palette' : 'Collapse palette'}
          aria-expanded={!collapsed}>
          {collapsed ? '›' : '‹'}
        </button>
      </div>
      {PALETTE_ITEMS.map(item => {
        const locked = !!item.pro && !isPro;
        const shortLabel = item.short || item.icon;
        return (
          <button
            key={item.type}
            className={'palette-card' + (locked ? ' locked' : '')}
            draggable
            onDragStart={(e) => onDragStart(e, item.type)}
            onClick={() => onAdd(item.type)}
            title={
              collapsed
                ? (locked ? `${item.name} — Pro feature` : `${item.name} — ${item.desc}`)
                : (locked ? 'Pro feature — upgrade to use this tile' : item.desc)
            }>
            {collapsed ? (
              <span className="pc-short">
                {shortLabel}
                {item.pro && <span className={'pc-pro-dot' + (locked ? ' locked' : '')} aria-hidden="true" />}
              </span>
            ) : (
              <>
                <div className="pc-icon">{item.icon}</div>
                <div className="pc-name">
                  {item.name}
                  {item.pro && (
                    <span
                      className={'pc-pro-badge' + (locked ? ' locked' : '')}
                      aria-label={locked ? 'Pro feature' : 'Pro tier'}
                      style={{
                        marginLeft: '6px',
                        fontSize: '9px',
                        fontWeight: 800,
                        letterSpacing: '0.5px',
                        padding: '1px 6px',
                        borderRadius: '3px',
                        background: locked ? 'rgba(245,158,11,0.18)' : 'rgba(45,212,160,0.18)',
                        color: locked ? '#f59e0b' : '#2dd4a0',
                        verticalAlign: 'middle',
                      }}>
                      {locked ? '🔒 PRO' : 'PRO'}
                    </span>
                  )}
                </div>
                <div className="pc-desc">{item.desc}</div>
              </>
            )}
          </button>
        );
      })}
    </aside>
  );
}

function Tile({ tile, global, onUpdate, onRemove, onTilePointerDown, isRecent, perspective, onFeeApp }) {
  const tileRef = useRef(null);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0 });

  const handleMouseMove = (e) => {
    if (!perspective || perspective === 'off') return;
    const r = tileRef.current?.getBoundingClientRect();
    if (!r) return;
    const cx = (e.clientX - r.left) / r.width - 0.5;
    const cy = (e.clientY - r.top) / r.height - 0.5;
    const max = perspective === 'subtle' ? 2 : 4;
    setTilt({ rx: -cy * max, ry: cx * max });
  };
  const handleMouseLeave = () => setTilt({ rx: 0, ry: 0 });

  const spec = TILE_SPECS[tile.type];
  const Component = {
    SLU: SLUTile, LWEC: LWECTile, CCP: CCPTile,
    RateLookup: RateLookupTile, Radiculopathy: RadiculopathyTile,
    Burns: BurnsTile, Settlement: SettlementTile, MTG: MTGTile,
  }[tile.type];

  // #5 — Tile Size: scale(var(--tile-scale)) is prepended so the per-tile
  // size slider applies via the CSS custom property. The 3D perspective tilt
  // follows. Default --tile-scale is 1, so the rendered transform is unchanged.
  const transform = `scale(var(--tile-scale, 1)) perspective(800px) rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`;

  return (
    <div ref={tileRef}
      className={'tile ' + (isRecent ? 'recent' : '')}
      style={{
        left: tile.x, top: tile.y,
        width: spec.w, height: spec.h,
        transform,
        transition: tilt.rx === 0 && tilt.ry === 0 ? 'transform 200ms cubic-bezier(0.2, 0.9, 0.3, 1), box-shadow 200ms' : 'box-shadow 200ms',
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}>
      <div className="tile-header" onPointerDown={(e) => onTilePointerDown(e, tile.id)}>
        <span className="tile-handle">⋮⋮</span>
        <span className="tile-name">{spec.name}<span className="tile-instance"> #{tile.instance}</span></span>
        <button className="tile-close" onClick={() => onRemove(tile.id)} title="Remove">×</button>
      </div>
      <Component tile={tile} global={global} onUpdate={onUpdate} onFeeApp={onFeeApp} />
    </div>
  );
}

function rectsOverlap(a, b) {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}
function findEmptySlot(tiles, w, h, preferX = 0, preferY = 0, snap = GRID) {
  const snapped = (n) => Math.round(n / snap) * snap;
  preferX = Math.max(0, snapped(preferX));
  preferY = Math.max(0, snapped(preferY));
  const candidate = { x: preferX, y: preferY, w, h };
  const occupied = tiles.map(t => ({ x: t.x, y: t.y, w: TILE_SPECS[t.type].w, h: TILE_SPECS[t.type].h }));
  if (!occupied.some(r => rectsOverlap(candidate, r))) return { x: candidate.x, y: candidate.y };
  const step = snap;
  for (let radius = step; radius < 4000; radius += step) {
    for (let dx = 0; dx <= radius; dx += step) {
      for (let dy = 0; dy <= radius; dy += step) {
        if (Math.max(dx, dy) !== radius) continue;
        const candidates = [
          { x: preferX + dx, y: preferY + dy },
          { x: Math.max(0, preferX - dx), y: preferY + dy },
          { x: preferX + dx, y: Math.max(0, preferY - dy) },
        ];
        for (const c of candidates) {
          const cand = { x: c.x, y: c.y, w, h };
          if (!occupied.some(r => rectsOverlap(cand, r))) return { x: c.x, y: c.y };
        }
      }
    }
  }
  return { x: 0, y: 0 };
}

function Canvas({ tiles, global, onUpdate, onRemove, onAdd, mostRecentId, perspective, showGrid, snapSize, onFeeApp }) {
  const canvasRef = useRef(null);
  const [drag, setDrag] = useState(null);
  const [dropPreview, setDropPreview] = useState(null);

  // #5 — Workspace Size zoom: the .canvas is transform: scale(--workspace-scale)
  // from its top-left, so pointer offsets measured against its (already-scaled)
  // bounding rect must be divided back by the scale to recover logical canvas
  // coordinates. Defaults to 1 (no scale) → math is identical to before.
  const wsScale = () => {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--workspace-scale'));
    return v > 0 ? v : 1;
  };

  const onTilePointerDown = (e, id) => {
    if (e.button !== 0) return;
    const tile = tiles.find(t => t.id === id);
    if (!tile) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const z = wsScale();
    setDrag({ id, offsetX: (e.clientX - rect.left) / z - tile.x, offsetY: (e.clientY - rect.top) / z - tile.y });
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e) => {
      const rect = canvasRef.current.getBoundingClientRect();
      const tile = tiles.find(t => t.id === drag.id);
      if (!tile) return;
      const snap = snapSize || GRID;
      const z = wsScale();
      let x = (e.clientX - rect.left) / z - drag.offsetX;
      let y = (e.clientY - rect.top) / z - drag.offsetY;
      x = Math.max(0, snap > 0 ? Math.round(x / snap) * snap : x);
      y = Math.max(0, snap > 0 ? Math.round(y / snap) * snap : y);
      onUpdate({ ...tile, x, y, _dragging: true });
    };
    const onUp = () => {
      const tile = tiles.find(t => t.id === drag.id);
      if (tile) {
        const spec = TILE_SPECS[tile.type];
        const slot = findEmptySlot(tiles.filter(t => t.id !== drag.id), spec.w, spec.h, tile.x, tile.y, snapSize || GRID);
        onUpdate({ ...tile, x: slot.x, y: slot.y, _dragging: false });
      }
      setDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, tiles, snapSize, onUpdate]);

  const onDragOver = (e) => {
    if (!e.dataTransfer.types.includes('application/x-tile-type')) return;
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const type = e.dataTransfer.getData('application/x-tile-type') || sessionStorage.getItem('__dragType');
    const spec = TILE_SPECS[type] || TILE_SPECS.SLU;
    const snap = snapSize || GRID;
    const z = wsScale();
    const px = Math.round(((e.clientX - rect.left) / z) / snap) * snap;
    const py = Math.round(((e.clientY - rect.top) / z) / snap) * snap;
    setDropPreview({ x: Math.max(0, px), y: Math.max(0, py), w: spec.w, h: spec.h });
  };
  const onDragLeave = () => setDropPreview(null);
  const onDrop = (e) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('application/x-tile-type') || sessionStorage.getItem('__dragType');
    if (!type || !TILE_SPECS[type]) { setDropPreview(null); return; }
    const rect = canvasRef.current.getBoundingClientRect();
    const spec = TILE_SPECS[type];
    const snap = snapSize || GRID;
    const z = wsScale();
    const px = Math.max(0, Math.round(((e.clientX - rect.left) / z) / snap) * snap);
    const py = Math.max(0, Math.round(((e.clientY - rect.top) / z) / snap) * snap);
    onAdd(type, { preferX: px, preferY: py });
    setDropPreview(null);
  };

  return (
    <div className="canvas-wrap">
      <div ref={canvasRef}
        className={'canvas ' + (showGrid ? 'show-grid' : '')}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragLeave={onDragLeave}>
        {tiles.length === 0 && (
          <div className="canvas-empty">Click or drag a calculator from the palette to begin</div>
        )}
        {dropPreview && (
          <div className="drop-indicator" style={{ left: dropPreview.x, top: dropPreview.y, width: dropPreview.w, height: dropPreview.h }}/>
        )}
        {tiles.map(tile => (
          <Tile key={tile.id} tile={tile} global={global}
            onUpdate={onUpdate} onRemove={onRemove}
            onTilePointerDown={onTilePointerDown}
            isRecent={tile.id === mostRecentId}
            perspective={perspective}
            onFeeApp={onFeeApp}/>
        ))}
      </div>
    </div>
  );
}

function EquationCard({ tile, global, onFeeApp }) {
  const eq = useMemo(() => buildEquation(tile, global), [tile, global]);
  const [copied, setCopied] = useState(false);
  const ts = useMemo(() => {
    if (!tile.addedAt) return '';
    const d = new Date(tile.addedAt);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }, [tile.addedAt]);
  const spec = TILE_SPECS[tile.type];

  const onCopy = async () => {
    try { await navigator.clipboard.writeText(eq.mono); }
    catch (e) {
      const ta = document.createElement('textarea');
      ta.value = eq.mono;
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="eq-card">
      <div className="eq-head">
        <div>
          <span className="name">{spec.name}</span>
          <span className="ts">— added {ts}</span>
        </div>
        <div className="actions">
          {copied && <div className="copied-chip">Copied</div>}
          <button className="btn tiny" onClick={onCopy}>Copy</button>
          <button className="btn tiny primary" onClick={() => onFeeApp(tile)}>Generate Fee App</button>
        </div>
      </div>
      <div className="eq-body">
        <div className="eq-plain">{eq.plain}</div>
        <pre className="eq-mono">{eq.mono}</pre>
      </div>
    </div>
  );
}

const PAYWALL_COPY = {
  // Default — fee-app generation. Preserved as-is so feeapp.js's existing
  // 'feeapp:paywall' event surfaces the same message it always did.
  'fee-app': {
    title: 'Pro / Firm Subscription Required',
    body:  'Generate Fee App produces a court-ready WCB-EC-2.1 PDF with the equation, fee request, and assignment. This feature is gated behind a Pro or Firm subscription.',
  },
  // Hard tab cap on Free — second tab requires Pro/Firm. Replaces the prior
  // "1 synced + unlimited local" model so the workspace behaves like a true
  // single-case sandbox for free attorneys evaluating the product.
  'tab': {
    title: 'Multi-case tabs require Pro',
    body:  'The free workspace is limited to one case at a time. Upgrade to Pro or Firm to open additional case tabs and switch between cases without losing your place.',
  },
  // Per-tile gate — SLU + Radiculopathy mirror the /for-attorneys Pro tier.
  // The reason string includes the tile name so the message is specific.
  'pro-tile': {
    title: 'This tile is Pro-only',
    body:  'This calculator is part of the Pro tier. Upgrade to Pro or Firm to add it to your workspace canvas.',
  },
};

function Paywall({ onClose, reason, tileName }) {
  const copy = PAYWALL_COPY[reason] || PAYWALL_COPY['fee-app'];
  const body = (reason === 'pro-tile' && tileName)
    ? `${tileName} is part of the Pro tier. Upgrade to Pro or Firm to add it to your workspace canvas.`
    : copy.body;
  // Best-effort upgrade CTA — sends the user to the for-attorneys pricing
  // section. If that path ever moves, update here.
  const upgrade = () => { window.location.href = '/for-attorneys.html#pricing'; };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>{copy.title}</h3>
        <p>{body}</p>
        <div className="actions">
          <button className="btn" onClick={onClose}>Not now</button>
          <button className="btn primary" onClick={upgrade}>View plans</button>
        </div>
      </div>
    </div>
  );
}

// Formula reference modal — plain-language "how the math works" catalog.
// Reads window.CD.Formulas.GROUPS (js/formulas-data.js, the single source of
// truth shared with the mobile app), so NO formula text is duplicated here.
// Modeled on Paywall (.modal-backdrop / stopPropagation). Pro-tier items are
// blurred for free users with a "Pro" badge — informational gate only, no
// paywall wiring (the formulas are reference material, not a tile).
function FormulasModal({ onClose, tier }) {
  const isPro = tier === 'pro' || tier === 'firm';
  const F = (typeof window !== 'undefined' && window.CD && window.CD.Formulas) || null;
  const groups = (F && Array.isArray(F.GROUPS)) ? F.GROUPS : [];
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 560, width: '92vw', maxHeight: '86vh', overflowY: 'auto', padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <h3 style={{ flex: 1 }}>📐 Formula Reference</h3>
          <button className="btn ghost" onClick={onClose} title="Close">✕</button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--tx-faint)', margin: '0 0 14px' }}>
          Reference only — verify against the WCL and current WCB guidelines. Not legal advice.
        </p>

        {groups.length === 0 && (
          <p>Formula reference is unavailable.</p>
        )}

        {groups.map(group => (
          <div key={group.key}>
            <h4 style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx)', margin: '18px 0 8px' }}>{group.title}</h4>
            {(group.items || []).map(item => {
              const locked = item.tier === 'pro' && !isPro;
              return (
                <div
                  key={item.id}
                  style={{ background: 'var(--bg)', border: '1px solid var(--bd-soft)', borderRadius: 10, padding: 14, marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx)', flex: 1 }}>{item.name}</div>
                    {item.tier === 'pro' && (
                      <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.5px', textTransform: 'uppercase', color: '#fff', background: 'var(--ac)', borderRadius: 5, padding: '2px 7px' }}>Pro</span>
                    )}
                  </div>

                  <div
                    style={{
                      fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--tx)',
                      background: 'var(--tile)', border: '1px solid var(--bd-soft)',
                      borderRadius: 8, padding: '10px 12px', overflowX: 'auto',
                      ...(locked ? { filter: 'blur(5px)', userSelect: 'none', pointerEvents: 'none' } : null),
                    }}>
                    {item.formula}
                  </div>

                  {locked ? (
                    <div style={{ fontSize: 11, color: 'var(--tx-faint)', fontStyle: 'italic', marginTop: 8 }}>
                      🔒 Available on Pro
                    </div>
                  ) : (
                    <>
                      {Array.isArray(item.where) && item.where.length > 0 && (
                        <div style={{ marginTop: 10 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-dim)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 4 }}>where:</div>
                          {item.where.map((w, i) => (
                            <div key={i} style={{ fontSize: 11, color: 'var(--tx-dim)', lineHeight: 1.6 }}>
                              <span style={{ fontFamily: 'var(--mono)', color: 'var(--tx)', fontWeight: 600 }}>{w.symbol}</span>{' = ' + w.meaning}
                            </div>
                          ))}
                        </div>
                      )}
                      {item.explanation && (
                        <p style={{ fontSize: 12, color: 'var(--tx)', lineHeight: 1.6, margin: '10px 0 0' }}>{item.explanation}</p>
                      )}
                      {item.note && (
                        <div style={{ fontSize: 10, color: 'var(--tx-dim)', fontStyle: 'italic', marginTop: 6 }}>{item.note}</div>
                      )}
                      {item.citation && (
                        <div style={{ fontSize: 10, color: 'var(--tx-dim)', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--bd-soft)' }}>📎 {item.citation}</div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// SECTION 5 — DEFAULTS, TAB FACTORY
// ============================================================================

// DEFAULT_AWW_STATE / DEFAULT_TWEAKS / TILE_INPUT_DEFAULTS / hydrateWorkspaceData
// are defined in constants.js (loaded before this file in workspace.html). See
// ops/rd/specs/workspace_case_hydration.md for the canonical save format.
const DEFAULT_AWW_STATE = window.DEFAULT_AWW_STATE;
const DEFAULT_TWEAKS    = window.DEFAULT_TWEAKS;

function newTabId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'tab_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function newTab(opts = {}) {
  return {
    id: newTabId(),
    name: opts.name || 'New Case',
    clientName: opts.clientName || null,
    wcbNumber: opts.wcbNumber || null,
    awwState: { ...DEFAULT_AWW_STATE, ...(opts.awwState || {}) },
    tiles: opts.tiles || [],
    synced: opts.synced !== false, // default true; demoted to false by tier guard
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const SEED_TAB = newTab({
  name: 'Demo Case',
  awwState: { ...DEFAULT_AWW_STATE, caseName: 'Demo Case' },
  tiles: [{
    id: 1, type: 'SLU', x: 20, y: 20, instance: 1,
    addedAt: Date.now() - 5000,
    inputs: { rows: [{ id: 1, bp: 'Leg', pct: 35, priorWks: 0 }], priorPay: 5000 },
  }],
});

// ============================================================================
// SECTION 6 — ROOT APP (with Supabase persistence + tabs)
// ============================================================================

function App() {
  // Tab list & active selector
  const [tabs, setTabs] = useState(() => [SEED_TAB]);
  const [activeTabId, setActiveTabId] = useState(SEED_TAB.id);
  const activeTab = useMemo(
    () => tabs.find(t => t.id === activeTabId) || tabs[0],
    [tabs, activeTabId],
  );

  // UI scaffolding
  const [tweaks, setTweaks] = useState(() => ({ ...DEFAULT_TWEAKS }));
  const [mostRecentId, setMostRecentId] = useState(null);
  const [paywallState, setPaywallState] = useState(null); // null | { reason, tileName? }
  const [formulasOpen, setFormulasOpen] = useState(false); // Formula reference modal
  const [saveStatus, setSaveStatus] = useState('saved'); // saved|saving|error|offline
  // Transient feedback for the Save to My Cases button (distinct from the
  // background workspace auto-save indicator). Resets to null after 2–3s so
  // the button label flips back to "Save to My Cases".
  const [saveCaseStatus, setSaveCaseStatus] = useState(null); // null|'saving'|'saved'|'error'|'no-name'
  const [conflictToast, setConflictToast] = useState(null); // {remoteData, remoteVersion}
  const [tier, setTier] = useState(() => window.currentTier || 'free');

  // #5 — non-persisted view scale (Tile Size + Workspace Size sliders). Driven
  // as CSS custom properties on :root; intentionally NOT saved — both reset to
  // 1.0 on reload (no localStorage, not part of `tweaks`/persisted state).
  const [viewScale, setViewScale] = useState({ tile: 1, ws: 1 });
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--tile-scale', String(viewScale.tile));
    root.style.setProperty('--workspace-scale', String(viewScale.ws));
    return () => {
      root.style.removeProperty('--tile-scale');
      root.style.removeProperty('--workspace-scale');
    };
  }, [viewScale]);

  // Loaded flag — until true we don't auto-save (otherwise the seed tab
  // would clobber the user's persisted workspace immediately on mount).
  const [loaded, setLoaded] = useState(false);
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef(null);

  // ---------- Tier watcher ----------
  useEffect(() => {
    const onTier = () => setTier(window.currentTier || 'free');
    window.addEventListener('tier:changed', onTier);
    // also poll once a second for the first 10s in case auth-module sets it late
    let n = 0;
    const id = setInterval(() => {
      if (window.currentTier && window.currentTier !== tier) setTier(window.currentTier);
      if (++n > 10) clearInterval(id);
    }, 1000);
    return () => { window.removeEventListener('tier:changed', onTier); clearInterval(id); };
  }, []);

  // ---------- Initial load ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!window.WorkspacePersistence) {
          // Bootstrap not finished — defer
          setSaveStatus('offline');
          setLoaded(true);
          return;
        }
        const rawData = await window.WorkspacePersistence.loadWorkspace();

        // Hydrate every level (top-level / awwState / tile.inputs / nested
        // arrays) against canonical defaults. Lazy-migrates v1 rows in memory;
        // the next debounced save persists v2. See spec.
        let data = null;
        try {
          data = window.hydrateWorkspaceData
            ? window.hydrateWorkspaceData(rawData)
            : rawData;
        } catch (hydErr) {
          console.error('[workspace] HYDRATION_FAILED', hydErr);
          window.dispatchEvent(new CustomEvent('workspace:hydration-error', { detail: { error: hydErr } }));
          setSaveStatus('error');
          data = null;
        }

        // Free-tier overflow tabs from previous sessions live in localStorage
        const localKey = 'workspace.local-tabs.' + (window.workspaceUserId || 'anon');
        let localTabs = [];
        try {
          const raw = localStorage.getItem(localKey);
          if (raw && window.hydrateTab) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              localTabs = parsed.map(window.hydrateTab).filter(Boolean);
            }
          }
        } catch (e) {}

        if (cancelled) return;

        if (data && Array.isArray(data.tabs) && data.tabs.length > 0) {
          // Merge synced (DB) + local-only tabs; DB authoritative for any overlap
          const dbIds = new Set(data.tabs.map(t => t.id));
          const merged = [
            ...data.tabs.map(t => ({ ...t, synced: true })),
            ...localTabs.filter(t => !dbIds.has(t.id)).map(t => ({ ...t, synced: false })),
          ];
          setTabs(merged);
          setActiveTabId(
            merged.find(t => t.id === data.activeTabId) ? data.activeTabId : merged[0].id,
          );
          if (data.tweaks) setTweaks(t => ({ ...t, ...data.tweaks }));
        } else if (localTabs.length > 0) {
          setTabs(localTabs.map(t => ({ ...t, synced: false })));
          setActiveTabId(localTabs[0].id);
        }
        // else: keep the seed tab and let the first save persist it
      } catch (e) {
        console.error('[workspace] LOAD_FAILED', e);
        setSaveStatus('error');
      } finally {
        if (!cancelled) {
          setLoaded(true);
          // Start realtime sync once we've established a baseline
          if (window.WorkspaceSync) window.WorkspaceSync.startSync();
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ---------- Persistence (debounced 2s, replaces the sessionStorage block) ----------
  useEffect(() => {
    if (!loaded) return;
    dirtyRef.current = true;
    setSaveStatus('saving');
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      if (!window.WorkspacePersistence) { setSaveStatus('offline'); return; }

      // Tier-aware split: synced tabs → DB, unsynced → localStorage only
      const syncedTabs = tabs.filter(t => t.synced !== false);
      const unsyncedTabs = tabs.filter(t => t.synced === false);

      const payload = {
        formatVersion: window.WORKSPACE_FORMAT_VERSION || 2,
        tabs: syncedTabs,
        activeTabId: syncedTabs.find(t => t.id === activeTabId) ? activeTabId : (syncedTabs[0]?.id || null),
        tweaks,
        savedAt: new Date().toISOString(),
      };

      const result = await window.WorkspacePersistence.saveWorkspace(payload);
      if (result.ok) {
        // Sync the case index too (denormalized for the tab strip query)
        await window.WorkspacePersistence.syncCaseIndex(syncedTabs);
        // Stash unsynced (free-tier overflow) tabs locally
        try {
          const localKey = 'workspace.local-tabs.' + (window.workspaceUserId || 'anon');
          if (unsyncedTabs.length > 0) localStorage.setItem(localKey, JSON.stringify(unsyncedTabs));
          else localStorage.removeItem(localKey);
        } catch (e) {}
        dirtyRef.current = false;
        setSaveStatus('saved');
      } else if (result.conflict) {
        setSaveStatus('error');
        // Realtime channel will emit workspace:remote-change; we'll surface a toast there
      } else {
        setSaveStatus('error');
      }
    }, 2000);
    return () => clearTimeout(saveTimerRef.current);
  }, [tabs, activeTabId, tweaks, loaded]);

  // ---------- beforeunload — flush pending save ----------
  useEffect(() => {
    const onBeforeUnload = () => {
      if (!dirtyRef.current) return;
      // Best-effort synchronous trigger; modern browsers no longer await async work.
      // If the timer is still pending, fire it immediately so a save attempt at least starts.
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        const syncedTabs = tabs.filter(t => t.synced !== false);
        const payload = {
          formatVersion: window.WORKSPACE_FORMAT_VERSION || 2,
          tabs: syncedTabs,
          activeTabId,
          tweaks,
          savedAt: new Date().toISOString(),
        };
        try { window.WorkspacePersistence?.saveWorkspace(payload); } catch (e) {}
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [tabs, activeTabId, tweaks]);

  // ---------- Realtime — handle remote changes ----------
  useEffect(() => {
    const onRemote = (ev) => {
      const { remoteVersion, workspace_data: rawRemote } = ev.detail || {};
      if (!rawRemote) return;
      // Hydrate the remote payload — sender's formatVersion may be < ours,
      // and we never trust raw blobs onto local state. See spec §6.
      let remote = rawRemote;
      try {
        if (window.hydrateWorkspaceData) remote = window.hydrateWorkspaceData(rawRemote);
      } catch (e) {
        console.error('[workspace] HYDRATION_FAILED_REMOTE', e);
        return;
      }
      if (!remote) return;
      if (dirtyRef.current) {
        setConflictToast({ remoteVersion, workspace_data: remote });
      } else {
        // No local edits pending — silently reload
        if (Array.isArray(remote.tabs) && remote.tabs.length > 0) {
          setTabs(remote.tabs.map(t => ({ ...t, synced: true })));
          setActiveTabId(remote.activeTabId || remote.tabs[0].id);
          if (remote.tweaks) setTweaks(prev => ({ ...prev, ...remote.tweaks }));
        }
        if (window.WorkspacePersistence && remoteVersion) {
          window.WorkspacePersistence._setVersion(remoteVersion);
        }
      }
    };
    window.addEventListener('workspace:remote-change', onRemote);
    return () => window.removeEventListener('workspace:remote-change', onRemote);
  }, []);

  // ---------- Save error event surfaces toast ----------
  useEffect(() => {
    const onSaveErr = () => setSaveStatus('error');
    const onLoadErr = () => setSaveStatus('error');
    window.addEventListener('workspace:save-error', onSaveErr);
    window.addEventListener('workspace:load-error', onLoadErr);
    return () => {
      window.removeEventListener('workspace:save-error', onSaveErr);
      window.removeEventListener('workspace:load-error', onLoadErr);
    };
  }, []);

  // ---------- Theme application ----------
  useEffect(() => {
    document.body.setAttribute('data-theme', tweaks.theme);
    document.body.setAttribute('data-iridescence', tweaks.iridescence);
    document.body.setAttribute('data-density', 'comfortable');
  }, [tweaks.theme, tweaks.iridescence]);

  // ---------- Active-tab state helpers ----------
  // When the user types in the Case / WCB# field at the top of the workspace,
  // mirror that value into the tab's display name AND (if it parses as a WCB
  // identifier) the tab's wcbNumber. This is how "the tab name changes from
  // 'New Case' to that name/WCB#" — and how the value carries through to the
  // calculation_history.case_name column when Save to My Cases is invoked.
  const setActiveAwwPartial = (patch) => {
    setTabs(prev => prev.map(t => {
      if (t.id !== activeTabId) return t;
      const newAwwState = { ...t.awwState, ...patch };
      const next = { ...t, awwState: newAwwState, updatedAt: new Date().toISOString() };
      if (Object.prototype.hasOwnProperty.call(patch, 'caseName')) {
        const trimmed = (patch.caseName || '').trim();
        next.name = trimmed || 'New Case';
        // Loose WCB-ID heuristic: optional leading letter + 7–9 digits, no spaces.
        // Examples that match: G1234567, 12345678, W7654321.
        const noSpace = trimmed.replace(/\s/g, '');
        if (/^[A-Z]?\d{7,9}$/i.test(noSpace)) {
          next.wcbNumber = noSpace.toUpperCase();
        }
      }
      return next;
    }));
  };

  const setActiveTiles = (updater) => {
    setTabs(prev => prev.map(t => t.id === activeTabId
      ? {
          ...t,
          tiles: typeof updater === 'function' ? updater(t.tiles) : updater,
          updatedAt: new Date().toISOString(),
        }
      : t));
  };

  // ---------- Tab CRUD ----------
  const isPro = tier === 'pro' || tier === 'firm';

  const newTabAction = useCallback(() => {
    setTabs(prev => {
      // Free tier hard cap: one tab. Attempting to open a second tab fires
      // the Paywall modal — multi-case tabs are a Pro feature per the
      // /for-attorneys pricing copy. Pro/Firm: unlimited synced tabs.
      if (!isPro && prev.length >= 1) {
        setPaywallState({ reason: 'tab' });
        return prev;
      }
      const t = newTab({ synced: true });
      const next = [...prev, t];
      setActiveTabId(t.id);
      return next;
    });
  }, [isPro]);

  const closeTabAction = useCallback((id) => {
    setTabs(prev => {
      if (prev.length === 1) {
        // Always keep at least one tab — replace with a fresh one
        const t = newTab({ synced: true });
        setActiveTabId(t.id);
        return [t];
      }
      const idx = prev.findIndex(t => t.id === id);
      const next = prev.filter(t => t.id !== id);
      if (id === activeTabId) {
        const fallback = next[Math.max(0, idx - 1)] || next[0];
        setActiveTabId(fallback.id);
      }
      return next;
    });
  }, [activeTabId]);

  const renameTabAction = (id, name) => {
    setTabs(prev => prev.map(t => t.id === id
      ? { ...t, name, updatedAt: new Date().toISOString() }
      : t));
  };

  const reorderTabAction = (fromId, toId) => {
    setTabs(prev => {
      const next = [...prev];
      const fromIdx = next.findIndex(t => t.id === fromId);
      const toIdx = next.findIndex(t => t.id === toId);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  };

  const switchTabAction = (id) => setActiveTabId(id);

  // ---------- Keyboard shortcuts ⌘T / ⌘W / ⌘1–9 ----------
  useEffect(() => {
    const onKey = (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      // Don't intercept while user is typing in an input/textarea/contenteditable
      const tag = (e.target.tagName || '').toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag) || e.target.isContentEditable) return;

      if (e.key.toLowerCase() === 't') {
        e.preventDefault();
        newTabAction();
      } else if (e.key.toLowerCase() === 'w') {
        e.preventDefault();
        closeTabAction(activeTabId);
      } else if (/^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        if (tabs[idx]) {
          e.preventDefault();
          setActiveTabId(tabs[idx].id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tabs, activeTabId, newTabAction, closeTabAction]);

  // ---------- AWW computed (per active tab) ----------
  const awwState = activeTab.awwState;
  const computed = useMemo(() => {
    const max = lookupMax(awwState.doi);
    const min = lookupMin(awwState.doi);
    const maxRate = Number(awwState.maxRate) || (max ? max.max : 0);
    const minRate = (min && min.min) || 0;
    const ttRate = getCappedTT(awwState.aww, maxRate, minRate);
    const awwOverride = isAwwBelowMin(awwState.aww, minRate);
    return { maxRate, minRate, ttRate, awwOverride };
  }, [awwState.aww, awwState.doi, awwState.maxRate]);

  const global = {
    aww: awwState.aww, doi: awwState.doi,
    ttRate: computed.ttRate, maxRate: computed.maxRate, minRate: computed.minRate,
    // SLU rate is identically the TT rate after bounds (May 2026 rule); both
    // collapse to AWW when AWW < min for DOA.
    sluRate: computed.ttRate,
    awwOverride: computed.awwOverride,
  };

  // ---------- Tile actions on the active tab ----------
  const addTile = (type, opts = {}) => {
    const spec = TILE_SPECS[type];
    if (!spec) return;
    // Per-tile Pro gate: SLU + Radiculopathy require Pro/Firm. Both palette
    // click and canvas drop funnel through this function, so one check covers
    // both entry points.
    if (spec.pro && !isPro) {
      setPaywallState({ reason: 'pro-tile', tileName: spec.name });
      return;
    }
    const slot = findEmptySlot(activeTab.tiles, spec.w, spec.h, opts.preferX || 20, opts.preferY || 20, tweaks.snapSize || GRID);
    const sameTypeCount = activeTab.tiles.filter(t => t.type === type).length + 1;
    const id = Date.now() + Math.random();
    // Initialize inputs from the canonical default factory so new tiles enter
    // the system fully populated (see workspace_case_hydration.md). Without
    // this, a save before any user edit persists a tile with NO inputs key.
    const inputsFactory = window.TILE_INPUT_DEFAULTS && window.TILE_INPUT_DEFAULTS[type];
    let initialInputs = inputsFactory ? inputsFactory() : {};
    // CCP convenience: if the AWW section already has a DOA, prefill the
    // first period's start date at tile-creation time. FIX #1 — the start
    // defaults to DOI+1 (dayAfter), since the date of injury itself is not a
    // compensable lost-time day. Runs once, at creation only, and never when
    // the first period already has a start — later DOA edits never reach back
    // and rewrite a manually entered start.
    if (
      type === 'CCP'
      && awwState && awwState.doi
      && Array.isArray(initialInputs.periods)
      && initialInputs.periods[0]
      && !initialInputs.periods[0].start
    ) {
      const da = (typeof dayAfter === 'function') ? dayAfter(awwState.doi) : awwState.doi;
      const [first, ...rest] = initialInputs.periods;
      initialInputs = {
        ...initialInputs,
        periods: [{ ...first, start: da }, ...rest],
      };
    }
    const newT = {
      id, type, x: slot.x, y: slot.y,
      instance: sameTypeCount,
      addedAt: Date.now(),
      inputs: initialInputs,
    };
    setActiveTiles(prev => [...prev, newT]);
    setMostRecentId(id);
  };

  const updateTile = (next) => {
    setActiveTiles(prev => prev.map(t => t.id === next.id ? next : t));
    setMostRecentId(next.id);
  };

  const removeTile = (id) => {
    setActiveTiles(prev => prev.filter(t => t.id !== id));
  };

  // ---------- Save to My Cases ----------
  // Writes one row per artifact (AWW row + one per tile) to
  // calculation_history with the active tab's case name as the grouping key.
  // The /dashboard/my-cases page reads from the same table via getUserCases(),
  // so saved cases appear there immediately on next load.
  const saveCaseAction = useCallback(async () => {
    const trimmedName = (activeTab.awwState.caseName || activeTab.name || '').trim();
    if (!trimmedName || trimmedName === 'New Case') {
      setSaveCaseStatus('no-name');
      setTimeout(() => setSaveCaseStatus(null), 2500);
      return;
    }
    const supa = window.supa;
    const userId = window.workspaceUserId;
    if (!supa || !userId) {
      setSaveCaseStatus('error');
      setTimeout(() => setSaveCaseStatus(null), 3000);
      return;
    }
    setSaveCaseStatus('saving');
    try {
      // Composite snapshot row — the AWW header itself becomes a calculation
      // entry so the case shows up in My Cases even with no tiles on canvas.
      const aw = activeTab.awwState || {};
      const max = lookupMax(aw.doi);
      const min = lookupMin(aw.doi);
      const maxRate = Number(aw.maxRate) || (max ? max.max : 0);
      const minRate = (min && min.min) || 0;
      const ttRate = getCappedTT(aw.aww, maxRate, minRate);

      const rows = [];
      rows.push({
        user_id: userId,
        calculator_type: 'aww',
        case_name: trimmedName,
        input_data: {
          aww: aw.aww,
          doi: aw.doi,
          doa: aw.doi, // native-app alias
          method: aw.method,
          daysWeek: aw.daysWeek,
          maxRate,
          adjTips: aw.adjTips || 0,
          adjBoard: aw.adjBoard || 0,
          adjConcurrent: aw.adjConcurrent || 0,
          concurrentOn: !!aw.concurrentOn,
          methodMultiEarn: aw.methodMultiEarn,
          methodMultiDays: aw.methodMultiDays,
          methodStraightEarn: aw.methodStraightEarn,
          methodStraightWeeks: aw.methodStraightWeeks,
          caseName: trimmedName,
          wcbNumber: activeTab.wcbNumber || null,
        },
        result_data: { ttRate, maxRate, minRate },
      });

      for (const tile of (activeTab.tiles || [])) {
        const calcType = (tile.type || '').toLowerCase();
        let eq = null;
        if (typeof window.buildEquation === 'function') {
          try { eq = window.buildEquation(tile, global); } catch (e) { /* per-tile failure non-fatal */ }
        }
        rows.push({
          user_id: userId,
          calculator_type: calcType,
          case_name: trimmedName,
          input_data: {
            ...(tile.inputs || {}),
            aww: aw.aww,
            doi: aw.doi,
            doa: aw.doi,
          },
          result_data: eq ? {
            plain: eq.plain || null,
            mono: eq.mono || null,
            fee: typeof eq.fee === 'number' ? eq.fee : null,
          } : null,
        });
      }

      const { error } = await supa.from('calculation_history').insert(rows);
      if (error) throw error;
      setSaveCaseStatus('saved');
      setTimeout(() => setSaveCaseStatus(null), 2500);
    } catch (err) {
      console.error('[workspace] SAVE_TO_MY_CASES_FAILED', err);
      setSaveCaseStatus('error');
      setTimeout(() => setSaveCaseStatus(null), 3000);
    }
  }, [activeTab]); // global is derived from activeTab so re-binds with it

  // ---------- Delete Case ----------
  // Removes the current tab. closeTabAction already handles the single-tab
  // fallback (replaces the last remaining tab with a fresh blank one), so
  // this just adds a confirm prompt and delegates.
  const deleteCaseAction = useCallback(() => {
    const label = (activeTab.awwState?.caseName || activeTab.name || '').trim() || 'this case';
    const onlyTab = tabs.length === 1;
    const msg = onlyTab
      ? `Delete "${label}"? This is your only open tab — it will be replaced with a fresh blank case. Anything you've saved to My Cases is not affected.`
      : `Delete "${label}" from the workspace? Anything you've saved to My Cases is not affected.`;
    if (!window.confirm(msg)) return;
    closeTabAction(activeTabId);
  }, [activeTab, activeTabId, tabs.length, closeTabAction]);

  const onPaletteDragStart = (e, type) => {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/x-tile-type', type);
    sessionStorage.setItem('__dragType', type);
  };

  const onFeeApp = (tile) => {
    // Build context from the active tab + tile, then expose for feeapp.js
    // (which reads window.WorkspaceFeeAppContext when no arg is passed).
    const ctx = {
      claimantName: awwState.caseName || activeTab.clientName || activeTab.name || '',
      wcbNumber:    activeTab.wcbNumber || '',
      doi:          awwState.doi,
      aww:          awwState.aww,
      feeEquation:  '',
      attorneyName: (window.workspaceUserEmail || '').split('@')[0] || '',
      firmName:     '',
    };
    if (typeof window.buildEquation === 'function') {
      try {
        const eq = window.buildEquation(tile, global);
        // Use the prose `plain` form for the OC-400.1 FeeRequestExplanation
        // field — it auto-wraps into the form's narrow box. The line-by-line
        // `mono` form gets truncated at ~4 lines in the rendered PDF.
        ctx.feeEquation = eq?.plain || eq?.mono || '';
        // Numeric eligible fee — feeapp.js floors to nearest $5 for autofill.
        ctx.feeRequested = (typeof eq?.fee === 'number' && isFinite(eq.fee) && eq.fee > 0) ? eq.fee : 0;
        // Tile-derived OC-400.1 § A checkboxes (e.g. SLU → FeeReason3).
        // Modal-side manual selections (death benefits, other) merged later.
        ctx.feeReasons = Array.isArray(eq?.feeReasons) ? eq.feeReasons : [];
      } catch (e) { /* tile-specific failure is non-fatal */ }
    }
    window.WorkspaceFeeAppContext = ctx;
    if (typeof window.triggerFeeApp === 'function') window.triggerFeeApp(ctx);
    else setPaywallState({ reason: 'fee-app' });
  };

  // feeapp.js dispatches 'feeapp:paywall' when a non-Pro user invokes the
  // generator. Surface the same paywall the workspace already uses.
  useEffect(() => {
    const onPaywall = () => setPaywallState({ reason: 'fee-app' });
    window.addEventListener('feeapp:paywall', onPaywall);
    return () => window.removeEventListener('feeapp:paywall', onPaywall);
  }, []);

  // ---------- Render ----------
  return (
    <>
      <TabStrip
        tabs={tabs}
        activeTabId={activeTabId}
        tier={tier}
        onSwitch={switchTabAction}
        onNew={newTabAction}
        onClose={closeTabAction}
        onRename={renameTabAction}
        onReorder={reorderTabAction}/>

      <AWWStrip
        state={awwState}
        set={setActiveAwwPartial}
        computed={computed}
        themeName={tweaks.theme}
        setTheme={(t) => setTweaks(prev => ({ ...prev, theme: t }))}
        saveStatus={saveStatus}
        onSaveCase={saveCaseAction}
        onDeleteCase={deleteCaseAction}
        saveCaseStatus={saveCaseStatus}
        viewScale={viewScale}
        setViewScale={setViewScale}
        onOpenFormulas={() => setFormulasOpen(true)}/>

      <div className={'workspace' + (tweaks.paletteCollapsed ? ' palette-collapsed' : '')}>
        <Palette
          onAdd={addTile}
          onDragStart={onPaletteDragStart}
          isPro={isPro}
          collapsed={!!tweaks.paletteCollapsed}
          onToggleCollapsed={() => setTweaks(prev => ({ ...prev, paletteCollapsed: !prev.paletteCollapsed }))}/>
        <Canvas
          tiles={activeTab.tiles}
          global={global}
          onUpdate={updateTile}
          onRemove={removeTile}
          onAdd={addTile}
          mostRecentId={mostRecentId}
          perspective={tweaks.perspective}
          showGrid={tweaks.showGrid}
          snapSize={tweaks.snapSize}
          onFeeApp={onFeeApp}/>
      </div>

      {activeTab.tiles.length > 0 && (
        <section className="eq-region">
          <h2>Equation Cards · {activeTab.tiles.length}</h2>
          <div className="eq-stack">
            {[...activeTab.tiles].sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0)).map(tile => (
              <EquationCard key={tile.id} tile={tile} global={global} onFeeApp={onFeeApp} />
            ))}
          </div>
        </section>
      )}

      <footer className="disclaimer">
        Informational only — verify against WCB records. Not legal advice.
      </footer>

      {paywallState && <Paywall onClose={() => setPaywallState(null)} reason={paywallState.reason} tileName={paywallState.tileName} />}

      {formulasOpen && <FormulasModal onClose={() => setFormulasOpen(false)} tier={tier} />}

      {conflictToast && (
        <div className="sync-toast" role="alert">
          <span>Workspace updated on another device.</span>
          <button className="btn tiny" onClick={() => {
            // Defensive re-hydrate — onRemote already hydrates, but a future
            // code path could stuff raw data into conflictToast.workspace_data.
            let wd = conflictToast.workspace_data;
            try {
              if (window.hydrateWorkspaceData) wd = window.hydrateWorkspaceData(wd) || wd;
            } catch (e) {
              console.error('[workspace] HYDRATION_FAILED_RELOAD', e);
            }
            if (wd && Array.isArray(wd.tabs) && wd.tabs.length > 0) {
              setTabs(wd.tabs.map(t => ({ ...t, synced: true })));
              setActiveTabId(wd.activeTabId || wd.tabs[0].id);
              if (wd.tweaks) setTweaks(prev => ({ ...prev, ...wd.tweaks }));
            }
            if (window.WorkspacePersistence && conflictToast.remoteVersion) {
              window.WorkspacePersistence._setVersion(conflictToast.remoteVersion);
            }
            dirtyRef.current = false;
            setConflictToast(null);
          }}>Reload</button>
          <button className="btn tiny ghost" onClick={() => setConflictToast(null)}>Keep Local</button>
        </div>
      )}

      <WorkspaceTweaks tweaks={tweaks} setTweaks={(patch) => setTweaks(prev => ({ ...prev, ...patch }))} />
    </>
  );
}

// ---------- Tweaks Panel (unchanged) ----------
function WorkspaceTweaks({ tweaks, setTweaks }) {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const onMsg = (e) => {
      if (e.data?.type === '__activate_edit_mode') setActive(true);
      else if (e.data?.type === '__deactivate_edit_mode') setActive(false);
    };
    window.addEventListener('message', onMsg);
    try { window.parent.postMessage({ type: '__edit_mode_available' }, '*'); } catch (e) {}
    return () => window.removeEventListener('message', onMsg);
  }, []);

  if (!active) return null;

  return (
    <div style={{
      position: 'fixed', right: 20, bottom: 20, width: 280,
      background: 'var(--tile)', border: '1px solid var(--bd)',
      borderRadius: 10, padding: 14, boxShadow: 'var(--shadow)',
      zIndex: 200, fontSize: 12,
    }}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 12}}>
        <strong style={{textTransform:'uppercase', letterSpacing:'0.08em', fontSize: 11}}>Tweaks</strong>
        <button className="tile-close" onClick={() => {
          setActive(false);
          try { window.parent.postMessage({type:'__edit_mode_dismissed'}, '*'); } catch (e) {}
        }}>×</button>
      </div>

      <TweakRow label="Theme">
        <div className="theme-switch" style={{flex:1}}>
          {['onyx','eggshell','aurora'].map(t => (
            <button key={t} className={tweaks.theme === t ? 'active' : ''} onClick={() => setTweaks({ theme: t })}>{t}</button>
          ))}
        </div>
      </TweakRow>
      <TweakRow label="Iridescence">
        <select className="f-select" value={tweaks.iridescence} onChange={e => setTweaks({ iridescence: e.target.value })}>
          <option value="off">Off</option>
          <option value="subtle">Subtle</option>
          <option value="medium">Medium</option>
          <option value="strong">Strong</option>
        </select>
      </TweakRow>
      <TweakRow label="Perspective">
        <select className="f-select" value={tweaks.perspective} onChange={e => setTweaks({ perspective: e.target.value })}>
          <option value="off">Off</option>
          <option value="subtle">Subtle ~2°</option>
          <option value="strong">Strong 4°</option>
        </select>
      </TweakRow>
      <TweakRow label="Grid Snap">
        <select className="f-select" value={tweaks.snapSize} onChange={e => setTweaks({ snapSize: Number(e.target.value) })}>
          <option value="20">20px</option>
          <option value="10">10px</option>
          <option value="0">Off</option>
        </select>
      </TweakRow>
      <TweakRow label="Show Grid">
        <input type="checkbox" checked={tweaks.showGrid} onChange={e => setTweaks({ showGrid: e.target.checked })}/>
      </TweakRow>
      <TweakRow label="Pre-seed demo">
        <input type="checkbox" checked={tweaks.preseedDemo} onChange={e => setTweaks({ preseedDemo: e.target.checked })}/>
      </TweakRow>
    </div>
  );
}
function TweakRow({ label, children }) {
  return (
    <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, padding:'6px 0', borderBottom:'1px solid var(--bd-soft)'}}>
      <span style={{color:'var(--tx-dim)'}}>{label}</span>
      <div>{children}</div>
    </div>
  );
}

// Expose computeAWW for tests / external use
window.WorkspaceComputeAWW = computeAWW;

// Mount
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
