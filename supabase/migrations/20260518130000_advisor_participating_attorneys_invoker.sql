-- ─────────────────────────────────────────────────────────────────────────────
-- Supabase advisor remediation: convert participating_attorneys view to
-- security_invoker = on, with narrow column grants + RLS policy on the
-- underlying attorney_accounts table to preserve find-attorney.html behavior.
-- Finding: 0010_security_definer_view
-- Triage: seo/security_advisor_triage_2026-05-18.md (Finding 2 — HIGHEST CARE)
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️  HIGHEST-CARE MIGRATION ⚠️
--
-- This migration changes the security model for the public-facing attorney
-- directory. After applying, IMMEDIATELY smoke-test find-attorney.html in a
-- real browser to confirm attorney pins still render. If the map is empty,
-- the column grants are wrong — investigate before any further migration.
--
-- Strategy:
--   1. View becomes a simple convenience filter (security_invoker = on).
--   2. RLS policy on attorney_accounts allows anon to read active rows.
--   3. Column-level grants restrict anon to the directory-safe columns.
--      PII columns (user_id, bar_number, stripe_*) are NOT granted to anon
--      → anon SELECT of those columns returns "permission denied for column".
--   4. authenticated keeps full row-level SELECT; the existing
--      "attorney reads own account" policy still constrains rows.
-- ─────────────────────────────────────────────────────────────────────────────

-- Step 1: flip the view to invoker mode
ALTER VIEW public.participating_attorneys SET (security_invoker = on);

-- Step 2: add a public-directory SELECT policy on attorney_accounts
-- (only active rows; column-level grants below restrict which columns anon sees)
DROP POLICY IF EXISTS attorney_accounts_public_directory_read ON public.attorney_accounts;
CREATE POLICY attorney_accounts_public_directory_read
  ON public.attorney_accounts
  FOR SELECT
  TO anon, authenticated
  USING (status = 'active');

-- Step 3: tighten column grants for anon
-- Drop blanket SELECT first (if any was granted), then grant only safe columns.
REVOKE SELECT ON public.attorney_accounts FROM anon;
GRANT SELECT (
  id,
  firm_name,
  attorney_name,
  office_address,
  office_lat,
  office_lng,
  phone_e164,
  public_email,
  website,
  practice_areas,
  languages,
  headshot_url,
  bio,
  status
) ON public.attorney_accounts TO anon;

-- authenticated keeps full SELECT on the table — the existing
-- "attorney reads own account" policy still restricts to user_id = auth.uid().
-- The new public-directory policy adds permissive read for active rows on top.
GRANT SELECT ON public.attorney_accounts TO authenticated;

-- The view's existing grant to anon, authenticated is preserved by the ALTER above.
-- For clarity, reassert it:
GRANT SELECT ON public.participating_attorneys TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- POST-APPLY VERIFICATION (run manually after apply, not part of migration):
--
--   curl 'https://ltibymvlytodkemdeeox.supabase.co/rest/v1/participating_attorneys?select=id,firm_name&limit=3' \
--        -H "apikey: ${SUPABASE_ANON_KEY}"
--   # expect: array of {id, firm_name} for active firms
--
--   curl 'https://ltibymvlytodkemdeeox.supabase.co/rest/v1/attorney_accounts?select=bar_number&limit=1' \
--        -H "apikey: ${SUPABASE_ANON_KEY}"
--   # expect: 401/403 "permission denied for column bar_number"
--
--   Browser: open https://thecompdesk.com/find-attorney.html — confirm pins render.
-- ─────────────────────────────────────────────────────────────────────────────
