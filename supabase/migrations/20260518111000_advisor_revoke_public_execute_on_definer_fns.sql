-- ─────────────────────────────────────────────────────────────────────────────
-- Corrective follow-up to 20260518110000_advisor_revoke_anon_execute_on_definer_fns.
-- The previous REVOKE … FROM anon, authenticated turned out to be a no-op
-- because PostgreSQL auto-grants EXECUTE to PUBLIC on every new function, and
-- anon/authenticated inherit from PUBLIC. The advisor lints stayed RED until
-- this corrective migration revoked the inherited grant at the PUBLIC level.
--
-- service_role and postgres retain their explicit EXECUTE grants and are
-- unaffected by this REVOKE.
--
-- Lesson for future migrations: when you create a SECURITY DEFINER function
-- whose anon/authenticated exposure matters, the right hygiene at create-time
-- is `REVOKE EXECUTE ON FUNCTION X FROM PUBLIC` immediately after the CREATE.
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.cascade_firm_tier(uuid, text, text)   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_max_three_oc400_profiles()    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_admin_of_user(uuid)                FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_firm_admin(uuid)                   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_firm_member(uuid)                  FROM PUBLIC;
