/* ============================================================================
 * attorney-inbox.js — CD.DirectoryInbox
 * ----------------------------------------------------------------------------
 * Directory chat inbox for the attorney Command Center. Mounts through the
 * documented contract:
 *
 *   window.CD.DirectoryInbox.renderPanel(ctx) -> DOMNode | null
 *   ctx = { profile, user, tier, supabase, h, card, f$, showScreen,
 *           handleUpgrade, openAttorneyIntake, hasAccess, goToCalc }
 *
 * Delegated from attorney-dashboard.js the same way CD.Consult is: wrapped in a
 * try/catch that fails LOUD to console and returns null, so a fault here can never
 * take the dashboard down with it.
 *
 * Returns null when the attorney has no directory listing — a listing is a paid
 * product, and an empty "Messages" card on every attorney's dashboard would be
 * noise for everyone who has not bought one.
 *
 * All state is module-level and fetched once per user, repainting via CD.render(),
 * matching the Network Leads / Schedule / Skills panels.
 * ==========================================================================*/
(function (window, document) {
  'use strict';
  var CD = window.CD = window.CD || {};

  var FN = 'directory-chat-inbox';
  var _in = { phase: 'idle', uid: null, chats: null, unread: 0, err: null };
  var _open = { chatId: null, phase: 'idle', chat: null, msgs: null, err: null };
  var _viewAll = false;
  var _focusHooked = false;

  function client() { return CD.supa || CD.supabase || null; }
  function repaint() { if (CD.render) CD.render(); }

  function invoke(body) {
    var sb = client();
    if (!sb || !sb.functions) return Promise.reject(new Error('NO_SUPABASE_CLIENT'));
    return sb.functions.invoke(FN, { body: body }).then(function (r) {
      if (r.error) throw new Error(r.error.message || 'invoke_failed');
      if (!r.data || !r.data.ok) throw new Error((r.data && r.data.code) || 'bad_response');
      return r.data;
    });
  }

  function ensureList(uid) {
    if (!uid) return;
    if (_in.phase === 'loading') return;
    if (_in.phase === 'ready' && _in.uid === uid) return;
    _in.phase = 'loading'; _in.uid = uid; _in.err = null;
    invoke({ action: 'list' })
      .then(function (d) {
        _in.phase = 'ready'; _in.chats = d.chats || []; _in.unread = d.total_unread || 0;
      })
      .catch(function (e) {
        // Fail loud. Never silently render "no messages" over a transport error —
        // an attorney would read that as "no one contacted me."
        console.error('[directory-inbox] LIST_FAILED', e);
        _in.phase = 'error'; _in.err = e.message || String(e);
      })
      .then(repaint);

    if (!_focusHooked) {
      _focusHooked = true;
      window.addEventListener('focus', function () {
        if (_in.phase === 'ready') { _in.phase = 'idle'; ensureList(_in.uid); }
      });
    }
  }

  function openThread(chatId) {
    _open = { chatId: chatId, phase: 'loading', chat: null, msgs: null, err: null };
    repaint();
    invoke({ action: 'thread', chat_id: chatId })
      .then(function (d) { _open.phase = 'ready'; _open.chat = d.chat; _open.msgs = d.messages || []; })
      .catch(function (e) {
        console.error('[directory-inbox] THREAD_FAILED', e);
        _open.phase = 'error'; _open.err = e.message || String(e);
      })
      .then(repaint);
  }

  function when(iso) {
    if (!iso) return '';
    var d = new Date(iso), now = Date.now(), diff = (now - d.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    return d.toLocaleDateString();
  }

  var INTENT_LABEL = {
    lead: 'Lead', info_only: 'Info only', has_counsel: 'Represented',
    out_of_scope: 'Out of scope', abandoned: 'Abandoned', unknown: 'New'
  };

  // ── list row ────────────────────────────────────────────────────────────────
  function row(ctx, c) {
    var h = ctx.h;
    var meta = h('div', { className: 'cc-di-meta' }, [
      h('span', { className: 'cc-di-intent' }, INTENT_LABEL[c.intent] || c.intent),
      h('span', { className: 'cc-di-when' }, when(c.updated_at || c.created_at))
    ]);
    if (c.unread) meta.insertBefore(h('span', { className: 'cc-di-dot', title: c.unread + ' unread' }, String(c.unread)), meta.firstChild);

    return h('button', {
      className: 'cc-di-row' + (c.unread ? ' is-unread' : ''),
      onclick: function () { openThread(c.id); }
    }, [
      h('div', { className: 'cc-di-row-top' }, [
        h('span', { className: 'cc-di-name' }, c.visitor_name || 'Visitor'),
        meta
      ]),
      h('div', { className: 'cc-di-q' }, c.question_presented || '(no summary yet)')
    ]);
  }

  // ── thread view ─────────────────────────────────────────────────────────────
  function threadView(ctx) {
    var h = ctx.h;
    var back = h('button', {
      className: 'cc-di-back',
      onclick: function () { _open = { chatId: null, phase: 'idle' }; repaint(); }
    }, '← All messages');

    if (_open.phase === 'loading') return h('div', {}, [back, h('div', { className: 'cc-skel' })]);
    if (_open.phase === 'error') {
      return h('div', {}, [back, h('div', { className: 'cc-empty' }, [
        h('div', { className: 'cc-empty-ico' }, '⚠️'),
        h('div', { className: 'cc-empty-title' }, 'Couldn’t load that conversation'),
        h('div', { className: 'cc-empty-sub' }, _open.err || ''),
        h('button', { className: 'cc-retry', onclick: function () { openThread(_open.chatId); } }, 'Retry')
      ])]);
    }

    var c = _open.chat || {};
    var wrap = h('div', { className: 'cc-di-thread' }, [back]);

    // Contact block
    var contact = h('div', { className: 'cc-di-contact' }, [
      h('div', { className: 'cc-di-name' }, c.visitor_name || 'Visitor')
    ]);
    if (c.visitor_phone_e164) contact.appendChild(h('a', { href: 'tel:' + c.visitor_phone_e164 }, c.visitor_phone_e164));
    if (c.visitor_email) contact.appendChild(h('a', { href: 'mailto:' + c.visitor_email }, c.visitor_email));
    wrap.appendChild(contact);

    // AI summary pinned at the top, visually marked as internal so it can never be
    // mistaken for something the visitor wrote or can see.
    var internal = (_open.msgs || []).filter(function (m) { return m.is_internal; });
    if (internal.length) {
      wrap.appendChild(h('div', { className: 'cc-di-internal' }, [
        h('div', { className: 'cc-di-internal-tag' }, 'AI SUMMARY · INTERNAL · NOT SHOWN TO VISITOR'),
        h('pre', { className: 'cc-di-internal-body' }, internal[0].body)
      ]));
    }

    var list = h('div', { className: 'cc-di-msgs' });
    (_open.msgs || []).filter(function (m) { return !m.is_internal; }).forEach(function (m) {
      list.appendChild(h('div', {
        className: 'cc-di-msg is-' + m.role
      }, [
        h('div', { className: 'cc-di-msg-who' }, m.role === 'visitor' ? (c.visitor_name || 'Visitor')
          : m.role === 'attorney' ? 'You' : m.role === 'agent' ? 'Alina (assistant)' : 'System'),
        h('div', { className: 'cc-di-msg-body' }, m.body)
      ]));
    });
    wrap.appendChild(list);

    // Composer
    var ta = h('textarea', { className: 'cc-di-ta', placeholder: 'Reply to ' + (c.visitor_name || 'this visitor') + '…', rows: '4' });
    var sendBtn = h('button', { className: 'cc-di-send' }, 'Send reply');
    var status = h('div', { className: 'cc-di-status' }, '');

    sendBtn.onclick = function () {
      var v = (ta.value || '').trim();
      if (!v) return;
      sendBtn.disabled = true; status.textContent = 'Sending…';
      invoke({ action: 'reply', chat_id: _open.chatId, text: v })
        .then(function () {
          ta.value = ''; status.textContent = 'Sent. The visitor has been emailed a link to your reply.';
          _in.phase = 'idle'; ensureList(_in.uid);
          openThread(_open.chatId);
        })
        .catch(function (e) {
          console.error('[directory-inbox] REPLY_FAILED', e);
          status.textContent = 'That didn’t send (' + (e.message || e) + '). Nothing was lost — try again.';
          sendBtn.disabled = false;
        });
    };

    wrap.appendChild(h('div', { className: 'cc-di-composer' }, [ta, h('div', { className: 'cc-di-actions' }, [
      sendBtn,
      h('button', {
        className: 'cc-di-ghost',
        onclick: function () {
          invoke({ action: 'update_intent', chat_id: _open.chatId, intent: 'out_of_scope' })
            .then(function () { _in.phase = 'idle'; ensureList(_in.uid); status.textContent = 'Marked not a fit.'; })
            .catch(function (e) { console.error('[directory-inbox] INTENT_FAILED', e); status.textContent = 'Could not update.'; });
        }
      }, 'Not a fit'),
      h('button', {
        className: 'cc-di-ghost',
        onclick: function () {
          invoke({ action: 'close', chat_id: _open.chatId })
            .then(function () { _in.phase = 'idle'; ensureList(_in.uid); status.textContent = 'Closed.'; })
            .catch(function (e) { console.error('[directory-inbox] CLOSE_FAILED', e); status.textContent = 'Could not close.'; });
        }
      }, 'Mark closed')
    ]), status]));

    return wrap;
  }

  // ── panel ───────────────────────────────────────────────────────────────────
  CD.DirectoryInbox = {
    renderPanel: function (ctx) {
      if (!ctx || !ctx.h) return null;
      var h = ctx.h;
      var uid = (ctx.user && ctx.user.id) || null;
      if (!uid) return null;

      ensureList(uid);

      // No listing → no panel. Distinguished from "listing with zero messages",
      // which does render (and says so).
      if (_in.phase === 'error' && /not_found|no_listing/i.test(_in.err || '')) return null;

      var body;
      if (_in.phase === 'loading' || _in.phase === 'idle') {
        body = [h('div', { className: 'cc-skel' }), h('div', { className: 'cc-skel' })];
      } else if (_in.phase === 'error') {
        body = h('div', { className: 'cc-empty' }, [
          h('div', { className: 'cc-empty-ico' }, '⚠️'),
          h('div', { className: 'cc-empty-title' }, 'Couldn’t load your messages'),
          h('div', { className: 'cc-empty-sub' }, _in.err || ''),
          h('button', { className: 'cc-retry', onclick: function () { _in.phase = 'idle'; ensureList(uid); } }, 'Retry')
        ]);
      } else if (_open.chatId) {
        body = threadView(ctx);
      } else {
        var chats = _in.chats || [];
        if (!chats.length) {
          body = h('div', { className: 'cc-empty' }, [
            h('div', { className: 'cc-empty-ico' }, '📭'),
            h('div', { className: 'cc-empty-title' }, 'No directory messages yet'),
            h('div', { className: 'cc-empty-sub' }, 'When someone chats with the assistant on your directory listing and asks to be contacted, the conversation lands here.')
          ]);
        } else {
          var shown = _viewAll ? chats : chats.slice(0, 3);
          var list = h('div', { className: 'cc-di-list' });
          shown.forEach(function (c) { list.appendChild(row(ctx, c)); });
          body = [list];
          if (chats.length > 3) {
            body.push(h('button', {
              className: 'cc-di-viewall',
              onclick: function () { _viewAll = !_viewAll; repaint(); }
            }, _viewAll ? 'Show fewer' : 'View all ' + chats.length + ' conversations'));
          }
        }
      }

      return card(ctx, {
        title: 'Messages',
        count: _in.unread || null,
        meta: 'Directory',
        delay: '.26s'
      }, body);
    }
  };

  // Local mirror of attorney-dashboard.js's _card so this module does not depend on
  // a private helper in another file.
  function card(ctx, opts, body) {
    var h = ctx.h;
    var sec = h('section', { className: 'cc-card cc-rise', style: opts.delay ? { '--d': opts.delay } : null });
    if (opts.title) {
      var hd = h('div', { className: 'cc-card-hd' });
      hd.appendChild(h('h2', { className: 'cc-card-title' }, opts.title));
      if (opts.count != null) hd.appendChild(h('span', { className: 'cc-count' }, String(opts.count)));
      if (opts.meta) hd.appendChild(h('span', { className: 'cc-card-meta' }, opts.meta));
      sec.appendChild(hd);
    }
    if (Array.isArray(body)) body.forEach(function (n) { if (n) sec.appendChild(n); });
    else if (body) sec.appendChild(body);
    return sec;
  }

  // ── styles (scoped, reuses the Command Center palette) ──────────────────────
  var CSS = [
    '.cc-di-list{display:flex;flex-direction:column;gap:8px}',
    '.cc-di-row{text-align:left;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);',
    'border-radius:12px;padding:12px 14px;cursor:pointer;color:inherit;font:inherit;width:100%;min-height:44px}',
    '.cc-di-row:hover{background:rgba(255,255,255,.07);border-color:rgba(255,255,255,.16)}',
    '.cc-di-row.is-unread{border-color:rgba(232,119,34,.45)}',
    '.cc-di-row-top{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:4px}',
    '.cc-di-name{font-weight:600;font-size:14px}',
    '.cc-di-meta{display:flex;align-items:center;gap:8px;flex:0 0 auto}',
    '.cc-di-intent{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;opacity:.7}',
    '.cc-di-when{font-size:11px;opacity:.55}',
    '.cc-di-dot{background:#E87722;color:#fff;border-radius:999px;font-size:10.5px;font-weight:700;',
    'min-width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;padding:0 5px}',
    '.cc-di-q{font-size:13px;opacity:.78;line-height:1.5}',
    '.cc-di-viewall{margin-top:10px;background:transparent;border:1px solid rgba(255,255,255,.16);',
    'border-radius:10px;padding:9px 14px;color:inherit;font:inherit;font-size:13px;cursor:pointer;min-height:44px;width:100%}',
    '.cc-di-back{background:transparent;border:0;color:inherit;opacity:.7;font:inherit;font-size:13px;',
    'cursor:pointer;padding:2px 0 10px;min-height:36px}',
    '.cc-di-contact{display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding-bottom:10px;',
    'border-bottom:1px solid rgba(255,255,255,.09);margin-bottom:10px;font-size:13px}',
    '.cc-di-contact a{color:#F4C28C;text-decoration:none;min-height:44px;display:inline-flex;align-items:center}',
    '.cc-di-internal{background:rgba(232,119,34,.10);border:1px dashed rgba(232,119,34,.5);',
    'border-radius:11px;padding:11px 13px;margin-bottom:12px}',
    '.cc-di-internal-tag{font-size:10px;letter-spacing:.08em;font-weight:700;color:#F4C28C;margin-bottom:6px}',
    '.cc-di-internal-body{white-space:pre-wrap;font:inherit;font-size:13px;line-height:1.6;margin:0;opacity:.92}',
    '.cc-di-msgs{display:flex;flex-direction:column;gap:9px;max-height:320px;overflow-y:auto;margin-bottom:12px}',
    '.cc-di-msg{border-radius:11px;padding:9px 12px;background:rgba(255,255,255,.05)}',
    '.cc-di-msg.is-attorney{background:rgba(232,119,34,.14)}',
    '.cc-di-msg-who{font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;opacity:.6;margin-bottom:3px}',
    '.cc-di-msg-body{font-size:13.5px;line-height:1.6;white-space:pre-wrap}',
    '.cc-di-ta{width:100%;box-sizing:border-box;background:rgba(255,255,255,.05);color:inherit;',
    'border:1px solid rgba(255,255,255,.14);border-radius:11px;padding:11px;font:inherit;font-size:14px;resize:vertical}',
    '.cc-di-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:9px}',
    '.cc-di-send{background:#E87722;color:#fff;border:0;border-radius:10px;padding:10px 18px;',
    'font-weight:600;cursor:pointer;min-height:44px}',
    '.cc-di-send:disabled{opacity:.5;cursor:default}',
    '.cc-di-ghost{background:transparent;border:1px solid rgba(255,255,255,.18);border-radius:10px;',
    'padding:10px 14px;color:inherit;font:inherit;font-size:13px;cursor:pointer;min-height:44px}',
    '.cc-di-status{font-size:12px;opacity:.7;margin-top:8px;min-height:16px}'
  ].join('');

  try {
    var s = document.createElement('style');
    s.setAttribute('data-cd', 'directory-inbox');
    s.textContent = CSS;
    document.head.appendChild(s);
  } catch (e) { console.error('[directory-inbox] STYLE_INJECT_FAILED', e); }

})(window, document);
