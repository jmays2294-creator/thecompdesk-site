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

  // ── Guideline catalog (mirror of www/js/mtg-module.js GUIDELINES) ────────
  const GUIDELINES = [
    { slug: 'shoulder', name: 'Shoulder Injury',         regions: ['left_shoulder', 'right_shoulder'] },
    { slug: 'low-back', name: 'Mid and Low Back Injury', regions: ['upper_back', 'lower_back'] },
    { slug: 'knee',     name: 'Knee Injury',             regions: ['left_knee', 'right_knee'] },
  ];
  const REGION_TO_SLUGS = {};
  GUIDELINES.forEach(g => g.regions.forEach(r => {
    (REGION_TO_SLUGS[r] = REGION_TO_SLUGS[r] || []).push(g.slug);
  }));

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
    selectedRegions: [],
    filterSlug: '',
    filterCategory: '',
    filterSectionId: '',
  };

  // ── Data loader (cached) ─────────────────────────────────────────────────
  const cache = {};
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
  function loadAll() { return Promise.all(GUIDELINES.map(g => loadGuideline(g.slug))); }

  // ── Search & filter ──────────────────────────────────────────────────────
  function tokens(s) {
    return (s || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 2);
  }
  function matchesKeyword(section, kwTokens) {
    if (!kwTokens.length) return true;
    const hay = (section.title + ' ' + section.body_text).toLowerCase();
    return kwTokens.every(t => hay.indexOf(t) !== -1);
  }
  function buildResults() {
    const kwTokens = tokens(state.keyword);
    const wanted = new Set();
    if (state.selectedRegions.length) {
      state.selectedRegions.forEach(r => (REGION_TO_SLUGS[r] || []).forEach(s => wanted.add(s)));
    } else if (state.filterSlug) {
      wanted.add(state.filterSlug);
    } else {
      GUIDELINES.forEach(g => wanted.add(g.slug));
    }
    const results = [];
    wanted.forEach(slug => {
      const data = cache[slug];
      if (!data || typeof data !== 'object') return;
      data.sections.forEach(sec => {
        if (state.filterCategory && sec.id[0] !== state.filterCategory) return;
        if (state.filterSectionId && sec.id !== state.filterSectionId) return;
        if (!matchesKeyword(sec, kwTokens)) return;
        results.push(Object.assign({}, sec, { guideline: data.guideline, slug }));
      });
    });
    return results;
  }
  function makeExcerpt(body, keyword) {
    if (!keyword) return body.slice(0, 320) + (body.length > 320 ? '…' : '');
    const lk = keyword.toLowerCase();
    const lb = body.toLowerCase();
    const idx = lb.indexOf(lk.split(/\s+/)[0]);
    if (idx === -1) return body.slice(0, 320) + '…';
    const start = Math.max(0, idx - 80);
    const end = Math.min(body.length, idx + 240);
    return (start > 0 ? '…' : '') + body.slice(start, end) + (end < body.length ? '…' : '');
  }

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
      placeholder: 'Search guideline text (e.g. "rotator cuff", "epidural", "ACL")',
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

  function renderAnatomyPanel() {
    const wrap = h('div', { className: 'mtg-panel mtg-anatomy-panel' });
    const canvasHost = h('div', { className: 'mtg-anatomy-canvas' });
    wrap.appendChild(canvasHost);

    const rotBar = h('div', { className: 'mtg-rotbar' });
    ['Front', 'Right', 'Back', 'Left'].forEach(view => {
      rotBar.appendChild(h('button', {
        className: 'mtg-rotbtn',
        onclick: () => { if (window.CD && window.CD.MTGAnatomy) window.CD.MTGAnatomy.rotateTo(view.toLowerCase()); },
      }, view));
    });
    wrap.appendChild(rotBar);

    const chipBar = h('div', { className: 'mtg-chipbar' });
    if (!state.selectedRegions.length) {
      chipBar.appendChild(h('div', { className: 'mtg-chiphint' }, 'Hover the figure and click body parts to add them to the query.'));
    } else {
      state.selectedRegions.forEach(r => {
        chipBar.appendChild(h('span', { className: 'mtg-chip' }, [
          h('span', null, r.replace(/_/g, ' ')),
          h('button', {
            className: 'mtg-chip-x',
            onclick: () => {
              state.selectedRegions = state.selectedRegions.filter(x => x !== r);
              if (window.CD && window.CD.MTGAnatomy) window.CD.MTGAnatomy.setSelected(state.selectedRegions);
              rerender();
            },
          }, '✕'),
        ]));
      });
      chipBar.appendChild(h('button', {
        className: 'mtg-clear',
        onclick: () => {
          state.selectedRegions = [];
          if (window.CD && window.CD.MTGAnatomy) window.CD.MTGAnatomy.setSelected([]);
          rerender();
        },
      }, 'Clear all'));
    }
    wrap.appendChild(chipBar);

    setTimeout(() => {
      if (!canvasHost.isConnected || !window.CD || !window.CD.MTGAnatomy) return;
      window.CD.MTGAnatomy.unmount();
      window.CD.MTGAnatomy.mount(canvasHost);
      window.CD.MTGAnatomy.setSelected(state.selectedRegions);
      canvasHost.addEventListener('mtg:region-toggled', e => {
        state.selectedRegions = e.detail.all;
        rerender();
      });
    }, 0);

    return wrap;
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
      const card = h('div', { className: 'mtg-result-card' });
      card.appendChild(h('div', { className: 'mtg-result-meta' }, [
        h('span', { className: 'mtg-result-guideline' }, r.guideline),
        h('span', { className: 'mtg-result-sep' }, '·'),
        h('span', { className: 'mtg-result-id' }, r.id),
      ]));
      card.appendChild(h('div', { className: 'mtg-result-title' }, r.title));
      card.appendChild(h('div', { className: 'mtg-result-excerpt' }, makeExcerpt(r.body_text, state.keyword)));
      card.appendChild(h('div', { className: 'mtg-result-cite' }, r.citation));
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
    if (state.mode === 'keyword') el.appendChild(renderKeywordPanel());
    else if (state.mode === 'filters') el.appendChild(renderFilterPanel());
    else el.appendChild(renderAnatomyPanel());
    el.appendChild(renderResults());
  }

  // ── Public API ───────────────────────────────────────────────────────────
  global.MTGTool = {
    init: function (el) { renderInto(el); },
    openWithRegion: function (regionId) {
      if (!regionId) return;
      if (!state.selectedRegions.includes(regionId)) state.selectedRegions.push(regionId);
      state.mode = 'anatomy';
      if (window.CD && window.CD.MTGAnatomy) window.CD.MTGAnatomy.setSelected(state.selectedRegions);
      rerender();
    },
  };
})(window);
