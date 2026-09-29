-- Migration: 0151_revoke_public_execute.sql
-- Created: 2026-09-30
-- Description: `REVOKE ... FROM anon` does not remove EXECUTE. PostgreSQL grants it to PUBLIC on
--              every CREATE FUNCTION, and `anon` inherits it from there.
-- Related documents: Official Documentation/01 Foundation Layer/SECURITY_POLICIES.md
--                    Official Documentation/02 Authentication and Identity/PERMISSIONS.md
--
-- ===========================================================================
-- A REVOKE THAT REVOKED NOTHING
--
-- `0150` ends with, in as many words:
--
--     REVOKE ALL ON FUNCTION public.register_school(...) FROM anon;
--
-- and a comment calling it "the security boundary rather than an oversight". It is neither. It
-- removes a grant `anon` never had, and leaves in place the one it does: **PostgreSQL grants EXECUTE
-- on a new function to PUBLIC automatically**, and `anon` is a member of PUBLIC like every other
-- role. Revoking from a role does not touch a privilege it holds through PUBLIC.
--
-- So an unauthenticated PostgREST call could invoke `register_school()`. It would not achieve
-- anything — `get_user_id()` returns NULL for `anon` and the function's first statement raises
-- 42501 — but that is the in-function guard doing all of the work, with nothing behind it. The
-- assertion in `self_registration_test.sql` that `anon` lacks EXECUTE would also have failed, which
-- is how this was found before it shipped.
--
-- ---------------------------------------------------------------------------
-- THE SAME IS TRUE OF EVERY `admin_` FUNCTION IN THIS SCHEMA
-- ---------------------------------------------------------------------------
-- `admin_create_school`, `admin_activate_school`, `admin_update_school_commercial`,
-- `admin_update_tier`, `admin_revoke_override` and the rest are all callable by `anon` today, for
-- the same reason. Each is safe, because each begins with `is_afritech_admin()` — but "safe because
-- every one of eleven functions remembered its guard" is a worse position than "not reachable".
--
-- Defence in depth is the whole argument. This costs nothing and removes a class of mistake: the
-- twelfth `admin_` function, written by somebody who forgot the guard, is then unreachable rather
-- than wide open.
--
-- ---------------------------------------------------------------------------
-- WHAT IS DELIBERATELY LEFT ALONE
-- ---------------------------------------------------------------------------
-- This is surgical rather than a blanket revoke across `public`. Several functions are reached by
-- `anon` on purpose — `school_branding_by_slug()` themes the sign-in page before anybody has
-- signed in, and `0001` grants `is_afritech_admin()` and its siblings to `anon` explicitly so that
-- policies evaluate for an anonymous request rather than erroring.
--
-- A sweeping `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC` would catch those too,
-- and the failure would be a sign-in page with no school branding — which looks like a CDN problem,
-- not a permissions one. The named list below is longer to write and says what it means.
-- ===========================================================================

-- === MIGRATION START ===

DO $$
DECLARE
  r RECORD;
  n INT := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND (
         p.proname LIKE 'admin\_%'
         OR p.proname IN ('register_school', 'attach_own_registered_school')
       )
  LOOP
    /**
     * FROM PUBLIC, which is the whole point — revoking from `anon` leaves the inherited grant.
     * Then re-grant to `authenticated`, because revoking from PUBLIC removes it for them too and
     * every one of these functions is called by a signed-in user through PostgREST.
     */
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    n := n + 1;
  END LOOP;

  RAISE NOTICE 'PUBLIC execute revoked on % functions', n;

  -- A guard on the guard. If the pattern stops matching — a rename, a schema move — this migration
  -- would silently do nothing and the next reader would believe it had.
  IF n < 10 THEN
    RAISE EXCEPTION
      'Only % functions matched, which is fewer than this schema has. Check the pattern before '
      'trusting this migration.', n;
  END IF;
END;
$$;

-- === MIGRATION END ===
