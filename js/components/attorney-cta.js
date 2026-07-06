/* ============================================================================
 * attorney-cta.js — CD.AttorneyCTA (the ONE "talk to an attorney" affordance)
 * ----------------------------------------------------------------------------
 * A single, self-contained CTA the injured worker meets everywhere: the
 * dashboard, the settlement result, the C-3 completion screen, the Road to
 * Recovery step panel, and the Comp Buddy chat. Fixed copy + fixed worker skin
 * (cream surface, orange #E87722 action, Fraunces title) so it looks and reads
 * IDENTICALLY on every surface — the worker learns it once. This is also the
 * entry point for the new attorney chat.
 *
 * Every click funnels into the shared round-robin lead intake with a `source`
 * so lead attribution records WHERE it fired:
 *     dashboard | recovery_node | chatbot | settlement_result | c3_complete | nav
 *
 *   el = CD.AttorneyCTA({ variant, source, context })
 *     variant  'card' | 'inline' | 'row'  — LAYOUT ONLY; copy is identical.
 *                card   → prominent block (dashboard, settlement, C-3 done)
 *                inline → horizontal band that sits inside a section (recovery)
 *                row    → compact pill for tight header slots (chat)
 *     source   attribution tag → CD.openAttorneyIntake({ source })
 *     context  optional extra fields merged into the intake call (e.g. prefill)
 *
 * The skin is HARD-CODED here (not host CSS vars) on purpose: the component
 * drops into dark surfaces (the C-3 wizard) and light ones alike and must look
 * the same on both — that identical-everywhere behaviour is the whole point.
 * ==========================================================================*/
(function (window) {
  'use strict';
  var CD = window.CD = window.CD || {};
  var document = window.document;

  // Fixed, Joel-approved copy — never forked per surface (that's the point).
  var COPY = {
    title:  'Talk to a workers’ comp attorney',
    sub:    'Free. No obligation.',
    button: 'Connect now'
  };
  var GAVEL = '⚖️'; // ⚖️

  var STYLE_ID = 'cd-atty-cta-css';
  function _injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      '.cd-atty-cta{--cd-cta-cream:#F8F6F1;--cd-cta-line:#E7DECB;--cd-cta-ink:#241F1B;',
        '--cd-cta-muted:#6B6357;--cd-cta-orange:#E87722;--cd-cta-orange-deep:#C25E12;',
        'box-sizing:border-box;font-family:"DM Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
        '-webkit-tap-highlight-color:transparent;}',
      '.cd-atty-cta *{box-sizing:border-box;}',
      '.cd-atty-cta-title{font-family:"Fraunces",Georgia,"Times New Roman",serif;font-weight:600;',
        'letter-spacing:-.01em;color:var(--cd-cta-ink);line-height:1.2;}',
      '.cd-atty-cta-sub{color:var(--cd-cta-muted);line-height:1.4;}',
      '.cd-atty-cta-btn{font-family:inherit;font-weight:700;border:none;cursor:pointer;',
        'background:var(--cd-cta-orange);color:#fff;border-radius:999px;line-height:1;white-space:nowrap;',
        'transition:background 160ms ease,transform 160ms ease;}',
      '.cd-atty-cta-btn:hover{background:var(--cd-cta-orange-deep);}',
      '.cd-atty-cta-btn:active{transform:translateY(1px);}',
      '.cd-atty-cta-btn:focus-visible{outline:3px solid rgba(232,119,34,.45);outline-offset:2px;}',
      // card — prominent standalone block
      '.cd-atty-cta--card{display:flex;flex-direction:column;gap:9px;background:var(--cd-cta-cream);',
        'border:1px solid var(--cd-cta-line);border-radius:16px;padding:18px 18px 20px;',
        'box-shadow:0 1px 3px rgba(36,31,27,.06);}',
      '.cd-atty-cta--card .cd-atty-cta-title{font-size:19px;}',
      '.cd-atty-cta--card .cd-atty-cta-sub{font-size:13.5px;}',
      '.cd-atty-cta--card .cd-atty-cta-btn{align-self:flex-start;margin-top:4px;padding:12px 22px;font-size:15px;}',
      // inline — horizontal band embedded in a section
      '.cd-atty-cta--inline{display:flex;align-items:center;gap:14px;flex-wrap:wrap;',
        'background:var(--cd-cta-cream);border:1px solid var(--cd-cta-line);border-radius:14px;padding:14px 16px;}',
      '.cd-atty-cta--inline .cd-atty-cta-copy{flex:1 1 auto;min-width:0;}',
      '.cd-atty-cta--inline .cd-atty-cta-title{font-size:16px;}',
      '.cd-atty-cta--inline .cd-atty-cta-sub{font-size:12.5px;margin-top:2px;}',
      '.cd-atty-cta--inline .cd-atty-cta-btn{flex:0 0 auto;padding:10px 18px;font-size:14px;}',
      // row — compact pill for tight header slots
      '.cd-atty-cta--row{display:inline-flex;align-items:center;flex:0 0 auto;}',
      '.cd-atty-cta--row .cd-atty-cta-btn{background:transparent;color:var(--cd-cta-orange-deep);',
        'border:1px solid var(--cd-cta-orange);padding:7px 13px;font-size:11.5px;',
        'display:inline-flex;align-items:center;gap:5px;}',
      '.cd-atty-cta--row .cd-atty-cta-btn:hover{background:var(--cd-cta-orange);color:#fff;}',
      '@media (prefers-reduced-motion:reduce){.cd-atty-cta-btn{transition:none;}}'
    ].join('');
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  // The single behaviour: open the shared round-robin lead intake, tagged with
  // the firing surface for attribution. `context` (optional) merges extra fields
  // into the call — e.g. a wizard's prefill — but can never clobber `source`.
  function _open(source, context) {
    var arg = { source: source || 'app' };
    if (context && typeof context === 'object') {
      Object.keys(context).forEach(function (k) { if (k !== 'source') arg[k] = context[k]; });
    }
    try {
      if (typeof CD.openAttorneyIntake === 'function') { CD.openAttorneyIntake(arg); }
    } catch (e) { if (window.console) console.warn('[AttorneyCTA] open failed', e); }
  }

  function AttorneyCTA(opts) {
    opts = opts || {};
    var variant = (opts.variant === 'inline' || opts.variant === 'row') ? opts.variant : 'card';
    var source = opts.source || 'app';
    var context = opts.context || null;
    var h = CD.h;
    if (typeof h !== 'function') return document.createComment('AttorneyCTA: CD.h unavailable');
    _injectStyles();

    var onClick = function () { _open(source, context); };

    if (variant === 'row') {
      // The whole pill is the control; its accessible name carries the full copy.
      var pill = h('button', {
        type: 'button',
        className: 'cd-atty-cta-btn',
        'aria-label': COPY.title + ' — ' + COPY.sub,
        title: COPY.title + ' — ' + COPY.sub,
        onclick: onClick
      }, [ h('span', { 'aria-hidden': 'true' }, GAVEL), h('span', null, COPY.title) ]);
      return h('div', { className: 'cd-atty-cta cd-atty-cta--row', 'data-source': source }, pill);
    }

    // card + inline share the same title / sub / button set; CSS lays them out.
    var title = h('div', { className: 'cd-atty-cta-title' }, [
      h('span', { 'aria-hidden': 'true' }, GAVEL + ' '), COPY.title
    ]);
    var sub = h('div', { className: 'cd-atty-cta-sub' }, COPY.sub);
    var btn = h('button', { type: 'button', className: 'cd-atty-cta-btn', onclick: onClick }, COPY.button);

    if (variant === 'inline') {
      var copyWrap = h('div', { className: 'cd-atty-cta-copy' }, [ title, sub ]);
      return h('div', { className: 'cd-atty-cta cd-atty-cta--inline', 'data-source': source }, [ copyWrap, btn ]);
    }
    return h('div', { className: 'cd-atty-cta cd-atty-cta--card', 'data-source': source }, [ title, sub, btn ]);
  }

  CD.AttorneyCTA = AttorneyCTA;
})(window);
