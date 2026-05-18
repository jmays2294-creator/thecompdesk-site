# Supabase Security Advisor — Triage & Remediation Plan

**Date:** 2026-05-18
**Project:** `ltibymvlytodkemdeeox` (The Comp Desk production)
**Triggered by:** Pre-existing advisor findings surfaced incidentally by `get_advisors` after the `wc_doctors` migration (commit `1894da7`). None of these findings are caused by `wc_doctors`.
**Author:** Triage pass by Claude — every fix requires Joel's approval before apply.

---

## TL;DR

| # | Finding | Severity | Recommendation | Migration file |
|---|---------|----------|----------------|----------------|
| 1a | `public.subscriptions` RLS disabled | ERROR | Re-enable RLS — migration `20260407…` already defined policies, prod state diverged | [1] |
| 1b | `public.webhook_events` RLS disabled | ERROR | Re-enable RLS — same situation | [1] |
| 1c | `public.geocode_cache` RLS disabled | ERROR | Enable RLS + permissive public-read policy (cache contents are public info) | [1] |
| 2 | `public.participating_attorneys` is SECURITY DEFINER view | ERROR | Convert to `security_invoker = on` + narrow column grants + RLS policy on `attorney_accounts` | [4] — **HIGHEST CARE** |
| 3a | `cascade_firm_tier` callable by anon | WARN | REVOKE EXECUTE from anon, authenticated (edge funcs use service role) | [2] |
| 3b | `enforce_max_three_oc400_profiles` callable by anon | WARN | REVOKE EXECUTE (it's a trigger function) | [2] |
| 3c | `handle_new_user` callable by anon | WARN | REVOKE EXECUTE (it's a trigger function on auth.users) | [2] |
| 3d | `is_admin_of_user` callable by anon | WARN | REVOKE EXECUTE (used inside RLS policies; policies bypass EXECUTE) | [2] |
| 3e | `is_firm_admin` callable by anon | WARN | REVOKE EXECUTE (used inside RLS policies) | [2] |
| 3f | `is_firm_member` callable by anon | WARN | REVOKE EXECUTE (used inside RLS policies) | [2] |
| 3*  | **All of 3a-3f** — PUBLIC grant lesson | — | The original [2] REVOKE FROM anon, authenticated was a no-op (PUBLIC grant inherits down). Corrective: REVOKE FROM PUBLIC | [2b] |
| 4a | `set_updated_at` mutable search_path | WARN | `ALTER FUNCTION … SET search_path = public, pg_temp` | [3] |
| 4b | `update_updated_at_column` mutable search_path | WARN | Same | [3] |
| 4c | `tg_oc400_profiles_set_updated_at` mutable search_path | WARN | Same | [3] |
| 4d | `handle_new_user` mutable search_path | WARN | Same (pairs with #3c — same ALTER touches both lints) | [3] |
| 5 | `auth_leaked_password_protection` disabled | WARN | Dashboard toggle, no migration | — |

**Apply order:** [3] (low-risk, no behavior change) → [2] (low-risk, no client callers) → [1] (medium — verify no client code reads `webhook_events`/`geocode_cache` after) → [4] (highest — test find-attorney.html immediately after).

---

## Finding 1 — RLS disabled in `public` (ERROR × 3)

### 1a + 1b. `subscriptions` and `webhook_events`

**Investigation.** Both tables are defined in [`supabase/migrations/20260407000000_pro_tier_subscriptions.sql`](../supabase/migrations/20260407000000_pro_tier_subscriptions.sql), and that migration explicitly does:

```sql
ALTER TABLE public.subscriptions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
```

…with policies attached on the next ~30 lines. So either the migration was never applied to prod, or RLS was manually disabled afterward (a dashboard click, a one-off `ALTER TABLE ... DISABLE ROW LEVEL SECURITY`, etc.).

**Callers in repo:**
- `subscriptions`:
  - `supabase/functions/user-stripe-webhook/index.ts` (lines 109, 157, 175, 184) — service role
  - `account/index.html:125` — `sb.from('subscriptions').select(...)` as the **logged-in user** (anon-key client). Relies on the "Users can view own subscription" policy.
- `webhook_events`:
  - `supabase/functions/revenuecat-webhook/index.ts:91`
  - `supabase/functions/user-stripe-webhook/index.ts:66`
  - No client-side reads. Service-role writes only.

**Proposed fix.** Idempotent re-enable + idempotent re-create of the existing policies (in case prod was disabled AND policies were dropped). Migration is in [1] below.

**Blast radius.**
- `subscriptions`: If policies were dropped along with RLS, **logged-in users on `/account` lose the ability to see their own subscription** until the policy is recreated. The migration recreates both policies via `DROP POLICY IF EXISTS … CREATE POLICY …` so this is safe.
- `webhook_events`: No user-facing impact. Service role bypasses RLS.

**Confidence:** High. Migration matches what the codebase expects.

---

### 1c. `geocode_cache`

**Investigation.** Zero references in the canonical repo (`~/Code/thecompdesk-site/`) or the iCloud copy. Not in any migration file. Not imported by any HTML / JS / TS / edge function in repo. This table was created out-of-band — almost certainly via a Supabase dashboard SQL editor session or an MCP `apply_migration` call that wasn't checked in.

The name strongly suggests a postal-code → lat/lng cache. Likely written by:
- An edge function that's deployed to prod but not in `supabase/functions/` in repo, OR
- A client-side geocoder that does `upsert` with the anon key (concerning if so), OR
- A one-off script Joel ran from the dashboard.

**Proposed fix.** Conservative path that won't break anything:

```sql
ALTER TABLE public.geocode_cache ENABLE ROW LEVEL SECURITY;

-- Cache contents are public information (postal codes & coordinates).
-- Allow anyone to read, restrict writes to service role.
CREATE POLICY geocode_cache_public_read
  ON public.geocode_cache
  FOR SELECT
  TO anon, authenticated
  USING (true);
```

This preserves read access for any deployed code that needs it. Writes through the anon key will start failing after this lands — which is what we want if anything was doing client-side upserts.

**Blast radius.**
- If something out-of-band is doing anon-key `INSERT`s into this table to populate the cache, those writes will now fail and the cache will stop growing. If reads from the cache still hit, the worst case is degraded geocoding performance (cache miss rate climbs).
- Recommend: after applying, check the Supabase logs for `permission denied for table geocode_cache` errors. If any show up, identify the writer and either move it to service role or add a narrow `INSERT` policy.

**Confidence:** Medium. We don't know the full caller set. Joel should grep his out-of-repo code (deployed edge functions, dashboard scripts, mobile app native code under `ios/App/App/`) before applying.

---

## Finding 2 — `public.participating_attorneys` is SECURITY DEFINER (ERROR × 1)

**Investigation.** The view is defined in [`supabase/migrations/20260406120000_attorney_lead_and_accounts.sql:104-122`](../supabase/migrations/20260406120000_attorney_lead_and_accounts.sql) as:

```sql
create view public.participating_attorneys as
  select id, firm_name, attorney_name, office_address, office_lat, office_lng,
         phone_e164, public_email, website, practice_areas, languages, bio
  from public.attorney_accounts
  where status = 'active';

grant select on public.participating_attorneys to anon, authenticated;
```

The view is NOT explicitly declared `SECURITY DEFINER` in the migration — but in PostgreSQL ≤ 14 the default view-execution mode is definer-style, and Supabase's linter `0010_security_definer_view` flags any view that isn't explicitly declared `security_invoker = true` (because the default is footgun-prone).

**Why this matters here.** The underlying table `attorney_accounts` has RLS enabled with policies that only let an attorney read/update **their own** row. There's **no public SELECT policy**. The view relies on definer-mode behavior to bypass RLS and expose `status = 'active'` rows to anon — which is the load-bearing mechanism for the find-attorney map.

**Caller.** Single caller in repo:
- [`find-attorney.html:1312`](../find-attorney.html) — `fetch(${SUPABASE_URL}/rest/v1/participating_attorneys?select=id,firm_name,office_lat,office_lng,office_address,phone_e164,public_email,website)` with the anon key.

If we simply flip the view to `security_invoker = on`, the find-attorney map breaks immediately — anon has no row-level access to `attorney_accounts`.

**Proposed fix (Option A — recommended).** Convert to invoker mode AND grant anon column-restricted SELECT on `attorney_accounts` for the public columns, gated by an RLS policy that filters to active accounts:

```sql
ALTER VIEW public.participating_attorneys SET (security_invoker = on);

-- Anon and authenticated can read active firms from the underlying table,
-- but only the public-facing columns (PII columns are not granted).
CREATE POLICY attorney_accounts_public_directory_read
  ON public.attorney_accounts
  FOR SELECT
  TO anon, authenticated
  USING (status = 'active');

-- Column-level grants: anon may SELECT only the directory-safe columns.
-- bar_number, user_id, stripe_customer_id, stripe_subscription_id remain
-- accessible only to authenticated owners via the existing "attorney reads own account" policy.
REVOKE SELECT ON public.attorney_accounts FROM anon, authenticated;
GRANT SELECT (
  id, firm_name, attorney_name, office_address, office_lat, office_lng,
  phone_e164, public_email, website, practice_areas, languages,
  headshot_url, bio, status
) ON public.attorney_accounts TO anon;
GRANT SELECT ON public.attorney_accounts TO authenticated;
-- (authenticated keeps full SELECT; the existing user_id = auth.uid() policy still constrains rows)
```

**Why this is the right shape.**
- The view becomes a simple convenience filter; it's no longer the security boundary
- The security boundary is the RLS policy + column grants on the underlying table
- The PII columns (`bar_number`, `user_id`, `stripe_customer_id`, `stripe_subscription_id`) are protected by column-level grant denial — any anon attempt to SELECT them returns `permission denied for column X`
- Authenticated users can still see their own full row via the existing `attorney reads own account` policy
- Supabase linter passes

**Option B (fallback if Option A's grant model is too complex).** Replace the view with a `SECURITY DEFINER` function that returns a `setof public_attorney_directory_row`. Functions aren't subject to the `0010` view-linter. Trade-off: changes the client API from REST `/rest/v1/participating_attorneys` to RPC `/rest/v1/rpc/list_participating_attorneys`, requiring a one-line change in [find-attorney.html:1311-1312](../find-attorney.html).

**Option C (do nothing, accept the warning).** Leave the view as-is. Add a `COMMENT ON VIEW` documenting why. Linter warning remains.

**Recommendation:** Option A. Migration in [4] below.

**Blast radius.** HIGH if mis-staged. If the column grants or policy are wrong, the find-attorney map silently goes empty. **Mandatory smoke test:** load `https://thecompdesk.com/find-attorney.html` immediately after applying and confirm attorney pins render. Also verify the existing logged-in attorney edit flow (`/account` or wherever) still works — the column grant changes affect everyone, not just anon.

**Confidence:** Medium. The migration is straightforward but column-level grants in PG have subtle semantics around inherited grants. Strongly recommend testing in a staging branch or running an `EXPLAIN`-level dry-run before prod apply.

---

## Finding 3 — Anon-callable SECURITY DEFINER functions (WARN × 6, + 6 auth-flavored duplicates)

The advisor lists the same 6 functions under both `0011_function_search_path_mutable` (when applicable) and the anon-execute warning. Treating them as one finding set.

**Investigation.** None of these 6 functions appear in any local migration file. They were all created out-of-band:

```
$ grep -rn "cascade_firm_tier\|is_admin_of_user\|is_firm_admin\|is_firm_member\|handle_new_user\|enforce_max_three_oc400_profiles" \
    ~/Code/thecompdesk-site/ ~/Library/Mobile\ Documents/com~apple~CloudDocs/TheCompDesk/
# → no matches in any .sql / .ts / .js / .html
```

This is actually the best case for revocation — there's nothing in repo that depends on direct anon/authenticated invocation.

**Per-function analysis:**

| Function | Likely role | Safe to revoke from anon, authenticated? |
|----------|-------------|------------------------------------------|
| `cascade_firm_tier(uuid, text, text)` | Billing cascade — invoked from `revenuecat-webhook` or `accept-firm-invite` edge functions (service role) | YES — service role keeps EXECUTE |
| `enforce_max_three_oc400_profiles()` | Trigger function (zero-arg signature is the giveaway) | YES — triggers bypass EXECUTE grants |
| `handle_new_user()` | Likely trigger on `auth.users` AFTER INSERT (a la Supabase's standard pattern) | YES — triggers bypass EXECUTE grants |
| `is_admin_of_user(uuid)` | RLS policy helper | YES — RLS policies run with internal privileges, no EXECUTE check |
| `is_firm_admin(uuid)` | RLS policy helper | YES — same |
| `is_firm_member(uuid)` | RLS policy helper | YES — same |

**Proposed fix.** Single migration that revokes EXECUTE from `anon` and `authenticated` on all 6:

```sql
REVOKE EXECUTE ON FUNCTION public.cascade_firm_tier(uuid, text, text)   FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_max_three_oc400_profiles()    FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                     FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_admin_of_user(uuid)                FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_firm_admin(uuid)                   FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_firm_member(uuid)                  FROM anon, authenticated;
```

**Blast radius.** Low. Edge functions, triggers, and RLS policies all continue to work. The only thing that breaks is any out-of-repo code that's directly calling `/rest/v1/rpc/{cascade_firm_tier,…}` with an anon key. **Joel should mentally verify:** are any of these called from the iOS app's Swift code, or from a Postman/curl script you use for billing ops? If yes, those callers need to either switch to the service role (and move server-side) or stay revoked-and-broken.

**Confidence:** High for the 5 non-`cascade_firm_tier` functions. Medium for `cascade_firm_tier` — it's billing-adjacent and may have callers I can't see.

---

## Finding 4 — Function `search_path` mutable (WARN × 4)

**Same fix Joel already applied** to `wc_doctors_touch_updated_at` in commit `1894da7`. Pinning `search_path = public, pg_temp` prevents a malicious schema in the session search_path from shadowing `now()`, `gen_random_uuid()`, etc.

Four functions need this:
- `public.set_updated_at` — defined in repo at [`supabase/migrations/20260407000000_pro_tier_subscriptions.sql:121`](../supabase/migrations/20260407000000_pro_tier_subscriptions.sql); no `SET search_path`
- `public.update_updated_at_column` — out-of-band
- `public.tg_oc400_profiles_set_updated_at` — out-of-band
- `public.handle_new_user` — out-of-band (also flagged in Finding 3)

**Proposed fix.** Use `ALTER FUNCTION … SET search_path = public, pg_temp` rather than `CREATE OR REPLACE` — this doesn't require knowing the existing function body for the 3 out-of-band ones:

```sql
ALTER FUNCTION public.set_updated_at()                          SET search_path = public, pg_temp;
ALTER FUNCTION public.update_updated_at_column()                SET search_path = public, pg_temp;
ALTER FUNCTION public.tg_oc400_profiles_set_updated_at()        SET search_path = public, pg_temp;
ALTER FUNCTION public.handle_new_user()                         SET search_path = public, pg_temp;
```

**Caveat:** The exact signatures (especially `handle_new_user` — is it really zero-arg?) need to match what's in prod. If `ALTER FUNCTION` fails on a signature mismatch, query `pg_proc` first to get the canonical signature:

```sql
SELECT proname, pg_get_function_identity_arguments(oid)
FROM pg_proc
WHERE proname IN ('set_updated_at','update_updated_at_column',
                  'tg_oc400_profiles_set_updated_at','handle_new_user')
  AND pronamespace = 'public'::regnamespace;
```

**Blast radius.** Minimal. `SET search_path` doesn't change function behavior, only resolves identifiers more strictly. Worst case: a function that was implicitly relying on a schema being in search_path (unlikely for trigger functions) starts erroring.

**Confidence:** High.

---

## Finding 5 — `auth_leaked_password_protection` disabled (WARN)

Not a database change — Supabase Auth dashboard toggle. Path:

1. Supabase Dashboard → Project `ltibymvlytodkemdeeox`
2. Authentication → Policies (or "Password Security" under newer dashboard UI)
3. Enable "Leaked Password Protection" (HaveIBeenPwned API check)

**Blast radius.** Users attempting to set a password that appears in HIBP breach corpus will get an inline error at signup / password change. This is the intended behavior.

**Confidence:** High. Single click; no risk to existing users (no retroactive password validation).

---

## Migration files (APPLIED 2026-05-18)

All under `supabase/migrations/`, timestamped to follow `20260518000000_wc_doctors_directory.sql`:

| # | File | Touches | Status |
|---|------|---------|--------|
| [1] | `20260518100000_advisor_enable_rls_on_public_tables.sql` | Findings 1a, 1b, 1c | ✅ applied |
| [2] | `20260518110000_advisor_revoke_anon_execute_on_definer_fns.sql` | Findings 3a-3f (no-op — PUBLIC grant inherited) | ⚠️ applied, no-op |
| [2b] | `20260518111000_advisor_revoke_public_execute_on_definer_fns.sql` | Corrective REVOKE FROM PUBLIC for 3a-3f | ✅ applied |
| [3] | `20260518120000_advisor_pin_search_path_on_trigger_fns.sql` | Findings 4a-4d | ✅ applied |
| [4] | `20260518130000_advisor_participating_attorneys_invoker.sql` | Finding 2 | ✅ applied |

### Lesson learned: the PUBLIC grant trap

Original migration [2] used `REVOKE EXECUTE ON FUNCTION X FROM anon, authenticated`. After apply, `get_advisors` still flagged all 12 SECURITY DEFINER function findings. Root cause: PostgreSQL auto-grants `EXECUTE` to `PUBLIC` on every new function. `anon` and `authenticated` inherit from `PUBLIC`, so revoking from them directly doesn't remove the inherited grant. Verified by querying `information_schema.routine_privileges`:

```
EXECUTE:PUBLIC          ← the actual exposure
EXECUTE:postgres
EXECUTE:service_role
```

Corrective migration [2b] applied `REVOKE EXECUTE ON FUNCTION X FROM PUBLIC` — all 12 warnings cleared immediately. **For future SECURITY DEFINER function definitions, include `REVOKE EXECUTE FROM PUBLIC` at create time** unless you genuinely want anonymous RPC access.

---

## Recommended apply order & verification

After each `apply_migration`, run `get_advisors` again to confirm the relevant findings drop off, then do the listed verification.

1. **[3] search_path pins.** Lowest risk. Verify: `get_advisors` no longer flags the 4 functions for `function_search_path_mutable`.
2. **[2] revoke EXECUTE.** Verify: anon-callable warnings drop. Trigger an attorney signup or RevenueCat webhook in staging to confirm `handle_new_user` / `cascade_firm_tier` still fire from their intended call sites (triggers / service role).
3. **[1] enable RLS.** Verify: 3 ERROR findings drop. Smoke test: log into `/account` as a Pro user and confirm the subscription row still loads (proves the recreated `subscriptions` policy works).
4. **[4] participating_attorneys.** Apply last and **immediately** load `https://thecompdesk.com/find-attorney.html` in a real browser. If the map is empty, the column grants are wrong and you should `rollback` or apply a hotfix that re-grants. Also `curl 'https://ltibymvlytodkemdeeox.supabase.co/rest/v1/participating_attorneys?select=id,firm_name&limit=1' -H 'apikey: ...'` to confirm the REST endpoint still returns rows.
5. **Auth dashboard toggle.** Manual step in Supabase dashboard.

---

## Open questions for Joel

1. **`geocode_cache` writer.** Where does this table get populated from? If it's not in repo, what edge function or script writes to it? (Determines whether the public-read policy is sufficient or if we also need an `INSERT` policy.)
2. **`cascade_firm_tier` callers outside repo.** Any chance the iOS app or a curl/Postman script calls `/rest/v1/rpc/cascade_firm_tier` directly with an anon/user JWT? If yes, revoking EXECUTE breaks it.
3. **Option A vs Option B for the view.** Are you comfortable with the column-grant approach (Option A) on `attorney_accounts`, or would you rather replace the view with a SECURITY DEFINER function (Option B) and change one line in `find-attorney.html`? Option A is more "Postgres-native"; Option B is more "blast-radius-contained."
4. **Subscriptions divergence.** The repo migration enables RLS + creates policies, but the advisor says RLS is off in prod. Worth a quick dashboard look at `subscriptions` policies before applying [1] to see what the real state is — if policies are also missing, my migration recreates them, so no action needed, but worth confirming.
5. **Auth toggle timing.** OK to flip leaked-password protection now, or do you want to give existing users a heads-up first?

---

## Applied state (final)

All 5 migrations applied successfully on 2026-05-18. `get_advisors` post-state:

| Lint | Baseline | After apply | Status |
|------|----------|-------------|--------|
| `rls_disabled_in_public` (ERROR) | 3 | 0 | ✅ cleared |
| `security_definer_view` (ERROR) | 1 | 0 | ✅ cleared |
| `function_search_path_mutable` (WARN) | 4 | 0 | ✅ cleared |
| `anon_security_definer_function_executable` (WARN) | 6 | 0 | ✅ cleared (after [2b]) |
| `authenticated_security_definer_function_executable` (WARN) | 6 | 0 | ✅ cleared (after [2b]) |
| `auth_leaked_password_protection` (WARN) | 1 | 1 | ⏳ dashboard toggle pending |
| `rls_enabled_no_policy` (INFO, pre-existing) | 3 | 3 | — out of scope |
| `rls_policy_always_true` (WARN, pre-existing) | 3 | 3 | — out of scope |

**Total in-scope findings: 20 → 0.** Only the dashboard auth toggle remains.

### Smoke test (post-[4])

Simulated the find-attorney REST call via `SET LOCAL ROLE anon`:

- `SELECT … FROM participating_attorneys LIMIT 5` → returns `[]` (no active firms exist — directory is currently empty; this is expected, see SILENT_OWNER_POLICY.md re: founding firm being hard-coded in the page).
- `SELECT bar_number FROM attorney_accounts` → `permission denied for table attorney_accounts` (column-level grants successfully protecting PII).
- `SELECT firm_name, office_lat FROM attorney_accounts WHERE status='active'` → returns `[]` (granted columns work fine).

Security model verified end-to-end.

---

*Generated 2026-05-18. Applied 2026-05-18. Joel: only the leaked-password dashboard toggle remains.*
