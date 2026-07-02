/**
 * nav-account.js — Universal auth-aware account menu for the public site.
 *
 * Companion to header-attorney-cta.js. Self-bootstrapping ES module.
 *
 * Problem it solves: ~40 hand-rolled headers (the `.tcd-nav` family, the
 * `nav > .inner > .links` learn/article variant, and the pricing one-off)
 * render a STATIC "Sign in" link that never changes — so a logged-in user
 * still sees "Sign in" and has no way to reach an account menu / sign out
 * from those pages. This script hydrates the header off the live session:
 *
 *   - Logged OUT → leaves the existing header untouched (Sign in stays).
 *   - Logged IN  → removes any Sign-in CTA and injects an avatar account
 *                  menu (Dashboard, My Cases / Workspace, Account, Sign Out),
 *                  skinned + tailored to the user's designation
 *                  (worker = Dawn, attorney = Workspace).
 *
 * It deliberately does NOT touch pages that mount nav.js (`#app-nav`), because
 * renderNav()/renderPublicNav() already manage auth state there. It is also
 * idempotent and watches for async-injected navs via a MutationObserver.
 *
 * Suppression: `<body data-no-nav-account="true">` opts a page out entirely
 * (e.g. the auth pages, the cinematic splash, admin consoles).
 *
 * Styling uses the active skin tokens (var(--skin-*) / heuristic fallbacks)
 * so the menu matches whatever header it lands in.
 */

import { getOptionalUser, getProfile, signOut } from '/js/auth.js';

(function navAccount() {
  'use strict';

  if (window.__tcdNavAccountInit) return;
  window.__tcdNavAccountInit = true;

  var SENTINEL = 'nav-account';

  function suppressed() {
    return document.body && document.body.getAttribute('data-no-nav-account') === 'true';
  }

  // nav.js owns auth on these pages — never double-render.
  function navJsOwned() {
    return !!document.getElementById('app-nav');
  }

  // Any header right-cluster we can hang the menu off, in priority order.
  // Mirrors the header variants enumerated in header-attorney-cta.js.
  var CTA_SELECTORS = [
    '.tcd-nav-cta',
    'nav a[href="/auth.html"]',
    'nav a[href^="/auth_v2"]',
    'header a[href="/auth.html"]',
    'header a[href^="/auth_v2"]',
    'nav .nav-btn',
    'nav a[href="/auth/signup"]',
    'nav a[href="/auth/login"]'
  ];
  var CONTAINER_SELECTORS = [
    '.tcd-nav-right',
    '.tcd-nav-inner',
    'nav .links',
    'nav .nav-right',
    'nav .inner',
    'header nav',
    'nav'
  ];

  // ── Styles (injected once) ─────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('tcd-nav-account-styles')) return;
    var css = `
      [data-tcd="nav-account"] {
        position: relative;
        display: inline-flex;
        align-items: center;
        font-family: var(--skin-font-body, 'DM Sans', system-ui, -apple-system, sans-serif);
      }
      [data-tcd="nav-account"] .tcd-acct-btn {
        display: inline-flex; align-items: center; gap: 8px; cursor: pointer;
        background: var(--skin-surface-elev, rgba(255,255,255,0.08));
        border: 1px solid var(--skin-divider, rgba(255,255,255,0.18));
        border-radius: 999px; padding: 4px 10px 4px 4px;
        color: var(--skin-text, #f4f6fa);
        font: inherit; font-weight: 600; font-size: 13.5px; line-height: 1;
        transition: background .18s ease, border-color .18s ease;
      }
      [data-tcd="nav-account"] .tcd-acct-btn:hover {
        background: var(--skin-surface-warm, rgba(255,255,255,0.14));
        border-color: var(--skin-accent, #E87722);
      }
      [data-tcd="nav-account"] .tcd-acct-avatar {
        width: 28px; height: 28px; border-radius: 50%; flex: none;
        display: grid; place-items: center; font-weight: 700; font-size: 12px; color: #fff;
        background: linear-gradient(135deg, var(--skin-accent, #E87722), var(--skin-accent-deep, #C85F0F));
      }
      [data-tcd="nav-account"] .tcd-acct-chev { font-size: 9px; opacity: .7; transition: transform .18s ease; }
      [data-tcd="nav-account"].open .tcd-acct-chev { transform: rotate(180deg); }
      [data-tcd="nav-account"] .tcd-acct-menu {
        position: absolute; top: calc(100% + 8px); right: 0;
        min-width: 220px; z-index: 10001;
        background: var(--skin-surface-elev, #16243F);
        /* Skin-adaptive edge: derived from --skin-text so it stays visible on
           BOTH the light worker/Dawn skin (dark hairline on the white card,
           against the cream page) and the dark attorney/cover skins (light
           hairline on navy). The 10%-opacity --skin-divider was invisible on
           light backgrounds and let the card blend into the page. */
        border: 1px solid color-mix(in srgb, var(--skin-text, #f4f6fa) 22%, transparent);
        border-radius: 14px; padding: 8px;
        box-shadow:
          0 20px 50px -12px rgba(20, 26, 45, 0.38),
          0 6px 16px rgba(20, 26, 45, 0.16),
          0 0 0 1px color-mix(in srgb, var(--skin-text, #f4f6fa) 8%, transparent);
        opacity: 0; visibility: hidden; transform: translateY(-6px) scale(.98);
        transform-origin: top right;
        transition: opacity .16s ease, transform .16s ease, visibility .16s;
      }
      [data-tcd="nav-account"].open .tcd-acct-menu {
        opacity: 1; visibility: visible; transform: translateY(0) scale(1);
      }
      [data-tcd="nav-account"] .tcd-acct-head {
        padding: 8px 12px 10px; border-bottom: 1px solid var(--skin-divider, rgba(255,255,255,0.12));
        margin-bottom: 6px; color: var(--skin-text, #f4f6fa);
      }
      [data-tcd="nav-account"] .tcd-acct-head .nm { font-weight: 700; font-size: 13.5px; line-height: 1.3; }
      [data-tcd="nav-account"] .tcd-acct-head .em {
        font-size: 11.5px; color: var(--skin-text-muted, #B5BFD3);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;
      }
      [data-tcd="nav-account"] .tcd-acct-item {
        display: flex; align-items: center; gap: 10px; width: 100%;
        color: var(--skin-text, #f4f6fa); text-decoration: none;
        font: inherit; font-size: 13.5px; font-weight: 500;
        padding: 9px 12px; border-radius: 9px; cursor: pointer;
        background: none; border: none; text-align: left;
        transition: background .15s ease;
      }
      [data-tcd="nav-account"] .tcd-acct-item:hover {
        background: var(--skin-surface-warm, rgba(255,255,255,0.10));
        text-decoration: none;
      }
      [data-tcd="nav-account"] .tcd-acct-item .ic {
        width: 26px; height: 26px; border-radius: 7px; flex: none;
        display: grid; place-items: center; font-size: 13px;
        background: color-mix(in srgb, var(--skin-accent, #E87722) 16%, transparent);
      }
      [data-tcd="nav-account"] .tcd-acct-sep {
        height: 1px; background: var(--skin-divider, rgba(255,255,255,0.12)); margin: 6px 8px;
      }
      [data-tcd="nav-account"] .tcd-acct-signout { color: #ff8a87; }
      [data-tcd="nav-account"] .tcd-acct-signout .ic {
        background: color-mix(in srgb, #d9534f 16%, transparent);
      }
      @media (prefers-reduced-motion: reduce) {
        [data-tcd="nav-account"] * { transition: none !important; }
      }
    `;
    var style = document.createElement('style');
    style.id = 'tcd-nav-account-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ── Menu construction ──────────────────────────────────────────────────
  function initials(email, name) {
    var src = (name && name.trim()) || email || 'A';
    var parts = src.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return src.charAt(0).toUpperCase();
  }

  function menuLinks(designation) {
    // Tailor the middle of the menu to the audience; both end in Sign Out.
    if (designation === 'attorney') {
      return [
        { href: '/dashboard/', ic: '🏠', label: 'Dashboard' },
        { href: '/workspace/', ic: '🗂️', label: 'Workspace' },
        { href: '/dashboard/my-cases.html', ic: '📁', label: 'My Cases' },
        { href: '/account.html', ic: '⚙️', label: 'Account' }
      ];
    }
    // worker (default)
    return [
      { href: '/dashboard/', ic: '🏠', label: 'Dashboard' },
      { href: '/dashboard/my-cases.html', ic: '📁', label: 'My Cases' },
      { href: '/account.html', ic: '⚙️', label: 'Account' }
    ];
  }

  function buildMenu(session, designation, profileName) {
    var email = (session && session.user && session.user.email) || '';
    // Prefer the profile's full_name (the app's source of truth); fall back to
    // the auth metadata, then to nothing.
    var name = (profileName && profileName.trim()) ||
               (session && session.user && session.user.user_metadata &&
                session.user.user_metadata.full_name) || '';

    var wrap = document.createElement('div');
    wrap.setAttribute('data-tcd', SENTINEL);
    wrap.setAttribute('data-audience', designation === 'attorney' ? 'attorney' : 'worker');

    var rows = menuLinks(designation).map(function (l) {
      return '<a class="tcd-acct-item" href="' + l.href + '"><span class="ic">' + l.ic +
             '</span><span>' + l.label + '</span></a>';
    }).join('');

    wrap.innerHTML =
      '<button type="button" class="tcd-acct-btn" aria-haspopup="true" aria-expanded="false" aria-label="Account menu">' +
        '<span class="tcd-acct-avatar">' + initials(email, name) + '</span>' +
        '<span class="tcd-acct-chev">▾</span>' +
      '</button>' +
      '<div class="tcd-acct-menu" role="menu">' +
        '<div class="tcd-acct-head">' +
          // Name is the primary line. Show the email only as a fallback when we
          // have no name, so the header is never blank.
          (name
            ? '<div class="nm">' + escapeHtml(name) + '</div>'
            : (email ? '<div class="nm">' + escapeHtml(email) + '</div>' : '')) +
        '</div>' +
        rows +
        '<div class="tcd-acct-sep"></div>' +
        '<button type="button" class="tcd-acct-item tcd-acct-signout" data-tcd-signout>' +
          '<span class="ic">⏻</span><span>Sign Out</span>' +
        '</button>' +
      '</div>';

    // Toggle
    var btn = wrap.querySelector('.tcd-acct-btn');
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var open = wrap.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    // Sign out
    wrap.querySelector('[data-tcd-signout]').addEventListener('click', async function (e) {
      e.preventDefault();
      await signOut();
    });
    return wrap;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Close on outside click / Esc (registered once).
  var globalClosersWired = false;
  function wireGlobalClosers() {
    if (globalClosersWired) return;
    globalClosersWired = true;
    document.addEventListener('click', function (e) {
      document.querySelectorAll('[data-tcd="' + SENTINEL + '"].open').forEach(function (w) {
        if (!w.contains(e.target)) {
          w.classList.remove('open');
          var b = w.querySelector('.tcd-acct-btn');
          if (b) b.setAttribute('aria-expanded', 'false');
        }
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      document.querySelectorAll('[data-tcd="' + SENTINEL + '"].open').forEach(function (w) {
        w.classList.remove('open');
        var b = w.querySelector('.tcd-acct-btn');
        if (b) b.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // ── Placement ──────────────────────────────────────────────────────────
  function removeSignInCtas() {
    CTA_SELECTORS.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) {
        // Only treat genuine auth/sign-in CTAs as removable.
        var href = (el.getAttribute('href') || '').toLowerCase();
        var txt = (el.textContent || '').toLowerCase();
        var isAuth = /auth(\.html|_v2|\/(login|signup))/.test(href) ||
                     /\bsign ?in\b|\bsign ?up\b|\blog ?in\b|get started free/.test(txt) ||
                     el.classList.contains('tcd-nav-cta');
        if (isAuth) el.remove();
      });
    });
  }

  function findContainer() {
    for (var i = 0; i < CONTAINER_SELECTORS.length; i++) {
      var el = document.querySelector(CONTAINER_SELECTORS[i]);
      if (el) return el;
    }
    return null;
  }

  function place(session, designation, profileName) {
    if (document.querySelector('[data-tcd="' + SENTINEL + '"]')) return true; // idempotent
    var container = findContainer();
    if (!container) return false;
    removeSignInCtas();
    injectStyles();
    container.appendChild(buildMenu(session, designation, profileName));
    wireGlobalClosers();
    return true;
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────
  async function run() {
    if (suppressed() || navJsOwned()) return;

    var state;
    try {
      state = await getOptionalUser();
    } catch (_) {
      return; // never break the page over an auth hiccup
    }
    if (!state || !state.session) return; // logged out → leave header as-is

    var designation = 'worker';
    var fullName = '';
    try {
      var prof = await getProfile(state.session.user.id);
      if (prof && (prof.designation === 'attorney' || prof.user_type === 'attorney')) {
        designation = 'attorney';
      }
      if (prof && prof.full_name) fullName = prof.full_name;
    } catch (_) { /* default worker */ }

    if (place(state.session, designation, fullName)) return;
    // Header may be injected async — watch for it, place once, stop.
    var obs = new MutationObserver(function () {
      if (navJsOwned()) { obs.disconnect(); return; }
      if (place(state.session, designation, fullName)) obs.disconnect();
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(function () { obs.disconnect(); }, 10000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
