/**
 * accept-firm-invite
 *
 * Called after a newly invited attorney sets their password.
 * Activates their firm membership and grants Pro-tier access.
 *
 * Auth: Requires valid Supabase JWT (the invited user).
 * No request body needed — the user's identity comes from the JWT.
 *
 * Flow:
 *   1. Extract user ID from JWT
 *   2. Find pending firm_members row for this user
 *   3. Activate membership (status → 'active', accepted_at = now())
 *   4. Set profile: subscription_tier = 'pro', subscription_source = 'firm',
 *      user_type = 'attorney', designation = 'attorney', firm_id
 *   5. Upsert entitlements row with tier = 'pro'
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // ─── Verify JWT and get user ───
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    return jsonError('Missing authorization token', 401);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Verify the JWT to get user ID
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return jsonError('Invalid or expired token', 401);
  }

  const userId = user.id;
  console.log(`[accept-firm-invite] Processing for user: ${userId} (${user.email})`);

  // ─── Find pending firm membership ───
  const { data: membership, error: memError } = await supabase
    .from('firm_members')
    .select('id, firm_id, status')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .limit(1)
    .maybeSingle();

  if (memError) {
    console.error('[accept-firm-invite] Query error:', memError);
    return jsonError('Database error', 500);
  }

  if (!membership) {
    // No pending membership — might already be activated, or not invited
    console.log(`[accept-firm-invite] No pending membership for ${userId}`);
    return jsonOk({ activated: false, reason: 'no_pending_membership' });
  }

  const firmId = membership.firm_id;
  console.log(`[accept-firm-invite] Found pending membership for firm: ${firmId}`);

  // ─── Activate membership ───
  const { error: updateMemError } = await supabase
    .from('firm_members')
    .update({
      status: 'active',
      accepted_at: new Date().toISOString(),
    })
    .eq('id', membership.id);

  if (updateMemError) {
    console.error('[accept-firm-invite] Membership update failed:', updateMemError);
    return jsonError('Failed to activate membership', 500);
  }

  // ─── Update profile ───
  const { error: profileError } = await supabase
    .from('profiles')
    .update({
      subscription_tier: 'pro',
      subscription_status: 'active',
      subscription_source: 'firm',
      firm_id: firmId,
      user_type: 'attorney',
      designation: 'attorney',
    })
    .eq('id', userId);

  if (profileError) {
    console.error('[accept-firm-invite] Profile update failed:', profileError);
    // Non-fatal — membership is already active
  }

  // ─── Upsert entitlements ───
  const { error: entError } = await supabase
    .from('entitlements')
    .upsert({
      user_id: userId,
      tier: 'pro',
      features: { firm_member: true },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

  if (entError) {
    console.error('[accept-firm-invite] Entitlements upsert failed:', entError);
    // Non-fatal
  }

  console.log(`[accept-firm-invite] Activated: ${userId} → pro (firm: ${firmId})`);

  return jsonOk({ activated: true, firm_id: firmId });
});

function jsonOk(data: Record<string, unknown>) {
  return new Response(JSON.stringify({ success: true, ...data }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
