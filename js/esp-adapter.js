/*
 * ESP Adapter — pluggable email service provider interface.
 *
 * The Comp Desk site is ESP-agnostic. ConvertKit vs Customer.io (or anything
 * else) is not yet selected. Every email capture on the site goes through
 * CompBuddyESP.subscribe({ email, source, metadata }), which forwards to
 * whichever adapter is wired in window.CompBuddyESP.adapter.
 *
 * To wire a real ESP later, implement the Adapter interface below and assign:
 *     window.CompBuddyESP.adapter = new ConvertKitAdapter({ apiKey, formId });
 * No capture component code needs to change.
 *
 * Adapter interface:
 *   async subscribe({ email, source, tags, metadata }) -> { ok, id?, error? }
 *
 * Required behaviors of any real adapter:
 *   - Trigger ESP-side double opt-in (do not mark confirmed client-side).
 *   - Apply the source tag (footer | exit-intent | post-calculator | <other>).
 *   - Apply any additional tags passed in (e.g., calculator name).
 *   - Trigger the Comp Buddy welcome sequence on confirmation (ESP-side
 *     automation, not from this client).
 *   - Never include a founder name or human signature in any email.
 */
(function () {
  'use strict';

  const VALID_SOURCES = new Set([
    'footer',
    'exit-intent',
    'post-calculator',
  ]);

  // Default no-op adapter. Logs to console and POSTs to /api/subscribe if
  // present, so capture works in dev without an ESP wired up. Replace before
  // turning on paid traffic.
  class StubAdapter {
    constructor() {
      this.name = 'stub';
    }
    async subscribe(payload) {
      try {
        // Best-effort POST to a future server endpoint. Failure is non-fatal
        // in stub mode — we still return ok so the UX path is testable.
        if (typeof fetch === 'function') {
          await fetch('/api/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }).catch(() => {});
        }
        // eslint-disable-next-line no-console
        console.info('[CompBuddyESP:stub] captured', payload);
        return { ok: true, id: 'stub-' + Date.now() };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    }
  }

  function isValidEmail(email) {
    return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  const CompBuddyESP = {
    adapter: new StubAdapter(),

    setAdapter(adapter) {
      if (!adapter || typeof adapter.subscribe !== 'function') {
        throw new Error('CompBuddyESP: adapter must implement subscribe()');
      }
      this.adapter = adapter;
    },

    async subscribe({ email, source, tags = [], metadata = {} } = {}) {
      if (!isValidEmail(email)) {
        return { ok: false, error: 'invalid_email' };
      }
      if (!VALID_SOURCES.has(source)) {
        return { ok: false, error: 'invalid_source' };
      }
      const payload = {
        email: email.trim().toLowerCase(),
        source,
        tags: Array.from(new Set([source, ...tags])),
        metadata: {
          ...metadata,
          page: typeof location !== 'undefined' ? location.pathname : null,
          ts: new Date().toISOString(),
        },
      };
      return this.adapter.subscribe(payload);
    },
  };

  if (typeof window !== 'undefined') {
    window.CompBuddyESP = CompBuddyESP;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CompBuddyESP;
  }
})();
