/**
 * entitlements.js
 *
 * Client-side entitlement helpers for the Pro Tier paywall.
 *
 * Usage (ES module):
 *   import { getEntitlement, requirePro } from '/js/entitlements.js';
 *
 *   const { tier, features } = await getEntitlement(userId);
 *   await requirePro(userId);  // throws PaywallError (402) if gated; no-op if PRO_ENABLED=false
 */

import { PRO_ENABLED } from '/js/featureFlags.js';

// The ONE shared client — see js/supabase-client.js. This module used to build
// its own, which meant any page importing both auth.js and entitlements.js ran
// two GoTrueClient instances contending over the same auth storage and lock.
import { supabase } from '/js/supabase-client.js';

/**
 * Error thrown by requirePro() when a free user tries to access a Pro feature
 * and PRO_ENABLED is true.
 */
export class PaywallError extends Error {
  constructor(message = 'Pro subscription required') {
    super(message);
    this.name = 'PaywallError';
    this.status = 402;
  }
}

/**
 * Fetch the entitlement record for a given user.
 *
 * @param {string} userId — auth.users UUID
 * @returns {Promise<{tier: string, features: Object}>}
 *   Always resolves; returns { tier: 'free', features: {} } on any error.
 */
export async function getEntitlement(userId) {
  if (!userId) return { tier: 'free', features: {} };

  try {
    const { data, error } = await supabase
      .from('entitlements')
      .select('tier, features')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      console.warn('entitlements: could not fetch row for', userId, error?.message);
      return { tier: 'free', features: {} };
    }

    return {
      tier:     data.tier     || 'free',
      features: data.features || {},
    };
  } catch (err) {
    console.error('entitlements: unexpected error', err);
    return { tier: 'free', features: {} };
  }
}

/**
 * Assert that the current user holds a Pro entitlement.
 *
 * Behaviour:
 *   PRO_ENABLED = false  → no-op; always resolves (paywall is dormant)
 *   PRO_ENABLED = true   → resolves if tier === 'pro'; throws PaywallError (402) otherwise
 *
 * @param {string} userId — auth.users UUID
 * @throws {PaywallError} status 402 when gated
 */
export async function requirePro(userId) {
  if (!PRO_ENABLED) {
    // Paywall is dormant — pass everyone through.
    return;
  }

  const { tier } = await getEntitlement(userId);

  if (tier !== 'pro') {
    throw new PaywallError('A Pro subscription is required to access this feature.');
  }
}

/**
 * Convenience: check whether user has Pro access without throwing.
 *
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
export async function isPro(userId) {
  if (!PRO_ENABLED) return true; // paywall dormant → treat everyone as having access
  const { tier } = await getEntitlement(userId);
  return tier === 'pro';
}

/**
 * Convenience: get the current authenticated user's ID from Supabase session.
 * Returns null if not authenticated.
 *
 * @returns {Promise<string|null>}
 */
export async function getCurrentUserId() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}
