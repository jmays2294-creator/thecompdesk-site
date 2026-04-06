/**
 * submit-attorney-lead
 *
 * Receives an injured-worker intake submission from find-attorney.html,
 * re-validates all fields server-side, rate-limits by IP hash / email / phone,
 * inserts a row into attorney_leads, and emails intake@thecompdesk.com via Resend.
 *
 * Environment variables required (set via `supabase secrets set`):
 *   RESEND_API_KEY          — Resend API key
 *   TURNSTILE_SECRET_KEY    — Cloudflare Turnstile secret key
 *   SUPABASE_URL            — injected automatically by Supabase runtime
 *   SUPABASE_SERVICE_ROLE_KEY — injected automatically by Supabase runtime
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { crypto } from 'https://deno.land/std@0.208.0/crypto/mod.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://www.thecompdesk.com',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Rate-limit thresholds
const RATE_LIMIT_IP_HOUR  = 3;
const RATE_LIMIT_IP_DAY   = 10;
const RATE_LIMIT_EMAIL_DAY = 2;
const RATE_LIMIT_PHONE_DAY = 2;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // ── Parse body ──────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  // ── Cloudflare Turnstile verification ───────────────────────
  const turnstileToken = str(body.cf_turnstile_response);
  if (!turnstileToken) {
    return json({ error: 'Missing CAPTCHA token' }, 400);
  }
  const turnstileOk = await verifyTurnstile(turnstileToken, req);
  if (!turnstileOk) {
    return json({ error: 'CAPTCHA verification failed' }, 400);
  }

  // ── Honeypot check ──────────────────────────────────────────
  if (str(body._hp)) {
    // Bot filled the hidden field; silently accept but discard.
    return json({ ok: true, id: 'honeypot' }, 200);
  }

  // ── Field validation ─────────────────────────────────────────
  const firstName         = str(body.first_name).trim();
  const lastName          = str(body.last_name).trim();
  const phoneRaw          = str(body.phone).trim();
  const email             = str(body.email).trim().toLowerCase();
  const dateOfAccident    = str(body.date_of_accident).trim();
  const employerName      = str(body.employer_name).trim();
  const accidentDesc      = str(body.accident_description).trim();
  const injuries          = str(body.injuries).trim();
  const preferredContact  = str(body.preferred_contact).trim();
  const bestTime          = str(body.best_time).trim() || null;
  const geoLat            = body.geo_lat != null ? Number(body.geo_lat) : null;
  const geoLng            = body.geo_lng != null ? Number(body.geo_lng) : null;
  const geoZip            = str(body.geo_zip).trim() || null;
  const geoConsent        = body.geo_consent === true;
  const tcpaConsent       = body.tcpa_consent === true;
  const disclaimerAck     = body.disclaimer_ack === true;
  const utm               = (body.utm && typeof body.utm === 'object') ? body.utm : null;

  const errors: string[] = [];

  if (!firstName)  errors.push('first_name required');
  if (!lastName)   errors.push('last_name required');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('valid email required');
  if (!accidentDesc || accidentDesc.length < 20 || accidentDesc.length > 1500)
    errors.push('accident_description must be 20–1500 chars');
  if (!injuries || injuries.length < 5 || injuries.length > 1000)
    errors.push('injuries must be 5–1000 chars');
  if (!['phone', 'email', 'either'].includes(preferredContact))
    errors.push('preferred_contact must be phone/email/either');
  if (!tcpaConsent)    errors.push('tcpa_consent required');
  if (!disclaimerAck)  errors.push('disclaimer_ack required');
  if (!employerName)   errors.push('employer_name required');

  // Date of accident validation
  const doa = new Date(dateOfAccident);
  const now = new Date();
  if (isNaN(doa.getTime())) {
    errors.push('date_of_accident must be a valid date');
  } else {
    if (doa > now) errors.push('date_of_accident cannot be in the future');
    const tenYearsAgo = new Date(now.getFullYear() - 10, now.getMonth(), now.getDate());
    if (doa < tenYearsAgo) errors.push('date_of_accident is more than 10 years ago — verify');
  }

  // Phone normalization (E.164): strip non-digits, prepend +1 for US if needed
  const phoneE164 = normalizePhone(phoneRaw);
  if (!phoneE164) errors.push('valid US phone number required');

  if (errors.length) {
    return json({ error: errors.join('; ') }, 422);
  }

  // ── Supabase client (service-role — bypasses RLS) ────────────
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ── Rate limiting ────────────────────────────────────────────
  const ipHash = await hashString(req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown');

  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const dayAgo  = new Date(Date.now() - 86_400_000).toISOString();

  // IP: 3/hour
  const { count: ipHourCount } = await supabase
    .from('attorney_leads')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .gte('created_at', hourAgo);

  if ((ipHourCount ?? 0) >= RATE_LIMIT_IP_HOUR) {
    return json({ error: 'Too many submissions. Please wait before trying again.' }, 429);
  }

  // IP: 10/day
  const { count: ipDayCount } = await supabase
    .from('attorney_leads')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .gte('created_at', dayAgo);

  if ((ipDayCount ?? 0) >= RATE_LIMIT_IP_DAY) {
    return json({ error: 'Daily submission limit reached from this network.' }, 429);
  }

  // Email: 2/day
  const { count: emailCount } = await supabase
    .from('attorney_leads')
    .select('id', { count: 'exact', head: true })
    .eq('email', email)
    .gte('created_at', dayAgo);

  if ((emailCount ?? 0) >= RATE_LIMIT_EMAIL_DAY) {
    return json({ error: 'This email address has already been submitted today.' }, 429);
  }

  // Phone: 2/day
  const { count: phoneCount } = await supabase
    .from('attorney_leads')
    .select('id', { count: 'exact', head: true })
    .eq('phone_e164', phoneE164)
    .gte('created_at', dayAgo);

  if ((phoneCount ?? 0) >= RATE_LIMIT_PHONE_DAY) {
    return json({ error: 'This phone number has already been submitted today.' }, 429);
  }

  // ── Insert lead ──────────────────────────────────────────────
  const { data: lead, error: insertError } = await supabase
    .from('attorney_leads')
    .insert({
      source:               'web',
      source_version:       '2.0',
      first_name:           firstName,
      last_name:            lastName,
      phone_e164:           phoneE164!,
      email,
      date_of_accident:     dateOfAccident,
      employer_name:        employerName,
      accident_description: accidentDesc,
      injuries,
      preferred_contact:    preferredContact,
      best_time:            bestTime,
      geo_lat:              geoLat,
      geo_lng:              geoLng,
      geo_zip:              geoZip,
      geo_consent:          geoConsent,
      tcpa_consent:         tcpaConsent,
      disclaimer_ack:       disclaimerAck,
      user_agent:           req.headers.get('user-agent'),
      ip_hash:              ipHash,
      utm,
      status:               'new',
    })
    .select('id')
    .single();

  if (insertError) {
    console.error('Insert failed:', insertError);
    return json({ error: 'Submission failed. Please try again.' }, 500);
  }

  // ── Email via Resend ─────────────────────────────────────────
  const emailBody = buildEmailBody({
    firstName, lastName, phoneE164: phoneE164!, email,
    dateOfAccident, employerName, accidentDesc, injuries,
    preferredContact, bestTime, geoLat, geoLng, geoZip,
    geoConsent, tcpaConsent, id: lead.id,
  });

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    'The Comp Desk <noreply@thecompdesk.com>',
        to:      ['intake@thecompdesk.com'],
        subject: `[New Lead] ${firstName} ${lastName} — ${employerName} — DOA ${dateOfAccident}`,
        text:    emailBody,
      }),
    });

    if (resendRes.ok) {
      await supabase
        .from('attorney_leads')
        .update({ status: 'emailed' })
        .eq('id', lead.id);
    } else {
      console.error('Resend error:', await resendRes.text());
    }
  } catch (emailErr) {
    // Email failure is non-fatal; lead is already saved.
    console.error('Email send failed:', emailErr);
  }

  return json({ ok: true, id: lead.id }, 200);
});

// ── Helpers ──────────────────────────────────────────────────

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  return null;
}

async function hashString(s: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(s);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function verifyTurnstile(token: string, req: Request): Promise<boolean> {
  const secret = Deno.env.get('TURNSTILE_SECRET_KEY');
  if (!secret) {
    console.warn('TURNSTILE_SECRET_KEY not set — skipping verification');
    return true;
  }
  try {
    const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || '';
    const formData = new FormData();
    formData.append('secret', secret);
    formData.append('response', token);
    if (ip) formData.append('remoteip', ip);

    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData,
    });
    const data: { success: boolean } = await res.json();
    return data.success === true;
  } catch {
    return false;
  }
}

function buildEmailBody(f: {
  firstName: string; lastName: string; phoneE164: string; email: string;
  dateOfAccident: string; employerName: string; accidentDesc: string; injuries: string;
  preferredContact: string; bestTime: string | null;
  geoLat: number | null; geoLng: number | null; geoZip: string | null;
  geoConsent: boolean; tcpaConsent: boolean; id: string;
}): string {
  return [
    '=== NEW INJURED WORKER LEAD ===',
    '',
    `Lead ID:           ${f.id}`,
    `Name:              ${f.firstName} ${f.lastName}`,
    `Phone:             ${f.phoneE164}`,
    `Email:             ${f.email}`,
    `Preferred contact: ${f.preferredContact}`,
    f.bestTime ? `Best time:         ${f.bestTime}` : '',
    '',
    `Date of accident:  ${f.dateOfAccident}`,
    `Employer:          ${f.employerName}`,
    '',
    'Accident description:',
    f.accidentDesc,
    '',
    'Injuries:',
    f.injuries,
    '',
    '--- Location ---',
    f.geoZip     ? `ZIP:               ${f.geoZip}` : '',
    f.geoLat != null ? `Lat/Lng:           ${f.geoLat}, ${f.geoLng}` : '',
    `Geo consent:       ${f.geoConsent}`,
    '',
    '--- Consents ---',
    `TCPA consent:      ${f.tcpaConsent}`,
    `Disclaimer ack:    true`,
    '',
    'Reply directly to this email to contact the lead.',
  ].filter(line => line !== undefined).join('\n');
}
