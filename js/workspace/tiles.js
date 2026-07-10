/* Tile components — read globals from window: SLU_BP, LWEC_BR, NERVE_CAPS, ranks, fmt$, fmtN, etc. */
const { useState, useEffect, useMemo, useRef } = React;

const TILE_SPECS = {
  // pro:true marks tiles gated to Pro/Firm subscribers per /for-attorneys
  // pricing copy ("SLU Permanency tile · Radiculopathy point calculator tile").
  // Free users see a lock badge in the palette and hit the Paywall modal on
  // click/drop. Keep this in sync with PALETTE_ITEMS in app.js.
  SLU:           { w: 480, h: 600, name: 'Schedule Loss of Use', pro: true },
  LWEC:          { w: 400, h: 460, name: 'Loss of Wage Earning Capacity' },
  CCP:           { w: 560, h: 600, name: 'CCP / Award Builder' },
  RateLookup:    { w: 320, h: 240, name: 'Rate Lookup' },
  Radiculopathy: { w: 480, h: 720, name: 'Radiculopathy Scorer', pro: true },
  Burns:         { w: 460, h: 520, name: 'Burns Rate (3rd-Party Lien)' },
  Settlement:    { w: 420, h: 360, name: 'Section 32 Settlement' },
  MTG:           { w: 480, h: 620, name: 'Medical Treatment Guidelines' },
  DateCalc:      { w: 480, h: 560, name: 'Date Calculator' },
  // Fee Calculator 6.1 conversions (BETA) — engines in constants.js, verified
  // against the NY 2018 Impairment Guidelines (ops/secretary/fee_calc_6.1/).
  SLURom:        { w: 540, h: 700, name: 'Schedule ROM → SLU', pro: true },
  NonSchedule:   { w: 540, h: 680, name: 'Non-Schedule Impairment', pro: true },
};

// Date Calculator helpers, published as globals by constants.js. This is the
// window-global equivalent of `import { ... } from './constants.js'` — this
// bundle is loaded as plain <script> tags (constants.js first), not ES
// modules, so there is no import statement to write.
const {
  addYMWD, dateDiffBreakdown, isBusinessDay, rollToNextBusinessDay,
  toLocalISO, fromLocalISO,
} = window;

// Per-interval quick presets for the Add/Subtract mode. Days mirror the AWW
// strip deadline tool's DEADLINE_DAY_OPTIONS for cross-tool consistency.
const DATECALC_PRESETS = {
  y: [1, 2, 3, 5, 10],
  m: [1, 3, 6, 9, 12],
  w: [1, 2, 4, 6, 8, 12],
  d: [10, 15, 30, 45, 60, 75, 90],
};

// ====================================================================
// MTG Tile — quick search across all NYS WCB Medical Treatment Guidelines.
// Catalog is loaded from /data/mtg/_summary.json at first tile mount, so
// adding a new guideline server-side requires zero frontend changes.
// Per-guideline JSON lives at /data/mtg/{slug}.json. Both are cached in
// module-scoped Maps so multiple MTG tiles on one canvas share a single
// fetch. The full 3D anatomy picker lives at
// /tools/medical-treatment-guidelines.html — opened in a new tab.
// ====================================================================
let MTG_GUIDELINES = [];     // populated by mtgLoadCatalog()
const _mtgCache = {};        // slug -> parsed JSON or 'loading' or 'error'
const _mtgPromises = {};     // slug -> in-flight Promise
let _mtgCatalogPromise = null;
let _mtgAbbrevPromise = null;
let MTG_ABBREVIATIONS = {};  // lowercase token -> array of expansions

function mtgLoadCatalog() {
  if (_mtgCatalogPromise) return _mtgCatalogPromise;
  _mtgCatalogPromise = fetch('/data/mtg/_summary.json')
    .then(r => { if (!r.ok) throw new Error('summary ' + r.status); return r.json(); })
    .then(j => {
      MTG_GUIDELINES = (j.guidelines || []).map(g => ({
        slug: g.slug, name: g.name, body_regions: g.body_regions || [],
        page_count: g.page_count, section_count: g.section_count,
      }));
      return MTG_GUIDELINES;
    })
    .catch(e => { console.warn('[MTG] catalog', e); MTG_GUIDELINES = []; return []; });
  return _mtgCatalogPromise;
}

function mtgLoadAbbreviations() {
  if (_mtgAbbrevPromise) return _mtgAbbrevPromise;
  _mtgAbbrevPromise = fetch('/data/mtg/abbreviations.json')
    .then(r => { if (!r.ok) throw new Error('abbrev ' + r.status); return r.json(); })
    .then(j => { MTG_ABBREVIATIONS = j.abbreviations || {}; return MTG_ABBREVIATIONS; })
    .catch(e => { console.warn('[MTG] abbrev', e); MTG_ABBREVIATIONS = {}; return {}; });
  return _mtgAbbrevPromise;
}

// A typed token matches the haystack if the token appears OR if any of its
// registered abbreviation expansions appears. Lets "PT" find "physical
// therapy" sections without forcing the user to know the WCB's phrasing.
function mtgTokenMatches(hay, token) {
  if (hay.indexOf(token) !== -1) return true;
  const exps = MTG_ABBREVIATIONS[token];
  if (exps) {
    for (let i = 0; i < exps.length; i++) {
      if (hay.indexOf(exps[i]) !== -1) return true;
    }
  }
  return false;
}

function mtgLoad(slug) {
  if (_mtgCache[slug] && typeof _mtgCache[slug] === 'object') return Promise.resolve(_mtgCache[slug]);
  if (_mtgPromises[slug]) return _mtgPromises[slug];
  _mtgCache[slug] = 'loading';
  _mtgPromises[slug] = fetch(`/data/mtg/${slug}.json`)
    .then(r => { if (!r.ok) throw new Error('fetch ' + slug + ': ' + r.status); return r.json(); })
    .then(d => { _mtgCache[slug] = d; return d; })
    .catch(e => { console.warn('[MTG]', e); _mtgCache[slug] = 'error'; return null; });
  return _mtgPromises[slug];
}

// Normalize MTG body text for display. The guideline JSON is extracted from
// the WCB PDFs, which carry hard line breaks every ~80 characters — rendering
// that raw with `white-space: pre-wrap` chops sentences onto random new lines.
// This collapses those mid-paragraph hard wraps to spaces, preserves real
// paragraph breaks (blank lines), and rejoins words hyphenated across a line
// break ("treat-\nment" -> "treatment"). Bullet/numbered list lines are kept
// on their own line so lists stay readable.
function mtgNormalizeBody(text) {
  if (!text || typeof text !== 'string') return text || '';
  let t = text.replace(/\r\n?/g, '\n');
  t = t.replace(/(\w)-\n(\w)/g, '$1$2');                 // de-hyphenate across breaks
  const isListLine = (ln) => /^\s*(?:[-\u2022*]|\(?[A-Za-z0-9]{1,3}[.)])\s/.test(ln);
  // Split into paragraphs on blank lines; within a paragraph join wrapped lines
  // into one flowing line — except lines that begin a list item, which keep
  // their own line so numbered/lettered lists stay readable.
  return t.split(/\n[ \t]*\n+/).map((p) => {
    let acc = '';
    p.split('\n').forEach((ln) => {
      const s2 = ln.trim();
      if (!acc) acc = s2;
      else if (isListLine(ln)) acc += '\n' + s2;
      else acc += ' ' + s2;
    });
    return acc.replace(/[ \t]{2,}/g, ' ').trim();
  }).filter(Boolean).join('\n\n');
}

function mtgMakeExcerpt(body, keyword, anchorRef) {
  body = mtgNormalizeBody(body);
  // If the query named a section ref like "C.2.a" that appears in body,
  // pull the excerpt from around it (so the card preview shows the right
  // chunk, not the start of the parent section).
  if (anchorRef) {
    const idx = body.toLowerCase().indexOf(anchorRef.toLowerCase());
    if (idx !== -1) {
      const start = Math.max(0, idx - 60);
      const end = Math.min(body.length, idx + 200);
      return (start > 0 ? '…' : '') + body.slice(start, end) + (end < body.length ? '…' : '');
    }
  }
  if (!keyword) return body.slice(0, 220) + (body.length > 220 ? '…' : '');
  // Use the first free-text token (skipping section refs) for anchoring
  const toks = keyword.toLowerCase().split(/\s+/);
  const firstTok = toks.find(t => t && !/^[a-e]\.?\d+(\.[a-z])?$/i.test(t)) || toks[0];
  const idx = body.toLowerCase().indexOf(firstTok);
  if (idx === -1) return body.slice(0, 220) + '…';
  const start = Math.max(0, idx - 60);
  const end = Math.min(body.length, idx + 180);
  return (start > 0 ? '…' : '') + body.slice(start, end) + (end < body.length ? '…' : '');
}

// Smart query parser — same shape/semantics as mtg-tool.js. Keep these
// implementations in sync (small files; explicit duplication beats setting up
// a shared module given the workspace's Babel-transformed loading).
const MTG_STOPWORDS = new Set(['of', 'and', 'the', 'injury', 'a', 'an', 'in', 'for']);
function mtgParseQuery(q, guidelines) {
  const raw = (q || '').toLowerCase();
  const sectionRefs = [];
  const canonRe = /\b([a-e])\.(\d{1,3})(?:\.([a-z]))?\b/gi;
  const bareSubRe = /\b([a-e])(\d{1,3})([a-z])\b/gi;
  const bareRe = /\b([a-e])(\d{1,3})\b/gi;
  let m;
  while ((m = canonRe.exec(raw)) !== null) {
    const letter = m[1].toUpperCase();
    const number = parseInt(m[2], 10);
    const sub = m[3] ? m[3].toLowerCase() : null;
    sectionRefs.push({
      letter, number, sub, ref: m[0],
      parent: letter + '.' + number,
      canonical: letter + '.' + number + (sub ? '.' + sub : ''),
    });
  }
  // Bare-with-sub before bare-no-sub so "C2a" claims as C.2.a (not C.2 + "a")
  while ((m = bareSubRe.exec(raw)) !== null) {
    const full = m[0];
    if (sectionRefs.some(r => r.ref.toLowerCase().indexOf(full.toLowerCase()) !== -1)) continue;
    const letter = m[1].toUpperCase();
    const number = parseInt(m[2], 10);
    const sub = m[3].toLowerCase();
    sectionRefs.push({
      letter, number, sub, ref: full,
      parent: letter + '.' + number,
      canonical: letter + '.' + number + '.' + sub,
    });
  }
  while ((m = bareRe.exec(raw)) !== null) {
    const full = m[0];
    if (sectionRefs.some(r => r.ref.toLowerCase().indexOf(full.toLowerCase()) !== -1)) continue;
    sectionRefs.push({
      letter: m[1].toUpperCase(), number: parseInt(m[2], 10), sub: null,
      ref: full, parent: m[1].toUpperCase() + '.' + m[2], canonical: m[1].toUpperCase() + '.' + m[2],
    });
  }
  let remaining = raw;
  sectionRefs.forEach(r => { remaining = remaining.split(r.ref.toLowerCase()).join(' '); });
  const guidelineHints = [];
  for (const g of guidelines) {
    const nameTokens = (g.name || '').toLowerCase().split(/[^a-z0-9]+/)
      .filter(t => t.length >= 3 && !MTG_STOPWORDS.has(t));
    const slugTokens = (g.slug || '').toLowerCase().split(/[^a-z0-9]+/)
      .filter(t => t.length >= 3);
    const allTokens = Array.from(new Set([...nameTokens, ...slugTokens]));
    const matched = [];
    for (const t of allTokens) {
      const tRe = new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      if (tRe.test(remaining)) matched.push(t);
    }
    const phrases = [g.name.toLowerCase(), (g.slug || '').toLowerCase().replace(/-/g, ' ')];
    for (const p of phrases) {
      if (p.length >= 4 && remaining.indexOf(p) !== -1) matched.push(p);
    }
    if (matched.length) guidelineHints.push({ slug: g.slug, name: g.name, matchedTokens: matched });
  }
  for (const h of guidelineHints) {
    for (const t of h.matchedTokens) {
      const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s\-]+/g, '[\\s\\-]+');
      remaining = remaining.replace(new RegExp('\\b' + esc + '\\b', 'gi'), ' ');
    }
  }
  const freeText = remaining.toLowerCase().split(/[^a-z0-9]+/)
    .filter(t => t.length >= 2 && !MTG_STOPWORDS.has(t));
  return { sectionRefs, guidelineHints, freeText };
}

function mtgScoreSection(section, slug, parsed) {
  let score = 0;
  for (const ref of parsed.sectionRefs) {
    if (section.id === ref.canonical) score += 1000;
    else if (ref.sub && section.id === ref.parent) score += 800;
    else if (section.body_text.toLowerCase().indexOf(ref.canonical.toLowerCase()) !== -1) score += 400;
    else if (section.id.toLowerCase() === ref.parent.toLowerCase()) score += 200;
  }
  if (parsed.guidelineHints.some(h => h.slug === slug)) score += 200;
  if (parsed.freeText.length) {
    const hay = (section.title + ' ' + section.body_text).toLowerCase();
    for (const t of parsed.freeText) {
      if (section.title.toLowerCase().indexOf(t) !== -1) score += 50;
      if (mtgTokenMatches(hay, t)) {
        const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const count = (hay.match(new RegExp(esc, 'g')) || []).length;
        score += Math.min(count * 8, 80);
      }
    }
  }
  return score;
}

function MTGTile({ tile, global, onUpdate }) {
  const inputs = tile.inputs || {};
  const keyword = inputs.keyword || '';
  const guidelineFilter = inputs.guidelineFilter || ''; // '' = all, or one slug
  const [ready, setReady] = useState(false);

  // Overlay state — null means closed; { result, locked } when open.
  const [overlay, setOverlay] = useState(null);

  // Load catalog + abbreviations + all guideline JSONs in parallel.
  useEffect(() => {
    let alive = true;
    Promise.all([mtgLoadCatalog(), mtgLoadAbbreviations()])
      .then(([catalog]) => Promise.all(catalog.map(g => mtgLoad(g.slug))))
      .then(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);

  // Esc closes the locked overlay
  useEffect(() => {
    if (!overlay || !overlay.locked) return;
    const onKey = (e) => { if (e.key === 'Escape') setOverlay(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlay]);

  const set = (patch) => onUpdate({ ...tile, inputs: { ...inputs, ...patch } });

  const results = useMemo(() => {
    if (!ready) return [];
    const parsed = mtgParseQuery(keyword, MTG_GUIDELINES);
    // Strict guideline filter: if the query named a guideline, results are
    // limited to that guideline. Otherwise honor the explicit dropdown.
    let slugs;
    if (parsed.guidelineHints.length) {
      slugs = parsed.guidelineHints.map(h => h.slug);
    } else if (guidelineFilter) {
      slugs = [guidelineFilter];
    } else {
      slugs = MTG_GUIDELINES.map(g => g.slug);
    }
    const anchorRef = parsed.sectionRefs[0] ? parsed.sectionRefs[0].canonical : null;
    const out = [];
    for (const slug of slugs) {
      const data = _mtgCache[slug];
      if (!data || typeof data !== 'object') continue;
      for (const sec of data.sections) {
        // Strict free-text: every typed free-text token must match
        if (parsed.freeText.length) {
          const hay = (sec.title + ' ' + sec.body_text).toLowerCase();
          if (!parsed.freeText.every(t => mtgTokenMatches(hay, t))) continue;
        }
        const score = mtgScoreSection(sec, slug, parsed);
        out.push({ ...sec, guideline: data.guideline, slug, _score: score, _anchorRef: anchorRef });
        if (out.length >= 400) break;
      }
      if (out.length >= 400) break;
    }
    out.sort((a, b) => (b._score - a._score) || a.id.localeCompare(b.id));
    return out;
  }, [ready, keyword, guidelineFilter]);

  return (
    <div className="tile-body" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <input
          type="search"
          value={keyword}
          placeholder='Guideline + section + keyword (e.g. "low back C2a", "knee D6 PT")'
          onChange={(e) => set({ keyword: e.target.value })}
          style={{
            flex: 1, background: 'var(--bg-1, #0a0f1a)', border: '1px solid var(--bd, #1e3a5f)',
            color: 'var(--tx, #e2e8f0)', padding: '7px 10px', borderRadius: 6, fontSize: 12,
            fontFamily: 'inherit', outline: 'none',
          }}
        />
      </div>
      <select
        value={guidelineFilter}
        onChange={(e) => set({ guidelineFilter: e.target.value })}
        style={{
          width: '100%', background: 'var(--bg-1, #0a0f1a)', border: '1px solid var(--bd, #1e3a5f)',
          color: 'var(--tx, #e2e8f0)', padding: '6px 8px', borderRadius: 6, fontSize: 12,
          fontFamily: 'inherit', outline: 'none', marginBottom: 8,
        }}>
        <option value="">All guidelines ({ready ? MTG_GUIDELINES.length : '…'})</option>
        {MTG_GUIDELINES.map(g => <option key={g.slug} value={g.slug}>{g.name}</option>)}
      </select>

      <div style={{
        fontSize: 10, color: 'var(--tx-faint, #64748b)', letterSpacing: 0.4,
        textTransform: 'uppercase', fontWeight: 700, marginBottom: 4,
      }}>
        {ready
          ? `${results.length} matching section${results.length === 1 ? '' : 's'}`
          : 'Loading guidelines…'}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingRight: 4 }}>
        {ready && results.length === 0 && (
          <div style={{
            fontSize: 11, color: 'var(--tx-faint, #64748b)', fontStyle: 'italic',
            padding: '20px 8px', textAlign: 'center',
          }}>
            {keyword || guidelineFilter
              ? 'No matching sections. Try a broader keyword.'
              : 'Enter a keyword to search across all loaded MTGs.'}
          </div>
        )}
        {results.slice(0, 25).map((r, i) => {
          const canHover = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(hover: hover)').matches;
          const isPeeking = overlay && !overlay.locked && overlay.result && overlay.result.slug === r.slug && overlay.result.id === r.id;
          // Capture the result card's viewport rect so the overlay (which
          // portals to document.body, escaping the workspace's transformed
          // canvas) can position itself next to the card on hover.
          const captureRect = (e) => {
            const t = e.currentTarget;
            if (!t) return null;
            const b = t.getBoundingClientRect();
            return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height };
          };
          return (
          <div key={r.slug + ':' + r.id + ':' + i}
            onMouseEnter={canHover ? (e) => { if (!overlay || !overlay.locked) setOverlay({ result: r, locked: false, anchor: captureRect(e) }); } : undefined}
            onMouseLeave={canHover ? () => { if (overlay && !overlay.locked) setOverlay(null); } : undefined}
            onClick={(e) => {
              const a = captureRect(e);
              if (isPeeking) setOverlay({ result: r, locked: true, anchor: a });
              else if (!canHover && (!overlay || overlay.result.id !== r.id)) setOverlay({ result: r, locked: false, anchor: a });
              else setOverlay({ result: r, locked: true, anchor: a });
            }}
            style={{
              background: 'var(--tile-2, rgba(255,255,255,0.03))',
              border: '1px solid var(--bd, #1e3a5f)',
              borderLeft: '3px solid var(--ac, #3b82f6)',
              borderRadius: 5, padding: '7px 9px', marginBottom: 6,
              cursor: 'pointer',
            }}>
            <div style={{
              display: 'flex', gap: 6, alignItems: 'center', fontSize: 9,
              color: 'var(--tx-faint, #64748b)', textTransform: 'uppercase',
              fontWeight: 700, letterSpacing: 0.4, marginBottom: 3,
            }}>
              <span style={{ color: 'var(--ac, #3b82f6)' }}>{r.guideline}</span>
              <span style={{ opacity: 0.5 }}>·</span>
              <span style={{ fontFamily: 'var(--mono, ui-monospace, Menlo, monospace)', color: 'var(--tx-2, #94a3b8)' }}>{r.id}</span>
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--tx, #fff)', marginBottom: 4 }}>{r.title}</div>
            <div style={{
              fontSize: 11, color: 'var(--tx-2, #cbd5e1)', lineHeight: 1.5,
              whiteSpace: 'pre-wrap', marginBottom: 4,
            }}>{mtgMakeExcerpt(r.body_text, keyword, r._anchorRef)}</div>
            <div style={{
              fontSize: 9, fontFamily: 'var(--mono, ui-monospace, Menlo, monospace)',
              color: 'var(--tx-faint, #64748b)', paddingTop: 4,
              borderTop: '1px dashed var(--bd, #1e3a5f)',
            }}>{r.citation}</div>
          </div>
          );
        })}
        {results.length > 25 && (
          <div style={{
            fontSize: 10, color: 'var(--tx-faint, #64748b)', fontStyle: 'italic',
            textAlign: 'center', padding: '6px 0',
          }}>
            Showing first 25 of {results.length} — refine your keyword to narrow.
          </div>
        )}
      </div>

      <a
        href="/tools/medical-treatment-guidelines.html"
        target="_blank"
        rel="noopener"
        style={{
          display: 'block', textAlign: 'center', marginTop: 8,
          padding: '8px 12px', background: 'var(--ac-soft, rgba(59,130,246,0.13))',
          border: '1px solid var(--ac, #3b82f6)', color: 'var(--ac, #3b82f6)',
          borderRadius: 6, fontSize: 11, fontWeight: 700, textDecoration: 'none',
          letterSpacing: 0.3, textTransform: 'uppercase',
        }}>
        Open full 3D anatomy picker ↗
      </a>

      {overlay && <MTGOverlay overlay={overlay} onClose={() => setOverlay(null)} onLock={() => setOverlay({ ...overlay, locked: true })} />}
    </div>
  );
}

// Renders body_text into the overlay body div. If anchorText is supplied and
// is locked-visible, the matching substring is wrapped in a <mark> element
// so it visually pops; the parent MTGOverlay scrolls it into view via ref.
// We return an array of React nodes (text + mark + text) so React reconciles
// cleanly across rerenders.
function renderBodyMaybeHighlighted(bodyText, anchorRef, locked) {
  if (!anchorRef) return bodyText;
  const idx = bodyText.toLowerCase().indexOf(anchorRef.toLowerCase());
  if (idx === -1) return bodyText;
  return [
    bodyText.slice(0, idx),
    React.createElement('mark', {
      key: 'mtg-anchor',
      className: 'mtg-anchor-mark',
      ref: locked ? (el) => { if (el) requestAnimationFrame(() => { try { el.scrollIntoView({ block: 'center', behavior: 'auto' }); } catch (_) {} }); } : undefined,
      style: {
        background: 'rgba(245,158,11,0.32)',
        color: '#fff',
        padding: '1px 3px',
        borderRadius: 3,
        boxShadow: '0 0 0 1px rgba(245,158,11,0.55)',
        fontWeight: 700,
      },
    }, bodyText.slice(idx, idx + anchorRef.length)),
    bodyText.slice(idx + anchorRef.length),
  ];
}

// Viewport-level overlay for MTG section preview. Portaled to document.body
// so it escapes the workspace canvas's transform context — otherwise
// position:fixed gets clipped because the canvas applies CSS transforms
// for tile dragging (transformed ancestors break position:fixed).
//
// Two visual modes:
//   peek   — small translucent tooltip anchored to the right of the hovered
//            result card. Pointer-events:none on the card so mouseleave on
//            the underlying card fires correctly. No close button.
//   locked — moderately larger side-panel docked to the right edge of the
//            viewport (bottom sheet on narrow screens). Solid background,
//            explicit X close button, full body scrollable.
function MTGOverlay({ overlay, onClose, onLock }) {
  const r = overlay.result;
  const locked = overlay.locked;
  const anchor = overlay.anchor || null;

  // Esc-to-close when locked
  useEffect(() => {
    if (!locked) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [locked, onClose]);

  // Compute card position based on mode + anchor rect
  const narrowVp = typeof window !== 'undefined' && window.innerWidth < 720;
  let cardPosStyle;
  if (locked) {
    if (narrowVp) {
      cardPosStyle = { left: 8, right: 8, top: 'auto', bottom: 8, width: 'auto', maxHeight: '70vh' };
    } else {
      cardPosStyle = { left: 'auto', right: 24, top: '5vh', bottom: 'auto', width: 'min(480px, 40vw)', maxHeight: '90vh' };
    }
  } else if (anchor && !narrowVp) {
    const peekWidth = 360;
    const peekMaxH = 320;
    const margin = 12;
    let left = anchor.right + margin;
    let top = anchor.top;
    if (left + peekWidth > window.innerWidth - 12) {
      left = anchor.left - peekWidth - margin;
      if (left < 12) {
        left = Math.max(12, Math.min(window.innerWidth - peekWidth - 12, anchor.left));
        top = anchor.bottom + margin;
      }
    }
    if (top + peekMaxH > window.innerHeight - 12) {
      top = Math.max(12, window.innerHeight - peekMaxH - 12);
    }
    cardPosStyle = { left, top, right: 'auto', bottom: 'auto', width: peekWidth, maxHeight: peekMaxH };
  } else {
    cardPosStyle = { left: 'auto', right: 16, top: 80, bottom: 'auto', width: 'min(360px, 92vw)', maxHeight: 320 };
  }

  const overlay_node = (
    <div
      onClick={(e) => { if (locked && e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        pointerEvents: locked ? 'auto' : 'none',
      }}>
      {/* backdrop — only interactive when locked */}
      <div style={{
        position: 'absolute', inset: 0,
        background: locked ? 'rgba(8,12,24,0.42)' : 'transparent',
        transition: 'background .15s ease',
      }} />
      {/* card */}
      <div
        onClick={(e) => { e.stopPropagation(); if (!locked) onLock(); }}
        style={{
          position: 'absolute', ...cardPosStyle, display: 'flex', flexDirection: 'column',
          background: locked
            ? 'linear-gradient(180deg, #111827 0%, #0d1421 100%)'
            : 'rgba(17,24,39,0.82)',
          backdropFilter: locked ? 'none' : 'blur(6px)',
          WebkitBackdropFilter: locked ? 'none' : 'blur(6px)',
          border: '1px solid ' + (locked ? '#3b82f6' : 'rgba(59,130,246,0.7)'),
          borderRadius: 12,
          padding: locked ? '18px 20px' : '14px 16px',
          boxShadow: '0 20px 60px rgba(0,0,0,.55), 0 0 0 1px rgba(59,130,246,.18)',
          pointerEvents: locked ? 'auto' : 'none',
        }}>
        {locked && (
          <button
            aria-label="Close section"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            style={{
              position: 'absolute', top: 10, right: 14,
              background: 'rgba(8,12,24,0.5)', border: '1px solid rgba(148,163,184,0.35)',
              color: '#cbd5e1', width: 32, height: 32, lineHeight: 1, cursor: 'pointer',
              padding: 0, borderRadius: 8, fontFamily: 'inherit', fontSize: 22,
              display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2,
            }}>×</button>
        )}
        <div style={{
          display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: '#94a3b8',
          textTransform: 'uppercase', fontWeight: 700, letterSpacing: 0.5, marginBottom: 6,
          paddingRight: locked ? 40 : 0,
        }}>
          <span style={{ color: '#3b82f6' }}>{r.guideline}</span>
          <span> · </span>
          <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{r.id}</span>
        </div>
        <h2 style={{ fontSize: locked ? 18 : 15, fontWeight: 700, color: '#fff', marginBottom: locked ? 12 : 8, letterSpacing: -0.2, paddingRight: locked ? 40 : 0, lineHeight: 1.3 }}>{r.title}</h2>
        <div style={{
          flex: 1, overflowY: locked ? 'auto' : 'hidden',
          fontSize: locked ? 14 : 13, color: '#cbd5e1', lineHeight: 1.65,
          whiteSpace: 'pre-wrap',
          padding: locked ? '10px 12px 14px 0' : '8px 0 0',
          marginRight: locked ? -6 : 0,
          borderTop: locked ? '1px solid rgba(59,130,246,.18)' : 'none',
          borderBottom: locked ? '1px solid rgba(59,130,246,.18)' : 'none',
          maxHeight: locked ? 'none' : 180,
          WebkitMaskImage: locked ? 'none' : 'linear-gradient(180deg, #000 70%, transparent 100%)',
          maskImage: locked ? 'none' : 'linear-gradient(180deg, #000 70%, transparent 100%)',
        }}>{renderBodyMaybeHighlighted(mtgNormalizeBody(r.body_text), r._anchorRef, locked)}</div>
        {locked && (
          <div style={{
            fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            color: '#64748b', paddingTop: 12, paddingBottom: 10, wordBreak: 'break-all',
          }}>{r.citation}</div>
        )}
        {locked && (
          <a href={`/data/mtg/pdfs/${r.slug}.pdf#page=${r.page}`} target="_blank" rel="noopener"
            onClick={(e) => e.stopPropagation()}
            style={{
              display: 'inline-block', padding: '9px 18px', background: 'rgba(59,130,246,.15)',
              border: '1px solid #3b82f6', color: '#3b82f6', borderRadius: 6,
              fontSize: 12, fontWeight: 700, textDecoration: 'none', letterSpacing: 0.3,
              textTransform: 'uppercase', alignSelf: 'flex-start',
            }}>
            View source PDF at this section →
          </a>
        )}
      </div>
    </div>
  );

  // Portal to document.body so the overlay escapes the workspace canvas's
  // transform context (transformed ancestors would otherwise clip position:fixed).
  if (typeof ReactDOM !== 'undefined' && ReactDOM.createPortal && typeof document !== 'undefined') {
    return ReactDOM.createPortal(overlay_node, document.body);
  }
  return overlay_node;
}

// ---------- Inherited rate strip ----------
// `awwOverride` is true when AWW < statutory min for DOA — in that case TT
// rate, SLU rate, and the floor all collapse to AWW (per Joel, May 2026).
function Inherited({ ttRate, maxRate, minRate, aww, awwOverride, source = 'global' }) {
  const displayMin = awwOverride ? aww : (minRate || 0);
  return (
    <div className="tile-inherited">
      <span><span className="tag">TT</span><span className="v">{fmt$(ttRate)}/wk</span></span>
      <span><span className="tag">Max</span><span className="v">{fmt$(maxRate)}</span></span>
      <span>
        <span className="tag">Min</span>
        <span className="v">{displayMin ? fmt$(displayMin) : '—'}</span>
      </span>
      {awwOverride && (
        <span title="AWW is below the statutory minimum for the DOA — AWW is the effective floor for every rate."
              style={{color:'var(--ac-2)', fontSize:11, fontWeight:600}}>
          AWW &lt; min · AWW is the floor
        </span>
      )}
      <span style={{marginLeft:'auto', color:'var(--tx-faint)'}}>from {source}</span>
    </div>
  );
}

// ====================================================================
// SLU Tile
// ====================================================================
function SLUTile({ tile, global, onUpdate, onFeeApp }) {
  const inputs = tile.inputs || { rows: [{ id: 1, bp: 'Leg', pct: 0 }], priorPay: 0, priorTTRWks: 0, phpWks: 0 };
  const tt = global.ttRate;

  const setInputs = (next) => onUpdate({ ...tile, inputs: { ...inputs, ...next } });

  const addRow = () => {
    const id = Date.now();
    setInputs({ rows: [...inputs.rows, { id, bp: 'Leg', pct: 0 }] });
  };
  const updateRow = (id, patch) => {
    setInputs({ rows: inputs.rows.map(r => r.id === id ? { ...r, ...patch } : r) });
  };
  const removeRow = (id) => {
    setInputs({ rows: inputs.rows.filter(r => r.id !== id) });
  };

  // Split Opinions (per body-part row) — horizontal outgrowth. The midpoint of
  // TD vs IME fills that row's %SLU; changing TD/IME resets to midpoint; typing
  // the row's own %SLU last overrides.
  const baseW = tileBaseW(tile);
  const splitRow = (inputs.rows || []).find(r => r.id === inputs._splitId) || null;
  const openSplit = (id) => setInputs({ _splitId: id, _expandW: SPLIT_PANEL_W });
  const closeSplit = () => setInputs({ _splitId: null, _expandW: 0 });
  const splitTD  = (v) => updateRow(inputs._splitId, { td: v,  pct: (((Number(v) || 0) + (Number(splitRow && splitRow.ime) || 0)) / 2) });
  const splitIME = (v) => updateRow(inputs._splitId, { ime: v, pct: (((Number(splitRow && splitRow.td) || 0) + (Number(v) || 0)) / 2) });
  const splitVal = (v) => updateRow(inputs._splitId, { pct: v });

  // Single source of truth — shared calc-core (same module the app uses).
  // PHP §15(4-a) multi-part shared healing period + §15(3)(w) credit live there.
  const computed = useMemo(() => window.CD.Calc.computeSLU({
    rows: inputs.rows.map(r => ({ bp: r.bp, pct: r.pct })),
    tt,
    priorTTRWks: inputs.priorTTRWks,
    phpWks: inputs.phpWks,
    priorPay: inputs.priorPay,
  }), [inputs, tt]);

  return (
    <>
      <Inherited {...global} />
      <div className="tile-body" style={{ position: 'relative', width: baseW, boxSizing: 'border-box' }}>
        <div style={{display:'grid', gap:8}}>
          {inputs.rows.map(r => (
            <div className="row cols-slu-bp" key={r.id}>
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
              <div style={{ display: 'flex', gap: 4, alignItems: 'end' }}>
                <button type="button" className={'btn tiny' + (inputs._splitId === r.id ? ' primary' : '')}
                  onClick={() => inputs._splitId === r.id ? closeSplit() : openSplit(r.id)}
                  title="Split treating vs IME opinion" style={{ padding: '2px 7px' }}>⚖</button>
                <button className="delete-row" onClick={() => removeRow(r.id)} title="Remove">×</button>
              </div>
            </div>
          ))}
        </div>
        <button className="btn tiny" onClick={addRow}>+ Add Body Part</button>

        {/* Prior TT/TR/TP (§15(3)(w)) and PHP sit side-by-side. Both are
            case-level inputs (not per body part). PHP is shared across the
            SLU and credits only against the longest healing-period
            requirement among the selected body parts. */}
        <div className="row cols-2" style={{maxWidth: 560}}>
          <div className="f-group">
            <label className="f-label">Prior TT / TR / TP Weeks (§15(3)(w))</label>
            <input className="f-input" type="number" min="0" step="0.5" value={inputs.priorTTRWks || 0}
              onChange={e => setInputs({ priorTTRWks: e.target.value })} />
            <span style={{fontSize:11, color:'var(--tx-faint)'}}>
              Case-level prior weeks. Excess over 130 credited at the TT (total) rate.
            </span>
          </div>
          <div className="f-group">
            <label className="f-label">Prior Wks @ TT (PHP)</label>
            <input className="f-input" type="number" min="0" step="0.5" value={inputs.phpWks || 0}
              onChange={e => setInputs({ phpWks: e.target.value })} />
            <span style={{fontSize:11, color:'var(--tx-faint)'}}>
              Protracted Healing Period — applies once against the longest hp ({computed.maxHp} wks here).
              Credit: {fmtN(computed.phpCreditWks, 2)} wks.
            </span>
          </div>
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
          <div className="r-row"><span className="l">SLU Weeks (parts)</span><span className="v">{fmtN(computed.sluWeeksTotal, 2)}</span></div>
          {computed.phpCreditWks > 0 && (
            <div className="r-row"><span className="l">PHP Credit ({fmtN(computed.phpInput, 2)} − {computed.maxHp} hp)</span><span className="v">+{fmtN(computed.phpCreditWks, 2)} wks</span></div>
          )}
          <div className="r-row"><span className="l">Total SLU Weeks</span><span className="v">{fmtN(computed.totalWeeks, 2)}</span></div>
          <div className="r-row"><span className="l">Gross SLU Value</span><span className="v">{fmt$(computed.grossTotal)}</span></div>
          {computed.creditWks > 0 && (
            <div className="r-row"><span className="l">§15(3)(w) Credit</span><span className="v">−{fmtN(computed.creditWks, 2)} wks @ {fmt$(tt)} = −{fmt$(computed.creditDollars)}</span></div>
          )}
          <div className="r-row big"><span className="l">Total Award</span><span className="v">{fmt$(computed.total)}</span></div>
          <div className="r-row"><span className="l">Moving (after prior)</span><span className="v">{fmt$(computed.moving)}</span></div>
          <div className="r-row"><span className="l">Attorney Fee (15%)</span><span className="v">{fmt$(computed.fee)}</span></div>
          <div className="r-row net"><span className="l">Net to Claimant</span><span className="v">{fmt$(computed.net)}</span></div>
          {typeof onFeeApp === 'function' && (
            <div className="r-feeapp-row">
              <button type="button" className="btn tiny primary tile-feeapp-btn"
                onClick={() => onFeeApp(tile)}
                title="Generate the OC-400.1 fee application from this SLU calculation">
                Generate OC-400.1
              </button>
            </div>
          )}
        </div>
        <SplitFlyout open={!!inputs._splitId}
          title="Split Opinions · % SLU" unit="% SLU" endpoints={['0% (none)', '100% (total)']} lo={0} hi={100}
          treating={splitRow ? (splitRow.td ?? '') : ''} ime={splitRow ? (splitRow.ime ?? '') : ''} value={splitRow ? splitRow.pct : ''}
          onTreating={splitTD} onIme={splitIME} onValue={splitVal} onClose={closeSplit}
          footNote="Midpoint fills this body part's %SLU; changing an opinion re-centers it. Type the row's %SLU last to override." />
      </div>
    </>
  );
}

// ====================================================================
// LWEC Tile
// ====================================================================
function LWECTile({ tile, global, onUpdate, onFeeApp }) {
  const inputs = tile.inputs || { pct: 50, feePerWeek: 0, priorTTRWks: 0 };
  const tt = global.ttRate;
  const aww = global.aww;

  const setInputs = (next) => onUpdate({ ...tile, inputs: { ...inputs, ...next } });

  // Split Opinions (Exertional) — TD vs IME exertional capacity, midpoint level.
  // Qualitative aid; does not auto-set the LWEC%.
  const baseW = tileBaseW(tile);
  const exert = inputs.exert || { on: false, td: '', ime: '', mid: null };
  const setExert = (patch) => setInputs({ exert: { ...exert, ...patch } });
  const openExert = () => setInputs({ exert: { ...exert, on: true }, _expandW: SPLIT_PANEL_W });
  const closeExert = () => setInputs({ exert: { ...exert, on: false }, _expandW: 0 });
  const exTD = (v) => setExert({ td: v, mid: null });
  const exIME = (v) => setExert({ ime: v, mid: null });
  const exMid = (v) => setExert({ mid: v });

  // Single source of truth — shared calc-core. Class rate uses the BOUNDED TT
  // (2/3 AWW capped at max / floored at min) × LWEC%; §15(3)(w) credit (weeks
  // over 130, paid week-for-week at the class rate) handled inside computeLWEC.
  const computed = useMemo(() => window.CD.Calc.computeLWEC({
    pct: inputs.pct, aww,
    minRate: global.minRate, maxRate: global.maxRate,
    priorTTRWks: inputs.priorTTRWks, feePerWeek: inputs.feePerWeek,
  }), [inputs, tt, aww, global.minRate, global.maxRate]);

  return (
    <>
      <Inherited {...global} />
      <div className="tile-body" style={{ position: 'relative', width: baseW, boxSizing: 'border-box' }}>
        <div className="f-group">
          <label className="f-label">LWEC % — {computed.pct}%</label>
          <input type="range" min="0" max="100" value={inputs.pct}
            onChange={e => setInputs({ pct: e.target.value })} />
          <input className="f-input" type="number" min="0" max="100" value={inputs.pct}
            onChange={e => setInputs({ pct: e.target.value })} style={{maxWidth:120}}/>
        </div>
        <button type="button" className={'btn tiny' + (exert.on ? ' primary' : '')}
          onClick={() => exert.on ? closeExert() : openExert()} style={{ alignSelf: 'start' }}
          title="Compare treating vs IME exertional capacity">⚖ Split Opinions</button>
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
          {typeof onFeeApp === 'function' && (
            <div className="r-feeapp-row">
              <button type="button" className="btn tiny primary tile-feeapp-btn"
                onClick={() => onFeeApp(tile)}
                title="Generate the OC-400.1 fee application from this LWEC calculation">
                Generate OC-400.1
              </button>
            </div>
          )}
        </div>
        <ExertionalFlyout open={!!exert.on} td={exert.td} ime={exert.ime} mid={exert.mid}
          onTD={exTD} onIME={exIME} onMid={exMid} onClose={closeExert} />
      </div>
    </>
  );
}

// ====================================================================
// CCP / Award Tile
// ====================================================================
// 'HIA' = Held in Abeyance. Period is documented (date range) but
// contributes $0 to total award. Equation/summary/OC-400.1 prefill all
// show the date range + 'HIA' label with no $ amount.
const DESIGNATIONS = ['TT', 'RE', 'TR', 'TP', 'NCLT', 'NME', 'HIA'];

function weeksBetween(start, end) {
  if (!start || !end) return 0;
  const s = new Date(start), e = new Date(end);
  if (isNaN(s) || isNaN(e) || e < s) return 0;
  const days = (e - s) / (1000 * 60 * 60 * 24) + 1;
  return days / 7;
}

// ── Canonical date helpers (byte-identical across app + website + extension;
// do not let them drift — see ops/secretary/calculator_fixes_scope_and_prompts.md).
// Inclusive day span between two YYYY-MM-DD strings (both endpoints counted).
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

// Round-DOWN to a precision mode. 'tenth' floors to the nearest 0.1 wk,
// 'whole' floors to the nearest 1 wk, anything else returns exact value.
// Used by the CCP tile rounding toggles + mirrored in buildEquation.
function roundWeeksDown(wks, mode) {
  const n = Number(wks) || 0;
  if (mode === 'tenth') return Math.floor(n * 10) / 10;
  if (mode === 'whole') return Math.floor(n);
  return n;
}

// countSpecificOverlaps — how many CCP periods (HIA or not, dated or not
// only counts periods with valid start+end) the reimb window touches. Used
// for the 'applies for N periods' equation prose and the 'Max recoupable
// across N periods' UI hint.
function countSpecificOverlaps(rows, rangeStart, rangeEnd) {
  if (!rangeStart || !rangeEnd || !Array.isArray(rows) || rows.length === 0) return 0;
  const rStart = new Date(rangeStart);
  const rEnd   = new Date(rangeEnd);
  if (isNaN(rStart.getTime()) || isNaN(rEnd.getTime()) || rEnd < rStart) return 0;
  let n = 0;
  for (const p of rows) {
    if (!p.start || !p.end) continue;
    const pStart = new Date(p.start);
    const pEnd   = new Date(p.end);
    if (isNaN(pStart.getTime()) || isNaN(pEnd.getTime())) continue;
    if (pEnd >= rStart && pStart <= rEnd) n++;
  }
  return n;
}

// computeRangeReimbursement — for REIMB ER scope='specific'. The
// reimbursement window has its own start/end; the dollar amount is auto-
// calculated as Σ(overlap weeks × period rate) across every CCP period
// (with a known rate) that overlaps the window. HIA periods contribute 0.
// `rows` are the already-resolved CCPTile.computed.out entries that carry
// the final per-period rate after bounds + amending + HIA handling.
function computeRangeReimbursement(rows, rangeStart, rangeEnd, rounding) {
  if (!rangeStart || !rangeEnd || !Array.isArray(rows) || rows.length === 0) return 0;
  const rStart = new Date(rangeStart);
  const rEnd   = new Date(rangeEnd);
  if (isNaN(rStart.getTime()) || isNaN(rEnd.getTime()) || rEnd < rStart) return 0;
  let total = 0;
  for (const p of rows) {
    if (p.isHia) continue;
    if (!p.start || !p.end) continue;
    const pStart = new Date(p.start);
    const pEnd   = new Date(p.end);
    if (isNaN(pStart.getTime()) || isNaN(pEnd.getTime())) continue;
    const overlapStart = pStart > rStart ? pStart : rStart;
    const overlapEnd   = pEnd   < rEnd   ? pEnd   : rEnd;
    if (overlapEnd < overlapStart) continue;
    const days = (overlapEnd - overlapStart) / (1000 * 60 * 60 * 24) + 1;
    const overlapWksRaw = days / 7;
    const overlapWks = roundWeeksDown(overlapWksRaw, rounding);
    total += overlapWks * (Number(p.rate) || 0);
  }
  return total;
}

// Local-time ISO date strings (YYYY-MM-DD) so the Today / Day-After-Today
// shortcuts on CCP period end-dates produce values compatible with
// <input type="date">.
function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function tomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function CCPTile({ tile, global, onUpdate, onFeeApp }) {
  const inputs = tile.inputs || {
    periods: [
      { id: 1, start: '', end: '', desg: 'TT', curEarn: 0, ratePct: 100, manualRate: 0,
        rateMode: 'pct', // 'pct' | 'usd' — applies to TR and TP designations
        amending: false, priorMode: 'pct', priorVal: 0,
        // Employer reimbursement fields:
        //   reimbErOn       — master toggle for the whole REIMB ER block
        //   reimbErAmount   — $ amount (used when scope='period' or 'all')
        //   reimbErUnknown  — TBD flag; suppresses $ math regardless of scope
        //   reimbErScope    — 'period' | 'all' | 'specific'
        //                     'period'   = $ applies to this period only
        //                     'all'      = $ is the case-level total (exclusive — only one period can hold it)
        //                     'specific' = use reimbErRangeStart/End; amount AUTO-calculated from overlapping period rates
        //   reimbErRangeStart/End — ISO date strings, only used when scope='specific'
        reimbErOn: false, reimbErAmount: 0, reimbErUnknown: false,
        reimbErScope: 'period', reimbErRangeStart: '', reimbErRangeEnd: '',
        // alreadyPaid — period stays in the formal award + Total Award, but its
        // dollars are removed from money moving (and therefore the fee, the
        // equation card, and the OC-400.1 fee-app prefill). Reimbursement
        // capacity is intentionally NOT affected.
        alreadyPaid: false,
        endMode: null },
    ],
    ccpAmount: 0,
    priorPay: 0,
    // Default Round Weeks to Nearest 1/10 wk (round down) — Joel's spec
    // 5/19/26. Attorneys can still toggle this off or to 'whole'.
    rounding: 'tenth', // 'none' | 'tenth' | 'whole'
    doiAutofilled: false, // one-shot flag for DOI → period[0].start
  };
  const tt = global.ttRate;
  const aww = global.aww;
  const setInputs = (next) => onUpdate({ ...tile, inputs: { ...inputs, ...next } });

  // Local UI state — copy-confirmation chip on the Periods Copy button.
  const [copiedSummary, setCopiedSummary] = useState(false);

  // DOI auto-fill — when global.doi transitions from empty → set and the
  // first period's start is still empty AND we haven't auto-filled yet,
  // populate period[0].start with the DOI. One-shot per tile instance:
  // once `doiAutofilled` is true, we never overwrite the user's date again
  // even if the DOI is later changed.
  useEffect(() => {
    if (!global.doi) return;
    if (inputs.doiAutofilled) return;
    const first = inputs.periods && inputs.periods[0];
    if (!first || first.start) return;
    const nextPeriods = inputs.periods.map((p, i) =>
      i === 0 ? { ...p, start: global.doi } : p
    );
    setInputs({ periods: nextPeriods, doiAutofilled: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [global.doi]);

  // Shape of a fresh period — used by both addPeriod (append) and
  // insertPeriodAt (between two existing periods).
  const makePeriod = (start, end) => ({
    id: Date.now() + Math.floor(Math.random() * 1000),
    start: start || '', end: end || '',
    desg: 'TT', curEarn: 0, ratePct: 100, manualRate: 0,
    rateMode: 'pct',
    amending: false, priorMode: 'pct', priorVal: 0,
    reimbErOn: false, reimbErAmount: 0, reimbErUnknown: false,
    reimbErScope: 'period', reimbErRangeStart: '', reimbErRangeEnd: '',
    alreadyPaid: false,
    endMode: null,
  });

  // setReimbErScope — picking 'all' is exclusive: it forces every OTHER
  // period back to 'period' scope. 'period' and 'specific' allow multiple
  // periods independently.
  const setReimbErScope = (id, nextScope) => {
    setInputs({
      periods: inputs.periods.map(p => {
        if (p.id === id) return { ...p, reimbErScope: nextScope };
        if (nextScope === 'all' && p.reimbErScope === 'all') {
          return { ...p, reimbErScope: 'period' };
        }
        return p;
      }),
    });
  };

  const addPeriod = () => {
    // Default the new period's start date to the previous period's end
    // date so chained periods can be built without retyping. Still
    // editable by the user once added.
    const prior = inputs.periods[inputs.periods.length - 1];
    const chainedStart = prior && prior.end ? prior.end : '';
    setInputs({ periods: [...inputs.periods, makePeriod(chainedStart, '')] });
  };

  // insertPeriodAt(i) — splice a fresh period between periods[i] and
  // periods[i+1]. Defaults: start = periods[i].end, end = periods[i+1].start
  // so the new row literally fills the gap between the two siblings the
  // attorney clicked between.
  const insertPeriodAt = (i) => {
    const left = inputs.periods[i];
    const right = inputs.periods[i + 1];
    const start = left && left.end ? left.end : '';
    const end = right && right.start ? right.start : '';
    const next = [
      ...inputs.periods.slice(0, i + 1),
      makePeriod(start, end),
      ...inputs.periods.slice(i + 1),
    ];
    setInputs({ periods: next });
  };

  // "CCP same" — fills the CCP Amount field with the rate from the last
  // period in the builder. Skips when there are no periods or the last
  // period hasn't resolved a rate yet.
  const setCcpFromLastPeriod = () => {
    if (!computed || !Array.isArray(computed.rows) || computed.rows.length === 0) return;
    const last = computed.rows[computed.rows.length - 1];
    if (!last) return;
    const rate = Number(last.rate) || 0;
    if (!rate) return;
    setInputs({ ccpAmount: Math.round(rate * 100) / 100 });
  };
  const updatePeriod = (id, patch) => {
    setInputs({ periods: inputs.periods.map(p => p.id === id ? { ...p, ...patch } : p) });
  };

  // Split Opinions (per TR/TP period) — degree of disability. Midpoint of TD vs
  // IME fills the period's Rate % (in % mode); changing an opinion re-centers it;
  // typing the period's own Rate % last overrides.
  const baseW = tileBaseW(tile);
  const splitPeriod = (inputs.periods || []).find(p => p.id === inputs._splitId) || null;
  const openSplit = (id) => setInputs({ _splitId: id, _expandW: SPLIT_PANEL_W });
  const closeSplit = () => setInputs({ _splitId: null, _expandW: 0 });
  const splitTD  = (v) => updatePeriod(inputs._splitId, { rateMode: 'pct', td: v,  ratePct: (((Number(v) || 0) + (Number(splitPeriod && splitPeriod.ime) || 0)) / 2) });
  const splitIME = (v) => updatePeriod(inputs._splitId, { rateMode: 'pct', ime: v, ratePct: (((Number(splitPeriod && splitPeriod.td) || 0) + (Number(v) || 0)) / 2) });
  const splitVal = (v) => updatePeriod(inputs._splitId, { rateMode: 'pct', ratePct: v });
  const removePeriod = (id) => {
    setInputs({ periods: inputs.periods.filter(p => p.id !== id) });
  };

  const computed = useMemo(() => {
    const ttBase = (Number(aww) || 0) * 2 / 3;
    const rounding = inputs.rounding || 'none';
    const out = inputs.periods.map((p, i) => {
      // HIA (Held in Abeyance) — period is documented in the date range
      // for the record, but contributes $0 to the total award. No rate
      // resolution, no min/max bounds, no amending math.
      if (p.desg === 'HIA') {
        return { ...p, wks: 0, rawCurrentRate: 0, currentRate: 0, priorRate: 0,
                 rate: 0, amount: 0, isHia: true };
      }
      // Raw week count from the dates, then floored to whatever rounding
      // mode is active on the tile. 'none' is the historical exact value.
      const wksRaw = periodWeeks(inputs.periods, i);
      const wks = roundWeeksDown(wksRaw, rounding);
      // Resolve the "current" rate using the desg, exactly as v1.1 did.
      // TR and TP each support a per-period $/% toggle (rateMode).
      const rateMode = p.rateMode || 'pct';
      let rawCurrentRate = 0;
      if (p.desg === 'TT')         rawCurrentRate = tt;
      else if (p.desg === 'RE')    rawCurrentRate = Math.max(0, (Number(aww) - Number(p.curEarn || 0)) * 2 / 3);
      else if (p.desg === 'TR') {
        if (rateMode === 'usd') {
          // Attorney typed a $ rate directly. Treat as the raw rate; min/max
          // bounds still apply below (same as TT/RE).
          rawCurrentRate = Number(p.manualRate || 0);
        } else {
          // TR percentage is applied to the UNCAPPED ⅔ × AWW first; the cap is
          // applied below by applyRateBounds. Using the already-capped TT as the
          // base understates TR any time ⅔ × AWW exceeds the max.
          // Example: AWW $2,258.12, max $1,171.46 (DOI 10/10/24), TR @ 87.5%:
          //   wrong: 0.875 × $1,171.46 = $1,025.03
          //   right: min($1,171.46, 0.875 × ⅔ × $2,258.12) = $1,171.46
          rawCurrentRate = (Number(aww) || 0) * (2 / 3) * (Number(p.ratePct || 0) / 100);
        }
      }
      else if (p.desg === 'TP') {
        if (rateMode === 'pct') {
          // TP % mirrors TR (June 2026 fix) — percentage applied to the
          // UNCAPPED ⅔ × AWW; applyRateBounds below applies the max cap, min
          // floor, and AWW-collapse. Pre-capping understated TP any time
          // ⅔ × AWW exceeded the DOA max.
          //   Example: AWW $2,258.12, max $1,171.46, TP @ 87.5%:
          //     wrong: 0.875 × $1,171.46 = $1,025.03
          //     right: min($1,171.46, 0.875 × ⅔ × $2,258.12) = $1,171.46
          rawCurrentRate = (Number(aww) || 0) * (2 / 3) * (Number(p.ratePct || 0) / 100);
        } else {
          rawCurrentRate = Number(p.manualRate || 0);
        }
      }
      // NCLT (No Compensable Lost Time) and NME (No Medical Evidence) are
      // both $0-comp designations by definition. The period is documented
      // for the record (date range, weeks count) but contributes nothing
      // to the total award. No manual-rate input is shown for either.
      else if (p.desg === 'NCLT' || p.desg === 'NME') rawCurrentRate = 0;
      else                                            rawCurrentRate = Number(p.manualRate || 0);

      // Universal min/max + AWW-override enforcement (May 2026). A 25% TR with
      // raw rate below the DOA min is bumped UP to the min, and any raw rate
      // above the DOA max is bumped DOWN to the max. When AWW < min, all rates
      // collapse to AWW.
      let currentRate = applyRateBounds(rawCurrentRate, aww, global.minRate, global.maxRate);
      // NCLT / NME OVERRIDE — these designations are non-compensable by
      // definition. applyRateBounds would otherwise floor a $0 rate UP to the
      // statutory min (e.g. $325), so we force back to $0 explicitly here.
      if (p.desg === 'NCLT' || p.desg === 'NME') currentRate = 0;
      // RE OVERRIDE (5/20/26 per Joel) — the statutory min floor does NOT
      // apply to RE. The reduced-earnings rate is whatever ⅔ × (AWW − curEarn)
      // computes to, even if that's below the DOA min. The max cap still
      // applies as a legal ceiling, but the AWW-collapse override is also
      // skipped (RE is calculated against actual wage loss, not the floor).
      if (p.desg === 'RE') {
        const maxR = Number(global.maxRate) || 0;
        currentRate = maxR > 0 ? Math.min(rawCurrentRate, maxR) : rawCurrentRate;
      }

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

      return { ...p, wks, rawCurrentRate, currentRate, priorRate, rate, amount: wks * rate, isHia: false };
    });
    const totalAward = out.reduce((s, p) => s + p.amount, 0);
    // Per-period employer reimbursements (REIMB ER). 5/19/26 v5 —
    // CLAIM → CAP → ACTUAL model:
    //   • The user-entered $ amount is what the EMPLOYER IS CLAIMING.
    //   • Actual reimbursement to employer = min(claim, available_cap).
    //   • Available cap per period = min(overlap-amount, period.remainingForReimb).
    //     remainingForReimb starts at period.amount and decreases as prior
    //     REIMB ER claims (in carrier-period order) allocate against it.
    //   • The same period can't be claimed twice — multiple REIMB ER carriers
    //     whose ranges overlap the same period share that period's award capacity.
    // Reimbursements live in a SEPARATE bucket from claimant awards; 15% fee is
    // taken from each bucket independently.
    //
    // Scope rules:
    //   • 'period'   → cap = min(this period's amount, this period's remainingForReimb)
    //   • 'all'      → cap = Σ min(p.amount, p.remainingForReimb) for all non-HIA periods (exclusive carrier)
    //   • 'specific' → cap = Σ min(overlap-amount in p, p.remainingForReimb) for periods overlapping the window
    // Unknown Amount → no $ math, no allocation, flag 'TBD'. HIA always contributes 0.
    let reimbErKnown = 0;
    let reimbErHasUnknown = false;
    // Initialize per-period remaining capacity (gross awards directed by WCB).
    out.forEach(r => { r.remainingForReimb = r.isHia ? 0 : (Number(r.amount) || 0); });

    // Helper — for a given carrier, compute the per-period contribution caps
    // (overlap amount in that period, but ≤ that period's remainingForReimb).
    const resolveContributions = (carrier) => {
      const scope = carrier.reimbErScope || 'period';
      const contribs = []; // [{ p, cap, overlapWks }]
      if (scope === 'period') {
        if (!carrier.isHia) {
          contribs.push({ p: carrier, cap: Math.min(carrier.amount || 0, carrier.remainingForReimb) });
        }
      } else if (scope === 'all') {
        out.forEach(p => {
          if (p.isHia) return;
          const cap = Math.min(p.amount || 0, p.remainingForReimb);
          if (cap >= 0) contribs.push({ p, cap });
        });
      } else if (scope === 'specific') {
        if (!carrier.reimbErRangeStart || !carrier.reimbErRangeEnd) return contribs;
        const rStart = new Date(carrier.reimbErRangeStart);
        const rEnd   = new Date(carrier.reimbErRangeEnd);
        if (isNaN(rStart.getTime()) || isNaN(rEnd.getTime()) || rEnd < rStart) return contribs;
        out.forEach(p => {
          if (p.isHia) return;
          if (!p.start || !p.end) return;
          const pStart = new Date(p.start);
          const pEnd   = new Date(p.end);
          if (isNaN(pStart.getTime()) || isNaN(pEnd.getTime())) return;
          if (pEnd < rStart || pStart > rEnd) return;
          const oStart = pStart > rStart ? pStart : rStart;
          const oEnd   = pEnd   < rEnd   ? pEnd   : rEnd;
          const days = (oEnd - oStart) / (1000 * 60 * 60 * 24) + 1;
          const overlapWks = roundWeeksDown(days / 7, rounding);
          const overlapAmt = overlapWks * (Number(p.rate) || 0);
          // Per-period cap = the smaller of (this overlap's award) and (remaining
          // capacity left after any earlier REIMB ER claims drew from this period).
          const cap = Math.min(overlapAmt, p.remainingForReimb);
          contribs.push({ p, cap, overlapWks });
        });
      }
      return contribs;
    };

    // Process REIMB ER claims in carrier-period order so "prior claims reduce
    // the available cap for later claims that include the same periods."
    out.forEach(carrier => {
      if (!carrier.reimbErOn) return;
      if (carrier.reimbErUnknown) {
        reimbErHasUnknown = true;
        carrier.resolvedReimbErAmount = 0;
        carrier.reimbErClaim = Number(carrier.reimbErAmount) || 0;
        carrier.reimbErAvailableCap = 0;
        carrier.reimbErCapped = false;
        return;
      }
      const contribs = resolveContributions(carrier);
      const claim = Number(carrier.reimbErAmount) || 0;
      const availableCap = contribs.reduce((s, c) => s + Math.max(0, c.cap), 0);
      const actual = Math.min(claim, availableCap);

      carrier.reimbErClaim = claim;
      carrier.reimbErAvailableCap = availableCap;
      carrier.reimbErOverlapCount = contribs.length;
      carrier.resolvedReimbErAmount = actual;
      carrier.reimbErCapped = claim > availableCap + 0.005;

      // Deduct proportionally from each contributing period's remaining capacity.
      if (availableCap > 0 && actual > 0) {
        contribs.forEach(c => {
          if (c.cap <= 0) return;
          const share = (c.cap / availableCap) * actual;
          c.p.remainingForReimb = Math.max(0, c.p.remainingForReimb - share);
        });
      }
      reimbErKnown += actual;
    });

    // Flag every period that's overlapped by any scope=specific reimb window.
    // The 'RE ER' tag in the period summary copy is driven off this.
    out.forEach(r => {
      r.reimbErRecipient = false;
      if (!r.start || !r.end) return;
      const rStart = new Date(r.start);
      const rEnd   = new Date(r.end);
      if (isNaN(rStart.getTime()) || isNaN(rEnd.getTime())) return;
      for (const carrier of out) {
        if (!carrier.reimbErOn) continue;
        if ((carrier.reimbErScope || 'period') !== 'specific') continue;
        if (!carrier.reimbErRangeStart || !carrier.reimbErRangeEnd) continue;
        const cStart = new Date(carrier.reimbErRangeStart);
        const cEnd   = new Date(carrier.reimbErRangeEnd);
        if (isNaN(cStart.getTime()) || isNaN(cEnd.getTime()) || cEnd < cStart) continue;
        if (rEnd >= cStart && rStart <= cEnd) {
          r.reimbErRecipient = true;
          break;
        }
      }
    });
    const totalReimbEr = reimbErKnown; // actual contributions sum, after caps
    // Already-Paid periods — sum the awards of any non-HIA period the attorney
    // flagged as already paid. These stay in Total Award (the formal award
    // still lists them) but drop out of money moving, the fee, and the
    // equation/fee-app prefill. Reimbursement capacity is untouched by design.
    const alreadyPaidSum = out.reduce(
      (s, p) => s + ((!p.isHia && p.alreadyPaid) ? (Number(p.amount) || 0) : 0), 0);
    // Claimant bucket — money moving to the claimant
    const claimantMoving = Math.max(0, totalAward - Number(inputs.priorPay || 0) - reimbErKnown - alreadyPaidSum);
    const feeOnClaimant = claimantMoving * 0.15;
    // Employer bucket — money moving back to the employer as reimbursement
    const employerMoving = reimbErKnown;
    const feeOnEmployer = employerMoving * 0.15;
    // CCP — § ÷3 fee on Continuing Compensation Pay
    const feeOnCCP = Number(inputs.ccpAmount || 0) / 3;
    // Totals
    const totalFee = feeOnClaimant + feeOnEmployer + feeOnCCP;
    const netToClaimant = claimantMoving - feeOnClaimant - feeOnCCP;
    const netToEmployer = employerMoving - feeOnEmployer;
    return {
      rows: out, totalAward,
      totalReimbEr, reimbErKnown, reimbErHasUnknown,
      alreadyPaidSum,
      claimantMoving, feeOnClaimant,
      employerMoving, feeOnEmployer,
      feeOnCCP, totalFee,
      netToClaimant, netToEmployer,
      // Back-compat aliases — other code (the bottom equation card via
      // window.buildEquation) reads these names; keep them mirrored so the
      // refactor is a no-op on the consumer side.
      moving: claimantMoving,
      feeOnAward: feeOnClaimant,
      net: netToClaimant,
    };
  }, [inputs, tt, aww, global.minRate, global.maxRate]);

  // CCP as a percentage of the claimant's TRUE weekly rate — the UNCAPPED
  // ⅔ × AWW, NOT the statutory-capped global.ttRate. This mirrors the TR/TP
  // convention (June 2026 fix): a percentage is applied to the uncapped
  // ⅔ AWW, so the inverse readout must divide by the same base. Dividing by
  // the capped rate overstated the % any time ⅔ × AWW exceeded the DOA max
  // (e.g. AWW $2,100 → 75% TR = $1,050; wrong: $1,050 ÷ capped $1,281.50 =
  // 81.9%; right: $1,050 ÷ uncapped $1,400 = 75.0%). Clamped at 100% so a
  // claimant at/above full TT (incl. the AWW-below-min collapse) never reads
  // over 100%. Surfaced as a small read-only field between CCP Amount and
  // Prior Payments. Null when there's no CCP amount or no resolvable AWW.
  const ccpTrueRate = (Number(aww) || 0) * 2 / 3;
  const ccpPctOfRate = (Number(inputs.ccpAmount) > 0 && ccpTrueRate > 0)
    ? Math.min(100, (Number(inputs.ccpAmount) / ccpTrueRate) * 100)
    : null;

  return (
    <>
      <Inherited {...global} />
      {/* Week-rounding selector — mutually exclusive, both can be off.
          When on, every period's week count is floored to the chosen
          precision and the rounded value drives totalAward, moving, fee,
          net, the equation card, and the fee-app prefill. */}
      <div className="ccp-rounding-row">
        <span className="ccp-rounding-label">Round Weeks</span>
        <div className="ccp-rounding-toggle" role="radiogroup" aria-label="Round weeks">
          <button type="button" role="radio"
            aria-checked={(inputs.rounding || 'none') === 'tenth'}
            className={'ccp-rounding-pill ' + ((inputs.rounding || 'none') === 'tenth' ? 'on' : '')}
            onClick={() => setInputs({ rounding: (inputs.rounding === 'tenth') ? 'none' : 'tenth' })}>
            Nearest 1/10 wk (round down)
          </button>
          <button type="button" role="radio"
            aria-checked={(inputs.rounding || 'none') === 'whole'}
            className={'ccp-rounding-pill ' + ((inputs.rounding || 'none') === 'whole' ? 'on' : '')}
            onClick={() => setInputs({ rounding: (inputs.rounding === 'whole') ? 'none' : 'whole' })}>
            Nearest whole wk (round down)
          </button>
        </div>
      </div>
      <div className="tile-body" style={{ position: 'relative', width: baseW, boxSizing: 'border-box' }}>
        <div style={{display:'grid', gap:8}}>
          {inputs.periods.map((p, i) => (
            <React.Fragment key={p.id}>
            <div className="period-row">
              <div className="row cols-2">
                <div className="f-group">
                  <label className="f-label">Start</label>
                  <input className="f-input" type="date" value={p.start}
                    onChange={e => updatePeriod(p.id, { start: e.target.value })}/>
                </div>
                <div className="f-group">
                  <label className="f-label">End</label>
                  <input className="f-input" type="date" value={p.end}
                    onChange={e => updatePeriod(p.id, { end: e.target.value, endMode: null })}/>
                  {/* Today / Day-After-Today shortcuts. Mutually exclusive,
                      both can be off. Clicking an active pill toggles it
                      off (leaves the date as-is). Manual date edits clear
                      both toggles via the onChange above. */}
                  <div className="ccp-end-shortcuts">
                    <button type="button"
                      className={'ccp-end-shortcut-pill ' + (p.endMode === 'today' ? 'on' : '')}
                      aria-pressed={p.endMode === 'today'}
                      onClick={() => {
                        if (p.endMode === 'today') updatePeriod(p.id, { endMode: null });
                        else updatePeriod(p.id, { end: todayISO(), endMode: 'today' });
                      }}>
                      Today
                    </button>
                    <button type="button"
                      className={'ccp-end-shortcut-pill ' + (p.endMode === 'tomorrow' ? 'on' : '')}
                      aria-pressed={p.endMode === 'tomorrow'}
                      onClick={() => {
                        if (p.endMode === 'tomorrow') updatePeriod(p.id, { endMode: null });
                        else updatePeriod(p.id, { end: tomorrowISO(), endMode: 'tomorrow' });
                      }}>
                      Day After Today
                    </button>
                  </div>
                </div>
              </div>
              <div className="f-group">
                <label className="f-label">Designation</label>
                <div className="desg-pills">
                  {DESIGNATIONS.map(d => (
                    <button key={d} className={'desg-pill ' + (p.desg === d ? 'active' : '') + (d === 'HIA' ? ' desg-pill-hia' : '')}
                      onClick={() => updatePeriod(p.id, { desg: d })}>{d}</button>
                  ))}
                </div>
              </div>
              {p.desg === 'HIA' && (
                <div className="hia-note">
                  Held in Abeyance — date range is recorded; this period contributes $0 to the total award.
                </div>
              )}
              {p.desg === 'RE' && (() => {
                // RE rate formula: ⅔ × (AWW − current earnings). The statutory
                // MIN floor does NOT apply to RE — the reduced-earnings rate
                // is whatever the math produces. Max cap still applies as a
                // legal ceiling but rarely fires in practice.
                const reRow = computed.rows.find(r => r.id === p.id);
                const rawRE = Math.max(0, (Number(aww) - Number(p.curEarn || 0)) * 2 / 3);
                const finalRE = reRow?.currentRate;
                const maxCapFired = finalRE != null && rawRE > finalRE + 0.005;
                return (
                  <div className="f-group">
                    <label className="f-label">Current Earnings (wk)</label>
                    <div className="f-input-wrap">
                      <span className="prefix">$</span>
                      <input className="f-input with-prefix" type="number" value={p.curEarn}
                        onChange={e => updatePeriod(p.id, { curEarn: e.target.value })}/>
                    </div>
                    <div className="re-formula-hint">
                      <span className="re-formula-label">Formula:</span>
                      <span className="re-formula-body">
                        ⅔ × ({fmt$(aww)} − {fmt$(Number(p.curEarn) || 0)}) = {fmt$(rawRE)}/wk
                      </span>
                      {maxCapFired && finalRE != null && (
                        <span className="re-formula-bounded">
                          → capped at {fmt$(finalRE)}/wk (DOA max rate)
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}
              {(p.desg === 'TR' || p.desg === 'TP') && (() => {
                // TR/TP $/% toggle. Default mode is '%'. In % mode, the user
                // types a percentage; in $ mode, the user types the actual
                // weekly rate. Toggle pills mirror the Amending Award $/% pair
                // for visual consistency.
                const mode = p.rateMode || 'pct';
                return (
                  <div className="f-group">
                    <div className="rate-toggle-row">
                      <label className="f-label" style={{ margin: 0 }}>
                        {mode === 'pct' ? 'Rate %' : 'Rate ($)'}
                      </label>
                      <div className="rate-mode-toggle" role="radiogroup" aria-label="Rate input mode">
                        <button type="button" role="radio"
                          aria-checked={mode === 'pct'}
                          className={'rate-mode-pill ' + (mode === 'pct' ? 'on' : '')}
                          onClick={() => updatePeriod(p.id, { rateMode: 'pct' })}>%</button>
                        <button type="button" role="radio"
                          aria-checked={mode === 'usd'}
                          className={'rate-mode-pill ' + (mode === 'usd' ? 'on' : '')}
                          onClick={() => updatePeriod(p.id, { rateMode: 'usd' })}>$</button>
                      </div>
                    </div>
                    {mode === 'pct' ? (
                      <input className="f-input" type="number" min="0" max="100" value={p.ratePct}
                        onChange={e => updatePeriod(p.id, { ratePct: e.target.value })}/>
                    ) : (
                      <div className="f-input-wrap">
                        <span className="prefix">$</span>
                        <input className="f-input with-prefix" type="number" value={p.manualRate}
                          onChange={e => updatePeriod(p.id, { manualRate: e.target.value })}/>
                      </div>
                    )}
                  </div>
                );
              })()}
              {(p.desg === 'TR' || p.desg === 'TP') && (
                <button type="button" className={'btn tiny' + (inputs._splitId === p.id ? ' primary' : '')}
                  onClick={() => inputs._splitId === p.id ? closeSplit() : openSplit(p.id)}
                  style={{ marginTop: 2 }} title="Split treating vs IME degree of disability">
                  ⚖ Split Opinions
                </button>
              )}
              {/* NCLT (No Compensable Lost Time) and NME (No Medical Evidence)
                  are $0-comp designations by definition — no manual rate
                  input is rendered. The period is documented for the record
                  (date range, weeks) but contributes $0 to the total award. */}
              {/* REIMB ER (reimburse employer) — per-period toggle. When ON,
                  the period contributes a separate "money moving back to
                  employer" bucket to the case-level math. Fee runs at 15%
                  on that bucket too. Two sub-toggles control the input:
                    • Amount status: Known Amount  /  Unknown Amount
                    • Scope:         Just this period  /  Across all periods  /  Specific date range
                  When scope=specific, the dollar amount is auto-calculated
                  from the rates of overlapping CCP periods. */}
              <div className="f-group">
                <button
                  type="button"
                  className={'amending-toggle ' + (p.reimbErOn ? 'on' : '')}
                  onClick={() => updatePeriod(p.id, { reimbErOn: !p.reimbErOn })}
                  aria-pressed={!!p.reimbErOn}>
                  {p.reimbErOn ? '✓ REIMB ER' : '+ REIMB ER'}
                </button>
                {p.reimbErOn && (() => {
                  const scope = p.reimbErScope || 'period';
                  const isUnknown = !!p.reimbErUnknown;
                  const carrierRow = computed.rows.find(r => r.id === p.id);
                  const availableCap = carrierRow?.reimbErAvailableCap || 0;
                  const overlapCount = carrierRow?.reimbErOverlapCount || 0;
                  const actualAmt = carrierRow?.resolvedReimbErAmount || 0;
                  const claim = carrierRow?.reimbErClaim || 0;
                  const isCapped = !!carrierRow?.reimbErCapped;
                  return (
                    <div className="amending-block">
                      <label className="f-label" style={{margin:0}}>Reimbursement to Employer</label>
                      {/* Known / Unknown two-state segmented toggle */}
                      <div className="reimb-mode-toggle" role="radiogroup" aria-label="Reimbursement amount status">
                        <button type="button" role="radio"
                          aria-checked={!isUnknown}
                          className={'reimb-mode-pill ' + (!isUnknown ? 'on' : '')}
                          onClick={() => updatePeriod(p.id, { reimbErUnknown: false })}>
                          Known Amount
                        </button>
                        <button type="button" role="radio"
                          aria-checked={isUnknown}
                          className={'reimb-mode-pill ' + (isUnknown ? 'on' : '')}
                          onClick={() => updatePeriod(p.id, { reimbErUnknown: true })}>
                          Unknown Amount
                        </button>
                      </div>
                      {/* Scope three-state segmented toggle */}
                      <div className="reimb-scope-toggle" role="radiogroup" aria-label="Reimbursement scope">
                        <button type="button" role="radio"
                          aria-checked={scope === 'period'}
                          className={'reimb-scope-pill ' + (scope === 'period' ? 'on' : '')}
                          onClick={() => setReimbErScope(p.id, 'period')}>
                          Just this period
                        </button>
                        <button type="button" role="radio"
                          aria-checked={scope === 'all'}
                          className={'reimb-scope-pill ' + (scope === 'all' ? 'on' : '')}
                          onClick={() => setReimbErScope(p.id, 'all')}
                          title="Exclusive — only one period at a time can hold the case-wide reimbursement.">
                          Across all periods
                        </button>
                        <button type="button" role="radio"
                          aria-checked={scope === 'specific'}
                          className={'reimb-scope-pill ' + (scope === 'specific' ? 'on' : '')}
                          onClick={() => setReimbErScope(p.id, 'specific')}>
                          Specific date range
                        </button>
                      </div>
                      {/* Date range — only shown when scope = specific */}
                      {scope === 'specific' && (
                        <div className="reimb-range-row">
                          <div className="f-group" style={{flex:1, margin:0}}>
                            <label className="f-label">Reimb. Start</label>
                            <input className="f-input" type="date"
                              value={p.reimbErRangeStart || ''}
                              onChange={e => updatePeriod(p.id, { reimbErRangeStart: e.target.value })}/>
                          </div>
                          <div className="f-group" style={{flex:1, margin:0}}>
                            <label className="f-label">Reimb. End</label>
                            <input className="f-input" type="date"
                              value={p.reimbErRangeEnd || ''}
                              onChange={e => updatePeriod(p.id, { reimbErRangeEnd: e.target.value })}/>
                          </div>
                        </div>
                      )}
                      {/* Max-recoupable hint — shown for any Known scope. Reflects the
                          DYNAMIC cap (gross awards in scope minus prior REIMB ER allocations
                          on overlapping periods). HIA periods contribute 0. */}
                      {!isUnknown && (
                        <div className="reimb-computed-preview">
                          <span className="reimb-computed-label">Max recoupable:</span>
                          <span className="reimb-computed-value">{fmt$(availableCap)}</span>
                          {overlapCount > 0 && (
                            <span className="reimb-computed-hint">across {overlapCount} period{overlapCount === 1 ? '' : 's'}</span>
                          )}
                        </div>
                      )}
                      {/* Claim input — what the EMPLOYER IS CLAIMING. The actual reimbursement
                          (the value that flows into the employer bucket) is capped at the
                          available awards. Shown for any Known scope. */}
                      {!isUnknown && (
                        <div className="f-input-wrap">
                          <span className="prefix">$</span>
                          <input className="f-input with-prefix" type="number" min="0"
                            value={p.reimbErAmount || 0}
                            onChange={e => updatePeriod(p.id, { reimbErAmount: Number(e.target.value) })}/>
                        </div>
                      )}
                      {/* "Capped at $X (claimed $Y)" — inline alert when the user's claim
                          exceeds the available awards in scope. */}
                      {!isUnknown && isCapped && (
                        <div className="reimb-capped-banner">
                          Capped at {fmt$(availableCap)} (claimed {fmt$(claim)}). Employer can't be reimbursed more than the awards directed by WCB in scope.
                        </div>
                      )}
                      <div className="amending-help">
                        {isUnknown
                          ? 'REIMB ER amount TBD.'
                          : scope === 'all'
                            ? 'Case-wide claim across all periods; actual reimbursement capped at available awards. Fee at 15% taken from the employer bucket, separate from claimant fee.'
                            : scope === 'specific'
                              ? 'Total reimbursement claim across the periods the window touches; actual reimbursement capped at available awards (less anything already reimbursed via prior REIMB ER claims on the same periods).'
                              : 'Period-specific reimbursement claim; actual reimbursement capped at that period\'s award. Fee at 15% taken from the employer bucket.'}
                      </div>
                    </div>
                  );
                })()}
              </div>
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
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', fontFamily:'var(--mono)', fontSize:11, color:'var(--tx-dim)', borderTop:'1px solid var(--bd-soft)', paddingTop:8, gap:8}}>
                {p.desg === 'HIA' ? (
                  <span style={{fontStyle:'italic', color:'var(--tx-faint)'}}>
                    Held in Abeyance — contributes $0 to total award
                  </span>
                ) : (
                  <span>{fmtN(computed.rows.find(r => r.id === p.id)?.wks, 2)} wks × {fmt$(computed.rows.find(r => r.id === p.id)?.rate)}{p.amending ? ' (amending)' : ''}</span>
                )}
                <span style={{display:'flex', alignItems:'center', gap:6}}>
                  <span style={{color:'var(--ac-2)'}}>{fmt$(computed.rows.find(r => r.id === p.id)?.amount)}</span>
                  {computed.rows.find(r => r.id === p.id)?.reimbErRecipient && (
                    <span className="reer-row-tag" title="This period overlaps with a specific-range REIMB ER">RE ER</span>
                  )}
                </span>
                <button className="delete-row" onClick={() => removePeriod(p.id)}>×</button>
              </div>
            </div>
            {i < inputs.periods.length - 1 && (
              <div className="period-insert-row">
                <button
                  type="button"
                  className="period-insert-btn"
                  onClick={() => insertPeriodAt(i)}
                  title="Insert a new period between these two">
                  + Add Period
                </button>
              </div>
            )}
            </React.Fragment>
          ))}
        </div>
        <button className="btn tiny" onClick={addPeriod}>+ Add Period</button>

        <div className="row ccp-builder-fields">
          <div className="f-group">
            <div className="ccp-amount-head">
              <label className="f-label" style={{margin:0}}>CCP Amount</label>
              <button type="button"
                className="btn tiny ccp-same-btn"
                onClick={setCcpFromLastPeriod}
                title="Fill CCP Amount with the rate from the last period entered"
                disabled={!computed.rows.length || !Number(computed.rows[computed.rows.length - 1]?.rate)}>
                CCP same
              </button>
            </div>
            <div className="f-input-wrap">
              <span className="prefix">$</span>
              <input className="f-input with-prefix" type="number" value={inputs.ccpAmount}
                onChange={e => setInputs({ ccpAmount: e.target.value })}/>
            </div>
          </div>
          <div className="f-group ccp-pct-group">
            <label className="f-label">% of Rate</label>
            <div className="ccp-pct-display"
              title="CCP as a percentage of the claimant's true weekly rate (uncapped ⅔ × AWW), clamped at 100%.">
              {ccpPctOfRate != null ? ccpPctOfRate.toFixed(1) + '%' : '—'}
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

        {/* Period Summary — copy-friendly plain-text-style lines so an
            attorney can paste the periods into hearing notes / docs.
            Format per row:
              M/D/YYYY-M/D/YYYY [$rate] DESG [(XX%) if TR/RE] [REIMB ER −$X]
            Rate is omitted entirely for NCLT/NME (those are zero-comp
            designations by definition); the /wk suffix is dropped because
            attorneys reading the line know the rate is weekly. */}
        {computed.rows.length > 0 && (() => {
          // ISO `YYYY-MM-DD` from <input type="date"> → natural M/D/YYYY,
          // no leading zeros on month/day (e.g. 3/9/2026 not 03/09/2026).
          const fmtMDY = (iso) => {
            if (!iso || typeof iso !== 'string') return '';
            const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (!m) return iso;
            return `${parseInt(m[2],10)}/${parseInt(m[3],10)}/${m[1]}`;
          };
          const buildRow = (p) => {
            const startStr = fmtMDY(p.start);
            const endStr   = fmtMDY(p.end);
            const dateStr  = (startStr || endStr) ? `${startStr || '—'}-${endStr || '—'}` : '—';
            // HIA — no rate, no %; just the date range + HIA label.
            if (p.desg === 'HIA') {
              return [dateStr, 'HIA'].join(' ');
            }
            const showRate = p.desg !== 'NCLT' && p.desg !== 'NME';
            // Amending rows display the full NEW amended rate (currentRate);
            // the per-week delta is shown separately as a trailing
            // "difference/wk" token. Non-amending rows show the rate as-is.
            const rateStr  = showRate ? fmt$(p.amending ? p.currentRate : p.rate) : '';
            let diffStr = '';
            if (p.amending && showRate) {
              const diff = (Number(p.currentRate) || 0) - (Number(p.priorRate) || 0);
              diffStr = fmt$(diff) + ' difference/wk';
            }
            let pctStr = '';
            const pMode = p.rateMode || 'pct';
            if ((p.desg === 'TR' || p.desg === 'TP') && pMode === 'pct') {
              pctStr = `(${Number(p.ratePct) || 0}%)`;
            } else if (p.desg === 'RE' && aww > 0) {
              const wageLossPct = Math.max(0, Math.min(100, ((aww - Number(p.curEarn || 0)) / aww) * 100));
              pctStr = `(${wageLossPct.toFixed(1)}%)`;
            }
            // REIMB ER display on the carrier period (where the toggle lives).
            // For scope='specific', the carrier doesn't show a $ amount inline —
            // the 'RE ER' tag added below (driven by the overlap flag) handles
            // every overlapped period uniformly, including the carrier.
            let reimbStr = '';
            if (p.reimbErOn) {
              const scope = p.reimbErScope || 'period';
              if (scope === 'specific') {
                reimbStr = '';
              } else if (p.reimbErUnknown) {
                reimbStr = 'REIMB ER TBD';
              } else {
                const resolved = Number(p.resolvedReimbErAmount) || 0;
                if (resolved > 0) {
                  const scopeTag = scope === 'all' ? ' case-wide' : '';
                  reimbStr = `REIMB ER${scopeTag} −${fmt$(resolved)}`;
                }
              }
            }
            // RE ER tag — applied to every period whose dates overlap any
            // scope='specific' reimbursement window in this CCP tile.
            const reTag = p.reimbErRecipient ? 'RE ER' : '';
            // Single-space joiner per Joel's spec: dates  RATE  DESG  (%)  REIMB  RE-ER.
            return [dateStr, rateStr, p.desg, pctStr, reimbStr, reTag, diffStr].filter(Boolean).join(' ');
          };
          const plainText = computed.rows.map(buildRow).join('\n');
          const onCopySummary = async () => {
            try { await navigator.clipboard.writeText(plainText); }
            catch (e) {
              const ta = document.createElement('textarea');
              ta.value = plainText;
              document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
            }
            setCopiedSummary(true);
            setTimeout(() => setCopiedSummary(false), 1500);
          };
          return (
            <div className="ccp-summary">
              <div className="ccp-summary-head">
                <span className="ccp-summary-title">Periods</span>
                <div className="ccp-summary-actions">
                  <button type="button" className="btn tiny ccp-summary-copy"
                    onClick={onCopySummary}
                    title="Copy these lines to the clipboard for paste into hearing notes">
                    {copiedSummary ? 'Copied ✓' : 'Copy'}
                  </button>
                  {typeof onFeeApp === 'function' && (
                    <button type="button"
                      className="btn tiny primary ccp-summary-feeapp"
                      onClick={() => onFeeApp(tile)}
                      title="Generate the OC-400.1 fee application from this calculation">
                      Generate OC-400.1
                    </button>
                  )}
                </div>
              </div>
              {computed.rows.map((p) => {
                const isPaid = !!p.alreadyPaid;
                // Only periods that actually produce an award can be "already
                // paid" — HIA / NCLT / NME / $0 rows have nothing to deduct.
                const canPay = !p.isHia && Number(p.amount) > 0;
                return (
                  <div className={'ccp-summary-row' + (isPaid ? ' is-paid' : '')} key={p.id}>
                    <span className="ccp-summary-row-text">{buildRow(p)}</span>
                    {canPay && (
                      <button type="button"
                        className={'ccp-paid-toggle' + (isPaid ? ' on' : '')}
                        aria-pressed={isPaid}
                        onClick={() => updatePeriod(p.id, { alreadyPaid: !isPaid })}
                        title="Mark this period as already paid — it stays in the formal award and Total Award, but its dollars are removed from money moving, the fee, and the OC-400.1.">
                        {isPaid ? '✓ Already Paid' : 'Already Paid'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}

        <div className="results">
          <div className="r-row big"><span className="l">Total Award</span><span className="v">{fmt$(computed.totalAward)}</span></div>
          {Number(inputs.priorPay || 0) > 0 && (
            <div className="r-row"><span className="l">Less Prior Payments</span><span className="v">−{fmt$(Number(inputs.priorPay || 0))}</span></div>
          )}
          {computed.alreadyPaidSum > 0 && (
            <div className="r-row"><span className="l">Less Already-Paid Periods</span><span className="v">−{fmt$(computed.alreadyPaidSum)}</span></div>
          )}
          {computed.reimbErKnown > 0 && (
            <div className="r-row"><span className="l">Less Reimb to ER (to employer bucket)</span><span className="v">−{fmt$(computed.reimbErKnown)}</span></div>
          )}
          {computed.reimbErHasUnknown && (
            <div className="r-row"><span className="l">Reimb to ER</span><span className="v" style={{fontStyle:'italic', color:'var(--tx-faint)'}}>TBD</span></div>
          )}
          {/* Claimant bucket */}
          <div className="r-row"><span className="l">Moving to Claimant</span><span className="v">{fmt$(computed.claimantMoving)}</span></div>
          <div className="r-row"><span className="l">Fee from Claimant (15%)</span><span className="v">{fmt$(computed.feeOnClaimant)}</span></div>
          {Number(inputs.ccpAmount || 0) > 0 && (
            <div className="r-row"><span className="l">Fee on CCP (÷3)</span><span className="v">{fmt$(computed.feeOnCCP)}</span></div>
          )}
          {/* Employer bucket — only shown when there's an employer reimbursement */}
          {computed.employerMoving > 0 && (
            <>
              <div className="r-row r-row-employer"><span className="l">Moving to Employer (reimb)</span><span className="v">{fmt$(computed.employerMoving)}</span></div>
              <div className="r-row r-row-employer"><span className="l">Fee from Employer Reimb (15%)</span><span className="v">{fmt$(computed.feeOnEmployer)}</span></div>
            </>
          )}
          <div className="r-row"><span className="l">Total Fee</span><span className="v">{fmt$(computed.totalFee)}</span></div>
          <div className="r-row net"><span className="l">Net to Claimant</span><span className="v">{fmt$(computed.netToClaimant)}</span></div>
          {computed.employerMoving > 0 && (
            <div className="r-row net r-row-employer"><span className="l">Net to Employer</span><span className="v">{fmt$(computed.netToEmployer)}</span></div>
          )}
        </div>
        <SplitFlyout open={!!inputs._splitId}
          title="Split Opinions · Degree of Disability" unit="%" endpoints={['0% (no disability)', '100% (TT)']} lo={0} hi={100}
          treating={splitPeriod ? (splitPeriod.td ?? '') : ''} ime={splitPeriod ? (splitPeriod.ime ?? '') : ''} value={splitPeriod ? splitPeriod.ratePct : ''}
          onTreating={splitTD} onIme={splitIME} onValue={splitVal} onClose={closeSplit}
          footNote="Applies to this TR/TP period's Rate % (degree of disability). Rate = degree × ⅔ AWW (bounded). Type the period's Rate % last to override." />
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

  // Single source of truth — shared calc-core.
  const c = useMemo(() => window.CD.Calc.computeBurns({
    indemnity: inputs.indemnity, medical: inputs.medical, gross: inputs.gross,
    attyFee: inputs.attyFee, disbursements: inputs.disbursements,
    isMVA: inputs.isMVA, mvaThreshold: inputs.mvaThreshold,
  }), [inputs]);

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
//   Three set-aside modes:
//     'none'     → Net = Settlement − 15% fee on the full settlement.
//     'msa'      → Non-Medicare MSA. Net = Settlement − MSA − 15% fee
//                  on (Settlement − MSA).
//     'medicare' → Settlement = MSA + Indemnity. Fee runs ONLY on the
//                  indemnity portion: Net to Claimant = Indemnity − 15%.
//                  Mathematically equivalent to 'msa' but labeled around
//                  the formal WCMSA / indemnity split that CMS submissions
//                  use.
// ====================================================================
function SettlementTile({ tile, global, onUpdate, onFeeApp }) {
  const inputs = tile.inputs || { settlement: 0, msa: 0, msaType: 'none', msaMode: 'usd', msaPct: 5 };
  const setInputs = (next) => onUpdate({ ...tile, inputs: { ...inputs, ...next } });

  // Carrier negotiation outgrowth — Demand vs Offer → editable midpoint feeds
  // the Settlement Amount (last-write-wins; typing the field above overrides).
  const baseW = tileBaseW(tile);
  const neg = inputs.neg || { on: false, demand: 0, offer: 0 };
  const openNeg = () => setInputs({ neg: { ...neg, on: true }, _expandW: SPLIT_PANEL_W });
  const closeNeg = () => setInputs({ neg: { ...neg, on: false }, _expandW: 0 });
  const negDemand = (v) => setInputs({ neg: { ...neg, demand: v }, settlement: (((Number(v) || 0) + (Number(neg.offer) || 0)) / 2) });
  const negOffer  = (v) => setInputs({ neg: { ...neg, offer: v },  settlement: (((Number(neg.demand) || 0) + (Number(v) || 0)) / 2) });
  const negVal    = (v) => setInputs({ settlement: v });

  // Mode-switching helper: when the user picks MSA-regular for the first time
  // (no msaMode set yet), default to 'pct' with 5% preset per Joel's spec.
  const onMsaTypeChange = (id) => {
    if (id === 'msa' && !inputs.msaMode) {
      setInputs({ msaType: id, msaMode: 'pct', msaPct: inputs.msaPct || 5 });
    } else {
      setInputs({ msaType: id });
    }
  };

  // Single source of truth — shared calc-core (handles msaOn back-compat).
  const c = useMemo(() => window.CD.Calc.computeSettlement({
    settlement: inputs.settlement, msa: inputs.msa, msaType: inputs.msaType,
    msaMode: inputs.msaMode, msaPct: inputs.msaPct, msaOn: inputs.msaOn,
  }), [inputs]);

  const MSA_TYPES = [
    { id: 'none',     label: 'None' },
    { id: 'msa',      label: 'MSA' },
    { id: 'medicare', label: 'Medicare MSA' },
  ];

  return (
    <div className="tile-body" style={{ position: 'relative', width: baseW, boxSizing: 'border-box' }}>
      <div className="f-group">
        <label className="f-label">Settlement Amount</label>
        <div className="f-input-wrap"><span className="prefix">$</span>
          <input className="f-input with-prefix" type="number" min="0" value={inputs.settlement}
            onChange={e => setInputs({ settlement: e.target.value })}/></div>
      </div>
      <button type="button" className={'btn tiny' + (neg.on ? ' primary' : '')}
        onClick={() => neg.on ? closeNeg() : openNeg()} style={{ alignSelf: 'start' }}
        title="Compare claimant demand vs carrier offer">⚖ Carrier Negotiation</button>

      {/* Set-aside type — three-way segmented selector. */}
      <div className="msa-type-row">
        <label className="f-label" style={{margin: 0}}>Set-Aside</label>
        <div className="msa-type-toggle" role="radiogroup" aria-label="Set-aside type">
          {MSA_TYPES.map(opt => (
            <button key={opt.id} type="button" role="radio"
              aria-checked={c.msaType === opt.id}
              className={'msa-type-pill ' + (c.msaType === opt.id ? 'on' : '')}
              onClick={() => onMsaTypeChange(opt.id)}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {c.hasMSA && (
        <div className="f-group">
          <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, marginBottom:4}}>
            <label className="f-label" style={{margin:0}}>
              {c.msaType === 'medicare' ? 'Medicare Set-Aside (WCMSA)' : 'Medical Set-Aside'}
            </label>
            {/* $ / % mode switch — lets the attorney enter a flat dollar
                amount or a percentage of the settlement. Defaults to 5%
                when MSA-regular is first selected. */}
            <div className="msa-mode-toggle" role="radiogroup" aria-label="MSA amount mode">
              <button type="button" role="radio"
                aria-checked={c.msaMode === 'usd'}
                className={'msa-mode-pill ' + (c.msaMode === 'usd' ? 'on' : '')}
                onClick={() => setInputs({ msaMode: 'usd' })}>$</button>
              <button type="button" role="radio"
                aria-checked={c.msaMode === 'pct'}
                className={'msa-mode-pill ' + (c.msaMode === 'pct' ? 'on' : '')}
                onClick={() => setInputs({ msaMode: 'pct', msaPct: inputs.msaPct || 5 })}>%</button>
            </div>
          </div>
          {c.msaMode === 'pct' ? (
            <>
              <div style={{display:'flex', alignItems:'center', gap:6}}>
                <input className="f-input" type="number" min="0" max="100" step="0.1"
                  style={{flex:1}}
                  value={inputs.msaPct ?? 5}
                  onChange={e => setInputs({ msaPct: e.target.value })}/>
                <span style={{color:'var(--tx-dim)', fontFamily:'var(--mono)', fontSize:13}}>%</span>
              </div>
              <span style={{fontSize:11, color:'var(--tx-faint)'}}>
                = {fmt$(c.msa)} ({c.msaPct}% × {fmt$(c.settlement)}).
                {c.msaType === 'medicare'
                  ? ' Fee runs only on the indemnity portion.'
                  : ' Fee runs on the post-MSA remainder.'}
              </span>
            </>
          ) : (
            <>
              <div className="f-input-wrap"><span className="prefix">$</span>
                <input className="f-input with-prefix" type="number" min="0" value={inputs.msa || ''}
                  onChange={e => setInputs({ msa: e.target.value })}/></div>
              <span style={{fontSize:11, color:'var(--tx-faint)'}}>
                {c.msaType === 'medicare'
                  ? 'Total settlement = Medicare MSA + Indemnity. Fee runs only on the indemnity portion.'
                  : 'Carved out before fee; fee runs only on the remainder.'}
              </span>
            </>
          )}
        </div>
      )}

      <div className="results">
        <div className="r-row"><span className="l">Settlement</span><span className="v">{fmt$(c.settlement)}</span></div>
        {c.hasMSA && (
          <div className="r-row">
            <span className="l">{c.msaType === 'medicare' ? 'Less Medicare MSA' : 'Less MSA'}</span>
            <span className="v">−{fmt$(c.msa)}</span>
          </div>
        )}
        {c.msaType === 'medicare' && (
          <div className="r-row big"><span className="l">Indemnity</span><span className="v">{fmt$(c.indemnity)}</span></div>
        )}
        <div className="r-row"><span className="l">Atty Fee (15%)</span><span className="v">−{fmt$(c.fee)}</span></div>
        <div className="r-row net"><span className="l">Net to Claimant</span><span className="v">{fmt$(c.net)}</span></div>
        {typeof onFeeApp === 'function' && (
          <div className="r-feeapp-row">
            <button type="button" className="btn tiny primary tile-feeapp-btn"
              onClick={() => onFeeApp(tile)}
              title="Generate the OC-400.1 fee application from this Section 32 settlement">
              Generate OC-400.1
            </button>
          </div>
        )}
      </div>
      <SplitFlyout open={!!neg.on} prefix="$" tdLabel="Claimant Demand" imeLabel="Carrier Offer"
        title="Carrier Negotiation" unit="settlement" step={100}
        endpoints={[fmt$(Math.min(Number(neg.offer) || 0, Number(neg.demand) || 0)), fmt$(Math.max(Number(neg.offer) || 0, Number(neg.demand) || 0))]}
        lo={Math.min(Number(neg.offer) || 0, Number(neg.demand) || 0)} hi={Math.max(Number(neg.offer) || 0, Number(neg.demand) || 0)}
        treating={neg.demand} ime={neg.offer} value={inputs.settlement}
        onTreating={negDemand} onIme={negOffer} onValue={negVal} onClose={closeNeg}
        footNote="Midpoint fills the Settlement Amount; edit it here or in the field above (last-write-wins)." />
    </div>
  );
}

// ====================================================================
// Date Calculator Tile — standalone add/subtract + between-dates calc.
// Independent of AWW/DOI (ignores `global`). Mirrors timeanddate.com's
// dateadd.html + duration calculator. All math via the timezone-safe
// helpers in constants.js. See DateCalcTile default inputs in
// TILE_INPUT_DEFAULTS (constants.js) — persisted on tile.inputs.
// ====================================================================
const DATECALC_FMT = (d) =>
  d.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
// "Mon D, YYYY" (no weekday) for inline mid-sentence use.
const DATECALC_FMT_SHORT = (d) =>
  d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

// One interval row: a number input + a quick-preset dropdown, both writing the
// same `key` on inputs. `unit` is the plural label (Years/Months/Weeks/Days).
function DateCalcInterval({ label, unit, value, presets, onChange }) {
  return (
    <div className="f-group">
      <label className="f-label">{label}</label>
      <div style={{ display: 'flex', gap: '6px' }}>
        <input className="f-input" type="number" min="0" step="1" value={value}
          style={{ width: '72px' }}
          onChange={e => onChange(e.target.value)} />
        <select className="f-select" value={presets.includes(Number(value)) ? String(value) : ''}
          onChange={e => onChange(e.target.value)}
          style={{ flex: 1 }} title={`Common ${unit.toLowerCase()} presets`}>
          <option value="">Preset…</option>
          {presets.map(n => <option key={n} value={n}>{n} {unit.toLowerCase()}</option>)}
        </select>
      </div>
    </div>
  );
}

function DateCalcTile({ tile, global, onUpdate }) {
  // `global` (AWW/DOI) intentionally unused — this tile is self-contained.
  const inputs = tile.inputs || (window.TILE_INPUT_DEFAULTS.DateCalc());
  const setInputs = (next) => onUpdate({ ...tile, inputs: { ...inputs, ...next } });

  const mode = inputs.mode || 'add';
  const MODES = [
    { id: 'add',     label: 'Add / Subtract' },
    { id: 'between', label: 'Between Dates' },
  ];

  // ── Mode A: Add / Subtract ────────────────────────────────────────────────
  let addResult = null, addExplain = '';
  {
    const start = fromLocalISO(inputs.start || toLocalISO(new Date()));
    const sign = inputs.direction === 'subtract' ? -1 : 1;
    const parts = { y: inputs.y, m: inputs.m, w: inputs.w, d: inputs.d };
    let out = addYMWD(start, parts, { sign, businessDaysOnly: !!inputs.businessDaysOnly });
    let rolled = false;
    if (inputs.roll && !isBusinessDay(out)) { out = rollToNextBusinessDay(out); rolled = true; }
    addResult = out;
    // Plain-English clause for the intervals actually used.
    const bits = [];
    if (Number(inputs.y)) bits.push(`${Math.abs(Number(inputs.y))} year${Math.abs(Number(inputs.y)) === 1 ? '' : 's'}`);
    if (Number(inputs.m)) bits.push(`${Math.abs(Number(inputs.m))} month${Math.abs(Number(inputs.m)) === 1 ? '' : 's'}`);
    if (Number(inputs.w)) bits.push(`${Math.abs(Number(inputs.w))} week${Math.abs(Number(inputs.w)) === 1 ? '' : 's'}`);
    if (Number(inputs.d)) bits.push(`${Math.abs(Number(inputs.d))} ${inputs.businessDaysOnly ? 'business ' : ''}day${Math.abs(Number(inputs.d)) === 1 ? '' : 's'}`);
    const clause = bits.length ? bits.join(', ') : '0 days';
    addExplain = `${DATECALC_FMT_SHORT(start)} ${sign === -1 ? 'minus' : 'plus'} ${clause} = ${DATECALC_FMT(addResult)}`
      + (rolled ? ' (rolled to next business day)' : '');
  }

  // ── Mode B: Between Dates ─────────────────────────────────────────────────
  let diff = null, betweenExplain = '';
  {
    const s = fromLocalISO(inputs.start || toLocalISO(new Date()));
    const e = fromLocalISO(inputs.end || toLocalISO(new Date()));
    diff = dateDiffBreakdown(s, e, { includeEnd: !!inputs.includeEnd });
    const ymd = [];
    if (diff.years) ymd.push(`${diff.years} yr${diff.years === 1 ? '' : 's'}`);
    if (diff.months) ymd.push(`${diff.months} mo`);
    ymd.push(`${diff.days} day${diff.days === 1 ? '' : 's'}`);
    betweenExplain = `From ${DATECALC_FMT_SHORT(s)} to ${DATECALC_FMT_SHORT(e)} is ${diff.totalDays} day${diff.totalDays === 1 ? '' : 's'}`
      + `${inputs.includeEnd ? ' (end date counted)' : ''} — ${diff.weeks} wk ${diff.remDays} d, or ${ymd.join(' ')}, `
      + `and ${diff.businessDays} business day${diff.businessDays === 1 ? '' : 's'}.`;
  }

  return (
    <div className="tile-body">
      {/* Mode tabs */}
      <div role="tablist" aria-label="Date calculator mode"
        style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
        {MODES.map(mo => (
          <button key={mo.id} type="button" role="tab" aria-selected={mode === mo.id}
            className={'btn tiny ' + (mode === mo.id ? 'primary' : '')}
            style={{ flex: 1 }}
            onClick={() => setInputs({ mode: mo.id })}>
            {mo.label}
          </button>
        ))}
      </div>

      {mode === 'add' ? (
        <>
          <div className="row cols-2">
            <div className="f-group">
              <label className="f-label">Start Date</label>
              <input className="f-input" type="date" value={inputs.start || ''}
                onChange={e => setInputs({ start: e.target.value })} />
            </div>
            <div className="f-group">
              <label className="f-label">Direction</label>
              <select className="f-select" value={inputs.direction || 'add'}
                onChange={e => setInputs({ direction: e.target.value })}>
                <option value="add">Add (+)</option>
                <option value="subtract">Subtract (−)</option>
              </select>
            </div>
          </div>

          <div className="row cols-2">
            <DateCalcInterval label="Years"  unit="Years"  value={inputs.y} presets={DATECALC_PRESETS.y} onChange={v => setInputs({ y: v })} />
            <DateCalcInterval label="Months" unit="Months" value={inputs.m} presets={DATECALC_PRESETS.m} onChange={v => setInputs({ m: v })} />
          </div>
          <div className="row cols-2">
            <DateCalcInterval label="Weeks"  unit="Weeks"  value={inputs.w} presets={DATECALC_PRESETS.w} onChange={v => setInputs({ w: v })} />
            <DateCalcInterval label="Days"   unit="Days"   value={inputs.d} presets={DATECALC_PRESETS.d} onChange={v => setInputs({ d: v })} />
          </div>

          <div className="row cols-2">
            <label className="f-label" style={{ display: 'flex', alignItems: 'center', gap: '6px', textTransform: 'none', letterSpacing: 0 }}>
              <input type="checkbox" checked={!!inputs.businessDaysOnly}
                onChange={e => setInputs({ businessDaysOnly: e.target.checked })} />
              Count days as business days
            </label>
            <label className="f-label" style={{ display: 'flex', alignItems: 'center', gap: '6px', textTransform: 'none', letterSpacing: 0 }}>
              <input type="checkbox" checked={!!inputs.roll}
                onChange={e => setInputs({ roll: e.target.checked })} />
              Roll result to next business day
            </label>
          </div>

          <div className="results">
            <div className="r-row big"><span className="l">Result</span><span className="v">{DATECALC_FMT(addResult)}</span></div>
          </div>
          <p style={{ fontSize: 11, color: 'var(--tx-faint)', margin: '8px 2px 0', lineHeight: 1.4 }}>{addExplain}</p>
        </>
      ) : (
        <>
          <div className="row cols-2">
            <div className="f-group">
              <label className="f-label">Start Date</label>
              <input className="f-input" type="date" value={inputs.start || ''}
                onChange={e => setInputs({ start: e.target.value })} />
            </div>
            <div className="f-group">
              <label className="f-label">End Date</label>
              <input className="f-input" type="date" value={inputs.end || ''}
                onChange={e => setInputs({ end: e.target.value })} />
            </div>
          </div>

          <label className="f-label" style={{ display: 'flex', alignItems: 'center', gap: '6px', textTransform: 'none', letterSpacing: 0 }}>
            <input type="checkbox" checked={!!inputs.includeEnd}
              onChange={e => setInputs({ includeEnd: e.target.checked })} />
            Include end date (count it as a full day)
          </label>

          <div className="results">
            <div className="r-row big"><span className="l">Total Days</span><span className="v">{diff.totalDays}</span></div>
            <div className="r-row"><span className="l">Weeks</span><span className="v">{diff.weeks} wk {diff.remDays} d</span></div>
            <div className="r-row"><span className="l">Y / M / D</span><span className="v">{diff.years} y · {diff.months} m · {diff.days} d</span></div>
            <div className="r-row"><span className="l">Business Days</span><span className="v">{diff.businessDays}</span></div>
          </div>
          <p style={{ fontSize: 11, color: 'var(--tx-faint)', margin: '8px 2px 0', lineHeight: 1.4 }}>{betweenExplain}</p>
        </>
      )}
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
      const inputs = tile.inputs || { rows: [], priorPay: 0, priorTTRWks: 0, phpWks: 0 };
      let sluWeeksTotal = 0;
      const lines = [];
      const plain = [];
      const rowMeta = [];
      // 5/19/26 — $0-omission rule: skip any line that contributes $0 to the
      // OC-400.1 equation prose. Body part lines at 0%, prior payments of $0,
      // $0 credit/moving/fee/net all collapse out so the form-field only shows
      // what actually moved money.
      inputs.rows.forEach(r => {
        const bp = SLU_BP.find(b => b.n === r.bp) || SLU_BP[0];
        const sluWks = (Number(r.pct) / 100) * bp.w;
        sluWeeksTotal += sluWks;
        rowMeta.push({ bp, sluWks });
        if (sluWks > 0) {
          lines.push(`${bp.n}: ${r.pct}% × ${bp.w} = ${fmtN(sluWks, 2)} wks`);
          plain.push(`${bp.n} at ${r.pct}%`);
        }
      });
      // PHP — single tile-level value, credited once against the longest hp
      // among the selected body parts (per WCL §15(4-a) — PHP doesn't stack
      // across parts in a combined SLU).
      const phpInput = Number(inputs.phpWks || 0);
      const maxHp = rowMeta.reduce((m, r) => Math.max(m, r.bp.hp || 0), 0);
      const phpCreditWks = Math.max(0, phpInput - maxHp);
      if (phpCreditWks > 0) {
        lines.push(`PHP: max(0, ${fmtN(phpInput, 2)} − ${maxHp} hp) = ${fmtN(phpCreditWks, 2)} wks`);
      }
      const totalWeeks = sluWeeksTotal + phpCreditWks;
      const grossTotal = totalWeeks * tt;
      const priorTTRWks = Number(inputs.priorTTRWks || 0);
      const creditWks = priorTTRWks > 130 ? priorTTRWks - 130 : 0;
      const creditDollars = creditWks * tt;
      const total = Math.max(0, grossTotal - creditDollars);
      const priorPay = Number(inputs.priorPay || 0);
      const moving = Math.max(0, total - priorPay);
      const fee = moving * 0.15;
      const net = moving - fee;
      if (grossTotal > 0) lines.push(`Gross Value: ${fmtN(totalWeeks, 2)} wks × ${fmt$(tt)} = ${fmt$(grossTotal)}`);
      if (creditWks > 0) {
        lines.push(`§15(3)(w) Credit: (${fmtN(priorTTRWks, 2)} − 130) × ${fmt$(tt)} = −${fmt$(creditDollars)}`);
        lines.push(`Total After Credit: ${fmt$(total)}`);
      }
      if (priorPay > 0) lines.push(`Less prior: (${fmt$(priorPay)})`);
      if (moving > 0) lines.push(`Moving: ${fmt$(moving)}`);
      if (fee > 0)    lines.push(`Fee: ${fmt$(moving)} × 15% = ${fmt$(fee)}`);
      if (net > 0)    lines.push(`Net: ${fmt$(net)}`);
      // Plain prose — assembled from non-zero segments only. SLU at 0% across
      // every body part returns an empty equation (the OC-400.1 field shows
      // nothing rather than a meaningless "$0 gross, $0 moving, $0 net" string).
      const phpNote = phpCreditWks > 0
        ? ` PHP adds ${fmtN(phpCreditWks, 2)} weeks (${fmtN(phpInput, 2)} prior TT weeks − ${maxHp}-week healing period for the longest-hp part).`
        : '';
      const creditNote = creditWks > 0
        ? ` After §15(3)(w) credit of ${fmtN(creditWks, 2)} weeks at the TT rate (${fmt$(creditDollars)} deduction), total = ${fmt$(total)}.`
        : '';
      const proseSegments = [];
      if (plain.length > 0) proseSegments.push(`SLU Award: ${plain.join(', ')}.${phpNote}`);
      if (grossTotal > 0) proseSegments.push(`Total ${fmtN(totalWeeks, 2)} weeks × ${fmt$(tt)}/wk = ${fmt$(grossTotal)} gross.${creditNote}`);
      if (priorPay > 0)   proseSegments.push(`Less prior payments of ${fmt$(priorPay)} = ${fmt$(moving)} moving.`);
      else if (moving > 0 && grossTotal > 0 && moving !== grossTotal) proseSegments.push(`Moving = ${fmt$(moving)}.`);
      if (fee > 0)        proseSegments.push(`Attorney fee 15% of moving = ${fmt$(fee)}.`);
      if (net > 0)        proseSegments.push(`Net to claimant = ${fmt$(net)}.`);
      const plainText = proseSegments.join(' ');
      return { plain: plainText, mono: lines.join('\n'), fee, feeReasons: ['FeeReason3'] };
    }
    case 'LWEC': {
      const inputs = tile.inputs || { pct: 0, feePerWeek: 0, priorTTRWks: 0 };
      const pct = Number(inputs.pct);
      const rawClassRate = tt * (pct / 100);
      const classRate = applyRateBounds(rawClassRate, aww, global.minRate, global.maxRate);
      const wasFloored = classRate !== rawClassRate;
      const bracket = lwecBracket(pct);
      const isLifetime = bracket.mw === 'Lifetime';
      const priorWks = Number(inputs.priorTTRWks || 0);
      const creditWks = priorWks > 130 ? priorWks - 130 : 0;
      const grossWks = isLifetime ? null : bracket.mw;
      const adjustedWks = isLifetime ? null : Math.max(0, grossWks - creditWks);
      const totalAward = isLifetime ? null : classRate * adjustedWks;
      const fee = classRate * 15;
      const totalNet = isLifetime ? null : totalAward - fee;
      const floorReason = isAwwBelowMin(aww, global.minRate)
        ? `AWW ${fmt$(aww)} < statutory min ${fmt$(global.minRate)} → AWW is the floor`
        : (rawClassRate < (global.minRate || 0)
            ? `raw class rate ${fmt$(rawClassRate)} below DOA min ${fmt$(global.minRate)}`
            : (rawClassRate > (global.maxRate || 0)
                ? `raw class rate ${fmt$(rawClassRate)} above DOA max ${fmt$(global.maxRate)}`
                : ''));
      // 5/19/26 — $0-omission rule: drop $0 lines. LWEC at 0% (or with class
      // rate forced to $0 by AWW-below-min collapse) produces no equation.
      const lines = [];
      if (pct > 0 || classRate > 0) {
        lines.push(`LWEC: ${pct}% (${bracket.l})`);
        if (rawClassRate > 0) lines.push(`Raw Class Rate: ${fmt$(tt)} × ${pct}% = ${fmt$(rawClassRate)}/wk`);
        if (wasFloored) lines.push(`Adjusted Class Rate: ${fmt$(classRate)}/wk (${floorReason})`);
        else if (classRate > 0) lines.push(`Class Rate: ${fmt$(classRate)}/wk`);
        lines.push(`Gross Weeks: ${isLifetime ? 'Lifetime' : bracket.mw}`);
        if (!isLifetime && creditWks > 0) {
          lines.push(`§15(3)(w) Credit: ${fmtN(priorWks, 2)} prior wks − 130 = ${fmtN(creditWks, 2)} wks credit`);
          lines.push(`Adjusted Weeks: ${fmtN(grossWks, 2)} − ${fmtN(creditWks, 2)} = ${fmtN(adjustedWks, 2)}`);
        }
        if (isLifetime) lines.push(`Total Award: Lifetime`);
        else if (totalAward > 0) lines.push(`Total Award: ${fmt$(classRate)} × ${fmtN(adjustedWks, 2)} = ${fmt$(totalAward)}`);
        if (fee > 0) lines.push(`Atty Fee: ${fmt$(classRate)} × 15 wks = ${fmt$(fee)}`);
        if (!isLifetime && totalNet > 0) lines.push(`Total Net: ${fmt$(totalNet)}`);
        else if (isLifetime) lines.push(`Total Net: —`);
      }
      const creditNote = (!isLifetime && creditWks > 0)
        ? ` After §15(3)(w) credit (${fmtN(creditWks, 2)} wks at the class rate), adjusted weeks = ${fmtN(adjustedWks, 2)}.`
        : '';
      let plain = '';
      if (pct > 0 || classRate > 0) {
        plain = `LWEC Award: ${pct}% loss of wage earning capacity (${bracket.l}). Classification rate is ${fmt$(tt)} × ${pct}% = ${fmt$(classRate)}/wk over ${isLifetime ? 'lifetime' : bracket.mw + ' gross weeks'}.${creditNote}${isLifetime ? '' : (totalAward > 0 ? ' Total award of ' + fmt$(totalAward) + '.' : '')}${fee > 0 ? ' Attorney fee is the first 15 weeks at the class rate = ' + fmt$(fee) : ''}${isLifetime ? '.' : (totalNet > 0 ? ', leaving ' + fmt$(totalNet) + ' net to claimant.' : '.')}`;
      }
      return { plain, mono: lines.join('\n'), fee, feeReasons: ['FeeReason4'] };
    }
    case 'CCP': {
      const inputs = tile.inputs || { periods: [], ccpAmount: 0, priorPay: 0 };
      let totalAward = 0;
      const lines = [];
      const summary = [];
      const awwOverride = isAwwBelowMin(aww, global.minRate);
      if (awwOverride) {
        lines.push(`** AWW ${fmt$(aww)} < statutory min ${fmt$(global.minRate)} → AWW is the floor for every rate. **`);
      }
      // Mirror the CCPTile.computed math 1:1 so the equation card at the
      // bottom of the workspace, the OC-400.1 fee-app prefill, and the
      // tile's own results panel all agree. 5/19/26 v3 — HIA periods
      // contribute $0; REIMB ER lives in its own employer bucket with
      // its own 15% fee; Unknown / scope=specific honored.
      const ttBase = (Number(aww) || 0) * 2 / 3;
      const ccpRounding = inputs.rounding || 'none';

      // Phase 1 — resolve each period's rate + amount (mirrors CCPTile.computed
      // first pass). We need the resolved rates BEFORE we can compute any
      // scope='specific' reimbursement (which depends on overlapping rates).
      const rows = inputs.periods.map((p, i) => {
        if (p.desg === 'HIA') {
          return { ...p, wks: 0, rate: 0, amount: 0, currentRate: 0, priorRate: 0,
                   rawCurrentRate: 0, isHia: true };
        }
        const wksRaw = periodWeeks(inputs.periods, i);
        const wks = roundWeeksDown(wksRaw, ccpRounding);
        const rateMode = p.rateMode || 'pct';
        let rawCurrentRate = 0;
        if (p.desg === 'TT') rawCurrentRate = tt;
        else if (p.desg === 'RE') rawCurrentRate = Math.max(0, (Number(aww) - Number(p.curEarn || 0)) * 2 / 3);
        else if (p.desg === 'TR') {
          rawCurrentRate = rateMode === 'usd'
            ? Number(p.manualRate || 0)
            : (Number(aww) || 0) * (2 / 3) * (Number(p.ratePct || 0) / 100);
        }
        else if (p.desg === 'TP') {
          // TP % mirrors TR (June 2026 fix) — percentage on the UNCAPPED
          // ⅔ × AWW; applyRateBounds below applies the max cap / min floor.
          rawCurrentRate = rateMode === 'usd'
            ? Number(p.manualRate || 0)
            : (Number(aww) || 0) * (2 / 3) * (Number(p.ratePct || 0) / 100);
        }
        // NCLT / NME are $0-comp designations — flow through as $0 in the
        // equation card and OC-400.1 fee-app prefill.
        else if (p.desg === 'NCLT' || p.desg === 'NME') rawCurrentRate = 0;
        else rawCurrentRate = Number(p.manualRate || 0);
        let currentRate = applyRateBounds(rawCurrentRate, aww, global.minRate, global.maxRate);
        // NCLT / NME OVERRIDE — applyRateBounds floors a $0 rate UP to the
        // statutory min ($325); force back to $0 since these designations are
        // non-compensable by definition.
        if (p.desg === 'NCLT' || p.desg === 'NME') currentRate = 0;
        // RE OVERRIDE (5/20/26) — statutory min floor doesn't apply to RE.
        // Use raw ⅔ × (AWW − curEarn), capped only at max.
        if (p.desg === 'RE') {
          const maxR = Number(global.maxRate) || 0;
          currentRate = maxR > 0 ? Math.min(rawCurrentRate, maxR) : rawCurrentRate;
        }
        let rate = currentRate;
        let priorRate = 0;
        if (p.amending) {
          if (p.priorMode === 'usd') {
            const priorUsd = Math.max(0, Number(p.priorVal || 0));
            const priorPct = ttBase > 0 ? Math.min(100, (priorUsd / ttBase) * 100) : 0;
            priorRate = (priorPct / 100) * ttBase;
          } else {
            const priorPct = Math.max(0, Math.min(100, Number(p.priorVal || 0)));
            priorRate = (priorPct / 100) * ttBase;
          }
          rate = Math.max(0, currentRate - priorRate);
        }
        return { ...p, wks, rate, amount: wks * rate, currentRate, priorRate, rawCurrentRate, isHia: false };
      });

      // Phase 2a — emit per-period award lines, accumulate totalAward.
      // 5/19/26 $0-omission: HIA, NCLT, NME, and any period with $0 award
      // amount (e.g. 0 weeks, 0 rate) are dropped from the OC-400.1 equation
      // prose entirely. They still render in the tile UI for documentation;
      // they just don't clutter the fee-app written explanation.
      rows.forEach((r, i) => {
        if (r.isHia) {
          // HIA documented in tile UI; $0 → skip from equation per omission rule.
          return;
        }
        totalAward += r.amount;
        if (r.amount <= 0) return; // NCLT, NME, 0-week periods — drop
        const adjusted = Math.abs(r.currentRate - r.rawCurrentRate) > 0.005;
        const amendSuffix = r.amending ? ` (amending: ${fmt$(r.currentRate)} − ${fmt$(r.priorRate)} = ${fmt$(r.rate)}/wk)` : '';
        const adjustedSuffix = adjusted && !r.amending ? ` (raw ${fmt$(r.rawCurrentRate)}, bounded by min/max for DOA)` : '';
        const paidSuffix = r.alreadyPaid ? ' — already paid (excluded from money moving)' : '';
        lines.push(`P${i+1} ${r.desg}: ${fmtN(r.wks, 2)} wks × ${fmt$(r.rate)}${adjustedSuffix}${amendSuffix} = ${fmt$(r.amount)}${paidSuffix}`);
        const summaryAmend = r.amending ? `, amending — ${fmt$(r.currentRate)} − ${fmt$(r.priorRate)} = ${fmt$(r.rate)}/wk` : '';
        summary.push(`Period ${i+1} (${r.desg}, ${fmtN(r.wks,2)} wks at ${fmt$(r.rate)}/wk${adjusted && !r.amending ? ` — adjusted from raw ${fmt$(r.rawCurrentRate)}` : ''}${summaryAmend} = ${fmt$(r.amount)})`);
      });

      // Phase 2b — REIMB ER bucketing with the same claim → cap → actual model
      // CCPTile.computed uses. Per-period remainingForReimb starts at award and
      // is reduced proportionally as REIMB ER claims allocate against it (in
      // carrier order). Actual = min(claim, available_cap).
      let reimbErKnown = 0;
      let reimbErHasUnknown = false;
      rows.forEach(r => { r.remainingForReimb = r.isHia ? 0 : (Number(r.amount) || 0); });
      const resolveContribsEq = (carrier) => {
        const scope = carrier.reimbErScope || 'period';
        const out = [];
        if (scope === 'period') {
          if (!carrier.isHia) out.push({ p: carrier, cap: Math.min(carrier.amount || 0, carrier.remainingForReimb) });
        } else if (scope === 'all') {
          rows.forEach(p => {
            if (p.isHia) return;
            out.push({ p, cap: Math.min(p.amount || 0, p.remainingForReimb) });
          });
        } else if (scope === 'specific') {
          if (!carrier.reimbErRangeStart || !carrier.reimbErRangeEnd) return out;
          const rS = new Date(carrier.reimbErRangeStart);
          const rE = new Date(carrier.reimbErRangeEnd);
          if (isNaN(rS.getTime()) || isNaN(rE.getTime()) || rE < rS) return out;
          rows.forEach(p => {
            if (p.isHia) return;
            if (!p.start || !p.end) return;
            const pS = new Date(p.start);
            const pE = new Date(p.end);
            if (isNaN(pS.getTime()) || isNaN(pE.getTime())) return;
            if (pE < rS || pS > rE) return;
            const oS = pS > rS ? pS : rS;
            const oE = pE < rE ? pE : rE;
            const days = (oE - oS) / (1000 * 60 * 60 * 24) + 1;
            const wks = roundWeeksDown(days / 7, ccpRounding);
            const overlapAmt = wks * (Number(p.rate) || 0);
            out.push({ p, cap: Math.min(overlapAmt, p.remainingForReimb) });
          });
        }
        return out;
      };

      rows.forEach((r, i) => {
        if (!r.reimbErOn) return;
        const scope = r.reimbErScope || 'period';

        if (r.reimbErUnknown) {
          reimbErHasUnknown = true;
          if (scope === 'specific') {
            const overlapN = countSpecificOverlaps(rows, r.reimbErRangeStart, r.reimbErRangeEnd);
            lines.push(`  REIMB ER applies for ${overlapN} period${overlapN === 1 ? '' : 's'}, amount TBD`);
          } else {
            const lbl = scope === 'all' ? 'case-wide' : `P${i+1}`;
            lines.push(`  REIMB ER (${lbl}): amount of Reimbursement TBD`);
          }
          return;
        }

        const contribs = resolveContribsEq(r);
        const claim = Number(r.reimbErAmount) || 0;
        const cap = contribs.reduce((s, c) => s + Math.max(0, c.cap), 0);
        const actual = Math.min(claim, cap);
        const capped = claim > cap + 0.005;
        // Deduct from remaining (proportionally) so subsequent claims see the
        // reduced pool, just like CCPTile.computed.
        if (cap > 0 && actual > 0) {
          contribs.forEach(c => {
            if (c.cap <= 0) return;
            const share = (c.cap / cap) * actual;
            c.p.remainingForReimb = Math.max(0, c.p.remainingForReimb - share);
          });
        }
        if (actual > 0) reimbErKnown += actual;

        // Equation line — terse, but if capped we annotate with the claim too.
        const cappedNote = capped ? ` (claim ${fmt$(claim)} capped at available)` : '';
        if (scope === 'specific') {
          const overlapN = contribs.length;
          lines.push(`  REIMB ER applies for ${overlapN} period${overlapN === 1 ? '' : 's'}, total ${fmt$(actual)}${cappedNote}`);
        } else {
          const lbl = scope === 'all' ? 'case-wide' : `P${i+1}`;
          lines.push(`  REIMB ER (${lbl}): ${fmt$(actual)} → employer bucket${cappedNote}`);
        }
      });

      // Already-Paid periods — mirror CCPTile.computed. Periods flagged
      // alreadyPaid stay in totalAward (formal award lists them) but their
      // dollars leave money moving, the fee, and this fee-app prefill.
      const alreadyPaidSum = rows.reduce(
        (s, r) => s + ((!r.isHia && r.alreadyPaid) ? (Number(r.amount) || 0) : 0), 0);
      // Buckets — claimant + employer + CCP
      const claimantMoving = Math.max(0, totalAward - Number(inputs.priorPay || 0) - reimbErKnown - alreadyPaidSum);
      const feeOnClaimant = claimantMoving * 0.15;
      const employerMoving = reimbErKnown;
      const feeOnEmployer = employerMoving * 0.15;
      const feeOnCCP = Number(inputs.ccpAmount || 0) / 3;
      const totalFee = feeOnClaimant + feeOnEmployer + feeOnCCP;
      const netToClaimant = claimantMoving - feeOnClaimant - feeOnCCP;
      const netToEmployer = employerMoving - feeOnEmployer;

      // 5/19/26 — $0-omission rule across the totals section. Anything
      // calculated to $0 (Less Prior, Moving to Claimant, Fee from Claimant,
      // Fee on CCP, Net to Claimant, Net to Employer, employer bucket lines)
      // is dropped from the OC-400.1 equation entirely.
      const priorPayAmt = Number(inputs.priorPay || 0);
      const ccpAmt     = Number(inputs.ccpAmount || 0);
      if (totalAward > 0) lines.push(`Total Award: ${fmt$(totalAward)}`);
      if (priorPayAmt > 0) lines.push(`Less Prior: (${fmt$(priorPayAmt)})`);
      if (alreadyPaidSum > 0) lines.push(`Less Already-Paid Periods: (${fmt$(alreadyPaidSum)})`);
      if (reimbErKnown > 0) lines.push(`Less Reimb to ER (to employer bucket): (${fmt$(reimbErKnown)})`);
      if (reimbErHasUnknown) lines.push(`Reimb to ER: TBD`);
      if (claimantMoving > 0) lines.push(`Moving to Claimant: ${fmt$(claimantMoving)}`);
      if (feeOnClaimant > 0) lines.push(`Fee from Claimant: ${fmt$(claimantMoving)} × 15% = ${fmt$(feeOnClaimant)}`);
      if (ccpAmt > 0 && feeOnCCP > 0) {
        lines.push(`Fee on CCP: ${fmt$(ccpAmt)} ÷ 3 = ${fmt$(feeOnCCP)}`);
      }
      if (employerMoving > 0) {
        lines.push(`Moving to Employer (reimb): ${fmt$(employerMoving)}`);
        if (feeOnEmployer > 0) lines.push(`Fee from Employer Reimb: ${fmt$(employerMoving)} × 15% = ${fmt$(feeOnEmployer)}`);
      }
      if (totalFee > 0) lines.push(`Total Fee: ${fmt$(totalFee)}`);
      if (netToClaimant > 0) lines.push(`Net to Claimant: ${fmt$(netToClaimant)}`);
      if (employerMoving > 0 && netToEmployer > 0) lines.push(`Net to Employer: ${fmt$(netToEmployer)}`);

      // Plain prose — keep brief. Unknown amount becomes a short tag, no
      // 5/19/26 — $0-omission rule extended to plain prose. Assemble segments
      // conditionally; if every segment is empty the prose is empty too.
      const proseParts = [];
      if (summary.length > 0) proseParts.push(`CCP / Award: ${summary.join('; ')}.`);
      if (totalAward > 0) {
        if (priorPayAmt > 0 || alreadyPaidSum > 0) {
          const ded = [];
          if (priorPayAmt > 0) ded.push(`prior payments ${fmt$(priorPayAmt)}`);
          if (alreadyPaidSum > 0) ded.push(`already-paid periods ${fmt$(alreadyPaidSum)}`);
          proseParts.push(`Total award ${fmt$(totalAward)}, less ${ded.join(' and ')} = ${fmt$(claimantMoving)} moving to claimant.`);
        } else {
          proseParts.push(`Total award ${fmt$(totalAward)} moving to claimant.`);
        }
      }
      if (feeOnClaimant > 0 || (ccpAmt > 0 && feeOnCCP > 0)) {
        const ccpPart = (ccpAmt > 0 && feeOnCCP > 0) ? ` plus one-third of CCP (${fmt$(feeOnCCP)})` : '';
        proseParts.push(`Fee from claimant is 15% of claimant moving (${fmt$(feeOnClaimant)})${ccpPart}.`);
      }
      if (reimbErKnown > 0) {
        proseParts.push(`Reimbursement to employer of ${fmt$(reimbErKnown)} moves to a separate employer bucket; fee at 15% = ${fmt$(feeOnEmployer)}.`);
      }
      if (reimbErHasUnknown) proseParts.push('Amount of Reimbursement TBD.');
      if (totalFee > 0) proseParts.push(`Total attorney fee = ${fmt$(totalFee)}.`);
      if (netToClaimant > 0) {
        proseParts.push(`Net to claimant = ${fmt$(netToClaimant)}${(employerMoving > 0 && netToEmployer > 0) ? `; net to employer = ${fmt$(netToEmployer)}` : ''}.`);
      }
      const plain = proseParts.join(' ');
      // Per OC-400.1 § A fee-reason checkboxes:
      //   FeeReason1 = "continuation of weekly compensation benefits"
      //   FeeReason2 = "increase in the amount of compensation awarded
      //                 or paid for a prior period"
      //
      // 5/19/26 v3 rule: FeeReason1 (continuation box) is checked ONLY
      // when CCP Amount > 0. Future-dated/ongoing award periods and
      // REIMB ER alone never trigger the continuation box.
      //
      // 5/26/26 v4 rule (Joel): when CCP Amount > 0 AND there is at least
      // one period producing a real award (totalAward > 0), BOTH boxes
      // fire — even if the only period is current/future-dated. Rationale:
      // any time the attorney is securing a CCP plus moving award money,
      // it's both a continuation (FeeReason1) and an increase (FeeReason2)
      // in the compensation paid. The legacy past-dated-period check is
      // preserved so CCP=$0 amending-award fee apps still fire FeeReason2.
      //
      // 5/26/26 v4.1 (caught by feeapp-field-map-regression smoke test):
      // the past-period check now requires the past period to have
      // actually produced an award (r.amount > 0). The v3-stated intent
      // was always "past-dated period WITH AN AWARD," but the original
      // code never enforced the amount check — so HIA-only / NCLT-only /
      // NME-only past periods (which compute to $0) were silently firing
      // FeeReason2. Fixed.
      const ccpToday = new Date(); ccpToday.setHours(0, 0, 0, 0);
      const ccpHasAmount = Number(inputs.ccpAmount || 0) > 0;
      const ccpHasAward = totalAward > 0;
      let ccpHasPastAwardPeriod = false;
      rows.forEach(r => {
        if (!r.end) return;
        if (!(Number(r.amount) > 0)) return;
        const endDate = new Date(r.end);
        if (isNaN(endDate.getTime())) return;
        if (endDate < ccpToday) ccpHasPastAwardPeriod = true;
      });
      const ccpFeeReasons = [];
      if (ccpHasAmount) ccpFeeReasons.push('FeeReason1');
      if ((ccpHasAmount && ccpHasAward) || ccpHasPastAwardPeriod) {
        ccpFeeReasons.push('FeeReason2');
      }
      return { plain, mono: lines.join('\n'), fee: totalFee, feeReasons: ccpFeeReasons };
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
      return { plain, mono: lines.join('\n'), fee: 0, feeReasons: [] };
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
      return { plain, mono: lines.join('\n'), fee: 0, feeReasons: [] };
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
      return { plain, mono: lines.join('\n'), fee: 0, feeReasons: [] };
    }
    case 'Settlement': {
      const inputs = tile.inputs || {};
      const settlement = Number(inputs.settlement) || 0;
      const msaType =
        inputs.msaType ||
        (inputs.msaOn ? 'msa' : 'none');
      const hasMSA = msaType === 'msa' || msaType === 'medicare';
      const msaMode = inputs.msaMode || 'usd';
      const msaPct = Number(inputs.msaPct) || 0;
      const msa = !hasMSA ? 0
        : msaMode === 'pct' ? (settlement * msaPct / 100)
        : (Number(inputs.msa) || 0);
      const indemnity = Math.max(0, settlement - msa);
      const fee = indemnity * 0.15;
      const net = Math.max(0, indemnity - fee);

      // 5/19/26 — $0-omission. A $0 settlement (no value entered) produces
      // no equation at all. Otherwise drop any $0 lines from the mono/prose.
      const lines = [];
      if (settlement > 0) {
        lines.push(`Settlement: ${fmt$(settlement)}`);
        if (msaType === 'medicare') {
          if (msa > 0) lines.push(`Less Medicare MSA:  −${fmt$(msa)}`);
          if (indemnity > 0) lines.push(`Indemnity:  ${fmt$(indemnity)}`);
          if (fee > 0) lines.push(`Atty Fee:   ${fmt$(indemnity)} × 15% = ${fmt$(fee)}`);
        } else if (msaType === 'msa') {
          if (msa > 0) lines.push(`Less MSA:   −${fmt$(msa)}`);
          if (fee > 0) lines.push(`Atty Fee:   ${fmt$(indemnity)} × 15% = ${fmt$(fee)}`);
        } else {
          if (fee > 0) lines.push(`Atty Fee:   ${fmt$(settlement)} × 15% = ${fmt$(fee)}`);
        }
        if (net > 0) lines.push(`Net:        ${fmt$(net)}`);
      }

      let plain = '';
      if (settlement > 0) {
        const feeClause = fee > 0 ? ` Attorney fee of 15% ${msaType !== 'none' ? `on the ${msaType === 'medicare' ? 'indemnity' : `${fmt$(indemnity)} remainder`} ` : ''}= ${fmt$(fee)}.` : '';
        const netClause = net > 0 ? ` Net to claimant = ${fmt$(net)}.` : '';
        if (msaType === 'medicare') {
          plain = `Section 32 Settlement of ${fmt$(settlement)} with a Medicare Set-Aside (WCMSA) of ${fmt$(msa)} funded separately.${indemnity > 0 ? ` Indemnity portion to the claimant = ${fmt$(indemnity)}.` : ''}${feeClause}${netClause}`;
        } else if (msaType === 'msa') {
          plain = `Section 32 Settlement of ${fmt$(settlement)} with a non-Medicare Medical Set-Aside of ${fmt$(msa)} carved out.${feeClause}${netClause}`;
        } else {
          plain = `Section 32 Settlement of ${fmt$(settlement)}.${feeClause}${netClause}`;
        }
      }
      return { plain, mono: lines.join('\n'), fee, feeReasons: ['FeeReason6'] };
    }
    default:
      return { plain: '', mono: '', fee: 0, feeReasons: [] };
  }
}

// ====================================================================
// BETA banner — shown on Fee Calculator 6.1 tiles under review.
// ====================================================================
function BetaBanner({ note }) {
  return (
    <div style={{display:'flex', alignItems:'center', gap:8, padding:'6px 10px', margin:'0 0 8px',
      background:'rgba(255,207,92,0.12)', border:'1px solid rgba(255,207,92,0.45)', borderRadius:8,
      fontSize:11, color:'var(--tx-dim)'}}>
      <span style={{display:'inline-block', padding:'1px 7px', borderRadius:10, fontSize:10,
        fontWeight:700, letterSpacing:0.5, textTransform:'uppercase', color:'#1b1b1f',
        background:'var(--ac-2, #ffcf5c)'}}>Beta</span>
      <span>{note || 'New calculator under review — please verify results before relying on them, and send feedback.'}</span>
    </div>
  );
}

// ====================================================================
// Schedule ROM → SLU Tile (BETA) — enter a doctor's range-of-motion
// findings and read the true %SLU straight off the NY 2018 Impairment
// Guidelines (band interpolation + combining rules + caps + special
// considerations, all in window.romToSLU). Also shows the resulting
// statutory SLU award using the inherited TT rate.
// ====================================================================
const ROM_SITE_LIST = [
  'R Shoulder','L Shoulder','R Elbow','L Elbow','R Wrist','L Wrist','R Thumb','L Thumb',
  'R 1st Finger (Index)','L 1st Finger (Index)','R 2nd Finger (Middle)','L 2nd Finger (Middle)',
  'R 3rd Finger (Ring)','L 3rd Finger (Ring)','R 4th Finger (Pinky)','L 4th Finger (Pinky)',
  'R Hip','L Hip','R Knee','L Knee','R Ankle/Foot','L Ankle/Foot',
  'R Great Toe','L Great Toe','R 2nd Toe','L 2nd Toe','R 3rd Toe','L 3rd Toe',
  'R 4th Toe','L 4th Toe','R 5th Toe','L 5th Toe',
];
function romSluMember(site) {
  if (/Shoulder|Elbow/.test(site)) return { member: 'Arm', wks: 312 };
  if (/Wrist/.test(site))          return { member: 'Hand', wks: 244 };
  if (/Thumb/.test(site))          return { member: 'Thumb', wks: 75 };
  if (/1st Finger/.test(site))     return { member: 'Index finger', wks: 46 };
  if (/2nd Finger/.test(site))     return { member: 'Middle finger', wks: 30 };
  if (/3rd Finger/.test(site))     return { member: 'Ring finger', wks: 25 };
  if (/4th Finger/.test(site))     return { member: 'Little finger', wks: 15 };
  if (/Hip|Knee/.test(site))       return { member: 'Leg', wks: 288 };
  if (/Ankle|Foot/.test(site))     return { member: 'Foot', wks: 205 };
  if (/Great Toe/.test(site))      return { member: 'Great toe', wks: 38 };
  if (/Toe/.test(site))            return { member: 'Other toe', wks: 16 };
  return { member: '—', wks: 0 };
}
function sluRomRow(id) { return { id: id || Date.now(), site: 'R Shoulder', roms: {}, special: 'None', pct: 0, td: '', ime: '', romOpen: true }; }
function SLURomTile({ tile, global, onUpdate }) {
  const tt = global.ttRate;
  // Accept the new multi-row shape; migrate an old single-site save into row 1.
  const raw = tile.inputs || {};
  const inputs = raw.rows ? raw : { ...raw, rows: [{ ...sluRomRow(1), site: raw.site || 'R Shoulder', roms: raw.roms || {}, special: raw.special || 'None' }] };
  const rows = inputs.rows;
  const setInputs = (next) => onUpdate({ ...tile, inputs: { ...inputs, ...next } });
  const updateRow = (id, patch) => setInputs({ rows: rows.map(r => r.id === id ? { ...r, ...patch } : r) });
  const addRow = () => setInputs({ rows: [...rows, sluRomRow(Date.now())] });
  const removeRow = (id) => setInputs({ rows: rows.filter(r => r.id !== id) });
  const setRom = (id, joint, val, site, special) => {
    const row = rows.find(x => x.id === id);
    const newRoms = { ...(row.roms || {}), [joint]: val };
    updateRow(id, { roms: newRoms, pct: window.romToSLU(site, newRoms, special).hi || 0 });
  };
  const baseW = tileBaseW(tile);

  const computedRows = rows.map(r => {
    const res = window.romToSLU(r.site, r.roms || {}, r.special);
    const mem = romSluMember(r.site);
    const pct = Number(r.pct) || 0;
    const wks = (pct / 100) * mem.wks;
    return { r, res, mem, pct, wks, gross: wks * tt };
  });
  const totalGross = computedRows.reduce((s, c) => s + c.gross, 0);

  // Per-row Split Opinions — midpoint of TD vs IME %SLU fills that row's applied %.
  const splitRow = rows.find(r => r.id === inputs._splitId) || null;
  const openSplit = (id) => setInputs({ _splitId: id, _expandW: SPLIT_PANEL_W });
  const closeSplit = () => setInputs({ _splitId: null, _expandW: 0 });
  const splitTD  = (v) => updateRow(inputs._splitId, { td: v,  pct: (((Number(v) || 0) + (Number(splitRow && splitRow.ime) || 0)) / 2) });
  const splitIME = (v) => updateRow(inputs._splitId, { ime: v, pct: (((Number(splitRow && splitRow.td) || 0) + (Number(v) || 0)) / 2) });
  const splitVal = (v) => updateRow(inputs._splitId, { pct: v });

  return (
    <>
      <Inherited {...global} />
      <div className="tile-body" style={{ position: 'relative', width: baseW, boxSizing: 'border-box' }}>
        <BetaBanner note="ROM → SLU (beta). Multi-body-part; ROM findings auto-compute each %SLU (2018 Guidelines). Verify before filing." />
        <div style={{ display: 'grid', gap: 10 }}>
          {computedRows.map(({ r, res, mem, wks, gross }) => {
            const specials = (window.SLU_ROM_SPECIAL || []).filter(s => s.bodyPart === res.key);
            return (
              <div key={r.id} style={{ border: '1px solid var(--bd-soft)', borderRadius: 8, padding: '8px 10px' }}>
                <div className="row cols-2">
                  <div className="f-group"><label className="f-label">Injury Site</label>
                    <select className="f-select" value={r.site}
                      onChange={e => updateRow(r.id, { site: e.target.value, roms: {}, special: 'None', pct: 0 })}>
                      {ROM_SITE_LIST.map(s => <option key={s} value={s}>{s}</option>)}
                    </select></div>
                  <div className="f-group"><label className="f-label">Special Consideration</label>
                    <select className="f-select" value={r.special || 'None'}
                      onChange={e => updateRow(r.id, { special: e.target.value, pct: window.romToSLU(r.site, r.roms || {}, e.target.value).hi || 0 })}>
                      <option value="None">None</option>
                      {specials.filter(s => s.consideration !== 'None').map(s => <option key={s.consideration} value={s.consideration}>{s.consideration}</option>)}
                    </select></div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0' }}>
                  <button type="button" className="btn tiny" onClick={() => updateRow(r.id, { romOpen: !r.romOpen })}>
                    {r.romOpen ? '▾ ROM findings' : '▸ ROM findings'}
                  </button>
                  <span style={{ fontSize: 12, color: 'var(--tx-dim)' }}>from ROM: <strong style={{ color: 'var(--ac-2)' }}>{res.display || '0%'}</strong></span>
                </div>
                {r.romOpen && (
                  <div style={{ display: 'grid', gap: 5, marginTop: 2 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 0.6fr 0.9fr 0.6fr', gap: 6, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 0.3, color: 'var(--tx-faint)' }}>
                      <span>Motion</span><span>Normal</span><span>ROM°</span><span>%SLU</span>
                    </div>
                    {res.joints.map(j => (
                      <div key={j.joint} style={{ display: 'grid', gridTemplateColumns: '1.3fr 0.6fr 0.9fr 0.6fr', gap: 6, alignItems: 'center' }}>
                        <span style={{ fontSize: 11.5 }}>{j.joint}</span>
                        <span style={{ fontSize: 11.5, color: 'var(--tx-faint)' }}>{j.normal}°</span>
                        <input className="f-input" type="number" min="0" step="1"
                          value={(r.roms && r.roms[j.joint] !== undefined) ? r.roms[j.joint] : ''} placeholder={j.normal + '°'}
                          onChange={e => setRom(r.id, j.joint, e.target.value, r.site, r.special)} />
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: j.pct ? 'var(--ac-2)' : 'var(--tx-faint)' }}>{j.pct || '—'}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'end', gap: 8, marginTop: 6 }}>
                  <div className="f-group" style={{ maxWidth: 110 }}><label className="f-label">Applied % SLU</label>
                    <input className="f-input" type="number" min="0" max="100" value={r.pct} onChange={e => updateRow(r.id, { pct: e.target.value })} /></div>
                  <span style={{ fontSize: 11.5, color: 'var(--tx-dim)', flex: 1 }}>{mem.member} ({mem.wks} wks) → {fmtN(wks, 1)} wks · <strong>{fmt$(gross)}</strong></span>
                  <button type="button" className={'btn tiny' + (inputs._splitId === r.id ? ' primary' : '')} onClick={() => inputs._splitId === r.id ? closeSplit() : openSplit(r.id)} title="Split treating vs IME %SLU" style={{ padding: '2px 7px' }}>⚖</button>
                  <button className="delete-row" onClick={() => removeRow(r.id)} title="Remove">×</button>
                </div>
              </div>
            );
          })}
        </div>
        <button className="btn tiny" onClick={addRow}>+ Add Body Part</button>
        <div className="results">
          <div className="r-row big"><span className="l">Total SLU Award</span><span className="v">{fmt$(totalGross)}</span></div>
          <div className="r-row"><span className="l">@ {fmt$(tt)}/wk</span><span className="v" style={{ fontSize: 10 }}>{computedRows.length} body part{computedRows.length === 1 ? '' : 's'} · run the SLU tile for §15(3)(w) credit</span></div>
        </div>
        <SplitFlyout open={!!inputs._splitId}
          title="Split Opinions · % SLU" unit="% SLU" endpoints={['0% (none)', '100% (total)']} lo={0} hi={100}
          treating={splitRow ? (splitRow.td ?? '') : ''} ime={splitRow ? (splitRow.ime ?? '') : ''} value={splitRow ? splitRow.pct : ''}
          onTreating={splitTD} onIme={splitIME} onValue={splitVal} onClose={closeSplit}
          footNote="Midpoint fills this body part's applied %SLU. Entering ROM or typing the field re-sets it (last-write-wins)." />
      </div>
    </>
  );
}

// ====================================================================
// Non-Schedule Impairment Tile (BETA) — Spine (Tables 11.1/11.2 +
// S11.4-S11.7), Brain (15.1), Psych (17.3). Outputs Class + Severity.
// Spine reconciled to the app's Radiculopathy scorer (window.nonSchedSpine).
// ====================================================================
const NONSCHED_ORD = ['None', 'Minimal', 'Mild', 'Moderate', 'Severe'];
const BRAIN_DOMAINS = ['Cognition', 'Language', 'Emotion/Behavior', 'Sleep/Alertness', 'Episodic Neuro'];
const PSYCH_DOMAINS = ['ADL Impact', 'Work Function', 'Social Function', 'Concentration', 'Decompensation'];
function NSDomainSelect({ label, value, onChange }) {
  return (
    <div className="f-group">
      <label className="f-label">{label}</label>
      <select className="f-select" value={value || 'None'} onChange={e => onChange(e.target.value)}>
        {NONSCHED_ORD.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}
function NonScheduleTile({ tile, global, onUpdate }) {
  const inputs = tile.inputs || {
    mode: 'spine',
    region: 'lumbar', nerveRoot: 'None', symptoms: true, imaging: false, emg: false,
    weakness: 5, atrophy: false, sensory: 'Normal', reflex: 'Normal', tension: false,
    brain: {}, psych: {},
  };
  const setInputs = (next) => onUpdate({ ...tile, inputs: { ...inputs, ...next } });
  const mode = inputs.mode || 'spine';
  const MODES = [{ id: 'spine', label: 'Spine' }, { id: 'brain', label: 'Brain' }, { id: 'psych', label: 'Psych' }];

  const roots = inputs.region === 'lumbar' ? NERVE_CAPS.lumbar : (inputs.region === 'cervical' ? NERVE_CAPS.cervical : []);
  const spine = useMemo(() => window.nonSchedSpine({
    region: inputs.region, nerveRoot: inputs.nerveRoot, symptoms: inputs.symptoms,
    imaging: inputs.imaging, emg: inputs.emg, weakness: Number(inputs.weakness),
    atrophy: inputs.atrophy, sensory: inputs.sensory, reflex: inputs.reflex, tension: inputs.tension,
  }), [inputs]);
  const brain = useMemo(() => window.nonSchedDomains(BRAIN_DOMAINS.map(d => (inputs.brain || {})[d] || 'None')), [inputs.brain]);
  const psych = useMemo(() => window.nonSchedDomains(PSYCH_DOMAINS.map(d => (inputs.psych || {})[d] || 'None')), [inputs.psych]);

  return (
    <div className="tile-body">
      <BetaBanner note="Non-Schedule impairment (beta). Spine reconciled to the Radiculopathy scorer; Brain/Psych per Tables 15.1/17.3 — verify before filing." />
      <div role="tablist" style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {MODES.map(m => (
          <button key={m.id} type="button" role="tab" aria-selected={mode === m.id}
            className={'btn tiny ' + (mode === m.id ? 'primary' : '')} style={{ flex: 1 }}
            onClick={() => setInputs({ mode: m.id })}>{m.label}</button>
        ))}
      </div>

      {mode === 'spine' && (
        <>
          <div className="row cols-2">
            <div className="f-group">
              <label className="f-label">Region</label>
              <select className="f-select" value={inputs.region} onChange={e => {
                const region = e.target.value;
                const list = region === 'lumbar' ? NERVE_CAPS.lumbar : (region === 'cervical' ? NERVE_CAPS.cervical : []);
                setInputs({ region, nerveRoot: 'None' });
              }}>
                <option value="cervical">Cervical</option>
                <option value="thoracic">Thoracic</option>
                <option value="lumbar">Lumbar</option>
              </select>
            </div>
            <div className="f-group">
              <label className="f-label">Nerve Root (optional)</label>
              <select className="f-select" value={inputs.nerveRoot} onChange={e => setInputs({ nerveRoot: e.target.value })}>
                <option value="None">None</option>
                {roots.map(n => <option key={n.v} value={n.v}>{n.label || n.v}</option>)}
              </select>
            </div>
          </div>
          <div className="row cols-2">
            <div className="f-group">
              <label className="f-label">Symptoms Present?</label>
              <select className="f-select" value={inputs.symptoms ? 'yes' : 'no'} onChange={e => setInputs({ symptoms: e.target.value === 'yes' })}>
                <option value="yes">Yes</option><option value="no">No</option>
              </select>
            </div>
            <div className="f-group">
              <label className="f-label">Muscle Weakness</label>
              <select className="f-select" value={inputs.weakness} onChange={e => setInputs({ weakness: Number(e.target.value) })}>
                {MUSCLE_WEAKNESS.map(m => <option key={m.v} value={m.v}>{m.label}</option>)}
              </select>
            </div>
          </div>
          <div className="row cols-2">
            <div className="f-group">
              <label className="f-label">Imaging</label>
              <select className="f-select" value={inputs.imaging ? 'y' : 'n'} onChange={e => setInputs({ imaging: e.target.value === 'y' })}>
                <option value="n">Negative (0)</option><option value="y">Positive (16)</option>
              </select>
            </div>
            <div className="f-group">
              <label className="f-label">EMG</label>
              <select className="f-select" value={inputs.emg ? 'y' : 'n'} onChange={e => setInputs({ emg: e.target.value === 'y' })}>
                <option value="n">Negative (0)</option><option value="y">Positive (6)</option>
              </select>
            </div>
          </div>
          <div className="row cols-2">
            <div className="f-group">
              <label className="f-label">Sensory</label>
              <select className="f-select" value={inputs.sensory} onChange={e => setInputs({ sensory: e.target.value })}>
                <option value="Normal">Normal (0)</option><option value="Compromised">Compromised (4)</option><option value="Anesthesia">Anesthesia (6)</option>
              </select>
            </div>
            <div className="f-group">
              <label className="f-label">Reflexes</label>
              <select className="f-select" value={inputs.reflex} onChange={e => setInputs({ reflex: e.target.value })}>
                <option value="Normal">Normal (0)</option><option value="Diminished">Diminished (4)</option><option value="Absent">Absent (6)</option>
              </select>
            </div>
          </div>
          <div className="row cols-2">
            <div className="f-group">
              <label className="f-label">Muscle Atrophy</label>
              <select className="f-select" value={inputs.atrophy ? 'y' : 'n'} onChange={e => setInputs({ atrophy: e.target.value === 'y' })}>
                <option value="n">Absent (0)</option><option value="y">Present (6)</option>
              </select>
            </div>
            <div className="f-group">
              <label className="f-label">Tension Signs</label>
              <select className="f-select" value={inputs.tension ? 'y' : 'n'} onChange={e => setInputs({ tension: e.target.value === 'y' })}>
                <option value="n">Negative (0)</option><option value="y">Positive (4)</option>
              </select>
            </div>
          </div>
          <div className="results">
            <div className="r-row"><span className="l">Total Points</span><span className="v">{spine.total}</span></div>
            {spine.capMotor !== null && (
              <div className="r-row"><span className="l">Nerve-root cap</span>
                <span className="v" style={{fontSize:10}}>motor ≤ {spine.capMotor} · sensory ≤ {spine.capSensory}</span></div>
            )}
            <div className="r-row big"><span className="l">Class</span><span className="v">{spine.class}</span></div>
            <div className="r-row net"><span className="l">Severity Ranking</span><span className="v">{spine.severity}</span></div>
          </div>
        </>
      )}

      {mode === 'brain' && (
        <>
          <div className="row cols-2">
            {BRAIN_DOMAINS.map(d => (
              <NSDomainSelect key={d} label={d} value={(inputs.brain || {})[d]}
                onChange={v => setInputs({ brain: { ...(inputs.brain || {}), [d]: v } })} />
            ))}
          </div>
          <div className="results">
            <div className="r-row big"><span className="l">Class (Table 15.1)</span><span className="v">{brain.class}</span></div>
            <div className="r-row net"><span className="l">Severity Ranking</span><span className="v">{brain.severity}</span></div>
          </div>
        </>
      )}

      {mode === 'psych' && (
        <>
          <div className="row cols-2">
            {PSYCH_DOMAINS.map(d => (
              <NSDomainSelect key={d} label={d} value={(inputs.psych || {})[d]}
                onChange={v => setInputs({ psych: { ...(inputs.psych || {}), [d]: v } })} />
            ))}
          </div>
          <div className="results">
            <div className="r-row big"><span className="l">Class (Table 17.3)</span><span className="v">{psych.class}</span></div>
            <div className="r-row net"><span className="l">Severity Ranking</span><span className="v">{psych.severity}</span></div>
          </div>
        </>
      )}
    </div>
  );
}

// ====================================================================
// MTG Browser Tile (rebuilt) — body part → category → treatment
// drill-down with an APPROVAL panel (what's needed for the treatment to
// be approved: Indications, Recommended/Not, Pre-Auth, freq/duration,
// §cite) plus free-text search across the whole guideline set. Data is
// the 2,199-row treatment dataset from Fee Calculator 6.1, loaded lazily
// from /data/mtg/treatments.json and cached module-side.
// ====================================================================
let _mtgTx = (typeof window !== 'undefined' && window._MTG_TX) || null;
let _mtgTxPromise = null;
function loadMtgTreatments() {
  if (_mtgTx) return Promise.resolve(_mtgTx);
  if (_mtgTxPromise) return _mtgTxPromise;
  const paths = ['data/mtg/treatments.json', '/data/mtg/treatments.json', './data/mtg/treatments.json'];
  _mtgTxPromise = (async () => {
    for (const p of paths) {
      try { const r = await fetch(p); if (r.ok) { _mtgTx = await r.json(); if (typeof window !== 'undefined') window._MTG_TX = _mtgTx; return _mtgTx; } } catch (e) {}
    }
    throw new Error('MTG treatments dataset not reachable');
  })();
  return _mtgTxPromise;
}
function mtgStatusStyle(status) {
  if (status === 'Recommended')      return { color: '#0b6b3a', bg: 'rgba(34,180,110,0.14)', label: 'Recommended' };
  if (status === 'Not Recommended')  return { color: '#a3341f', bg: 'rgba(220,80,60,0.14)',  label: 'Not Recommended' };
  return { color: 'var(--tx-dim)', bg: 'rgba(150,150,150,0.14)', label: status || '—' };
}
function MTGBrowserTile({ tile, global, onUpdate }) {
  const inputs = tile.inputs || { query: '', bodyPart: 'All', category: 'All', openKey: null };
  const setInputs = (next) => onUpdate({ ...tile, inputs: { ...inputs, ...next } });
  const [data, setData] = useState(_mtgTx);
  const [err, setErr] = useState(false);
  useEffect(() => {
    if (data) return;
    loadMtgTreatments().then(setData).catch(() => setErr(true));
  }, []);

  const treatments = (data && data.treatments) || [];
  const bodyParts = (data && data.bodyParts) || [];
  const categories = (data && data.categories) || [];
  const q = (inputs.query || '').trim().toLowerCase();

  const filtered = useMemo(() => {
    let list = treatments;
    if (inputs.bodyPart && inputs.bodyPart !== 'All') list = list.filter(t => t.bodyPart === inputs.bodyPart);
    if (inputs.category && inputs.category !== 'All') list = list.filter(t => t.category === inputs.category);
    if (q) list = list.filter(t =>
      (t.treatment && t.treatment.toLowerCase().includes(q)) ||
      (t.indications && t.indications.toLowerCase().includes(q)) ||
      (t.brief && t.brief.toLowerCase().includes(q)) ||
      (t.section && t.section.toLowerCase().includes(q)) ||
      (t.bodyPart && t.bodyPart.toLowerCase().includes(q)));
    return list;
  }, [data, inputs.bodyPart, inputs.category, q]);

  const shown = filtered.slice(0, 60);
  const keyOf = (t, i) => `${t.bodyPart}|${t.category}|${t.treatment}|${i}`;

  return (
    <div className="tile-body">
      <BetaBanner note="Rebuilt MTG browser (beta) — drill down to the approval criteria for any treatment; verify against the source guideline." />
      <div className="f-group">
        <input className="f-input" type="search" placeholder="Search treatments, criteria, §section…"
          value={inputs.query || ''} onChange={e => setInputs({ query: e.target.value, openKey: null })} />
      </div>
      <div className="row cols-2">
        <div className="f-group">
          <label className="f-label">Body Part</label>
          <select className="f-select" value={inputs.bodyPart || 'All'} onChange={e => setInputs({ bodyPart: e.target.value, openKey: null })}>
            <option value="All">All body parts</option>
            {bodyParts.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div className="f-group">
          <label className="f-label">Category</label>
          <select className="f-select" value={inputs.category || 'All'} onChange={e => setInputs({ category: e.target.value, openKey: null })}>
            <option value="All">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {err && <p style={{ color: 'var(--ac-2)', fontSize: 12 }}>MTG dataset couldn’t load. Check /data/mtg/treatments.json is deployed.</p>}
      {!data && !err && <p style={{ color: 'var(--tx-faint)', fontSize: 12 }}>Loading guidelines…</p>}

      {data && (
        <>
          <div style={{ fontSize: 11, color: 'var(--tx-faint)', margin: '2px 0 6px' }}>
            {filtered.length} treatment{filtered.length === 1 ? '' : 's'}{filtered.length > 60 ? ' (showing first 60 — narrow your search)' : ''}
          </div>
          <div style={{ display: 'grid', gap: 6, maxHeight: 340, overflowY: 'auto' }}>
            {shown.map((t, i) => {
              const k = keyOf(t, i);
              const open = inputs.openKey === k;
              const st = mtgStatusStyle(t.status);
              return (
                <div key={k} style={{ border: '1px solid var(--bd-soft)', borderRadius: 8, overflow: 'hidden' }}>
                  <button type="button" onClick={() => setInputs({ openKey: open ? null : k })}
                    style={{ width: '100%', textAlign: 'left', display: 'flex', gap: 8, alignItems: 'center',
                      padding: '8px 10px', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                    <span style={{ flex: 1, fontSize: 12.5, color: 'var(--tx)' }}>{t.treatment}</span>
                    <span style={{ fontSize: 9.5, fontWeight: 700, padding: '1px 6px', borderRadius: 8,
                      color: st.color, background: st.bg, whiteSpace: 'nowrap' }}>{st.label}</span>
                    <span style={{ fontSize: 14, color: 'var(--tx-faint)' }}>{open ? '−' : '+'}</span>
                  </button>
                  {open && (
                    <div style={{ padding: '2px 10px 10px', borderTop: '1px solid var(--bd-soft)', fontSize: 12, lineHeight: 1.5 }}>
                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '6px 0', color: 'var(--tx-dim)', fontSize: 11 }}>
                        <span><strong>{t.bodyPart}</strong> · {t.category}</span>
                        <span>Pre-Auth: <strong>{t.preAuth || '—'}</strong></span>
                        {t.section && <span>MTG §{t.section}</span>}
                      </div>
                      {t.indications && (
                        <div style={{ margin: '4px 0' }}>
                          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--tx-faint)' }}>What’s needed for approval</div>
                          <div>{t.indications}</div>
                        </div>
                      )}
                      {(t.frequency || t.duration) && (
                        <div style={{ display: 'flex', gap: 16, margin: '4px 0', color: 'var(--tx-dim)' }}>
                          {t.frequency && <span><em>Frequency:</em> {t.frequency}</span>}
                          {t.duration && <span><em>Duration:</em> {t.duration}</span>}
                        </div>
                      )}
                      {t.brief && <div style={{ color: 'var(--tx-faint)', fontStyle: 'italic', marginTop: 4 }}>{t.brief}</div>}
                    </div>
                  )}
                </div>
              );
            })}
            {shown.length === 0 && <p style={{ color: 'var(--tx-faint)', fontSize: 12 }}>No treatments match. Try a different search or filter.</p>}
          </div>
        </>
      )}
    </div>
  );
}

// ====================================================================
// IME Comparison (BETA) — reusable panel for SLU / LWEC / CCP. Toggle
// reveals a second opinion field; shows the outcome under the treating
// opinion, the IME opinion, and their midpoint (average), plus a slider
// to drag to any negotiation point between the two and watch it update.
// Stored on tile.inputs.ime so it never disturbs the tile's own inputs.
// ====================================================================
function imeFmtPct(v, kind) { return (kind === 'slu' ? Math.round(v) : Math.round(v * 10) / 10) + '%'; }
function IMECompare({ kind, tile, global, onUpdate }) {
  const ime = (tile.inputs && tile.inputs.ime) || { on: false, treating: 0, ime: 0, blend: 50, member: 'Leg', weeks: 0 };
  const set = (next) => onUpdate({ ...tile, inputs: { ...tile.inputs, ime: { ...ime, ...next } } });
  const tt = global.ttRate, aww = global.aww;
  const unitLabel = kind === 'slu' ? '% SLU' : kind === 'lwec' ? '% LWEC' : '% of ⅔ AWW';
  const treating = Number(ime.treating) || 0;
  const imeVal = Number(ime.ime) || 0;
  const mid = (treating + imeVal) / 2;
  const blendVal = treating + (imeVal - treating) * ((Number(ime.blend) || 0) / 100);
  const memberWks = (SLU_BP.find(b => b.n === ime.member) || SLU_BP[0]).w;

  const outcome = (v) => {
    if (kind === 'slu') { const wks = (v / 100) * memberWks; return { line: `${fmtN(wks, 1)} wks`, dollars: wks * tt }; }
    if (kind === 'lwec') {
      const cr = applyRateBounds(tt * (v / 100), aww, global.minRate, global.maxRate);
      const br = lwecBracket(v); const life = br.mw === 'Lifetime';
      return { line: `${fmt$(cr)}/wk · ${life ? 'Lifetime' : br.mw + ' wks'}`, dollars: life ? null : cr * br.mw };
    }
    const wr = applyRateBounds((Number(aww) || 0) * (2 / 3) * (v / 100), aww, global.minRate, global.maxRate);
    const wks = Number(ime.weeks) || 0;
    return { line: `${fmt$(wr)}/wk${wks ? ` × ${wks} wks` : ''}`, dollars: wks ? wr * wks : null };
  };
  const Col = ({ label, v, accent }) => {
    const o = outcome(v);
    return (
      <div style={{ flex: 1, textAlign: 'center', padding: '6px 4px', borderRadius: 8,
        background: accent ? 'rgba(255,207,92,0.14)' : 'rgba(150,150,150,0.08)' }}>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--tx-faint)' }}>{label}</div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--ac-2)' }}>{imeFmtPct(v, kind)}</div>
        <div style={{ fontSize: 10.5, color: 'var(--tx-dim)' }}>{o.line}</div>
        <div style={{ fontSize: 12, fontWeight: 600 }}>{o.dollars == null ? 'Lifetime' : fmt$(o.dollars)}</div>
      </div>
    );
  };

  return (
    <div style={{ marginTop: 8, borderTop: '1px dashed var(--bd-soft)', paddingTop: 8 }}>
      {!ime.on ? (
        <button type="button" className="btn tiny" onClick={() => set({ on: true })}>+ Compare IME opinion</button>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--tx-faint)' }}>IME vs Treating — {unitLabel}</span>
            <button type="button" className="btn tiny" onClick={() => set({ on: false })}>− Hide</button>
          </div>
          <div className="row cols-2" style={{ marginTop: 6 }}>
            <div className="f-group"><label className="f-label">Treating / Claimant {unitLabel}</label>
              <input className="f-input" type="number" min="0" value={ime.treating} onChange={e => set({ treating: e.target.value })} /></div>
            <div className="f-group"><label className="f-label">IME {unitLabel}</label>
              <input className="f-input" type="number" min="0" value={ime.ime} onChange={e => set({ ime: e.target.value })} /></div>
          </div>
          {kind === 'slu' && (
            <div className="f-group"><label className="f-label">SLU Member</label>
              <select className="f-select" value={ime.member} onChange={e => set({ member: e.target.value })}>
                {SLU_BP.map(b => <option key={b.n} value={b.n}>{b.n} ({b.w} wks)</option>)}
              </select></div>
          )}
          {kind === 'ccp' && (
            <div className="f-group" style={{ maxWidth: 220 }}><label className="f-label">Weeks (optional)</label>
              <input className="f-input" type="number" min="0" value={ime.weeks} onChange={e => set({ weeks: e.target.value })} /></div>
          )}
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <Col label="Treating" v={treating} accent={false} />
            <Col label="Midpoint" v={mid} accent={true} />
            <Col label="IME" v={imeVal} accent={false} />
          </div>
          <div className="f-group" style={{ marginTop: 8 }}>
            <label className="f-label">Negotiation point — {imeFmtPct(blendVal, kind)} · {outcome(blendVal).dollars == null ? 'Lifetime' : fmt$(outcome(blendVal).dollars)}</label>
            <input type="range" min="0" max="100" value={ime.blend} onChange={e => set({ blend: e.target.value })} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--tx-faint)' }}>
              <span>Treating {imeFmtPct(treating, kind)}</span><span>IME {imeFmtPct(imeVal, kind)}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ====================================================================
// S32 Scenarios (BETA) — three settlement figures (Conservative / Likely
// / Aggressive) → net-to-claimant for each, using the tile's current
// set-aside config. Stored on tile.inputs.scenarios.
// ====================================================================
function S32Scenarios({ tile, onUpdate }) {
  const inputs = tile.inputs || {};
  const sc = inputs.scenarios || { on: false, low: 0, mid: 0, high: 0 };
  const set = (next) => onUpdate({ ...tile, inputs: { ...inputs, scenarios: { ...sc, ...next } } });
  const calc = (v) => window.CD.Calc.computeSettlement({
    settlement: Number(v) || 0, msa: inputs.msa, msaType: inputs.msaType,
    msaMode: inputs.msaMode, msaPct: inputs.msaPct, msaOn: inputs.msaOn,
  });
  const Col = ({ label, v }) => {
    const r = calc(v);
    return (
      <div style={{ flex: 1, textAlign: 'center', padding: '6px 4px', borderRadius: 8, background: 'rgba(150,150,150,0.08)' }}>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--tx-faint)' }}>{label}</div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ac-2)' }}>{fmt$(r.settlement)}</div>
        <div style={{ fontSize: 10.5, color: 'var(--tx-dim)' }}>fee {fmt$(r.fee)}</div>
        <div style={{ fontSize: 12, fontWeight: 600 }}>net {fmt$(r.net)}</div>
      </div>
    );
  };
  return (
    <div style={{ marginTop: 8, borderTop: '1px dashed var(--bd-soft)', paddingTop: 8 }}>
      {!sc.on ? (
        <button type="button" className="btn tiny" onClick={() => set({ on: true })}>+ Compare settlement scenarios</button>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--tx-faint)' }}>Scenarios — net to claimant (same set-aside)</span>
            <button type="button" className="btn tiny" onClick={() => set({ on: false })}>− Hide</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 6 }}>
            <div className="f-group"><label className="f-label">Conservative</label>
              <div className="f-input-wrap"><span className="prefix">$</span>
                <input className="f-input with-prefix" type="number" min="0" value={sc.low} onChange={e => set({ low: e.target.value })} /></div></div>
            <div className="f-group"><label className="f-label">Likely</label>
              <div className="f-input-wrap"><span className="prefix">$</span>
                <input className="f-input with-prefix" type="number" min="0" value={sc.mid} onChange={e => set({ mid: e.target.value })} /></div></div>
            <div className="f-group"><label className="f-label">Aggressive</label>
              <div className="f-input-wrap"><span className="prefix">$</span>
                <input className="f-input with-prefix" type="number" min="0" value={sc.high} onChange={e => set({ high: e.target.value })} /></div></div>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <Col label="Conservative" v={sc.low} />
            <Col label="Likely" v={sc.mid} />
            <Col label="Aggressive" v={sc.high} />
          </div>
        </>
      )}
    </div>
  );
}

// ====================================================================
// Split Opinions — horizontal outgrowth panel (BETA). A tile grows wider
// (app.js reads inputs._expandW) and this flyout slides in on the right,
// anchored to the fixed-width tile-body. Treating vs IME, midpoint auto-
// generated + editable via slider AND number field; the applied value
// feeds the tile's own field (last-write-wins). Reset-to-midpoint is done
// by the caller's onTreating/onIme handlers. Reused by CCP + SLU (+ more).
// ====================================================================
const SPLIT_PANEL_W = 340;
function tileBaseW(tile) {
  const s = (typeof TILE_SPECS !== 'undefined' && TILE_SPECS[tile.type]) || (typeof window !== 'undefined' && window.TILE_SPECS && window.TILE_SPECS[tile.type]);
  return (s && s.w) || 480;
}
function SplitFlyout({ open, title, unit, endpoints, lo = 0, hi = 100, step = 1, prefix, treating, ime, value, onTreating, onIme, onValue, onClose, footNote, tdLabel = 'Treating Dr', imeLabel = 'IME' }) {
  const t = Number(treating) || 0, i = Number(ime) || 0;
  const mid = Math.round(((t + i) / 2) * 100) / 100;
  const px = (n) => (prefix || '') + n;
  return (
    <div aria-hidden={!open} style={{
      position: 'absolute', top: 0, left: '100%', marginLeft: 10, width: SPLIT_PANEL_W - 18, height: '100%',
      boxSizing: 'border-box', padding: '10px 10px 14px', overflowY: 'auto',
      borderLeft: '1px solid var(--bd-soft)',
      background: 'linear-gradient(180deg, rgba(255,207,92,0.06), rgba(255,255,255,0.015))',
      opacity: open ? 1 : 0, transform: open ? 'translateX(0)' : 'translateX(16px)',
      pointerEvents: open ? 'auto' : 'none',
      transition: 'opacity 260ms ease, transform 340ms cubic-bezier(0.2,0.9,0.3,1)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--ac-2)' }}>{title}</span>
        <button type="button" className="btn tiny" onClick={onClose} title="Close">×</button>
      </div>
      <div className="row cols-2" style={{ marginTop: 8 }}>
        <div className="f-group"><label className="f-label">{tdLabel}</label>
          <div className="f-input-wrap">{prefix && <span className="prefix">{prefix}</span>}
            <input className={'f-input' + (prefix ? ' with-prefix' : '')} type="number" value={treating} onChange={e => onTreating(e.target.value)} /></div></div>
        <div className="f-group"><label className="f-label">{imeLabel}</label>
          <div className="f-input-wrap">{prefix && <span className="prefix">{prefix}</span>}
            <input className={'f-input' + (prefix ? ' with-prefix' : '')} type="number" value={ime} onChange={e => onIme(e.target.value)} /></div></div>
      </div>
      <div style={{ textAlign: 'center', margin: '10px 0 4px' }}>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--tx-faint)' }}>Applied {unit || ''} · midpoint (editable)</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 3 }}>
          {prefix && <span style={{ color: 'var(--tx-dim)', fontFamily: 'var(--mono)' }}>{prefix}</span>}
          <input className="f-input" type="number" value={value} onChange={e => onValue(e.target.value)}
            style={{ textAlign: 'center', maxWidth: 120, fontFamily: 'var(--mono)', color: 'var(--ac-2)', fontSize: 15 }} />
        </div>
      </div>
      <input type="range" min={lo} max={hi} step={step} value={Number(value) || 0} onChange={e => onValue(e.target.value)} style={{ width: '100%' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: 'var(--tx-faint)' }}>
        <span>{endpoints ? endpoints[0] : lo}</span><span>{endpoints ? endpoints[1] : hi}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--tx-dim)', marginTop: 6 }}>
        <span>{px(t)}</span><span style={{ color: 'var(--ac-2)' }}>mid {px(mid)}</span><span>{px(i)}</span>
      </div>
      {footNote && <p style={{ fontSize: 10, color: 'var(--tx-faint)', marginTop: 8, lineHeight: 1.4 }}>{footNote}</p>}
    </div>
  );
}

// ====================================================================
// Exertional-capacity Split (LWEC) — qualitative horizontal outgrowth.
// TD vs IME exertional level (sedentary→very heavy); midpoint level auto-
// generated + adjustable on a 5-step slider. Decision aid only — it does
// NOT auto-set the LWEC% (no fixed exertional→% mapping).
// ====================================================================
const EXERTION_LEVELS = ['Sedentary', 'Light', 'Medium', 'Heavy', 'Very Heavy'];
function ExertionalFlyout({ open, td, ime, mid, onTD, onIME, onMid, onClose }) {
  const ti = EXERTION_LEVELS.indexOf(td), ii = EXERTION_LEVELS.indexOf(ime);
  const auto = (ti >= 0 && ii >= 0) ? Math.round((ti + ii) / 2) : (ti >= 0 ? ti : (ii >= 0 ? ii : 2));
  const midIdx = (typeof mid === 'number') ? mid : auto;
  return (
    <div aria-hidden={!open} style={{
      position: 'absolute', top: 0, left: '100%', marginLeft: 10, width: SPLIT_PANEL_W - 18, height: '100%',
      boxSizing: 'border-box', padding: '10px 10px 14px', overflowY: 'auto', borderLeft: '1px solid var(--bd-soft)',
      background: 'linear-gradient(180deg, rgba(255,207,92,0.06), rgba(255,255,255,0.015))',
      opacity: open ? 1 : 0, transform: open ? 'translateX(0)' : 'translateX(16px)', pointerEvents: open ? 'auto' : 'none',
      transition: 'opacity 260ms ease, transform 340ms cubic-bezier(0.2,0.9,0.3,1)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--ac-2)' }}>Split · Exertional Capacity</span>
        <button type="button" className="btn tiny" onClick={onClose} title="Close">×</button>
      </div>
      <div className="row cols-2" style={{ marginTop: 8 }}>
        <div className="f-group"><label className="f-label">Treating Dr</label>
          <select className="f-select" value={td || ''} onChange={e => onTD(e.target.value)}>
            <option value="">—</option>{EXERTION_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
          </select></div>
        <div className="f-group"><label className="f-label">IME</label>
          <select className="f-select" value={ime || ''} onChange={e => onIME(e.target.value)}>
            <option value="">—</option>{EXERTION_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
          </select></div>
      </div>
      <div style={{ textAlign: 'center', margin: '10px 0 4px' }}>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--tx-faint)' }}>Midpoint capacity</div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 15, color: 'var(--ac-2)' }}>{EXERTION_LEVELS[midIdx]}</div>
      </div>
      <input type="range" min={0} max={4} step={1} value={midIdx} onChange={e => onMid(Number(e.target.value))} style={{ width: '100%' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: 'var(--tx-faint)' }}>
        <span>Sedentary</span><span>Very Heavy</span>
      </div>
      <p style={{ fontSize: 10, color: 'var(--tx-faint)', marginTop: 8, lineHeight: 1.4 }}>
        Decision aid — set the LWEC% yourself from the functional + vocational picture. Changing an opinion re-centers the midpoint.
      </p>
    </div>
  );
}

Object.assign(window, {
  TILE_SPECS, SLUTile, LWECTile, CCPTile, RateLookupTile, RadiculopathyTile,
  BurnsTile, SettlementTile, MTGTile, DateCalcTile, SLURomTile, NonScheduleTile, MTGBrowserTile,
  SplitFlyout, ExertionalFlyout, tileBaseW,
  buildEquation, weeksBetween, inclusiveDays, periodWeeks, dayAfter, MUSCLE_WEAKNESS, DESIGNATIONS,
});
