/**
 * revenuecat-webhook
 *
 * Handles RevenueCat webhook events to keep profiles.subscription_tier
 * in sync with Apple IAP / Google Play subscription state.
 *
 * Handled events:
 *   INITIAL_PURCHASE       → activate subscription
 *   RENEWAL                → re-activate (handles lapsed → active)
 *   PRODUCT_CHANGE         → tier upgrade/downgrade
 *   CANCELLATION           → mark cancelled (access continues until period end)
 *   EXPIRATION             → downgrade to free
 *   BILLING_ISSUE_DETECTED → flag billing issue
 *   SUBSCRIBER_ALIAS       → link RevenueCat alias
 *
 * Environment variables required (set via `supabase secrets set`):
 *   REVENUECAT_WEBHOOK_AUTH_KEY — shared secret from RevenueCat dashboard
 *   SUPABASE_URL               — injected automatically
 *   SUPABASE_SERVICE_ROLE_KEY  — injected automatically
 *
 * Register this webhook in RevenueCat Dashboard → Project Settings → Webhooks:
 *   URL: https://ltibymvlytodkemdeeox.supabase.co/functions/v1/revenuecat-webhook
 *   Authorization: Bearer <REVENUECAT_WEBHOOK_AUTH_KEY>
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// RevenueCat product ID → Supabase tier mapping
// NOTE: ASC products use simple IDs (not reverse-DNS)
const PRODUCT_TIER_MAP: Record<string, string> = {
  'comp_buddy_monthly': 'comp_buddy',
  'pro_monthly':        'pro',
  'firm_monthly':       'firm',
};

interface RCEvent {
  type: string;
  app_user_id: string;
  original_app_user_id?: string;
  product_id?: string;
  entitlement_ids?: string[];
  expiration_at_ms?: number;
  event_timestamp_ms?: number;
  environment?: string;
  store?: string;
  period_type?: string;
  new_product_id?: string;
}

interface RCWebhookBody {
  api_version: string;
  event: RCEvent;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // ─── Auth check ───
  const authKey = Deno.env.get('REVENUECAT_WEBHOOK_AUTH_KEY');
  if (authKey) {
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (token !== authKey) {
      console.error('Unauthorized webhook request');
      return new Response('Unauthorized', { status: 401 });
    }
  }

  let body: RCWebhookBody;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const event = body.event;
  if (!event || !event.type) {
    return new Response('Missing event', { status: 400 });
  }

  console.log(`[RC Webhook] ${event.type} | user: ${event.app_user_id} | product: ${event.product_id || 'n/a'} | env: ${event.environment || 'n/a'}`);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ─── Log event for debugging ───
  await supabase.from('webhook_events').insert({
    stripe_event_id: `rc_${event.type}_${event.event_timestamp_ms || Date.now()}`,
    event_type: event.type,
    payload: body,
    source: 'revenuecat',
  });

  // ─── Resolve Supabase user ID ───
  // RevenueCat app_user_id should be the Supabase auth user UUID
  // (set during Purchases.logIn({ appUserID: user.id }))
  const userId = event.app_user_id;
  if (!userId || userId.startsWith('$RCAnonymousID:')) {
    console.log('[RC Webhook] Anonymous user — skipping profile update');
    return jsonOk();
  }

  // ─── Resolve tier from product ID ───
  function resolveTier(productId?: string): string {
    if (!productId) return 'free';
    return PRODUCT_TIER_MAP[productId] || 'free';
  }

  // ─── Determine subscription source (apple/google) ───
  function resolveSource(store?: string): string {
    if (store === 'APP_STORE' || store === 'MAC_APP_STORE') return 'apple';
    if (store === 'PLAY_STORE') return 'google';
    return 'apple'; // default for RevenueCat
  }

  // ─── Handle events ───
  switch (event.type) {

    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
    case 'UNCANCELLATION': {
      const tier = resolveTier(event.product_id);
      const source = resolveSource(event.store);

      const { error } = await supabase
        .from('profiles')
        .update({
          subscription_tier:   tier,
          subscription_status: 'active',
          subscription_source: source,
          revenuecat_app_user_id: userId,
        })
        .eq('id', userId);

      if (error) console.error('[RC Webhook] Profile update failed:', error);
      else console.log(`[RC Webhook] Activated: ${userId} → ${tier} (${source})`);

      // Also update entitlements table
      await supabase
        .from('entitlements')
        .upsert({
          user_id:    userId,
          tier:       tier,
          features:   {},
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

      break;
    }

    case 'PRODUCT_CHANGE': {
      // User upgraded or downgraded
      const newTier = resolveTier(event.new_product_id || event.product_id);
      const source = resolveSource(event.store);

      const { error } = await supabase
        .from('profiles')
        .update({
          subscription_tier:   newTier,
          subscription_status: 'active',
          subscription_source: source,
        })
        .eq('id', userId);

      if (error) console.error('[RC Webhook] Product change failed:', error);
      else console.log(`[RC Webhook] Product change: ${userId} → ${newTier}`);

      await supabase
        .from('entitlements')
        .upsert({
          user_id:    userId,
          tier:       newTier,
          features:   {},
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

      break;
    }

    case 'CANCELLATION': {
      // User cancelled — access continues until period end.
      // We keep the tier active but mark status as 'canceled'.
      const { error } = await supabase
        .from('profiles')
        .update({ subscription_status: 'canceled' })
        .eq('id', userId);

      if (error) console.error('[RC Webhook] Cancellation update failed:', error);
      else console.log(`[RC Webhook] Cancelled (still active until period end): ${userId}`);
      break;
    }

    case 'EXPIRATION': {
      // Subscription period ended — downgrade to free.
      const { error } = await supabase
        .from('profiles')
        .update({
          subscription_tier:   'free',
          subscription_status: 'expired',
        })
        .eq('id', userId);

      if (error) console.error('[RC Webhook] Expiration update failed:', error);
      else console.log(`[RC Webhook] Expired → free: ${userId}`);

      await supabase
        .from('entitlements')
        .upsert({
          user_id:    userId,
          tier:       'free',
          features:   {},
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

      break;
    }

    case 'BILLING_ISSUE_DETECTED': {
      const { error } = await supabase
        .from('profiles')
        .update({ subscription_status: 'billing_issue' })
        .eq('id', userId);

      if (error) console.error('[RC Webhook] Billing issue update failed:', error);
      else console.log(`[RC Webhook] Billing issue flagged: ${userId}`);
      break;
    }

    case 'SUBSCRIBER_ALIAS': {
      // Just log — aliases handled by RevenueCat internally
      console.log(`[RC Webhook] Alias event for ${userId}`);
      break;
    }

    default:
      console.log(`[RC Webhook] Unhandled event type: ${event.type}`);
  }

  return jsonOk();
});

function jsonOk() {
  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
