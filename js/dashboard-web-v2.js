/* ============================================================================
 * dashboard-web-v2.js — the V2 DESKTOP TILE LAYER for /dashboard (web-only).
 * ----------------------------------------------------------------------------
 * Renders the desktop layouts from the Claude Design pages "P6–P10 Web
 * Dashboards" (worker) and "P11 Attorney Leads Web" (attorney) on top of the
 * vendored dashboards, wired to REAL data — nothing fabricated:
 *
 *   WORKER — the design's launcher grid: a true-state hero (the weekly-benefit
 *   estimate when profiles.current_aww exists, an honest CTA hero when it
 *   doesn't) plus feature tiles that open the SAME screens the vendored
 *   dashboard opens (showScreen / openAttorneyIntake). The vendored sections
 *   the grid replaces (hero, spotlight, claim card, feature grids) are hidden
 *   via [data-dashv2-hidden]; the functional cards (benefit tracker, dates,
 *   documents, upgrade) stay below the grid untouched.
 *
 *   ATTORNEY — P11 "the 48-hour clock": the most-urgent open lead as the hero
 *   tile with a live countdown ring, the open queue (click a row to make it
 *   the hero), stats derived from the real lead list, and the design's empty
 *   states carrying the vendored module's honest copy. Accept / decline /
 *   retain go through the same respond_to_lead RPC the app uses. The vendored
 *   Network Leads card + cc hero are hidden; the rest of the command center
 *   (Upcoming, This Month, Quick Calc, Tools, Skills) stays.
 *
 * Host contract:  CD.WebDashV2.wrap(vendoredNode, ctx, isWorker) -> Node
 * Fail-soft: any error inside wrap() is caught by the host, which falls back
 * to the vendored render untouched. This file is NOT synced from the app.
 * ==========================================================================*/
(function (window, document) {
  'use strict';
  var CD = window.CD = window.CD || {};

  var H48 = 48 * 3600 * 1000;

  function reduced() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function hide(node) { if (node) node.setAttribute('data-dashv2-hidden', ''); }
  function firstName(profile, user) {
    var full = String((profile && profile.full_name) || '').trim();
    if (full) return full.split(/\s+/)[0];
    var email = (user && user.email) || '';
    return email ? email.split('@')[0] : '';
  }
  function money2(v) {
    var n = Number(v); if (!isFinite(n)) n = 0;
    return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /* ── header row + greeting (shared chrome from the design pages) ────────── */
  function headerRow(chipText, metaText) {
    var head = el('div', 'dashv2-head');
    var brand = el('div', 'dashv2-brand', 'C');
    brand.appendChild(el('span', 'dashv2-brand-dot'));
    head.appendChild(brand);
    head.appendChild(el('span', 'dashv2-chip', chipText));
    if (metaText) head.appendChild(el('span', 'dashv2-meta', metaText));
    return head;
  }

  function tileBase(size, i, interactive) {
    var t = el('div', 'tile rise');
    t.setAttribute('data-size', size);
    t.style.setProperty('--i', String(i));
    if (interactive) { t.setAttribute('tabindex', '0'); t.setAttribute('role', 'button'); }
    return t;
  }

  /* ════════════════════ WORKER · P6/P7 launcher grid ══════════════════════ */

  // 2/3 of AWW capped at the DOA-period statutory max — same sources the
  // vendored tracker uses (calc-core when loaded, else the vendored MAX_RATES).
  function statMax(doa) {
    try {
      var d = doa || new Date().toISOString().slice(0, 10);
      if (CD.Calc && CD.Calc.maxRateForDOA) { var m = CD.Calc.maxRateForDOA(d); if (m) return m; }
      if (CD.getMax) { var r = CD.getMax(d); if (r && r.max) return r.max; }
      if (CD.MAX_RATES && CD.MAX_RATES[0]) return CD.MAX_RATES[0].max;
    } catch (e) {}
    return null;
  }

  function workerHero(ctx, i) {
    var profile = ctx.profile || {};
    var showScreen = ctx.showScreen || function () {};
    var t = tileBase('hero', i, true);
    t.style.gap = '12px';

    var awwRaw = (profile.current_aww != null && String(profile.current_aww).trim() !== '' && Number(profile.current_aww) > 0)
      ? Number(profile.current_aww) : null;

    if (awwRaw != null) {
      var cap = statMax(profile.doa);
      var uncapped = (awwRaw * 2) / 3;
      var rate = cap ? Math.min(uncapped, cap) : uncapped;
      t.appendChild(el('span', 'hero-eyebrow', 'Your estimate · from your average weekly wage'));
      t.appendChild(el('span', 'hero-amt', money2(rate)));
      t.appendChild(el('span', 'hero-unit', 'a week, if you’re totally out of work'));
      var capLine = 'Two-thirds of your ' + money2(awwRaw) + ' average weekly wage.';
      if (cap) {
        capLine += (uncapped > cap)
          ? ' New York caps it at ' + money2(cap) + ' — you’re at the cap.'
          : ' New York caps it at ' + money2(cap) + ' — you’re under the cap.';
      }
      t.appendChild(el('span', 'hero-body', capLine));
      var ctas = el('div', 'hero-ctas');
      var b1 = el('button', 'btn btn-primary', 'Update your wage');
      b1.type = 'button'; b1.onclick = function () { showScreen('aww'); };
      var b2 = el('button', 'btn btn-ghost', 'Benefit calculators');
      b2.type = 'button'; b2.onclick = function () { showScreen('calculator'); };
      ctas.appendChild(b1); ctas.appendChild(b2);
      t.appendChild(ctas);
      t.onclick = function (e) { if (e.target === t) showScreen('aww'); };
    } else {
      t.appendChild(el('span', 'hero-eyebrow', 'Your weekly benefit'));
      t.appendChild(el('span', 'hero-title', 'What would your weekly check be?'));
      t.appendChild(el('span', 'hero-body',
        'New York pays two-thirds of your average weekly wage while you’re out, up to the state cap. Enter your wage and the number appears here.'));
      var ctas2 = el('div', 'hero-ctas');
      var c1 = el('button', 'btn btn-primary', 'Enter your wage');
      c1.type = 'button'; c1.onclick = function () { showScreen('aww'); };
      var c2 = el('button', 'btn btn-ghost', 'Start your claim (C-3)');
      c2.type = 'button'; c2.onclick = function () { showScreen('c3'); };
      ctas2.appendChild(c1); ctas2.appendChild(c2);
      t.appendChild(ctas2);
    }
    return t;
  }

  // Feature tiles — the same screens the vendored launcher sections open.
  // Sizes are chosen so every row of the 6-column grid fills exactly.
  var WORKER_TILES = [
    { g: '!',      label: 'What’s due next',  desc: 'IME dates and reminders, in one place',        screen: 'ime',        size: 'cmp' },
    { g: 'C3',     label: 'File your claim',       desc: 'Your official C-3, guided step by step — free, no account needed', screen: 'c3', size: 'std' },
    { g: '▶', label: 'Learning',              desc: 'Plain-English guides — glossary, your rights, the road ahead',     screen: 'learning', size: 'std' },
    { g: 'Rx',     label: 'Find a doctor',         desc: 'Board-authorized, by county',                  screen: 'doctor',     size: 'cmp' },
    { g: '÷', label: 'Calculators',           desc: 'SLU, benefit rate, settlement',                screen: 'calculator', size: 'cmp' },
    { g: 'RR',     label: 'Road to Recovery',      desc: 'Every step of your case',                      screen: 'recovery',   size: 'cmp' },
    { g: '$',      label: 'Average weekly wage',   desc: 'The number your benefits build on',            screen: 'aww',        size: 'cmp' },
    { g: 'JB',     label: 'Job Buddy',             desc: 'Work within your restrictions',                screen: 'job_buddy',  size: 'cmp' },
    { g: '§', label: 'Find an attorney',      desc: 'Get matched — free, no obligation',       attorney: true,       size: 'cmp' }
  ];

  function workerBlock(ctx) {
    var profile = ctx.profile || {};
    var user = ctx.user || null;
    var showScreen = ctx.showScreen || function () {};
    var openAttorneyIntake = ctx.openAttorneyIntake || function () {};

    var block = el('section', 'dashv2');
    block.appendChild(headerRow('Comp Buddy', profile.wcb_case_number || ''));

    var name = firstName(profile, user);
    var hour = new Date().getHours();
    var daypart = hour < 12 ? 'Good morning' : (hour < 18 ? 'Good afternoon' : 'Good evening');
    block.appendChild(el('span', 'dashv2-greeting', name ? (daypart + ', ' + name + '.') : 'Welcome.'));

    var grid = el('div', 'wg');
    grid.appendChild(workerHero(ctx, 0));
    WORKER_TILES.forEach(function (spec, idx) {
      var t = tileBase(spec.size, idx + 1, true);
      var row = el('div', 'tile-row');
      row.appendChild(el('span', 'tile-glyph', spec.g));
      row.appendChild(el('span', 'tile-label', spec.label));
      t.appendChild(row);
      t.appendChild(el('span', 'tile-desc', spec.desc));
      t.appendChild(el('span', 'chev'));
      var open = spec.attorney
        ? function () { openAttorneyIntake({ source: 'dashboard' }); }
        : function () { showScreen(spec.screen); };
      t.onclick = open;
      t.onkeydown = function (e) { if (e && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } };
      grid.appendChild(t);
    });
    block.appendChild(grid);
    return block;
  }

  function pruneWorker(node) {
    if (!node) return;
    // launcher surfaces the tile grid replaces
    hide(node.querySelector('.wd-hero'));
    hide(node.querySelector('.wd-spotlight'));
    hide(node.querySelector('.wd-claim'));
    var qs = node.querySelector('.wd-claim-secondary');
    if (qs) hide(qs.closest('section') || qs);
    hide(node.querySelector('.wd-recovery'));
    var aww = node.querySelector('.wd-aww-empty');           // hero carries this CTA now
    if (aww) hide(aww.closest('section') || aww);
    // "Free tools" / "Comp Buddy features" label + grid pairs
    var labels = node.querySelectorAll('.wd-section-label');
    for (var i = 0; i < labels.length; i++) {
      var txt = (labels[i].textContent || '').toLowerCase();
      if (txt.indexOf('free tools') !== -1 || txt.indexOf('comp buddy features') !== -1) {
        hide(labels[i]); hide(labels[i].nextElementSibling);
      }
    }
  }

  /* ════════════════════ ATTORNEY · P11 the 48-hour clock ══════════════════ */

  var _lead = { phase: 'idle', uid: null, leads: null, roster: null, selectedId: null };
  var _tick = null;
  // Completion always notifies the LATEST block. The vendored module's own
  // fetch triggers a full CD.render() while ours is in flight; a callback
  // captured by the old (now detached) block would paint into the void and
  // leave the fresh block stuck on "Checking your leads…".
  var _notify = function () {};

  function client() { return CD.supa || CD.supabase || null; }

  function fetchLeads(uid) {
    if (_lead.uid !== uid) _lead = { phase: 'idle', uid: uid, leads: null, roster: null, selectedId: null };
    if (_lead.phase === 'loading') return;
    var sb = client();
    if (!sb || !uid) { _lead.phase = 'error'; _notify(); return; }
    _lead.phase = 'loading';
    Promise.all([
      sb.rpc('get_my_leads'),
      sb.from('attorney_roster').select('accepting_leads,status').limit(1).maybeSingle()
    ]).then(function (r) {
      var lr = r[0] || {}, rr = r[1] || {};
      if (lr.error) { _lead.phase = 'error'; console.error('[dashv2] LEADS_FETCH_FAILED', lr.error); }
      else {
        _lead.phase = 'ready';
        _lead.leads = Array.isArray(lr.data) ? lr.data : [];
        _lead.roster = (rr && !rr.error) ? (rr.data || null) : null;
      }
      _notify();
    }).catch(function (e) { _lead.phase = 'error'; console.error('[dashv2] LEADS_FETCH_FAILED', e); _notify(); });
  }

  function respond(id, status) {
    var sb = client(); if (!sb) return;
    sb.rpc('respond_to_lead', { p_referral_id: id, p_new_status: status }).then(function (res) {
      if (res && res.error) {
        console.error('[dashv2] RESPOND_FAILED', res.error);
        try { window.alert('Could not update this lead.\n' + (res.error.message || '')); } catch (e) {}
        return;
      }
      _lead.phase = 'idle';
      fetchLeads(_lead.uid);
    });
  }

  function msLeft(l) {
    if (!l || !l.response_deadline) return null;
    var ms = new Date(l.response_deadline).getTime() - Date.now();
    return isNaN(ms) ? null : ms;
  }
  function fmtClock(ms, withSecs) {
    if (ms == null) return '—';
    if (ms < 0) ms = 0;
    var s = Math.floor(ms / 1000);
    var p = function (n) { return String(n).padStart(2, '0'); };
    var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
    return withSecs ? (p(h) + ':' + p(m) + ':' + p(s % 60)) : (p(h) + ':' + p(m));
  }
  function urgencyColor(ms) {
    if (ms == null) return 'var(--v2-success)';
    var h = ms / 3600000;
    if (h < 6) return 'var(--v2-danger)';
    if (h < 24) return 'var(--v2-warn)';
    if (h < 36) return 'var(--v2-accent)';
    return 'var(--v2-success)';
  }
  function timeAgo(ts) {
    if (!ts) return '';
    var ms = Date.now() - new Date(ts).getTime();
    if (isNaN(ms) || ms < 0) return '';
    var h = ms / 3600000;
    if (h < 1) return Math.max(1, Math.round(ms / 60000)) + 'm ago';
    if (h < 24) return Math.round(h) + 'h ago';
    var d = Math.round(h / 24); return d === 1 ? 'yesterday' : d + ' days ago';
  }

  function emptyTile(opts) {
    var t = el('div', 'tile is-static empty-tile' + (opts.dashed ? ' is-dashed' : ''));
    t.setAttribute('data-size', 'hero');
    t.style.display = 'flex'; t.style.flexDirection = 'column';
    t.appendChild(el('span', 'empty-glyph', opts.glyph));
    t.appendChild(el('span', 'empty-eyebrow', opts.eyebrow));
    t.appendChild(el('span', 'empty-title', opts.title));
    t.appendChild(el('span', 'empty-body', opts.body));
    if (opts.cta) {
      var b = el('a', 'btn btn-primary', opts.cta.label);
      b.href = opts.cta.href; b.style.marginBlockStart = 'auto'; b.style.alignSelf = 'flex-start';
      t.appendChild(b);
    }
    return t;
  }

  function leadFacts(l) {
    var facts = [];
    if (l.case_type) facts.push({ k: 'Case type', v: l.case_type });
    if (l.body_part) facts.push({ k: 'Body part', v: l.body_part });
    if (l.estimated_value != null && Number(l.estimated_value) > 0) {
      facts.push({ k: 'Est. value', v: '$' + Math.round(Number(l.estimated_value)).toLocaleString('en-US') });
    }
    if (facts.length < 3 && l.worker_county) facts.push({ k: 'County', v: l.worker_county });
    if (facts.length < 3 && l.wcb_case_number) facts.push({ k: 'WCB #', v: l.wcb_case_number });
    return facts.slice(0, 3);
  }

  function attorneyGrid(ctx, repaint) {
    var grid = el('div', 'wg');
    var leads = _lead.leads || [];
    var open = leads.filter(function (l) { return l.status === 'assigned'; })
      .sort(function (a, b) { return (msLeft(a) == null ? Infinity : msLeft(a)) - (msLeft(b) == null ? Infinity : msLeft(b)); });
    var contacted = leads.filter(function (l) { return l.status === 'contacted'; });
    var retained = leads.filter(function (l) { return l.status === 'retained'; }).length;
    var expired = leads.filter(function (l) { return l.status === 'expired'; }).length;

    /* the design's "three silences" when there is nothing actionable */
    if (!open.length && !contacted.length) {
      var roster = _lead.roster;
      var enrolled = roster && roster.status === 'active' && roster.accepting_leads;
      if (!roster) {
        grid.appendChild(emptyTile({
          glyph: '—', eyebrow: 'No leads yet', dashed: true,
          title: 'You’re not in the referral network yet.',
          body: 'Comp Buddy routes injured-worker referrals by county, each with a 48-hour clock. Join the round-robin and the first lead lands here.',
          cta: { label: 'Join the network →', href: '/attorneys' }
        }));
      } else if (!enrolled) {
        grid.appendChild(emptyTile({
          glyph: '⊘', eyebrow: 'Intake paused',
          title: 'Lead intake is paused.',
          body: (roster.status !== 'active')
            ? 'Your roster account isn’t active yet. Approved leads will appear here with a 48-hour clock.'
            : 'You’ve paused accepting leads. New referrals resume here when you turn intake back on.'
        }));
      } else {
        grid.appendChild(emptyTile({
          glyph: '✓', eyebrow: 'All clear',
          title: retained ? (retained + ' retained, none aging.') : 'No open leads right now.',
          body: 'You’re enrolled and accepting. New referrals appear here the moment they’re assigned, each with a 48-hour response clock.'
        }));
      }
    } else {
      /* hero = selected lead, else the most urgent open one */
      var pool = open.concat(contacted);
      var hero = null;
      for (var i = 0; i < pool.length; i++) if (pool[i].id === _lead.selectedId) hero = pool[i];
      if (!hero) hero = pool[0];
      var heroMs = msLeft(hero);
      var isOpen = hero.status === 'assigned';

      var t = el('div', 'tile lead-hero' + (isOpen && heroMs != null && heroMs < H48 / 2 ? ' is-urgent' : ''));
      t.setAttribute('data-size', 'hero');
      t.setAttribute('tabindex', '0');

      var ringCol = el('div', 'lead-ring-col');
      var ring = el('div', 'lead-ring');
      var inner = el('div', 'lead-ring-inner');
      var clockEl = el('span', 'lead-ring-clock');
      var capEl = el('span', 'lead-ring-cap', isOpen ? 'of 48 h left' : 'contacted');
      inner.appendChild(clockEl); inner.appendChild(capEl);
      ring.appendChild(inner);
      ringCol.appendChild(ring);
      if (isOpen) ringCol.appendChild(el('span', 'lead-ring-call pulse', 'Call first'));
      t.appendChild(ringCol);

      var main = el('div', 'lead-hero-main');
      main.appendChild(el('span', 'hero-eyebrow',
        'Referred by Comp Buddy' + (hero.created_at ? ' · ' + timeAgo(hero.created_at) : '')));
      main.appendChild(el('span', 'lead-hero-name',
        (hero.worker_name || 'New referral') + (hero.worker_county ? ' · ' + hero.worker_county + ' County' : '')));

      var facts = leadFacts(hero);
      if (facts.length) {
        var fg = el('div', 'lead-facts');
        facts.forEach(function (f) {
          var fx = el('div', 'lead-fact');
          fx.appendChild(el('span', 'k', f.k));
          fx.appendChild(el('span', 'v', f.v));
          fg.appendChild(fx);
        });
        main.appendChild(fg);
      }

      var ctas = el('div', 'hero-ctas');
      if (hero.worker_phone) {
        var call = el('a', 'btn btn-primary', 'Call ' + hero.worker_phone.replace(/^(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3'));
        call.href = 'tel:' + hero.worker_phone;
        ctas.appendChild(call);
      }
      if (isOpen) {
        var acc = el('button', 'btn ' + (hero.worker_phone ? 'btn-ghost' : 'btn-primary'), 'Accept');
        acc.type = 'button'; acc.onclick = function () { respond(hero.id, 'contacted'); };
        ctas.appendChild(acc);
        var dec = el('button', 'btn btn-ghost btn-danger', 'Decline');
        dec.type = 'button';
        dec.onclick = function () {
          try { if (!window.confirm('Decline this lead? It will be released for reassignment.')) return; } catch (e) {}
          respond(hero.id, 'declined');
        };
        ctas.appendChild(dec);
      } else {
        var ret = el('button', 'btn ' + (hero.worker_phone ? 'btn-ghost' : 'btn-primary'), 'Mark retained');
        ret.type = 'button'; ret.onclick = function () { respond(hero.id, 'retained'); };
        ctas.appendChild(ret);
        if (hero.worker_email) {
          var em = el('a', 'btn btn-ghost', 'Email');
          em.href = 'mailto:' + hero.worker_email + '?subject=' + encodeURIComponent('Your Workers’ Compensation claim');
          ctas.appendChild(em);
        }
      }
      main.appendChild(ctas);
      t.appendChild(main);
      if (isOpen) {
        t.setAttribute('data-dashv2-deadline', hero.response_deadline || '');
        t._ringEl = ring; t._clockEl = clockEl;
      } else {
        ring.style.background = 'conic-gradient(var(--v2-success) 0 100%, rgba(255,255,255,.12) 100%)';
        clockEl.textContent = '✓';
        clockEl.style.color = 'var(--v2-success-text, #5BD3A0)';
      }
      grid.appendChild(t);

      /* the open queue — click a row to make it the hero */
      var q = el('div', 'tile is-static queue');
      q.setAttribute('data-size', 'cmp');
      var qh = el('div', 'queue-hd');
      qh.appendChild(el('span', 'k', 'Open queue'));
      qh.appendChild(el('span', 'u', 'time left'));
      q.appendChild(qh);
      var rows = pool.filter(function (l) { return l !== hero; }).slice(0, 6);
      if (rows.length) {
        rows.forEach(function (l) {
          var ms = msLeft(l);
          var r = el('button', 'queue-row'); r.type = 'button';
          var dot = el('span', 'queue-dot');
          dot.style.background = l.status === 'contacted' ? 'var(--v2-success)' : urgencyColor(ms);
          r.appendChild(dot);
          var body = el('div', 'queue-body');
          body.appendChild(el('span', 'queue-name', l.worker_name || 'New referral'));
          body.appendChild(el('span', 'queue-sub', l.worker_county || (l.status === 'contacted' ? 'contacted' : '')));
          r.appendChild(body);
          var left = el('span', 'queue-left', l.status === 'contacted' ? '✓' : fmtClock(ms, false));
          if (l.status === 'assigned') {
            left.setAttribute('data-dashv2-deadline', l.response_deadline || '');
            if (ms != null && ms < 6 * 3600000) left.style.color = 'var(--v2-danger-text, #FF8B7A)';
            else if (ms != null && ms < 24 * 3600000) left.style.color = 'var(--v2-warn-text, #F2C471)';
          } else left.style.color = 'var(--v2-text-dim)';
          r.appendChild(left);
          r.onclick = function () { _lead.selectedId = l.id; repaint(); };
          q.appendChild(r);
        });
      } else {
        q.appendChild(el('span', 'tile-desc', 'No other open leads.'));
      }
      grid.appendChild(q);

      /* stats — every figure derived from the real lead list */
      var total = leads.length;
      var answered = contacted.length + retained;
      [
        { k: 'Answered', v: String(answered), u: 'of ' + total, d: 'Leads with a response logged.' },
        { k: 'Retained', v: String(retained), u: 'signed', d: 'Referrals that became clients.' },
        { k: 'Aged out', v: String(expired), u: 'lost', d: 'Crossed 48 hours with no response logged.' }
      ].forEach(function (s, idx) {
        var st = el('div', 'tile is-static', null);
        st.setAttribute('data-size', 'cmp');
        st.style.setProperty('--i', String(idx + 2));
        st.classList.add('rise');
        st.appendChild(el('span', 'stat-k', s.k));
        var row = el('div', 'stat-row');
        row.appendChild(el('span', 'stat-v', s.v));
        row.appendChild(el('span', 'stat-u', s.u));
        st.appendChild(row);
        st.appendChild(el('span', 'stat-d', s.d));
        grid.appendChild(st);
      });
    }
    return grid;
  }

  function startTick(block) {
    if (_tick) { clearInterval(_tick); _tick = null; }
    var step = reduced() ? 60000 : 1000;
    function update() {
      if (!block.isConnected) { clearInterval(_tick); _tick = null; return; }
      var nodes = block.querySelectorAll('[data-dashv2-deadline]');
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        var dl = n.getAttribute('data-dashv2-deadline');
        var ms = dl ? new Date(dl).getTime() - Date.now() : null;
        if (n._clockEl) {                                   // the hero ring
          n._clockEl.textContent = fmtClock(ms, false);
          var frac = ms == null ? 0 : Math.max(0, Math.min(1, ms / H48));
          n._ringEl.style.setProperty('--ring', (frac * 100).toFixed(2) + '%');
        } else {
          n.textContent = fmtClock(ms, false);
        }
      }
      var head = block.querySelector('[data-dashv2-headclock]');
      if (head) {
        var hd = head.getAttribute('data-dashv2-headclock');
        head.textContent = fmtClock(new Date(hd).getTime() - Date.now(), true) + ' left';
      }
    }
    update();
    _tick = setInterval(update, step);
  }

  function attorneyBlock(ctx) {
    var block = el('section', 'dashv2');
    var uid = (ctx.user && ctx.user.id) || null;

    function paint() {
      block.innerHTML = '';
      var leads = _lead.leads || [];
      var open = leads.filter(function (l) { return l.status === 'assigned'; });
      var aging = open.filter(function (l) { var ms = msLeft(l); return ms != null && ms < 24 * 3600000; });
      var retained = leads.filter(function (l) { return l.status === 'retained'; }).length;

      block.appendChild(headerRow('Leads',
        _lead.phase === 'ready' ? (open.length + ' open · ' + aging.length + ' aging · ' + retained + ' retained') : ''));

      var head = el('span', 'dashv2-greeting');
      if (_lead.phase === 'loading' || _lead.phase === 'idle') {
        head.textContent = 'Checking your leads…';
      } else if (_lead.phase === 'error') {
        head.textContent = 'Couldn’t load your leads.';
      } else if (aging.length) {
        head.textContent = aging.length === 1 ? 'One lead ages out today.' : aging.length + ' leads age out today.';
        var soonest = aging.slice().sort(function (a, b) { return msLeft(a) - msLeft(b); })[0];
        if (soonest && soonest.response_deadline) {
          var c = el('span', 'clock');
          c.setAttribute('data-dashv2-headclock', soonest.response_deadline);
          head.appendChild(document.createTextNode(' '));
          head.appendChild(c);
        }
      } else if (open.length) {
        head.textContent = open.length === 1 ? 'One open lead, not aging.' : open.length + ' open leads, none aging.';
      } else {
        head.textContent = 'Leads';
      }
      block.appendChild(head);

      if (_lead.phase === 'error') {
        var retry = el('button', 'btn btn-ghost', 'Retry');
        retry.type = 'button'; retry.style.alignSelf = 'flex-start';
        retry.onclick = function () { _lead.phase = 'idle'; fetchLeads(uid); };
        block.appendChild(retry);
      } else if (_lead.phase === 'ready') {
        block.appendChild(attorneyGrid(ctx, paintAndTag));
        startTick(block);
      }
    }

    function paintAndTag() {
      paint();
      // the shell re-tags sections for the rail after async repaints
      if (CD.dashShellDecorate) { try { CD.dashShellDecorate(); } catch (e) {} }
    }

    _notify = paintAndTag;
    paint();
    if (_lead.phase === 'idle' || _lead.uid !== uid) fetchLeads(uid);
    return block;
  }

  function pruneAttorney(node) {
    if (!node) return;
    hide(node.querySelector('.cc-hero'));                       // the v2 header replaces it
    var titles = node.querySelectorAll('.cc-card-title');       // the P11 block replaces the leads card
    for (var i = 0; i < titles.length; i++) {
      if (/network leads/i.test(titles[i].textContent || '')) {
        hide(titles[i].closest('.cc-card') || titles[i]);
        break;
      }
    }
  }

  /* ── host entry ─────────────────────────────────────────────────────────── */
  CD.WebDashV2 = {
    wrap: function (vendoredNode, ctx, isWorker) {
      var frag = document.createDocumentFragment();
      var block = isWorker ? workerBlock(ctx) : attorneyBlock(ctx);
      frag.appendChild(block);
      if (vendoredNode) {
        if (isWorker) pruneWorker(vendoredNode); else pruneAttorney(vendoredNode);
        frag.appendChild(vendoredNode);
      }
      return frag;
    }
  };
})(window, document);
