/* The Comp Desk — Audience Switcher (revamp 2026, phase 1)
 *
 * Manages the two-audience experience:
 *   - On any skinned page, reads localStorage.tcd_audience and applies
 *     [data-audience="worker"|"attorney"] to <html>.
 *   - Renders the audience switcher pill into [data-audience-switch] slots.
 *   - The Cover page (/) uses setAudienceAndGo(audience) to persist the
 *     choice and route the visitor to that audience's home.
 *   - Direct URLs (/worker, /attorneys, /calculators/*, etc.) set the
 *     audience implicitly so a shared deep link "feels right" on first paint.
 *   - Returning visitors with a saved preference can bypass the cover via
 *     the bypass logic in cover-redirect (handled inline in /index.html).
 *
 * No framework. ~3KB minified. IIFE so it doesn't pollute globals beyond
 * window.tcdAudience.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'tcd_audience';
  var VALID = ['worker', 'attorney', 'cover'];
  var DEFAULT = 'worker';

  // ─── Route-implicit audience map ──────────────────────────────────
  // First match wins. Lets a fresh visitor land on /attorneys via a deep
  // link and immediately see the right skin even before localStorage settles.
  var ROUTE_HINTS = [
    { test: /^\/$/,                       audience: 'cover'   },
    { test: /^\/cover/i,                  audience: 'cover'   },
    { test: /^\/worker(\b|\/)/i,          audience: 'worker'  },
    { test: /^\/attorneys?(\b|\/)/i,      audience: 'attorney'},
    { test: /^\/for-attorneys?(\b|\/)/i,  audience: 'attorney'},
    { test: /^\/calculators\/pro/i,       audience: 'attorney'},
    { test: /^\/workspace(\b|\/)/i,       audience: 'attorney'},
    { test: /^\/connect-with-attorney/i,  audience: 'worker'  },
    { test: /^\/learn(\b|\/)/i,           audience: 'worker'  },
    { test: /^\/tools\/find-doctor/i,     audience: 'worker'  },
    { test: /^\/tools\/ime/i,             audience: 'worker'  },
    { test: /^\/tools\/claim-filing/i,    audience: 'worker'  }
  ];

  function readSaved() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      return VALID.indexOf(v) >= 0 ? v : null;
    } catch (e) { return null; }
  }

  function save(audience) {
    try { localStorage.setItem(STORAGE_KEY, audience); } catch (e) {}
  }

  function detect() {
    var path = (location.pathname || '/').toLowerCase();
    for (var i = 0; i < ROUTE_HINTS.length; i++) {
      if (ROUTE_HINTS[i].test.test(path)) return ROUTE_HINTS[i].audience;
    }
    return readSaved() || DEFAULT;
  }

  function apply(audience) {
    if (VALID.indexOf(audience) < 0) audience = DEFAULT;
    var html = document.documentElement;
    html.setAttribute('data-audience', audience);
    // Keep an alias on body too, in case stylesheets target it.
    if (document.body) document.body.setAttribute('data-audience', audience);
    // Emit a global event so individual pages can react (e.g. swap hero copy).
    try {
      window.dispatchEvent(new CustomEvent('tcd:audience', { detail: { audience: audience } }));
    } catch (e) {}
  }

  function setAudience(audience, opts) {
    opts = opts || {};
    if (VALID.indexOf(audience) < 0) return;
    save(audience);
    apply(audience);
    if (opts.go) {
      var dest = audience === 'attorney' ? '/attorneys' : '/worker';
      // Light flare transition before nav — purely cosmetic, no-op if reduced motion.
      var flare = document.createElement('div');
      flare.setAttribute('aria-hidden', 'true');
      flare.style.cssText = [
        'position:fixed',
        'inset:0',
        'z-index:9999',
        'background:' + (audience === 'attorney' ? '#0F1B33' : '#F4EADB'),
        'opacity:0',
        'transition:opacity 220ms ease',
        'pointer-events:none'
      ].join(';');
      document.body.appendChild(flare);
      // Force a tick so the transition takes hold.
      requestAnimationFrame(function () {
        flare.style.opacity = '1';
        setTimeout(function () { location.href = dest; }, 240);
      });
    }
  }

  // ─── Audience switcher pill ────────────────────────────────────────
  function renderSwitch() {
    var slots = document.querySelectorAll('[data-audience-switch]');
    if (!slots.length) return;
    var current = document.documentElement.getAttribute('data-audience') || DEFAULT;
    slots.forEach(function (slot) {
      slot.innerHTML = '';
      var wrap = document.createElement('div');
      wrap.className = 'tcd-switch';
      wrap.setAttribute('role', 'group');
      wrap.setAttribute('aria-label', 'Switch view');

      var bWorker = document.createElement('button');
      bWorker.type = 'button';
      bWorker.textContent = 'Worker';
      bWorker.setAttribute('aria-pressed', String(current === 'worker'));
      bWorker.addEventListener('click', function () { setAudience('worker', { go: shouldNavigate(slot) }); refreshSwitch(); });

      var bAttorney = document.createElement('button');
      bAttorney.type = 'button';
      bAttorney.textContent = 'Attorney';
      bAttorney.setAttribute('aria-pressed', String(current === 'attorney'));
      bAttorney.addEventListener('click', function () { setAudience('attorney', { go: shouldNavigate(slot) }); refreshSwitch(); });

      wrap.appendChild(bWorker);
      wrap.appendChild(bAttorney);
      slot.appendChild(wrap);
    });
  }

  function refreshSwitch() {
    var current = document.documentElement.getAttribute('data-audience') || DEFAULT;
    document.querySelectorAll('[data-audience-switch] .tcd-switch button').forEach(function (b) {
      var label = b.textContent.trim().toLowerCase();
      b.setAttribute('aria-pressed', String(current === label));
    });
  }

  function shouldNavigate(slot) {
    // When the pill toggles, do we route to the other home page?
    // - On the cover, yes (the pill is the choice).
    // - On a worker page when switching to attorney, yes (go to /attorneys).
    // - On a worker article (/learn/*) when switching, yes.
    // Default: yes. Pass data-audience-switch="skin-only" to just swap palette.
    return slot.getAttribute('data-audience-switch') !== 'skin-only';
  }

  // ─── Scroll-driven IntersectionObserver fallback ──────────────────
  // Older browsers that lack native scroll-driven animations still get
  // the .scene reveal via this lightweight observer.
  function bootSceneFallback() {
    if (CSS && CSS.supports && CSS.supports('animation-timeline: view()')) return;
    if (!('IntersectionObserver' in window)) {
      document.querySelectorAll('.scene').forEach(function (el) { el.classList.add('in-view'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.05 });
    document.querySelectorAll('.scene').forEach(function (el) { io.observe(el); });
  }

  // ─── Boot ──────────────────────────────────────────────────────────
  function boot() {
    apply(detect());
    renderSwitch();
    bootSceneFallback();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Public API
  window.tcdAudience = {
    set: setAudience,
    get: function () { return document.documentElement.getAttribute('data-audience'); },
    apply: apply,
    clear: function () { try { localStorage.removeItem(STORAGE_KEY); } catch (e) {} }
  };
})();
