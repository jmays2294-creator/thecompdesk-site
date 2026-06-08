/* ============================================================================
 * attorney-dashboard.js — CD.AttorneyDashboard (Attorney dashboard agent, Wave 2)
 * ----------------------------------------------------------------------------
 * OWNER: Attorney dashboard agent. See ops/dev/APP_REDESIGN_SPEC.md §7.
 * Also owns: www/css/dashboard-attorney.css
 *
 * INTEGRATION CONTRACT (do not change the signature — FOUNDATION wires to it):
 *   window.CD.AttorneyDashboard.render(ctx) -> DOMNode | null
 *
 *   ctx = {
 *     profile, user, tier,            // CD.currentProfile / currentUser / currentTier
 *     h, card, f$,                    // ui-controller DOM helpers
 *     showScreen,                     // (screenId) => void
 *     handleUpgrade,                  // CD.handleUpgrade
 *     openAttorneyIntake,            // () => void
 *     hasAccess,                      // (tier) => bool
 *     goToCalc                        // (tab) => void — deep-link calc tabs
 *   }
 *
 * Renders on the ATTORNEY (dark/navy) skin: Geist display, JetBrains Mono
 * numerics, fast/precise motion on --rhythm-*. Two animated SVG arc gauges
 * (Leads + Signed w/ conversion %), data is self-entered (localStorage) with a
 * clean DEMO fallback — no in-app round-robin source exists for attorneys to
 * read (find-attorney.js only *submits* leads to the submit-attorney-lead edge
 * fn), so there is nothing real to surface here yet. Quick links deep-link the
 * revamped calculator via ctx.goToCalc + CD.S.sub. Ported feature grid + free
 * upgrade banner + Firm card (firm tier only). All motion gates on
 * prefers-reduced-motion; gauges sweep on each render.
 * ==========================================================================*/
(function (window, document) {
  'use strict';
  var CD = window.CD = window.CD || {};

  var LS_KEY = 'cd_atty_metrics_v1';

  function prefersReducedMotion() {
    try {
      return window.matchMedia &&
             window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) { return false; }
  }

  function firstName(profile, user) {
    var full = (profile && profile.full_name) || '';
    if (full && full.trim()) return full.trim().split(/\s+/)[0];
    var email = (user && user.email) || '';
    if (email) return email.split('@')[0];
    return 'Counselor';
  }

  // ── Persisted self-entered metrics (with demo fallback) ─────────────────
  function loadMetrics() {
    try {
      var raw = window.localStorage.getItem(LS_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        if (p && typeof p === 'object') {
          return { leads: num(p.leads), signed: num(p.signed), isDemo: false };
        }
      }
    } catch (e) {}
    // Clean DEMO fallback — a believable month for a solo WC practice.
    return { leads: 28, signed: 11, isDemo: true };
  }
  function saveMetrics(m) {
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify({
        leads: num(m.leads), signed: num(m.signed)
      }));
      return true;
    } catch (e) { return false; }
  }
  function num(v) { var n = parseInt(v, 10); return (isNaN(n) || n < 0) ? 0 : n; }

  // ── SVG arc gauge ───────────────────────────────────────────────────────
  // Renders a 270° dial. `value` fills against `max`. Sweeps on render unless
  // reduced-motion is set. Returns { node, animate }.
  function makeGauge(opts) {
    var h = CD.h;
    var SIZE = 168, CX = 84, CY = 84, R = 64, STROKE = 12;
    var START = 135;            // degrees (bottom-left)
    var SWEEP = 270;            // total arc span
    var circ = 2 * Math.PI * R;
    var arcLen = circ * (SWEEP / 360);
    var max = Math.max(1, opts.max || 1);
    var frac = Math.max(0, Math.min(1, (opts.value || 0) / max));

    var ns = 'http://www.w3.org/2000/svg';
    function el(tag, attrs) {
      var n = document.createElementNS(ns, tag);
      Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
      return n;
    }

    var svg = el('svg', {
      width: SIZE, height: SIZE, viewBox: '0 0 ' + SIZE + ' ' + SIZE,
      class: 'atty-gauge-svg', role: 'img',
      'aria-label': opts.label + ': ' + (opts.value || 0)
    });

    // Rotate so the gap sits at the bottom.
    var g = el('g', { transform: 'rotate(' + START + ' ' + CX + ' ' + CY + ')' });

    var track = el('circle', {
      cx: CX, cy: CY, r: R, fill: 'none',
      'stroke-width': STROKE, 'stroke-linecap': 'round',
      class: 'atty-gauge-track',
      'stroke-dasharray': arcLen + ' ' + circ
    });
    var fill = el('circle', {
      cx: CX, cy: CY, r: R, fill: 'none',
      'stroke-width': STROKE, 'stroke-linecap': 'round',
      class: 'atty-gauge-fill',
      'stroke-dasharray': arcLen + ' ' + circ,
      'stroke-dashoffset': arcLen   // start empty
    });
    g.appendChild(track);
    g.appendChild(fill);
    svg.appendChild(g);

    // Center readouts (mono numerics).
    var center = h('div', { className: 'atty-gauge-center' });
    var valEl = h('div', { className: 'atty-gauge-value' }, '0');
    var subEl = h('div', { className: 'atty-gauge-sub' }, opts.sub || '');
    center.appendChild(valEl);
    if (opts.sub) center.appendChild(subEl);

    var wrap = h('div', { className: 'atty-gauge' }, [svg, center]);

    var target = frac;
    var targetVal = opts.value || 0;
    var didAnimate = false;

    function animate() {
      if (didAnimate) return;   // idempotent — safe to call from rAF + timeout
      didAnimate = true;
      var reduce = prefersReducedMotion();
      var finalOffset = arcLen * (1 - target);
      if (reduce) {
        fill.style.transition = 'none';
        fill.setAttribute('stroke-dashoffset', finalOffset);
        valEl.textContent = String(targetVal);
        return;
      }
      // Reset to empty, then sweep on next frame.
      fill.style.transition = 'none';
      fill.setAttribute('stroke-dashoffset', arcLen);
      // count-up the numeric readout
      var DUR = 900, t0 = null, settled = false;
      function ease(t) { return 1 - Math.pow(1 - t, 3); }
      function settle() {
        if (settled) return;
        settled = true;
        valEl.textContent = String(targetVal);
        fill.setAttribute('stroke-dashoffset', finalOffset);
      }
      function step(ts) {
        if (settled) return;
        if (t0 === null) t0 = ts;
        var p = Math.min(1, (ts - t0) / DUR);
        valEl.textContent = String(Math.round(targetVal * ease(p)));
        if (p < 1) window.requestAnimationFrame(step);
        else settle();
      }
      window.requestAnimationFrame(function () {
        fill.style.transition = 'stroke-dashoffset ' + DUR + 'ms cubic-bezier(0.2,0.8,0.2,1)';
        fill.setAttribute('stroke-dashoffset', finalOffset);
        window.requestAnimationFrame(step);
      });
      // Safety net: rAF is throttled in hidden/backgrounded tabs, which would
      // otherwise leave the gauge frozen mid-sweep. Guarantee the final state.
      window.setTimeout(settle, DUR + 120);
    }

    return { node: wrap, animate: animate, setValueEl: valEl };
  }

  // ── Editable metric pill (tap to edit the self-entered number) ──────────
  function metricEditor(metrics, onChange) {
    var h = CD.h;
    function fieldRow(label, key) {
      var input = h('input', {
        className: 'atty-metric-input',
        type: 'number', min: '0', inputMode: 'numeric',
        value: String(metrics[key]),
        'aria-label': label,
        onchange: function () {
          metrics[key] = num(this.value);
          metrics.isDemo = false;
          saveMetrics(metrics);
          onChange();
        }
      });
      return h('label', { className: 'atty-metric-field' }, [
        h('span', { className: 'atty-metric-field-lbl' }, label),
        input
      ]);
    }
    return h('div', { className: 'atty-metric-editor' }, [
      fieldRow('Leads this month', 'leads'),
      fieldRow('Signed this month', 'signed')
    ]);
  }

  CD.AttorneyDashboard = {
    render: function (ctx) {
      // Defensive: only own the ATTORNEY dashboard. If somehow called for a
      // worker, fall through to the controller fallback.
      if (CD.isWorker && CD.isWorker()) return null;

      var h = ctx.h, showScreen = ctx.showScreen, goToCalc = ctx.goToCalc;
      var hasAccess = ctx.hasAccess, handleUpgrade = ctx.handleUpgrade;
      var tier = ctx.tier;

      var cont = h('div', { className: 'dash-container atty-dash' });
      var gauges = [];   // collect for sweep-on-render

      // ── 1. Hero greeting ────────────────────────────────────────────────
      var hero = h('div', { className: 'atty-hero' });
      hero.appendChild(h('div', { className: 'atty-hero-eyebrow' }, 'Pro Workspace'));
      hero.appendChild(h('h1', { className: 'atty-hero-title' },
        'Welcome back, ' + firstName(ctx.profile, ctx.user)));
      var badgeRow = h('div', { className: 'atty-hero-badges' });
      badgeRow.appendChild(h('span', { className: 'atty-badge' }, 'Attorney'));
      if (tier === 'firm') badgeRow.appendChild(h('span', { className: 'atty-badge atty-badge-firm' }, 'Firm'));
      else if (tier === 'pro') badgeRow.appendChild(h('span', { className: 'atty-badge atty-badge-pro' }, 'Pro'));
      hero.appendChild(badgeRow);
      cont.appendChild(hero);

      // ── 2 + 3. Leads & Signed gauges ────────────────────────────────────
      var metrics = loadMetrics();
      var conversion = metrics.leads > 0
        ? Math.round((metrics.signed / metrics.leads) * 100)
        : 0;

      var panel = h('div', { className: 'atty-metrics-panel' });
      var panelHd = h('div', { className: 'atty-section-hd' }, [
        h('span', { className: 'atty-section-title' }, 'This Month'),
        metrics.isDemo
          ? h('span', { className: 'atty-demo-tag', title: 'Sample data — enter your own numbers below' }, 'DEMO')
          : null
      ]);
      panel.appendChild(panelHd);

      var gaugeRow = h('div', { className: 'atty-gauge-row' });

      // Leads gauge — scale max to a sensible ceiling above the value.
      var leadsMax = Math.max(20, Math.ceil((metrics.leads + 1) / 10) * 10);
      var leadsG = makeGauge({ value: metrics.leads, max: leadsMax, label: 'Leads received', sub: 'leads' });
      gauges.push(leadsG);
      var leadsCard = h('div', { className: 'atty-gauge-card' }, [
        h('div', { className: 'atty-gauge-card-title' }, 'Leads Received'),
        leadsG.node
      ]);
      gaugeRow.appendChild(leadsCard);

      // Signed gauge — max = leads (so it reads as "of the leads, this many signed").
      var signedMax = Math.max(leadsMax, metrics.leads || 1);
      var signedG = makeGauge({ value: metrics.signed, max: signedMax, label: 'Clients signed', sub: 'signed' });
      gauges.push(signedG);
      var signedCard = h('div', { className: 'atty-gauge-card' }, [
        h('div', { className: 'atty-gauge-card-title' }, 'Signed'),
        signedG.node,
        h('div', { className: 'atty-conversion' }, [
          h('span', { className: 'atty-conversion-num' }, conversion + '%'),
          h('span', { className: 'atty-conversion-lbl' }, 'conversion')
        ])
      ]);
      gaugeRow.appendChild(signedCard);

      panel.appendChild(gaugeRow);
      panel.appendChild(metricEditor(metrics, function () {
        // Re-render the whole dashboard so gauges + conversion recompute/sweep.
        if (CD.render) CD.render();
      }));
      cont.appendChild(panel);

      // ── 4. Quick links into the revamped calculator ─────────────────────
      cont.appendChild(h('div', { className: 'atty-section-hd' },
        h('span', { className: 'atty-section-title' }, 'Quick Calc')));
      // CCP / SLU Fee / LWEC live inside the `fee` tab (CD.S.sub); AWW is its
      // own top tab; Settlement is its own screen.
      var quick = [
        { label: 'CCP / Award', hint: 'Counsel fee', go: function () { if (CD.S) CD.S.sub = 'ccp'; goToCalc('fee'); } },
        { label: 'SLU Fee', hint: 'Schedule loss', go: function () { if (CD.S) CD.S.sub = 'slu'; goToCalc('fee'); } },
        { label: 'LWEC', hint: 'Wage-earning cap.', go: function () { if (CD.S) CD.S.sub = 'lwec'; goToCalc('fee'); } },
        { label: 'AWW', hint: 'Avg weekly wage', go: function () { goToCalc('aww'); } },
        { label: 'Settlement', hint: 'Section 32 compare', go: function () { showScreen('settlement'); } }
      ];
      var quickList = h('div', { className: 'atty-quick-list' });
      quick.forEach(function (q) {
        var item = h('button', { className: 'atty-quick-item', onclick: q.go });
        item.appendChild(h('span', { className: 'atty-quick-label' }, q.label));
        item.appendChild(h('span', { className: 'atty-quick-hint' }, q.hint));
        item.appendChild(h('span', { className: 'atty-quick-arrow', 'aria-hidden': 'true' }, '→'));
        quickList.appendChild(item);
      });
      cont.appendChild(quickList);

      // ── Free-tier upgrade banner (ported) ───────────────────────────────
      if (tier === 'free') {
        var ban = h('div', { className: 'atty-upgrade-banner' });
        ban.appendChild(h('h3', null, 'Unlock the Pro Workspace'));
        ban.appendChild(h('p', null, 'Saved cases, the OC-400.1 fee app, SLU & Non-Schedule tools, and more.'));
        ban.appendChild(h('button', {
          className: 'atty-upgrade-btn',
          onclick: function () { handleUpgrade && handleUpgrade('pro'); }
        }, 'Upgrade to Pro — $9.99/mo'));
        cont.appendChild(ban);
      }

      // ── 5. Ported attorney feature grid (reskinned) ─────────────────────
      cont.appendChild(h('div', { className: 'atty-section-hd' },
        h('span', { className: 'atty-section-title' }, 'Tools')));
      var features = [
        { icon: '🧮', title: 'Calculator', desc: 'AWW, Fees, SLU & more', tier: 'free', screen: 'calculator' },
        { icon: '⚖️', title: 'Settlement Comparison', desc: 'Compare settlement values', tier: 'comp_buddy', screen: 'settlement' },
        { icon: '📚', title: 'Learning Portal', desc: 'WC glossary, FAQ, timeline', tier: 'free', screen: 'learning' },
        { icon: '🏥', title: 'Find a Doctor', desc: 'Find WCB-authorized doctors', tier: 'free', screen: 'doctor' },
        { icon: '🔔', title: 'IME Reminders', desc: 'Never miss an IME appointment', tier: 'comp_buddy', screen: 'ime' },
        { icon: '🛠️', title: 'Injury Tools', desc: 'SLU estimator, radiculopathy & more', tier: 'comp_buddy', screen: 'advanced_tools' },
        { icon: '📋', title: 'UTDM Monitoring', desc: 'Track medical updates', tier: 'comp_buddy', screen: null, comingSoon: true },
        { icon: '🤖', title: 'Work Search Agent', desc: 'AI-powered job search', tier: 'comp_buddy', screen: null, comingSoon: true }
      ];
      var grid = h('div', { className: 'atty-feature-grid' });
      features.forEach(function (f) {
        var locked = !f.comingSoon && !hasAccess(f.tier);
        var card = h('div', { className: 'atty-feature-card' + (locked ? ' atty-locked' : '') });
        if (f.comingSoon) card.appendChild(h('div', { className: 'atty-feature-flag' }, 'Soon'));
        else if (locked) card.appendChild(h('div', { className: 'atty-feature-lock', 'aria-hidden': 'true' }, '🔒'));
        card.appendChild(h('div', { className: 'atty-feature-icon', 'aria-hidden': 'true' }, f.icon));
        card.appendChild(h('div', { className: 'atty-feature-title' }, f.title));
        card.appendChild(h('div', { className: 'atty-feature-desc' }, f.desc));
        card.appendChild(h('div', { className: 'atty-feature-foot' },
          h('span', { className: 'atty-tier-badge ' + (f.tier === 'free' ? 'is-free' : 'is-paid') },
            f.tier === 'free' ? 'Free' : 'Pro')));
        if (!f.comingSoon && !locked && f.screen) {
          card.classList.add('atty-clickable');
          card.onclick = function () { showScreen(f.screen); };
        } else if (locked) {
          card.classList.add('atty-clickable');
          card.onclick = function () { handleUpgrade && handleUpgrade('pro'); };
        }
        grid.appendChild(card);
      });
      cont.appendChild(grid);

      // ── Firm Management card (firm tier only) ───────────────────────────
      if (tier === 'firm') {
        cont.appendChild(h('div', { className: 'atty-section-hd' },
          h('span', { className: 'atty-section-title' }, 'Firm Management')));
        var firmCard = h('div', {
          className: 'atty-firm-card atty-clickable',
          onclick: function () { showScreen('firm_admin'); }
        });
        firmCard.appendChild(h('div', { className: 'atty-firm-icon', 'aria-hidden': 'true' }, '🏢'));
        firmCard.appendChild(h('div', { className: 'atty-firm-body' }, [
          h('div', { className: 'atty-firm-title' }, 'Manage Firm'),
          h('div', { className: 'atty-firm-desc' }, 'Invite attorneys, manage seats')
        ]));
        firmCard.appendChild(h('span', { className: 'atty-quick-arrow', 'aria-hidden': 'true' }, '→'));
        cont.appendChild(firmCard);
      }

      // ── Disclaimer ──────────────────────────────────────────────────────
      cont.appendChild(h('div', { className: 'v13-disclaimer atty-disclaimer' },
        'This tool is for informational purposes only and does not constitute legal advice.'));

      // ── Sweep gauges once the node is in the DOM ────────────────────────
      // rAF gives a smooth on-paint start; the timeout is a safety net for
      // hidden/backgrounded tabs where rAF is paused (animate() is idempotent).
      window.requestAnimationFrame(function () {
        gauges.forEach(function (g) { g.animate(); });
      });
      window.setTimeout(function () {
        gauges.forEach(function (g) { g.animate(); });
      }, 80);

      return cont;
    }
  };
})(window, document);
