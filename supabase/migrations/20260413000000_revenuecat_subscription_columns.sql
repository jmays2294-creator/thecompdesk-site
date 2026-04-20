-- RevenueCat + multi-tier subscription support
-- Migration: 20260413000000_revenuecat_subscription_columns
-- Applied to project: ltibymvlytodkemdeeox

-- ============================================================
-- 1. Add RevenueCat columns to profiles table
-- ============================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS revenuecat_app_user_id TEXT,
  ADD COLUMN IF NOT EXISTS subscription_source TEXT DEFAULT 'stripe'
    CHECK (subscription_source IN ('stripe', 'apple', 'google'));

CREATE INDEX IF NOT EXISTS profiles_revenuecat_id_idx
  ON public.profiles (revenuecat_app_user_id)
  WHERE revenuecat_app_user_id IS NOT NULL;

-- ============================================================
-- 2. Expand entitlements.tier to support all 4 tiers
-- ============================================================
ALTER TABLE public.entitlements
  DROP CONSTRAINT IF EXISTS entitlements_tier_check;

ALTER TABLE public.entitlements
  ADD CONSTRAINT entitlements_tier_check
    CHECK (tier IN ('free', 'comp_buddy', 'pro', 'firm'));

-- ============================================================
-- 3. Expand subscriptions.status to include RevenueCat states
-- ============================================================
ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_status_check;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_status_check
    CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'incomplete', 'expired', 'billing_issue'));

-- Add subscription_source to subscriptions table too
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS subscription_source TEXT DEFAULT 'stripe'
    CHECK (subscription_source IN ('stripe', 'apple', 'google')),
  ADD COLUMN IF NOT EXISTS revenuecat_subscription_id TEXT;

-- ============================================================
-- 4. Webhook events: add source column for RevenueCat vs Stripe
-- ============================================================
ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'stripe'
    CHECK (source IN ('stripe', 'revenuecat'));
