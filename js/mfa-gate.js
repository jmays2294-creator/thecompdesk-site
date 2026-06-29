/**
 * mfa-gate.js — mandatory-MFA session gate for the website (scope §5.5).
 * Mirrors the admin app's MfaGate (admin-thecompdesk/src/auth/MfaGate.tsx).
 *
 * Calls the mfa-enforcement-check edge fn after login. For a privileged user who
 * hasn't enrolled:
 *   - within grace  → a dismissible top banner "2FA required in N days"
 *   - past deadline → a blocking full-screen interstitial until they enroll
 *                     (links to /account.html where the Phase-4 enroll UI lives)
 *
 * The DATA-LAYER teeth are independent (migration 069, mfa_gate_ok() RLS); this is
 * the UX layer that drives enrollment before those teeth bite. Fail-OPEN on a
 * transient check error (never hard-block on a flaky call) — the RLS is the real
 * enforcement.
 *
 * Usage (privileged web surfaces only — e.g. the attorney/firm dashboard):
 *   import { enforceMfaGate } from '/js/mfa-gate.js';
 *   enforceMfaGate();
 */

import { supabase } from './auth.js';

async function checkMfaEnforcement() {
  const fallback = { required: false, enrolled: false, grace_deadline: null, within_grace: false, must_enroll_now: false, days_left: 0 };
  try {
    const { data, error } = await supabase.functions.invoke('mfa-enforcement-check', { body: {} });
    if (error || !data) { console.error('[mfa-gate] ENFORCEMENT_CHECK_FAILED', error); return fallback; }
    return { ...fallback, ...data };
  } catch (e) {
    console.error('[mfa-gate] ENFORCEMENT_CHECK_THREW', e);
    return fallback;
  }
}

function renderSoftBanner(daysLeft) {
  if (document.getElementById('mfa-soft-banner')) return;
  const bar = document.createElement('div');
  bar.id = 'mfa-soft-banner';
  bar.setAttribute('role', 'status');
  bar.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:99998',
    'background:#7c5e10', 'color:#fde68a', 'font-family:system-ui,-apple-system,sans-serif',
    'font-size:14px', 'padding:10px 16px', 'text-align:center', 'box-shadow:0 2px 8px rgba(0,0,0,.25)'
  ].join(';');
  bar.innerHTML = `Two-factor authentication is required for your account. <strong>Set it up within ${daysLeft} day${daysLeft === 1 ? '' : 's'}</strong> to keep access. <a href="/account.html" style="color:#fff;text-decoration:underline;font-weight:600;">Set up now →</a>`;
  document.body.appendChild(bar);
}

function renderHardInterstitial() {
  if (document.getElementById('mfa-hard-gate')) return;
  const overlay = document.createElement('div');
  overlay.id = 'mfa-hard-gate';
  overlay.setAttribute('role', 'alertdialog');
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99999', 'background:rgba(6,8,15,0.96)',
    'display:flex', 'align-items:center', 'justify-content:center', 'padding:24px',
    'font-family:system-ui,-apple-system,sans-serif', 'color:#dce4f0'
  ].join(';');
  overlay.innerHTML = `
    <div style="max-width:440px;background:#0e1322;border:1px solid #1c2d4a;border-radius:12px;padding:28px;text-align:center;">
      <h1 style="font-size:1.4rem;color:#f4f6fa;margin:0 0 0.75rem;">Two-factor authentication required</h1>
      <p style="color:#8899b4;font-size:0.95rem;line-height:1.6;margin:0 0 1.5rem;">
        Your role requires two-factor authentication, and the grace period has ended.
        Set it up to continue using your account.
      </p>
      <a href="/account.html" style="display:inline-block;background:#4f8ff7;color:#fff;font-weight:600;padding:0.7rem 1.5rem;border-radius:8px;text-decoration:none;">Set up two-factor</a>
    </div>`;
  document.body.appendChild(overlay);
  document.documentElement.style.overflow = 'hidden';
}

/**
 * Run the gate. No-ops for signed-out or non-privileged users.
 * @param {Object} [opts]
 * @param {boolean} [opts.hardBlock=true] - render the blocking interstitial past grace.
 */
export async function enforceMfaGate(opts = {}) {
  const hardBlock = opts.hardBlock !== false;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return; // signed-out: nothing to enforce here
  } catch (_) { return; }

  const enf = await checkMfaEnforcement();
  if (!enf.required || enf.enrolled) return; // unaffected
  if (enf.must_enroll_now && hardBlock) renderHardInterstitial();
  else if (enf.within_grace) renderSoftBanner(enf.days_left);
}

export { checkMfaEnforcement };
