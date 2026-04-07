/**
 * analytics.js — The Comp Desk product analytics
 *
 * Privacy-first PostHog integration. Self-hosted instance, isolated from
 * any law firm property. See docs/ANALYTICS_AUDIT.md for the isolation
 * audit and event taxonomy.
 *
 * Design rules (do NOT relax without updating the audit doc):
 *   1. No PII in event payloads — see scrubPayload() below.
 *   2. Non-essential tracking is gated behind explicit consent for
 *      visitors in the EU/UK/CA. Other regions get a soft notice.
 *   3. PostHog instance host is self-hosted (window.__CD_POSTHOG_HOST).
 *      No third-party pixels share an account ID with any law firm
 *      property. (No Meta/Google/TikTok pixels are loaded by this file.)
 *   4. Only the canonical taxonomy events are emitted:
 *        page_view, calculator_started, calculator_completed,
 *        share_link_generated, email_signup, story_submitted
 */

// ── Configuration ──────────────────────────────────────────────
// Self-hosted PostHog instance. Override via window.__CD_POSTHOG_HOST
// before this module loads if the host is provisioned at a different URL.
const POSTHOG_HOST =
  (typeof window !== 'undefined' && window.__CD_POSTHOG_HOST) ||
  'https://ph.thecompdesk.com';

// Public project key for the Comp Desk PostHog project ONLY.
// This key MUST NOT match any key used by any law firm property.
const POSTHOG_PROJECT_KEY =
  (typeof window !== 'undefined' && window.__CD_POSTHOG_KEY) ||
  'phc_compdesk_public_placeholder';

const CONSENT_STORAGE_KEY = 'cd_analytics_consent_v1';

const TAXONOMY = new Set([
  'page_view',
  'calculator_started',
  'calculator_completed',
  'share_link_generated',
  'email_signup',
  'story_submitted',
  // Benefit Rate Lookup tool
  'benefit_rate_started',
  'benefit_rate_completed',
  'benefit_rate_to_find_attorney_click',
]);

// Regions that legally require opt-in for non-essential tracking.
// Detected via the browser's IANA timezone — coarse but adequate for
// gating consent UI; not used as a primary identifier.
const CONSENT_REQUIRED_TZ_PREFIXES = [
  'Europe/',          // EU + UK
  'America/Toronto',  // Canada
  'America/Vancouver',
  'America/Edmonton',
  'America/Winnipeg',
  'America/Halifax',
  'America/St_Johns',
  'America/Montreal',
  'America/Regina',
];

// ── Consent ────────────────────────────────────────────────────
function consentRequired() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    return CONSENT_REQUIRED_TZ_PREFIXES.some((p) => tz.startsWith(p));
  } catch {
    return true; // fail closed
  }
}

function getConsent() {
  try {
    return localStorage.getItem(CONSENT_STORAGE_KEY); // 'granted' | 'denied' | null
  } catch {
    return null;
  }
}

function setConsent(value) {
  try {
    localStorage.setItem(CONSENT_STORAGE_KEY, value);
  } catch {
    /* ignore */
  }
  if (value === 'granted') {
    bootPostHog();
    flushQueue();
  }
}

function trackingAllowed() {
  if (!consentRequired()) return true;
  return getConsent() === 'granted';
}

// ── PII scrubbing ──────────────────────────────────────────────
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/g;
const PII_QUERY_KEYS = new Set([
  'email', 'e-mail', 'phone', 'tel', 'name', 'first_name', 'last_name',
  'fname', 'lname', 'dob', 'ssn', 'address', 'zip', 'token', 'auth',
]);

function scrubString(s) {
  if (typeof s !== 'string') return s;
  return s.replace(EMAIL_RE, '[redacted-email]').replace(PHONE_RE, '[redacted-phone]');
}

function scrubUrl(u) {
  try {
    const url = new URL(u, window.location.origin);
    for (const k of Array.from(url.searchParams.keys())) {
      if (PII_QUERY_KEYS.has(k.toLowerCase())) url.searchParams.set(k, '[redacted]');
    }
    return scrubString(url.toString());
  } catch {
    return scrubString(u);
  }
}

/**
 * Hard-coded PII strip applied to every outbound event payload.
 * Drops anything that looks like an email, phone, or known PII key,
 * even if a future caller accidentally passes user data.
 */
function scrubPayload(props) {
  if (!props || typeof props !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(props)) {
    const key = String(k);
    if (PII_QUERY_KEYS.has(key.toLowerCase())) continue;
    if (key === '$current_url' || key === '$referrer' || key === 'url') {
      out[key] = scrubUrl(String(v ?? ''));
      continue;
    }
    if (typeof v === 'string') out[key] = scrubString(v);
    else if (typeof v === 'number' || typeof v === 'boolean') out[key] = v;
    else if (v && typeof v === 'object') out[key] = scrubPayload(v);
    // functions, symbols, etc. are dropped silently
  }
  return out;
}

// ── PostHog loader ─────────────────────────────────────────────
let posthogReady = false;
const eventQueue = [];

function bootPostHog() {
  if (posthogReady || typeof window === 'undefined') return;
  if (window.posthog && window.posthog.__loaded) {
    posthogReady = true;
    return;
  }
  // Ensure at least one <script> exists so the snippet's
  // insertBefore() call has an anchor (defensive — pages loaded via
  // nav.js always satisfy this, but tests and minimal pages may not).
  if (!document.getElementsByTagName('script').length) {
    document.head.appendChild(document.createElement('script'));
  }
  // Standard PostHog snippet (self-hosted host).
  /* eslint-disable */
  !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
  /* eslint-enable */
  window.posthog.init(POSTHOG_PROJECT_KEY, {
    api_host: POSTHOG_HOST,
    autocapture: false,                // explicit taxonomy only
    capture_pageview: false,            // we fire page_view ourselves
    capture_pageleave: false,
    disable_session_recording: true,    // no replays — extra PII surface
    persistence: trackingAllowed() ? 'localStorage+cookie' : 'memory',
    ip: false,                          // do not store IP
    property_denylist: ['$ip'],
    sanitize_properties: (props) => scrubPayload(props),
    loaded: () => { posthogReady = true; flushQueue(); },
  });
}

function flushQueue() {
  if (!posthogReady || !window.posthog) return;
  while (eventQueue.length) {
    const [name, props] = eventQueue.shift();
    window.posthog.capture(name, props);
  }
}

/**
 * Public event API. Call from page code as window.CDAnalytics.track(...).
 * Silently drops anything not in the canonical taxonomy.
 */
function track(eventName, props = {}) {
  if (!TAXONOMY.has(eventName)) {
    console.warn('[analytics] dropped non-taxonomy event:', eventName);
    return;
  }
  if (!trackingAllowed()) return; // consent gate
  const safe = scrubPayload(props);
  if (!posthogReady) {
    eventQueue.push([eventName, safe]);
    bootPostHog();
    return;
  }
  window.posthog.capture(eventName, safe);
}

// ── Consent banner UI ──────────────────────────────────────────
function renderConsentBanner() {
  if (document.getElementById('cd-consent-banner')) return;
  const el = document.createElement('div');
  el.id = 'cd-consent-banner';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Cookie and analytics consent');
  el.innerHTML = `
    <style>
      #cd-consent-banner {
        position: fixed; left: 16px; right: 16px; bottom: 16px;
        max-width: 720px; margin: 0 auto; z-index: 99999;
        background: #0b1220; color: #e6edf3;
        border: 1px solid #2b3a55; border-radius: 12px;
        padding: 16px 18px; font: 14px/1.45 system-ui, -apple-system, sans-serif;
        box-shadow: 0 10px 30px rgba(0,0,0,0.35);
      }
      #cd-consent-banner p { margin: 0 0 10px; }
      #cd-consent-banner .cd-row { display: flex; gap: 8px; flex-wrap: wrap; }
      #cd-consent-banner button {
        border: 0; border-radius: 8px; padding: 8px 14px;
        font-weight: 600; cursor: pointer;
      }
      #cd-consent-banner .cd-accept { background: #3b82f6; color: white; }
      #cd-consent-banner .cd-deny { background: #1f2a3d; color: #e6edf3; }
      #cd-consent-banner a { color: #93c5fd; }
    </style>
    <p>We use a privacy-first, self-hosted analytics tool (PostHog) to understand
       which calculators and tools are useful. No advertising pixels, no
       cross-site tracking, and no personal information is collected.
       See our <a href="/privacy.html">Privacy Policy</a>.</p>
    <div class="cd-row">
      <button class="cd-accept" type="button">Allow analytics</button>
      <button class="cd-deny" type="button">Decline</button>
    </div>
  `;
  document.body.appendChild(el);
  el.querySelector('.cd-accept').addEventListener('click', () => {
    setConsent('granted');
    el.remove();
  });
  el.querySelector('.cd-deny').addEventListener('click', () => {
    setConsent('denied');
    el.remove();
  });
}

// ── Auto event wiring (heuristic, no PII) ──────────────────────
function pagePath() {
  return scrubUrl(window.location.pathname + window.location.search);
}

function firePageView() {
  track('page_view', {
    $current_url: pagePath(),
    page_title: scrubString(document.title || ''),
  });
}

function wireCalculatorEvents() {
  const isCalc = /\/calculators\//.test(window.location.pathname);
  if (!isCalc) return;
  const calcName = window.location.pathname.split('/').filter(Boolean).pop() || 'unknown';

  let started = false;
  function maybeStart() {
    if (started) return;
    started = true;
    track('calculator_started', { calculator: calcName });
  }
  document.addEventListener('input', (e) => {
    if (e.target && e.target.matches && e.target.matches('input,select,textarea')) {
      maybeStart();
    }
  }, true);

  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    const btn = t.closest('button,[role="button"],input[type="submit"]');
    if (!btn) return;
    const label = (btn.textContent || btn.value || '').trim().toLowerCase();
    if (/calculate|compute|estimate|results?/.test(label)) {
      track('calculator_completed', { calculator: calcName });
    }
  }, true);
}

function wireShareEvents() {
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    const el = t.closest('[data-share-link],[data-cd-share],.share-link,.copy-share');
    if (!el) return;
    track('share_link_generated', { surface: pagePath() });
  }, true);
}

function wireEmailSignup() {
  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (!form || form.tagName !== 'FORM') return;
    const isStory = /\/share-your-story\//.test(window.location.pathname) ||
                    form.matches('[data-cd-form="story"]');
    const hasEmail = !!form.querySelector('input[type="email"],input[name*="email" i]');
    if (isStory) {
      track('story_submitted', { surface: pagePath() });
      return;
    }
    if (hasEmail) {
      track('email_signup', { surface: pagePath() });
    }
  }, true);
}

// ── Bootstrap ──────────────────────────────────────────────────
function init() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__CD_ANALYTICS_INITED) return;
  window.__CD_ANALYTICS_INITED = true;

  // Public surface for page code (and tests).
  window.CDAnalytics = {
    track,
    setConsent,
    getConsent,
    consentRequired,
    trackingAllowed,
    _scrubPayload: scrubPayload, // exposed for tests/audits
    _taxonomy: Array.from(TAXONOMY),
  };

  const start = () => {
    // Show banner if consent is required and not yet decided.
    if (consentRequired() && !getConsent()) {
      renderConsentBanner();
    }
    if (trackingAllowed()) bootPostHog();

    wireCalculatorEvents();
    wireShareEvents();
    wireEmailSignup();
    firePageView();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}

init();

export { track, setConsent, getConsent, scrubPayload, TAXONOMY };
