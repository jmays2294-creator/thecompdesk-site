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
 * Fetch user tier from user_profiles table
 * @param {Object} session - Auth session object
 * @returns {Promise<string>} User's role/tier, defaults to 'free'
 */
async function getUserTier(session) {
  if (!session || !session.user) {
    return TIERS.FREE;
  }

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('subscription_tier')
      .eq('id', session.user.id)
      .single();

    if (error) {
      console.warn('Could not fetch user tier:', error);
      return TIERS.FREE;
    }

    return data?.subscription_tier || TIERS.FREE;
  } catch (err) {
    console.error('Error fetching user tier:', err);
    return TIERS.FREE;
  }
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
  hasAccess,
  getUser,
  getOptionalUser,
  saveCalculation,
  signOut,
  TIERS,
  TIER_LEVEL
};
