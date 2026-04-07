/**
 * user-stripe-webhook
 *
 * Handles Stripe webhook events for the Pro Tier user subscription flow.
 * Keeps `subscriptions` and `entitlements` tables in sync with Stripe state.
 * All events are logged to `webhook_events` for debugging.
 *
 * Handled events:
 *   checkout.session.completed       → insert subscription row, entitlements tier='pro'
 *   customer.subscription.updated    → update status + current_period_end
 *   customer.subscription.deleted    → entitlements tier back to 'free'
 *
 * Environment variables:
 *   STRIPE_WEBHOOK_SECRET     — Stripe webhook signing secret (whsec_...)
 *                               May be unset until tonight; function returns 500 if missing.
 *   SUPABASE_URL              — injected automatically by Supabase runtime
 *   SUPABASE_SERVICE_ROLE_KEY — injected automatically by Supabase runtime
 *
 * Register this endpoint in the Stripe dashboard:
 *   https://ltibymvlytodkemdeeox.supabase.co/functions/v1/user-stripe-webhook
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14?target=deno';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET is not set — paste it tonight via: supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...');
    return new Response(
      JSON.stringify({ error: 'STRIPE_WEBHOOK_SECRET not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const stripeSignature = req.headers.get('stripe-signature');
  if (!stripeSignature) {
    return new Response('Missing stripe-signature header', { status: 400 });
  }

  // Stripe requires the raw body for signature verification.
  const rawBody = await req.text();

  // We need a Stripe instance just for constructEvent — no key needed for that.
  // Use a dummy key; signature verification uses the webhook secret only.
  const stripe = new Stripe('sk_test_placeholder', { apiVersion: '2024-04-10' });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, stripeSignature, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return new Response('Invalid signature', { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Log every event before processing so we have a complete audit trail.
  await supabase.from('webhook_events').insert({
    stripe_event_id: event.id,
    event_type:      event.type,
    payload:         event.data.object as Record<string, unknown>,
    processed_at:    new Date().toISOString(),
  });

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== 'subscription') break;

        const userId         = session.client_reference_id;
        const customerId     = typeof session.customer === 'string'
          ? session.customer : session.customer?.id;
        const subscriptionId = typeof session.subscription === 'string'
          ? session.subscription : session.subscription?.id;

        if (!userId || !subscriptionId) {
          console.error('checkout.session.completed: missing user_id or subscription_id', session.id);
          break;
        }

        // Fetch the full subscription to get price + period end.
        const stripe2 = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? 'sk_test_placeholder', {
          apiVersion: '2024-04-10',
        });
        let priceId: string | null = null;
        let periodEnd: string | null = null;
        try {
          const sub = await stripe2.subscriptions.retrieve(subscriptionId);
          priceId   = sub.items.data[0]?.price?.id ?? null;
          periodEnd = sub.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString()
            : null;
        } catch (_e) {
          // Non-fatal — we still upsert with what we have.
        }

        // Upsert subscription row.
        const { error: subErr } = await supabase
          .from('subscriptions')
          .upsert({
            user_id:                userId,
            stripe_customer_id:     customerId ?? null,
            stripe_subscription_id: subscriptionId,
            status:                 'active',
            price_id:               priceId,
            current_period_end:     periodEnd,
            updated_at:             new Date().toISOString(),
          }, { onConflict: 'stripe_subscription_id' });

        if (subErr) console.error('Failed to upsert subscription:', subErr);

        // Upgrade entitlements to pro.
        const { error: entErr } = await supabase
          .from('entitlements')
          .upsert({
            user_id:    userId,
            tier:       'pro',
            features:   { comp_buddy: true, document_vault: true, claim_timeline: true, priority_support: true },
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id' });

        if (entErr) console.error('Failed to upsert entitlements to pro:', entErr);
        else console.log('User upgraded to pro:', userId);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const periodEnd    = subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000).toISOString()
          : null;

        // Map Stripe status → our constrained status enum.
        const statusMap: Record<string, string> = {
          trialing:   'trialing',
          active:     'active',
          past_due:   'past_due',
          canceled:   'canceled',
          incomplete: 'incomplete',
          incomplete_expired: 'canceled',
          unpaid:     'past_due',
          paused:     'past_due',
        };
        const status = statusMap[subscription.status] ?? 'incomplete';

        const { error } = await supabase
          .from('subscriptions')
          .update({
            status,
            current_period_end: periodEnd,
            updated_at:         new Date().toISOString(),
          })
          .eq('stripe_subscription_id', subscription.id);

        if (error) console.error('Failed to update subscription:', subscription.id, error);
        else console.log('Subscription updated:', subscription.id, status);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;

        // Mark subscription canceled.
        const { error: subErr } = await supabase
          .from('subscriptions')
          .update({ status: 'canceled', updated_at: new Date().toISOString() })
          .eq('stripe_subscription_id', subscription.id);

        if (subErr) console.error('Failed to cancel subscription:', subscription.id, subErr);

        // Downgrade entitlements back to free.
        // Find the user via the subscription row.
        const { data: subRow, error: lookupErr } = await supabase
          .from('subscriptions')
          .select('user_id')
          .eq('stripe_subscription_id', subscription.id)
          .single();

        if (lookupErr || !subRow) {
          console.error('Could not find user for canceled subscription:', subscription.id);
          break;
        }

        const { error: entErr } = await supabase
          .from('entitlements')
          .update({ tier: 'free', features: {}, updated_at: new Date().toISOString() })
          .eq('user_id', subRow.user_id);

        if (entErr) console.error('Failed to downgrade entitlements:', subRow.user_id, entErr);
        else console.log('User downgraded to free:', subRow.user_id);
        break;
      }

      default:
        console.log('Unhandled event type:', event.type);
    }
  } catch (err) {
    console.error('Error processing event', event.type, ':', err);
    // Still return 200 so Stripe doesn't retry endlessly.
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
