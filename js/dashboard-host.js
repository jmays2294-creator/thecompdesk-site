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
 *   5. Drives the V2 web shell (P6–P11 design): populates the persistent side
 *      rail per designation and wires /dashboard#dash-… deep links that scroll
 *      to and focus a section. Shell-level only — never forks the tiles.
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

  // ── 3b. V2 web shell glue (P6–P11 design): the rail + deep links ─────────
  // The persistent side rail replaces the app drawer on web — same segments,
  // always visible, zero taps to switch. Deep links (/dashboard#dash-…) scroll
  // to and FOCUS a section. Shell-level only: sections are found in the
  // vendored dashboards' rendered DOM (stable class / card-title strings) and
  // tagged with ids — the vendored modules are never forked. Everything here
  // fail-softs: no #dashRail on the page, or a section that didn't render,
  // simply hides the corresponding rail item.
  var RAIL_ITEMS = {
    worker: [
      { k: 'Home',   id: 'dash-top' },
      { k: 'Dates',  id: 'dash-dates' },    // appointments summary
      { k: 'Docs',   id: 'dash-docs' },     // my documents / filings
      { k: 'Buddy',  id: 'dash-buddy' },    // Comp Buddy features grid
      { k: 'Doctor', href: '/tools/find-doctor' },
      { k: 'Calc',   href: '/calculators' },
      { k: 'Learn',  href: '/learn' }
    ],
    attorney: [
      { k: 'Home',   id: 'dash-top' },
      { k: 'Leads',  id: 'dash-leads' },    // Network Leads — the 48-hour clock
      { k: 'Cases',  id: 'dash-cases' },    // Upcoming (firm cases)
      { k: 'Calc',   id: 'dash-calc' },     // Quick Calc
      { k: 'Tools',  id: 'dash-tools' },
      { k: 'Skills', id: 'dash-skills' },
      { k: 'Firm',   id: 'dash-firm' }      // firm tier only — hidden otherwise
    ]
  };
  // Attorney card titles (stable strings in the vendored module) → section ids.
  var CC_TITLE_IDS = {
    'network leads': 'dash-leads',
    'upcoming': 'dash-cases',
    'quick calc': 'dash-calc',
    'tools': 'dash-tools',
    'review new skills': 'dash-skills',
    'firm management': 'dash-firm'
  };

  function initShell(root, isWorker, rerender) {
    var rail = document.getElementById('dashRail');
    if (!rail || !root) return null;

    function reduced() {
      try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
      catch (e) { return false; }
    }

    var links = {};   // in-page items only, keyed by section id
    rail.innerHTML = '';
    RAIL_ITEMS[isWorker ? 'worker' : 'attorney'].forEach(function (it) {
      var a = document.createElement('a');
      a.textContent = it.k;
      if (it.href) {
        a.href = it.href;
      } else {
        a.href = '#' + it.id;
        a.onclick = function (e) { if (e && e.preventDefault) e.preventDefault(); go(it.id); };
        links[it.id] = a;
      }
      rail.appendChild(a);
    });
    rail.removeAttribute('hidden');

    function setCurrent(id) {
      Object.keys(links).forEach(function (k) {
        if (k === id) links[k].setAttribute('aria-current', 'page');
        else links[k].removeAttribute('aria-current');
      });
    }

    // Scroll + focus a section. If the target is gone because an in-place
    // screen (wizard, Job Buddy) replaced the dashboard, re-render first —
    // the rail doubles as the way back.
    function go(id) {
      var el = document.getElementById(id);
      if (!el) { try { rerender(); } catch (e) {} el = document.getElementById(id); }
      if (!el) return;
      try { window.history.replaceState(null, '', '#' + id); } catch (e) {}
      var startDist = Math.abs(el.getBoundingClientRect().top);
      try { el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }); }
      catch (e) { el.scrollIntoView(); }
      // Some engines silently drop smooth scrolls; if we've made no real
      // progress toward the target, settle with an instant jump.
      window.setTimeout(function () {
        var d = Math.abs(el.getBoundingClientRect().top);
        if (startDist > 300 && d > startDist * 0.75) {
          try { el.scrollIntoView({ behavior: 'auto', block: 'start' }); } catch (e) {}
        }
      }, 700);
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
      try { el.focus({ preventScroll: true }); } catch (e) {}
      setCurrent(id);
    }

    function tag(el, id) {
      if (!el) return false;
      if (!el.id) el.id = id;
      if (el.id !== id) return false;   // never steal a pre-existing id
      el.setAttribute('data-dash-anchor', '');
      el.setAttribute('tabindex', '-1');
      return true;
    }

    // Skip anything the V2 layer hid ([data-dashv2-hidden]) or that otherwise
    // doesn't paint — scrolling to an invisible section reads as a dead link.
    function visible(el) {
      try { return !!el && el.getClientRects().length > 0; } catch (e) { return !!el; }
    }
    function findWorkerSections() {
      var out = {};
      var v2 = root.querySelector('.dashv2');
      out['dash-top'] = v2 || root.querySelector('.wd-hero') || root.firstElementChild;
      if (v2) out['dash-buddy'] = v2.querySelector('.wg');       // the tile grid IS the feature launcher
      var ap = root.querySelector('.wd-appts');
      if (ap) out['dash-dates'] = ap.closest('.wd-section') || ap;
      var dc = root.querySelector('.wd-docs');
      if (dc) out['dash-docs'] = dc.closest('.wd-section') || dc;
      if (!out['dash-buddy']) {
        var labels = root.querySelectorAll('.wd-section-label');
        for (var i = 0; i < labels.length; i++) {
          if (/comp buddy features/i.test(labels[i].textContent || '')) { out['dash-buddy'] = labels[i]; break; }
        }
      }
      return out;
    }
    function findAttorneySections() {
      var out = {};
      var v2 = root.querySelector('.dashv2');
      out['dash-top'] = v2 || root.querySelector('.cc-hero') || root.firstElementChild;
      if (v2) out['dash-leads'] = v2.querySelector('.wg');       // the P11 leads block (null while loading)
      var titles = root.querySelectorAll('.cc-card-title');
      for (var i = 0; i < titles.length; i++) {
        var id = CC_TITLE_IDS[String(titles[i].textContent || '').trim().toLowerCase()];
        if (id && !out[id]) out[id] = titles[i].closest('.cc-card') || titles[i];
      }
      return out;
    }

    var observer = null;
    function spy(ids) {
      if (observer) { observer.disconnect(); observer = null; }
      if (!window.IntersectionObserver) return;
      observer = new IntersectionObserver(function (entries) {
        // near the top of the page the hero is above the observation band —
        // Home wins there, whatever card happens to sit mid-viewport
        if (window.scrollY < 160 && links['dash-top']) { setCurrent('dash-top'); return; }
        entries.forEach(function (en) {
          if (en.isIntersecting && en.target.id && links[en.target.id]) setCurrent(en.target.id);
        });
      }, { rootMargin: '-35% 0px -60% 0px' });
      ids.forEach(function (id) {
        var el = document.getElementById(id);
        if (el && links[id]) observer.observe(el);
      });
    }

    // Honour /dashboard#dash-… on arrival — content mounts long after the
    // browser's native hash jump already missed, so we replay it (once).
    var deepLinked = false;
    function deepLink() {
      if (deepLinked) return;
      var id = String(window.location.hash || '').replace(/^#/, '');
      if (id && document.getElementById(id)) { deepLinked = true; go(id); }
    }
    window.addEventListener('hashchange', function () {
      var id = String(window.location.hash || '').replace(/^#/, '');
      if (id) go(id);
    });

    return {
      // Re-tag sections after each full dashboard render (async cards repaint
      // through CD.render(), so this runs again and stays current).
      decorate: function () {
        rail.removeAttribute('hidden');
        var found = isWorker ? findWorkerSections() : findAttorneySections();
        var present = {};
        Object.keys(found).forEach(function (id) {
          if (visible(found[id]) && tag(found[id], id)) present[id] = true;
        });
        Object.keys(links).forEach(function (id) {
          links[id].style.display = present[id] ? '' : 'none';
        });
        spy(Object.keys(present));
        deepLink();
      },
      // Intake gate: the rail navigates a dashboard that isn't there yet.
      hide: function () { rail.setAttribute('hidden', 'hidden'); }
    };
  }

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
    CD.openAttorneyIntake = function () { window.location.href = '/connect-with-attorney'; };

    // Job Buddy screens render IN-PLACE on the website (no dedicated page), with a
    // back-to-dashboard control. Falls through to URL routing if the module/deps
    // didn't load (graceful — the tile then simply no-ops rather than erroring).
    function renderScreenInPlace(node) {
      if (!node) return false;
      var wrap = CD.h('div', { className: 'cd-jb-host' });
      wrap.appendChild(CD.h('button', {
        className: 'cd-jb-btn ghost', style: { margin: '6px 0 10px' },
        onclick: function () { CD.render(); }
      }, '← Back to dashboard'));
      wrap.appendChild(node);
      root.innerHTML = '';
      root.appendChild(wrap);
      try { window.scrollTo(0, 0); } catch (e) {}
      return true;
    }
    function showScreen(screen) {
      if (screen === 'job_buddy' && CD.renderJobBuddy) { renderScreenInPlace(CD.renderJobBuddy()); return; }
      if (screen === 'firm_job_buddy' && CD.renderFirmJobBuddy) { renderScreenInPlace(CD.renderFirmJobBuddy()); return; }
      // IME Reminders renders IN-PLACE on the website (same pattern as Job
      // Buddy / C-3). The shared dashboards emit screen ids 'ime'/'appointments';
      // the module carries its own UI + notification seam (browser Notifications
      // + foreground timers + countdown badges). Find a Doctor stays on its
      // dedicated /tools/find-doctor page (routed via SCREEN_URLS below).
      if ((screen === 'ime' || screen === 'ime_reminders' || screen === 'appointments') && CD.renderIMEReminders) {
        renderScreenInPlace(CD.renderIMEReminders({
          supabase: CD.supa, user: CD.currentUser, profile: CD.currentProfile, isNative: false
        }));
        return;
      }
      // Phase F — C-3 filing wizard renders IN-PLACE on the website (no dedicated
      // page), same pattern as Job Buddy. Fail-loud profile prefill happens inside.
      if (screen === 'c3' && CD.C3Wizard) {
        renderScreenInPlace(CD.C3Wizard.render({
          supabase: CD.supa, user: CD.currentUser, profile: CD.currentProfile, isNative: false,
          onComplete: function () { CD.render(); }, goToDashboard: function () { CD.render(); }
        }));
        return;
      }
      // Session 2 — AWW Wizard renders IN-PLACE on the website (same pattern as
      // the C-3 wizard). On save it writes profiles.current_aww, then CD.render()
      // re-mounts the dashboard which now shows the real AWW + weekly rate.
      if (screen === 'aww' && CD.AWWWizard) {
        renderScreenInPlace(CD.AWWWizard.render({
          supabase: CD.supa, user: CD.currentUser, profile: CD.currentProfile, isNative: false,
          onComplete: function () { CD.render(); }, goToDashboard: function () { CD.render(); }
        }));
        return;
      }
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

    // Phase D — Comp Buddy intake gate. A worker without a DOB hasn't completed
    // intake (the handoff sentinel); render the shared intake module instead of
    // the dashboard. Identical flow + columns + single upsert as the app.
    function renderIntakeIfNeeded() {
      if (!isWorker) return false;
      if (profile && profile.dob) return false;
      if (!CD.CompBuddyIntake || typeof CD.CompBuddyIntake.render !== 'function') return false;
      var node = null;
      try {
        node = CD.CompBuddyIntake.render({
          supabase: CD.supa,
          user: CD.currentUser,
          profile: profile,
          tier: CD.currentTier,
          isNative: false,
          onComplete: function () { try { window.location.reload(); } catch (e) {} },
          goToDashboard: function () { try { window.location.reload(); } catch (e) {} }
        });
      } catch (e) { console.error('[dashboard-host] CBI_RENDER_FAILED', e); }
      if (node) { root.innerHTML = ''; root.appendChild(node); return true; }
      return false;
    }

    function render() {
      if (renderIntakeIfNeeded()) { if (shell) shell.hide(); return; }
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
      // V2 desktop tile layer (P6–P11 design): compose the tile grid / leads
      // block above the vendored render and hide the sections it replaces.
      // Any failure falls back to the vendored render untouched.
      if (node && CD.WebDashV2 && typeof CD.WebDashV2.wrap === 'function') {
        try { node = CD.WebDashV2.wrap(node, ctx, isWorker) || node; }
        catch (e) { console.error('[dashboard-host] WEBDASHV2_FAILED', e); }
      }
      root.innerHTML = '';
      if (node) root.appendChild(node);
      else root.appendChild(CD.h('p', { className: 'wd-disclaimer' }, 'Dashboard unavailable right now.'));
      if (shell) { try { shell.decorate(); } catch (e) { console.warn('[dashboard-host] SHELL_DECORATE_FAILED', e); } }
    }
    // The attorney metric editor re-renders via CD.render() after edits.
    CD.render = render;

    // V2 web shell: build the rail before first paint so decorate() can wire it.
    var shell = null;
    try { shell = initShell(root, isWorker, render); }
    catch (e) { console.warn('[dashboard-host] SHELL_INIT_FAILED', e); }
    // Async blocks (the P11 leads grid) repaint outside render(); they call
    // this hook so freshly built sections get re-tagged for the rail.
    if (shell) CD.dashShellDecorate = function () { try { shell.decorate(); } catch (e) {} };

    render();
  }

  window.CDDashboardHost = { mount: mount };
})(window, document);
