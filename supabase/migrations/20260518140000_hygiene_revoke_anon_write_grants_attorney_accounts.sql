-- ─────────────────────────────────────────────────────────────────────────────
-- Hygiene cleanup: revoke unused write privileges from anon on attorney_accounts.
-- These grants existed from Supabase's default schema policy but were functionally
-- inert because RLS had no permissive INSERT/UPDATE/DELETE policy for anon. Removing
-- them eliminates ambient-authority noise without changing behavior.
--
-- anon retains column-level SELECT (granted in advisor_participating_attorneys_invoker).
-- service_role and postgres retain full privileges.
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON public.attorney_accounts FROM anon;
