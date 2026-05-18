-- ─────────────────────────────────────────────────────────────────────────────
-- Supabase advisor remediation: pin search_path on functions flagged by
-- 0011_function_search_path_mutable.
-- Triage: seo/security_advisor_triage_2026-05-18.md (Finding 4)
-- ─────────────────────────────────────────────────────────────────────────────
-- Same fix already applied to wc_doctors_touch_updated_at in commit 1894d7.
-- Pinning search_path = public, pg_temp prevents a malicious schema in the
-- session search_path from shadowing built-ins like now(), gen_random_uuid().
--
-- Uses ALTER FUNCTION rather than CREATE OR REPLACE so we don't need to know
-- the exact body of the 3 out-of-band functions. Signature must match what's
-- in prod. If any ALTER errors with "function does not exist", query pg_proc:
--   SELECT proname, pg_get_function_identity_arguments(oid)
--   FROM pg_proc
--   WHERE proname IN (...) AND pronamespace = 'public'::regnamespace;
-- and adjust the signature below.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER FUNCTION public.set_updated_at()                    SET search_path = public, pg_temp;
ALTER FUNCTION public.update_updated_at_column()          SET search_path = public, pg_temp;
ALTER FUNCTION public.tg_oc400_profiles_set_updated_at()  SET search_path = public, pg_temp;
ALTER FUNCTION public.handle_new_user()                   SET search_path = public, pg_temp;
