// directory-chat-inbox — attorney side of the /directory intake chat.
//
// verify_jwt = true.
//
// AUTHORIZATION MODEL: the caller's own JWT drives a user-scoped Supabase client, so
// every read and write goes through the RLS policies, which call owns_directory_chat().
// A client-supplied profile_id or chat ownership claim is never trusted — there is no
// code path here that takes ownership from the request body. The service role is used
// only for the two things RLS deliberately does not permit an attorney to do directly:
// writing the append-only audit log, and sending mail.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const SITE_ORIGIN = Deno.env.get('SITE_ORIGIN') ?? 'https://thecompdesk.com';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
};

const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
function fail(code: string, message: string, status = 400) {
  console.error(`[directory-chat-inbox] ${code}: ${message}`);
  return json({ ok: false, code, error: message }, status);
}

const esc = (s: string) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function logEvent(chatId: string, event: string, meta: Record<string, unknown> = {}) {
  const { error } = await svc.from('directory_chat_events').insert({ chat_id: chatId, event, meta });
  if (error) console.error(`[directory-chat-inbox] event-log-failed ${event}: ${error.message}`);
}

async function sendEmail(to: string, subject: string, html: string, replyTo?: string) {
  if (!RESEND_API_KEY) return { ok: false, id: null, error: 'RESEND_API_KEY unset' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'The Comp Desk <notifications@thecompdesk.com>',
        to: [to], subject, html, ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, id: null, error: JSON.stringify(body) };
    return { ok: true, id: body?.id ?? null, error: null };
  } catch (e) {
    return { ok: false, id: null, error: String(e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return fail('method_not_allowed', 'POST only', 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return fail('unauthorized', 'Missing Authorization header', 401);

  // User-scoped client: every query below is filtered by RLS for this attorney.
  const db = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userRes } = await db.auth.getUser();
  const user = userRes?.user;
  if (!user) return fail('unauthorized', 'Invalid session', 401);

  let payload: Record<string, unknown>;
  try { payload = await req.json(); }
  catch { return fail('bad_json', 'Body must be JSON'); }
  const action = String(payload.action ?? '');

  try {
    // ── list ─────────────────────────────────────────────────────────────────
    if (action === 'list') {
      const { data: allChats, error } = await db
        .from('directory_chats')
        .select('id, intent, status, visitor_name, visitor_email, visitor_phone_e164, '
          + 'question_presented, summary_for_attorney, routed_at, first_attorney_reply_at, '
          + 'closed_at, created_at, updated_at')
        .order('updated_at', { ascending: false })
        .limit(300);
      if (error) return fail('list_failed', error.message, 500);

      // The widget mints a chat row on page LOAD so the greeting can carry the
      // listing's configured copy. That means every ordinary page view — and every
      // JS-executing crawler — leaves a row behind with nothing in it but the
      // greeting. Showing those would bury real leads under empty conversations, so
      // the inbox lists a chat only once a visitor has actually said something (or it
      // has been routed). The empty rows stay in the table as raw telemetry.
      //
      // TODO: stop creating the row until first send. That needs `start` split into a
      // config fetch (no row) plus lazy creation on first message, which touches both
      // the widget and directory-chat, so it is deliberately not bundled in here.
      const candidateIds = (allChats ?? []).map((c) => c.id);
      let withVisitor = new Set<string>();
      if (candidateIds.length) {
        const { data: vis } = await db
          .from('directory_chat_messages')
          .select('chat_id')
          .in('chat_id', candidateIds)
          .eq('role', 'visitor');
        withVisitor = new Set((vis ?? []).map((m) => m.chat_id as string));
      }
      const chats = (allChats ?? [])
        .filter((c) => withVisitor.has(c.id) || c.status !== 'open')
        .slice(0, 100);

      const ids = chats.map((c) => c.id);
      let unread: Record<string, number> = {};
      if (ids.length) {
        const { data: msgs } = await db
          .from('directory_chat_messages')
          .select('chat_id, role, created_at')
          .in('chat_id', ids)
          .eq('is_internal', false)
          .order('created_at', { ascending: true });
        // Unread = visitor messages after this attorney's most recent reply.
        const lastReply: Record<string, string> = {};
        (msgs ?? []).forEach((m) => {
          if (m.role === 'attorney') lastReply[m.chat_id] = m.created_at;
        });
        (msgs ?? []).forEach((m) => {
          if (m.role !== 'visitor') return;
          const cut = lastReply[m.chat_id];
          if (!cut || m.created_at > cut) unread[m.chat_id] = (unread[m.chat_id] ?? 0) + 1;
        });
      }

      return json({
        ok: true,
        chats: chats.map((c) => ({ ...c, unread: unread[c.id] ?? 0 })),
        total_unread: Object.values(unread).reduce((a, b) => a + b, 0),
      });
    }

    // Remaining actions operate on one chat. RLS decides whether it is visible.
    const chatId = String(payload.chat_id ?? '');
    if (!chatId) return fail('missing_chat_id', 'chat_id is required');

    const { data: chat, error: cErr } = await db
      .from('directory_chats').select('*').eq('id', chatId).maybeSingle();
    if (cErr) return fail('chat_lookup_failed', cErr.message, 500);
    // Not-found and not-yours are the same response on purpose: a 403 here would
    // confirm the existence of another attorney's chat to anyone guessing UUIDs.
    if (!chat) return fail('not_found', 'No such conversation', 404);

    // ── thread (full, including the internal AI summary) ─────────────────────
    if (action === 'thread') {
      const { data: msgs, error } = await db
        .from('directory_chat_messages')
        .select('id, role, body, is_internal, created_at')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true });
      if (error) return fail('thread_failed', error.message, 500);
      return json({ ok: true, chat, messages: msgs ?? [] });
    }

    // ── reply ────────────────────────────────────────────────────────────────
    if (action === 'reply') {
      const text = String(payload.text ?? '').trim();
      if (!text) return fail('empty_reply', 'text is required');
      if (text.length > 5000) return fail('reply_too_long', 'Max 5000 characters', 413);

      // The insert policy requires owns_directory_chat AND role = 'attorney'.
      const { error: mErr } = await db.from('directory_chat_messages')
        .insert({ chat_id: chatId, role: 'attorney', body: text });
      if (mErr) return fail('reply_failed', mErr.message, 500);

      const patch: Record<string, unknown> = { status: 'attorney_replied' };
      if (!chat.first_attorney_reply_at) patch.first_attorney_reply_at = new Date().toISOString();
      const { error: uErr } = await db.from('directory_chats').update(patch).eq('id', chatId);
      if (uErr) return fail('status_update_failed', uErr.message, 500);

      await logEvent(chatId, 'attorney_reply', { chars: text.length });

      if (chat.visitor_email) {
        const url = `${SITE_ORIGIN}/directory/thread?t=${chat.session_token}`;
        const r = await sendEmail(
          chat.visitor_email,
          'You have a reply about your workers’ compensation question',
          `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
             <h2 style="margin:0 0 14px;font-size:20px">You have a reply</h2>
             <pre style="white-space:pre-wrap;font-family:inherit;font-size:15px;line-height:1.6;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin:0 0 18px">${esc(text)}</pre>
             <a href="${esc(url)}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600">View and reply</a>
             <p style="font-size:12px;color:#94a3b8;margin:22px 0 0;line-height:1.5">This message is not legal advice, and no attorney-client relationship is formed by using this chat or by receiving this email. Attorney Advertising.</p>
           </div>`,
        );
        await logEvent(chatId, r.ok ? 'notify_sent' : 'notify_failed',
          { channel: 'email_visitor_reply', resend_id: r.id, error: r.error });
      } else {
        await logEvent(chatId, 'notify_skipped_no_email', { channel: 'email_visitor_reply' });
      }

      return json({ ok: true });
    }

    // ── close ────────────────────────────────────────────────────────────────
    if (action === 'close') {
      const { error } = await db.from('directory_chats')
        .update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', chatId);
      if (error) return fail('close_failed', error.message, 500);
      await logEvent(chatId, 'closed', { by: 'attorney' });
      return json({ ok: true });
    }

    // ── update_intent ("Not a fit") ──────────────────────────────────────────
    if (action === 'update_intent') {
      const intent = String(payload.intent ?? '');
      if (!['unknown', 'lead', 'info_only', 'has_counsel', 'out_of_scope', 'abandoned'].includes(intent)) {
        return fail('bad_intent', 'Unsupported intent');
      }
      const { error } = await db.from('directory_chats').update({ intent }).eq('id', chatId);
      if (error) return fail('intent_failed', error.message, 500);
      await logEvent(chatId, 'intent_changed', { intent, by: 'attorney' });
      return json({ ok: true, intent });
    }

    return fail('unknown_action', `Unsupported action "${action}"`);
  } catch (e) {
    return fail('unhandled', String(e), 500);
  }
});
