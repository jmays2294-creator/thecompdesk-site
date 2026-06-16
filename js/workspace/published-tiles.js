/* published-tiles.js — render owner-approved calculator tiles from the admin platform's
 * `published_calculators` registry into the Pro Workspace. Fully ADDITIVE: if nothing is
 * published (or the user can't read the registry), this changes nothing.
 *
 * Declarative tiles render natively via a safe, no-eval expression evaluator over the
 * whitelisted window.CD.Calc helpers (same contract as the admin authoring surface). Code
 * tiles are intentionally NOT auto-run here (they only run in the owner's CSP-locked review
 * sandbox); they show a "managed tile" placeholder until/unless a sandboxed runner is added.
 *
 * Publishes to window: PublishedTile (component), loadPublishedCalculators(supa, tier),
 * PUBLISHED_CALCULATORS, PUBLISHED_SPECS, PUBLISHED_PALETTE, and merges input-defaults +
 * specs into the existing window.TILE_INPUT_DEFAULTS so app.js needs only tiny hooks.
 */
(function () {
  const React = window.React;
  if (!React) { console.warn('[published-tiles] React not present'); return; }
  const { useState } = React;
  const h = React.createElement;

  // ---- safe evaluator (no eval/Function; whitelisted calc-core helpers only) -------------
  const ALLOWED_FNS = ['applyRateBounds','isAwwBelowMin','getCappedTT','lwecBracket','inclusiveDays','periodWeeks','dayAfter','weeksBetween','roundWeeksDown','maxRateForDOA','minRateForDOA','lookupMax','lookupMin','findSLUPart','nerveCap','radRank','computeAWW','computeSLU','computeLWEC','ccpPeriodRate','computeCCP','computeBurns','computeSettlement'];
  const MATH_FNS = ['min','max','round','floor','ceil','abs','pow','sqrt'];
  function fnTable() {
    const calc = (window.CD && window.CD.Calc) || {};
    const t = {};
    ALLOWED_FNS.forEach(n => { if (typeof calc[n] === 'function') t[n] = (...a) => calc[n](...a); });
    MATH_FNS.forEach(n => { t[n] = (...a) => Math[n](...a); });
    return t;
  }
  function tokenize(src) {
    const out = []; const OPS = ['<=','>=','==','!=','&&','||','<','>','+','-','*','/','%','(',')',',','?',':','!']; let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9.]/.test(c)) { let j = i + 1; while (j < src.length && /[0-9.]/.test(src[j])) j++; out.push({ t: 'num', v: src.slice(i, j) }); i = j; continue; }
      if (c === "'" || c === '"') { let j = i + 1; while (j < src.length && src[j] !== c) j++; out.push({ t: 'str', v: src.slice(i + 1, j) }); i = j + 1; continue; }
      if (/[A-Za-z_]/.test(c)) { let j = i + 1; while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++; out.push({ t: 'id', v: src.slice(i, j) }); i = j; continue; }
      const two = src.slice(i, i + 2);
      if (OPS.indexOf(two) >= 0) { out.push({ t: 'op', v: two }); i += 2; continue; }
      if (OPS.indexOf(c) >= 0) { out.push({ t: 'op', v: c }); i++; continue; }
      throw new Error('Unexpected character: ' + c);
    }
    return out;
  }
  function parse(tokens) {
    let p = 0; const peek = () => tokens[p]; const eat = (v) => { const t = tokens[p]; if (!t || (v && t.v !== v)) throw new Error('Expected ' + (v || 'token')); p++; return t; };
    const BIN = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };
    function primary() {
      const t = peek(); if (!t) throw new Error('Unexpected end');
      if (t.t === 'num') { eat(); return { k: 'num', v: Number(t.v) }; }
      if (t.t === 'str') { eat(); return { k: 'str', v: t.v }; }
      if (t.v === '(') { eat('('); const e = expr(0); eat(')'); return e; }
      if (t.v === '-' || t.v === '!') { eat(); return { k: 'un', op: t.v, a: primary() }; }
      if (t.t === 'id') { eat(); if (peek() && peek().v === '(') { eat('('); const args = []; if (peek() && peek().v !== ')') { args.push(expr(0)); while (peek() && peek().v === ',') { eat(','); args.push(expr(0)); } } eat(')'); return { k: 'call', name: t.v, args }; } return { k: 'id', v: t.v }; }
      throw new Error('Unexpected token ' + t.v);
    }
    function expr(min) {
      let left = primary();
      while (true) {
        const t = peek();
        if (t && t.t === 'op' && BIN[t.v] !== undefined && BIN[t.v] >= min) { eat(); left = { k: 'bin', op: t.v, a: left, b: expr(BIN[t.v] + 1) }; }
        else if (t && t.v === '?' && min === 0) { eat('?'); const a = expr(0); eat(':'); const b = expr(0); left = { k: 'tern', c: left, a, b }; }
        else break;
      }
      return left;
    }
    const out = expr(0); if (p !== tokens.length) throw new Error('Trailing tokens'); return out;
  }
  function ev(n, scope, fns) {
    switch (n.k) {
      case 'num': return n.v; case 'str': return n.v;
      case 'id': if (!(n.v in scope)) throw new Error('Unknown input: ' + n.v); return scope[n.v];
      case 'un': { const a = ev(n.a, scope, fns); return n.op === '-' ? -a : !a; }
      case 'tern': return ev(n.c, scope, fns) ? ev(n.a, scope, fns) : ev(n.b, scope, fns);
      case 'call': if (!(n.name in fns)) throw new Error('Function not allowed: ' + n.name); return fns[n.name].apply(null, n.args.map(a => ev(a, scope, fns)));
      case 'bin': { const a = ev(n.a, scope, fns), b = ev(n.b, scope, fns); switch (n.op) { case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return a / b; case '%': return a % b; case '<': return a < b; case '>': return a > b; case '<=': return a <= b; case '>=': return a >= b; case '==': return a === b; case '!=': return a !== b; case '&&': return a && b; case '||': return a || b; } }
    }
    throw new Error('bad node');
  }
  function evalFormula(formula, scope) { return ev(parse(tokenize(formula)), scope, fnTable()); }

  // ---- generic declarative tile component -----------------------------------------------
  function PublishedTile({ tile, global, onUpdate }) {
    const pub = (window.PUBLISHED_CALCULATORS || []).find(p => 'pub_' + p.id === tile.type);
    if (!pub) return h('div', { className: 'tile-body' }, 'This calculator is no longer published.');
    const spec = pub.spec || {};
    const inputs = tile.inputs || {};
    const set = (k, v) => onUpdate(Object.assign({}, tile, { inputs: Object.assign({}, inputs, { [k]: v }) }));

    let value = null, err = null;
    if (pub.authoring === 'code') { err = null; value = 'managed'; }
    else {
      try {
        const scope = {};
        (spec.inputs || []).forEach(i => { const raw = (inputs[i.key] != null ? inputs[i.key] : i.default); scope[i.key] = i.type === 'number' ? Number(raw || 0) : (raw != null ? raw : ''); });
        scope.doa = (global && global.doi) || inputs.doa || '';
        value = evalFormula(spec.formula, scope);
      } catch (e) { err = e.message; }
    }

    return h('div', { className: 'tile-body', style: { padding: '12px', display: 'grid', gap: '8px' } },
      (spec.inputs || []).map(i => h('div', { key: i.key, className: 'f-group' },
        h('label', { className: 'f-label' }, i.label || i.key),
        i.type === 'date'
          ? h('input', { className: 'f-input', type: 'date', value: inputs[i.key] || '', onChange: e => set(i.key, e.target.value) })
          : h('input', { className: 'f-input', type: i.type === 'number' ? 'number' : 'text', value: inputs[i.key] != null ? inputs[i.key] : (i.default != null ? i.default : ''), onChange: e => set(i.key, i.type === 'number' ? e.target.value : e.target.value) })
      )),
      pub.authoring === 'code'
        ? h('div', { style: { fontSize: '12px', color: 'var(--tx-dim, #888)' } }, 'Managed tile — computed by The Comp Desk.')
        : h('div', { style: { borderTop: '1px solid var(--bd, #2226)', paddingTop: '8px' } },
            h('div', { style: { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--tx-dim, #888)' } }, spec.outputLabel || 'Result'),
            err
              ? h('div', { style: { color: '#ef4444', fontSize: '13px' } }, err)
              : h('div', { style: { fontFamily: 'var(--mono, monospace)', fontSize: '20px', color: 'var(--ac, #E87722)' } }, typeof value === 'object' ? JSON.stringify(value) : String(value))
          ),
      h('div', { style: { fontSize: '10px', color: 'var(--tx-dim, #999)' } }, 'Published · v' + (pub.version || 1))
    );
  }
  window.PublishedTile = PublishedTile;

  // ---- loader ----------------------------------------------------------------------------
  window.loadPublishedCalculators = async function (supa, tier) {
    window.PUBLISHED_CALCULATORS = window.PUBLISHED_CALCULATORS || [];
    window.PUBLISHED_SPECS = window.PUBLISHED_SPECS || {};
    window.PUBLISHED_PALETTE = window.PUBLISHED_PALETTE || [];
    window.PUBLISHED_INPUT_DEFAULTS = window.PUBLISHED_INPUT_DEFAULTS || {};
    if (!supa) return [];
    try {
      const { data, error } = await supa.from('published_calculators')
        .select('id, slug, name, authoring, spec, code, tier, version')
        .order('published_at', { ascending: false });
      if (error) { console.warn('[published-tiles] load failed:', error.message); return []; }
      const order = { free: 0, pro: 1, firm: 2 };
      const userLvl = order[tier] != null ? order[tier] : 0;
      const list = (data || []).filter(p => (order[p.tier] != null ? order[p.tier] : 1) <= userLvl);
      window.PUBLISHED_CALCULATORS = list;
      window.PUBLISHED_SPECS = {}; window.PUBLISHED_PALETTE = [];
      list.forEach(p => {
        const type = 'pub_' + p.id;
        window.PUBLISHED_SPECS[type] = { w: 360, h: 320, name: p.name, published: true };
        window.PUBLISHED_PALETTE.push({ type, name: p.name, icon: '★', desc: 'Published · ' + p.slug });
        window.PUBLISHED_INPUT_DEFAULTS[type] = () => ({});
        // merge input-default into the workspace's factory map so addTile() needs no change
        if (window.TILE_INPUT_DEFAULTS) window.TILE_INPUT_DEFAULTS[type] = window.PUBLISHED_INPUT_DEFAULTS[type];
      });
      return list;
    } catch (e) { console.warn('[published-tiles] load threw:', e.message); return []; }
  };

  // expose the evaluator for tests
  window.__publishedEvalFormula = evalFormula;
})();
