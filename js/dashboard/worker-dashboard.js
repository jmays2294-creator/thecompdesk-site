/* ============================================================================
 * worker-dashboard.js — CD.WorkerDashboard (injured-worker home)
 * ----------------------------------------------------------------------------
 * OWNER: Worker dashboard agent. See ops/dev/APP_REDESIGN_SPEC.md §6.
 * Also owns: www/css/dashboard-worker.css and js/recovery/mini.js.
 *
 * CONTRACT (FOUNDATION wires to this — do not change the signature):
 *   window.CD.WorkerDashboard.render(ctx) -> DOMNode | null
 *     Returns the .dash-container node to take over rendering, or null to fall
 *     through to ui-controller's legacy fallback.
 *   ctx = { profile, user, tier, h, card, f$, showScreen, handleUpgrade,
 *           openAttorneyIntake, hasAccess, goToCalc }
 *
 * Renders on the WORKER (light/warm) skin. Sections top→bottom (spec §6):
 *   1. Hero greeting          5. Appointments summary
 *   2. Road-to-Recovery mini  6. Free tools + Comp Buddy grids, attorney CTA,
 *   3. Benefit tracker           upgrade banner
 *   4. Disability gauge (tied to the benefit tracker)
 *
 * DATA POLICY: self-entered + demo fallback. Real values persist to existing
 * profile columns (current_aww) where they exist; new values (disability %,
 * self-entered weekly payment, next payment date) use localStorage keyed per
 * user. TODO(migration): add `disability_pct`, `next_payment_date`,
 * `self_weekly_benefit` columns to `profiles` so these sync across devices.
 *
 * Every animation gates on prefers-reduced-motion (CSS on --rhythm-* + a JS
 * guard). Gauges/money re-animate each time the dashboard is rendered.
 * ==========================================================================*/
(function (window) {
  'use strict';
  var CD = window.CD = window.CD || {};
  var document = window.document;

  var DISCLAIMER = 'This tool is for informational purposes only and does not constitute legal advice.';
  var LS_PREFIX = 'cd_worker_dash_v1::';

  // ── local-state helpers (self-entered values not yet in the DB) ───────────
  function _lsKey() {
    return LS_PREFIX + ((CD.currentUser && CD.currentUser.id) || 'anon');
  }
  function _readLocal() {
    try { return JSON.parse(window.localStorage.getItem(_lsKey()) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function _writeLocal(patch) {
    try {
      var cur = _readLocal();
      Object.keys(patch || {}).forEach(function (k) { cur[k] = patch[k]; });
      window.localStorage.setItem(_lsKey(), JSON.stringify(cur));
      return cur;
    } catch (e) { return _readLocal(); }
  }

  function _reduced() {
    try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  }

  function _firstName(profile, user) {
    var full = (profile && profile.full_name) || '';
    full = String(full).trim();
    if (full) return full.split(/\s+/)[0];
    var email = (user && user.email) || (profile && profile.email) || '';
    if (email) return String(email).split('@')[0];
    return 'there';
  }

  // 2/3 weekly rate capped at the statutory max for the period. Uses the live
  // calc data (CD.getMax / CD.MAX_RATES) when reachable; falls back to a plain
  // 2/3 if not. NOTE: current_aww may be a STRING — Number() before any math.
  function _cap() {
    try {
      var today = new Date().toISOString().slice(0, 10);
      if (CD.getMax) { var r = CD.getMax(today); if (r && r.max) return r.max; }
      if (CD.MAX_RATES && CD.MAX_RATES[0]) return CD.MAX_RATES[0].max;
    } catch (e) {}
    return 1281.50; // sane fallback = current-period max
  }
  function _weeklyRate(aww) {
    var n = Number(aww);                       // coerce string AWW (bug fix)
    if (!isFinite(n) || n <= 0) return 0;
    return Math.min((n * 2) / 3, _cap());
  }

  // ── public entry ──────────────────────────────────────────────────────────
  function render(ctx) {
    ctx = ctx || {};
    var h = ctx.h, card = ctx.card, f$ = ctx.f$;
    if (!h) return null; // need the DOM helper to build anything

    var profile = ctx.profile || CD.currentProfile || {};
    var user = ctx.user || CD.currentUser || null;
    var tier = ctx.tier || CD.currentTier || 'free';
    var showScreen = ctx.showScreen || CD.showScreen || function () {};
    var hasAccess = ctx.hasAccess || CD.hasAccess || function () { return false; };
    var handleUpgrade = ctx.handleUpgrade || CD.handleUpgrade || function () {};
    var openAttorneyIntake = ctx.openAttorneyIntake || CD.openAttorneyIntake || function () {};
    var local = _readLocal();
    var reduced = _reduced();

    var cont = h('div', { className: 'dash-container worker-dash' });

    // ── 1. HERO GREETING ──────────────────────────────────────────────────
    var hero = h('section', { className: 'wd-hero' }, [
      h('div', { className: 'wd-hero-eyebrow' }, 'Comp Buddy · The Comp Desk'),
      h('h1', { className: 'wd-hero-title' }, [
        'Welcome back, ',
        h('span', { className: 'wd-hero-name' }, _firstName(profile, user))
      ]),
      h('div', { className: 'wd-hero-sub' }, [
        h('span', { className: 'wd-badge worker-badge' }, '👷 Injured Worker'),
        h('span', { className: 'wd-hero-tagline' }, 'Here’s where your case stands today.')
      ])
    ]);
    cont.appendChild(hero);

    // ── 2. ROAD-TO-RECOVERY MINI-MAP ──────────────────────────────────────
    var recWrap = h('section', { className: 'wd-section wd-recovery' });
    var recMount = h('div', { className: 'wd-recovery-mount' });
    recWrap.appendChild(recMount);
    cont.appendChild(recWrap);
    try {
      if (CD.Recovery && typeof CD.Recovery.renderMini === 'function') {
        CD.Recovery.renderMini(recMount, { onOpen: function () { showScreen('recovery'); } });
      } else {
        recMount.appendChild(_recoveryFallback(h, showScreen));
      }
    } catch (e) {
      console.error('[worker-dash] RECOVERY_MINI_FAILED', e);
      recMount.appendChild(_recoveryFallback(h, showScreen));
    }

    // ── 3 + 4. BENEFIT TRACKER + DISABILITY GAUGE (linked) ────────────────
    // The gauge's % scales the estimated weekly figure shown in the tracker.
    var awwRaw = (profile && profile.current_aww != null && String(profile.current_aww).trim() !== '')
      ? profile.current_aww
      : (local.self_aww != null ? local.self_aww : null);
    var awwDemo = false;
    if (awwRaw == null || Number(awwRaw) <= 0) { awwRaw = 1200; awwDemo = true; } // polished demo AWW

    var disPct = (local.disability_pct != null) ? Number(local.disability_pct) : null;
    var disDemo = false;
    if (disPct == null || !isFinite(disPct)) { disPct = 50; disDemo = true; } // demo: 50%
    disPct = Math.max(0, Math.min(100, disPct));

    var fullRate = _weeklyRate(awwRaw);                  // 2/3 capped (total disability)
    var estWeekly = fullRate * (disPct / 100);          // scaled by disability %

    var trackerGauge = h('div', { className: 'wd-tg-grid' });

    // shared live-update hook so the gauge can repaint the tracker figure
    var moneyState = { fullRate: fullRate, disPct: disPct, awwRaw: awwRaw, awwDemo: awwDemo, disDemo: disDemo };

    var benefit = _benefitTracker(h, card, f$, moneyState, reduced, showScreen, local);
    var gauge = _disabilityGauge(h, f$, moneyState, reduced, function (newPct) {
      // user changed the gauge → persist + relink the tracker figure
      moneyState.disPct = newPct;
      moneyState.disDemo = false;
      _writeLocal({ disability_pct: newPct });
      benefit.update();
    });

    trackerGauge.appendChild(benefit.node);
    trackerGauge.appendChild(gauge.node);
    cont.appendChild(h('section', { className: 'wd-section' }, trackerGauge));

    // ── 5. APPOINTMENTS SUMMARY ───────────────────────────────────────────
    var apptCard = h('div', { className: 'wd-card wd-appts' });
    apptCard.appendChild(h('div', { className: 'wd-card-hd' }, [
      h('h2', { className: 'wd-card-title' }, '📅 Upcoming appointments'),
      h('button', {
        type: 'button', className: 'wd-link-btn',
        onclick: function () { showScreen('appointments'); }
      }, 'View calendar →')
    ]));
    var apptMount = h('div', { className: 'wd-appts-mount' });
    apptCard.appendChild(apptMount);
    apptCard.appendChild(h('button', {
      type: 'button', className: 'wd-btn wd-btn-ghost wd-appts-add',
      onclick: function () { showScreen('appointments'); }
    }, '+ Add appointment'));
    cont.appendChild(h('section', { className: 'wd-section' }, apptCard));
    try {
      if (CD.Appointments && typeof CD.Appointments.renderUpcoming === 'function') {
        CD.Appointments.renderUpcoming(apptMount, { limit: 3 });
      } else {
        apptMount.appendChild(h('div', { className: 'wd-appts-empty' }, 'Appointments unavailable right now.'));
      }
    } catch (e) {
      console.error('[worker-dash] APPTS_FAILED', e);
      apptMount.appendChild(h('div', { className: 'wd-appts-empty' }, 'Appointments unavailable right now.'));
    }

    // ── 6a. Free-tier upgrade banner ──────────────────────────────────────
    if (tier === 'free') {
      var ban = h('div', { className: 'wd-card wd-upgrade' }, [
        h('div', { className: 'wd-upgrade-text' }, [
          h('h3', { className: 'wd-upgrade-title' }, 'Unlock Comp Buddy'),
          h('p', { className: 'wd-upgrade-sub' }, 'IME reminders, settlement calculator, my-injury tools, recovery tracking & more.')
        ]),
        h('button', {
          type: 'button', className: 'wd-btn wd-btn-primary',
          onclick: function () { handleUpgrade('comp_buddy'); }
        }, 'Upgrade — $9.99/mo')
      ]);
      cont.appendChild(h('section', { className: 'wd-section' }, ban));
    }

    // ── 6b. Free tools grid ───────────────────────────────────────────────
    cont.appendChild(h('div', { className: 'wd-section-label' }, 'Free tools'));
    var freeGrid = h('div', { className: 'wd-grid' });
    [
      { icon: '🧮', title: 'Quick Calc', desc: 'Check your AWW & weekly rate', screen: 'calculator' },
      { icon: '📚', title: 'Learning Portal', desc: 'WC glossary, FAQ, timeline', screen: 'learning' },
      { icon: '🏥', title: 'Find a Doctor', desc: 'Find WCB-authorized doctors', screen: 'doctor' }
    ].forEach(function (ft) {
      freeGrid.appendChild(_featureCard(h, {
        icon: ft.icon, title: ft.title, desc: ft.desc, badge: 'Free', badgeCls: 'is-free',
        onClick: function () { showScreen(ft.screen); }
      }));
    });
    cont.appendChild(h('section', { className: 'wd-section' }, freeGrid));

    // ── 6c. Comp Buddy features grid ──────────────────────────────────────
    cont.appendChild(h('div', { className: 'wd-section-label' }, 'Comp Buddy features'));
    var buddy = [
      { icon: '🛣️', title: 'Road to Recovery', desc: 'See every step of your case', tier: 'comp_buddy', screen: 'recovery' },
      { icon: '🔔', title: 'IME Reminders', desc: 'Never miss an IME appointment', tier: 'comp_buddy', screen: 'ime' },
      { icon: '⚖️', title: 'Settlement Calculator', desc: 'Estimate your SLU value', tier: 'comp_buddy', screen: 'settlement' },
      { icon: '🛠️', title: 'My Injury Tools', desc: 'SLU estimator, radiculopathy & more', tier: 'comp_buddy', screen: 'advanced_tools' },
      { icon: '📋', title: 'UTDM Monitoring', desc: 'Track medical updates', tier: 'comp_buddy', soon: true },
      { icon: '🚗', title: 'Mileage & Travel', desc: 'Log travel expenses', tier: 'comp_buddy', soon: true },
      { icon: '🎯', title: 'Job Buddy', desc: 'Find work within your restrictions + C-258.1 log', tier: 'comp_buddy', screen: 'job_buddy' },
      { icon: '📝', title: 'Claim Filing', desc: 'Auto-fill C-3 forms', tier: 'comp_buddy', soon: true }
    ];
    var buddyGrid = h('div', { className: 'wd-grid' });
    buddy.forEach(function (f) {
      var locked = !hasAccess(f.tier);
      var onClick = null;
      if (!f.soon && !locked) onClick = function () { showScreen(f.screen); };
      else if (!f.soon && locked) onClick = function () { handleUpgrade('comp_buddy'); };
      buddyGrid.appendChild(_featureCard(h, {
        icon: f.icon, title: f.title, desc: f.desc,
        badge: 'Comp Buddy', badgeCls: 'is-buddy',
        soon: f.soon, locked: locked && !f.soon, onClick: onClick
      }));
    });
    cont.appendChild(h('section', { className: 'wd-section' }, buddyGrid));

    // ── 6d. "Need an Attorney?" lead CTA ──────────────────────────────────
    if (!(profile && profile.has_attorney)) {
      var attyCta = h('div', { className: 'wd-card wd-atty' }, [
        h('div', { className: 'wd-atty-text' }, [
          h('h3', { className: 'wd-atty-title' }, 'Need an attorney?'),
          h('p', { className: 'wd-atty-sub' }, 'Get matched with a workers’ comp attorney near you — free, no obligation.')
        ]),
        h('button', {
          type: 'button', className: 'wd-btn wd-btn-accent',
          onclick: function () { openAttorneyIntake(); }
        }, 'Get matched — free')
      ]);
      cont.appendChild(h('section', { className: 'wd-section' }, attyCta));
    }

    cont.appendChild(h('p', { className: 'wd-disclaimer' }, DISCLAIMER));

    // Re-animate gauge/money when the dashboard becomes the active screen again.
    // ui-controller re-renders on navigation, so each render replays naturally;
    // we also kick the gauge sweep on the next frame here.
    if (!reduced) {
      window.requestAnimationFrame(function () {
        try { benefit.play(); gauge.play(); } catch (e) {}
      });
    } else {
      try { benefit.play(); gauge.play(); } catch (e) {}
    }

    return cont;
  }

  // ── BENEFIT TRACKER ─────────────────────────────────────────────────────
  // Money motion: a stack of bills slides/builds in on render. The estimated
  // weekly figure is driven by moneyState (fullRate × disPct).
  function _benefitTracker(h, card, f$, money, reduced, showScreen, local) {
    var node = h('div', { className: 'wd-card wd-benefit' });

    node.appendChild(h('div', { className: 'wd-card-hd' }, [
      h('h2', { className: 'wd-card-title' }, '💵 Benefit tracker'),
      (money.awwDemo || money.disDemo)
        ? h('span', { className: 'wd-demo-tag' }, 'Sample')
        : null
    ]));

    // next payment date — self-entered (localStorage) or a demo (next Friday).
    var nextDate = local.next_payment_date ? new Date(local.next_payment_date) : _nextFriday();
    var dateDemo = !local.next_payment_date;

    // money visual
    var moneyArt = h('div', { className: 'wd-money', 'aria-hidden': 'true' });
    for (var i = 0; i < 5; i++) {
      moneyArt.appendChild(h('span', { className: 'wd-bill wd-bill-' + i }, '$'));
    }
    var coin = h('span', { className: 'wd-coin', 'aria-hidden': 'true' }, '◉');
    moneyArt.appendChild(coin);

    var amtEl = h('div', { className: 'wd-benefit-amt', role: 'status', 'aria-live': 'polite' });
    var amtSub = h('div', { className: 'wd-benefit-sub' });
    var dateEl = h('div', { className: 'wd-benefit-date' });

    function paintFigures() {
      var est = money.fullRate * (money.disPct / 100);
      amtEl.textContent = f$(est);
      amtSub.innerHTML = '';
      amtSub.appendChild(h('span', null, 'estimated weekly benefit'));
      amtSub.appendChild(h('span', { className: 'wd-benefit-formula' },
        ' · ' + (money.disPct) + '% of ' + f$(money.fullRate) + ' full rate'));
      dateEl.innerHTML = '';
      dateEl.appendChild(h('span', { className: 'wd-benefit-date-lbl' }, 'Next payment'));
      dateEl.appendChild(h('span', { className: 'wd-benefit-date-val' },
        nextDate.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })));
      if (dateDemo) dateEl.appendChild(h('span', { className: 'wd-demo-tag wd-demo-inline' }, 'Sample'));
    }
    paintFigures();

    var body = h('div', { className: 'wd-benefit-body' }, [
      moneyArt,
      h('div', { className: 'wd-benefit-figs' }, [amtEl, amtSub, dateEl])
    ]);
    node.appendChild(body);

    // editable schedule
    var editBtn = h('button', {
      type: 'button', className: 'wd-link-btn wd-benefit-edit',
      onclick: function () { openEditor(); }
    }, 'Edit amount & date');
    node.appendChild(editBtn);

    var editorWrap = h('div', { className: 'wd-benefit-editor', hidden: 'hidden' });
    node.appendChild(editorWrap);

    function openEditor() {
      if (!editorWrap.hasAttribute('hidden')) { editorWrap.setAttribute('hidden', 'hidden'); return; }
      editorWrap.removeAttribute('hidden');
      editorWrap.innerHTML = '';
      var awwIn = h('input', {
        className: 'wd-input', type: 'number', inputMode: 'decimal',
        value: Number(money.awwRaw) || '', placeholder: 'Average weekly wage ($)'
      });
      var dateIn = h('input', {
        className: 'wd-input', type: 'date',
        value: _toDateInput(nextDate)
      });
      editorWrap.appendChild(_field(h, 'Average weekly wage ($)', awwIn));
      editorWrap.appendChild(_field(h, 'Next payment date', dateIn));
      var save = h('button', {
        type: 'button', className: 'wd-btn wd-btn-primary wd-btn-sm',
        onclick: function () {
          var newAww = Number(awwIn.value);
          if (isFinite(newAww) && newAww > 0) {
            money.awwRaw = newAww; money.awwDemo = false;
            money.fullRate = _weeklyRate(newAww);
            _writeLocal({ self_aww: newAww });
            _persistAww(newAww);
          }
          if (dateIn.value) {
            nextDate = new Date(dateIn.value + 'T00:00:00'); dateDemo = false;
            _writeLocal({ next_payment_date: dateIn.value });
          }
          editorWrap.setAttribute('hidden', 'hidden');
          // drop sample tag if both real now
          var hd = node.querySelector('.wd-card-hd .wd-demo-tag');
          if (hd && !money.awwDemo && !money.disDemo) hd.remove();
          paintFigures();
          replay();
        }
      }, 'Save');
      editorWrap.appendChild(save);
      editorWrap.appendChild(h('p', { className: 'wd-input-note' },
        'Saved on this device. We use your AWW to estimate two-thirds of your wage, capped at the state maximum.'));
    }

    function replay() {
      if (reduced) { node.classList.add('is-played'); return; }
      node.classList.remove('is-played');
      // force reflow to restart CSS animations
      void node.offsetWidth;
      window.requestAnimationFrame(function () { node.classList.add('is-played'); });
    }

    return {
      node: node,
      update: function () { paintFigures(); },   // called when gauge % changes
      play: replay
    };
  }

  // Persist AWW to the real profile column when we can (Comp Buddy+ logged in).
  function _persistAww(aww) {
    try {
      if (CD.currentUser && CD.supa && CD.currentProfile) {
        CD.currentProfile.current_aww = aww;
        CD.supa.from('profiles').update({ current_aww: aww }).eq('id', CD.currentUser.id)
          .then(function (res) { if (res && res.error) console.warn('[worker-dash] AWW_SAVE_FAILED', res.error); })
          .catch(function (e) { console.warn('[worker-dash] AWW_SAVE_FAILED', e); });
      }
    } catch (e) { console.warn('[worker-dash] AWW_SAVE_FAILED', e); }
  }

  // ── DISABILITY GAUGE ────────────────────────────────────────────────────
  // SVG arc gauge. Needle/arc sweeps up on render. Tied to the tracker via the
  // onChange callback (slider drives moneyState.disPct).
  function _disabilityGauge(h, f$, money, reduced, onChange) {
    var node = h('div', { className: 'wd-card wd-gauge' });
    // Big % lives in the header (right of the title) — not overlaid on the gauge.
    var pctEl = h('span', { className: 'wd-gauge-pct' }, money.disPct + '%');
    node.appendChild(h('div', { className: 'wd-card-hd wd-gauge-hd' }, [
      h('h2', { className: 'wd-card-title' }, '📈 Disability level'),
      h('div', { className: 'wd-gauge-hd-right' }, [
        money.disDemo ? h('span', { className: 'wd-demo-tag' }, 'Sample') : null,
        pctEl
      ])
    ]));

    var SVGNS = 'http://www.w3.org/2000/svg';
    function svg(name, attrs) {
      var el = document.createElementNS(SVGNS, name);
      Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
      return el;
    }
    // semicircle gauge: radius 80, centre (100,100), 180° sweep
    var R = 80, CX = 100, CY = 100;
    function pt(deg) {
      var rad = (Math.PI / 180) * deg;
      return [CX + R * Math.cos(rad), CY + R * Math.sin(rad)];
    }
    // 180° (left) → 360° (right). arc path for full track.
    var startA = pt(180), endA = pt(360);
    var trackD = 'M' + startA[0] + ' ' + startA[1] +
      ' A ' + R + ' ' + R + ' 0 0 1 ' + endA[0] + ' ' + endA[1];

    var s = svg('svg', { viewBox: '0 0 200 120', className: 'wd-gauge-svg', 'aria-hidden': 'true' });
    s.appendChild(svg('path', {
      d: trackD, fill: 'none', stroke: 'var(--skin-divider)',
      'stroke-width': '16', 'stroke-linecap': 'round'
    }));
    var arc = svg('path', {
      d: trackD, fill: 'none', stroke: 'var(--skin-accent)',
      'stroke-width': '16', 'stroke-linecap': 'round', pathLength: '100'
    });
    arc.setAttribute('stroke-dasharray', '0 100');
    s.appendChild(arc);

    // needle
    var needle = svg('line', {
      x1: String(CX), y1: String(CY), x2: String(CX - R + 14), y2: String(CY),
      stroke: 'var(--skin-text)', 'stroke-width': '3', 'stroke-linecap': 'round',
      className: 'wd-gauge-needle'
    });
    s.appendChild(needle);
    s.appendChild(svg('circle', { cx: String(CX), cy: String(CY), r: '6', fill: 'var(--skin-text)' }));

    var gaugeWrap = h('div', { className: 'wd-gauge-wrap' }, [s]);
    node.appendChild(gaugeWrap);

    // slider (self-entry, AA labelled)
    var slider = h('input', {
      type: 'range', min: '0', max: '100', step: '5', value: String(money.disPct),
      className: 'wd-gauge-slider', 'aria-label': 'Your disability percentage',
      'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(money.disPct)
    });
    node.appendChild(h('div', { className: 'wd-gauge-slider-row' }, [
      h('span', { className: 'wd-gauge-slider-end' }, '0%'),
      slider,
      h('span', { className: 'wd-gauge-slider-end' }, '100%')
    ]));
    node.appendChild(h('p', { className: 'wd-input-note' },
      'Self-entered. Your treating doctor sets your official degree of disability. This drives the estimate in your benefit tracker.'));

    function sweepTo(pct, animate) {
      var clamped = Math.max(0, Math.min(100, pct));
      // arc: dasharray fraction of the 100-unit path length (half-circle).
      var dash = clamped / 100 * 100;
      // needle angle: 180° (0%) → 360°/0° (100%)
      var ang = 180 + (clamped / 100) * 180;
      var rad = (Math.PI / 180) * ang;
      var nx = CX + (R - 14) * Math.cos(rad);
      var ny = CY + (R - 14) * Math.sin(rad);
      if (animate && !reduced) {
        arc.style.transition = 'stroke-dasharray var(--rhythm-slow, 900ms) var(--ease-out, ease)';
        needle.style.transition = 'all var(--rhythm-slow, 900ms) var(--ease-out, ease)';
      } else {
        arc.style.transition = 'none';
        needle.style.transition = 'none';
      }
      arc.setAttribute('stroke-dasharray', dash + ' 100');
      needle.setAttribute('x2', nx.toFixed(1));
      needle.setAttribute('y2', ny.toFixed(1));
      pctEl.textContent = clamped + '%';
    }

    slider.addEventListener('input', function () {
      var v = Number(slider.value);
      slider.setAttribute('aria-valuenow', String(v));
      money.disPct = v; money.disDemo = false;
      sweepTo(v, false);
      var tag = node.querySelector('.wd-card-hd .wd-demo-tag');
      if (tag) tag.remove();
      if (onChange) onChange(v);
    });

    function play() {
      if (reduced) { sweepTo(money.disPct, false); return; }
      sweepTo(0, false);
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(function () { sweepTo(money.disPct, true); });
      });
    }

    return { node: node, play: play };
  }

  // ── small builders ────────────────────────────────────────────────────────
  function _featureCard(h, o) {
    var cls = 'wd-fcard' + (o.locked ? ' is-locked' : '') + (o.soon ? ' is-soon' : '');
    var c = h('div', { className: cls });
    if (o.soon) c.appendChild(h('span', { className: 'wd-fcard-flag' }, 'Coming soon'));
    else if (o.locked) c.appendChild(h('span', { className: 'wd-fcard-lock' }, '🔒'));
    c.appendChild(h('div', { className: 'wd-fcard-icon' }, o.icon));
    c.appendChild(h('div', { className: 'wd-fcard-title' }, o.title));
    c.appendChild(h('div', { className: 'wd-fcard-desc' }, o.desc));
    c.appendChild(h('div', { className: 'wd-fcard-foot' },
      h('span', { className: 'wd-tier-badge ' + (o.badgeCls || '') }, o.badge)));
    if (o.onClick && !o.soon) {
      c.classList.add('is-clickable');
      c.setAttribute('role', 'button');
      c.setAttribute('tabindex', '0');
      c.onclick = o.onClick;
      c.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); o.onClick(); }
      });
    }
    return c;
  }

  function _field(h, label, control) {
    return h('label', { className: 'wd-field' }, [
      h('span', { className: 'wd-field-label' }, label),
      control
    ]);
  }

  function _recoveryFallback(h, showScreen) {
    return h('button', {
      type: 'button', className: 'wd-recovery-fallback',
      onclick: function () { showScreen('recovery'); }
    }, [
      h('span', { className: 'wd-recovery-fallback-ico' }, '🛣️'),
      h('span', null, 'Open your Road to Recovery →')
    ]);
  }

  function _nextFriday() {
    var d = new Date(); d.setHours(0, 0, 0, 0);
    var add = (5 - d.getDay() + 7) % 7; if (add === 0) add = 7;
    d.setDate(d.getDate() + add);
    return d;
  }
  function _toDateInput(d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  CD.WorkerDashboard = { render: render };
})(window);
