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

function mtgMakeExcerpt(body, keyword, anchorRef) {
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
        }}>{renderBodyMaybeHighlighted(r.body_text, r._anchorRef, locked)}</div>
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

  const computed = useMemo(() => {
    // SLU weeks per row.
    let sluWeeksTotal = 0;
    const rowOut = inputs.rows.map(r => {
      const bp = SLU_BP.find(b => b.n === r.bp) || SLU_BP[0];
      const sluWks = (Number(r.pct) / 100) * bp.w;
      sluWeeksTotal += sluWks;
      return { ...r, bp, sluWks };
    });
    // PHP (Protracted Healing Period) — single tile-level input that applies
    // ONCE for the whole SLU, against the body part with the highest
    // statutory healing period. Per WCL §15(4-a): multi-part SLUs don't
    // stack PHP — they share the longest healing-period requirement.
    // Example: SLU for both leg (hp 40) and hand (hp 32) with 46 weeks of
    // prior TT during healing → credit 6 PHP weeks (46 − 40), not 14.
    const phpInput = Number(inputs.phpWks || 0);
    const maxHp = rowOut.reduce((m, r) => Math.max(m, r.bp.hp || 0), 0);
    const phpCreditWks = Math.max(0, phpInput - maxHp);
    const totalWeeks = sluWeeksTotal + phpCreditWks;
    const grossTotal = totalWeeks * tt;
    // §15(3)(w) credit at TOTAL rate. When case-level prior TT/TR/TP weeks
    // exceed 130, the carrier credits (priorWks − 130) × TT against gross.
    const priorTTRWks = Number(inputs.priorTTRWks || 0);
    const creditWks = priorTTRWks > 130 ? priorTTRWks - 130 : 0;
    const creditDollars = creditWks * tt;
    const total = Math.max(0, grossTotal - creditDollars);
    const moving = Math.max(0, total - Number(inputs.priorPay || 0));
    const fee = moving * 0.15;
    const net = moving - fee;
    return {
      rowOut, sluWeeksTotal, phpInput, maxHp, phpCreditWks,
      totalWeeks, grossTotal, creditWks, creditDollars, total, moving, fee, net,
    };
  }, [inputs, tt]);

  return (
    <>
      <Inherited {...global} />
      <div className="tile-body">
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
              <button className="delete-row" onClick={() => removeRow(r.id)} title="Remove">×</button>
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

  const computed = useMemo(() => {
    const pct = Number(inputs.pct) || 0;
    const rawClassRate = tt * (pct / 100);
    // Floor at min / cap at max for the DOA. AWW < min override fires here too —
    // a 50% LWEC class rate of $66.67 with AWW=$200 collapses to $200 (AWW),
    // not $325 (min), per Joel (May 2026).
    const classRate = applyRateBounds(rawClassRate, aww, global.minRate, global.maxRate);
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
    return { pct, rawClassRate, classRate, bracket, isLifetime, grossWks, creditWks, adjustedWks,
             grossAward, creditDollars, totalAward, fee, weeklyNet, totalNet };
  }, [inputs, tt, aww, global.minRate, global.maxRate]);

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

// Round-DOWN to a precision mode. 'tenth' floors to the nearest 0.1 wk,
// 'whole' floors to the nearest 1 wk, anything else returns exact value.
// Used by the CCP tile rounding toggles + mirrored in buildEquation.
function roundWeeksDown(wks, mode) {
  const n = Number(wks) || 0;
  if (mode === 'tenth') return Math.floor(n * 10) / 10;
  if (mode === 'whole') return Math.floor(n);
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
  const removePeriod = (id) => {
    setInputs({ periods: inputs.periods.filter(p => p.id !== id) });
  };

  const computed = useMemo(() => {
    const ttBase = (Number(aww) || 0) * 2 / 3;
    const rounding = inputs.rounding || 'none';
    const out = inputs.periods.map(p => {
      // HIA (Held in Abeyance) — period is documented in the date range
      // for the record, but contributes $0 to the total award. No rate
      // resolution, no min/max bounds, no amending math.
      if (p.desg === 'HIA') {
        return { ...p, wks: 0, rawCurrentRate: 0, currentRate: 0, priorRate: 0,
                 rate: 0, amount: 0, isHia: true };
      }
      // Raw week count from the dates, then floored to whatever rounding
      // mode is active on the tile. 'none' is the historical exact value.
      const wksRaw = weeksBetween(p.start, p.end);
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
          // TP % is applied to the BOUNDED TT rate (per spec May 2026).
          // Simpler mental model than TR — "50% TP" = half of TT rate.
          const ttBounded = applyRateBounds((Number(aww) || 0) * (2 / 3), aww, global.minRate, global.maxRate);
          rawCurrentRate = ttBounded * (Number(p.ratePct || 0) / 100);
        } else {
          rawCurrentRate = Number(p.manualRate || 0);
        }
      }
      else                         rawCurrentRate = Number(p.manualRate || 0);

      // Universal min/max + AWW-override enforcement (May 2026). A 25% TR with
      // raw rate below the DOA min is bumped UP to the min, and any raw rate
      // above the DOA max is bumped DOWN to the max. When AWW < min, all rates
      // collapse to AWW.
      const currentRate = applyRateBounds(rawCurrentRate, aww, global.minRate, global.maxRate);

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
    // Per-period employer reimbursements (REIMB ER). 5/19/26 + 5/19/26 v3 —
    // reimbursements no longer reduce the total award; instead they live in
    // a SEPARATE bucket of money moving back to the employer. Attorney fees
    // are taken at 15% from BOTH buckets (claimant + employer) and shown
    // separately in the equation / OC-400.1.
    //
    // Scope handling (per-period):
    //   - 'period'   → reimbErAmount applies to this period only
    //   - 'all'      → reimbErAmount is the case-level total (exclusive — only one period carrier)
    //   - 'specific' → amount auto-computed from rates of overlapping periods over a custom window
    // Unknown Amount toggle suppresses $ math under ANY scope and surfaces as 'REIMB ER — TBD'.
    let reimbErKnown = 0;
    let reimbErHasUnknown = false;
    out.forEach(p => {
      if (!p.reimbErOn) return;
      if (p.reimbErUnknown) {
        reimbErHasUnknown = true;
        // Store 0 on the row so display code knows the period contributed nothing.
        p.resolvedReimbErAmount = 0;
        return;
      }
      const scope = p.reimbErScope || 'period';
      let amt = 0;
      if (scope === 'specific') {
        amt = computeRangeReimbursement(out, p.reimbErRangeStart, p.reimbErRangeEnd, rounding);
      } else {
        // 'period' or 'all' — both read from reimbErAmount directly.
        amt = Number(p.reimbErAmount) || 0;
      }
      p.resolvedReimbErAmount = amt;
      reimbErKnown += amt;
    });
    const totalReimbEr = reimbErKnown; // known-amount sum only
    // Claimant bucket — money moving to the claimant
    const claimantMoving = Math.max(0, totalAward - Number(inputs.priorPay || 0) - reimbErKnown);
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
      <div className="tile-body">
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
              {(p.desg === 'NCLT' || p.desg === 'NME') && (
                <div className="f-group">
                  <label className="f-label">Manual Rate</label>
                  <div className="f-input-wrap">
                    <span className="prefix">$</span>
                    <input className="f-input with-prefix" type="number" value={p.manualRate}
                      onChange={e => updatePeriod(p.id, { manualRate: e.target.value })}/>
                  </div>
                </div>
              )}
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
                  const computedAmt = computed.rows.find(r => r.id === p.id)?.resolvedReimbErAmount;
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
                      {/* Amount input — shown for Known + (period or all); hidden when Unknown OR scope=specific (auto-calculated) */}
                      {!isUnknown && scope !== 'specific' && (
                        <div className="f-input-wrap">
                          <span className="prefix">$</span>
                          <input className="f-input with-prefix" type="number" min="0"
                            value={p.reimbErAmount || 0}
                            onChange={e => updatePeriod(p.id, { reimbErAmount: Number(e.target.value) })}/>
                        </div>
                      )}
                      {/* Auto-calculated preview for specific-range + Known */}
                      {!isUnknown && scope === 'specific' && (
                        <div className="reimb-computed-preview">
                          <span className="reimb-computed-label">Auto-calculated:</span>
                          <span className="reimb-computed-value">{fmt$(computedAmt || 0)}</span>
                        </div>
                      )}
                      <div className="amending-help">
                        {isUnknown
                          ? 'REIMB ER amount TBD.'
                          : scope === 'all'
                            ? 'Case-level total across all periods — fee at 15% taken from this employer bucket, separate from claimant fee.'
                            : scope === 'specific'
                              ? 'Amount is computed from the rates of CCP periods overlapping the window above.'
                              : 'Period-specific reimbursement — fee at 15% taken from money moving back to employer, separate from claimant fee.'}
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
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', fontFamily:'var(--mono)', fontSize:11, color:'var(--tx-dim)', borderTop:'1px solid var(--bd-soft)', paddingTop:8}}>
                {p.desg === 'HIA' ? (
                  <span style={{fontStyle:'italic', color:'var(--tx-faint)'}}>
                    Held in Abeyance — contributes $0 to total award
                  </span>
                ) : (
                  <span>{fmtN(computed.rows.find(r => r.id === p.id)?.wks, 2)} wks × {fmt$(computed.rows.find(r => r.id === p.id)?.rate)}{p.amending ? ' (amending)' : ''}</span>
                )}
                <span style={{color:'var(--ac-2)'}}>{fmt$(computed.rows.find(r => r.id === p.id)?.amount)}</span>
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

        <div className="row cols-2">
          <div className="f-group">
            <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:6, marginBottom:4}}>
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
            const rateStr  = showRate ? fmt$(p.rate) : '';
            let pctStr = '';
            const pMode = p.rateMode || 'pct';
            if ((p.desg === 'TR' || p.desg === 'TP') && pMode === 'pct') {
              pctStr = `(${Number(p.ratePct) || 0}%)`;
            } else if (p.desg === 'RE' && aww > 0) {
              const wageLossPct = Math.max(0, Math.min(100, ((aww - Number(p.curEarn || 0)) / aww) * 100));
              pctStr = `(${wageLossPct.toFixed(1)}%)`;
            }
            let reimbStr = '';
            if (p.reimbErOn) {
              if (p.reimbErUnknown) {
                // Per Joel — terse: no further elaboration.
                reimbStr = 'REIMB ER TBD';
              } else {
                // Use the resolved amount (handles scope='specific' auto-calc).
                const resolved = Number(p.resolvedReimbErAmount) || 0;
                if (resolved > 0) {
                  const scope = p.reimbErScope || 'period';
                  const scopeTag = scope === 'all' ? ' case-wide'
                    : scope === 'specific' ? ' (specific range)'
                    : '';
                  reimbStr = `REIMB ER${scopeTag} −${fmt$(resolved)}`;
                }
              }
            }
            // Single-space joiner per Joel's spec: dates  RATE  DESG  (%)  REIMB.
            return [dateStr, rateStr, p.desg, pctStr, reimbStr].filter(Boolean).join(' ');
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
              {computed.rows.map((p) => (
                <div className="ccp-summary-row" key={p.id}>{buildRow(p)}</div>
              ))}
            </div>
          );
        })()}

        <div className="results">
          <div className="r-row big"><span className="l">Total Award</span><span className="v">{fmt$(computed.totalAward)}</span></div>
          {Number(inputs.priorPay || 0) > 0 && (
            <div className="r-row"><span className="l">Less Prior Payments</span><span className="v">−{fmt$(Number(inputs.priorPay || 0))}</span></div>
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

  // Mode-switching helper: when the user picks MSA-regular for the first time
  // (no msaMode set yet), default to 'pct' with 5% preset per Joel's spec.
  const onMsaTypeChange = (id) => {
    if (id === 'msa' && !inputs.msaMode) {
      setInputs({ msaType: id, msaMode: 'pct', msaPct: inputs.msaPct || 5 });
    } else {
      setInputs({ msaType: id });
    }
  };

  const c = useMemo(() => {
    const settlement = Number(inputs.settlement) || 0;
    // Back-compat: older saves stored msaOn:bool. Treat msaOn:true as 'msa'.
    const msaType =
      inputs.msaType ||
      (inputs.msaOn ? 'msa' : 'none');
    const hasMSA = msaType === 'msa' || msaType === 'medicare';
    const msaMode = inputs.msaMode || 'usd'; // 'usd' | 'pct'
    const msaPct = Number(inputs.msaPct) || 0;
    // Effective MSA in dollars — when in % mode, derive from settlement.
    const msaUsd =
      !hasMSA ? 0
      : msaMode === 'pct' ? (settlement * msaPct / 100)
      : (Number(inputs.msa) || 0);
    // Indemnity = the portion of the settlement that goes to the claimant
    // before fees, i.e. settlement net of any MSA carve-out.
    const indemnity = Math.max(0, settlement - msaUsd);
    const fee = indemnity * 0.15;
    const net = Math.max(0, indemnity - fee);
    return { settlement, msaType, hasMSA, msaMode, msaPct, msa: msaUsd, indemnity, fee, net };
  }, [inputs]);

  const MSA_TYPES = [
    { id: 'none',     label: 'None' },
    { id: 'msa',      label: 'MSA' },
    { id: 'medicare', label: 'Medicare MSA' },
  ];

  return (
    <div className="tile-body">
      <div className="f-group">
        <label className="f-label">Settlement Amount</label>
        <div className="f-input-wrap"><span className="prefix">$</span>
          <input className="f-input with-prefix" type="number" min="0" value={inputs.settlement}
            onChange={e => setInputs({ settlement: e.target.value })}/></div>
      </div>

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
      inputs.rows.forEach(r => {
        const bp = SLU_BP.find(b => b.n === r.bp) || SLU_BP[0];
        const sluWks = (Number(r.pct) / 100) * bp.w;
        sluWeeksTotal += sluWks;
        rowMeta.push({ bp, sluWks });
        lines.push(`${bp.n}: ${r.pct}% × ${bp.w} = ${fmtN(sluWks, 2)} wks`);
        plain.push(`${bp.n} at ${r.pct}%`);
      });
      // PHP — single tile-level value, credited once against the longest hp
      // among the selected body parts (per WCL §15(4-a) — PHP doesn't stack
      // across parts in a combined SLU).
      const phpInput = Number(inputs.phpWks || 0);
      const maxHp = rowMeta.reduce((m, r) => Math.max(m, r.bp.hp || 0), 0);
      const phpCreditWks = Math.max(0, phpInput - maxHp);
      if (phpInput > 0 || phpCreditWks > 0) {
        lines.push(`PHP: max(0, ${fmtN(phpInput, 2)} − ${maxHp} hp) = ${fmtN(phpCreditWks, 2)} wks`);
      }
      const totalWeeks = sluWeeksTotal + phpCreditWks;
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
      const phpNote = phpCreditWks > 0
        ? ` PHP adds ${fmtN(phpCreditWks, 2)} weeks (${fmtN(phpInput, 2)} prior TT weeks − ${maxHp}-week healing period for the longest-hp part).`
        : '';
      const creditNote = creditWks > 0
        ? ` After §15(3)(w) credit of ${fmtN(creditWks, 2)} weeks at the TT rate (${fmt$(creditDollars)} deduction), total = ${fmt$(total)}.`
        : '';
      const plainText = `SLU Award: ${plain.join(', ')}.${phpNote} Total ${fmtN(totalWeeks, 2)} weeks × ${fmt$(tt)}/wk = ${fmt$(grossTotal)} gross.${creditNote} Less prior payments of ${fmt$(Number(inputs.priorPay || 0))} = ${fmt$(moving)} moving. Attorney fee 15% of moving = ${fmt$(fee)}. Net to claimant = ${fmt$(net)}.`;
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
      const lines = [
        `LWEC: ${pct}% (${bracket.l})`,
        `Raw Class Rate: ${fmt$(tt)} × ${pct}% = ${fmt$(rawClassRate)}/wk`,
      ];
      if (wasFloored) lines.push(`Adjusted Class Rate: ${fmt$(classRate)}/wk (${floorReason})`);
      else lines.push(`Class Rate: ${fmt$(classRate)}/wk`);
      lines.push(`Gross Weeks: ${isLifetime ? 'Lifetime' : bracket.mw}`);
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
      const rows = inputs.periods.map(p => {
        if (p.desg === 'HIA') {
          return { ...p, wks: 0, rate: 0, amount: 0, currentRate: 0, priorRate: 0,
                   rawCurrentRate: 0, isHia: true };
        }
        const wksRaw = weeksBetween(p.start, p.end);
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
          if (rateMode === 'pct') {
            const ttBounded = applyRateBounds((Number(aww) || 0) * (2 / 3), aww, global.minRate, global.maxRate);
            rawCurrentRate = ttBounded * (Number(p.ratePct || 0) / 100);
          } else {
            rawCurrentRate = Number(p.manualRate || 0);
          }
        }
        else rawCurrentRate = Number(p.manualRate || 0);
        const currentRate = applyRateBounds(rawCurrentRate, aww, global.minRate, global.maxRate);
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

      // Phase 2 — emit per-period lines + summary prose, and bucket REIMB ER.
      let reimbErKnown = 0;
      let reimbErHasUnknown = false;
      rows.forEach((r, i) => {
        // HIA period emission
        if (r.isHia) {
          lines.push(`P${i+1} HIA: ${r.start || '—'} to ${r.end || '—'} — Held in Abeyance ($0)`);
          summary.push(`Period ${i+1} held in abeyance (${r.start || 'no start'} to ${r.end || 'no end'})`);
        } else {
          totalAward += r.amount;
          const adjusted = Math.abs(r.currentRate - r.rawCurrentRate) > 0.005;
          const amendSuffix = r.amending ? ` (amending: ${fmt$(r.currentRate)} − ${fmt$(r.priorRate)} = ${fmt$(r.rate)}/wk)` : '';
          const adjustedSuffix = adjusted && !r.amending ? ` (raw ${fmt$(r.rawCurrentRate)}, bounded by min/max for DOA)` : '';
          lines.push(`P${i+1} ${r.desg}: ${fmtN(r.wks, 2)} wks × ${fmt$(r.rate)}${adjustedSuffix}${amendSuffix} = ${fmt$(r.amount)}`);
          const summaryAmend = r.amending ? `, amending — ${fmt$(r.currentRate)} − ${fmt$(r.priorRate)} = ${fmt$(r.rate)}/wk` : '';
          summary.push(`Period ${i+1} (${r.desg}, ${fmtN(r.wks,2)} wks at ${fmt$(r.rate)}/wk${adjusted && !r.amending ? ` — adjusted from raw ${fmt$(r.rawCurrentRate)}` : ''}${summaryAmend} = ${fmt$(r.amount)})`);
        }

        // REIMB ER bucketing for this period
        if (!r.reimbErOn) return;
        if (r.reimbErUnknown) {
          reimbErHasUnknown = true;
          lines.push(`  REIMB ER (P${i+1}): amount of Reimbursement TBD`);
          return;
        }
        const scope = r.reimbErScope || 'period';
        let amt = 0;
        let label = '';
        if (scope === 'specific') {
          amt = computeRangeReimbursement(rows, r.reimbErRangeStart, r.reimbErRangeEnd, ccpRounding);
          label = `specific ${r.reimbErRangeStart || '—'} to ${r.reimbErRangeEnd || '—'}`;
        } else if (scope === 'all') {
          amt = Number(r.reimbErAmount) || 0;
          label = 'case-wide';
        } else {
          amt = Number(r.reimbErAmount) || 0;
          label = `P${i+1}`;
        }
        if (amt > 0) {
          reimbErKnown += amt;
          lines.push(`  REIMB ER (${label}): ${fmt$(amt)} → employer bucket`);
        }
      });

      // Buckets — claimant + employer + CCP
      const claimantMoving = Math.max(0, totalAward - Number(inputs.priorPay || 0) - reimbErKnown);
      const feeOnClaimant = claimantMoving * 0.15;
      const employerMoving = reimbErKnown;
      const feeOnEmployer = employerMoving * 0.15;
      const feeOnCCP = Number(inputs.ccpAmount || 0) / 3;
      const totalFee = feeOnClaimant + feeOnEmployer + feeOnCCP;
      const netToClaimant = claimantMoving - feeOnClaimant - feeOnCCP;
      const netToEmployer = employerMoving - feeOnEmployer;

      lines.push(`Total Award: ${fmt$(totalAward)}`);
      lines.push(`Less Prior: (${fmt$(Number(inputs.priorPay || 0))})`);
      if (reimbErKnown > 0) lines.push(`Less Reimb to ER (to employer bucket): (${fmt$(reimbErKnown)})`);
      if (reimbErHasUnknown) lines.push(`Reimb to ER: TBD`);
      lines.push(`Moving to Claimant: ${fmt$(claimantMoving)}`);
      lines.push(`Fee from Claimant: ${fmt$(claimantMoving)} × 15% = ${fmt$(feeOnClaimant)}`);
      if (Number(inputs.ccpAmount || 0) > 0) {
        lines.push(`Fee on CCP: ${fmt$(Number(inputs.ccpAmount || 0))} ÷ 3 = ${fmt$(feeOnCCP)}`);
      }
      if (employerMoving > 0) {
        lines.push(`Moving to Employer (reimb): ${fmt$(employerMoving)}`);
        lines.push(`Fee from Employer Reimb: ${fmt$(employerMoving)} × 15% = ${fmt$(feeOnEmployer)}`);
      }
      lines.push(`Total Fee: ${fmt$(totalFee)}`);
      lines.push(`Net to Claimant: ${fmt$(netToClaimant)}`);
      if (employerMoving > 0) lines.push(`Net to Employer: ${fmt$(netToEmployer)}`);

      // Plain prose — keep brief. Unknown amount becomes a short tag, no
      // long explanation (per 5/19/26 v3 spec).
      const reimbClauseKnown = reimbErKnown > 0
        ? ` Reimbursement to employer of ${fmt$(reimbErKnown)} moves to a separate employer bucket; fee at 15% = ${fmt$(feeOnEmployer)}.`
        : '';
      const reimbClauseUnknown = reimbErHasUnknown ? ' Amount of Reimbursement TBD.' : '';
      const plain = `CCP / Award: ${summary.join('; ')}. Total award ${fmt$(totalAward)}, less prior payments ${fmt$(Number(inputs.priorPay || 0))} = ${fmt$(claimantMoving)} moving to claimant. Fee from claimant is 15% of claimant moving (${fmt$(feeOnClaimant)})${Number(inputs.ccpAmount || 0) > 0 ? ` plus one-third of CCP (${fmt$(feeOnCCP)})` : ''}.${reimbClauseKnown}${reimbClauseUnknown} Total attorney fee = ${fmt$(totalFee)}. Net to claimant = ${fmt$(netToClaimant)}${employerMoving > 0 ? `; net to employer = ${fmt$(netToEmployer)}` : ''}.`;
      // Per OC-400.1 § A fee-reason checkboxes:
      //   FeeReason1 = "continuation of weekly compensation benefits"
      //   FeeReason2 = "increase in the amount of compensation awarded
      //                 or paid for a prior period"
      //
      // 5/19/26 v3 rule: FeeReason1 (continuation box) is checked ONLY
      // when CCP Amount > 0. Future-dated/ongoing award periods and
      // REIMB ER alone never trigger the continuation box.
      // A past-dated period with an award still fires FeeReason2.
      const ccpToday = new Date(); ccpToday.setHours(0, 0, 0, 0);
      const ccpHasAmount = Number(inputs.ccpAmount || 0) > 0;
      let ccpHasPrior = false;
      inputs.periods.forEach(p => {
        if (!p.end) return;
        const endDate = new Date(p.end);
        if (isNaN(endDate.getTime())) return;
        if (endDate < ccpToday) ccpHasPrior = true;
      });
      const ccpFeeReasons = [];
      if (ccpHasAmount) ccpFeeReasons.push('FeeReason1');
      if (ccpHasPrior)  ccpFeeReasons.push('FeeReason2');
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

      const lines = [`Settlement: ${fmt$(settlement)}`];
      if (msaType === 'medicare') {
        lines.push(`Less Medicare MSA:  −${fmt$(msa)}`);
        lines.push(`Indemnity:  ${fmt$(indemnity)}`);
        lines.push(`Atty Fee:   ${fmt$(indemnity)} × 15% = ${fmt$(fee)}`);
      } else if (msaType === 'msa') {
        lines.push(`Less MSA:   −${fmt$(msa)}`);
        lines.push(`Atty Fee:   ${fmt$(indemnity)} × 15% = ${fmt$(fee)}`);
      } else {
        lines.push(`Atty Fee:   ${fmt$(settlement)} × 15% = ${fmt$(fee)}`);
      }
      lines.push(`Net:        ${fmt$(net)}`);

      let plain;
      if (msaType === 'medicare') {
        plain = `Section 32 Settlement of ${fmt$(settlement)} with a Medicare Set-Aside (WCMSA) of ${fmt$(msa)} funded separately. Indemnity portion to the claimant = ${fmt$(indemnity)}. Attorney fee of 15% on the indemnity = ${fmt$(fee)}. Net to claimant = ${fmt$(net)}.`;
      } else if (msaType === 'msa') {
        plain = `Section 32 Settlement of ${fmt$(settlement)} with a non-Medicare Medical Set-Aside of ${fmt$(msa)} carved out. Attorney fee of 15% on the ${fmt$(indemnity)} remainder = ${fmt$(fee)}. Net to claimant = ${fmt$(net)}.`;
      } else {
        plain = `Section 32 Settlement of ${fmt$(settlement)}. Attorney fee of 15% = ${fmt$(fee)}. Net to claimant = ${fmt$(net)}.`;
      }
      return { plain, mono: lines.join('\n'), fee, feeReasons: ['FeeReason6'] };
    }
    default:
      return { plain: '', mono: '', fee: 0, feeReasons: [] };
  }
}

Object.assign(window, {
  TILE_SPECS, SLUTile, LWECTile, CCPTile, RateLookupTile, RadiculopathyTile,
  BurnsTile, SettlementTile, MTGTile,
  buildEquation, weeksBetween, MUSCLE_WEAKNESS, DESIGNATIONS,
});
