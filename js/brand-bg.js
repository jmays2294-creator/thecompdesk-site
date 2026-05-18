/* The Comp Desk — Brand background + nav enhancement.
 * Loads on every non-workspace page.
 * - Injects #brand-bg <video> behind page content (ambient gradient loop).
 * - On the home page, plays the 8s brand intro once, then swaps to the ambient loop.
 * - Marks the first <nav> as data-brand-nav so /css/brand-theme.css can theme it.
 * - Adds a mobile hamburger toggle and scroll-shadow on the nav.
 * - prefers-reduced-motion: skips the video entirely (CSS shows a static gradient).
 *
 * No dependencies. Loaded via <script src="/js/brand-bg.js" defer></script>.
 * Brand round: brand_guidelines.md v1.0.0 (2026-05-17).
 */
(function () {
  'use strict';

  var INTRO_SRC  = '/assets/animations/intro_landscape.mp4';
  var AMBIENT_SRC = '/assets/animations/ambient_loop_landscape.mp4';

  var prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function isHomePage() {
    var p = window.location.pathname;
    return p === '/' || p === '/index.html' || p === '/index';
  }

  function injectVideo() {
    if (document.body.dataset.noBrandBg === 'true') return;
    if (document.getElementById('brand-bg')) return;

    var wrap = document.createElement('div');
    wrap.id = 'brand-bg';
    wrap.setAttribute('aria-hidden', 'true');

    if (prefersReducedMotion) {
      // No video — the CSS fallback handles the gradient.
      document.body.insertBefore(wrap, document.body.firstChild);
      return;
    }

    var video = document.createElement('video');
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('disableremoteplayback', '');
    video.setAttribute('preload', 'auto');
    video.setAttribute('aria-hidden', 'true');

    if (isHomePage()) {
      // Intro plays once, then swap to ambient loop on `ended`.
      video.src = INTRO_SRC;
      video.loop = false;
      video.addEventListener('ended', function onEnded() {
        video.removeEventListener('ended', onEnded);
        video.src = AMBIENT_SRC;
        video.loop = true;
        var p = video.play();
        if (p && typeof p.catch === 'function') p.catch(function(){});
      });
    } else {
      // Other pages: ambient loop only.
      video.src = AMBIENT_SRC;
      video.loop = true;
    }

    wrap.appendChild(video);
    document.body.insertBefore(wrap, document.body.firstChild);
  }

  function injectHamburgerIfNeeded(nav) {
    if (nav.querySelector('.brand-nav-toggle')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'brand-nav-toggle';
    btn.setAttribute('aria-label', 'Toggle menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML =
      '<svg class="icon-open"  viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="7"  x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>' +
      '<svg class="icon-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';
    btn.addEventListener('click', function () {
      var open = nav.classList.toggle('nav-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    var inner = nav.querySelector('.inner') || nav.firstElementChild || nav;
    inner.appendChild(btn);
  }

  function enhanceNav() {
    // Targets:
    //  - Marketing pages: first <nav> in body.
    //  - App pages: nav.js-rendered <nav> inside #app-nav (rendered after this script may run).
    function tag(nav) {
      if (!nav || nav.dataset.brandNav === 'true') return;
      nav.dataset.brandNav = 'true';
      injectHamburgerIfNeeded(nav);
    }

    document.querySelectorAll('nav').forEach(tag);

    // App pages render nav into #app-nav asynchronously after auth resolves.
    var appNav = document.getElementById('app-nav');
    if (appNav) {
      var mo = new MutationObserver(function () {
        var n = appNav.querySelector('nav');
        if (n) {
          tag(n);
          mo.disconnect();
        }
      });
      mo.observe(appNav, { childList: true, subtree: true });
    }

    // Scroll-shadow on nav (subtle deepen when scrolled past hero).
    var onScroll = function () {
      var scrolled = (window.scrollY || window.pageYOffset) > 24;
      document.querySelectorAll('nav[data-brand-nav]').forEach(function (n) {
        n.classList.toggle('nav-scrolled', scrolled);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  function init() {
    injectVideo();
    enhanceNav();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
