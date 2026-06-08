/* ============================================================================
 * dashboard-host.js — website mount harness for the SHARED app dashboards.
 * ----------------------------------------------------------------------------
 * The injured-worker and attorney dashboards are authored ONCE in the native
 * app (www/js/dashboard/{worker,attorney}-dashboard.js) and vendored into the
 * website verbatim by ops/website/sync-dashboard.sh. They are plain IIFEs that
 * attach window.CD.WorkerDashboard / window.CD.AttorneyDashboard and render via
 * a single `render(ctx)` call — they take everything through ctx and degrade
 * gracefully when app-only globals are absent.
 *
 * This host is the WEB-ONLY adapter (not synced). It:
 *   1. Provides the 3 tiny DOM/format helpers (h, card, f$) the dashboards
 *      need — identical to the app's ui-components.js/calc-engine.js — as
 *      GUARDED fallbacks (never clobbers an app-provided CD.h).
 *   2. Provides a date-aware getMax() over the vendored CD.MAX_RATES so the
 *      worker benefit cap matches the app instead of using its static fallback.
 *   3. Builds the ctx and maps the app's in-SPA navigation (showScreen,
 *      handleUpgrade, openAttorneyIntake, goToCalc) onto website URLs.
 *   4. Picks worker vs attorney by profiles.designation — exactly like the
 *      app's "designation bypass" — and sets <html data-audience> to match so
 *      the correct skin (from skins.css) is active.
 *
 * Public API:  window.CDDashboardHost.mount(rootEl, { user, profile, tier, supabase })
 * ==========================================================================*/
(function (window, document) {
  'use strict';
  var CD = window.CD = window.CD || {};

  // ── 1. Standalone helper fallbacks (verbatim from the app) ───────────────
  if (!CD.h) {
    CD.h = function h(tag, attrs, children) {
      var el = document.createElement(tag);
      if (attrs) Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (k.indexOf('on') === 0) el[k] = v;
        else if (k === 'className') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'innerHTML') el.innerHTML = v;
        else if (k === 'value') el.value = v;
        else if (k === 'checked') el.checked = v;
        else if (k === 'selected') el.selected = v;
        else if (k === 'disabled') { el.disabled = !!v; }
        else el.setAttribute(k, v);
      });
      if (typeof children === 'string') el.textContent = children;
      else if (Array.isArray(children)) children.forEach(function (c) {
        if (!c && c !== 0) return;
        if (typeof c === 'string' || typeof c === 'number') el.appendChild(document.createTextNode(String(c)));
        else if (c instanceof Node) el.appendChild(c);
      });
      else if (children instanceof HTMLElement) el.appendChild(children);
      return el;
    };
  }
  if (!CD.card) {
    CD.card = function card(title, content, accent, resetFn) {
      var h = CD.h;
      var c = h('div', { className: 'card' + (accent ? ' accent' : '') });
      if (title) {
        var hd = h('div', { className: 'card-hd' });
        hd.appendChild(h('span', { className: 'card-title' }, title));
        if (resetFn) hd.appendChild(h('button', { className: 'reset-btn', onclick: resetFn }, 'Reset'));
        c.appendChild(hd);
      }
      var body = h('div', { className: 'card-body' });
      if (typeof content === 'function') content(body);
      else if (content instanceof HTMLElement) body.appendChild(content);
      c.appendChild(body);
      return c;
    };
  }
  if (!CD.f$) {
    CD.f$ = function f$(v) {
      var n = Number(v); if (!isFinite(n)) n = 0;
      return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    };
  }

  // ── 2. Date-aware statutory max over the vendored CD.MAX_RATES ────────────
  // Mirrors calc-engine.js getMax(); lets the worker benefit tracker cap the
  // 2/3 rate at the correct period maximum instead of its 1281.50 fallback.
  if (!CD.getMax) {
    CD.getMax = function getMax(d) {
      var rates = CD.MAX_RATES;
      if (!d || !rates || !rates.length) return null;
      var dt = new Date(d + 'T00:00:00');
      for (var i = 0; i < rates.length; i++) {
        var r = rates[i];
        if (dt >= new Date(r.s + 'T00:00:00') && dt <= new Date(r.e + 'T23:59:59')) return r;
      }
      return null;
    };
  }

  // ── 3. App-screen → website-URL navigation map ───────────────────────────
  // The shared dashboards navigate in-app via showScreen(id); on the website we
  // route to the matching public page. Recovery & appointments are app-only
  // (native calendar / recovery engine) and link to the nearest web surface.
  var SCREEN_URLS = {
    calculator:     '/calculators',
    aww:            '/calculators',
    learning:       '/learn',
    doctor:         '/tools/find-doctor',
    settlement:     '/tools/settlement',
    ime:            '/tools/ime-reminders',
    appointments:   '/tools/ime-reminders',
    advanced_tools: '/calculators',
    recovery:       '/learn',
    firm_admin:     '/account'
  };

  function tierLevel(t) { return ({ free: 0, comp_buddy: 1, pro: 2, firm: 3 })[t] || 0; }

  // ── 4. Mount ─────────────────────────────────────────────────────────────
  function mount(root, opts) {
    opts = opts || {};
    if (!root) { console.error('[dashboard-host] mount: missing root element'); return; }

    var profile = opts.profile || {};
    var designation = profile.designation || profile.user_type || opts.designation || 'worker';
    var isWorker = designation !== 'attorney';

    // Wire the CD globals the shared modules read (matches the app shell).
    CD.currentUser    = opts.user || null;
    CD.currentProfile = profile;
    CD.currentTier    = opts.tier || 'free';
    CD.currentDesignation = designation;
    CD.supa = opts.supabase || CD.supa || null;   // enables AWW persistence on web
    CD.S = CD.S || {};                             // attorney deep-link sub-tab store
    CD.isWorker  = function () { return isWorker; };
    CD.hasAccess = function (t) { return tierLevel(CD.currentTier) >= tierLevel(t); };
    CD.handleUpgrade = function () { window.location.href = '/subscribe'; };
    CD.openAttorneyIntake = function () { window.location.href = '/find-attorney'; };

    function showScreen(screen) {
      var url = SCREEN_URLS[screen];
      if (url) window.location.href = url;
    }
    function goToCalc(/* tab */) { window.location.href = '/calculators'; }
    CD.showScreen = showScreen;
    CD.goToCalc = goToCalc;

    // Skin follows designation — mirrors the app's designation bypass so a
    // worker always gets the warm skin and an attorney the navy skin.
    document.documentElement.setAttribute('data-audience', isWorker ? 'worker' : 'attorney');

    var ctx = {
      profile: profile,
      user: CD.currentUser,
      tier: CD.currentTier,
      h: CD.h, card: CD.card, f$: CD.f$,
      showScreen: showScreen,
      handleUpgrade: CD.handleUpgrade,
      openAttorneyIntake: CD.openAttorneyIntake,
      hasAccess: CD.hasAccess,
      goToCalc: goToCalc
    };

    function render() {
      var mod = isWorker ? CD.WorkerDashboard : CD.AttorneyDashboard;
      if (!mod || typeof mod.render !== 'function') {
        console.error('[dashboard-host] shared dashboard module not loaded for designation=' + designation);
        root.innerHTML = '';
        root.appendChild(CD.h('p', { className: 'wd-disclaimer' },
          'Dashboard failed to load. Please refresh.'));
        return;
      }
      var node = null;
      try { node = mod.render(ctx); }
      catch (e) { console.error('[dashboard-host] DASHBOARD_RENDER_FAILED', e); }
      root.innerHTML = '';
      if (node) root.appendChild(node);
      else root.appendChild(CD.h('p', { className: 'wd-disclaimer' }, 'Dashboard unavailable right now.'));
    }
    // The attorney metric editor re-renders via CD.render() after edits.
    CD.render = render;

    render();
  }

  window.CDDashboardHost = { mount: mount };
})(window, document);
