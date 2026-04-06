/**
 * stripe-webhook
 *
 * Handles Stripe webhook events to keep attorney_accounts.status in sync
 * with the subscription state.
 *
 * Handled events:
 *   checkout.session.completed   → status = 'active', save stripe_subscription_id
 *   customer.subscription.deleted → status = 'inactive'
 *   invoice.payment_failed        → status = 'past_due'
 *   invoice.payment_succeeded     → status = 'active' (re-activates past_due)
 *
 * Environment variables required (set via `supabase secrets set`):
 *   STRIPE_SECRET_KEY         — Stripe live secret key (sk_live_...)
 *   STRIPE_WEBHOOK_SECRET     — Stripe webhook signing secret (whsec_...)
 *   SUPABASE_URL              — injected automatically by Supabase runtime
 *   SUPABASE_SERVICE_ROLE_KEY — injected automatically by Supabase runtime
 *
 * Register this webhook in the Stripe dashboard pointing to:
 *   https://<supabase-project>.supabase.co/functions/v1/stripe-webhook
 * with the four events above selected.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14?target=deno';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const stripeSecretKey   = Deno.env.get('STRIPE_SECRET_KEY');
  const webhookSecret     = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  const stripeSignature   = req.headers.get('stripe-signature');

  if (!stripeSecretKey || !webhookSecret) {
    console.error('Missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET');
    return new Response('Server misconfigured', { status: 500 });
  }
  if (!stripeSignature) {
    return new Response('Missing stripe-signature header', { status: 400 });
  }

  const stripe  = new Stripe(stripeSecretKey, { apiVersion: '2024-04-10' });
  const rawBody = await req.text();

  // Verify signature — rejects any tampered or replayed events.
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

  switch (event.type) {

    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== 'subscription') break;

      const accountId     = session.client_reference_id;
      const subscriptionId = typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id;

      if (!accountId || !subscriptionId) {
        console.error('checkout.session.completed: missing account/subscription ID', session.id);
        break;
      }

      const { error } = await supabase
        .from('attorney_accounts')
        .update({
          status:                  'active',
          stripe_subscription_id:  subscriptionId,
        })
        .eq('id', accountId);

      if (error) console.error('Failed to activate attorney account:', accountId, error);
      else console.log('Attorney account activated:', accountId);
      break;
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = typeof invoice.subscription === 'string'
        ? invoice.subscription
        : invoice.subscription?.id;

      if (!subscriptionId) break;

      // Re-activate accounts that were past_due and just paid.
      const { error } = await supabase
        .from('attorney_accounts')
        .update({ status: 'active' })
        .eq('stripe_subscription_id', subscriptionId)
        .eq('status', 'past_due');

      if (error) console.error('Failed to re-activate account for subscription:', subscriptionId, error);
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = typeof invoice.subscription === 'string'
        ? invoice.subscription
        : invoice.subscription?.id;

      if (!subscriptionId) break;

      const { error } = await supabase
        .from('attorney_accounts')
        .update({ status: 'past_due' })
        .eq('stripe_subscription_id', subscriptionId);

      if (error) console.error('Failed to set past_due for subscription:', subscriptionId, error);
      else console.log('Attorney account set to past_due for subscription:', subscriptionId);
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;

      const { error } = await supabase
        .from('attorney_accounts')
        .update({ status: 'inactive' })
        .eq('stripe_subscription_id', subscription.id);

      if (error) console.error('Failed to deactivate subscription:', subscription.id, error);
      else console.log('Attorney account deactivated for subscription:', subscription.id);
      break;
    }

    default:
      // Unhandled event — return 200 to acknowledge receipt.
      console.log('Unhandled event type:', event.type);
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
