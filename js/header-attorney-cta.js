/**
 * header-attorney-cta.js — Universal "Contact an attorney" header CTA
 *
 * Self-bootstrapping. On load, injects a neutral, directory-style
 * "Contact an attorney" button next to the site brand/wordmark in the
 * header, plus an embedded attorney-connect wizard modal (the same flow
 * served by /connect-with-attorney.html?embed=1). Guest-facing; no auth.
 *
 * Mirrors the app's entry point (the round-robin attorney-connect flow),
 * surfaced as a persistent header CTA rather than a buried link.
 *
 * Brand detection covers every header variant on the site:
 *   - static  .tcd-wordmark        (phase-1 skinned nav, ~32 pages)
 *   - async   #app-nav .nav-logo   (nav.js renderPublicNav, calculators/tools)
 *   - misc    .nav-logo / .wordmark
 * A MutationObserver handles navs injected after initial load.
 *
 * The brand + button are wrapped in an inline-flex group so the button
 * sits immediately beside the brand without disturbing the header's
 * space-between layout (links / audience switcher stay in the right slot).
 *
 * Suppression: set `<body data-no-attorney-cta="true">` on any page that
 * shouldn't get the CTA (e.g. the connect wizard itself, attorney-facing
 * recruitment pages, authenticated dashboards).
 *
 * Styling uses the active skin tokens (var(--skin-*)) with safe fallbacks
 * so it adapts to the worker/attorney skins and degrades on unskinned pages.
 */
(function injectAttorneyCta() {
  'use strict';

  var LABEL = 'Contact an attorney';
  // Neutral balance-scale glyph (currentColor) — reads "legal", not salesy.
  var ICON =
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" ' +
    'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<path d="M12 3v18M7 21h10M5 7h14M12 7l-4 6a3 3 0 0 0 6 0l-4-6zm0 0l4 6a3 3 0 0 1-6 0l4-6z"/>' +
    '</svg>';

  // Header/nav-scoped brand selectors first, so a generic `.logo` elsewhere
  // on the page never wins over the real header brand. Covers every header
  // variant on the site: skinned nav, renderPublicNav, and the legacy navs.
  var BRAND_SELECTORS = [
    '.tcd-wordmark',
    '#app-nav .nav-logo',
    'nav .nav-logo', 'nav .nav-brand', 'nav .logo', 'nav .wordmark',
    'header .nav-logo', 'header .nav-brand', 'header .logo', 'header .wordmark',
    '.nav-logo', '.nav-brand', '.wordmark', '.logo'
  ];

  function suppressed() {
    return document.body && document.body.getAttribute('data-no-attorney-cta') === 'true';
  }

  // ── Embed src — carry UTM params through to the wizard ──────────────
  function buildEmbedSrc() {
    var qs = new URLSearchParams(window.location.search);
    var out = new URLSearchParams();
    out.set('embed', '1');
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(function (k) {
      if (qs.get(k)) out.set(k, qs.get(k));
    });
    return '/connect-with-attorney.html?' + out.toString();
  }

  // ── Modal (built lazily on first open) ──────────────────────────────
  var overlay = null;
  var frame = null;

  function buildModal() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.setAttribute('data-tcd', 'attorney-connect-overlay');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Connect with a Workers’ Compensation Attorney');
    overlay.style.cssText =
      'display:none;position:fixed;inset:0;z-index:100000;' +
      'background:rgba(7,16,31,0.72);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);';

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = '&times;';
    closeBtn.style.cssText =
      'position:fixed;top:16px;right:16px;z-index:100001;cursor:pointer;' +
      'width:40px;height:40px;border-radius:8px;font-size:24px;line-height:1;' +
      'display:flex;align-items:center;justify-content:center;' +
      'background:rgba(20,28,44,0.92);border:1px solid rgba(255,255,255,0.18);color:#fff;';
    closeBtn.addEventListener('click', closeModal);

    frame = document.createElement('iframe');
    frame.title = 'Connect with a Workers’ Compensation Attorney';
    frame.setAttribute('allow', 'clipboard-write');
    frame.setAttribute('referrerpolicy', 'same-origin');
    frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent;';

    overlay.appendChild(closeBtn);
    overlay.appendChild(frame);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
    document.body.appendChild(overlay);
  }

  function openModal() {
    buildModal();
    var src = buildEmbedSrc();
    if (frame.getAttribute('src') !== src) frame.setAttribute('src', src);
    overlay.style.display = 'block';
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    if (!overlay) return;
    overlay.style.display = 'none';
    document.body.style.overflow = '';
    if (frame) frame.setAttribute('src', 'about:blank');
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && overlay && overlay.style.display === 'block') closeModal();
  });
  window.addEventListener('message', function (e) {
    if (e && e.data && e.data.type === 'compdesk:closeConnectModal') closeModal();
  });

  // Expose for any page that wants to trigger the same flow.
  window.tcdOpenAttorneyConnect = openModal;

  // ── Button ──────────────────────────────────────────────────────────
  function buildButton() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-tcd', 'attorney-cta');
    btn.setAttribute('aria-label', LABEL);
    btn.innerHTML = ICON + '<span>' + LABEL + '</span>';
    btn.style.cssText = [
      'display:inline-flex', 'align-items:center', 'gap:7px',
      'padding:8px 15px', 'border-radius:999px',
      'font-family:inherit', 'font-weight:600', 'font-size:13.5px', 'line-height:1',
      'white-space:nowrap', 'cursor:pointer',
      'background:transparent',
      'color:var(--skin-text, #f4f6fa)',
      'border:1.5px solid var(--skin-divider, rgba(255,255,255,0.20))',
      'transition:background .18s ease, border-color .18s ease, transform .18s ease'
    ].join(';') + ';';
    btn.addEventListener('mouseenter', function () {
      btn.style.background = 'var(--skin-surface-elev, rgba(255,255,255,0.07))';
      btn.style.borderColor = 'var(--skin-accent, #4f8ff7)';
      btn.style.transform = 'translateY(-1px)';
    });
    btn.addEventListener('mouseleave', function () {
      btn.style.background = 'transparent';
      btn.style.borderColor = 'var(--skin-divider, rgba(255,255,255,0.20))';
      btn.style.transform = 'none';
    });
    btn.addEventListener('click', openModal);
    return btn;
  }

  function findBrand() {
    for (var i = 0; i < BRAND_SELECTORS.length; i++) {
      var el = document.querySelector(BRAND_SELECTORS[i]);
      if (el) return el;
    }
    return null;
  }

  function placeButton() {
    if (suppressed()) return true; // treat as "done" — nothing to place
    if (document.querySelector('[data-tcd="attorney-cta"]')) return true; // idempotent
    var brand = findBrand();
    if (!brand || !brand.parentNode) return false;

    // Wrap brand + button together so the button stays beside the brand
    // inside a space-between header (links / switcher keep the right slot).
    var group = document.createElement('span');
    group.setAttribute('data-tcd', 'attorney-cta-group');
    group.style.cssText = 'display:inline-flex;align-items:center;gap:14px;min-width:0;';
    brand.parentNode.insertBefore(group, brand);
    group.appendChild(brand);
    group.appendChild(buildButton());
    return true;
  }

  function start() {
    if (placeButton()) return;
    // Header not in the DOM yet (e.g. nav.js renderPublicNav runs async).
    // Watch for it, then place once and stop.
    var obs = new MutationObserver(function () {
      if (placeButton()) obs.disconnect();
    });
    obs.observe(document.body, { childList: true, subtree: true });
    // Safety: stop observing after 10s regardless.
    setTimeout(function () { obs.disconnect(); }, 10000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
