/**
 * security.js — Account-security helpers for the website (Phase 1: Change Password).
 *
 * Reuses the shared Supabase client + conventions from auth.js. Adds NO new
 * dependency. Does NOT touch sign-in, sign-up, getEffectiveTier, requireAuth, or
 * the firm-invite set-password modal.
 *
 * Fail-loud contract (Database Operations Playbook, ops/dev/CLAUDE.md): every
 * error branch logs a sentinel-prefixed console.error and surfaces a throw the
 * caller turns into a visible message — no silent default.
 */

import { supabase } from './auth.js';

const PRIVILEGED_ADMIN_ROLES = ['owner', 'builder', 'reviewer', 'marketplace_contributor'];

/**
 * Is the signed-in user a privileged account (admin role or firm tier)?
 * Drives the stronger password-length floor (12 vs 10). Uses the EXISTING role
 * helpers only: get_my_admin_role() (migration 028) + get_my_entitlement() (026).
 * On any failure, returns false (the lenient floor) but logs loudly — we never
 * want a transient RPC error to lock a normal user out behind a 12-char rule.
 * @returns {Promise<boolean>}
 */
async function getIsPrivileged() {
  try {
    const { data, error } = await supabase.rpc('get_my_admin_role');
    if (error) {
      console.error('[security] ROLE_CHECK_FAILED', error);
    } else if (data && PRIVILEGED_ADMIN_ROLES.includes(data)) {
      return true;
    }
  } catch (err) {
    console.error('[security] ROLE_CHECK_FAILED', err);
  }
  // Firm-tier accounts also get the stronger floor.
  try {
    const { data: tier, error } = await supabase.rpc('get_my_entitlement');
    if (!error && tier === 'firm') return true;
  } catch (_) {
    // best-effort; admin-role check above is the primary signal.
  }
  return false;
}

/**
 * Record a security-sensitive event. Phase 3 will deploy a `security-audit-log`
 * Edge Function (service_role) as the ONLY writer of auth_security_audit — a
 * direct client INSERT is denied by RLS (the table has no authenticated insert
 * policy by design). Until that function exists this is a forward-compatible
 * stub: it attempts the invoke and, if absent, marks the event loudly so the gap
 * is visible in logs rather than silently dropped.
 * @param {string} event
 * @param {Object} [metadata]
 * @returns {Promise<boolean>} true if the audit row was written
 */
async function logSecurityEvent(event, metadata = {}) {
  try {
    const { error } = await supabase.functions.invoke('security-audit-log', {
      body: { event, surface: 'web', metadata }
    });
    if (error) throw error;
    return true;
  } catch (err) {
    // TODO(Phase 3): once the `security-audit-log` edge fn is deployed (writes
    // auth_security_audit via service_role), this stub becomes a real append.
    console.warn(
      `[security] AUDIT_LOG_TODO event=${event} surface=web — ` +
      'security-audit-log edge fn not deployed yet; event not persisted.',
      metadata
    );
    return false;
  }
}

/**
 * Change the signed-in user's password.
 *
 * Steps:
 *   1. Validate (all fields present; new === confirm; new !== current).
 *   2. Resolve the user + email from the live session.
 *   3. Enforce length floor: 10 chars, or 12 for privileged accounts.
 *   4. Re-verify the CURRENT password via signInWithPassword (proves possession).
 *   5. auth.updateUser({ password }) — Supabase additionally enforces its own
 *      min length + the HIBP leaked-password check (already enabled); its error
 *      message is surfaced verbatim.
 *   6. Write 'password_changed' to the audit path; optionally sign out other
 *      sessions; return.
 *
 * Throws an Error (with a user-safe message) on every failure branch.
 *
 * @param {Object} args
 * @param {string} args.currentPassword
 * @param {string} args.newPassword
 * @param {string} args.confirmPassword
 * @param {boolean} [args.signOutOthers=false]
 * @returns {Promise<{ok: true, privileged: boolean}>}
 */
async function changePassword({ currentPassword, newPassword, confirmPassword, signOutOthers = false }) {
  // 1. Presence + match + difference
  if (!currentPassword || !newPassword || !confirmPassword) {
    throw new Error('Please fill in all three password fields.');
  }
  if (newPassword !== confirmPassword) {
    throw new Error('Your new password and confirmation do not match.');
  }
  if (newPassword === currentPassword) {
    throw new Error('Your new password must be different from your current password.');
  }

  // 2. Resolve the user (need the email to re-verify)
  let email = null;
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user || !user.email) throw error || new Error('no user/email on session');
    email = user.email;
  } catch (err) {
    console.error('[security] CHANGE_PW_NO_USER', err);
    throw new Error('We could not confirm your session. Please sign in again and retry.');
  }

  // 3. Length policy (privileged accounts get a higher floor)
  const privileged = await getIsPrivileged();
  const minLen = privileged ? 12 : 10;
  if (newPassword.length < minLen) {
    throw new Error(
      `Your new password must be at least ${minLen} characters` +
      (privileged ? ' for privileged accounts.' : '.')
    );
  }

  // 4. Re-verify the current password (fail loud on mismatch)
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
    if (error) throw error;
  } catch (err) {
    console.error('[security] CHANGE_PW_REVERIFY_FAILED', err);
    throw new Error('Your current password is incorrect.');
  }

  // 5. Update — Supabase enforces its own min length + HIBP leaked-password check
  try {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
  } catch (err) {
    console.error('[security] CHANGE_PW_UPDATE_FAILED', err);
    // Surface Supabase's own message (e.g. leaked-password rejection, reuse).
    throw new Error(err && err.message ? err.message : 'We could not update your password. Please try again.');
  }

  // 6. Audit + optional "sign out other devices"
  await logSecurityEvent('password_changed', { privileged, signed_out_others: !!signOutOthers });

  if (signOutOthers) {
    try {
      const { error } = await supabase.auth.signOut({ scope: 'others' });
      if (error) throw error;
    } catch (err) {
      // Non-fatal: the password DID change. Log loud, don't fail the whole op.
      console.error('[security] SIGNOUT_OTHERS_FAILED', err);
    }
  }

  return { ok: true, privileged };
}

export { changePassword, logSecurityEvent, getIsPrivileged };
