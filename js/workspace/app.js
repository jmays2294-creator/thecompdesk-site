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

function AWWStrip({ state, set, computed, themeName, setTheme, saveStatus }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null); // computed result, prior to apply

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
    <div className="aww-strip">
      <div className="aww-row">
        <div className="aww-title-block">
          <h1>Pro Attorney Calculator Workspace</h1>
          <div className="sub">All calculators in one canvas. Set AWW & DOI once — every tile updates automatically.</div>
        </div>
        <div className="right-cluster">
          <div className={'save-indicator ' + (saveStatus === 'saving' ? 'saving' : saveStatus === 'error' ? 'error' : '')}>
            <span className="dot"></span>
            {saveStatus === 'saving' ? 'Saving…'
              : saveStatus === 'error' ? 'Save error'
              : saveStatus === 'offline' ? 'Offline'
              : 'Saved'}
          </div>
          <div className="theme-switch">
            {['onyx','eggshell','aurora'].map(t => (
              <button key={t} className={themeName === t ? 'active' : ''} onClick={() => setTheme(t)}>{t.toUpperCase()}</button>
            ))}
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
        {/* Method citation line — Change 2. Stacks below tt-display on
            desktop; wraps independently on mobile. */}
        <div className="aww-citation" aria-label="Active §14 method citation">
          {methodCitation(state).map((piece, i) => (
            <span key={i} className="aww-citation-piece">
              {i > 0 ? <span className="aww-citation-sep">·</span> : null}
              {piece}
            </span>
          ))}
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
  { type: 'SLU',           name: 'SLU',           icon: 'SLU',  desc: 'Schedule Loss of Use — multi body part awards', pro: true },
  { type: 'LWEC',          name: 'LWEC',          icon: 'LW',   desc: 'Loss of Wage Earning Capacity bracket calc' },
  { type: 'CCP',           name: 'CCP / Award',   icon: 'CCP',  desc: 'Period-by-period builder · TT/RE/TR/TP/NCLT/NME' },
  { type: 'Burns',         name: 'Burns Rate',    icon: 'BRN',  desc: '3rd-party lien apportionment per Burns v Varick' },
  { type: 'Settlement',    name: 'Settlement',    icon: 'S32',  desc: 'Section 32 — settlement minus MSA, 15% fee on remainder' },
  { type: 'RateLookup',    name: 'Rate Lookup',   icon: '$/wk', desc: 'Max + Min rate by date' },
  { type: 'Radiculopathy', name: 'Radiculopathy', icon: 'S11',  desc: 'S11.4 point system + nerve-root caps', pro: true },
];

function Palette({ onAdd, onDragStart, isPro }) {
  return (
    <aside className="palette">
      <h2>Tile Palette</h2>
      {PALETTE_ITEMS.map(item => {
        const locked = !!item.pro && !isPro;
        return (
          <button
            key={item.type}
            className={'palette-card' + (locked ? ' locked' : '')}
            draggable
            onDragStart={(e) => onDragStart(e, item.type)}
            onClick={() => onAdd(item.type)}
            title={locked ? 'Pro feature — upgrade to use this tile' : item.desc}>
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
          </button>
        );
      })}
    </aside>
  );
}

function Tile({ tile, global, onUpdate, onRemove, onTilePointerDown, isRecent, perspective }) {
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
    Burns: BurnsTile, Settlement: SettlementTile,
  }[tile.type];

  const transform = `perspective(800px) rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`;

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
      <Component tile={tile} global={global} onUpdate={onUpdate} />
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

function Canvas({ tiles, global, onUpdate, onRemove, onAdd, mostRecentId, perspective, showGrid, snapSize }) {
  const canvasRef = useRef(null);
  const [drag, setDrag] = useState(null);
  const [dropPreview, setDropPreview] = useState(null);

  const onTilePointerDown = (e, id) => {
    if (e.button !== 0) return;
    const tile = tiles.find(t => t.id === id);
    if (!tile) return;
    const rect = canvasRef.current.getBoundingClientRect();
    setDrag({ id, offsetX: e.clientX - rect.left - tile.x, offsetY: e.clientY - rect.top - tile.y });
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e) => {
      const rect = canvasRef.current.getBoundingClientRect();
      const tile = tiles.find(t => t.id === drag.id);
      if (!tile) return;
      const snap = snapSize || GRID;
      let x = e.clientX - rect.left - drag.offsetX;
      let y = e.clientY - rect.top - drag.offsetY;
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
    const px = Math.round((e.clientX - rect.left) / snap) * snap;
    const py = Math.round((e.clientY - rect.top) / snap) * snap;
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
    const px = Math.max(0, Math.round((e.clientX - rect.left) / snap) * snap);
    const py = Math.max(0, Math.round((e.clientY - rect.top) / snap) * snap);
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
            perspective={perspective}/>
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

// ============================================================================
// SECTION 5 — DEFAULTS, TAB FACTORY
// ============================================================================

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
  theme: 'onyx',
  iridescence: 'subtle',
  perspective: 'subtle',
  snapSize: 20,
  showGrid: false,
  preseedDemo: true,
};

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
  const [saveStatus, setSaveStatus] = useState('saved'); // saved|saving|error|offline
  const [conflictToast, setConflictToast] = useState(null); // {remoteData, remoteVersion}
  const [tier, setTier] = useState(() => window.currentTier || 'free');

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
        const data = await window.WorkspacePersistence.loadWorkspace();

        // Free-tier overflow tabs from previous sessions live in localStorage
        const localKey = 'workspace.local-tabs.' + (window.workspaceUserId || 'anon');
        let localTabs = [];
        try {
          const raw = localStorage.getItem(localKey);
          if (raw) localTabs = JSON.parse(raw);
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
      const { remoteVersion, workspace_data } = ev.detail || {};
      if (!workspace_data) return;
      if (dirtyRef.current) {
        setConflictToast({ remoteVersion, workspace_data });
      } else {
        // No local edits pending — silently reload
        if (Array.isArray(workspace_data.tabs) && workspace_data.tabs.length > 0) {
          setTabs(workspace_data.tabs.map(t => ({ ...t, synced: true })));
          setActiveTabId(workspace_data.activeTabId || workspace_data.tabs[0].id);
          if (workspace_data.tweaks) setTweaks(prev => ({ ...prev, ...workspace_data.tweaks }));
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
  const setActiveAwwPartial = (patch) => {
    setTabs(prev => prev.map(t => t.id === activeTabId
      ? { ...t, awwState: { ...t.awwState, ...patch }, updatedAt: new Date().toISOString() }
      : t));
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
    const newT = { id, type, x: slot.x, y: slot.y, instance: sameTypeCount, addedAt: Date.now() };
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
        saveStatus={saveStatus}/>

      <div className="workspace">
        <Palette onAdd={addTile} onDragStart={onPaletteDragStart} isPro={isPro} />
        <Canvas
          tiles={activeTab.tiles}
          global={global}
          onUpdate={updateTile}
          onRemove={removeTile}
          onAdd={addTile}
          mostRecentId={mostRecentId}
          perspective={tweaks.perspective}
          showGrid={tweaks.showGrid}
          snapSize={tweaks.snapSize}/>
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

      {conflictToast && (
        <div className="sync-toast" role="alert">
          <span>Workspace updated on another device.</span>
          <button className="btn tiny" onClick={() => {
            const wd = conflictToast.workspace_data;
            if (Array.isArray(wd.tabs) && wd.tabs.length > 0) {
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
