/* field-help.js — first-focus "why this matters" modals for free calculators.
 *
 * WEB-ONLY behavior. The copy lives in field-help-registry.js (the shared
 * single source of truth) — this file only wires the UI:
 *   • For every [data-fieldhelp="<key>"] input whose <key> exists in
 *     window.CD.FIELD_HELP, append a reopenable ⓘ button to its label and
 *     attach a one-time focus handler.
 *   • First focus of a field opens the modal and sets
 *     localStorage['fieldhelp_seen_<key>'] so it shows once per field, ever.
 *   • The ⓘ button reopens the modal on demand at any time.
 *
 * Load AFTER field-help-registry.js. Both are plain deferred scripts.
 */
(function () {
  'use strict';

  var REG = (window.CD && window.CD.FIELD_HELP) || {};
  var SEEN_PREFIX = 'fieldhelp_seen_';
  var injected = false;
  var modalEls = null;
  var lastFocused = null;

  function injectStyle() {
    if (document.getElementById('cd-fh-style')) return;
    var css =
      '.cd-fh-icon{display:inline-flex;align-items:center;justify-content:center;' +
      'width:22px;height:22px;margin-left:5px;padding:0;border:none;background:none;' +
      'color:var(--ac,var(--skin-accent,#d97706));font-size:.95em;line-height:1;' +
      'cursor:pointer;vertical-align:middle;border-radius:50%;-webkit-tap-highlight-color:transparent;}' +
      '.cd-fh-icon:hover,.cd-fh-icon:focus-visible{background:color-mix(in srgb,var(--ac,#d97706) 16%,transparent);outline:none;}' +
      '.cd-fh-overlay{position:fixed;inset:0;z-index:9000;display:none;align-items:center;' +
      'justify-content:center;padding:18px;background:rgba(10,15,26,.55);' +
      'backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);}' +
      '.cd-fh-overlay.cd-fh-open{display:flex;}' +
      '.cd-fh-card{max-width:440px;width:100%;max-height:85vh;overflow:auto;' +
      'background:var(--card,var(--skin-surface-elev,#fff));' +
      'color:var(--tx,var(--skin-text,#1a2238));' +
      'border:1px solid var(--bd,var(--skin-divider,rgba(0,0,0,.12)));' +
      'border-radius:var(--skin-card-radius,16px);box-shadow:0 18px 50px rgba(0,0,0,.35);' +
      'padding:22px 22px 20px;font-family:var(--font-body,inherit);' +
      'animation:cd-fh-pop .16s ease-out;}' +
      '@keyframes cd-fh-pop{from{opacity:0;transform:translateY(8px) scale(.98);}to{opacity:1;transform:none;}}' +
      '.cd-fh-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:10px;}' +
      '.cd-fh-badge{flex:none;width:30px;height:30px;border-radius:50%;display:flex;' +
      'align-items:center;justify-content:center;font-weight:700;font-size:16px;' +
      'background:color-mix(in srgb,var(--ac,#d97706) 18%,transparent);' +
      'color:var(--ac,var(--skin-accent,#d97706));}' +
      '.cd-fh-title{margin:2px 0 0;font-size:1.12rem;font-weight:700;flex:1;' +
      'font-family:var(--font-display,inherit);}' +
      '.cd-fh-close{flex:none;border:none;background:none;cursor:pointer;font-size:22px;' +
      'line-height:1;color:var(--txM,var(--skin-text-muted,#888));padding:2px 4px;border-radius:8px;}' +
      '.cd-fh-close:hover{color:var(--tx,var(--skin-text,#1a2238));}' +
      '.cd-fh-body{font-size:.95rem;line-height:1.55;color:var(--tx,var(--skin-text,#1a2238));}' +
      '.cd-fh-foot{margin-top:16px;text-align:right;}' +
      '.cd-fh-ok{border:none;cursor:pointer;font-weight:600;font-size:.92rem;' +
      'padding:9px 18px;border-radius:10px;background:var(--ac,var(--skin-accent,#d97706));color:#fff;}' +
      '@media (prefers-reduced-motion:reduce){.cd-fh-card{animation:none;}}';
    var s = document.createElement('style');
    s.id = 'cd-fh-style';
    s.textContent = css;
    document.head.appendChild(s);
  }

  function buildModal() {
    if (modalEls) return modalEls;
    injectStyle();
    var overlay = document.createElement('div');
    overlay.className = 'cd-fh-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'cd-fh-title');
    overlay.innerHTML =
      '<div class="cd-fh-card" role="document">' +
        '<div class="cd-fh-head">' +
          '<span class="cd-fh-badge" aria-hidden="true">i</span>' +
          '<h2 class="cd-fh-title" id="cd-fh-title"></h2>' +
          '<button type="button" class="cd-fh-close" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="cd-fh-body" id="cd-fh-body"></div>' +
        '<div class="cd-fh-foot"><button type="button" class="cd-fh-ok">Got it</button></div>' +
      '</div>';
    document.body.appendChild(overlay);
    var titleEl = overlay.querySelector('.cd-fh-title');
    var bodyEl = overlay.querySelector('.cd-fh-body');
    function close() {
      overlay.classList.remove('cd-fh-open');
      if (lastFocused && lastFocused.focus) { try { lastFocused.focus(); } catch (e) {} }
    }
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    overlay.querySelector('.cd-fh-close').addEventListener('click', close);
    overlay.querySelector('.cd-fh-ok').addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('cd-fh-open')) close();
    });
    modalEls = { overlay: overlay, titleEl: titleEl, bodyEl: bodyEl, close: close };
    return modalEls;
  }

  function openModal(key) {
    var entry = REG[key];
    if (!entry) return;
    var m = buildModal();
    m.titleEl.textContent = entry.title || '';
    m.bodyEl.innerHTML = entry.body || '';
    m.overlay.classList.add('cd-fh-open');
    var ok = m.overlay.querySelector('.cd-fh-ok');
    if (ok && ok.focus) { try { ok.focus(); } catch (e) {} }
  }

  function labelFor(input) {
    if (input.id) {
      var byFor = document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(input.id) : input.id) + '"]');
      if (byFor) return byFor;
    }
    var group = input.closest('.field-group, .field-wrap');
    if (group) {
      var lbl = group.querySelector('.field-label');
      if (lbl) return lbl;
      // walk up one level for inputs nested in .field-wrap inside .field-group
      var parent = group.closest('.field-group');
      if (parent) { var l2 = parent.querySelector('.field-label'); if (l2) return l2; }
    }
    return null;
  }

  function addIcon(input, key) {
    var lbl = labelFor(input);
    if (!lbl || lbl.querySelector('.cd-fh-icon')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cd-fh-icon';
    btn.setAttribute('aria-label', 'Why this matters');
    btn.innerHTML = '&#9432;'; // ⓘ
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      lastFocused = input;
      openModal(key);
    });
    lbl.appendChild(btn);
  }

  function wire(input) {
    var key = input.getAttribute('data-fieldhelp');
    if (!key || !REG[key]) return;
    addIcon(input, key);
    var seenKey = SEEN_PREFIX + key;
    var handler = function () {
      var seen;
      try { seen = localStorage.getItem(seenKey); } catch (e) { seen = '1'; }
      if (seen) return;
      try { localStorage.setItem(seenKey, '1'); } catch (e) {}
      lastFocused = input;
      openModal(key);
    };
    input.addEventListener('focus', handler);
  }

  function init() {
    var fields = document.querySelectorAll('[data-fieldhelp]');
    if (!fields.length) return;
    injectStyle(); // style the ⓘ icons immediately, before any modal opens
    for (var i = 0; i < fields.length; i++) wire(fields[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
