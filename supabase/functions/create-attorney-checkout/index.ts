/**
 * create-attorney-checkout
 *
 * Creates a Stripe Checkout Session for the $5.99/month attorney listing
 * subscription. Requires an authenticated Supabase user (attorney).
 *
 * Environment variables required (set via `supabase secrets set`):
 *   STRIPE_SECRET_KEY         — Stripe live secret key (sk_live_...)
 *   STRIPE_ATTORNEY_PRICE_ID  — Stripe price ID for "Comp Desk Attorney Listing"
 *                               ($5.99/month recurring). Create via Stripe dashboard:
 *                               Products → Add product → "Comp Desk Attorney Listing"
 *                               → $5.99 USD/month recurring → copy the price ID (price_...)
 *   SUPABASE_URL              — injected automatically by Supabase runtime
 *   SUPABASE_SERVICE_ROLE_KEY — injected automatically by Supabase runtime
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14?target=deno';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://www.thecompdesk.com',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const SUCCESS_URL = 'https://www.thecompdesk.com/find-attorney.html?signup=success';
const CANCEL_URL  = 'https://www.thecompdesk.com/find-attorney.html?signup=cancel';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // ── Authenticate the calling user ────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401);
  }
  const token = authHeader.slice(7);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Validate the JWT and get the user
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return json({ error: 'Unauthorized' }, 401);
  }

  // ── Look up the attorney account ─────────────────────────────
  const { data: account, error: accountError } = await supabase
    .from('attorney_accounts')
    .select('id, firm_name, public_email, stripe_customer_id, status')
    .eq('user_id', user.id)
    .single();

  if (accountError || !account) {
    return json({ error: 'Attorney account not found. Complete firm registration first.' }, 404);
  }

  if (account.status === 'active') {
    return json({ error: 'Subscription already active.' }, 409);
  }

  // ── Stripe setup ─────────────────────────────────────────────
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
  const priceId         = Deno.env.get('STRIPE_ATTORNEY_PRICE_ID');

  if (!stripeSecretKey || !priceId) {
    console.error('Missing STRIPE_SECRET_KEY or STRIPE_ATTORNEY_PRICE_ID');
    return json({ error: 'Payment system not configured.' }, 500);
  }

  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-04-10' });

  // ── Get or create Stripe customer ────────────────────────────
  let customerId = account.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email:    account.public_email,
      name:     account.firm_name,
      metadata: { supabase_user_id: user.id, attorney_account_id: account.id },
    });
    customerId = customer.id;

    await supabase
      .from('attorney_accounts')
      .update({ stripe_customer_id: customerId })
      .eq('id', account.id);
  }

  // ── Create Checkout Session ───────────────────────────────────
  const session = await stripe.checkout.sessions.create({
    customer:             customerId,
    payment_method_types: ['card'],
    mode:                 'subscription',
    line_items: [
      { price: priceId, quantity: 1 },
    ],
    subscription_data: {
      metadata: {
        supabase_user_id:       user.id,
        attorney_account_id:    account.id,
      },
    },
    success_url: SUCCESS_URL,
    cancel_url:  CANCEL_URL,
    client_reference_id: account.id,
  });

  return json({ url: session.url }, 200);
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
