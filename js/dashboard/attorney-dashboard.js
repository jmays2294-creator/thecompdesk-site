/* ============================================================================
 * attorney-dashboard.js — CD.AttorneyDashboard — COMMAND CENTER (2026-06-21)
 * ----------------------------------------------------------------------------
 * Port of the Claude Design "Command Center Web" into the live ATTORNEY
 * dashboard, wired to real data. Navy control-room aesthetic: fixed aurora +
 * grid background, glassy gradient cards, JetBrains Mono numerics, precise
 * motion. The injured-worker dashboard (CD.WorkerDashboard) is UNCHANGED.
 *
 * INTEGRATION CONTRACT (unchanged — FOUNDATION wires to it):
 *   window.CD.AttorneyDashboard.render(ctx) -> DOMNode | null
 *   ctx = { profile, user, tier, supabase, h, card, f$, showScreen,
 *           handleUpgrade, openAttorneyIntake, hasAccess, goToCalc }
 *
 * LIVE DATA (true-state; nothing fabricated):
 *   • Network Leads  → get_my_leads() + own attorney_roster row (migration 049)
 *   • Upcoming sched → get_my_schedule() — hearings/depos/events across the
 *                       attorney's firm_cases (migration 050)
 *   • Review Skills  → published_skills catalog (RLS ps_select=true)
 *   • This Month     → self-entered (localStorage), DEMO-tagged (no real source)
 * Async sections render from module state, fetch once per user via CD.supa,
 * then repaint via CD.render(). All motion gates on prefers-reduced-motion.
 * ==========================================================================*/
(function (window, document) {
  'use strict';
  var CD = window.CD = window.CD || {};

  var LS_KEY = 'cd_atty_metrics_v1';
  var MARKETPLACE_URL = 'https://thecompdesk.com/marketplace';

  var _net   = { phase: 'idle', uid: null, leads: null, roster: null, err: null };
  var _sk    = { phase: 'idle', uid: null, items: null, err: null };
  var _sched = { phase: 'idle', uid: null, items: null, err: null };

  function _client() { return CD.supa || CD.supabase || null; }
  function prefersReducedMotion() {
    try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  }
  function firstName(profile, user) {
    var full = (profile && profile.full_name) || '';
    if (full && full.trim()) return full.trim().split(/\s+/)[0];
    var email = (user && user.email) || '';
    if (email) return email.split('@')[0];
    return 'Counselor';
  }
  function num(v) { var n = parseInt(v, 10); return (isNaN(n) || n < 0) ? 0 : n; }
  function money(v) {
    var n = Number(v); if (!v || isNaN(n)) return null;
    try { return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 }); }
    catch (e) { return '$' + Math.round(n); }
  }

  // ── self-entered metrics (DEMO fallback) ────────────────────────────────
  function loadMetrics() {
    try {
      var raw = window.localStorage.getItem(LS_KEY);
      if (raw) { var p = JSON.parse(raw); if (p && typeof p === 'object') return { leads: num(p.leads), signed: num(p.signed), isDemo: false }; }
    } catch (e) {}
    return { leads: 28, signed: 11, isDemo: true };
  }
  function saveMetrics(m) {
    try { window.localStorage.setItem(LS_KEY, JSON.stringify({ leads: num(m.leads), signed: num(m.signed) })); } catch (e) {}
  }

  // ── data layer (fetch once per user, repaint via CD.render) ─────────────
  function _ensureLeads(uid) {
    if (_net.uid !== uid) _net = { phase: 'idle', uid: uid, leads: null, roster: null, err: null };
    if (_net.phase !== 'idle') return;
    var sb = _client(); if (!sb || !uid) { _net.phase = 'error'; _net.err = 'unavailable'; return; }
    _net.phase = 'loading';
    Promise.all([
      sb.rpc('get_my_leads'),
      sb.from('attorney_roster').select('accepting_leads,lead_credits,service_counties,status,current_month_leads,max_leads_per_month').limit(1).maybeSingle()
    ]).then(function (r) {
      var lr = r[0] || {}, rr = r[1] || {};
      if (lr.error) { _net.phase = 'error'; _net.err = lr.error.message || 'lead fetch failed'; console.error('[atty-dash] LEADS_FETCH_FAILED', lr.error); }
      else { _net.phase = 'ready'; _net.leads = Array.isArray(lr.data) ? lr.data : []; _net.roster = (rr && !rr.error) ? (rr.data || null) : null; }
      if (CD.render) CD.render();
    }).catch(function (e) { _net.phase = 'error'; _net.err = String(e && e.message || e); console.error('[atty-dash] LEADS_FETCH_FAILED', e); if (CD.render) CD.render(); });
  }
  function _ensureSchedule(uid) {
    if (_sched.uid !== uid) _sched = { phase: 'idle', uid: uid, items: null, err: null };
    if (_sched.phase !== 'idle') return;
    var sb = _client(); if (!sb || !uid) { _sched.phase = 'error'; _sched.err = 'unavailable'; return; }
    _sched.phase = 'loading';
    sb.rpc('get_my_schedule').then(function (res) {
      if (res.error) { _sched.phase = 'error'; _sched.err = res.error.message || 'schedule fetch failed'; console.error('[atty-dash] SCHEDULE_FETCH_FAILED', res.error); }
      else { _sched.phase = 'ready'; _sched.items = Array.isArray(res.data) ? res.data : []; }
      if (CD.render) CD.render();
    }, function (e) { _sched.phase = 'error'; _sched.err = String(e && e.message || e); console.error('[atty-dash] SCHEDULE_FETCH_FAILED', e); if (CD.render) CD.render(); });
  }
  function _ensureSkills(uid) {
    if (_sk.uid !== uid) _sk = { phase: 'idle', uid: uid, items: null, err: null };
    if (_sk.phase !== 'idle') return;
    var sb = _client(); if (!sb) { _sk.phase = 'error'; _sk.err = 'unavailable'; return; }
    _sk.phase = 'loading';
    sb.from('published_skills').select('slug,name,skill_md,version,published_at').order('published_at', { ascending: false }).limit(8).then(function (res) {
      if (res.error) { _sk.phase = 'error'; _sk.err = res.error.message || 'skill fetch failed'; console.error('[atty-dash] SKILLS_FETCH_FAILED', res.error); }
      else { _sk.phase = 'ready'; _sk.items = Array.isArray(res.data) ? res.data : []; }
      if (CD.render) CD.render();
    }, function (e) { _sk.phase = 'error'; _sk.err = String(e && e.message || e); console.error('[atty-dash] SKILLS_FETCH_FAILED', e); if (CD.render) CD.render(); });
  }
  function _respond(id, status) {
    var sb = _client(); if (!sb) return;
    sb.rpc('respond_to_lead', { p_referral_id: id, p_new_status: status }).then(function (res) {
      if (res && res.error) { console.error('[atty-dash] RESPOND_FAILED', res.error); try { window.alert('Could not update this lead.\n' + (res.error.message || '')); } catch (e) {} return; }
      _net.phase = 'idle'; if (CD.render) CD.render();
    });
  }

  // ── small formatters ────────────────────────────────────────────────────
  function _clock(deadline) {
    if (!deadline) return null;
    var ms = new Date(deadline).getTime() - Date.now(); if (isNaN(ms)) return null;
    if (ms <= 0) return { text: 'Response overdue', cls: 'is-overdue' };
    var hrs = ms / 3600000;
    if (hrs < 6) return { text: Math.max(1, Math.round(hrs)) + 'h left to respond', cls: 'is-urgent' };
    if (hrs < 24) return { text: Math.round(hrs) + 'h left to respond', cls: 'is-urgent' };
    return { text: Math.round(hrs / 24) + 'd left to respond', cls: '' };
  }
  function _timeAgo(ts) {
    if (!ts) return '';
    var ms = Date.now() - new Date(ts).getTime(); if (isNaN(ms) || ms < 0) return '';
    var h = ms / 3600000;
    if (h < 1) return Math.max(1, Math.round(ms / 60000)) + 'm ago';
    if (h < 24) return Math.round(h) + 'h ago';
    var d = Math.round(h / 24); return d === 1 ? 'Yesterday' : d + ' days ago';
  }
  function _leadStatus(s) {
    switch (s) {
      case 'assigned':  return { label: 'New', cls: 'is-new', dot: '' };
      case 'contacted': return { label: 'Contacted', cls: 'is-good', dot: 'is-good' };
      case 'retained':  return { label: 'Retained', cls: 'is-good', dot: 'is-good' };
      case 'declined':  return { label: 'Declined', cls: 'is-bad', dot: 'is-muted' };
      case 'expired':   return { label: 'Expired', cls: 'is-bad', dot: 'is-muted' };
      default:          return { label: (s || 'pending'), cls: '', dot: 'is-muted' };
    }
  }
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  function _dayDiff(dstr) {
    var d = new Date(dstr + 'T00:00:00'); if (isNaN(d.getTime())) return null;
    var t = new Date(); t.setHours(0, 0, 0, 0);
    return Math.round((d.getTime() - t.getTime()) / 86400000);
  }
  function _dayLabel(dstr, diff) {
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    var d = new Date(dstr + 'T00:00:00');
    return DAYS[d.getDay()] + ' ' + MONTHS[d.getMonth()] + ' ' + d.getDate();
  }
  function _countdown(diff) {
    if (diff <= 0) return { text: 'Today', cls: 'is-soon' };
    if (diff === 1) return { text: 'Tomorrow', cls: 'is-soon' };
    if (diff <= 7) return { text: 'in ' + diff + ' days', cls: '' };
    return { text: 'in ' + diff + ' days', cls: 'is-far' };
  }
  function _skillExcerpt(md) {
    if (!md) return '';
    var lines = String(md).split('\n'), i = 0;
    if (lines[0] && lines[0].trim() === '---') { i = 1; while (i < lines.length && lines[i].trim() !== '---') i++; i++; }
    for (; i < lines.length; i++) { var t = lines[i].trim(); if (!t || t.charAt(0) === '#') continue; return t.replace(/[*_`>#\[\]]/g, '').slice(0, 110); }
    return '';
  }
  function _isNew(p) { if (!p) return false; var ms = Date.now() - new Date(p).getTime(); return !isNaN(ms) && ms >= 0 && ms < 14 * 24 * 3600 * 1000; }

  // ── card chrome ─────────────────────────────────────────────────────────
  function _card(ctx, opts, body) {
    var h = ctx.h;
    var sec = h('section', { className: 'cc-card cc-rise', style: opts.delay ? { '--d': opts.delay } : null });
    if (opts.line) sec.appendChild(h('div', { className: 'cc-card-line', 'aria-hidden': 'true' }));
    if (opts.title) {
      var hd = h('div', { className: 'cc-card-hd' });
      hd.appendChild(h('h2', { className: 'cc-card-title' }, opts.title));
      if (opts.count != null) hd.appendChild(h('span', { className: 'cc-count' }, String(opts.count)));
      if (opts.meta) hd.appendChild(h('span', { className: 'cc-card-meta' }, opts.meta));
      if (opts.demo) hd.appendChild(h('span', { className: 'cc-demo' }, 'DEMO'));
      if (opts.action) hd.appendChild(h('button', { className: 'cc-card-action', onclick: opts.action.onClick }, opts.action.label));
      sec.appendChild(hd);
    }
    if (Array.isArray(body)) body.forEach(function (n) { if (n) sec.appendChild(n); });
    else if (body) sec.appendChild(body);
    return sec;
  }

  // ── ring gauge (command-center style) ───────────────────────────────────
  function makeRing(opts) {
    var h = ctx0.h, R = 46, C = 2 * Math.PI * R;
    var frac = Math.max(0, Math.min(1, (opts.value || 0) / Math.max(1, opts.max || 1)));
    var ns = 'http://www.w3.org/2000/svg';
    function el(t, a) { var n = document.createElementNS(ns, t); Object.keys(a).forEach(function (k) { n.setAttribute(k, a[k]); }); return n; }
    var svg = el('svg', { width: 124, height: 124, viewBox: '0 0 120 120' });
    svg.appendChild(el('circle', { cx: 60, cy: 60, r: R, fill: 'none', stroke: 'var(--cc-border2)', 'stroke-width': 8 }));
    var fill = el('circle', { cx: 60, cy: 60, r: R, fill: 'none', stroke: 'var(--cc-accent)', 'stroke-width': 8, 'stroke-linecap': 'round', 'stroke-dasharray': C, 'stroke-dashoffset': C, class: 'cc-gauge-fill' });
    svg.appendChild(fill);
    var ring = h('div', { className: 'cc-gauge-ring' });
    ring.appendChild(svg);
    var valEl = h('div', { className: 'cc-gauge-val' }, '0');
    ring.appendChild(valEl);
    var node = h('div', { className: 'cc-gauge' }, [
      ring,
      h('div', { className: 'cc-gauge-cap' }, [h('div', { className: 'l1' }, opts.label), h('div', { className: 'l2' }, opts.sub || '')])
    ]);
    var done = false;
    function animate() {
      if (done) return; done = true;
      var target = C * (1 - frac), tv = opts.value || 0;
      if (prefersReducedMotion()) { fill.style.transition = 'none'; fill.setAttribute('stroke-dashoffset', target); valEl.textContent = String(tv); return; }
      var DUR = 900, t0 = null, settled = false;
      function settle() { if (settled) return; settled = true; valEl.textContent = String(tv); fill.setAttribute('stroke-dashoffset', target); }
      function step(ts) { if (settled) return; if (t0 === null) t0 = ts; var p = Math.min(1, (ts - t0) / DUR); valEl.textContent = String(Math.round(tv * (1 - Math.pow(1 - p, 3)))); if (p < 1) window.requestAnimationFrame(step); else settle(); }
      window.requestAnimationFrame(function () { fill.setAttribute('stroke-dashoffset', target); window.requestAnimationFrame(step); });
      window.setTimeout(settle, DUR + 140);
    }
    return { node: node, animate: animate };
  }
  var ctx0 = null;  // captured per render for makeRing's h()

  // ── SECTION: Upcoming schedule ──────────────────────────────────────────
  function renderSchedule(ctx) {
    var h = ctx.h;
    var body = [];
    if (_sched.phase === 'loading' || _sched.phase === 'idle') {
      body.push(h('div', { className: 'cc-skel' })); body.push(h('div', { className: 'cc-skel' }));
      return _card(ctx, { title: 'Upcoming', line: true, meta: 'firm cases', delay: '.04s' }, body);
    }
    if (_sched.phase === 'error') {
      body.push(h('div', { className: 'cc-empty' }, [
        h('div', { className: 'cc-empty-ico' }, '⚠️'),
        h('div', { className: 'cc-empty-title' }, 'Couldn’t load your schedule'),
        h('button', { className: 'cc-retry', onclick: function () { _sched.phase = 'idle'; if (CD.render) CD.render(); } }, 'Retry')
      ]));
      return _card(ctx, { title: 'Upcoming', line: true, delay: '.04s' }, body);
    }
    var items = (_sched.items || []).map(function (it) { var diff = _dayDiff(it.event_date); return { it: it, diff: (diff == null ? 999 : diff) }; });
    if (!items.length) {
      body.push(h('div', { className: 'cc-empty' }, [
        h('div', { className: 'cc-empty-ico' }, '🗓️'),
        h('div', { className: 'cc-empty-title' }, 'No upcoming events'),
        h('div', { className: 'cc-empty-sub' }, 'Hearings, depositions, and deadlines across your firm cases will appear here as they’re scheduled.')
      ]));
      return _card(ctx, { title: 'Upcoming', line: true, meta: 'firm cases', delay: '.04s' }, body);
    }
    var groups = [
      { lbl: 'Today', test: function (d) { return d <= 0; } },
      { lbl: 'This Week', test: function (d) { return d >= 1 && d <= 7; } },
      { lbl: 'Later', test: function (d) { return d > 7; } }
    ];
    var sched = h('div', { className: 'cc-sched' });
    groups.forEach(function (g) {
      var rows = items.filter(function (x) { return g.test(x.diff); });
      if (!rows.length) return;
      var grp = h('div');
      grp.appendChild(h('div', { className: 'cc-sched-grp-hd' }, [
        h('span', { className: 'cc-sched-grp-lbl' }, g.lbl),
        h('span', { className: 'cc-sched-grp-rule' }),
        h('span', { className: 'cc-sched-grp-n' }, String(rows.length))
      ]));
      var list = h('div', { className: 'cc-sched-items' });
      rows.forEach(function (x) { list.appendChild(_evt(ctx, x.it, x.diff)); });
      grp.appendChild(list);
      sched.appendChild(grp);
    });
    return _card(ctx, { title: 'Upcoming', line: true, count: items.length, meta: 'firm cases', delay: '.04s' }, sched);
  }
  function _evt(ctx, it, diff) {
    var h = ctx.h;
    var kind = it.kind || 'event';
    var typeCls = kind === 'hearing' ? 'is-hearing' : (kind === 'event' && /deadline/i.test(it.event_type || '') ? 'is-deadline' : '');
    var typeLabel = kind === 'hearing' ? 'Hearing' : kind === 'deposition' ? 'Depo' : (it.event_type || 'Event');
    var cd = _countdown(diff);
    var time = it.event_time || (kind === 'event' ? 'Due' : 'All day');
    var sub = [it.wcb_case_number ? 'WCB# ' + it.wcb_case_number : null, it.detail].filter(Boolean).join(' · ');
    var urgent = (diff <= 0);

    var wrap = h('div', { className: 'cc-evt', 'data-open': 'false' });
    var line1 = h('div', { className: 'cc-evt-line1' }, [
      h('span', { className: 'cc-type ' + typeCls }, typeLabel),
      h('span', { className: 'cc-evt-party' }, it.party || 'Case'),
      urgent ? h('span', { className: 'cc-dot cc-pulse', 'aria-hidden': 'true' }) : null
    ]);
    var btn = h('button', {
      className: 'cc-evt-btn', 'aria-expanded': 'false',
      onclick: function () { var open = wrap.getAttribute('data-open') === 'true'; wrap.setAttribute('data-open', open ? 'false' : 'true'); btn.setAttribute('aria-expanded', open ? 'false' : 'true'); }
    }, [
      h('div', { className: 'cc-evt-when' }, [
        h('span', { className: 'cc-evt-time' }, time),
        h('span', { className: 'cc-evt-day' }, _dayLabel(it.event_date, diff))
      ]),
      h('div', { className: 'cc-evt-body' }, [line1, sub ? h('span', { className: 'cc-evt-sub' }, sub) : null]),
      h('div', { className: 'cc-evt-end' }, [
        h('span', { className: 'cc-when ' + cd.cls }, cd.text),
        h('span', { className: 'cc-evt-chev', 'aria-hidden': 'true' }, '›')
      ])
    ]);
    wrap.appendChild(btn);
    var panel = h('div', { className: 'cc-evt-panel' });
    function kv(k, v) { if (!v) return; panel.appendChild(h('div', { className: 'cc-kv' }, [h('b', null, k), h('span', null, v)])); }
    kv('Date', _dayLabel(it.event_date, diff) + (it.event_time ? ' · ' + it.event_time : ''));
    kv('Type', typeLabel);
    if (it.wcb_case_number) kv('WCB #', it.wcb_case_number);
    if (it.detail) kv('Detail', it.detail);
    if (it.status) kv('Status', it.status);
    if (it.is_virtual) kv('Format', 'Virtual' + (it.platform ? ' · ' + it.platform : ''));
    panel.appendChild(h('button', { className: 'cc-evt-open', onclick: function () { ctx.showScreen && ctx.showScreen('firm_admin'); } }, 'Open case →'));
    wrap.appendChild(panel);
    return wrap;
  }

  // ── SECTION: Network Leads ──────────────────────────────────────────────
  function renderLeads(ctx) {
    var h = ctx.h;
    if (_net.phase === 'loading' || _net.phase === 'idle')
      return _card(ctx, { title: 'Network Leads', delay: '.22s' }, [h('div', { className: 'cc-skel' }), h('div', { className: 'cc-skel' })]);
    if (_net.phase === 'error')
      return _card(ctx, { title: 'Network Leads', delay: '.22s' }, h('div', { className: 'cc-empty' }, [
        h('div', { className: 'cc-empty-ico' }, '⚠️'),
        h('div', { className: 'cc-empty-title' }, 'Couldn’t load your leads'),
        h('button', { className: 'cc-retry', onclick: function () { _net.phase = 'idle'; if (CD.render) CD.render(); } }, 'Retry')
      ]));

    var leads = _net.leads || [], roster = _net.roster;
    if (!leads.length) {
      var enrolled = roster && roster.status === 'active' && roster.accepting_leads, ico, title, sub, cta = null;
      if (!roster) { ico = '🤝'; title = 'Not in the referral network yet'; sub = 'Join The Comp Desk’s county round-robin to start receiving injured-worker leads here.'; cta = { label: 'Join the network', onClick: function () { try { window.open('https://thecompdesk.com/attorneys', '_blank'); } catch (e) {} } }; }
      else if (!enrolled) { ico = '⏸️'; title = 'Lead intake paused'; sub = (roster.status !== 'active') ? 'Your roster account isn’t active yet. Approved leads will appear here with a 48-hour clock.' : 'You’ve paused accepting leads. New referrals resume here when you turn intake back on.'; }
      else { ico = '📭'; title = 'No leads right now'; sub = 'You’re enrolled and accepting leads. New referrals appear here the moment they’re assigned, each with a 48-hour response clock.'; }
      var empty = h('div', { className: 'cc-empty' }, [h('div', { className: 'cc-empty-ico' }, ico), h('div', { className: 'cc-empty-title' }, title), h('div', { className: 'cc-empty-sub' }, sub)]);
      if (cta) empty.appendChild(h('button', { className: 'cc-retry', onclick: cta.onClick }, cta.label));
      return _card(ctx, { title: 'Network Leads', delay: '.22s' }, empty);
    }
    var list = h('div', { className: 'cc-leads' });
    leads.forEach(function (l) { list.appendChild(_leadRow(ctx, l)); });
    var live = leads.filter(function (l) { return l.status === 'assigned'; }).length;
    return _card(ctx, { title: 'Network Leads', count: live || leads.length, delay: '.22s' }, list);
  }
  function _leadRow(ctx, l) {
    var h = ctx.h, sm = _leadStatus(l.status);
    var wrap = h('div', { className: 'cc-lead', 'data-open': 'false' });
    var metaBits = [l.worker_county, _timeAgo(l.created_at)].filter(Boolean).join(' · ');
    var row = h('button', { className: 'cc-lead-row', 'aria-expanded': 'false',
      onclick: function () { var o = wrap.getAttribute('data-open') === 'true'; wrap.setAttribute('data-open', o ? 'false' : 'true'); } }, [
      h('span', { className: 'cc-lead-dot ' + sm.dot, 'aria-hidden': 'true' }),
      h('div', { className: 'cc-lead-body' }, [
        h('div', { className: 'cc-lead-name' }, l.worker_name || (l.worker_county ? l.worker_county + ' County' : 'New referral')),
        metaBits ? h('div', { className: 'cc-lead-meta' }, metaBits) : null
      ]),
      h('span', { className: 'cc-lead-status ' + sm.cls }, sm.label)
    ]);
    wrap.appendChild(row);
    var panel = h('div', { className: 'cc-lead-panel' });
    if (l.status === 'assigned') { var clk = _clock(l.response_deadline); if (clk) panel.appendChild(h('div', { className: 'cc-lead-clock ' + clk.cls }, '⏱ ' + clk.text)); }
    function kv(k, v) { if (!v) return; panel.appendChild(h('div', { className: 'cc-lead-kv' }, [h('span', null, k), h('span', null, v)])); }
    kv('County', l.worker_county); kv('Case type', l.case_type); kv('Body part', l.body_part);
    kv('Est. value', money(l.estimated_value)); kv('WCB #', l.wcb_case_number);
    if (l.status === 'assigned' || l.status === 'contacted') {
      var acts = h('div', { className: 'cc-lead-actions' });
      if (l.worker_phone) acts.appendChild(h('a', { className: 'cc-btn', href: 'tel:' + l.worker_phone }, '📞 Call'));
      if (l.worker_email) acts.appendChild(h('a', { className: 'cc-btn', href: 'mailto:' + l.worker_email + '?subject=' + encodeURIComponent('Your Workers’ Compensation claim') }, '✉️ Email'));
      if (l.status === 'assigned') {
        acts.appendChild(h('button', { className: 'cc-btn is-primary', onclick: function () { _respond(l.id, 'contacted'); } }, 'Accept'));
        acts.appendChild(h('button', { className: 'cc-btn is-danger', onclick: function () { try { if (!window.confirm('Decline this lead? It will be released for reassignment.')) return; } catch (e) {} _respond(l.id, 'declined'); } }, 'Decline'));
      } else acts.appendChild(h('button', { className: 'cc-btn is-primary', onclick: function () { _respond(l.id, 'retained'); } }, 'Mark retained'));
      panel.appendChild(acts);
    }
    wrap.appendChild(panel);
    return wrap;
  }

  // ── SECTION: This Month gauges ──────────────────────────────────────────
  function renderMonth(ctx, rings) {
    var h = ctx.h, m = loadMetrics();
    var conv = m.leads > 0 ? Math.round((m.signed / m.leads) * 100) : 0;
    var leadsMax = Math.max(20, Math.ceil((m.leads + 1) / 10) * 10);
    var g1 = makeRing({ value: m.leads, max: leadsMax, label: 'Leads received', sub: 'leads' });
    var g2 = makeRing({ value: m.signed, max: Math.max(leadsMax, m.leads || 1), label: 'Signed', sub: 'signed' });
    rings.push(g1, g2);
    var editor = h('div', { className: 'cc-metric-edit' });
    [['Leads', 'leads'], ['Signed', 'signed']].forEach(function (f) {
      editor.appendChild(h('label', { className: 'cc-metric-field' }, [
        h('span', null, f[0] + ' this month'),
        h('input', { type: 'number', min: '0', inputMode: 'numeric', value: String(m[f[1]]), 'aria-label': f[0],
          onchange: function () { m[f[1]] = num(this.value); m.isDemo = false; saveMetrics(m); if (CD.render) CD.render(); } })
      ]));
    });
    return _card(ctx, { title: 'This Month', demo: m.isDemo, delay: '.1s' }, [
      h('div', { className: 'cc-gauges' }, [g1.node, g2.node]),
      h('div', { className: 'cc-conv' }, [h('b', null, conv + '%'), h('span', null, 'Conversion')]),
      editor
    ]);
  }

  // ── SECTION: Quick Calc ─────────────────────────────────────────────────
  function renderQuickCalc(ctx) {
    var h = ctx.h, goToCalc = ctx.goToCalc, showScreen = ctx.showScreen;
    var items = [
      { tag: 'CCP', name: 'Counsel fee on award', desc: 'Fee from a board-awarded amount', go: function () { if (CD.S) CD.S.sub = 'ccp'; goToCalc('fee'); } },
      { tag: 'SLU', name: 'Schedule loss of use', desc: 'Value an SLU award by body part', go: function () { if (CD.S) CD.S.sub = 'slu'; goToCalc('fee'); } },
      { tag: 'LWEC', name: 'Loss of wage-earning cap.', desc: 'Project LWEC benefit duration', go: function () { if (CD.S) CD.S.sub = 'lwec'; goToCalc('fee'); } },
      { tag: 'AWW', name: 'Average weekly wage', desc: 'Compute AWW from prior earnings', go: function () { goToCalc('aww'); } }
    ];
    var grid = h('div', { className: 'cc-calc' });
    items.forEach(function (q) {
      grid.appendChild(h('button', { className: 'cc-calc-btn', onclick: q.go }, [
        h('div', { className: 'cc-calc-top' }, [h('span', { className: 'cc-calc-tag' }, q.tag), h('span', { className: 'cc-calc-arrow', 'aria-hidden': 'true' }, '›')]),
        h('span', { className: 'cc-calc-name' }, q.name),
        h('span', { className: 'cc-calc-desc' }, q.desc)
      ]));
    });
    return _card(ctx, { title: 'Quick Calc', delay: '.16s' }, grid);
  }

  // ── SECTION: Tools ──────────────────────────────────────────────────────
  function renderTools(ctx) {
    var h = ctx.h, hasAccess = ctx.hasAccess, showScreen = ctx.showScreen, handleUpgrade = ctx.handleUpgrade, goToCalc = ctx.goToCalc;
    var features = [
      { icon: '🗂️', title: 'Pro Workspace', desc: 'AWW, CCP, SLU, LWEC & fee tools', tier: 'pro', screen: 'calculator' },
      { icon: '🧾', title: 'OC-400.1 Fee App', desc: 'Generate the counsel fee application', tier: 'pro', go: function () { if (CD.S) CD.S.sub = 'ccp'; goToCalc('fee'); } },
      { icon: '📝', title: 'C-3 / C-3.3 Generator', desc: 'Guided claim-filing forms', tier: 'pro', screen: 'c3' },
      { icon: '⚖️', title: 'Settlement Comparison', desc: 'Compare settlement values', tier: 'comp_buddy', screen: 'settlement' },
      { icon: '📚', title: 'Learning Portal', desc: 'WC glossary, FAQ, timeline', tier: 'free', screen: 'learning' },
      { icon: '🏥', title: 'Find a Doctor', desc: 'WCB-authorized doctors', tier: 'free', screen: 'doctor' },
      { icon: '🔔', title: 'IME Reminders', desc: 'Never miss an IME', tier: 'comp_buddy', screen: 'ime' },
      { icon: '🛠️', title: 'Injury Tools', desc: 'SLU estimator, radiculopathy', tier: 'comp_buddy', screen: 'advanced_tools' },
      { icon: '📋', title: 'UTDM Monitoring', desc: 'Track medical updates', tier: 'comp_buddy', soon: true },
      { icon: '🎯', title: 'Client Work Search', desc: 'C-258.1 logs + LMA packets', tier: 'firm', screen: 'firm_job_buddy' }
    ];
    var grid = h('div', { className: 'cc-tools' });
    features.forEach(function (f) {
      var locked = !f.soon && !hasAccess(f.tier);
      var tier = ({ free: 'Free', comp_buddy: 'Comp Buddy', pro: 'Pro', firm: 'Firm' })[f.tier] || 'Pro';
      var card = h('div', { className: 'cc-tool' + (locked ? ' is-locked' : '') + (!f.soon && (f.go || f.screen) ? ' is-clickable' : '') });
      if (f.soon) card.appendChild(h('span', { className: 'cc-tool-flag is-soon' }, 'Soon'));
      else if (locked) card.appendChild(h('span', { className: 'cc-tool-flag', 'aria-hidden': 'true' }, '🔒'));
      card.appendChild(h('div', { className: 'cc-tool-ico', 'aria-hidden': 'true' }, f.icon));
      card.appendChild(h('div', { className: 'cc-tool-title' }, f.title));
      card.appendChild(h('div', { className: 'cc-tool-desc' }, f.desc));
      card.appendChild(h('div', { className: 'cc-tool-foot' }, h('span', { className: 'cc-tool-tier' + (f.tier === 'free' ? ' is-free' : '') }, tier)));
      if (!f.soon && !locked && (f.go || f.screen)) card.onclick = f.go ? f.go : function () { showScreen(f.screen); };
      else if (locked) card.onclick = function () { handleUpgrade && handleUpgrade(f.tier === 'firm' ? 'firm' : (f.tier === 'comp_buddy' ? 'comp_buddy' : 'pro')); };
      grid.appendChild(card);
    });
    return _card(ctx, { title: 'Tools', delay: '.28s' }, grid);
  }

  // ── SECTION: Review New Skills ──────────────────────────────────────────
  function renderSkills(ctx) {
    var h = ctx.h;
    var openMkt = function () { try { window.open(MARKETPLACE_URL, '_blank'); } catch (e) { window.location.href = '/marketplace'; } };
    if (_sk.phase === 'loading' || _sk.phase === 'idle')
      return _card(ctx, { title: 'Review New Skills', delay: '.34s', action: { label: 'Marketplace →', onClick: openMkt } }, h('div', { className: 'cc-skills' }, [h('div', { className: 'cc-skill cc-skel' }), h('div', { className: 'cc-skill cc-skel' })]));
    if (_sk.phase === 'error')
      return _card(ctx, { title: 'Review New Skills', delay: '.34s' }, h('div', { className: 'cc-empty' }, [
        h('div', { className: 'cc-empty-title' }, 'Couldn’t load the skills catalog'),
        h('button', { className: 'cc-retry', onclick: function () { _sk.phase = 'idle'; if (CD.render) CD.render(); } }, 'Retry')
      ]));
    var items = _sk.items || [];
    if (!items.length)
      return _card(ctx, { title: 'Review New Skills', delay: '.34s', action: { label: 'Marketplace →', onClick: openMkt } }, h('div', { className: 'cc-empty' }, [
        h('div', { className: 'cc-empty-ico' }, '✨'),
        h('div', { className: 'cc-empty-title' }, 'No published skills yet'),
        h('div', { className: 'cc-empty-sub' }, 'The Comp Desk skills marketplace is being built. New attorney skills will show up here with a “New” badge.'),
        h('button', { className: 'cc-retry', onclick: openMkt }, 'Explore the marketplace')
      ]));
    var grid = h('div', { className: 'cc-skills' });
    items.forEach(function (s) {
      var card = h('div', { className: 'cc-skill', onclick: function () { try { window.open(MARKETPLACE_URL + '/' + encodeURIComponent(s.slug || ''), '_blank'); } catch (e) { window.location.href = '/marketplace'; } } });
      var hd = h('div', { className: 'cc-skill-hd' }, [h('div', { className: 'cc-skill-name' }, s.name || s.slug || 'Skill')]);
      if (_isNew(s.published_at)) hd.appendChild(h('span', { className: 'cc-skill-new' }, 'New'));
      card.appendChild(hd);
      var ex = _skillExcerpt(s.skill_md); if (ex) card.appendChild(h('div', { className: 'cc-skill-desc' }, ex));
      card.appendChild(h('div', { className: 'cc-skill-foot' }, [h('span', { className: 'cc-skill-ver' }, 'v' + (s.version || 1)), h('span', { className: 'cc-skill-cta' }, 'View →')]));
      grid.appendChild(card);
    });
    return _card(ctx, { title: 'Review New Skills', delay: '.34s', action: { label: 'Marketplace →', onClick: openMkt } }, grid);
  }

  CD.AttorneyDashboard = {
    render: function (ctx) {
      if (CD.isWorker && CD.isWorker()) return null;     // attorney only
      if (ctx.supabase && !CD.supa && !CD.supabase) CD.supa = ctx.supabase;
      ctx0 = ctx;
      var h = ctx.h, tier = ctx.tier;
      var uid = (ctx.user && ctx.user.id) || null;
      _ensureLeads(uid); _ensureSchedule(uid); _ensureSkills(uid);

      var cont = h('div', { className: 'dash-container atty-dash atty-cc' });

      // fixed aurora + grid background
      cont.appendChild(h('div', { className: 'cc-bg', 'aria-hidden': 'true' }, [
        h('div', { className: 'cc-aurora' }), h('div', { className: 'cc-gridlines' })
      ]));

      var main = h('div', { className: 'cc-main' });

      // hero
      var badges = h('div', { className: 'cc-badges' }, [h('span', { className: 'cc-badge' }, 'ATTORNEY')]);
      if (tier === 'firm') badges.appendChild(h('span', { className: 'cc-badge is-accent' }, 'FIRM'));
      else if (tier === 'pro') badges.appendChild(h('span', { className: 'cc-badge is-accent' }, 'PRO'));
      main.appendChild(h('div', { className: 'cc-hero' }, [
        h('div', { className: 'cc-eyebrow' }, 'Pro Workspace'),
        h('div', { className: 'cc-hero-row' }, [
          h('h1', { className: 'cc-title' }, ['Welcome back, ', h('b', null, firstName(ctx.profile, ctx.user))]),
          badges
        ])
      ]));

      var rings = [];

      // two-column grid
      var left = h('div', { className: 'cc-col' }, [
        renderSchedule(ctx),
        _card(ctx, { title: 'Network co-counsel cases', delay: '.3s' },
          h('p', { className: 'cc-coc-sub' }, 'No network co-counsel cases yet. Cases you take on jointly through The Comp Desk will appear here once that program is live.'))
      ]);
      var right = h('div', { className: 'cc-col' }, [renderMonth(ctx, rings), renderQuickCalc(ctx), renderLeads(ctx)]);
      main.appendChild(h('div', { className: 'cc-grid' }, [left, right]));

      // free-tier upgrade
      if (tier === 'free') {
        main.appendChild(h('div', { className: 'cc-upgrade cc-rise', style: { '--d': '.26s' } }, [
          h('h3', null, 'Unlock the Pro Workspace'),
          h('p', null, 'Network leads, the OC-400.1 fee app, SLU & non-schedule tools, and more.'),
          h('button', { className: 'cc-upgrade-btn', onclick: function () { ctx.handleUpgrade && ctx.handleUpgrade('pro'); } }, 'Upgrade to Pro — $9.99/mo')
        ]));
      }

      // full-width stacks: tools + skills
      main.appendChild(h('div', { className: 'cc-stack' }, [renderTools(ctx), renderSkills(ctx)]));

      // firm management
      if (tier === 'firm') {
        main.appendChild(h('div', { className: 'cc-stack' }, _card(ctx, { title: 'Firm Management', delay: '.36s' },
          h('button', { className: 'cc-evt-open', onclick: function () { ctx.showScreen('firm_admin'); } }, '🏢 Manage firm — invite attorneys, manage seats →'))));
      }

      main.appendChild(h('p', { className: 'cc-disclaimer' }, 'Estimates and figures are informational only and do not constitute legal advice.'));
      cont.appendChild(main);

      // sweep gauges once mounted
      window.requestAnimationFrame(function () { rings.forEach(function (g) { g.animate(); }); });
      window.setTimeout(function () { rings.forEach(function (g) { g.animate(); }); }, 90);

      return cont;
    }
  };
})(window, document);
