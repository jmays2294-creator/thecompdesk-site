/**
 * nav.js - Navigation & UI Components
 * Builds the authenticated + public navigation bar and footer disclaimer.
 *
 * 2026 revamp: condensed grouped-dropdown nav (≤5 top-level items) that
 * SKINS itself off the site's audience system:
 *   - Worker  → "Dawn"      skin: cream surfaces, Fraunces serif, warm, slow.
 *   - Attorney → "Workspace" skin: deep-navy surfaces, Geist sans, sharp, fast.
 * Skin tokens mirror css/skins.css EXACTLY and are inlined + namespaced to
 * #app-nav so the injected nav looks coherent even on pages that never load
 * skins.css. The nav reads [data-audience] off <html> (set by
 * audience-switcher.js / route), falls back to a route + tier heuristic, and
 * re-skins live on the `tcd:audience` event.
 */

import { signOut, TIERS } from './auth.js';
// Privacy-first product analytics (PostHog self-hosted).
// Self-bootstraps on import; no PII; consent-gated for EU/UK/CA.
// See docs/ANALYTICS_AUDIT.md for the isolation audit.
import './analytics.js';

// ─────────────────────────────────────────────────────────────
// Global date-input guard: validate pre-2000 years on BLUR only.
// We intentionally do NOT set min/max attributes on date inputs —
// native date inputs with a min reject partially-typed years and
// prevent the user from entering a 4-digit year at all. We also
// don't watch mutations or clamp on 'change', since 'change' can
// fire mid-edit as the user tabs between date segments.
// ─────────────────────────────────────────────────────────────
(function enforceGlobalDateMin() {
  function clampOnBlur(e) {
    const el = e.target;
    if (!el || !el.matches || !el.matches('input[type="date"]')) return;
    if (!el.value) return;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(el.value);
    if (!m) return;
    const yr = parseInt(m[1], 10);
    if (yr < 2000 || yr > 2099) {
      el.value = '';
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  function init() {
    document.addEventListener('blur', clampOnBlur, true);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

// ─────────────────────────────────────────────────────────────
// Audience / skin resolution
// ─────────────────────────────────────────────────────────────

/**
 * Resolve which skin the nav should wear.
 * Priority: explicit <html data-audience> → route heuristic → tier → worker.
 * @param {string} tier
 * @returns {'worker'|'attorney'}
 */
function computeAudience(tier) {
  const explicit = document.documentElement.getAttribute('data-audience');
  if (explicit === 'worker' || explicit === 'attorney') return explicit;

  const p = (location.pathname || '/').toLowerCase();
  if (/^\/(workspace|attorneys?|for-attorneys?|hire-attorney)(\b|\/)/.test(p)
      || /^\/calculators\/pro/.test(p)) return 'attorney';
  if (/^\/(worker|job-buddy|learn|connect-with-attorney)(\b|\/)/.test(p)
      || /^\/tools\/(find-doctor|ime|claim-filing)/.test(p)) return 'worker';

  if (tier === 'pro' || tier === 'firm') return 'attorney';
  return 'worker';
}

/**
 * Apply the resolved audience to #app-nav and keep it in sync with the
 * site-wide audience switcher (`tcd:audience` event). Idempotent: a single
 * listener is registered per container.
 */
function wireAudience(navContainer, tier) {
  navContainer.setAttribute('data-audience', computeAudience(tier));
  if (navContainer.__tcdAudienceWired) return;
  navContainer.__tcdAudienceWired = true;
  window.addEventListener('tcd:audience', (e) => {
    const a = e && e.detail && e.detail.audience;
    if (a === 'worker' || a === 'attorney') {
      navContainer.setAttribute('data-audience', a);
    }
  });
}

/**
 * The shared <style> block. Worker (Dawn) tokens are the default on #app-nav;
 * the [data-audience="attorney"] block swaps in the Workspace skin. Values are
 * mirrored from css/skins.css so the injected nav matches the static skinned nav.
 */
function navStyles() {
  return `
    <style>
      /* ── Skin tokens (namespaced to #app-nav, mirror css/skins.css) ── */
      #app-nav {
        --nv-surface: #F8F6F1;
        --nv-elev: #FFFFFF;
        --nv-warm: #F4EADB;
        --nv-text: #2D3142;
        --nv-soft: #4D5266;
        --nv-muted: #7A8095;
        --nv-accent: #E87722;
        --nv-accent-soft: #F4C28C;
        --nv-accent-deep: #C85F0F;
        --nv-divider: rgba(45, 49, 66, 0.10);
        --nv-shadow: 0 14px 40px rgba(45, 49, 66, 0.16);
        --nv-radius: 14px;
        --nv-font-display: 'Fraunces', Georgia, 'Times New Roman', serif;
        --nv-font-body: 'DM Sans', system-ui, -apple-system, sans-serif;
        --nv-fast: 220ms;
        --nv-base: 320ms;
        --nv-ease: cubic-bezier(0.16, 1, 0.3, 1);
        --nv-pulse: rgba(232, 119, 34, 0.55);
      }
      #app-nav[data-audience="attorney"] {
        --nv-surface: #0F1B33;
        --nv-elev: #16243F;
        --nv-warm: #1F2F4D;
        --nv-text: #F0EBE0;
        --nv-soft: #DDE5F2;
        --nv-muted: #B5BFD3;
        --nv-accent: #E87722;
        --nv-accent-soft: #FF8B33;
        --nv-accent-deep: #B85808;
        --nv-divider: rgba(240, 235, 224, 0.12);
        --nv-shadow: 0 16px 44px rgba(0, 0, 0, 0.5);
        --nv-radius: 12px;
        --nv-font-display: 'Geist', 'Inter', system-ui, -apple-system, sans-serif;
        --nv-fast: 160ms;
        --nv-base: 240ms;
        --nv-ease: cubic-bezier(0.2, 0.8, 0.2, 1);
        --nv-pulse: rgba(255, 139, 51, 0.6);
      }

      #app-nav {
        position: sticky;
        top: 0;
        z-index: 1000;
        background: color-mix(in srgb, var(--nv-surface) 82%, transparent);
        backdrop-filter: saturate(140%) blur(16px);
        -webkit-backdrop-filter: saturate(140%) blur(16px);
        border-bottom: 1px solid var(--nv-divider);
        color: var(--nv-text);
        font-family: var(--nv-font-body);
        transition: background var(--nv-base) var(--nv-ease), box-shadow var(--nv-base) var(--nv-ease);
      }
      #app-nav.nv-shrunk { box-shadow: var(--nv-shadow); }

      #app-nav .nav-wrapper {
        max-width: 1220px;
        margin: 0 auto;
        padding: 0 22px;
        display: flex;
        align-items: center;
        gap: 6px;
        height: 64px;
        transition: height var(--nv-base) var(--nv-ease);
      }
      #app-nav.nv-shrunk .nav-wrapper { height: 56px; }

      /* ── Logo ── */
      #app-nav .nav-logo {
        display: flex;
        align-items: center;
        gap: 10px;
        text-decoration: none;
        color: var(--nv-text);
        margin-right: 14px;
        white-space: nowrap;
      }
      #app-nav .nav-logo .mark {
        width: 30px; height: 30px; border-radius: 9px; flex: none;
        background: linear-gradient(135deg, var(--nv-accent), var(--nv-accent-deep));
        display: grid; place-items: center; position: relative;
        box-shadow: 0 4px 14px rgba(232, 119, 34, 0.4);
      }
      #app-nav .nav-logo .mark::after {
        content: ""; width: 9px; height: 9px; border-radius: 50%;
        background: #fff; box-shadow: 0 0 0 0 var(--nv-pulse);
        animation: nvPulse 2.6s ease-in-out infinite;
      }
      @keyframes nvPulse {
        0%, 100% { box-shadow: 0 0 0 0 var(--nv-pulse); }
        50% { box-shadow: 0 0 0 7px rgba(232, 119, 34, 0); }
      }
      #app-nav .nav-logo .name {
        font-family: var(--nv-font-display);
        font-weight: 800; letter-spacing: -0.01em; font-size: 16px; line-height: 1;
      }
      #app-nav .nav-logo:hover { opacity: 0.85; }

      /* ── Menu ── */
      #app-nav .nav-menu {
        display: flex; align-items: center; gap: 2px; flex: 1;
        margin: 0; padding: 0; list-style: none;
      }
      #app-nav .nav-menu > li { position: relative; }
      #app-nav .nav-link, #app-nav .nav-dropdown-toggle {
        display: inline-flex; align-items: center; gap: 6px;
        color: var(--nv-text); text-decoration: none;
        font-family: var(--nv-font-body); font-size: 14px; font-weight: 600;
        padding: 9px 13px; border-radius: 10px;
        background: none; border: none; cursor: pointer;
        position: relative; transition: background var(--nv-fast) var(--nv-ease);
      }
      #app-nav .nav-link:hover, #app-nav .nav-dropdown-toggle:hover {
        background: color-mix(in srgb, var(--nv-text) 8%, transparent);
      }
      /* animated underline */
      #app-nav .nav-link::after, #app-nav .nav-dropdown-toggle::after {
        content: ""; position: absolute; left: 13px; right: 13px; bottom: 5px; height: 2px;
        background: var(--nv-accent); border-radius: 2px;
        transform: scaleX(0); transform-origin: left;
        transition: transform var(--nv-fast) var(--nv-ease);
      }
      #app-nav .nav-link:hover::after,
      #app-nav .nav-menu > li:hover > .nav-dropdown-toggle::after,
      #app-nav .nav-menu > li:focus-within > .nav-dropdown-toggle::after { transform: scaleX(1); }
      #app-nav .nav-dropdown-toggle .chev { font-size: 9px; opacity: 0.7; transition: transform var(--nv-fast) var(--nv-ease); }
      #app-nav .nav-menu > li:hover > .nav-dropdown-toggle .chev,
      #app-nav .nav-menu > li:focus-within > .nav-dropdown-toggle .chev { transform: rotate(180deg); }

      /* ── Dropdown ── */
      #app-nav .nav-dropdown-menu {
        position: absolute; top: calc(100% + 6px); left: 0;
        min-width: 248px;
        background: color-mix(in srgb, var(--nv-elev) 97%, transparent);
        backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);
        border: 1px solid var(--nv-divider); border-radius: var(--nv-radius);
        padding: 8px;
        box-shadow: var(--nv-shadow);
        opacity: 0; visibility: hidden;
        transform: translateY(-8px) scale(0.98); transform-origin: top left;
        transition: opacity var(--nv-fast) var(--nv-ease), transform var(--nv-fast) var(--nv-ease), visibility var(--nv-fast);
      }
      #app-nav .nav-dropdown-menu.right-align { left: auto; right: 0; transform-origin: top right; }
      #app-nav .nav-menu > li:hover > .nav-dropdown-menu,
      #app-nav .nav-menu > li:focus-within > .nav-dropdown-menu,
      #app-nav .nav-right > li:hover > .nav-dropdown-menu,
      #app-nav .nav-right > li:focus-within > .nav-dropdown-menu {
        opacity: 1; visibility: visible; transform: translateY(0) scale(1);
      }
      /* invisible hover bridge so the menu doesn't close in the 6px gap */
      #app-nav .nav-dropdown-menu::before { content: ""; position: absolute; top: -8px; left: 0; right: 0; height: 8px; }
      #app-nav .nav-dropdown-item {
        display: flex; align-items: center; gap: 11px;
        color: var(--nv-text); text-decoration: none;
        font-size: 13.5px; font-weight: 500;
        padding: 10px 12px; border-radius: 9px;
        transition: background var(--nv-fast) var(--nv-ease), transform var(--nv-fast) var(--nv-ease);
      }
      #app-nav .nav-dropdown-item:hover {
        background: color-mix(in srgb, var(--nv-text) 9%, transparent);
        transform: translateX(3px);
      }
      #app-nav .nav-dropdown-item .ic {
        width: 30px; height: 30px; border-radius: 8px; flex: none;
        display: grid; place-items: center; font-size: 14px;
        background: color-mix(in srgb, var(--nv-accent) 14%, transparent);
      }
      #app-nav .nav-dropdown-item .tx { display: flex; flex-direction: column; line-height: 1.25; }
      #app-nav .nav-dropdown-item .tx small { font-size: 11px; color: var(--nv-muted); font-weight: 400; }
      #app-nav .nav-badge-beta {
        font-size: 9px; font-weight: 800; color: var(--nv-accent);
        border: 1px solid color-mix(in srgb, var(--nv-accent) 50%, transparent);
        border-radius: 5px; padding: 1px 5px; margin-left: auto;
      }
      #app-nav .nav-dd-sep { height: 1px; background: var(--nv-divider); margin: 6px 8px; }

      /* ── Right cluster ── */
      #app-nav .nav-right {
        display: flex; align-items: center; gap: 10px; margin-left: auto;
        list-style: none; margin-block: 0; padding: 0;
      }
      #app-nav .nav-right > li { position: relative; }
      #app-nav .tier-badge {
        font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px;
        padding: 5px 11px; border-radius: 7px; white-space: nowrap;
        background: color-mix(in srgb, var(--nv-accent) 16%, transparent);
        color: var(--nv-accent-deep);
        border: 1px solid color-mix(in srgb, var(--nv-accent) 30%, transparent);
      }
      #app-nav[data-audience="attorney"] .tier-badge { color: var(--nv-accent-soft); }
      #app-nav .tier-free { background: color-mix(in srgb, var(--nv-muted) 18%, transparent); color: var(--nv-soft); border-color: var(--nv-divider); }

      #app-nav .acct-btn {
        display: flex; align-items: center; gap: 8px; cursor: pointer;
        background: color-mix(in srgb, var(--nv-text) 5%, transparent);
        border: 1px solid var(--nv-divider); border-radius: 30px;
        padding: 4px 6px 4px 4px; transition: background var(--nv-fast) var(--nv-ease);
      }
      #app-nav .acct-btn:hover { background: color-mix(in srgb, var(--nv-text) 10%, transparent); }
      #app-nav .acct-avatar {
        width: 30px; height: 30px; border-radius: 50%; flex: none;
        background: linear-gradient(135deg, var(--nv-accent), var(--nv-accent-deep));
        display: grid; place-items: center; font-weight: 700; font-size: 13px; color: #fff;
      }
      #app-nav .acct-btn .chev { font-size: 9px; opacity: 0.7; margin-right: 4px; transition: transform var(--nv-fast) var(--nv-ease); }
      #app-nav .nav-right > li:hover .acct-btn .chev,
      #app-nav .nav-right > li:focus-within .acct-btn .chev { transform: rotate(180deg); }

      #app-nav .nav-cta {
        display: inline-flex; align-items: center; white-space: nowrap;
        padding: 9px 16px; border-radius: 999px;
        font-size: 13px; font-weight: 700; text-decoration: none;
        background: var(--nv-accent); color: #fff;
        border: 1.5px solid var(--nv-accent);
        transition: background var(--nv-fast) var(--nv-ease), transform var(--nv-fast) var(--nv-ease);
      }
      #app-nav .nav-cta:hover { background: var(--nv-accent-soft); border-color: var(--nv-accent-soft); transform: translateY(-1px); }
      #app-nav .nav-signin {
        color: var(--nv-soft); font-size: 13px; font-weight: 600; text-decoration: none;
        padding: 8px 14px; border-radius: 999px; border: 1px solid var(--nv-divider);
        transition: border-color var(--nv-fast) var(--nv-ease), color var(--nv-fast) var(--nv-ease);
      }
      #app-nav .nav-signin:hover { color: var(--nv-text); border-color: color-mix(in srgb, var(--nv-text) 35%, transparent); }
      #app-nav .nav-sign-out {
        display: flex; align-items: center; gap: 11px; width: 100%;
        background: none; border: none; cursor: pointer; text-align: left;
        color: #d9534f; font-family: var(--nv-font-body); font-size: 13.5px; font-weight: 600;
        padding: 10px 12px; border-radius: 9px;
        transition: background var(--nv-fast) var(--nv-ease);
      }
      #app-nav[data-audience="attorney"] .nav-sign-out { color: #ff8a87; }
      #app-nav .nav-sign-out:hover { background: color-mix(in srgb, #d9534f 14%, transparent); }
      #app-nav .nav-sign-out .ic { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; background: color-mix(in srgb, #d9534f 12%, transparent); }

      /* ── Hamburger (mobile) ── */
      #app-nav .nav-hamburger {
        display: none; flex-direction: column; gap: 5px; cursor: pointer;
        background: none; border: none; padding: 9px; margin-left: auto;
      }
      #app-nav .nav-hamburger span { width: 23px; height: 2px; background: var(--nv-text); border-radius: 2px; transition: all 0.3s ease; }
      #app-nav .nav-hamburger.active span:nth-child(1) { transform: rotate(45deg) translate(7px, 7px); }
      #app-nav .nav-hamburger.active span:nth-child(2) { opacity: 0; }
      #app-nav .nav-hamburger.active span:nth-child(3) { transform: rotate(-45deg) translate(6px, -6px); }

      @media (max-width: 880px) {
        #app-nav .nav-menu, #app-nav .nav-right { display: none; }
        #app-nav .nav-menu.mobile-open, #app-nav .nav-right.mobile-open {
          display: flex; flex-direction: column; align-items: stretch;
          position: absolute; top: 64px; left: 0; right: 0;
          background: var(--nv-elev);
          border-bottom: 1px solid var(--nv-divider);
          padding: 16px; gap: 6px;
        }
        #app-nav .nav-right.mobile-open {
          flex-direction: row; flex-wrap: wrap; justify-content: center;
          padding: 14px 16px; gap: 10px; border-top: 1px solid var(--nv-divider);
        }
        #app-nav .nav-dropdown-menu {
          position: static; opacity: 1; visibility: visible; transform: none;
          box-shadow: none; border: none; background: color-mix(in srgb, var(--nv-text) 4%, transparent);
          margin-top: 4px; min-width: 0;
        }
        #app-nav .nav-hamburger { display: flex; }
        #app-nav .nav-logo { margin-right: auto; }
        #app-nav .nav-wrapper { height: 64px; }
        #app-nav.nv-shrunk .nav-wrapper { height: 64px; }
      }

      @media (prefers-reduced-motion: reduce) {
        #app-nav .nav-logo .mark::after { animation: none; }
        #app-nav *, #app-nav *::after { transition: none !important; }
      }
    </style>
  `;
}

/** Shared scroll-condense + hamburger + sign-out wiring. */
function wireNavBehavior(navContainer) {
  // Scroll-condense
  const navEl = navContainer; // #app-nav is the sticky element
  const onScroll = () => navEl.classList.toggle('nv-shrunk', window.scrollY > 40);
  window.removeEventListener('scroll', navEl.__nvScroll || (() => {}));
  navEl.__nvScroll = onScroll;
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Hamburger
  const hamburger = navContainer.querySelector('#nav-hamburger');
  const navMenu = navContainer.querySelector('#nav-menu');
  const navRight = navContainer.querySelector('#nav-right');
  if (hamburger) {
    hamburger.addEventListener('click', () => {
      hamburger.classList.toggle('active');
      if (navMenu) navMenu.classList.toggle('mobile-open');
      if (navRight) navRight.classList.toggle('mobile-open');
    });
    navContainer.querySelectorAll('.nav-link, .nav-dropdown-item').forEach((link) => {
      link.addEventListener('click', () => {
        hamburger.classList.remove('active');
        if (navMenu) navMenu.classList.remove('mobile-open');
        if (navRight) navRight.classList.remove('mobile-open');
      });
    });
  }

  // Sign out
  const signOutBtn = navContainer.querySelector('#nav-sign-out');
  if (signOutBtn) {
    signOutBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      await signOut();
    });
  }
}

/** Tools dropdown (shared between authed + public). */
function toolsDropdownHTML() {
  return `
    <li>
      <button class="nav-dropdown-toggle">Tools <span class="chev">▾</span></button>
      <div class="nav-dropdown-menu">
        <a href="/job-buddy" class="nav-dropdown-item"><span class="ic">💼</span><span class="tx">Job Buddy<small>Return-to-work job finder</small></span><span class="nav-badge-beta">BETA</span></a>
        <a href="/tools/settlement.html" class="nav-dropdown-item"><span class="ic">⚖️</span><span class="tx">Settlement Comparison<small>Section 32 valuation</small></span></a>
        <a href="/tools/find-doctor.html" class="nav-dropdown-item"><span class="ic">🩺</span><span class="tx">Find a Doctor<small>WC-authorized providers</small></span></a>
        <a href="/tools/ime-reminders.html" class="nav-dropdown-item"><span class="ic">📅</span><span class="tx">IME Reminders<small>Never miss an exam</small></span></a>
        <a href="/tools/medical-treatment-guidelines.html" class="nav-dropdown-item"><span class="ic">📋</span><span class="tx">Medical Treatment Guidelines</span></a>
        <a href="/tools/learning/" class="nav-dropdown-item"><span class="ic">🎓</span><span class="tx">Learning Portal</span></a>
      </div>
    </li>
  `;
}

/** Explore dropdown (shared). */
function exploreDropdownHTML() {
  return `
    <li>
      <button class="nav-dropdown-toggle">Explore <span class="chev">▾</span></button>
      <div class="nav-dropdown-menu">
        <a href="/learn/" class="nav-dropdown-item"><span class="ic">📚</span><span class="tx">Learn<small>WC guides &amp; articles</small></span></a>
        <a href="/marketplace" class="nav-dropdown-item"><span class="ic">🛍️</span><span class="tx">Marketplace<small>AI agents &amp; skills</small></span></a>
        <a href="/extension" class="nav-dropdown-item"><span class="ic">🧩</span><span class="tx">Apps<small>Chrome extension</small></span></a>
        <a href="/for-attorneys" class="nav-dropdown-item"><span class="ic">👔</span><span class="tx">For Attorneys<small>Pro &amp; Firm tools</small></span></a>
      </div>
    </li>
  `;
}

const TIER_LABEL = { free: 'Free', comp_buddy: 'Comp Buddy', pro: 'Pro', firm: 'Firm' };

/**
 * Render the authenticated navigation bar.
 * Injects into element with id="app-nav".
 * @param {Object} session - User's auth session
 * @param {string} tier - User's tier/role
 */
function renderNav(session, tier) {
  const navContainer = document.getElementById('app-nav');
  if (!navContainer) {
    console.warn('Navigation container with id="app-nav" not found');
    return;
  }

  const navHTML = `
    ${navStyles()}
    <div class="nav-wrapper">
      <a href="/dashboard/" class="nav-logo">
        <span class="mark"></span>
        <span class="name">THE COMP DESK</span>
      </a>

      <button class="nav-hamburger" id="nav-hamburger">
        <span></span><span></span><span></span>
      </button>

      <ul class="nav-menu" id="nav-menu">
        <li><a href="/dashboard/" class="nav-link">Dashboard</a></li>
        <li>
          <button class="nav-dropdown-toggle">Calculators <span class="chev">▾</span></button>
          <div class="nav-dropdown-menu">
            <a href="/calculators/" class="nav-dropdown-item"><span class="ic">🧮</span><span class="tx">Calculators<small>AWW, CCP/Award, SLU, LWEC</small></span></a>
            <a href="/workspace/" class="nav-dropdown-item"><span class="ic">🗂️</span><span class="tx">Workspace<small>Drag-and-drop case builder</small></span></a>
          </div>
        </li>
        <li><a href="/dashboard/my-cases.html" class="nav-link">My Cases</a></li>
        <li><a href="/dashboard/#my-documents" class="nav-link">My Documents</a></li>
        ${toolsDropdownHTML()}
        ${exploreDropdownHTML()}
      </ul>

      <ul class="nav-right" id="nav-right">
        <li><span class="tier-badge tier-${tier}">${TIER_LABEL[tier] || tier}</span></li>
        <li>
          <button class="acct-btn"><span class="acct-avatar">${(session && session.user && (session.user.email || 'A')).charAt(0).toUpperCase()}</span><span class="chev">▾</span></button>
          <div class="nav-dropdown-menu right-align">
            <a href="/dashboard/#my-documents" class="nav-dropdown-item"><span class="ic">📄</span><span class="tx">My Documents<small>Your C-3 &amp; filings</small></span></a>
            <a href="/account.html" class="nav-dropdown-item"><span class="ic">⚙️</span><span class="tx">Account<small>Profile &amp; subscription</small></span></a>
            <a href="/contact.html" class="nav-dropdown-item"><span class="ic">✉️</span><span class="tx">Contact</span></a>
            <div class="nav-dd-sep"></div>
            <a href="/" class="nav-dropdown-item"><span class="ic">←</span><span class="tx">Back to Website</span></a>
            <button class="nav-sign-out" id="nav-sign-out"><span class="ic">⏻</span><span class="tx">Sign Out</span></button>
          </div>
        </li>
      </ul>
    </div>
  `;

  navContainer.innerHTML = navHTML;
  wireAudience(navContainer, tier);
  wireNavBehavior(navContainer);
}

/**
 * Render a public navigation bar for calculator/public pages.
 * Works for both authenticated and unauthenticated visitors.
 * @param {Object} userState - Result from getOptionalUser(): { session, tier }
 */
function renderPublicNav(userState) {
  const navContainer = document.getElementById('app-nav');
  if (!navContainer) return;

  const isLoggedIn = !!(userState && userState.session);
  const tier = isLoggedIn ? (userState.tier || 'free') : null;

  const rightSection = isLoggedIn ? `
    <li><span class="tier-badge tier-${tier}">${TIER_LABEL[tier] || tier}</span></li>
    <li>
      <button class="acct-btn"><span class="acct-avatar">${(userState.session.user && (userState.session.user.email || 'A')).charAt(0).toUpperCase()}</span><span class="chev">▾</span></button>
      <div class="nav-dropdown-menu right-align">
        <a href="/dashboard/" class="nav-dropdown-item"><span class="ic">🏠</span><span class="tx">Dashboard</span></a>
        <a href="/dashboard/#my-documents" class="nav-dropdown-item"><span class="ic">📄</span><span class="tx">My Documents</span></a>
        <a href="/account.html" class="nav-dropdown-item"><span class="ic">⚙️</span><span class="tx">Account</span></a>
        <a href="/contact.html" class="nav-dropdown-item"><span class="ic">✉️</span><span class="tx">Contact</span></a>
        <div class="nav-dd-sep"></div>
        <button class="nav-sign-out" id="nav-sign-out"><span class="ic">⏻</span><span class="tx">Sign Out</span></button>
      </div>
    </li>
  ` : `
    <li><a href="/auth_v2.html" class="nav-signin">Sign In</a></li>
    <li><a href="/auth_v2.html?mode=signup" class="nav-cta">Create Free Account</a></li>
  `;

  const navHTML = `
    ${navStyles()}
    <div class="nav-wrapper">
      <a href="/" class="nav-logo">
        <span class="mark"></span>
        <span class="name">THE COMP DESK</span>
      </a>

      <button class="nav-hamburger" id="nav-hamburger">
        <span></span><span></span><span></span>
      </button>

      <ul class="nav-menu" id="nav-menu">
        <li>
          <button class="nav-dropdown-toggle">Calculators <span class="chev">▾</span></button>
          <div class="nav-dropdown-menu">
            <a href="/calculators/" class="nav-dropdown-item"><span class="ic">🧮</span><span class="tx">Calculators<small>AWW, CCP/Award, SLU, LWEC</small></span></a>
            <a href="/workspace/" class="nav-dropdown-item"><span class="ic">🗂️</span><span class="tx">Workspace<small>Drag-and-drop case builder</small></span></a>
          </div>
        </li>
        ${toolsDropdownHTML()}
        ${exploreDropdownHTML()}
        <li><a href="/contact.html" class="nav-link">Contact</a></li>
      </ul>

      <ul class="nav-right" id="nav-right">
        ${rightSection}
      </ul>
    </div>
  `;

  navContainer.innerHTML = navHTML;
  wireAudience(navContainer, tier || undefined);
  wireNavBehavior(navContainer);
}

/**
 * Render the standard legal disclaimer footer
 * @returns {string} HTML for footer disclaimer
 */
function renderFooterDisclaimer() {
  return `
    <div style="
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(10px);
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      color: rgba(200, 200, 200, 0.8);
      font-size: 12px;
      padding: 20px;
      text-align: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
    ">
      <p style="margin: 0;">
        This tool is for informational purposes only and does not constitute legal advice. Comp Buddy is a document preparation service operated by NJJ Document Services, Inc.
      </p>
    </div>
  `;
}

// Export public API
export {
  renderNav,
  renderPublicNav,
  renderFooterDisclaimer
};
