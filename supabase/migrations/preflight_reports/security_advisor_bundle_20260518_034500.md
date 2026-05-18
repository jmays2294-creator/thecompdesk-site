# Preflight — security_advisor_bundle (4 migrations) — PASS

**Date:** 2026-05-18 03:45:00
**Project:** ltibymvlytodkemdeeox
**Verdict:** SAFE TO APPLY (per static lints) — but each migration carries non-lint blast-radius risks documented in `seo/security_advisor_triage_2026-05-18.md`. Read the triage before applying.

## Files preflighted

1. `supabase/migrations/20260518100000_advisor_enable_rls_on_public_tables.sql`
2. `supabase/migrations/20260518110000_advisor_revoke_anon_execute_on_definer_fns.sql`
3. `supabase/migrations/20260518120000_advisor_pin_search_path_on_trigger_fns.sql`
4. `supabase/migrations/20260518130000_advisor_participating_attorneys_invoker.sql`

## Check 1 — Postgres-syntax compliance (MySQL COMMENT trap): PASS

All four files use Postgres-native syntax. No inline `COMMENT '...'` clauses after `ADD COLUMN`. (No `ADD COLUMN` statements at all in this bundle — it's RLS / grants / search_path territory.)

## Check 2 — File-number collision: PASS (by construction)

The skill's `list_migrations` collision check needs the Supabase MCP, which is not loaded in this session. Skipped that specific live check.

Collision risk is structurally low here because the canonical repo uses the timestamp convention `YYYYMMDDhhmmss_*.sql`, not the 3-digit prefix the skill was originally designed for. The four new timestamps (`20260518100000` through `20260518130000`) are all strictly greater than the last applied migration in repo (`20260518000000_wc_doctors_directory.sql`), so they sort cleanly and cannot collide with each other or with any prior file.

**Recommended:** when applying via `apply_migration`, use the file basename (without `.sql`) as the `name` arg, e.g., `advisor_enable_rls_on_public_tables`. Avoid generic names like `advisor_fixes` that could later collide.

## Check 3 — RLS hygiene (raw auth.uid() + cross-table recursion risk): PASS

Initial lint flagged migration [1] for raw `auth.uid()` on line 25 (copied verbatim from the original `20260407000000_pro_tier_subscriptions.sql`). **Fixed** in this preflight pass — the new policy now uses `(SELECT auth.uid()) = user_id`, which the planner can cache instead of re-evaluating per row. This is an improvement over the original, not a regression.

Cross-table recursion check: PASS for all four files. None of the new policies reference another RLS-protected table in a USING/WITH CHECK clause. The new `attorney_accounts_public_directory_read` policy in [4] uses only `status = 'active'` — no cross-table references.

## What this preflight did NOT cover

- **Production state divergence.** Both `subscriptions` and `webhook_events` had RLS + policies defined in `20260407000000_pro_tier_subscriptions.sql`, but the advisor says RLS is disabled in prod. Joel should glance at the actual policy state on those tables in the Supabase dashboard before applying [1] — if policies are also missing, [1] recreates them; if they still exist, the `DROP POLICY IF EXISTS` + `CREATE POLICY` pattern is idempotent.
- **`geocode_cache` schema.** This table is not in any repo migration. The proposed migration `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` assumes the table exists in `public`. If it doesn't (or is under a different schema), the migration errors. Joel should `\d public.geocode_cache` or equivalent before applying.
- **Function signatures in [2] and [3].** All `REVOKE EXECUTE ON FUNCTION` and `ALTER FUNCTION` statements use the signatures I inferred from the advisor names (e.g., `cascade_firm_tier(uuid, text, text)`). If any signature differs in prod, the statement errors. Suggested verification before apply:
  ```sql
  SELECT proname, pg_get_function_identity_arguments(oid)
  FROM pg_proc
  WHERE proname IN (
    'cascade_firm_tier','enforce_max_three_oc400_profiles','handle_new_user',
    'is_admin_of_user','is_firm_admin','is_firm_member',
    'set_updated_at','update_updated_at_column','tg_oc400_profiles_set_updated_at'
  ) AND pronamespace = 'public'::regnamespace;
  ```
- **Column grants in [4].** The column-grant list (`id, firm_name, attorney_name, …`) was derived from the view definition in `20260406120000_attorney_lead_and_accounts.sql`. If the underlying `attorney_accounts` table has columns I don't know about (added out-of-band), they remain ungranted to anon — which is the safe default, but may surprise.
- **Browser smoke test for [4].** Mandatory after applying [4] — load `https://thecompdesk.com/find-attorney.html` and confirm attorney pins render. The preflight cannot verify this.
- **Mobile app native code.** Joel should mentally check whether `ios/App/App/` or any out-of-repo Swift makes direct `/rest/v1/rpc/cascade_firm_tier` or `/rest/v1/participating_attorneys` calls.

## Apply order

Per the triage doc (`seo/security_advisor_triage_2026-05-18.md`):

1. [3] search_path pins — lowest risk
2. [2] revoke EXECUTE — low risk
3. [1] enable RLS — medium (smoke-test `/account`)
4. [4] participating_attorneys invoker — highest (smoke-test `/find-attorney.html` immediately)
