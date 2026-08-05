// directory-chat — public intake agent for /directory listing pages.
//
// verify_jwt = false. Anyone on the open internet can call this, so every action is
// keyed by an opaque session_token minted server-side, never by a client-supplied id.
//
// Structure mirrors comp-buddy-chat (SDK pin, Haiku, ephemeral cache, budget ceiling,
// rate limit, fail-loud codes) with ONE deliberate divergence: CORS. comp-buddy-chat
// sends 'Access-Control-Allow-Headers: authorization, content-type', which omits
// x-client-info — a header supabase-js functions.invoke() always sends — so its browser
// preflight fails and callers must hand-roll fetch. That is a live bug there, not a
// pattern to copy. Tracked separately; deliberately not fixed in this build.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.40.0';
import {
  buildSystemPrompt,
  HANDOFF_EXTRACTION_PROMPT,
  SYSTEM_PROMPT_VERSION,
} from './system_prompt.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const OPENPHONE_API_KEY = Deno.env.get('OPENPHONE_API_KEY'); // optional; see sendSms
const SITE_ORIGIN = Deno.env.get('SITE_ORIGIN') ?? 'https://thecompdesk.com';

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 500;
const MAX_TURNS = 12;
const MAX_TEXT_LEN = 2000;
const DIRECTORY_CHAT_BUDGET_USD = 15;
const RATE_LIMIT_TURNS_PER_DAY = 20;
const SURFACE = 'directory';

const INPUT_COST_PER_M = 1.00;
const OUTPUT_COST_PER_M = 5.00;
const CACHE_READ_MULTIPLIER = 0.10;

const CONSENT_COPY_VERSION = 'directory-tcpa-2026-08-05';
const CONSENT_COPY =
  'I agree to be contacted by phone, text, or email about my workers’ compensation ' +
  'question. Message and data rates may apply. Consent is not a condition of any service.';

// x-client-info and apikey are required: supabase-js functions.invoke() sends both.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
};

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// Fail loud. Never a silent default-down: a swallowed error here becomes a dead widget
// on a page whose whole purpose is capturing a lead.
function fail(code: string, message: string, status = 400) {
  console.error(`[directory-chat] ${code}: ${message}`);
  return json({ ok: false, code, error: message }, status);
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
}

function mintToken(): string {
  // 32 bytes of CSPRNG, hex-encoded.
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function logEvent(chatId: string, event: string, meta: Record<string, unknown> = {}) {
  const { error } = await db.from('directory_chat_events').insert({ chat_id: chatId, event, meta });
  if (error) console.error(`[directory-chat] event-log-failed ${event}: ${error.message}`);
}

// ── rate limit ─────────────────────────────────────────────────────────────────
// Reuses anonymous_chat_quota with surface='directory'. That table is already
// multi-surface ('job_duties', 'extension'); no new table.
async function checkAndBumpQuota(ipHash: string): Promise<{ ok: boolean; count: number }> {
  const day = new Date().toISOString().slice(0, 10);
  const { data, error } = await db
    .from('anonymous_chat_quota')
    .select('chat_count')
    .eq('ip_hash', ipHash).eq('day_bucket', day).eq('surface', SURFACE)
    .maybeSingle();
  if (error) {
    console.error(`[directory-chat] quota-read-failed: ${error.message}`);
    return { ok: true, count: 0 }; // fail OPEN on infra error — never block a real lead
  }
  const count = data?.chat_count ?? 0;
  if (count >= RATE_LIMIT_TURNS_PER_DAY) return { ok: false, count };

  const { error: upErr } = await db.from('anonymous_chat_quota').upsert({
    ip_hash: ipHash, day_bucket: day, surface: SURFACE,
    chat_count: count + 1, last_seen_at: new Date().toISOString(),
  }, { onConflict: 'ip_hash,day_bucket,surface' });
  if (upErr) console.error(`[directory-chat] quota-bump-failed: ${upErr.message}`);
  return { ok: true, count: count + 1 };
}

// ── budget ─────────────────────────────────────────────────────────────────────
async function spentUsd(): Promise<number> {
  const { data, error } = await db
    .from('directory_chat_events')
    .select('meta')
    .eq('event', 'model_call')
    .gte('created_at', new Date(Date.now() - 30 * 864e5).toISOString());
  if (error) { console.error(`[directory-chat] budget-read-failed: ${error.message}`); return 0; }
  return (data ?? []).reduce((s, r) => s + (Number((r.meta as Record<string, unknown>)?.cost_usd) || 0), 0);
}

function costOf(u: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number }) {
  const inTok = u.input_tokens ?? 0, outTok = u.output_tokens ?? 0, cached = u.cache_read_input_tokens ?? 0;
  return (inTok / 1e6) * INPUT_COST_PER_M
       + (cached / 1e6) * INPUT_COST_PER_M * CACHE_READ_MULTIPLIER
       + (outTok / 1e6) * OUTPUT_COST_PER_M;
}

// ── notifications ──────────────────────────────────────────────────────────────
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

// No SMS provider is wired into this codebase. This is a real implementation behind a
// key that is not currently set; with the key unset it logs notify_skipped_sms and the
// handoff continues. It must never be reported as "SMS works" until the key is set and
// a real send has been observed.
async function sendSms(toE164: string, body: string) {
  if (!OPENPHONE_API_KEY) return { ok: false, skipped: true, error: 'OPENPHONE_API_KEY unset' };
  try {
    const r = await fetch('https://api.openphone.com/v1/messages', {
      method: 'POST',
      headers: { Authorization: OPENPHONE_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: [toE164], content: body }),
    });
    if (!r.ok) return { ok: false, skipped: false, error: await r.text() };
    return { ok: true, skipped: false, error: null };
  } catch (e) {
    return { ok: false, skipped: false, error: String(e) };
  }
}

const esc = (s: string) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function attorneyEmailHtml(o: {
  question: string; summary: string; name: string; email: string; phone: string; threadUrl: string;
}) {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
  <p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#64748b;margin:0 0 4px">New directory chat</p>
  <h2 style="margin:0 0 16px;font-size:20px;line-height:1.3">${esc(o.question)}</h2>
  <pre style="white-space:pre-wrap;font-family:inherit;font-size:15px;line-height:1.55;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin:0 0 18px">${esc(o.summary)}</pre>
  <table style="font-size:15px;line-height:1.6;margin:0 0 20px"><tbody>
    <tr><td style="color:#64748b;padding-right:12px">Name</td><td>${esc(o.name || 'not stated')}</td></tr>
    <tr><td style="color:#64748b;padding-right:12px">Phone</td><td><a href="tel:${esc(o.phone)}">${esc(o.phone || 'not stated')}</a></td></tr>
    <tr><td style="color:#64748b;padding-right:12px">Email</td><td><a href="mailto:${esc(o.email)}">${esc(o.email || 'not stated')}</a></td></tr>
  </tbody></table>
  <a href="${esc(o.threadUrl)}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;font-size:15px">Open in your inbox</a>
  <p style="font-size:12px;color:#94a3b8;margin:22px 0 0;line-height:1.5">Reply-to on this email goes to the visitor. Sent by The Comp Desk Attorney Directory.</p>
</div>`;
}

function visitorEmailHtml(o: { firstName: string; attorney: string; threadUrl: string }) {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
  <h2 style="margin:0 0 14px;font-size:20px">Your message reached ${esc(o.attorney)}</h2>
  <p style="font-size:15px;line-height:1.6;margin:0 0 14px">Thanks for reaching out. ${esc(o.firstName)} has your message and usually replies within one business day.</p>
  <p style="font-size:15px;line-height:1.6;margin:0 0 18px">You can view the conversation or add anything you forgot here:</p>
  <a href="${esc(o.threadUrl)}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;font-size:15px">View your conversation</a>
  <p style="font-size:12px;color:#94a3b8;margin:22px 0 0;line-height:1.5">This message is not legal advice, and no attorney-client relationship is formed by using this chat or by receiving this email. Attorney Advertising.</p>
</div>`;
}

// ── model ──────────────────────────────────────────────────────────────────────
interface Turn { role: 'user' | 'assistant'; content: string }

async function modelTurn(chatId: string, profile: Record<string, string>, history: Turn[]) {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY unset');
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const firstName = String(profile.display_name ?? '').split(/[\s,]+/)[0] || 'the attorney';
  const system = buildSystemPrompt({
    displayName: String(profile.display_name ?? ''),
    firstName,
    agentName: String(profile.chat_agent_name ?? 'Alina'),
    firmName: String(profile.firm_name ?? ''),
  });

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: history.slice(-MAX_TURNS).map((m) => ({ role: m.role, content: m.content })),
  });

  const usage = res.usage as unknown as Record<string, number>;
  const cost = costOf(usage);
  await logEvent(chatId, 'model_call', {
    cost_usd: cost, prompt_version: SYSTEM_PROMPT_VERSION, model: MODEL,
    input_tokens: usage?.input_tokens, output_tokens: usage?.output_tokens,
  });

  const text = (res.content ?? [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text).join('').trim();
  return text || 'Sorry — could you say that again?';
}

// Visitor text is data. Wrapping in delimiters is the same hardening comp-buddy-chat
// applies to case_context, which is the good part of that file.
const wrapVisitor = (t: string) => `<visitor_message>\n${t}\n</visitor_message>`;

async function loadChat(token: string) {
  const { data, error } = await db
    .from('directory_chats')
    .select('*, directory_profiles!inner(*)')
    .eq('session_token', token)
    .maybeSingle();
  if (error) throw new Error(`chat lookup failed: ${error.message}`);
  return data;
}

async function history(chatId: string): Promise<Turn[]> {
  const { data } = await db
    .from('directory_chat_messages')
    .select('role, body')
    .eq('chat_id', chatId).eq('is_internal', false)
    .order('created_at', { ascending: true });
  return (data ?? [])
    .filter((m) => m.role === 'visitor' || m.role === 'agent')
    .map((m) => ({
      role: m.role === 'visitor' ? 'user' as const : 'assistant' as const,
      content: m.role === 'visitor' ? wrapVisitor(m.body) : m.body,
    }));
}

// ── handler ────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return fail('method_not_allowed', 'POST only', 405);

  let payload: Record<string, unknown>;
  try { payload = await req.json(); }
  catch { return fail('bad_json', 'Body must be JSON'); }

  const action = String(payload.action ?? '');
  const ipHash = await sha256(clientIp(req) + '|directory');

  try {
    // ── start ────────────────────────────────────────────────────────────────
    if (action === 'start') {
      const slug = String(payload.slug ?? '');
      if (!slug) return fail('missing_slug', 'slug is required');

      const { data: profile, error } = await db
        .from('directory_profiles')
        .select('id, slug, display_name, firm_name, chat_enabled, chat_agent_name, chat_agent_avatar_url, chat_greeting, chat_banner_text, public_phone_display, public_phone_e164, public_email')
        .eq('slug', slug).eq('status', 'published')
        .maybeSingle();
      if (error) return fail('profile_lookup_failed', error.message, 500);
      if (!profile) return fail('profile_not_found', `No published listing for "${slug}"`, 404);
      if (!profile.chat_enabled) return fail('chat_disabled', 'Chat is off for this listing', 403);

      const token = mintToken();
      const { data: chat, error: insErr } = await db.from('directory_chats').insert({
        directory_profile_id: profile.id,
        session_token: token,
        locale: String(payload.locale ?? 'en'),
        ip_hash: ipHash,
        user_agent: (req.headers.get('user-agent') ?? '').slice(0, 500),
      }).select('id').single();
      if (insErr) return fail('chat_create_failed', insErr.message, 500);

      const greeting = profile.chat_greeting
        ?? `Hi — I'm ${profile.chat_agent_name ?? 'Alina'}, the intake coordinator for ${profile.display_name}. What's going on?`;

      await db.from('directory_chat_messages').insert({
        chat_id: chat.id, role: 'agent', body: greeting,
      });
      await logEvent(chat.id, 'spawned', { slug, prompt_version: SYSTEM_PROMPT_VERSION });

      return json({
        ok: true,
        session_token: token,
        agent_name: profile.chat_agent_name ?? 'Alina',
        agent_avatar_url: profile.chat_agent_avatar_url ?? '/assets/directory/agent-alina.svg',
        banner_text: profile.chat_banner_text ?? `Speak with ${String(profile.display_name).split(/[\s,]+/)[0]} now`,
        attorney_name: profile.display_name,
        fallback_phone: profile.public_phone_display,
        fallback_phone_e164: profile.public_phone_e164,
        fallback_email: profile.public_email,
        greeting,
        consent_copy: CONSENT_COPY,
        consent_copy_version: CONSENT_COPY_VERSION,
      });
    }

    // every remaining action needs a session
    const token = String(payload.session_token ?? '');
    if (!token) return fail('missing_session', 'session_token is required');
    const chat = await loadChat(token);
    if (!chat) return fail('session_not_found', 'Unknown session', 404);
    const profile = (chat as Record<string, Record<string, string>>).directory_profiles;

    // ── message ──────────────────────────────────────────────────────────────
    if (action === 'message') {
      const text = String(payload.text ?? '').trim();
      if (!text) return fail('empty_message', 'text is required');
      if (text.length > MAX_TEXT_LEN) return fail('message_too_long', `Max ${MAX_TEXT_LEN} characters`, 413);

      const quota = await checkAndBumpQuota(ipHash);
      const overBudget = (await spentUsd()) >= DIRECTORY_CHAT_BUDGET_USD;

      await db.from('directory_chat_messages').insert({ chat_id: chat.id, role: 'visitor', body: text });

      // Degraded path: still capture the lead, never a broken widget.
      if (!quota.ok || overBudget) {
        const reply = `Thanks — let me just take your details and get this to ${String(profile.display_name).split(/[\s,]+/)[0]} directly.`;
        await db.from('directory_chat_messages').insert({ chat_id: chat.id, role: 'agent', body: reply });
        await logEvent(chat.id, overBudget ? 'budget_exceeded' : 'rate_limited', { count: quota.count });
        return json({ ok: true, reply, widget: 'contact_capture', degraded: true });
      }

      const reply = await modelTurn(chat.id, profile, [...(await history(chat.id))]);
      await db.from('directory_chat_messages').insert({ chat_id: chat.id, role: 'agent', body: reply });
      return json({ ok: true, reply, widget: null });
    }

    // ── consent ──────────────────────────────────────────────────────────────
    if (action === 'consent') {
      if (payload.consent !== true) return fail('consent_required', 'Consent checkbox must be checked');
      const email = String(payload.email ?? '').trim();
      const phone = String(payload.phone ?? '').trim();
      if (!email && !phone) return fail('contact_required', 'An email or phone number is required');

      const { error } = await db.from('directory_chats').update({
        visitor_name: String(payload.name ?? '').trim() || null,
        visitor_email: email || null,
        visitor_phone_e164: phone || null,
        consent_at: new Date().toISOString(),
        consent_copy_version: String(payload.copy_version ?? CONSENT_COPY_VERSION),
      }).eq('id', chat.id);
      if (error) return fail('consent_save_failed', error.message, 500);
      await logEvent(chat.id, 'consent_given', { copy_version: CONSENT_COPY_VERSION, has_phone: !!phone });
      return json({ ok: true });
    }

    // ── handoff ──────────────────────────────────────────────────────────────
    if (action === 'handoff') {
      if (!chat.consent_at) return fail('consent_missing', 'Capture consent before handoff');

      let question = 'New workers’ compensation question';
      let summary = '(summary unavailable)';
      try {
        if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY unset');
        const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
        const res = await anthropic.messages.create({
          model: MODEL, max_tokens: 400,
          system: HANDOFF_EXTRACTION_PROMPT,
          messages: [{
            role: 'user',
            content: (await history(chat.id)).map((m) => `${m.role}: ${m.content}`).join('\n\n')
              + `\n\ncontact: ${chat.visitor_name ?? ''} ${chat.visitor_email ?? ''} ${chat.visitor_phone_e164 ?? ''}`,
          }],
        });
        const raw = (res.content ?? []).filter((b: { type: string }) => b.type === 'text')
          .map((b: { text: string }) => b.text).join('');
        const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
        question = parsed.question_presented ?? question;
        summary = parsed.summary_for_attorney ?? summary;
        await logEvent(chat.id, 'model_call', { cost_usd: costOf(res.usage as unknown as Record<string, number>), purpose: 'handoff' });
      } catch (e) {
        // A failed extraction must not lose the lead. Route with a degraded summary.
        console.error(`[directory-chat] handoff-extract-failed: ${e}`);
        await logEvent(chat.id, 'handoff_extract_failed', { error: String(e) });
        summary = [chat.visitor_name, chat.visitor_email, chat.visitor_phone_e164]
          .filter(Boolean).join('\n') || '(contact on file)';
      }

      await db.from('directory_chats').update({
        intent: 'lead', status: 'routed',
        question_presented: question, summary_for_attorney: summary,
        routed_at: new Date().toISOString(),
      }).eq('id', chat.id);
      await db.from('directory_chat_messages').insert({
        chat_id: chat.id, role: 'system', body: `AI summary\n\n${question}\n\n${summary}`, is_internal: true,
      });
      await logEvent(chat.id, 'handoff', {});

      const threadUrl = `${SITE_ORIGIN}/directory/thread?t=${chat.session_token}`;
      const bodyPart = (chat.body_parts ?? [])[0] ?? 'WC question';

      // Notifications must never be able to lose an already-routed lead.
      const a = await sendEmail(
        String(profile.notify_email ?? ''),
        `New chat — ${chat.visitor_name ?? 'visitor'} (${bodyPart})`,
        attorneyEmailHtml({
          question, summary,
          name: chat.visitor_name ?? '', email: chat.visitor_email ?? '',
          phone: chat.visitor_phone_e164 ?? '',
          threadUrl: `${SITE_ORIGIN}/dashboard?inbox=${chat.id}`,
        }),
        chat.visitor_email ?? undefined,
      );
      await logEvent(chat.id, a.ok ? 'notify_sent' : 'notify_failed', { channel: 'email_attorney', resend_id: a.id, error: a.error });

      if (chat.visitor_email) {
        const v = await sendEmail(
          chat.visitor_email,
          `Your message reached ${profile.display_name}`,
          visitorEmailHtml({
            firstName: String(profile.display_name).split(/[\s,]+/)[0],
            attorney: String(profile.display_name), threadUrl,
          }),
        );
        await logEvent(chat.id, v.ok ? 'notify_sent' : 'notify_failed', { channel: 'email_visitor', resend_id: v.id, error: v.error });
      }

      if (profile.notify_sms_e164) {
        const s = await sendSms(String(profile.notify_sms_e164), `New Comp Desk chat: ${question}`);
        await logEvent(chat.id, s.skipped ? 'notify_skipped_sms' : (s.ok ? 'notify_sent' : 'notify_failed'),
          { channel: 'sms', error: s.error });
      }

      return json({ ok: true, status: 'routed', question_presented: question, thread_url: threadUrl });
    }

    // ── set_intent (info_only / has_counsel / out_of_scope terminal states) ───
    if (action === 'set_intent') {
      const intent = String(payload.intent ?? '');
      if (!['info_only', 'has_counsel', 'out_of_scope', 'abandoned'].includes(intent)) {
        return fail('bad_intent', 'Unsupported intent');
      }
      await db.from('directory_chats').update({
        intent, status: 'closed', closed_at: new Date().toISOString(),
      }).eq('id', chat.id);
      await logEvent(chat.id, 'closed', { intent, notified: false });
      return json({ ok: true, intent });
    }

    // ── thread ───────────────────────────────────────────────────────────────
    if (action === 'thread') {
      const { data } = await db.from('directory_chat_messages')
        .select('role, body, created_at')
        .eq('chat_id', chat.id).eq('is_internal', false)
        .order('created_at', { ascending: true });
      return json({
        ok: true, status: chat.status, attorney_name: profile.display_name,
        messages: data ?? [],
      });
    }

    // ── visitor_reply (from the /directory/thread page — no AI turn) ─────────
    if (action === 'visitor_reply') {
      const text = String(payload.text ?? '').trim();
      if (!text) return fail('empty_message', 'text is required');
      if (text.length > MAX_TEXT_LEN) return fail('message_too_long', `Max ${MAX_TEXT_LEN} characters`, 413);

      await db.from('directory_chat_messages').insert({ chat_id: chat.id, role: 'visitor', body: text });
      await logEvent(chat.id, 'visitor_reply', {});

      const r = await sendEmail(
        String(profile.notify_email ?? ''),
        `Reply from ${chat.visitor_name ?? 'visitor'}`,
        `<p style="font-family:sans-serif;white-space:pre-wrap">${esc(text)}</p>`,
        chat.visitor_email ?? undefined,
      );
      await logEvent(chat.id, r.ok ? 'notify_sent' : 'notify_failed', { channel: 'email_attorney_reply', resend_id: r.id, error: r.error });
      return json({ ok: true });
    }

    return fail('unknown_action', `Unsupported action "${action}"`);
  } catch (e) {
    return fail('unhandled', String(e), 500);
  }
});
