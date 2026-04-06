/**
 * disclaimer.js — The Comp Desk
 *
 * On DOMContentLoaded:
 *  1. Injects a persistent footer disclaimer block on every page.
 *  2. Shows a one-time dismissible analytics notice (localStorage-gated).
 *
 * Pure vanilla JS. No dependencies.
 */

document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  var ANALYTICS_KEY = 'tcd_analytics_accepted';

  /* ── Inline styles ──────────────────────────────────────────────────────── */
  var styleEl = document.createElement('style');
  styleEl.textContent = [
    '#tcd-legal-block{',
      'border-top:1px solid #1c2d4a;',
      'padding:20px 24px;',
      'text-align:center;',
      'font-family:"DM Sans",system-ui,sans-serif;',
      'font-size:12px;',
      'color:#5a6a82;',
      'line-height:1.7;',
      'background:#06080f;',
    '}',
    '#tcd-legal-block p{margin:0 0 4px;}',
    '#tcd-legal-block a{color:#8899b4;}',
    '#tcd-legal-block a:hover{color:#dce4f0;text-decoration:underline;}',

    '#tcd-analytics-notice{',
      'position:fixed;',
      'bottom:0;left:0;right:0;',
      'z-index:9999;',
      'background:#0e1322;',
      'border-top:1px solid #1c2d4a;',
      'padding:14px 20px;',
      'display:flex;',
      'align-items:center;',
      'justify-content:center;',
      'gap:14px;',
      'flex-wrap:wrap;',
      'font-family:"DM Sans",system-ui,sans-serif;',
      'font-size:13px;',
      'color:#8899b4;',
      'box-shadow:0 -2px 16px rgba(0,0,0,0.4);',
    '}',
    '#tcd-analytics-notice p{margin:0;flex:1 1 280px;max-width:620px;}',
    '#tcd-analytics-notice a{color:#4f8ff7;}',
    '#tcd-analytics-notice a:hover{text-decoration:underline;}',
    '#tcd-dismiss-btn{',
      'background:#3b82f6;',
      'color:#fff;',
      'border:none;',
      'border-radius:6px;',
      'padding:8px 18px;',
      'font-size:13px;',
      'font-family:"DM Sans",system-ui,sans-serif;',
      'font-weight:700;',
      'cursor:pointer;',
      'white-space:nowrap;',
      'flex-shrink:0;',
    '}',
    '#tcd-dismiss-btn:hover{background:#2563eb;}'
  ].join('');
  document.head.appendChild(styleEl);

  /* ── 1. Persistent footer disclaimer ────────────────────────────────────── */
  if (!document.getElementById('tcd-legal-block')) {
    var block = document.createElement('div');
    block.id = 'tcd-legal-block';
    block.innerHTML =
      '<p>The Comp Desk provides general information and self-help tools for injured workers. ' +
      'It is not a law firm and does not provide legal advice. ' +
      'Use of this site does not create an attorney-client relationship.</p>' +
      '<p style="margin-top:6px;">' +
        '<a href="/disclaimer.html">Disclaimer</a> &middot; ' +
        '<a href="/terms.html">Terms of Use</a> &middot; ' +
        '<a href="/privacy.html">Privacy Policy</a> &middot; ' +
        '<a href="mailto:support@thecompdesk.com">Contact</a>' +
      '</p>';

    var footer = document.querySelector('footer');
    if (footer) {
      footer.appendChild(block);
    } else {
      document.body.appendChild(block);
    }
  }

  /* ── 2. One-time analytics notice ───────────────────────────────────────── */
  if (!localStorage.getItem(ANALYTICS_KEY)) {
    var notice = document.createElement('div');
    notice.id = 'tcd-analytics-notice';
    notice.innerHTML =
      '<p>This site uses privacy-respecting analytics (PostHog). No personally identifiable ' +
      'information is collected or stored. Your IP is never saved. ' +
      '<a href="/privacy.html">Learn more</a>.</p>' +
      '<button id="tcd-dismiss-btn">Got it</button>';
    document.body.appendChild(notice);

    document.getElementById('tcd-dismiss-btn').addEventListener('click', function () {
      try { localStorage.setItem(ANALYTICS_KEY, '1'); } catch (e) {}
      if (notice.parentNode) { notice.parentNode.removeChild(notice); }
    });
  }
});
