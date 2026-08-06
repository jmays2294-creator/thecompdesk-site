/**
 * directory-chat.js — auto-spawning intake widget for /directory/<slug> pages.
 *
 * Loads ONLY on directory listing pages (guarded below), never sitewide.
 *
 * Failure policy: every catch in the spawn path fails OPEN. This codebase has
 * soft-bricked a screen on a swallowed error before, and this widget sits on a page
 * whose entire job is capturing a lead — a dead widget is worse than no widget, because
 * it looks like it is working. On any function error the panel shows a real message and
 * the attorney's phone and email, so the visitor always has a way through.
 */
(function () {
  'use strict';

  var SLUG = window.CD_DIRECTORY_SLUG;
  if (!SLUG || !/^\/directory\//.test(location.pathname)) return;

  var FN = 'https://ltibymvlytodkemdeeox.supabase.co/functions/v1/directory-chat';
  var SPAWN_DELAY = 1200;
  var SS_KEY = 'cd_dir_chat_' + SLUG;

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var cfg = null, token = null, root = null, thread = null, busy = false, ended = false;
  var lastFocus = null;

  // ── tiny DOM helpers ────────────────────────────────────────────────────────
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') el.className = attrs[k];
      else if (k === 'text') el.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), attrs[k]);
      else el.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) el.appendChild(c); });
    return el;
  }

  function post(body) {
    return fetch(FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, code: 'bad_response' }; })
        .then(function (j) { if (!r.ok || !j.ok) throw new Error(j.code || ('http_' + r.status)); return j; });
    });
  }

  // ── styles ──────────────────────────────────────────────────────────────────
  var CSS = [
    '.cdc-bubble{position:fixed;right:18px;bottom:18px;z-index:9998;background:#1B2A4A;color:#fff;',
    'border:0;border-radius:999px;padding:13px 20px;font:600 15px/1.2 system-ui,-apple-system,sans-serif;',
    'box-shadow:0 8px 30px rgba(27,42,74,.28);cursor:pointer;min-height:44px}',
    '.cdc-panel{position:fixed;right:18px;bottom:18px;z-index:9999;width:min(380px,calc(100vw - 24px));',
    'max-height:min(640px,calc(100vh - 32px));display:flex;flex-direction:column;background:#fff;',
    'border-radius:16px;box-shadow:0 18px 60px rgba(27,42,74,.3);overflow:hidden;',
    'font:15px/1.55 system-ui,-apple-system,sans-serif;color:#2D3142}',
    '.cdc-anim{animation:cdcIn .28s ease-out}',
    '@keyframes cdcIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}',
    '.cdc-hd{background:#1B2A4A;color:#fff;padding:14px 46px 14px 16px;position:relative}',
    // Scoped: .cdc-banner is a <p>, and skins.css has body.tcd-skinned p{color:
    // var(--skin-text-soft)} at (0,1,1), which beats a bare class at (0,1,0). Unscoped,
    // this rendered #4d5266 on the navy header — 1.83:1, near-invisible, and it sat
    // that way through a manual screenshot review before axe caught it.
    '.cdc-panel .cdc-banner{font-weight:700;font-size:16px;margin:0 0 9px;color:#fff}',
    '.cdc-agent{display:flex;align-items:center;gap:10px}',
    '.cdc-agent img{width:34px;height:34px;border-radius:50%;background:#F4EADB;flex:0 0 auto}',
    '.cdc-nm{font-weight:600;font-size:14px;line-height:1.25}',
    '.cdc-role{font-size:11.5px;opacity:.82;line-height:1.25}',
    '.cdc-x{position:absolute;top:10px;right:8px;background:transparent;border:0;color:#fff;',
    'font-size:22px;line-height:1;cursor:pointer;width:44px;height:44px;border-radius:8px}',
    '.cdc-x:hover{background:rgba(255,255,255,.14)}',
    '.cdc-thread{flex:1 1 auto;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;background:#F8F6F1}',
    '.cdc-msg{max-width:86%;padding:10px 13px;border-radius:14px;white-space:pre-wrap;word-wrap:break-word}',
    '.cdc-agentmsg{background:#fff;border:1px solid rgba(45,49,66,.10);align-self:flex-start;border-bottom-left-radius:5px}',
    '.cdc-you{background:#1B2A4A;color:#fff;align-self:flex-end;border-bottom-right-radius:5px}',
    '.cdc-sys{align-self:center;font-size:13px;color:#4D5266;text-align:center;max-width:94%}',
    '.cdc-typing span{display:inline-block;width:6px;height:6px;margin-right:3px;border-radius:50%;',
    'background:#9aa1b4;animation:cdcBlink 1.2s infinite}',
    '.cdc-typing span:nth-child(2){animation-delay:.2s}.cdc-typing span:nth-child(3){animation-delay:.4s}',
    '@keyframes cdcBlink{0%,80%,100%{opacity:.3}40%{opacity:1}}',
    '.cdc-chips{display:flex;flex-wrap:wrap;gap:7px;padding:0 14px 10px;background:#F8F6F1}',
    '.cdc-chip{background:#fff;border:1px solid rgba(45,49,66,.16);border-radius:999px;padding:9px 14px;',
    'font-size:13.5px;cursor:pointer;min-height:44px;color:#2D3142}',
    '.cdc-chip:hover{border-color:#E87722;color:#C85F0F}',
    '.cdc-form{border-top:1px solid rgba(45,49,66,.10);padding:10px;display:flex;gap:8px;background:#fff}',
    '.cdc-form input{flex:1 1 auto;border:1px solid rgba(45,49,66,.18);border-radius:10px;padding:11px 12px;font:inherit;min-height:44px}',
    '.cdc-send{background:#B0560A;color:#fff;border:0;border-radius:10px;padding:0 17px;font-weight:600;cursor:pointer;min-height:44px}',
    '.cdc-send:disabled{opacity:.5;cursor:default}',
    '.cdc-card{background:#fff;border:1px solid rgba(45,49,66,.14);border-radius:14px;padding:14px;align-self:stretch}',
    '.cdc-card h3{margin:0 0 4px;font-size:15px}',
    '.cdc-card p{margin:0 0 10px;font-size:13px;color:#4D5266}',
    '.cdc-card input[type=text],.cdc-card input[type=email],.cdc-card input[type=tel]{width:100%;box-sizing:border-box;',
    'border:1px solid rgba(45,49,66,.18);border-radius:9px;padding:11px 12px;font:inherit;margin-bottom:8px;min-height:44px}',
    '.cdc-consent{display:flex;gap:9px;align-items:flex-start;font-size:12px;line-height:1.5;color:#4D5266;margin:2px 0 11px}',
    '.cdc-consent input{margin-top:2px;width:18px;height:18px;flex:0 0 auto}',
    '.cdc-ft{padding:9px 14px;font-size:11px;line-height:1.5;color:#4D5266;background:#fff;border-top:1px solid rgba(45,49,66,.08);text-align:center}',
    '.cdc-fallback a{color:#C85F0F;font-weight:600}',
    // 2.4.7: the UA default ring disappears against the navy header, so state it.
    '.cdc-panel :focus-visible{outline:3px solid #E87722;outline-offset:2px;border-radius:6px}',
    '.cdc-bubble:focus-visible{outline:3px solid #E87722;outline-offset:3px}',
    '.cdc-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;',
    'clip:rect(0 0 0 0);white-space:nowrap;border:0}'
  ].join('');

  // ── UI pieces ───────────────────────────────────────────────────────────────
  function addMsg(text, who) {
    var cls = who === 'you' ? 'cdc-msg cdc-you' : who === 'sys' ? 'cdc-sys' : 'cdc-msg cdc-agentmsg';
    var el = h('div', { class: cls, text: text });
    thread.appendChild(el);
    thread.scrollTop = thread.scrollHeight;
    return el;
  }

  function typing(on) {
    var ex = thread.querySelector('.cdc-typingwrap');
    if (ex) ex.remove();
    if (!on) return;
    var w = h('div', { class: 'cdc-msg cdc-agentmsg cdc-typingwrap' }, [
      h('div', { class: 'cdc-typing', 'aria-label': 'Assistant is typing' },
        [h('span', {}), h('span', {}), h('span', {})])
    ]);
    thread.appendChild(w);
    thread.scrollTop = thread.scrollHeight;
  }

  function chips(items) {
    var old = root.querySelector('.cdc-chips');
    if (old) old.remove();
    if (!items || !items.length || ended) return;
    var box = h('div', { class: 'cdc-chips' });
    items.forEach(function (t) {
      box.appendChild(h('button', {
        class: 'cdc-chip', type: 'button', text: t,
        onclick: function () { box.remove(); send(t); }
      }));
    });
    root.querySelector('.cdc-form').before(box);
  }

  function fallback(msg) {
    var p = h('div', { class: 'cdc-sys cdc-fallback' });
    p.innerHTML = msg + '<br>You can reach ' + (cfg && cfg.attorney_name ? cfg.attorney_name : 'the office') +
      ' directly at <a href="tel:' + (cfg ? cfg.fallback_phone_e164 : '') + '">' +
      (cfg ? cfg.fallback_phone : '') + '</a>' +
      (cfg && cfg.fallback_email ? ' or <a href="mailto:' + cfg.fallback_email + '">' + cfg.fallback_email + '</a>' : '') + '.';
    thread.appendChild(p);
    thread.scrollTop = thread.scrollHeight;
  }

  function contactCard() {
    var name = h('input', { type: 'text', placeholder: 'Your name', 'aria-label': 'Your name' });
    var email = h('input', { type: 'email', placeholder: 'Email', 'aria-label': 'Email' });
    var phone = h('input', { type: 'tel', placeholder: 'Phone (optional)', 'aria-label': 'Phone' });
    var ck = h('input', { type: 'checkbox', id: 'cdc-tcpa' });
    var btn = h('button', { class: 'cdc-send', type: 'button', text: 'Send to ' + firstName(), style: 'width:100%' });

    var card = h('div', { class: 'cdc-card' }, [
      h('h3', { text: 'How should ' + firstName() + ' reach you?' }),
      h('p', { text: 'Just enough to get back to you.' }),
      name, email, phone,
      h('label', { class: 'cdc-consent', for: 'cdc-tcpa' }, [ck, h('span', { text: cfg.consent_copy })]),
      btn
    ]);

    btn.addEventListener('click', function () {
      if (!ck.checked) { alert('Please check the consent box so we can contact you.'); return; }
      if (!email.value.trim() && !phone.value.trim()) { alert('Please add an email or a phone number.'); return; }
      btn.disabled = true; btn.textContent = 'Sending…';
      post({
        action: 'consent', session_token: token, name: name.value.trim(),
        email: email.value.trim(), phone: phone.value.trim(), consent: true,
        copy_version: cfg.consent_copy_version
      }).then(function () {
        return post({ action: 'handoff', session_token: token });
      }).then(function (r) {
        card.remove(); ended = true;
        addMsg('Thanks — that\'s with ' + firstName() + ' now. He usually replies within one business day, '
          + 'and you\'ll get an email with a link back to this conversation.', 'agent');
        if (r.thread_url) {
          var a = h('div', { class: 'cdc-sys' });
          a.innerHTML = '<a href="' + r.thread_url + '">View this conversation</a>';
          thread.appendChild(a);
        }
        lockInput('Conversation sent');
      }).catch(function (e) {
        btn.disabled = false; btn.textContent = 'Try again';
        fallback('Something went wrong sending that (' + e.message + ').');
      });
    });

    thread.appendChild(card);
    thread.scrollTop = thread.scrollHeight;
    name.focus();
  }

  function firstName() {
    return String((cfg && cfg.attorney_name) || 'the attorney').split(/[\s,]+/)[0];
  }

  function lockInput(label) {
    var f = root.querySelector('.cdc-form');
    if (f) f.innerHTML = '<div style="flex:1;text-align:center;color:#4D5266;font-size:13px;padding:10px">' + label + '</div>';
    var c = root.querySelector('.cdc-chips'); if (c) c.remove();
  }

  // ── send ────────────────────────────────────────────────────────────────────
  function send(text) {
    if (busy || ended || !text.trim()) return;
    busy = true;
    addMsg(text, 'you');
    var input = root.querySelector('.cdc-form input');
    var btn = root.querySelector('.cdc-send');
    if (input) input.value = '';
    if (btn) btn.disabled = true;
    typing(true);

    // No chat row exists until this first send. Before then we carry the slug; the
    // function mints the row and hands back the token, which we adopt for every
    // subsequent action. This is what keeps a page view from creating a conversation.
    var body = token
      ? { action: 'message', session_token: token, text: text }
      : { action: 'message', slug: SLUG, locale: document.documentElement.lang || 'en', text: text };

    post(body)
      .then(function (r) {
        if (r.session_token) token = r.session_token;
        typing(false);
        addMsg(r.reply, 'agent');
        if (r.widget === 'contact_capture') contactCard();
        else maybeOfferContact(r.reply);
      })
      .catch(function (e) {
        typing(false);
        fallback('I couldn\'t send that just now (' + e.message + ').');
      })
      .then(function () {
        busy = false;
        if (btn) btn.disabled = false;
      });
  }

  // Heuristic nudge: after the agent has asked a couple of things, surface the contact
  // card as an inline chip rather than interrupting with a modal.
  var turns = 0;
  function maybeOfferContact(reply) {
    turns++;
    if (ended) return;
    if (/already have a lawyer|your own attorney/i.test(reply)) { ended = true; lockInput('Take care'); return; }
    if (/comp buddy|thecompdesk\.com\/worker/i.test(reply)) { ended = true; lockInput('Hope that helps'); return; }
    if (turns >= 2) chips(['Have ' + firstName() + ' contact me']);
  }

  // ── panel ───────────────────────────────────────────────────────────────────
  function trapFocus(e) {
    if (e.key === 'Escape') { minimize(); return; }
    if (e.key !== 'Tab' || !root) return;
    var f = root.querySelectorAll('button,input,a[href],[tabindex]:not([tabindex="-1"])');
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function minimize() {
    if (!root) return;
    root.remove(); root = null;
    try { sessionStorage.setItem(SS_KEY, 'min'); } catch (_) {}
    document.removeEventListener('keydown', trapFocus);
    showBubble();
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function showBubble() {
    if (document.querySelector('.cdc-bubble')) return;
    var b = h('button', {
      class: 'cdc-bubble', type: 'button',
      text: (cfg && cfg.banner_text) || 'Chat',
      'aria-label': 'Open chat with the intake assistant',
      onclick: function () { b.remove(); openPanel(); }
    });
    document.body.appendChild(b);
  }

  function openPanel() {
    lastFocus = document.activeElement;
    thread = h('div', { class: 'cdc-thread', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversation' });

    var input = h('input', { type: 'text', placeholder: 'Type your message…', 'aria-label': 'Type your message' });
    var sendBtn = h('button', { class: 'cdc-send', type: 'button', text: 'Send' });
    var form = h('div', { class: 'cdc-form' }, [input, sendBtn]);
    sendBtn.addEventListener('click', function () { send(input.value); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); send(input.value); } });

    root = h('div', {
      class: 'cdc-panel' + (reduced ? '' : ' cdc-anim'),
      role: 'dialog', 'aria-modal': 'false',
      'aria-label': 'Chat with the intake assistant',
      // WCAG 2.1.2 allows containing focus only if the user is told how to leave.
      // Tab is cycled inside the panel, so Escape is announced here rather than left
      // for the visitor to guess.
      'aria-keyshortcuts': 'Escape',
      'aria-describedby': 'cdc-escape-hint'
    }, [
      h('p', { class: 'cdc-sr', id: 'cdc-escape-hint',
        text: 'Press Escape to minimise this chat and return to the page.' }),
      h('div', { class: 'cdc-hd' }, [
        h('p', { class: 'cdc-banner', text: cfg.banner_text }),
        h('div', { class: 'cdc-agent' }, [
          h('img', { src: cfg.agent_avatar_url, alt: '', width: '34', height: '34' }),
          h('div', {}, [
            h('div', { class: 'cdc-nm', text: cfg.agent_name }),
            // Persistent, never dismissible. This is a disclosure, not a subtitle.
            h('div', { class: 'cdc-role', text: 'Virtual assistant · The Comp Desk' })
          ])
        ]),
        h('button', { class: 'cdc-x', type: 'button', 'aria-label': 'Minimize chat', text: '×', onclick: minimize })
      ]),
      thread,
      form,
      h('div', { class: 'cdc-ft', text: 'Not legal advice. No attorney-client relationship is formed by using this chat.' })
    ]);

    document.body.appendChild(root);
    document.addEventListener('keydown', trapFocus);
    addMsg(cfg.greeting, 'agent');
    input.focus();
  }

  // ── boot ────────────────────────────────────────────────────────────────────
  function boot() {
    var st = null;
    try { st = sessionStorage.getItem(SS_KEY); } catch (_) {}

    document.head.appendChild(h('style', { text: CSS }));

    post({ action: 'start', slug: SLUG, locale: document.documentElement.lang || 'en' })
      .then(function (c) {
        cfg = c; token = c.session_token;
        if (st === 'min') showBubble(); else openPanel();
      })
      .catch(function (e) {
        // Fail OPEN: never leave the page looking like a chat that is merely slow.
        console.error('[directory-chat] start failed:', e);
        cfg = cfg || { banner_text: 'Contact', attorney_name: '', fallback_phone: '', fallback_phone_e164: '' };
        showBubble();
      });
  }

  setTimeout(function () {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }, SPAWN_DELAY);
})();
