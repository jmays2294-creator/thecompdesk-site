/**
 * social-auth.js — "Continue with Google / Apple" for the website.
 *
 * Deliberately a CLASSIC script (no ESM), exposing window.TCDSocialAuth. The
 * three live sign-in surfaces — auth_v2.html, auth/login.html, auth/signup.html
 * — all build their Supabase client from the UMD bundle as a plain global.
 * Shipping this as a module would mean converting all three, and a failed
 * module import takes the whole page down (see the 2026-08-05 my-cases
 * incident). A classic script that fails to load costs the buttons, not the
 * password form underneath them.
 *
 * Why the website needs work the iOS app did not
 * ──────────────────────────────────────────────
 * Native iOS uses signInWithIdToken, which validates against the provider's
 * Client IDs list alone — which is why iOS shipped with an empty Apple secret.
 * The web uses the OAuth redirect flow, which DOES require the signed client
 * secret on the Supabase provider. The app working proves nothing about the web.
 *
 * Flow shape (verified 2026-08-05, do not assume):
 * signInWithOAuth on this project produces an authorize URL with NO
 * code_challenge — the implicit flow. Tokens come back in the URL FRAGMENT,
 * and supabase-js consumes them via detectSessionInUrl. exchangeCodeForSession
 * is therefore not the path here; auth/callback.html keeps a defensive ?code=
 * branch only in case flowType is ever switched to 'pkce'.
 */
(function () {
  'use strict';

  var CALLBACK_PATH = '/auth/callback';

  /**
   * Providers rendered on the sign-in surfaces.
   *
   * Apple requires a signed ES256 client secret (a JWT, NOT the raw .p8) on the
   * Supabase provider. Without it, Supabase answers /authorize?provider=apple
   * with: {"code":400,"error_code":"validation_failed",
   *        "msg":"Unsupported provider: missing OAuth secret"}
   * and the user lands on raw JSON. If Apple sign-in starts failing that way,
   * the secret has almost certainly EXPIRED — Apple caps the JWT at 6 months,
   * so this is a recurring maintenance event, not a one-time setup step.
   */
  var PROVIDERS = {
    google: { enabled: true, label: 'Continue with Google' },
    apple:  { enabled: true, label: 'Continue with Apple' },
  };

  // Official Google "G" — four-colour mark, per Google's branding guidelines.
  var GOOGLE_MARK =
    '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">' +
    '<path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62z"/>' +
    '<path fill="#34A853" d="M9 18c2.43 0 4.47-.81 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.35 0-4.34-1.58-5.05-3.71H.96v2.33A9 9 0 0 0 9 18z"/>' +
    '<path fill="#FBBC05" d="M3.95 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l2.99-2.33z"/>' +
    '<path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l2.99 2.33C4.66 5.16 6.65 3.58 9 3.58z"/>' +
    '</svg>';

  // Apple logo glyph. Per Apple's Human Interface Guidelines the mark must keep
  // its proportions and sit on a solid black (or solid white) button.
  var APPLE_MARK =
    '<svg width="18" height="18" viewBox="0 0 814 1000" aria-hidden="true" focusable="false">' +
    '<path fill="currentColor" d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zM554.1 159.4c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"/>' +
    '</svg>';

  /**
   * Where the provider should send the user back to. Always our own callback,
   * carrying the caller's post-login destination as ?next= so a user bounced to
   * sign-in from /dashboard/my-cases lands back there rather than on /account.
   */
  function callbackUrl(nextUrl) {
    var next = nextUrl || '/dashboard/';
    return window.location.origin + CALLBACK_PATH + '?next=' + encodeURIComponent(next);
  }

  function buttonHtml(provider) {
    var cfg = PROVIDERS[provider];
    if (!cfg || !cfg.enabled) return '';

    var isApple = provider === 'apple';
    var base =
      'width:100%;display:flex;align-items:center;justify-content:center;gap:10px;' +
      'padding:11px 16px;border-radius:8px;font-family:inherit;font-size:14px;' +
      'font-weight:600;cursor:pointer;margin-bottom:10px;line-height:20px;' +
      'transition:filter .12s,box-shadow .12s;';

    // Apple: solid black, white mark + text. Google: white surface, dark text.
    var skin = isApple
      ? 'background:#000;color:#fff;border:1px solid #000;'
      : 'background:#fff;color:#1f1f1f;border:1px solid #dadce0;';

    return (
      '<button type="button" class="tcd-social-btn" data-provider="' + provider + '" ' +
      'style="' + base + skin + '">' +
      (isApple ? APPLE_MARK : GOOGLE_MARK) +
      '<span>' + cfg.label + '</span>' +
      '</button>'
    );
  }

  /**
   * The full block: provider buttons, an "or" divider, and a live region for
   * errors. Returns '' when no provider is enabled, so the caller never renders
   * a stray divider above nothing.
   */
  function render() {
    var buttons = Object.keys(PROVIDERS).map(buttonHtml).join('');
    if (!buttons.trim()) return '';

    return (
      '<div class="tcd-social-block">' +
      buttons +
      '<div class="tcd-social-err" role="alert" style="display:none;font-size:12px;' +
      'color:#ef4444;margin:2px 0 10px;text-align:center;"></div>' +
      '<div style="display:flex;align-items:center;gap:10px;margin:14px 0 16px;">' +
      '<span style="flex:1;height:1px;background:var(--bd,#1c2d4a);"></span>' +
      '<span style="font-size:11px;color:var(--txM,#5a6a82);text-transform:uppercase;' +
      'letter-spacing:.5px;">or</span>' +
      '<span style="flex:1;height:1px;background:var(--bd,#1c2d4a);"></span>' +
      '</div></div>'
    );
  }

  function showError(scope, message) {
    var box = scope && scope.querySelector('.tcd-social-err');
    if (!box) { window.alert(message); return; }
    box.textContent = message;
    box.style.display = 'block';
  }

  /**
   * Kick off the redirect. Never throws — a failure here must leave the
   * email/password form beneath it fully usable.
   */
  async function signIn(client, provider, nextUrl, scope) {
    var btn = scope && scope.querySelector('[data-provider="' + provider + '"]');
    try {
      if (!client || !client.auth || typeof client.auth.signInWithOAuth !== 'function') {
        showError(scope, 'Sign-in is unavailable right now. Please use email and password below.');
        return;
      }
      if (btn) { btn.disabled = true; btn.style.filter = 'brightness(.85)'; }

      var res = await client.auth.signInWithOAuth({
        provider: provider,
        options: { redirectTo: callbackUrl(nextUrl) },
      });

      if (res && res.error) {
        console.error('[social-auth] ' + provider + ' sign-in failed:', res.error);
        showError(scope, res.error.message || 'Could not start sign-in. Please try again.');
        if (btn) { btn.disabled = false; btn.style.filter = ''; }
      }
      // On success the browser navigates away; nothing further to do.
    } catch (e) {
      console.error('[social-auth] ' + provider + ' threw:', e);
      showError(scope, 'Could not start sign-in. Please use email and password below.');
      if (btn) { btn.disabled = false; btn.style.filter = ''; }
    }
  }

  /**
   * Wire every rendered block on the page. Safe to call repeatedly — auth_v2
   * re-renders its card on every mode switch, so this runs after each render.
   */
  function bind(client, nextUrl, root) {
    var scope = root || document;
    var blocks = scope.querySelectorAll('.tcd-social-block');
    Array.prototype.forEach.call(blocks, function (block) {
      var btns = block.querySelectorAll('.tcd-social-btn');
      Array.prototype.forEach.call(btns, function (btn) {
        if (btn.dataset.tcdBound === '1') return;   // idempotent
        btn.dataset.tcdBound = '1';
        btn.addEventListener('click', function () {
          signIn(client, btn.dataset.provider, typeof nextUrl === 'function' ? nextUrl() : nextUrl, block);
        });
      });
    });
  }

  window.TCDSocialAuth = {
    render: render,
    bind: bind,
    signIn: signIn,
    callbackUrl: callbackUrl,
    PROVIDERS: PROVIDERS,
  };
})();
