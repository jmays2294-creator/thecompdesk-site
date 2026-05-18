/* MTG Tool — standalone (thecompdesk.com /tools/medical-treatment-guidelines.html)
 *
 * Three search modes (Keyword / Filters / 3D Anatomy) feed one unified results
 * panel. Data files are fetched lazily from ../data/mtg/{slug}.json and cached.
 *
 * Dependencies (loaded by the host HTML):
 *   - three.min.js  (THREE global)
 *   - mtg-anatomy.js  (CD.MTGAnatomy — yes, kept the CD namespace so the same
 *     anatomy module works on both the app and the marketing site without
 *     forking)
 *
 * Public interface used by the host page:
 *   window.MTGTool.init(rootEl)        — render the tool into rootEl
 *   window.MTGTool.openWithRegion(id)  — deep link (for nav anchors)
 */
(function (global) {
  'use strict';

  // ── Guideline catalog (loaded from /data/mtg/_summary.json at startup) ──
  // We start with the catalog empty and let loadCatalog() populate it. The
  // tool renders an empty results panel until the fetch resolves; that lets
  // us add new guidelines server-side without any frontend code change.
  let GUIDELINES = [];
  let REGION_TO_SLUGS = {};
  function rebuildRegionMap() {
    REGION_TO_SLUGS = {};
    GUIDELINES.forEach(g => (g.regions || g.body_regions || []).forEach(r => {
      (REGION_TO_SLUGS[r] = REGION_TO_SLUGS[r] || []).push(g.slug);
    }));
  }

  // ── Minimal DOM helper (no CD dependency) ────────────────────────────────
  function h(tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (k.startsWith('on') && typeof v === 'function') el[k] = v;
        else if (k === 'className') el.className = v;
        else if (k === 'innerHTML') el.innerHTML = v;
        else if (k === 'value' || k === 'checked' || k === 'selected') el[k] = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else el.setAttribute(k, v);
      }
    }
    if (typeof children === 'string') el.textContent = children;
    else if (Array.isArray(children)) children.forEach(c => { if (c) el.appendChild(c); });
    else if (children instanceof Node) el.appendChild(children);
    return el;
  }

  // ── State ────────────────────────────────────────────────────────────────
  const state = {
    mode: 'keyword',         // 'keyword' | 'filters' | 'anatomy'
    keyword: '',
    selectedRegions: [],     // kept for openWithRegion() deep-link compat
    filterSlug: '',
    filterCategory: '',
    filterSectionId: '',
    lastAnatomyTerm: '',     // legacy field, retained for backward compat
  };

  // ── Data loader (cached) ─────────────────────────────────────────────────
  const cache = {};
  let catalogLoaded = null;          // Promise resolving to the GUIDELINES array
  let abbreviationsLoaded = null;    // Promise resolving to ABBREVIATIONS map
  let ABBREVIATIONS = {};            // lowercase token → array of expansion strings

  function loadCatalog() {
    if (catalogLoaded) return catalogLoaded;
    catalogLoaded = fetch('../data/mtg/_summary.json')
      .then(r => { if (!r.ok) throw new Error('summary ' + r.status); return r.json(); })
      .then(j => {
        GUIDELINES = (j.guidelines || []).map(g => ({
          slug: g.slug, name: g.name, regions: g.body_regions || [],
          pdf_filename: g.pdf_filename, page_count: g.page_count, section_count: g.section_count,
        }));
        rebuildRegionMap();
        return GUIDELINES;
      })
      .catch(e => { console.error('[MTG] catalog', e); GUIDELINES = []; return []; });
    return catalogLoaded;
  }

  function loadAbbreviations() {
    if (abbreviationsLoaded) return abbreviationsLoaded;
    abbreviationsLoaded = fetch('../data/mtg/abbreviations.json')
      .then(r => { if (!r.ok) throw new Error('abbrev ' + r.status); return r.json(); })
      .then(j => { ABBREVIATIONS = j.abbreviations || {}; return ABBREVIATIONS; })
      .catch(e => { console.warn('[MTG] abbrev', e); ABBREVIATIONS = {}; return {}; });
    return abbreviationsLoaded;
  }

  function loadGuideline(slug) {
    if (cache[slug] && typeof cache[slug] === 'object') return Promise.resolve(cache[slug]);
    if (cache[slug] === 'loading') return cache[slug + ':promise'];
    cache[slug] = 'loading';
    // Page is at /tools/...html, JSONs at /data/mtg/...
    const p = fetch(`../data/mtg/${slug}.json`)
      .then(r => { if (!r.ok) throw new Error('fetch ' + slug + ' failed: ' + r.status); return r.json(); })
      .then(data => { cache[slug] = data; return data; })
      .catch(e => { console.error('[MTG]', e); cache[slug] = 'error'; return null; });
    cache[slug + ':promise'] = p;
    return p;
  }
  function loadAll() {
    return Promise.all([loadCatalog(), loadAbbreviations()])
      .then(() => Promise.all(GUIDELINES.map(g => loadGuideline(g.slug))));
  }

  // ── Smart query parser ──────────────────────────────────────────────────
  // Splits the user's query into three orthogonal axes:
  //   1. sectionRefs — explicit section IDs like "C.2.a", "D.10", or bare
  //      "D6" (no dots). These drive the top-rank for exact section matches.
  //   2. guidelineHints — tokens that match a guideline's name or slug
  //      (e.g. "low back" → Mid and Low Back Injury). Strict filter: when
  //      any hint matches, results are limited to those guidelines.
  //   3. freeText — leftover tokens that go through the existing
  //      abbreviation expansion (PT → physical therapy, etc).
  const STOPWORDS = new Set(['of', 'and', 'the', 'injury', 'a', 'an', 'in', 'for']);
  const SECTION_REF_CANON = /\b([A-E])\.(\d{1,3})(?:\.([a-z]))?\b/gi;
  const SECTION_REF_BARE  = /\b([A-E])(\d{1,3})\b/gi;

  function parseQuery(q) {
    const raw = (q || '').toLowerCase();
    const sectionRefs = [];
    let m;
    SECTION_REF_CANON.lastIndex = 0;
    while ((m = SECTION_REF_CANON.exec(raw)) !== null) {
      const letter = m[1].toUpperCase();
      const number = parseInt(m[2], 10);
      const sub = m[3] ? m[3].toLowerCase() : null;
      sectionRefs.push({
        letter, number, sub, ref: m[0],
        parent: letter + '.' + number,
        canonical: letter + '.' + number + (sub ? '.' + sub : ''),
      });
    }
    SECTION_REF_BARE.lastIndex = 0;
    while ((m = SECTION_REF_BARE.exec(raw)) !== null) {
      const full = m[0];
      if (sectionRefs.some(r => r.ref.toLowerCase().indexOf(full.toLowerCase()) !== -1)) continue;
      const letter = m[1].toUpperCase();
      const number = parseInt(m[2], 10);
      sectionRefs.push({
        letter, number, sub: null, ref: full,
        parent: letter + '.' + number,
        canonical: letter + '.' + number,
      });
    }
    let remaining = raw;
    sectionRefs.forEach(r => { remaining = remaining.split(r.ref.toLowerCase()).join(' '); });

    const guidelineHints = [];
    for (const g of GUIDELINES) {
      const nameTokens = (g.name || '').toLowerCase().split(/[^a-z0-9]+/)
        .filter(t => t.length >= 3 && !STOPWORDS.has(t));
      const slugTokens = (g.slug || '').toLowerCase().split(/[^a-z0-9]+/)
        .filter(t => t.length >= 3);
      const allTokens = Array.from(new Set([...nameTokens, ...slugTokens]));
      const matched = [];
      for (const t of allTokens) {
        const tRe = new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
        if (tRe.test(remaining)) matched.push(t);
      }
      // Try phrase matches too — "mid and low back", "low-back" → low back
      const phrases = [g.name.toLowerCase(), g.slug.toLowerCase().replace(/-/g, ' ')];
      for (const p of phrases) {
        if (p.length >= 4 && remaining.indexOf(p) !== -1) matched.push(p);
      }
      if (matched.length) guidelineHints.push({ slug: g.slug, name: g.name, matchedTokens: matched });
    }
    // Strip matched guideline tokens from remaining so they don't double-count as free-text
    for (const h of guidelineHints) {
      for (const t of h.matchedTokens) {
        const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s\-]+/g, '[\\s\\-]+');
        remaining = remaining.replace(new RegExp('\\b' + esc + '\\b', 'gi'), ' ');
      }
    }

    const freeText = remaining.toLowerCase().split(/[^a-z0-9]+/)
      .filter(t => t.length >= 2 && !STOPWORDS.has(t));
    return { sectionRefs, guidelineHints, freeText };
  }

  // Each typed token matches the haystack if the token itself appears, OR if
  // any of its registered abbreviation expansions appears (PT → "physical
  // therapy", etc.). ABBREVIATIONS is loaded from /data/mtg/abbreviations.json.
  function tokenMatches(hay, token) {
    if (hay.indexOf(token) !== -1) return true;
    const exps = ABBREVIATIONS[token];
    if (exps) {
      for (let i = 0; i < exps.length; i++) {
        if (hay.indexOf(exps[i]) !== -1) return true;
      }
    }
    return false;
  }

  // ── Section scoring ─────────────────────────────────────────────────────
  // Higher score = more relevant. Combined as: section-id match dominates,
  // guideline hint is a moderate bonus, free-text density adds the long tail.
  function scoreSection(section, slug, parsed) {
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
      const haylo = hay;
      for (const t of parsed.freeText) {
        if (section.title.toLowerCase().indexOf(t) !== -1) score += 50;
        if (tokenMatches(hay, t)) {
          const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const count = (haylo.match(new RegExp(esc, 'g')) || []).length;
          score += Math.min(count * 8, 80);
        }
      }
    }
    return score;
  }

  function buildResults() {
    const parsed = parseQuery(state.keyword);
    const wanted = new Set();
    if (state.selectedRegions.length) {
      state.selectedRegions.forEach(r => (REGION_TO_SLUGS[r] || []).forEach(s => wanted.add(s)));
    } else if (parsed.guidelineHints.length) {
      // STRICT filter: query named a guideline → only that guideline's results
      parsed.guidelineHints.forEach(h => wanted.add(h.slug));
    } else if (state.filterSlug) {
      wanted.add(state.filterSlug);
    } else {
      GUIDELINES.forEach(g => wanted.add(g.slug));
    }
    const results = [];
    const refToAnchor = parsed.sectionRefs[0] ? parsed.sectionRefs[0].canonical : null;
    wanted.forEach(slug => {
      const data = cache[slug];
      if (!data || typeof data !== 'object') return;
      data.sections.forEach(sec => {
        if (state.filterCategory && sec.id[0] !== state.filterCategory) return;
        if (state.filterSectionId && sec.id !== state.filterSectionId) return;
        // Strict free-text: every typed free-text token must match.
        if (parsed.freeText.length) {
          const hay = (sec.title + ' ' + sec.body_text).toLowerCase();
          if (!parsed.freeText.every(t => tokenMatches(hay, t))) return;
        }
        const score = scoreSection(sec, slug, parsed);
        results.push(Object.assign({}, sec, {
          guideline: data.guideline, slug, _score: score, _anchorRef: refToAnchor,
        }));
      });
    });
    // Sort by score desc, then by section id for stable order at equal scores.
    results.sort((a, b) => (b._score - a._score) || a.id.localeCompare(b.id));
    return results;
  }

  function makeExcerpt(body, keyword, anchorRef) {
    // If the query included a section ref that appears in body_text, prefer
    // an excerpt anchored around that mention (so "low back C.2.a" surfaces
    // the C.2.a chunk of C.2's body, not the start).
    if (anchorRef) {
      const idx = body.toLowerCase().indexOf(anchorRef.toLowerCase());
      if (idx !== -1) {
        const start = Math.max(0, idx - 60);
        const end = Math.min(body.length, idx + 260);
        return (start > 0 ? '…' : '') + body.slice(start, end) + (end < body.length ? '…' : '');
      }
    }
    if (!keyword) return body.slice(0, 320) + (body.length > 320 ? '…' : '');
    const lk = keyword.toLowerCase();
    const lb = body.toLowerCase();
    // Pick the first free-text token (skipping section refs) for anchoring
    const firstFree = lk.split(/\s+/).find(t => !/^[a-e]\.?\d+(\.[a-z])?$/i.test(t)) || lk.split(/\s+/)[0];
    const idx = lb.indexOf(firstFree);
    if (idx === -1) return body.slice(0, 320) + '…';
    const start = Math.max(0, idx - 80);
    const end = Math.min(body.length, idx + 240);
    return (start > 0 ? '…' : '') + body.slice(start, end) + (end < body.length ? '…' : '');
  }

  // ── Section overlay (hover peek / click lock) ────────────────────────────
  // Section preview overlay. Two visual modes:
  //   peek   — small translucent tooltip-style card anchored to the right
  //            of the hovered result card. Pointer-events:none so the user
  //            can move off the result card to dismiss. No close button.
  //   locked — moderately larger side panel docked to the right edge of
  //            the viewport. Solid background, dedicated X close button,
  //            full body text scrollable, "View source PDF" link.
  // The overlay lives in document.body so it escapes any transform/overflow
  // context on the page (important for embedded surfaces like the workspace).
  const overlayState = { result: null, locked: false, el: null };

  function ensureOverlayEl() {
    if (overlayState.el) return overlayState.el;
    const root = h('div', { className: 'mtg-overlay-root', role: 'dialog', 'aria-modal': 'false' });
    const backdrop = h('div', { className: 'mtg-overlay-backdrop' });
    const card = h('div', { className: 'mtg-overlay-card' });
    const xBtn = h('button', { className: 'mtg-overlay-x', 'aria-label': 'Close section', type: 'button' }, '×');
    xBtn.addEventListener('click', (e) => { e.stopPropagation(); closeOverlay(); });
    backdrop.addEventListener('click', () => { if (overlayState.locked) closeOverlay(); });
    card.appendChild(xBtn);
    const meta = h('div', { className: 'mtg-overlay-meta' });
    const title = h('h2', { className: 'mtg-overlay-title' });
    const cite = h('div', { className: 'mtg-overlay-cite' });
    const body = h('div', { className: 'mtg-overlay-body' });
    const pdfLink = h('a', { className: 'mtg-overlay-pdf', target: '_blank', rel: 'noopener' }, 'View source PDF at this section →');
    card.appendChild(meta);
    card.appendChild(title);
    card.appendChild(body);
    card.appendChild(cite);
    card.appendChild(pdfLink);
    root.appendChild(backdrop);
    root.appendChild(card);
    document.body.appendChild(root);
    overlayState.el = root;
    overlayState._refs = { root, card, meta, title, cite, body, pdfLink, xBtn };
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlayState.locked) closeOverlay();
    });
    return root;
  }

  // Position the card next to `anchorEl` (peek mode) or as a right side
  // panel (locked mode). All positioning is via inline styles so the CSS
  // can stay mode-class-driven.
  function positionOverlay(anchorEl) {
    const refs = overlayState._refs;
    if (!refs) return;
    const card = refs.card;
    const narrowVp = window.innerWidth < 720;
    if (overlayState.locked) {
      // Side panel docked to right (or bottom sheet on narrow viewports).
      if (narrowVp) {
        card.style.left = '8px';
        card.style.right = '8px';
        card.style.top = 'auto';
        card.style.bottom = '8px';
        card.style.width = 'auto';
        card.style.maxWidth = 'none';
        card.style.maxHeight = '70vh';
      } else {
        card.style.left = 'auto';
        card.style.right = '24px';
        card.style.top = '5vh';
        card.style.bottom = 'auto';
        card.style.width = 'min(480px, 40vw)';
        card.style.maxWidth = 'none';
        card.style.maxHeight = '90vh';
      }
      return;
    }
    // Peek: anchor to right of cardEl, fall back to left, then below.
    if (!anchorEl || narrowVp) {
      card.style.left = 'auto';
      card.style.right = '16px';
      card.style.top = '80px';
      card.style.bottom = 'auto';
      card.style.width = 'min(360px, 92vw)';
      card.style.maxHeight = '320px';
      return;
    }
    const rect = anchorEl.getBoundingClientRect();
    const peekWidth = 360;
    const peekMaxH = 320;
    const margin = 12;
    let left = rect.right + margin;
    let top = rect.top;
    if (left + peekWidth > window.innerWidth - 12) {
      left = rect.left - peekWidth - margin;
      if (left < 12) {
        // Not enough room either side — anchor below the card
        left = Math.max(12, Math.min(window.innerWidth - peekWidth - 12, rect.left));
        top = rect.bottom + margin;
      }
    }
    if (top + peekMaxH > window.innerHeight - 12) {
      top = Math.max(12, window.innerHeight - peekMaxH - 12);
    }
    card.style.left = left + 'px';
    card.style.top = top + 'px';
    card.style.right = 'auto';
    card.style.bottom = 'auto';
    card.style.width = peekWidth + 'px';
    card.style.maxWidth = peekWidth + 'px';
    card.style.maxHeight = peekMaxH + 'px';
  }

  function openOverlay(result, locked, anchorEl) {
    ensureOverlayEl();
    overlayState.result = result;
    overlayState.locked = !!locked;
    overlayState.anchor = anchorEl || null;
    const refs = overlayState._refs;
    refs.meta.innerHTML = '';
    refs.meta.appendChild(h('span', { className: 'mtg-overlay-guideline' }, result.guideline));
    refs.meta.appendChild(h('span', null, ' · '));
    refs.meta.appendChild(h('span', { className: 'mtg-overlay-id' }, result.id));
    refs.title.textContent = result.title || '';
    // If the result came in with an anchor ref, render the body with the
    // matching substring wrapped in <mark> so it stands out, and remember
    // the mark element so we can scroll it into view in locked mode.
    const anchorRef = result._anchorRef || null;
    const markEl = renderBodyWithHighlight(refs.body, result.body_text || '', anchorRef);
    refs.cite.textContent = result.citation || '';
    refs.pdfLink.href = `../data/mtg/pdfs/${result.slug}.pdf#page=${result.page}`;
    refs.root.classList.toggle('locked', overlayState.locked);
    refs.root.classList.toggle('peek', !overlayState.locked);
    refs.root.classList.add('visible');
    positionOverlay(anchorEl);
    // Auto-scroll the body to show the highlighted ref when locked (peek is
    // line-clamped, so scrolling there has no effect).
    if (markEl && overlayState.locked) {
      requestAnimationFrame(() => {
        try { markEl.scrollIntoView({ block: 'center', behavior: 'auto' }); } catch (_) {}
      });
    }
  }

  // Render body_text into bodyEl. If anchorText is found, wrap that substring
  // in a <mark class="mtg-overlay-mark"> for visual emphasis. Returns the mark
  // element (or null if no anchor / not found).
  function renderBodyWithHighlight(bodyEl, bodyText, anchorText) {
    if (!anchorText) { bodyEl.textContent = bodyText; return null; }
    const idx = bodyText.toLowerCase().indexOf(anchorText.toLowerCase());
    if (idx === -1) { bodyEl.textContent = bodyText; return null; }
    bodyEl.innerHTML = '';
    bodyEl.appendChild(document.createTextNode(bodyText.slice(0, idx)));
    const mark = document.createElement('mark');
    mark.className = 'mtg-overlay-mark';
    mark.textContent = bodyText.slice(idx, idx + anchorText.length);
    bodyEl.appendChild(mark);
    bodyEl.appendChild(document.createTextNode(bodyText.slice(idx + anchorText.length)));
    return mark;
  }

  function lockOverlay() {
    if (!overlayState.result || !overlayState.el) return;
    overlayState.locked = true;
    overlayState.el.classList.remove('peek');
    overlayState.el.classList.add('locked');
    positionOverlay(overlayState.anchor);
  }

  function closeOverlay() {
    if (!overlayState.el) return;
    overlayState.el.classList.remove('visible', 'locked', 'peek');
    overlayState.result = null;
    overlayState.locked = false;
    overlayState.anchor = null;
  }

  // Re-position on resize so the side panel stays docked correctly.
  window.addEventListener('resize', () => {
    if (overlayState.el && overlayState.el.classList.contains('visible')) {
      positionOverlay(overlayState.anchor);
    }
  });

  // ── Renderers ────────────────────────────────────────────────────────────
  let rootEl = null;
  function rerender() { if (rootEl) renderInto(rootEl); }

  function renderSubTabs() {
    const tabs = h('div', { className: 'mtg-subtabs' });
    [
      { k: 'keyword', l: 'Keyword' },
      { k: 'filters', l: 'Filters' },
      { k: 'anatomy', l: '3D Anatomy' },
    ].forEach(o => {
      tabs.appendChild(h('button', {
        className: 'mtg-subtab' + (state.mode === o.k ? ' active' : ''),
        onclick: () => { state.mode = o.k; rerender(); },
      }, o.l));
    });
    return tabs;
  }

  function renderKeywordPanel() {
    const wrap = h('div', { className: 'mtg-panel' });
    const input = h('input', {
      type: 'search',
      className: 'mtg-input',
      placeholder: 'Search by guideline + section + keyword (e.g. "low back C.2.a", "shoulder D6", "knee PT", "ACL")',
      value: state.keyword,
    });
    input.addEventListener('input', e => { state.keyword = e.target.value; });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); rerender(); } });
    input.addEventListener('blur', () => rerender());
    wrap.appendChild(input);
    wrap.appendChild(h('div', { className: 'mtg-help' }, 'Tip: combine words. "shoulder injection" matches sections that mention both.'));
    return wrap;
  }

  function renderFilterPanel() {
    const wrap = h('div', { className: 'mtg-panel' });

    wrap.appendChild(h('label', { className: 'mtg-flbl' }, 'Guideline'));
    const gSelect = h('select', { className: 'mtg-select' });
    gSelect.appendChild(h('option', { value: '' }, 'All guidelines'));
    GUIDELINES.forEach(g => {
      const opt = h('option', { value: g.slug }, g.name);
      if (state.filterSlug === g.slug) opt.selected = true;
      gSelect.appendChild(opt);
    });
    gSelect.addEventListener('change', e => { state.filterSlug = e.target.value; state.filterSectionId = ''; rerender(); });
    wrap.appendChild(gSelect);

    wrap.appendChild(h('label', { className: 'mtg-flbl' }, 'Section Category'));
    const cSelect = h('select', { className: 'mtg-select' });
    cSelect.appendChild(h('option', { value: '' }, 'All categories'));
    [
      ['A', 'General Principles'],
      ['B', 'Introduction'],
      ['C', 'History & Diagnosis'],
      ['D', 'Diagnoses & Treatments'],
      ['E', 'Therapeutic Procedures'],
    ].forEach(p => {
      const opt = h('option', { value: p[0] }, 'Section ' + p[0] + ' — ' + p[1]);
      if (state.filterCategory === p[0]) opt.selected = true;
      cSelect.appendChild(opt);
    });
    cSelect.addEventListener('change', e => { state.filterCategory = e.target.value; state.filterSectionId = ''; rerender(); });
    wrap.appendChild(cSelect);

    wrap.appendChild(h('label', { className: 'mtg-flbl' }, 'Specific Section'));
    const sSelect = h('select', { className: 'mtg-select' });
    sSelect.appendChild(h('option', { value: '' }, 'All sections'));
    if (state.filterSlug) {
      const data = cache[state.filterSlug];
      if (data && typeof data === 'object') {
        data.sections.forEach(sec => {
          if (state.filterCategory && sec.id[0] !== state.filterCategory) return;
          const opt = h('option', { value: sec.id }, sec.id + ' — ' + sec.title);
          if (state.filterSectionId === sec.id) opt.selected = true;
          sSelect.appendChild(opt);
        });
      }
    }
    sSelect.disabled = !state.filterSlug;
    sSelect.addEventListener('change', e => { state.filterSectionId = e.target.value; rerender(); });
    wrap.appendChild(sSelect);

    if (state.filterSlug || state.filterCategory || state.filterSectionId) {
      wrap.appendChild(h('button', {
        className: 'mtg-clear',
        onclick: () => { state.filterSlug = ''; state.filterCategory = ''; state.filterSectionId = ''; rerender(); },
      }, '✕ Clear filters'));
    }
    return wrap;
  }

  // ── 3D Anatomy panel (Three.js + AnatomyTOOL skeleton GLB) ──────────────
  // The skeleton model is loaded once via MTGAnatomy3D.mount() on the
  // canvas div. Hover highlights regions, click adds the region+bone to
  // the query. The Three.js scene is kept alive across rerenders by NOT
  // remounting on every state change — we only remount when the anatomy
  // panel mounts the first time or after a tab switch.
  let anatomyMounted = false;
  let anatomyLoading = true;
  let anatomyHoverLabel = null;     // pretty name of hovered region (display only)
  let anatomyClickedBone = null;    // last-clicked bone name (display)

  function prettyRegionName(regionId) {
    if (!regionId) return '';
    return regionId.replace(/^(left|right)_/, function (_, side) {
      return side.charAt(0).toUpperCase() + side.slice(1) + ' ';
    }).replace(/_/g, ' ');
  }

  function handleAnatomyClick(regionId, boneName) {
    if (!regionId) return;
    anatomyClickedBone = boneName || '';
    // Filter results by the clicked region (chip-style) and clear free-text
    // keyword so the user sees ALL sections for that region. They can layer
    // on a keyword from the Keyword tab afterward.
    state.selectedRegions = [regionId];
    state.keyword = '';
    refreshAnatomyDynamicContent();
  }

  function handleAnatomyHover(regionId /*, boneName */) {
    anatomyHoverLabel = regionId ? prettyRegionName(regionId) : null;
    refreshAnatomyHoverLabel();
  }

  function refreshAnatomyHoverLabel() {
    if (!rootEl) return;
    const label = rootEl.querySelector('.mtg-anatomy-hover-label');
    if (label) label.textContent = anatomyHoverLabel || '';
  }

  function refreshAnatomyDynamicContent() {
    if (!rootEl) return;
    const oldResults = rootEl.querySelector('.mtg-results');
    const oldHistory = rootEl.querySelector('.mtg-anatomy-history');
    if (oldResults) oldResults.replaceWith(renderResults());
    if (oldHistory) oldHistory.replaceWith(renderAnatomyHistory());
  }

  function renderAnatomyHistory() {
    const bar = h('div', { className: 'mtg-anatomy-history' });
    if (state.selectedRegions.length) {
      state.selectedRegions.forEach(r => {
        bar.appendChild(h('span', { className: 'mtg-chip' }, [
          h('span', null, prettyRegionName(r)),
          h('button', {
            className: 'mtg-chip-x',
            onclick: () => {
              state.selectedRegions = state.selectedRegions.filter(x => x !== r);
              if (window.MTGAnatomy3D) window.MTGAnatomy3D.clearHighlight();
              refreshAnatomyDynamicContent();
            },
          }, '✕'),
        ]));
      });
      if (anatomyClickedBone) {
        bar.appendChild(h('span', { className: 'mtg-anatomy-bone-tag' }, 'last bone: ' + anatomyClickedBone));
      }
    } else {
      bar.appendChild(h('div', { className: 'mtg-anatomy-history-empty' },
        'Hover the skeleton to highlight regions · click any bone to filter the guidelines below.'));
    }
    return bar;
  }

  // Singleton canvas div (the WebGL renderer attaches to it). Kept across
  // rerenders so we don't have to reload the 3.4MB GLB every time the user
  // toggles a chip or types in the keyword search.
  let anatomyCanvasEl = null;
  function getAnatomyCanvas() {
    if (anatomyCanvasEl) return anatomyCanvasEl;
    anatomyCanvasEl = document.createElement('div');
    anatomyCanvasEl.className = 'mtg-anatomy-canvas';
    return anatomyCanvasEl;
  }

  function renderAnatomyPanel() {
    const wrap = h('div', { className: 'mtg-panel mtg-anatomy-panel' });

    const canvasWrap = h('div', { className: 'mtg-anatomy-canvas-wrap' });
    canvasWrap.appendChild(getAnatomyCanvas());
    if (anatomyLoading) {
      canvasWrap.appendChild(h('div', { className: 'mtg-anatomy-loading' },
        'Loading 3D skeleton… (3.4 MB · first time only).'));
    }
    canvasWrap.appendChild(h('div', { className: 'mtg-anatomy-hover-label' }, anatomyHoverLabel || ''));
    wrap.appendChild(canvasWrap);

    const rotBar = h('div', { className: 'mtg-rotbar' });
    ['Front', 'Right', 'Back', 'Left'].forEach(view => {
      rotBar.appendChild(h('button', {
        className: 'mtg-rotbtn',
        onclick: () => { if (window.MTGAnatomy3D) window.MTGAnatomy3D.rotateTo(view.toLowerCase()); },
      }, view));
    });
    wrap.appendChild(rotBar);

    wrap.appendChild(h('div', { className: 'mtg-anatomy-hint' }, [
      h('strong', null, 'How it works: '),
      h('span', null, 'Hover a bone to highlight its body region · click to filter the guidelines list below by that region · use Front/Back/Left/Right to rotate.'),
    ]));

    wrap.appendChild(renderAnatomyHistory());

    const credit = h('div', { className: 'mtg-anatomy-credit' });
    credit.innerHTML = '3D skeleton: <a href="https://anatomytool.org/open3dmodel" target="_blank" rel="noopener">AnatomyTOOL Open3DModel</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>';
    wrap.appendChild(credit);

    // Mount Three.js scene once, after the ES module has finished loading.
    // mtg-anatomy.js is a `type="module"` script which loads asynchronously
    // — so window.MTGAnatomy3D may not exist yet on first paint. We await
    // window.MTGAnatomy3DReady (set up by an inline script in the HTML
    // before the module loads).
    setTimeout(() => {
      if (!anatomyCanvasEl || !anatomyCanvasEl.isConnected) return;
      if (anatomyMounted) return;
      const readyPromise = window.MTGAnatomy3DReady || Promise.resolve();
      readyPromise.then(() => {
        if (anatomyMounted) return;
        if (!window.MTGAnatomy3D) {
          showAnatomyError('MTGAnatomy3D module did not load. Check console.');
          return;
        }
        anatomyMounted = true;
        try {
          window.MTGAnatomy3D.mount(anatomyCanvasEl, {
            onRegionClick: handleAnatomyClick,
            onRegionHover: handleAnatomyHover,
            onReady: () => {
              anatomyLoading = false;
              const ld = rootEl && rootEl.querySelector('.mtg-anatomy-loading');
              if (ld) ld.remove();
            },
            onError: (err) => {
              const msg = (err && (err.message || err.toString())) || 'unknown error';
              showAnatomyError('3D model failed to load: ' + msg);
              console.error('[MTG] anatomy load failed:', err);
            },
          });
        } catch (e) {
          showAnatomyError('3D init crashed: ' + (e && e.message || e));
          console.error('[MTG] anatomy mount crashed:', e);
        }
      });
    }, 0);

    return wrap;
  }

  function showAnatomyError(text) {
    anatomyLoading = false;
    const ld = rootEl && rootEl.querySelector('.mtg-anatomy-loading');
    if (ld) ld.textContent = text;
  }

  function renderResults() {
    const wrap = h('div', { className: 'mtg-results' });
    const results = buildResults();
    const hdr = h('div', { className: 'mtg-results-hdr' });
    if (results.length === 0) {
      const hasQuery = state.keyword || state.selectedRegions.length || state.filterSlug || state.filterCategory || state.filterSectionId;
      hdr.appendChild(h('div', { className: 'mtg-results-empty' },
        hasQuery ? 'No matching sections. Try a broader keyword or different region.'
                 : 'Enter a keyword, set filters, or click body parts on the 3D figure to begin.'));
    } else {
      hdr.appendChild(h('div', { className: 'mtg-results-count' },
        results.length + ' matching section' + (results.length === 1 ? '' : 's')));
    }
    wrap.appendChild(hdr);

    results.slice(0, 50).forEach(r => {
      const card = h('div', { className: 'mtg-result-card mtg-result-card-interactive' });
      card.appendChild(h('div', { className: 'mtg-result-meta' }, [
        h('span', { className: 'mtg-result-guideline' }, r.guideline),
        h('span', { className: 'mtg-result-sep' }, '·'),
        h('span', { className: 'mtg-result-id' }, r.id),
      ]));
      card.appendChild(h('div', { className: 'mtg-result-title' }, r.title));
      card.appendChild(h('div', { className: 'mtg-result-excerpt' }, makeExcerpt(r.body_text, state.keyword, r._anchorRef)));
      card.appendChild(h('div', { className: 'mtg-result-cite' }, r.citation));
      // Hover (desktop) → peek overlay. Click → lock overlay.
      // Mobile: first tap → peek, tap again on the card → lock.
      // No hover events are bound on touch-only devices (matchMedia hover:none).
      const canHover = window.matchMedia && window.matchMedia('(hover: hover)').matches;
      let peekHandled = false;
      if (canHover) {
        card.addEventListener('mouseenter', () => openOverlay(r, false, card));
        card.addEventListener('mouseleave', () => { if (!overlayState.locked) closeOverlay(); });
      }
      card.addEventListener('click', () => {
        if (!overlayState.locked && overlayState.result && overlayState.result.id === r.id && overlayState.result.slug === r.slug) {
          // Already peeking this result — lock it.
          lockOverlay();
        } else if (!canHover && !peekHandled) {
          // First tap on touch device — peek
          peekHandled = true;
          openOverlay(r, false, card);
          setTimeout(() => { peekHandled = false; }, 500);
        } else {
          openOverlay(r, true, card);
        }
      });
      wrap.appendChild(card);
    });
    if (results.length > 50) {
      wrap.appendChild(h('div', { className: 'mtg-results-more' },
        'Showing first 50 of ' + results.length + ' — refine your query to narrow.'));
    }
    return wrap;
  }

  function renderInto(el) {
    rootEl = el;
    el.innerHTML = '';
    if (!cache._ensureStarted) {
      cache._ensureStarted = true;
      loadAll().then(() => rerender());
    }
    el.appendChild(renderSubTabs());
    if (state.mode === 'keyword')      el.appendChild(renderKeywordPanel());
    else if (state.mode === 'filters') el.appendChild(renderFilterPanel());
    else                                el.appendChild(renderAnatomyPanel());
    el.appendChild(renderResults());
  }

  // ── Public API ───────────────────────────────────────────────────────────
  global.MTGTool = {
    init: function (el) { renderInto(el); },
    openWithRegion: function (regionId) {
      if (!regionId) return;
      if (!state.selectedRegions.includes(regionId)) state.selectedRegions.push(regionId);
      state.mode = 'anatomy';
      rerender();
    },
  };
})(window);
