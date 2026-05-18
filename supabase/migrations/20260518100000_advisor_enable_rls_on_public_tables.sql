-- ─────────────────────────────────────────────────────────────────────────────
-- Supabase advisor remediation: ENABLE RLS on three public tables
-- Findings: 0006_rls_disabled_in_public for subscriptions, webhook_events, geocode_cache
-- Triage: seo/security_advisor_triage_2026-05-18.md (Finding 1)
-- ─────────────────────────────────────────────────────────────────────────────
-- subscriptions + webhook_events were originally enabled in 20260407000000_pro_tier_subscriptions.
-- Production state has diverged (RLS got disabled out-of-band). This migration is
-- idempotent: ENABLE is a no-op if already enabled, and policy recreation uses
-- DROP IF EXISTS so re-running this is safe.
--
-- geocode_cache was created out-of-band (no prior repo migration). Cache contents
-- (postal code → lat/lng) are not sensitive, so a permissive public-read policy
-- is appropriate. Writes remain service-role only.
-- ─────────────────────────────────────────────────────────────────────────────

-- ============================================================
-- subscriptions
-- ============================================================
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- auth.uid() wrapped in (SELECT ...) per Apr 27 lesson — lets the planner cache
-- the result instead of re-evaluating per row. Improves on the un-wrapped version
-- in 20260407000000_pro_tier_subscriptions.sql.
DROP POLICY IF EXISTS "Users can view own subscription" ON public.subscriptions;
CREATE POLICY "Users can view own subscription"
  ON public.subscriptions
  FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Service role manages subscriptions" ON public.subscriptions;
CREATE POLICY "Service role manages subscriptions"
  ON public.subscriptions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- webhook_events
-- ============================================================
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages webhook events" ON public.webhook_events;
CREATE POLICY "Service role manages webhook events"
  ON public.webhook_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- geocode_cache (out-of-band, no prior migration in repo)
-- ============================================================
ALTER TABLE public.geocode_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS geocode_cache_public_read ON public.geocode_cache;
CREATE POLICY geocode_cache_public_read
  ON public.geocode_cache
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Writes (INSERT/UPDATE/DELETE) intentionally have no policy → service role only.
-- If something out-of-band was doing anon-key upserts to populate the cache, those
-- writes will start failing after this lands. Investigate via Supabase logs:
-- "permission denied for table geocode_cache".
