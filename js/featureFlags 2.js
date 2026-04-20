/**
 * featureFlags.js
 *
 * Central feature flag registry for The Comp Desk.
 *
 * PRO_ENABLED controls the entire Pro Tier paywall:
 *   false (default) — /pricing shows "Coming soon", upgrade buttons are disabled,
 *                     requirePro() is a no-op (no one is gated out).
 *   true            — paywall is live; requirePro() throws 402 for free users.
 *
 * To activate: set PRO_ENABLED = true after pasting Stripe secrets tonight.
 */

export const PRO_ENABLED = false;

/**
 * All feature flags in one object for easy inspection / future tooling.
 */
export const FLAGS = {
  PRO_ENABLED,
};
