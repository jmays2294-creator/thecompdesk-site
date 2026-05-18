-- ─────────────────────────────────────────────────────────────────────────────
-- Supabase advisor remediation: REVOKE EXECUTE from anon/authenticated on
-- SECURITY DEFINER functions that should never be RPC-callable.
-- Findings: 0017_security_definer_function (× 6)
-- Triage: seo/security_advisor_triage_2026-05-18.md (Finding 3)
-- ─────────────────────────────────────────────────────────────────────────────
-- Investigation: none of these 6 functions are called from any code in the repo
-- or the iCloud working copy. They are all either trigger functions, RLS policy
-- helpers, or service-role-only billing infrastructure. Revocation does NOT break
-- triggers (they bypass EXECUTE grants), RLS policy evaluation (internal privilege),
-- or service-role callers.
-- ─────────────────────────────────────────────────────────────────────────────

-- Billing cascade — invoked from edge functions (service role)
REVOKE EXECUTE ON FUNCTION public.cascade_firm_tier(uuid, text, text)
  FROM anon, authenticated;

-- Trigger function (zero-arg signature)
REVOKE EXECUTE ON FUNCTION public.enforce_max_three_oc400_profiles()
  FROM anon, authenticated;

-- Trigger on auth.users (Supabase standard pattern)
REVOKE EXECUTE ON FUNCTION public.handle_new_user()
  FROM anon, authenticated;

-- RLS policy helpers — policies run with internal privileges, so revoking
-- anon/authenticated EXECUTE does NOT break policy evaluation.
REVOKE EXECUTE ON FUNCTION public.is_admin_of_user(uuid)
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.is_firm_admin(uuid)
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.is_firm_member(uuid)
  FROM anon, authenticated;
