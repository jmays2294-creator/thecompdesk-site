-- Pro Tier: subscriptions, entitlements, webhook_events
-- Migration: 20260407000000_pro_tier_subscriptions
-- Applied to project: ltibymvlytodkemdeeox

-- ============================================================
-- TABLE: subscriptions
-- Mirrors Stripe subscription state for each user.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id    text,
  stripe_subscription_id text       UNIQUE,
  status                text        NOT NULL
    CHECK (status IN ('trialing','active','past_due','canceled','incomplete')),
  price_id              text,
  current_period_end    timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscriptions_user_id_idx
  ON public.subscriptions (user_id);

-- ============================================================
-- TABLE: entitlements
-- Single row per user; tier drives feature access.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.entitlements (
  user_id    uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tier       text        NOT NULL DEFAULT 'free'
    CHECK (tier IN ('free','pro')),
  features   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- TABLE: webhook_events
-- Append-only debug log for every incoming Stripe event.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text      UNIQUE,
  event_type    text        NOT NULL,
  payload       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  processed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_events_event_type_idx
  ON public.webhook_events (event_type);

-- ============================================================
-- ROW-LEVEL SECURITY
-- ============================================================

ALTER TABLE public.subscriptions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entitlements   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

-- subscriptions: users can read their own row; service role does everything else
CREATE POLICY "Users can view own subscription"
  ON public.subscriptions
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role manages subscriptions"
  ON public.subscriptions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- entitlements: users can read their own row; service role does everything else
CREATE POLICY "Users can view own entitlements"
  ON public.entitlements
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role manages entitlements"
  ON public.entitlements
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- webhook_events: service role only (no user-facing reads)
CREATE POLICY "Service role manages webhook events"
  ON public.webhook_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- TRIGGER: auto-provision free entitlement on new user signup
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user_entitlement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.entitlements (user_id, tier, features, updated_at)
  VALUES (NEW.id, 'free', '{}'::jsonb, now())
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Drop if exists to allow re-run idempotency
DROP TRIGGER IF EXISTS on_auth_user_created_entitlement ON auth.users;

CREATE TRIGGER on_auth_user_created_entitlement
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_entitlement();

-- ============================================================
-- FUNCTION: updated_at auto-stamp
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER entitlements_updated_at
  BEFORE UPDATE ON public.entitlements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
