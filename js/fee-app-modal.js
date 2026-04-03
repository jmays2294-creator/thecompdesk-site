/**
 * fee-app-modal.js
 * Handles the "Generate Fee App" paywall flow.
 *
 * Usage:
 *   import { initFeeAppPaywall } from '../js/fee-app-modal.js';
 *   initFeeAppPaywall(userState); // userState from getOptionalUser()
 *
 * Then attach to any button:
 *   <button onclick="window.triggerFeeApp()">Generate Fee App</button>
 */

import { supabase, TIERS } from './auth.js';

/**
 * Inject the modal HTML + styles into the page once.
 */
function injectModal() {
  if (document.getElementById('fee-app-modal')) return;

  const modal = document.createElement('div');
  modal.id = 'fee-app-modal';
  modal.innerHTML = `
    <div id="fee-app-overlay" style="
      display: none;
      position: fixed; inset: 0; z-index: 9999;
      background: rgba(0,0,0,0.7);
      backdrop-filter: blur(4px);
      align-items: center; justify-content: center;
    ">
      <div style="
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 20px;
        padding: 40px;
        max-width: 480px;
        width: 90%;
        position: relative;
        box-shadow: 0 25px 60px rgba(0,0,0,0.5);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      ">
        <!-- Close button -->
        <button id="fee-modal-close" style="
          position: absolute; top: 16px; right: 16px;
          background: none; border: none; color: rgba(200,200,200,0.6);
          font-size: 22px; cursor: pointer; line-height: 1; padding: 4px 8px;
          transition: color 0.2s;
        " onmouseover="this.style.color='white'" onmouseout="this.style.color='rgba(200,200,200,0.6)'">&times;</button>

        <!-- Icon -->
        <div style="text-align: center; margin-bottom: 20px;">
          <div style="
            display: inline-flex; align-items: center; justify-content: center;
            width: 64px; height: 64px;
            background: linear-gradient(135deg, rgba(76,175,80,0.2) 0%, rgba(76,175,80,0.05) 100%);
            border: 1px solid rgba(76,175,80,0.3);
            border-radius: 16px;
            font-size: 28px;
          ">📄</div>
        </div>

        <!-- Title -->
        <h2 id="fee-modal-title" style="
          color: #fff; font-size: 22px; font-weight: 700;
          text-align: center; margin: 0 0 12px 0;
        ">Generate Fee App</h2>

        <!-- Body -->
        <p id="fee-modal-body" style="
          color: #999; font-size: 14px; line-height: 1.7;
          text-align: center; margin: 0 0 28px 0;
        "></p>

        <!-- Pro features list (shown for logged-in free users) -->
        <ul id="fee-modal-features" style="
          display: none;
          list-style: none; padding: 0; margin: 0 0 24px 0;
          background: rgba(76,175,80,0.08);
          border: 1px solid rgba(76,175,80,0.2);
          border-radius: 12px;
          padding: 16px 20px;
        ">
          <li style="color: #e0e0e0; font-size: 13px; padding: 4px 0; display: flex; align-items: center; gap: 8px;"><span style="color:#4CAF50;">✓</span> Generate WCB Fee Application documents</li>
          <li style="color: #e0e0e0; font-size: 13px; padding: 4px 0; display: flex; align-items: center; gap: 8px;"><span style="color:#4CAF50;">✓</span> Auto-fill from your calculation results</li>
          <li style="color: #e0e0e0; font-size: 13px; padding: 4px 0; display: flex; align-items: center; gap: 8px;"><span style="color:#4CAF50;">✓</span> Save and manage unlimited calculations</li>
          <li style="color: #e0e0e0; font-size: 13px; padding: 4px 0; display: flex; align-items: center; gap: 8px;"><span style="color:#4CAF50;">✓</span> Cancel anytime</li>
        </ul>

        <!-- Action buttons -->
        <div id="fee-modal-actions" style="display: flex; flex-direction: column; gap: 12px;"></div>

        <!-- Loading spinner (hidden by default) -->
        <div id="fee-modal-loading" style="display:none; text-align:center; color:#999; font-size:13px; margin-top: 16px;">
          Redirecting to checkout...
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('fee-modal-close').addEventListener('click', closeFeeAppModal);
  document.getElementById('fee-app-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeFeeAppModal();
  });
}

function closeFeeAppModal() {
  const overlay = document.getElementById('fee-app-overlay');
  if (overlay) overlay.style.display = 'none';
}

function openFeeAppModal() {
  const overlay = document.getElementById('fee-app-overlay');
  if (overlay) overlay.style.display = 'flex';
}

/**
 * Render the modal for a visitor who is NOT logged in.
 */
function renderLoggedOutModal() {
  document.getElementById('fee-modal-title').textContent = 'Create a Free Account';
  document.getElementById('fee-modal-body').textContent =
    'Generate Fee App is a Pro feature. Create your free account first, then upgrade to Pro for $9.99/mo to generate WCB fee applications directly from your calculations.';
  document.getElementById('fee-modal-features').style.display = 'none';

  const actions = document.getElementById('fee-modal-actions');
  actions.innerHTML = `
    <a href="/auth_v2.html?mode=signup&next=pro" style="
      display: block; text-align: center; text-decoration: none;
      background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
      color: #fff; font-weight: 600; font-size: 15px;
      padding: 14px 24px; border-radius: 10px;
      transition: opacity 0.2s;
    " onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">
      Create Free Account
    </a>
    <a href="/auth_v2.html" style="
      display: block; text-align: center; text-decoration: none;
      background: rgba(255,255,255,0.08);
      color: rgba(200,200,200,0.9); font-size: 14px;
      padding: 12px 24px; border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.1);
      transition: background 0.2s;
    " onmouseover="this.style.background='rgba(255,255,255,0.12)'" onmouseout="this.style.background='rgba(255,255,255,0.08)'">
      Sign In
    </a>
  `;
}

/**
 * Render the modal for a logged-in free-tier user.
 */
function renderUpgradeModal(userId) {
  document.getElementById('fee-modal-title').textContent = 'Upgrade to Pro';
  document.getElementById('fee-modal-body').textContent =
    'Generate Fee App is a Pro feature. Upgrade for $9.99/mo and start generating WCB fee application documents instantly from your calculation results.';
  document.getElementById('fee-modal-features').style.display = 'block';

  const actions = document.getElementById('fee-modal-actions');
  actions.innerHTML = `
    <button id="fee-modal-upgrade-btn" style="
      background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
      color: #fff; font-weight: 600; font-size: 15px;
      border: none; border-radius: 10px;
      padding: 14px 24px; cursor: pointer; width: 100%;
      transition: opacity 0.2s;
    " onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">
      Upgrade to Pro — $9.99/mo
    </button>
    <button onclick="document.getElementById('fee-app-overlay').style.display='none'" style="
      background: rgba(255,255,255,0.06);
      color: rgba(200,200,200,0.8); font-size: 14px;
      border: 1px solid rgba(255,255,255,0.1); border-radius: 10px;
      padding: 12px 24px; cursor: pointer; width: 100%;
      transition: background 0.2s;
    " onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.06)'">
      Maybe Later
    </button>
  `;

  document.getElementById('fee-modal-upgrade-btn').addEventListener('click', async () => {
    const btn = document.getElementById('fee-modal-upgrade-btn');
    const loading = document.getElementById('fee-modal-loading');
    btn.disabled = true;
    btn.textContent = 'Loading...';
    loading.style.display = 'block';

    try {
      const { data, error } = await supabase.functions.invoke('create-checkout', {
        body: { tier: 'pro', user_id: userId }
      });
      if (error || !data?.checkout_url) throw new Error('Checkout failed');
      window.location.href = data.checkout_url;
    } catch (err) {
      console.error('Checkout error:', err);
      btn.disabled = false;
      btn.textContent = 'Upgrade to Pro — $9.99/mo';
      loading.style.display = 'none';
      loading.textContent = 'Something went wrong. Please try again.';
      loading.style.color = '#f44336';
      loading.style.display = 'block';
    }
  });
}

/**
 * Initialize the fee app paywall for a page.
 * Call once on DOMContentLoaded with the result of getOptionalUser().
 * Attaches window.triggerFeeApp() for use by inline onclick handlers.
 * @param {Object} userState - { session, tier } from getOptionalUser()
 * @param {Function} [onProAccess] - callback when Pro user clicks Generate Fee App
 */
function initFeeAppPaywall(userState, onProAccess) {
  injectModal();

  const isLoggedIn = !!(userState && userState.session);
  const tier = userState?.tier || TIERS.FREE;
  const hasPro = tier === TIERS.PRO || tier === TIERS.FIRM;

  window.triggerFeeApp = function () {
    if (hasPro) {
      if (typeof onProAccess === 'function') onProAccess();
      return;
    }
    if (!isLoggedIn) {
      renderLoggedOutModal();
    } else {
      renderUpgradeModal(userState.session.user.id);
    }
    openFeeAppModal();
  };
}

export { initFeeAppPaywall };
