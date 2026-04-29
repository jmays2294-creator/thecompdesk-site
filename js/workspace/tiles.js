/* Tile components — read globals from window: SLU_BP, LWEC_BR, NERVE_CAPS, ranks, fmt$, fmtN, etc. */
const { useState, useEffect, useMemo, useRef } = React;

const TILE_SPECS = {
  SLU:           { w: 480, h: 520, name: 'Schedule Loss of Use' },
  LWEC:          { w: 400, h: 380, name: 'Loss of Wage Earning Capacity' },
  CCP:           { w: 560, h: 600, name: 'CCP / Award Builder' },
  RateLookup:    { w: 320, h: 240, name: 'Rate Lookup' },
  Radiculopathy: { w: 480, h: 720, name: 'Radiculopathy Scorer' },
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
  const inputs = tile.inputs || { rows: [{ id: 1, bp: 'Leg', pct: 0, priorWks: 0 }], priorPay: 0 };
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
    const total = totalWeeks * tt;
    const moving = Math.max(0, total - Number(inputs.priorPay || 0));
    const fee = moving * 0.15;
    const net = moving - fee;
    return { rowOut, totalWeeks, total, moving, fee, net };
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
                <label className="f-label">Prior TT Wks</label>
                <input className="f-input" type="number" min="0" value={r.priorWks}
                  onChange={e => updateRow(r.id, { priorWks: e.target.value })} />
              </div>
              <button className="delete-row" onClick={() => removeRow(r.id)} title="Remove">×</button>
            </div>
          ))}
        </div>
        <button className="btn tiny" onClick={addRow}>+ Add Body Part</button>

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
  const inputs = tile.inputs || { pct: 50, feePerWeek: 0 };
  const tt = global.ttRate;
  const aww = global.aww;

  const setInputs = (next) => onUpdate({ ...tile, inputs: { ...inputs, ...next } });

  const computed = useMemo(() => {
    const pct = Number(inputs.pct) || 0;
    const classRate = tt * (pct / 100);
    const bracket = lwecBracket(pct);
    const isLifetime = bracket.mw === 'Lifetime';
    const totalAward = isLifetime ? null : classRate * bracket.mw;
    const fee = classRate * 15;
    const weeklyNet = classRate - Number(inputs.feePerWeek || 0);
    const totalNet = isLifetime ? null : totalAward - fee;
    return { pct, classRate, bracket, isLifetime, totalAward, fee, weeklyNet, totalNet };
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
          <div className="r-row"><span className="l">Max Weeks</span><span className="v">{computed.isLifetime ? 'Lifetime' : computed.bracket.mw}</span></div>
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
      { id: 1, start: '', end: '', desg: 'TT', curEarn: 0, ratePct: 100, manualRate: 0 },
    ],
    ccpAmount: 0,
    priorPay: 0,
  };
  const tt = global.ttRate;
  const aww = global.aww;
  const setInputs = (next) => onUpdate({ ...tile, inputs: { ...inputs, ...next } });

  const addPeriod = () => {
    setInputs({ periods: [...inputs.periods, { id: Date.now(), start: '', end: '', desg: 'TT', curEarn: 0, ratePct: 100, manualRate: 0 }] });
  };
  const updatePeriod = (id, patch) => {
    setInputs({ periods: inputs.periods.map(p => p.id === id ? { ...p, ...patch } : p) });
  };
  const removePeriod = (id) => {
    setInputs({ periods: inputs.periods.filter(p => p.id !== id) });
  };

  const computed = useMemo(() => {
    const out = inputs.periods.map(p => {
      const wks = weeksBetween(p.start, p.end);
      let rate = 0;
      if (p.desg === 'TT') rate = tt;
      else if (p.desg === 'RE') rate = Math.max(0, (Number(aww) - Number(p.curEarn || 0)) * 2 / 3);
      else if (p.desg === 'TR') rate = tt * (Number(p.ratePct || 0) / 100);
      else rate = Number(p.manualRate || 0);
      return { ...p, wks, rate, amount: wks * rate };
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
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', fontFamily:'var(--mono)', fontSize:11, color:'var(--tx-dim)', borderTop:'1px solid var(--bd-soft)', paddingTop:8}}>
                <span>{fmtN(computed.rows.find(r => r.id === p.id)?.wks, 2)} wks × {fmt$(computed.rows.find(r => r.id === p.id)?.rate)}</span>
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
// Equation Card builders
// ====================================================================
function buildEquation(tile, global) {
  const tt = global.ttRate;
  const aww = global.aww;
  switch (tile.type) {
    case 'SLU': {
      const inputs = tile.inputs || { rows: [], priorPay: 0 };
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
      const total = totalWeeks * tt;
      const moving = Math.max(0, total - Number(inputs.priorPay || 0));
      const fee = moving * 0.15;
      const net = moving - fee;
      lines.push(`Total: ${fmtN(totalWeeks, 2)} wks × ${fmt$(tt)} = ${fmt$(total)}`);
      lines.push(`Less prior: (${fmt$(Number(inputs.priorPay || 0))})`);
      lines.push(`Moving: ${fmt$(moving)}`);
      lines.push(`Fee: ${fmt$(moving)} × 15% = ${fmt$(fee)}`);
      lines.push(`Net: ${fmt$(net)}`);
      const plainText = `SLU Award: ${plain.join(', ')}. Total ${fmtN(totalWeeks, 2)} weeks × ${fmt$(tt)}/wk = ${fmt$(total)}. Less prior payments of ${fmt$(Number(inputs.priorPay || 0))} = ${fmt$(moving)} moving. Attorney fee 15% of moving = ${fmt$(fee)}. Net to claimant = ${fmt$(net)}.`;
      return { plain: plainText, mono: lines.join('\n') };
    }
    case 'LWEC': {
      const inputs = tile.inputs || { pct: 0, feePerWeek: 0 };
      const pct = Number(inputs.pct);
      const classRate = tt * (pct / 100);
      const bracket = lwecBracket(pct);
      const isLifetime = bracket.mw === 'Lifetime';
      const totalAward = isLifetime ? null : classRate * bracket.mw;
      const fee = classRate * 15;
      const totalNet = isLifetime ? null : totalAward - fee;
      const lines = [
        `LWEC: ${pct}% (${bracket.l})`,
        `Class Rate: ${fmt$(tt)} × ${pct}% = ${fmt$(classRate)}/wk`,
        `Max Weeks: ${isLifetime ? 'Lifetime' : bracket.mw}`,
        `Total Award: ${isLifetime ? 'Lifetime' : fmt$(classRate) + ' × ' + bracket.mw + ' = ' + fmt$(totalAward)}`,
        `Atty Fee: ${fmt$(classRate)} × 15 wks = ${fmt$(fee)}`,
        `Total Net: ${isLifetime ? '—' : fmt$(totalNet)}`,
      ];
      const plain = `LWEC Award: ${pct}% loss of wage earning capacity (${bracket.l}). Classification rate is ${fmt$(tt)} × ${pct}% = ${fmt$(classRate)}/wk over ${isLifetime ? 'lifetime' : bracket.mw + ' weeks'}${isLifetime ? '' : ', for a total award of ' + fmt$(totalAward)}. Attorney fee is the first 15 weeks at the class rate = ${fmt$(fee)}${isLifetime ? '.' : ', leaving ' + fmt$(totalNet) + ' net to claimant.'}`;
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
    default:
      return { plain: '', mono: '' };
  }
}

Object.assign(window, {
  TILE_SPECS, SLUTile, LWECTile, CCPTile, RateLookupTile, RadiculopathyTile,
  buildEquation, weeksBetween, MUSCLE_WEAKNESS, DESIGNATIONS,
});
