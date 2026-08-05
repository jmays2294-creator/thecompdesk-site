/**
 * supabase-client.js — the one and only browser Supabase client.
 *
 * Why this module exists
 * ──────────────────────
 * `auth.js`, `entitlements.js` and `attorney-signup.js` each used to call
 * `createClient()` against the same URL and anon key. Any page importing two of
 * them got two `GoTrueClient` instances sharing ONE `localStorage` key and ONE
 * `navigator.locks` lock name. They then contend over token refresh, and
 * `getSession()` can block indefinitely waiting on a lock the sibling instance
 * holds — an independent way to reproduce the exact "Verifying your
 * subscription…" hang that took My Cases down on 2026-08-05.
 *
 * The browser console announces this as:
 *   "Multiple GoTrueClient instances detected in the same browser context."
 * That warning is not cosmetic. Treat it as a bug.
 *
 * Import the shared client from here. Never call createClient() anywhere else.
 *
 * The version below is PINNED deliberately. Every import across the site used
 * to resolve an unpinned major (the "/+esm" and "@2" forms), meaning the day
 * upstream publishes a breaking change, every authenticated page on the site
 * breaks at once with no deploy on our side. Bump this on purpose, never by
 * accident — and when you do, bump it everywhere:
 *     grep -rn "supabase-js@" --include="*.html" --include="*.js" .
 */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.1/+esm';

export const SUPABASE_URL = 'https://ltibymvlytodkemdeeox.supabase.co';

// Anon key — safe to ship to the browser by design. Row Level Security is what
// protects the data; this key only identifies the project.
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0aWJ5bXZseXRvZGtlbWRlZW94Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MjA1NjYsImV4cCI6MjA5MDM5NjU2Nn0.b5oQqQIdgJRc0DEP2k7kMVdCRzfyfnuAwjVNZlbVyak';

/**
 * Survive double-evaluation of this module.
 *
 * The site is served with a mix of root-absolute ("/js/supabase-client.js") and
 * relative ("../js/supabase-client.js") specifiers. Those are DIFFERENT module
 * keys to the browser even when they resolve to the same file, so the module
 * can genuinely be instantiated twice — which would reintroduce the very
 * problem this file exists to remove. Parking the instance on `globalThis`
 * makes the singleton hold across both graphs.
 */
const GLOBAL_KEY = '__tcd_supabase_client__';

function build() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // Explicit, so a future default change upstream cannot silently split
      // this client's storage from a stale one still in a cached page.
      storageKey: 'sb-ltibymvlytodkemdeeox-auth-token',
    },
  });
}

export const supabase = globalThis[GLOBAL_KEY] ?? (globalThis[GLOBAL_KEY] = build());

export default supabase;
