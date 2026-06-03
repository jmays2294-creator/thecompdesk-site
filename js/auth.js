/**
 * auth.js - Shared Authentication Module
 * Provides Supabase client and auth utilities for all protected pages
 */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// Supabase client configuration
const supabaseUrl = 'https://ltibymvlytodkemdeeox.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0aWJ5bXZseXRvZGtlbWRlZW94Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MjA1NjYsImV4cCI6MjA5MDM5NjU2Nn0.b5oQqQIdgJRc0DEP2k7kMVdCRzfyfnuAwjVNZlbVyak';

// Initialize Supabase client
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ────────────────────────────────────────────────────────────────────────
// Tier-fetch error tracking — restored 2026-05-13 per smoke test Bug A3.
// Apr 27 incident encoded in CLAUDE.md "Database Operations Playbook →
// Application code — fail loud, not silent": any DB read whose error path
// silently degrades the user experience MUST surface the error.
// ────────────────────────────────────────────────────────────────────────
let _lastTierFetchError = null;

function getLastTierFetchError() {
  return _lastTierFetchError;
}

// Non-blocking toast for tier-fetch failures. Renders without depending on
// any other UI scaffolding so it works on every page that imports auth.js.
function showNonBlockingToast(message) {
  try {
    if (typeof document === 'undefined') return;
    const existing = document.getElementById('auth-tier-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'auth-tier-toast';
    toast.setAttribute('role', 'alert');
    toast.style.cssText = [
      'position:fixed','bottom:24px','right:24px','z-index:99999',
      'background:rgba(239,68,68,0.95)','color:#fff',
      'padding:12px 18px','border-radius:8px','max-width:360px',
      'font-family:system-ui,-apple-system,sans-serif','font-size:13px',
      'line-height:1.5','box-shadow:0 4px 20px rgba(0,0,0,0.3)',
      'border:1px solid rgba(255,255,255,0.15)'
    ].join(';');
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 8000);
  } catch (_) {
    // Toast is best-effort; never let UI rendering errors mask the underlying issue.
  }
}

// Tier constants
const TIERS = {
  FREE: 'free',
  COMP_BUDDY: 'comp_buddy',
  PRO: 'pro',
  FIRM: 'firm'
};

// Tier hierarchy for access control
const TIER_LEVEL = {
  free: 0,
  comp_buddy: 1,
  pro: 2,
  firm: 3
};

/**
 * Check for active session and redirect if not authenticated
 * @returns {Object|null} Session object if authenticated, null otherwise
 */
async function requireAuth() {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();

    if (error || !session) {
      const currentPath = window.location.pathname + window.location.search;
      const redirectUrl = `/auth_v2.html?redirect=${encodeURIComponent(currentPath)}`;
      window.location.href = redirectUrl;
      return null;
    }

    return session;
  } catch (err) {
    console.error('Auth check failed:', err);
    window.location.href = '/auth_v2.html';
    return null;
  }
}

/**
 * Canonical effective-tier resolver — the single source of truth for
 * entitlement shared by the website and the native app.
 *
 * Calls the server-side `get_my_entitlement()` RPC (migration 026), which
 * computes the tier under definer rights from firm_members + profiles. Running
 * the rule on the server makes it immune to the client-side JWT-hydration /
 * early-empty-read race that produced the recurring "My Cases" paywall: the
 * RPC either returns a definitive tier or the call fails — it never silently
 * degrades a paying user to 'free'.
 *
 * Returns a TRI-STATE so callers can tell "confirmed free" from "couldn't
 * determine":
 *   - 'free' | 'comp_buddy' | 'pro' | 'firm'  → a CONFIRMED tier
 *   - null                                    → UNKNOWN (transient/RPC failure)
 *
 * Gates MUST treat null as "do not paywall" (fail open to the UI shell; data
 * stays RLS-protected) rather than as "free".
 *
 * @param {Object} session - Auth session object
 * @param {number} [retries=2] - retry attempts on transient failure
 * @returns {Promise<string|null>}
 */
async function getEffectiveTier(session, retries = 2) {
  // Not signed in is DEFINITIVELY free, not "unknown".
  if (!session || !session.user) {
    _lastTierFetchError = null;
    return TIERS.FREE;
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { data, error } = await supabase.rpc('get_my_entitlement');
      if (!error && typeof data === 'string' && data) {
        _lastTierFetchError = null;
        return data;
      }
      _lastTierFetchError = error || new Error('get_my_entitlement returned no tier');
    } catch (err) {
      _lastTierFetchError = err;
    }
    // Brief backoff — covers the JWT-not-yet-hydrated window after sign-in.
    if (attempt < retries) {
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }

  // Could not determine after retries. Fail LOUD per the Apr 27 playbook, but
  // return null (UNKNOWN) — NOT 'free' — so the caller does not false-paywall.
  console.error('[auth] ENTITLEMENT_FETCH_FAILED', _lastTierFetchError);
  if (typeof window !== 'undefined' && window.dispatchEvent) {
    window.dispatchEvent(new CustomEvent('auth:tier-fetch-error', { detail: _lastTierFetchError }));
  }
  showNonBlockingToast(
    "We couldn't verify your subscription yet. Retrying — paid features will unlock automatically."
  );
  return null;
}

/**
 * Fetch user tier (backward-compatible). Delegates to the canonical
 * getEffectiveTier() RPC resolver. Preserves the legacy contract that every
 * caller of getUserTier() expects: a concrete tier string, degrading to 'free'
 * when the tier can't be determined (the loud failure already fired inside
 * getEffectiveTier). New gates that must not false-paywall should call
 * getEffectiveTier() directly and handle the null/unknown case.
 * @param {Object} session - Auth session object
 * @returns {Promise<string>} User's role/tier, defaults to 'free'
 */
async function getUserTier(session) {
  const tier = await getEffectiveTier(session);
  return tier == null ? TIERS.FREE : tier;
}

/**
 * Check if user tier has access to required tier(s)
 * Uses hierarchy-based checking: free(0) < comp_buddy(1) < pro(2) < firm(3)
 * @param {string} userRole - User's current role
 * @param {string|string[]} requiredTiers - Required tier(s) for access
 * @returns {boolean} True if user has sufficient access level
 */
function hasAccess(userRole, requiredTiers) {
  const userLevel = TIER_LEVEL[userRole] ?? TIER_LEVEL.free;
  const required = Array.isArray(requiredTiers) ? requiredTiers : [requiredTiers];

  // Check if user's tier level meets or exceeds any of the required tier levels
  return required.some(tier => {
    const requiredLevel = TIER_LEVEL[tier] ?? TIER_LEVEL.free;
    return userLevel >= requiredLevel;
  });
}

/**
 * Main entry point: Get current user and tier
 * Requires authentication — redirects to login if not signed in.
 * Use getOptionalUser() for public/calculator pages.
 * @returns {Promise<Object>} Object with session and tier properties
 */
async function getUser() {
  const session = await requireAuth();

  if (!session) {
    return null;
  }

  const tier = await getUserTier(session);

  return {
    session,
    tier
  };
}

/**
 * Get current user and tier without requiring authentication.
 * Returns { session: null, tier: 'free' } for unauthenticated visitors.
 * Use this on public/calculator pages instead of getUser().
 * @returns {Promise<Object>} Object with session (nullable) and tier
 */
async function getOptionalUser() {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session) {
      return { session: null, tier: TIERS.FREE };
    }
    const tier = await getUserTier(session);
    return { session, tier };
  } catch (err) {
    return { session: null, tier: TIERS.FREE };
  }
}

/**
 * Save a calculation to the user's history in Supabase.
 * Writes to calculation_history — shared with the native app for cross-platform sync.
 * No-ops silently if user is not logged in.
 * @param {string} userId - The authenticated user's ID
 * @param {string} calcType - Calculator type key (e.g. 'slu', 'ccp_award', 'aww')
 * @param {Object} data - Object with { caseName, inputData, resultData }
 * @returns {Promise<boolean>} True if saved successfully
 */
async function saveCalculation(userId, calcType, data) {
  if (!userId) return false;
  try {
    const { error } = await supabase
      .from('calculation_history')
      .insert({
        user_id: userId,
        calculator_type: calcType,
        case_name: data.caseName || null,
        input_data: data.inputData || data,
        result_data: data.resultData || null
      });
    return !error;
  } catch (err) {
    console.error('Failed to save calculation:', err);
    return false;
  }
}

/**
 * Get all distinct case names for the current user with summary stats.
 * Returns an array of { case_name, calc_count, last_saved, calculators, latest_aww, latest_doa }
 * sorted by most recently saved first.
 * @param {string} userId
 * @returns {Promise<Array>}
 */
async function getUserCases(userId) {
  if (!userId) return [];
  try {
    const { data, error } = await supabase
      .from('calculation_history')
      .select('id, case_name, calculator_type, input_data, result_data, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error || !data) return [];

    // Group by case_name
    const caseMap = {};
    data.forEach(row => {
      const cn = row.case_name || '(Unsaved)';
      if (!caseMap[cn]) {
        caseMap[cn] = {
          case_name: cn,
          calc_count: 0,
          last_saved: row.created_at,
          calculators: new Set(),
          calculations: [],
          latest_aww: null,
          latest_doa: null
        };
      }
      caseMap[cn].calc_count++;
      caseMap[cn].calculators.add(row.calculator_type);
      caseMap[cn].calculations.push(row);

      // Extract AWW and DOA from input_data if available
      const inp = row.input_data;
      if (inp) {
        if (inp.aww && !caseMap[cn].latest_aww) caseMap[cn].latest_aww = inp.aww;
        if (inp.doa && !caseMap[cn].latest_doa) caseMap[cn].latest_doa = inp.doa;
        if (inp.doi && !caseMap[cn].latest_doa) caseMap[cn].latest_doa = inp.doi;
      }
    });

    // Convert sets to arrays, sort by last_saved
    return Object.values(caseMap)
      .map(c => ({ ...c, calculators: Array.from(c.calculators) }))
      .sort((a, b) => new Date(b.last_saved) - new Date(a.last_saved));
  } catch (err) {
    console.error('Failed to fetch user cases:', err);
    return [];
  }
}

/**
 * Get all calculations for a specific case name.
 * @param {string} userId
 * @param {string} caseName
 * @returns {Promise<Array>}
 */
async function getCaseCalculations(userId, caseName) {
  if (!userId) return [];
  try {
    const query = supabase
      .from('calculation_history')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (caseName && caseName !== '(Unsaved)') {
      query.eq('case_name', caseName);
    } else {
      query.is('case_name', null);
    }

    const { data, error } = await query;
    return error ? [] : (data || []);
  } catch (err) {
    console.error('Failed to fetch case calculations:', err);
    return [];
  }
}

/**
 * Delete a single calculation by ID.
 * @param {string} calcId
 * @returns {Promise<boolean>}
 */
async function deleteCalculation(calcId) {
  if (!calcId) return false;
  try {
    const { error } = await supabase
      .from('calculation_history')
      .delete()
      .eq('id', calcId);
    return !error;
  } catch (err) {
    console.error('Failed to delete calculation:', err);
    return false;
  }
}

/**
 * Sign out user and redirect to home
 */
async function signOut() {
  try {
    await supabase.auth.signOut();
    window.location.href = '/';
  } catch (err) {
    console.error('Sign out failed:', err);
    window.location.href = '/';
  }
}

// Export public API
export {
  supabase,
  requireAuth,
  getUserTier,
  getEffectiveTier,
  getLastTierFetchError,
  hasAccess,
  getUser,
  getOptionalUser,
  saveCalculation,
  getUserCases,
  getCaseCalculations,
  deleteCalculation,
  signOut,
  TIERS,
  TIER_LEVEL
};
