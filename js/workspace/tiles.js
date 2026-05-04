/* Tile components — read globals from window: SLU_BP, LWEC_BR, NERVE_CAPS, ranks, fmt$, fmtN, etc. */
const { useState, useEffect, useMemo, useRef } = React;

const TILE_SPECS = {
  SLU:           { w: 480, h: 600, name: 'Schedule Loss of Use' },
  LWEC:          { w: 400, h: 460, name: 'Loss of Wage Earning Capacity' },
  CCP:           { w: 560, h: 600, name: 'CCP / Award Builder' },
  RateLookup:    { w: 320, h: 240, name: 'Rate Lookup' },
  Radiculopathy: { w: 480, h: 720, name: 'Radiculopathy Scorer' },
  Burns:         { w: 460, h: 520, name: 'Burns Rate (3rd-Party Lien)' },
  Settlement:    { w: 420, h: 360, name: 'Section 32 Settlement' },
};

// ---------- Inherited rate strip ----------
function Inherited({ ttRate, maxRate, minRate, source = 'global' }) {
  return (
    <div className="tile-inherited">
      <span><span className="tag">TT</span><span className="v">{fmt$(ttRate)}/wk</span></span>
      <span><span className="tag">Max</span><span className="v">{fmt$(maxRate)}</span></span>
      <span><span className="tag">Min</span><span className="v">{minRate ? fmt$(minRate) : '—'}</span></span>
      <span style={{marginLeft:'auto', color:'var(--tx-faint)'}}>from {source}</span>
    </div>
  );
}

// ====================================================================
// SLU Tile
// ====================================================================
function SLUTile({ tile, global, onUpdate }) {
  const inputs = tile.inputs || { rows: [{ id: 1, bp: 'Leg', pct: 0, priorWks: 0 }], priorPay: 0, priorTTRWks: 0 };
  const tt = global.ttRate;

  const setInputs = (next) => onUpdate({ ...tile, inputs: { ...inputs, ...next } });

  const addRow = () => {
    const id = Date.now();
    setInputs({ rows: [...inputs.rows, { id, bp: 'Leg', pct: 0, priorWks: 0 }] });
  };
  const updateRow = (id, patch) => {
    setInputs({ rows: inputs.rows.map(r => r.id === id ? { ...r, ...patch } : r) });
  };
  const removeRow = (id) => {
    setInputs({ rows: inputs.rows.filter(r => r.id !== id) });
  };

  const computed = useMemo(() => {
    let totalWeeks = 0;
    const rowOut = inputs.rows.map(r => {
      const bp = SLU_BP.find(b => b.n === r.bp) || SLU_BP[0];
      const sluWks = (Number(r.pct) / 100) * bp.w;
      const phpWks = Math.max(0, Number(r.priorWks || 0) - bp.hp);
      const totWks = sluWks + phpWks;
      totalWeeks += totWks;
      return { ...r, bp, sluWks, phpWks, totWks };
    });
    const grossTotal = totalWeeks * tt;
    // §15(3)(w) credit at TOTAL rate — distinct from per-row PHP. When the
    // case-level prior weeks of TT/TR/TP exceed 130, the carrier credits
    // (priorWks − 130) × TT rate against the gross SLU value.
    const priorTTRWks = Number(inputs.priorTTRWks || 0);
    const creditWks = priorTTRWks > 130 ? priorTTRWks - 130 : 0;
    const creditDollars = creditWks * tt;
    const total = Math.max(0, grossTotal - creditDollars);
    const moving = Math.max(0, total - Number(inputs.priorPay || 0));
    const fee = moving * 0.15;
    const net = moving - fee;
    return { rowOut, totalWeeks, grossTotal, creditWks, creditDollars, total, moving, fee, net };
  }, [inputs, tt]);

  return (
    <>
      <Inherited {...global} />
      <div className="tile-body">
        <div style={{display:'grid', gap:8}}>
          {inputs.rows.map(r => (
            <div className="row cols-tile" key={r.id}>
              <div className="f-group">
                <label className="f-label">Body Part</label>
                <select className="f-select" value={r.bp} onChange={e => updateRow(r.id, { bp: e.target.value })}>
                  {SLU_BP.map(b => <option key={b.n} value={b.n}>{b.n} ({b.w} wks)</option>)}
                </select>
              </div>
              <div className="f-group">
                <label className="f-label">% SLU</label>
                <input className="f-input" type="number" min="0" max="100" value={r.pct}
                  onChange={e => updateRow(r.id, { pct: e.target.value })} />
              </div>
              <div className="f-group">
                <label className="f-label">PHP Wks (per part)</label>
                <input className="f-input" type="number" min="0" value={r.priorWks}
                  onChange={e => updateRow(r.id, { priorWks: e.target.value })} />
              </div>
              <button className="delete-row" onClick={() => removeRow(r.id)} title="Remove">×</button>
            </div>
          ))}
        </div>
        <button className="btn tiny" onClick={addRow}>+ Add Body Part</button>

        <div className="f-group" style={{maxWidth: 260}}>
          <label className="f-label">Prior TT / TR / TP Weeks (§15(3)(w))</label>
          <input className="f-input" type="number" min="0" step="0.5" value={inputs.priorTTRWks || 0}
            onChange={e => setInputs({ priorTTRWks: e.target.value })} />
          <span style={{fontSize:11, color:'var(--tx-faint)'}}>
            Case-level prior weeks. Excess over 130 credited at the TT (total) rate.
          </span>
        </div>

        <div className="f-group" style={{maxWidth: 220}}>
          <label className="f-label">Prior Payments Already Made</label>
          <div className="f-input-wrap">
            <span className="prefix">$</span>
            <input className="f-input with-prefix" type="number" min="0" value={inputs.priorPay}
              onChange={e => setInputs({ priorPay: e.target.value })} />
          </div>
          <span style={{fontSize:11, color:'var(--tx-faint)'}}>Deducted before attorney fee</span>
        </div>

        <div className="results">
          <div className="r-row"><span className="l">Total SLU Weeks</span><span className="v">{fmtN(computed.totalWeeks, 2)}</span></div>
          <div className="r-row"><span className="l">Gross SLU Value</span><span className="v">{fmt$(computed.grossTotal)}</span></div>
          {computed.creditWks > 0 && (
            <div className="r-row"><span className="l">§15(3)(w) Credit</span><span className="v">−{fmtN(computed.creditWks, 2)} wks @ {fmt$(tt)} = −{fmt$(computed.creditDollars)}</span></div>
          )}
          <div className="r-row big"><span className="l">Total Award</span><span className="v">{fmt$(computed.total)}</span></div>
          <div className="r-row"><span className="l">Moving (after prior)</span><span className="v">{fmt$(computed.moving)}</span></div>
          <div className="r-row"><span className="l">Attorney Fee (15%)</span><span className="v">{fmt$(computed.fee)}</span></div>
          <div className="r-row net"><span className="l">Net to Claimant</span><span className="v">{fmt$(computed.net)}</span></div>
        </div>
      </div>
    </>
  );
}

// ====================================================================
// LWEC Tile
// ====================================================================
function LWECTile({ tile, global, onUpdate }) {
  const inputs = tile.inputs || { pct: 50, feePerWeek: 0, priorTTRWks: 0 };
  const tt = global.ttRate;
  const aww = global.aww;

  const setInputs = (next) => onUpdate({ ...tile, inputs: { ...inputs, ...next } });

  const computed = useMemo(() => {
    const pct = Number(inputs.pct) || 0;
    const classRate = tt * (pct / 100);
    const bracket = lwecBracket(pct);
    const isLifetime = bracket.mw === 'Lifetime';
    // §15(3)(w) credit: when prior weeks of TT/TR/TP exceed 130, the carrier
    // takes credit on the LWEC award by reducing the awarded weeks (not dollars
    // — the credit is paid week-for-week at the classification rate).
    const priorWks = Number(inputs.priorTTRWks || 0);
    const creditWks = priorWks > 130 ? priorWks - 130 : 0;
    const grossWks = isLifetime ? null : bracket.mw;
    const adjustedWks = isLifetime ? null : Math.max(0, grossWks - creditWks);
    const totalAward = isLifetime ? null : classRate * adjustedWks;
    const grossAward = isLifetime ? null : classRate * grossWks;
    const creditDollars = isLifetime ? null : classRate * creditWks;
    const fee = classRate * 15;
    const weeklyNet = classRate - Number(inputs.feePerWeek || 0);
    const totalNet = isLifetime ? null : totalAward - fee;
    return { pct, classRate, bracket, isLifetime, grossWks, creditWks, adjustedWks,
             grossAward, creditDollars, totalAward, fee, weeklyNet, totalNet };
  }, [inputs, tt]);

  return (
    <>
      <Inherited {...global} />
      <div className="tile-body">
        <div className="f-group">
          <label className="f-label">LWEC % — {computed.pct}%</label>
          <input type="range" min="0" max="100" value={inputs.pct}
            onChange={e => setInputs({ pct: e.target.value })} />
          <input className="f-input" type="number" min="0" max="100" value={inputs.pct}
            onChange={e => setInputs({ pct: e.target.value })} style={{maxWidth:120}}/>
        </div>
        <div className="f-group" style={{maxWidth: 260}}>
          <label className="f-label">Prior TT / TR / TP Weeks (§15(3)(w))</label>
          <input className="f-input" type="number" min="0" step="0.5" value={inputs.priorTTRWks || 0}
            onChange={e => setInputs({ priorTTRWks: e.target.value })} />
          <span style={{fontSize:11, color:'var(--tx-faint)'}}>
            Carrier credits weeks paid &gt; 130 against the LWEC award at the class rate.
          </span>
        </div>
        <div className="f-group" style={{maxWidth: 220}}>
          <label className="f-label">Attorney Fee / Week (optional)</label>
          <div className="f-input-wrap">
            <span className="prefix">$</span>
            <input className="f-input with-prefix" type="number" min="0" value={inputs.feePerWeek}
              onChange={e => setInputs({ feePerWeek: e.target.value })} />
          </div>
        </div>

        <div className="results">
          <div className="r-row"><span className="l">2/3 AWW</span><span className="v">{fmt$(aww * 2/3)}</span></div>
          <div className="r-row"><span className="l">Class Rate</span><span className="v">{fmt$(computed.classRate)}/wk</span></div>
          <div className="r-row"><span className="l">Bracket</span><span className="v">{computed.bracket.l}</span></div>
          <div className="r-row"><span className="l">Gross Weeks</span><span className="v">{computed.isLifetime ? 'Lifetime' : computed.grossWks}</span></div>
          {computed.creditWks > 0 && !computed.isLifetime && (
            <>
              <div className="r-row"><span className="l">§15(3)(w) Credit</span><span className="v">−{fmtN(computed.creditWks, 2)} wks ({fmt$(computed.creditDollars)})</span></div>
              <div className="r-row"><span className="l">Adjusted Weeks</span><span className="v">{fmtN(computed.adjustedWks, 2)}</span></div>
            </>
          )}
          <div className="r-row big"><span className="l">Total Award</span><span className="v">{computed.isLifetime ? 'Lifetime' : fmt$(computed.totalAward)}</span></div>
          <div className="r-row"><span className="l">Atty Fee (15 wks)</span><span className="v">{fmt$(computed.fee)}</span></div>
          <div className="r-row net"><span className="l">Total Net</span><span className="v">{computed.isLifetime ? '—' : fmt$(computed.totalNet)}</span></div>
        </div>
      </div>
    </>
  );
}

// ====================================================================
// CCP / Award Tile
// ====================================================================
const DESIGNATIONS = ['TT', 'RE', 'TR', 'TP', 'NCLT', 'NME'];

function weeksBetween(start, end) {
  if (!start || !end) return 0;
  const s = new Date(start), e = new Date(end);
  if (isNaN(s) || isNaN(e) || e < s) return 0;
  const days = (e - s) / (1000 * 60 * 60 * 24) + 1;
  return days / 7;
}

function CCPTile({ tile, global, onUpdate }) {
  const inputs = tile.inputs || {
    periods: [
      { id: 1, start: '', end: '', desg: 'TT', curEarn: 0, ratePct: 100, manualRate: 0,
        amending: false, priorMode: 'pct', priorVal: 0 },
    ],
    ccpAmount: 0,
    priorPay: 0,
  };
  const tt = global.ttRate;
  const aww = global.aww;
  const setInputs = (next) => onUpdate({ ...tile, inputs: { ...inputs, ...next } });

  const addPeriod = () => {
    setInputs({ periods: [...inputs.periods, {
      id: Date.now(), start: '', end: '', desg: 'TT', curEarn: 0, ratePct: 100, manualRate: 0,
      amending: false, priorMode: 'pct', priorVal: 0,
    }] });
  };
  const updatePeriod = (id, patch) => {
    setInputs({ periods: inputs.periods.map(p => p.id === id ? { ...p, ...patch } : p) });
  };
  const removePeriod = (id) => {
    setInputs({ periods: inputs.periods.filter(p => p.id !== id) });
  };

  const computed = useMemo(() => {
    const ttBase = (Number(aww) || 0) * 2 / 3;
    const out = inputs.periods.map(p => {
      const wks = weeksBetween(p.start, p.end);
      // Resolve the "current" rate using the desg, exactly as v1.1 did.
      let currentRate = 0;
      if (p.desg === 'TT')         currentRate = tt;
      else if (p.desg === 'RE')    currentRate = Math.max(0, (Number(aww) - Number(p.curEarn || 0)) * 2 / 3);
      else if (p.desg === 'TR') {
        // TR percentage is applied to the UNCAPPED ⅔ × AWW first, then capped
        // at the statutory max for the DOI. Using the already-capped TT as the
        // base understates the TR any time ⅔ × AWW exceeds the max.
        // Example: AWW $2,258.12, max $1,171.46 (DOI 10/10/24), TR @ 87.5%:
        //   wrong: 0.875 × $1,171.46 = $1,025.03
        //   right: min($1,171.46, 0.875 × ⅔ × $2,258.12) = $1,171.46
        const uncapped = (Number(aww) || 0) * (2 / 3) * (Number(p.ratePct || 0) / 100);
        currentRate = global.maxRate > 0 ? Math.min(uncapped, global.maxRate) : uncapped;
      }
      else                         currentRate = Number(p.manualRate || 0);

      // Change 3 — Amending Award. If the period is amending, compute
      // delta vs. prior rate; the dollars-owed for the period are based
      // on (current − prior).
      let rate = currentRate;
      let priorRate = 0;
      if (p.amending) {
        if (p.priorMode === 'usd') {
          // $ → effective % against AWW, then delta. Cap at 100% so a
          // garbled prior > full TT doesn't flip the delta negative.
          const priorUsd = Math.max(0, Number(p.priorVal || 0));
          const priorPct = ttBase > 0 ? Math.min(100, (priorUsd / ttBase) * 100) : 0;
          // Convert back to $ using the same AWW so we're apples-to-apples.
          priorRate = (priorPct / 100) * ttBase;
        } else {
          // 'pct' (default) — direct percentage of TT.
          const priorPct = Math.max(0, Math.min(100, Number(p.priorVal || 0)));
          priorRate = (priorPct / 100) * ttBase;
        }
        rate = Math.max(0, currentRate - priorRate);
      }

      return { ...p, wks, currentRate, priorRate, rate, amount: wks * rate };
    });
    const totalAward = out.reduce((s, p) => s + p.amount, 0);
    const moving = Math.max(0, totalAward - Number(inputs.priorPay || 0));
    const feeOnAward = moving * 0.15;
    const feeOnCCP = Number(inputs.ccpAmount || 0) / 3;
    const totalFee = feeOnAward + feeOnCCP;
    const net = moving - totalFee;
    return { rows: out, totalAward, moving, feeOnAward, feeOnCCP, totalFee, net };
  }, [inputs, tt, aww]);

  return (
    <>
      <Inherited {...global} />
      <div className="tile-body">
        <div style={{display:'grid', gap:8}}>
          {inputs.periods.map(p => (
            <div className="period-row" key={p.id}>
              <div className="row cols-2">
                <div className="f-group">
                  <label className="f-label">Start</label>
                  <input className="f-input" type="date" value={p.start}
                    onChange={e => updatePeriod(p.id, { start: e.target.value })}/>
                </div>
                <div className="f-group">
                  <label className="f-label">End</label>
                  <input className="f-input" type="date" value={p.end}
                    onChange={e => updatePeriod(p.id, { end: e.target.value })}/>
                </div>
              </div>
              <div className="f-group">
                <label className="f-label">Designation</label>
                <div className="desg-pills">
                  {DESIGNATIONS.map(d => (
                    <button key={d} className={'desg-pill ' + (p.desg === d ? 'active' : '')}
                      onClick={() => updatePeriod(p.id, { desg: d })}>{d}</button>
                  ))}
                </div>
              </div>
              {p.desg === 'RE' && (
                <div className="f-group">
                  <label className="f-label">Current Earnings (wk)</label>
                  <div className="f-input-wrap">
                    <span className="prefix">$</span>
                    <input className="f-input with-prefix" type="number" value={p.curEarn}
                      onChange={e => updatePeriod(p.id, { curEarn: e.target.value })}/>
                  </div>
                </div>
              )}
              {p.desg === 'TR' && (
                <div className="f-group">
                  <label className="f-label">Rate %</label>
                  <input className="f-input" type="number" min="0" max="100" value={p.ratePct}
                    onChange={e => updatePeriod(p.id, { ratePct: e.target.value })}/>
                </div>
              )}
              {(p.desg === 'TP' || p.desg === 'NCLT' || p.desg === 'NME') && (
                <div className="f-group">
                  <label className="f-label">Manual Rate</label>
                  <div className="f-input-wrap">
                    <span className="prefix">$</span>
                    <input className="f-input with-prefix" type="number" value={p.manualRate}
                      onChange={e => updatePeriod(p.id, { manualRate: e.target.value })}/>
                  </div>
                </div>
              )}
              {/* Amending-Award control (Change 3). When ON, a prior-rate
                  input appears; the period $ amount uses the delta between
                  current and prior rates against the same AWW × ⅔. */}
              <div className="f-group">
                <button
                  type="button"
                  className={'amending-toggle ' + (p.amending ? 'on' : '')}
                  onClick={() => updatePeriod(p.id, { amending: !p.amending })}
                  aria-pressed={!!p.amending}>
                  {p.amending ? '✓ Amending Award' : '+ Amending Award'}
                </button>
                {p.amending && (
                  <div className="amending-block">
                    <label className="f-label">Prior rate (% or $)</label>
                    <div style={{display:'flex', gap:6}}>
                      <select
                        className="f-select"
                        style={{flex:'0 0 80px'}}
                        value={p.priorMode || 'pct'}
                        onChange={e => updatePeriod(p.id, { priorMode: e.target.value })}>
                        <option value="pct">%</option>
                        <option value="usd">$</option>
                      </select>
                      <div className="f-input-wrap" style={{flex:1}}>
                        {p.priorMode === 'usd' && <span className="prefix">$</span>}
                        <input
                          className={'f-input ' + (p.priorMode === 'usd' ? 'with-prefix' : '')}
                          type="number" min="0"
                          value={p.priorVal || 0}
                          onChange={e => updatePeriod(p.id, { priorVal: Number(e.target.value) })}/>
                      </div>
                    </div>
                    <div className="amending-help">Award will be calculated using the difference between current and prior rates.</div>
                    <div style={{fontFamily:'var(--mono)', fontSize:10, color:'var(--tx-faint)'}}>
                      current {fmt$(computed.rows.find(r => r.id === p.id)?.currentRate)}/wk
                      {' − '}
                      prior {fmt$(computed.rows.find(r => r.id === p.id)?.priorRate)}/wk
                      {' = '}
                      delta {fmt$(computed.rows.find(r => r.id === p.id)?.rate)}/wk
                    </div>
                  </div>
                )}
              </div>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', fontFamily:'var(--mono)', fontSize:11, color:'var(--tx-dim)', borderTop:'1px solid var(--bd-soft)', paddingTop:8}}>
                <span>{fmtN(computed.rows.find(r => r.id === p.id)?.wks, 2)} wks × {fmt$(computed.rows.find(r => r.id === p.id)?.rate)}{p.amending ? ' (amending)' : ''}</span>
                <span style={{color:'var(--ac-2)'}}>{fmt$(computed.rows.find(r => r.id === p.id)?.amount)}</span>
                <button className="delete-row" onClick={() => removePeriod(p.id)}>×</button>
              </div>
            </div>
          ))}
        </div>
        <button className="btn tiny" onClick={addPeriod}>+ Add Period</button>

        <div className="row cols-2">
          <div className="f-group">
            <label className="f-label">CCP Amount</label>
            <div className="f-input-wrap">
              <span className="prefix">$</span>
              <input className="f-input with-prefix" type="number" value={inputs.ccpAmount}
                onChange={e => setInputs({ ccpAmount: e.target.value })}/>
            </div>
          </div>
          <div className="f-group">
            <label className="f-label">Prior Payments</label>
            <div className="f-input-wrap">
              <span className="prefix">$</span>
              <input className="f-input with-prefix" type="number" value={inputs.priorPay}
                onChange={e => setInputs({ priorPay: e.target.value })}/>
            </div>
          </div>
        </div>

        <div className="results">
          <div className="r-row big"><span className="l">Total Award</span><span className="v">{fmt$(computed.totalAward)}</span></div>
          <div className="r-row"><span className="l">Moving</span><span className="v">{fmt$(computed.moving)}</span></div>
          <div className="r-row"><span className="l">Fee on Award (15%)</span><span className="v">{fmt$(computed.feeOnAward)}</span></div>
          <div className="r-row"><span className="l">Fee on CCP (÷3)</span><span className="v">{fmt$(computed.feeOnCCP)}</span></div>
          <div className="r-row"><span className="l">Total Fee</span><span className="v">{fmt$(computed.totalFee)}</span></div>
          <div className="r-row net"><span className="l">Net to Claimant</span><span className="v">{fmt$(computed.net)}</span></div>
        </div>
      </div>
    </>
  );
}

// ====================================================================
// Rate Lookup Tile
// ====================================================================
function RateLookupTile({ tile, global, onUpdate }) {
  const inputs = tile.inputs || { date: global.doi || '' };
  const setInputs = (next) => onUpdate({ ...tile, inputs: { ...inputs, ...next } });

  const date = inputs.date || global.doi || '';
  const max = lookupMax(date);
  const min = lookupMin(date);

  return (
    <div className="tile-body">
      <div className="f-group">
        <label className="f-label">Date (override)</label>
        <input className="f-input" type="date" value={inputs.date || ''}
          onChange={e => setInputs({ date: e.target.value })}/>
        <span style={{fontSize:11, color:'var(--tx-faint)'}}>
          {!inputs.date ? 'Inheriting global DOI' : 'One-off override'}
        </span>
      </div>
      <div className="results" style={{marginTop:0}}>
        <div className="r-row big"><span className="l">Max Rate</span><span className="v">{max ? fmt$(max.max) : '—'}</span></div>
        <div className="r-row"><span className="l">Period</span><span className="v" style={{fontSize:10}}>{max?.l || '—'}</span></div>
        <div className="r-row big"><span className="l">Min Rate</span><span className="v">{min?.min ? fmt$(min.min) : '—'}</span></div>
        <div className="r-row"><span className="l">Period</span><span className="v" style={{fontSize:10}}>{min?.l || '—'}{min?.n ? ' · ' + min.n : ''}</span></div>
      </div>
    </div>
  );
}

// ====================================================================
// Radiculopathy Tile
// ====================================================================
const MUSCLE_WEAKNESS = [
  { v: 5, label: 'Grade 5 — Normal', pts: 0 },
  { v: 4, label: 'Grade 4', pts: 0 },
  { v: 3, label: 'Grade 3', pts: 6 },
  { v: 2, label: 'Grade 2', pts: 18 },
  { v: 1, label: 'Grade 1', pts: 20 },
  { v: 0, label: 'Grade 0', pts: 20 },
];

function RadiculopathyTile({ tile, global, onUpdate }) {
  const inputs = tile.inputs || {
    region: 'lumbar', nerve: 'L5',
    imaging: 0, emg: 0, weakness: 5, atrophy: 0, sensory: 0, reflex: 0, tension: 0,
  };
  const setInputs = (next) => onUpdate({ ...tile, inputs: { ...inputs, ...next } });
  const nerves = NERVE_CAPS[inputs.region];
  const nerve = nerves.find(n => n.v === inputs.nerve) || nerves[0];

  const motorRaw = (MUSCLE_WEAKNESS.find(m => m.v === Number(inputs.weakness))?.pts || 0) + Number(inputs.atrophy || 0);
  const sensoryRaw = Number(inputs.sensory || 0);
  const motorCapped = Math.min(motorRaw, nerve.maxMotor);
  const sensoryCapped = Math.min(sensoryRaw, nerve.maxSensory);
  const total = Number(inputs.imaging) + Number(inputs.emg) + motorCapped + sensoryCapped + Number(inputs.reflex) + Number(inputs.tension);
  const ranks = inputs.region === 'cervical' ? CERVICAL_RANKS : LUMBAR_RANKS;
  const rank = ranks.find(r => total >= r.lo && total <= r.hi) || ranks[ranks.length - 1];

  return (
    <div className="tile-body">
      <div className="row cols-2">
        <div className="f-group">
          <label className="f-label">Spine Region</label>
          <select className="f-select" value={inputs.region} onChange={e => {
            const region = e.target.value;
            setInputs({ region, nerve: NERVE_CAPS[region][0].v });
          }}>
            <option value="cervical">Cervical</option>
            <option value="lumbar">Lumbar</option>
          </select>
        </div>
        <div className="f-group">
          <label className="f-label">Nerve Root</label>
          <select className="f-select" value={inputs.nerve} onChange={e => setInputs({ nerve: e.target.value })}>
            {nerves.map(n => <option key={n.v} value={n.v}>{n.label}</option>)}
          </select>
        </div>
      </div>

      <div className="row cols-2">
        <div className="f-group">
          <label className="f-label">Imaging</label>
          <select className="f-select" value={inputs.imaging} onChange={e => setInputs({ imaging: Number(e.target.value) })}>
            <option value="0">Negative (0)</option><option value="16">Positive (16)</option>
          </select>
        </div>
        <div className="f-group">
          <label className="f-label">EMG</label>
          <select className="f-select" value={inputs.emg} onChange={e => setInputs({ emg: Number(e.target.value) })}>
            <option value="0">Negative (0)</option><option value="6">Positive (6)</option>
          </select>
        </div>
      </div>

      <div className="row cols-2">
        <div className="f-group">
          <label className="f-label">Muscle Weakness</label>
          <select className="f-select" value={inputs.weakness} onChange={e => setInputs({ weakness: Number(e.target.value) })}>
            {MUSCLE_WEAKNESS.map(m => <option key={m.v} value={m.v}>{m.label} ({m.pts})</option>)}
          </select>
        </div>
        <div className="f-group">
          <label className="f-label">Muscle Atrophy</label>
          <select className="f-select" value={inputs.atrophy} onChange={e => setInputs({ atrophy: Number(e.target.value) })}>
            <option value="0">Absent (0)</option><option value="6">Present (6)</option>
          </select>
        </div>
      </div>

      <div className="row cols-2">
        <div className="f-group">
          <label className="f-label">Sensory</label>
          <select className="f-select" value={inputs.sensory} onChange={e => setInputs({ sensory: Number(e.target.value) })}>
            <option value="0">Normal (0)</option>
            <option value="4">Compromised (4)</option>
            <option value="6">Anesthesia (6)</option>
          </select>
        </div>
        <div className="f-group">
          <label className="f-label">Reflex</label>
          <select className="f-select" value={inputs.reflex} onChange={e => setInputs({ reflex: Number(e.target.value) })}>
            <option value="0">Normal (0)</option>
            <option value="4">Diminished (4)</option>
            <option value="6">Absent (6)</option>
          </select>
        </div>
      </div>

      <div className="f-group">
        <label className="f-label">Tension Signs</label>
        <select className="f-select" value={inputs.tension} onChange={e => setInputs({ tension: Number(e.target.value) })}>
          <option value="0">Negative (0)</option><option value="4">Positive (4)</option>
        </select>
      </div>

      <div style={{fontFamily:'var(--mono)', fontSize:11, color:'var(--tx-faint)', lineHeight:1.6, padding:'8px 0'}}>
        Motor: {motorRaw} → capped at {nerve.maxMotor} = {motorCapped}<br/>
        Sensory: {sensoryRaw} → capped at {nerve.maxSensory} = {sensoryCapped}
      </div>

      <div className="results">
        <div className="r-row"><span className="l">Total Points</span><span className="v">{total}</span></div>
        <div className="r-row big"><span className="l">Severity Rank</span><span className="v">{rank.letter}</span></div>
        <div className="r-row"><span className="l">Range</span><span className="v" style={{fontSize:10}}>{rank.lo}–{rank.hi} pts</span></div>
      </div>
    </div>
  );
}

// ====================================================================
// Burns Rate Tile  —  Burns v Varick Industries 6 NY3d 504 (2006).
//                    Workers' Comp lien on a third-party recovery is
//                    reduced by the claimant's litigation costs ratably:
//                      Burns Rate   = (Atty Fee + Disbursements) ÷ Gross Settlement
//                      Net WC Lien  = Burns Rate × Gross Lien (indemnity + medical)
//                      Net to PL    = Gross Settlement − Litigation Costs − Net WC Lien
//                    MVA carve-out reduces the lien base by the no-fault
//                    threshold ($50,000) before applying the Burns rate.
// ====================================================================
function BurnsTile({ tile, global, onUpdate }) {
  const inputs = tile.inputs || {
    indemnity: 0, medical: 0, gross: 0, attyFee: 0, disbursements: 0,
    isMVA: false, mvaThreshold: 50000,
  };
  const setInputs = (next) => onUpdate({ ...tile, inputs: { ...inputs, ...next } });

  const c = useMemo(() => {
    const indemnity = Number(inputs.indemnity) || 0;
    const medical   = Number(inputs.medical)   || 0;
    const gross     = Number(inputs.gross)     || 0;
    const attyFee   = Number(inputs.attyFee)   || 0;
    const disb      = Number(inputs.disbursements) || 0;
    const grossLien = indemnity + medical;
    const lienBase  = inputs.isMVA
      ? Math.max(0, grossLien - (Number(inputs.mvaThreshold) || 0))
      : grossLien;
    const litCosts  = attyFee + disb;
    const burnsRate = gross > 0 ? litCosts / gross : 0;
    const netLien   = burnsRate * lienBase;
    const netToPlaintiff = gross - litCosts - netLien;
    return { grossLien, lienBase, litCosts, burnsRate, netLien, netToPlaintiff };
  }, [inputs]);

  return (
    <div className="tile-body">
      <div className="row cols-2">
        <div className="f-group">
          <label className="f-label">Indemnity Paid</label>
          <div className="f-input-wrap"><span className="prefix">$</span>
            <input className="f-input with-prefix" type="number" min="0" value={inputs.indemnity}
              onChange={e => setInputs({ indemnity: e.target.value })}/></div>
        </div>
        <div className="f-group">
          <label className="f-label">Medical Paid</label>
          <div className="f-input-wrap"><span className="prefix">$</span>
            <input className="f-input with-prefix" type="number" min="0" value={inputs.medical}
              onChange={e => setInputs({ medical: e.target.value })}/></div>
        </div>
      </div>

      <div className="f-group">
        <label className="f-label">Gross 3rd-Party Settlement</label>
        <div className="f-input-wrap"><span className="prefix">$</span>
          <input className="f-input with-prefix" type="number" min="0" value={inputs.gross}
            onChange={e => setInputs({ gross: e.target.value })}/></div>
      </div>

      <div className="row cols-2">
        <div className="f-group">
          <label className="f-label">3rd-Party Atty Fee</label>
          <div className="f-input-wrap"><span className="prefix">$</span>
            <input className="f-input with-prefix" type="number" min="0" value={inputs.attyFee}
              onChange={e => setInputs({ attyFee: e.target.value })}/></div>
        </div>
        <div className="f-group">
          <label className="f-label">Disbursements</label>
          <div className="f-input-wrap"><span className="prefix">$</span>
            <input className="f-input with-prefix" type="number" min="0" value={inputs.disbursements}
              onChange={e => setInputs({ disbursements: e.target.value })}/></div>
        </div>
      </div>

      <div className="f-group" style={{display:'flex',alignItems:'center',gap:8}}>
        <input type="checkbox" id={'mva-' + tile.id} checked={!!inputs.isMVA}
          onChange={e => setInputs({ isMVA: e.target.checked })}/>
        <label htmlFor={'mva-' + tile.id} style={{fontSize:12, color:'var(--tx-dim)'}}>
          MVA — apply no-fault threshold (${fmtN(inputs.mvaThreshold || 50000, 0)}) before Burns
        </label>
      </div>

      <div className="results">
        <div className="r-row"><span className="l">Gross Lien</span><span className="v">{fmt$(c.grossLien)}</span></div>
        {inputs.isMVA && (
          <div className="r-row"><span className="l">Lien Base (after MVA threshold)</span><span className="v">{fmt$(c.lienBase)}</span></div>
        )}
        <div className="r-row"><span className="l">Total Lit Costs</span><span className="v">{fmt$(c.litCosts)}</span></div>
        <div className="r-row big"><span className="l">Burns Rate</span><span className="v">{(c.burnsRate * 100).toFixed(2)}%</span></div>
        <div className="r-row"><span className="l">Net WC Lien</span><span className="v">{fmt$(c.netLien)}</span></div>
        <div className="r-row net"><span className="l">Net to Plaintiff</span><span className="v">{fmt$(c.netToPlaintiff)}</span></div>
      </div>
    </div>
  );
}

// ====================================================================
// Section 32 Settlement Tile
//   Net = (Settlement − Medical Set-Aside) − 15% atty fee on remainder.
// ====================================================================
function SettlementTile({ tile, global, onUpdate }) {
  const inputs = tile.inputs || { settlement: 0, msa: 0 };
  const setInputs = (next) => onUpdate({ ...tile, inputs: { ...inputs, ...next } });

  const c = useMemo(() => {
    const settlement = Number(inputs.settlement) || 0;
    const msa        = Number(inputs.msa)        || 0;
    const remaining  = Math.max(0, settlement - msa);
    const fee        = remaining * 0.15;
    const net        = remaining - fee;
    return { settlement, msa, remaining, fee, net };
  }, [inputs]);

  return (
    <div className="tile-body">
      <div className="f-group">
        <label className="f-label">Settlement Amount</label>
        <div className="f-input-wrap"><span className="prefix">$</span>
          <input className="f-input with-prefix" type="number" min="0" value={inputs.settlement}
            onChange={e => setInputs({ settlement: e.target.value })}/></div>
      </div>
      <div className="f-group">
        <label className="f-label">Medical Set-Aside (MSA)</label>
        <div className="f-input-wrap"><span className="prefix">$</span>
          <input className="f-input with-prefix" type="number" min="0" value={inputs.msa}
            onChange={e => setInputs({ msa: e.target.value })}/></div>
        <span style={{fontSize:11, color:'var(--tx-faint)'}}>
          Carved out before fee — fee runs only on the remainder.
        </span>
      </div>

      <div className="results">
        <div className="r-row"><span className="l">Settlement</span><span className="v">{fmt$(c.settlement)}</span></div>
        <div className="r-row"><span className="l">Less MSA</span><span className="v">−{fmt$(c.msa)}</span></div>
        <div className="r-row big"><span className="l">Remaining</span><span className="v">{fmt$(c.remaining)}</span></div>
        <div className="r-row"><span className="l">Atty Fee (15%)</span><span className="v">{fmt$(c.fee)}</span></div>
        <div className="r-row net"><span className="l">Net to Claimant</span><span className="v">{fmt$(c.net)}</span></div>
      </div>
    </div>
  );
}

// ====================================================================
// Equation Card builders
// ====================================================================
function buildEquation(tile, global) {
  const tt = global.ttRate;
  const aww = global.aww;
  switch (tile.type) {
    case 'SLU': {
      const inputs = tile.inputs || { rows: [], priorPay: 0, priorTTRWks: 0 };
      let totalWeeks = 0;
      const lines = [];
      const plain = [];
      inputs.rows.forEach(r => {
        const bp = SLU_BP.find(b => b.n === r.bp) || SLU_BP[0];
        const sluWks = (Number(r.pct) / 100) * bp.w;
        const phpWks = Math.max(0, Number(r.priorWks || 0) - bp.hp);
        totalWeeks += sluWks + phpWks;
        lines.push(`${bp.n}: ${r.pct}% × ${bp.w} = ${fmtN(sluWks, 2)} wks`);
        lines.push(`PHP: max(0, ${r.priorWks || 0} − ${bp.hp}) = ${fmtN(phpWks, 2)} wks`);
        plain.push(`${bp.n} at ${r.pct}%`);
      });
      const grossTotal = totalWeeks * tt;
      const priorTTRWks = Number(inputs.priorTTRWks || 0);
      const creditWks = priorTTRWks > 130 ? priorTTRWks - 130 : 0;
      const creditDollars = creditWks * tt;
      const total = Math.max(0, grossTotal - creditDollars);
      const moving = Math.max(0, total - Number(inputs.priorPay || 0));
      const fee = moving * 0.15;
      const net = moving - fee;
      lines.push(`Gross Value: ${fmtN(totalWeeks, 2)} wks × ${fmt$(tt)} = ${fmt$(grossTotal)}`);
      if (creditWks > 0) {
        lines.push(`§15(3)(w) Credit: (${fmtN(priorTTRWks, 2)} − 130) × ${fmt$(tt)} = −${fmt$(creditDollars)}`);
        lines.push(`Total After Credit: ${fmt$(total)}`);
      }
      lines.push(`Less prior: (${fmt$(Number(inputs.priorPay || 0))})`);
      lines.push(`Moving: ${fmt$(moving)}`);
      lines.push(`Fee: ${fmt$(moving)} × 15% = ${fmt$(fee)}`);
      lines.push(`Net: ${fmt$(net)}`);
      const creditNote = creditWks > 0
        ? ` After §15(3)(w) credit of ${fmtN(creditWks, 2)} weeks at the TT rate (${fmt$(creditDollars)} deduction), total = ${fmt$(total)}.`
        : '';
      const plainText = `SLU Award: ${plain.join(', ')}. Total ${fmtN(totalWeeks, 2)} weeks × ${fmt$(tt)}/wk = ${fmt$(grossTotal)} gross.${creditNote} Less prior payments of ${fmt$(Number(inputs.priorPay || 0))} = ${fmt$(moving)} moving. Attorney fee 15% of moving = ${fmt$(fee)}. Net to claimant = ${fmt$(net)}.`;
      return { plain: plainText, mono: lines.join('\n') };
    }
    case 'LWEC': {
      const inputs = tile.inputs || { pct: 0, feePerWeek: 0, priorTTRWks: 0 };
      const pct = Number(inputs.pct);
      const classRate = tt * (pct / 100);
      const bracket = lwecBracket(pct);
      const isLifetime = bracket.mw === 'Lifetime';
      const priorWks = Number(inputs.priorTTRWks || 0);
      const creditWks = priorWks > 130 ? priorWks - 130 : 0;
      const grossWks = isLifetime ? null : bracket.mw;
      const adjustedWks = isLifetime ? null : Math.max(0, grossWks - creditWks);
      const totalAward = isLifetime ? null : classRate * adjustedWks;
      const fee = classRate * 15;
      const totalNet = isLifetime ? null : totalAward - fee;
      const lines = [
        `LWEC: ${pct}% (${bracket.l})`,
        `Class Rate: ${fmt$(tt)} × ${pct}% = ${fmt$(classRate)}/wk`,
        `Gross Weeks: ${isLifetime ? 'Lifetime' : bracket.mw}`,
      ];
      if (!isLifetime && creditWks > 0) {
        lines.push(`§15(3)(w) Credit: ${fmtN(priorWks, 2)} prior wks − 130 = ${fmtN(creditWks, 2)} wks credit`);
        lines.push(`Adjusted Weeks: ${fmtN(grossWks, 2)} − ${fmtN(creditWks, 2)} = ${fmtN(adjustedWks, 2)}`);
      }
      lines.push(`Total Award: ${isLifetime ? 'Lifetime' : fmt$(classRate) + ' × ' + fmtN(adjustedWks, 2) + ' = ' + fmt$(totalAward)}`);
      lines.push(`Atty Fee: ${fmt$(classRate)} × 15 wks = ${fmt$(fee)}`);
      lines.push(`Total Net: ${isLifetime ? '—' : fmt$(totalNet)}`);
      const creditNote = (!isLifetime && creditWks > 0)
        ? ` After §15(3)(w) credit (${fmtN(creditWks, 2)} wks at the class rate), adjusted weeks = ${fmtN(adjustedWks, 2)}.`
        : '';
      const plain = `LWEC Award: ${pct}% loss of wage earning capacity (${bracket.l}). Classification rate is ${fmt$(tt)} × ${pct}% = ${fmt$(classRate)}/wk over ${isLifetime ? 'lifetime' : bracket.mw + ' gross weeks'}.${creditNote}${isLifetime ? '' : ' Total award of ' + fmt$(totalAward) + '.'} Attorney fee is the first 15 weeks at the class rate = ${fmt$(fee)}${isLifetime ? '.' : ', leaving ' + fmt$(totalNet) + ' net to claimant.'}`;
      return { plain, mono: lines.join('\n') };
    }
    case 'CCP': {
      const inputs = tile.inputs || { periods: [], ccpAmount: 0, priorPay: 0 };
      let totalAward = 0;
      const lines = [];
      const summary = [];
      inputs.periods.forEach((p, i) => {
        const wks = weeksBetween(p.start, p.end);
        let rate = 0;
        if (p.desg === 'TT') rate = tt;
        else if (p.desg === 'RE') rate = Math.max(0, (Number(aww) - Number(p.curEarn || 0)) * 2 / 3);
        else if (p.desg === 'TR') rate = tt * (Number(p.ratePct || 0) / 100);
        else rate = Number(p.manualRate || 0);
        const amt = wks * rate;
        totalAward += amt;
        lines.push(`P${i+1} ${p.desg}: ${fmtN(wks, 2)} wks × ${fmt$(rate)} = ${fmt$(amt)}`);
        summary.push(`Period ${i+1} (${p.desg}, ${fmtN(wks,2)} wks at ${fmt$(rate)}/wk = ${fmt$(amt)})`);
      });
      const moving = Math.max(0, totalAward - Number(inputs.priorPay || 0));
      const feeOnAward = moving * 0.15;
      const feeOnCCP = Number(inputs.ccpAmount || 0) / 3;
      const totalFee = feeOnAward + feeOnCCP;
      const net = moving - totalFee;
      lines.push(`Total Award: ${fmt$(totalAward)}`);
      lines.push(`Less Prior: (${fmt$(Number(inputs.priorPay || 0))})`);
      lines.push(`Moving: ${fmt$(moving)}`);
      lines.push(`Fee on Award: ${fmt$(moving)} × 15% = ${fmt$(feeOnAward)}`);
      lines.push(`Fee on CCP: ${fmt$(Number(inputs.ccpAmount || 0))} ÷ 3 = ${fmt$(feeOnCCP)}`);
      lines.push(`Total Fee: ${fmt$(totalFee)}`);
      lines.push(`Net: ${fmt$(net)}`);
      const plain = `CCP / Award: ${summary.join('; ')}. Total award ${fmt$(totalAward)} less prior payments ${fmt$(Number(inputs.priorPay || 0))} = ${fmt$(moving)} moving. Attorney fee is 15% of moving (${fmt$(feeOnAward)}) plus one-third of CCP (${fmt$(feeOnCCP)}) = ${fmt$(totalFee)} total fee. Net to claimant = ${fmt$(net)}.`;
      return { plain, mono: lines.join('\n') };
    }
    case 'RateLookup': {
      const date = tile.inputs?.date || global.doi || '';
      const max = lookupMax(date);
      const min = lookupMin(date);
      const lines = [
        `Date: ${date || '—'}`,
        `Max Rate: ${max ? fmt$(max.max) + ' (' + max.l + ')' : '—'}`,
        `Min Rate: ${min?.min ? fmt$(min.min) + ' (' + min.l + ')' : '—'}`,
      ];
      const plain = `Rate Lookup for ${date || 'no date'}: maximum weekly rate ${max ? fmt$(max.max) : 'unavailable'} (${max?.l || ''}); minimum weekly rate ${min?.min ? fmt$(min.min) : 'unavailable'}${min?.n ? ' (' + min.n + ')' : ''}.`;
      return { plain, mono: lines.join('\n') };
    }
    case 'Radiculopathy': {
      const inputs = tile.inputs || {};
      const nerves = NERVE_CAPS[inputs.region || 'lumbar'];
      const nerve = nerves.find(n => n.v === inputs.nerve) || nerves[0];
      const motorRaw = (MUSCLE_WEAKNESS.find(m => m.v === Number(inputs.weakness))?.pts || 0) + Number(inputs.atrophy || 0);
      const sensoryRaw = Number(inputs.sensory || 0);
      const motorCapped = Math.min(motorRaw, nerve.maxMotor);
      const sensoryCapped = Math.min(sensoryRaw, nerve.maxSensory);
      const total = Number(inputs.imaging) + Number(inputs.emg) + motorCapped + sensoryCapped + Number(inputs.reflex) + Number(inputs.tension);
      const ranks = (inputs.region || 'lumbar') === 'cervical' ? CERVICAL_RANKS : LUMBAR_RANKS;
      const rank = ranks.find(r => total >= r.lo && total <= r.hi) || ranks[ranks.length - 1];
      const lines = [
        `Region: ${inputs.region}, Nerve: ${nerve.v}`,
        `Imaging ${inputs.imaging} + EMG ${inputs.emg}`,
        `Motor (raw ${motorRaw}, cap ${nerve.maxMotor}) = ${motorCapped}`,
        `Sensory (raw ${sensoryRaw}, cap ${nerve.maxSensory}) = ${sensoryCapped}`,
        `Reflex ${inputs.reflex} + Tension ${inputs.tension}`,
        `Total: ${total} pts → Rank ${rank.letter}`,
      ];
      const plain = `Radiculopathy Score: ${inputs.region} spine, ${nerve.v}. Total ${total} points after S11.5/S11.6 nerve-root caps. Severity rank ${rank.letter} (range ${rank.lo}–${rank.hi}).`;
      return { plain, mono: lines.join('\n') };
    }
    case 'Burns': {
      const inputs = tile.inputs || {};
      const indemnity = Number(inputs.indemnity) || 0;
      const medical   = Number(inputs.medical)   || 0;
      const gross     = Number(inputs.gross)     || 0;
      const attyFee   = Number(inputs.attyFee)   || 0;
      const disb      = Number(inputs.disbursements) || 0;
      const grossLien = indemnity + medical;
      const lienBase  = inputs.isMVA
        ? Math.max(0, grossLien - (Number(inputs.mvaThreshold) || 50000))
        : grossLien;
      const litCosts  = attyFee + disb;
      const burnsRate = gross > 0 ? litCosts / gross : 0;
      const netLien   = burnsRate * lienBase;
      const netToPlaintiff = gross - litCosts - netLien;
      const lines = [
        `Indemnity: ${fmt$(indemnity)}`,
        `Medical:   ${fmt$(medical)}`,
        `Gross Lien (Indemnity + Medical): ${fmt$(grossLien)}`,
      ];
      if (inputs.isMVA) {
        lines.push(`MVA No-Fault Threshold: −${fmt$(Number(inputs.mvaThreshold) || 50000)}`);
        lines.push(`Lien Base: ${fmt$(lienBase)}`);
      }
      lines.push(`3rd-Party Atty Fee + Disb: ${fmt$(attyFee)} + ${fmt$(disb)} = ${fmt$(litCosts)}`);
      lines.push(`Burns Rate: ${fmt$(litCosts)} ÷ ${fmt$(gross)} = ${(burnsRate * 100).toFixed(2)}%`);
      lines.push(`Net WC Lien: ${(burnsRate * 100).toFixed(2)}% × ${fmt$(lienBase)} = ${fmt$(netLien)}`);
      lines.push(`Net to Plaintiff: ${fmt$(gross)} − ${fmt$(litCosts)} − ${fmt$(netLien)} = ${fmt$(netToPlaintiff)}`);
      const plain = `Burns Rate Calculation${inputs.isMVA ? ' (MVA)' : ''}: gross 3rd-party settlement of ${fmt$(gross)} with attorney fee + disbursements of ${fmt$(litCosts)} produces a Burns rate of ${(burnsRate * 100).toFixed(2)}%. Applied to a${inputs.isMVA ? ' (post-no-fault)' : ''} lien base of ${fmt$(lienBase)}, net WC lien = ${fmt$(netLien)}. Net to plaintiff after litigation costs and reduced lien = ${fmt$(netToPlaintiff)}.`;
      return { plain, mono: lines.join('\n') };
    }
    case 'Settlement': {
      const inputs = tile.inputs || {};
      const settlement = Number(inputs.settlement) || 0;
      const msa        = Number(inputs.msa)        || 0;
      const remaining  = Math.max(0, settlement - msa);
      const fee        = remaining * 0.15;
      const net        = remaining - fee;
      const lines = [
        `Settlement: ${fmt$(settlement)}`,
        `Less MSA:  −${fmt$(msa)}`,
        `Remaining: ${fmt$(remaining)}`,
        `Atty Fee:  ${fmt$(remaining)} × 15% = ${fmt$(fee)}`,
        `Net:       ${fmt$(net)}`,
      ];
      const plain = `Section 32 Settlement of ${fmt$(settlement)} with a Medical Set-Aside of ${fmt$(msa)} carved out leaves ${fmt$(remaining)} as the fee base. Attorney fee of 15% = ${fmt$(fee)}. Net to claimant = ${fmt$(net)}.`;
      return { plain, mono: lines.join('\n') };
    }
    default:
      return { plain: '', mono: '' };
  }
}

Object.assign(window, {
  TILE_SPECS, SLUTile, LWECTile, CCPTile, RateLookupTile, RadiculopathyTile,
  BurnsTile, SettlementTile,
  buildEquation, weeksBetween, MUSCLE_WEAKNESS, DESIGNATIONS,
});
