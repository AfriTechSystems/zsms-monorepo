-- ===========================================================================
-- 0272 — 64 SECURITY DEFINER functions were executable by `anon`
--
-- ## What this found
--
-- `public` holds 299 functions, 216 of them `SECURITY DEFINER`. **67 could be executed
-- by the `anon` role** over PostgREST at `/rest/v1/rpc/<name>`. The anon key ships in
-- the browser bundle by design, so `anon` means anybody at all. Three of the 67 are
-- deliberately public and stay; the other 64 are closed here.
--
-- The sharpest two are `worker_parent_push_tokens()` and `worker_retire_push_token()`.
-- A `worker_*` function exists to bypass RLS for a Railway worker holding the service
-- role key, so it carries no tenant clause and no role check — there is nothing in it
-- to refuse a caller:
--
--     POST /rest/v1/rpc/worker_parent_push_tokens
--     { "p_parent_user_ids": ["user_...", "user_..."] }
--       -> every matching parent's device push token, platform included
--
-- Fourteen of the sixteen `worker_*` functions are correctly closed to both `anon` and
-- `authenticated` already. These two are the newest pair, added with the push-token
-- work, and they were granted `anon, authenticated` where the other fourteen were
-- granted `service_role` alone. So the discipline existed and these missed it.
--
-- ## Why 914 assertions did not catch it
--
-- `parent_push_tokens` has a 22-assertion pgTAP suite and it passes. It asserts the
-- table's RLS policies, and **a SECURITY DEFINER function never consults one.** The
-- suites test the policy layer; this is the grant layer, one step in front of it.
-- Postgres checks EXECUTE before RLS is ever reached, which is also why `0213`'s seven
-- tables with policies and no GRANT failed closed rather than open.
--
-- There was no symptom. That is the same shape as `0270` — a gap that produces no
-- error, no failed test and no log line — so the second half of this migration is a
-- catalogue check asserted by a suite in CI, not a list somebody must remember.
--
-- ## The three that stay anon-reachable, and why
--
-- `apps/web/lib/supabase.ts:59-60` already records the intent: the public school
-- directory is served by SECURITY DEFINER functions precisely BECAUSE `anon` can read
-- no table. It reaches 0 of 93 relations in `public` — verified, not assumed — so the
-- disclosure boundary for an unauthenticated visitor is each function's RETURNS TABLE
-- and nothing else.
--
--   * `search_schools(...)`            -> /api/public/schools
--   * `school_public_profile(...)`     -> /api/public/schools/[code], /schools/[code]
--   * `school_branding_by_slug(...)`   -> lib/theme.tsx, components/ui/auth-shell.tsx
--
-- ## Why the revoke needs three statements and not one
--
-- The privileges come from two different places, and removing one leaves the other:
--
--   * `my_children`, `verify_payment`, `audit_row_change` carry a leading `=X/postgres`
--     in `proacl` — the empty grantee is **PUBLIC**, Postgres's default on every new
--     function. `REVOKE ... FROM anon` does not touch it.
--   * `worker_parent_push_tokens` has no PUBLIC entry but an explicit `anon=X`.
--     `REVOKE ... FROM PUBLIC` does not touch that.
--
-- So both are revoked. And because `authenticated` may be drawing its EXECUTE from the
-- PUBLIC grant on some of these, it is **granted explicitly first** — otherwise
-- removing PUBLIC would silently take the capability away with the exposure, which is
-- the failure mode that succeeds quietly instead of erroring.
--
-- The target states are not invented; each already exists in this database:
--
--   | Group                  | Target `proacl`                             | As in            |
--   |------------------------|---------------------------------------------|------------------|
--   | session-scoped (51)    | postgres, authenticated, service_role       | admin_activate_school   |
--   | `worker_*` (2)         | postgres, service_role                      | worker_school_branding  |
--   | trigger functions (11) | postgres, authenticated, service_role       |                  |
--
-- ## Trigger functions keep their `authenticated` grant, deliberately
--
-- All 11 trigger-returning functions in the 67 lose PUBLIC and `anon`. They keep
-- `authenticated`, even though a trigger function is never a legitimate RPC, because
-- whether Postgres re-checks EXECUTE when a trigger FIRES (as opposed to when it is
-- created) was not verified here — and if it does, revoking would break every write in
-- the product. The exposure being closed is `anon`. Calling `set_updated_at()` as an
-- RPC with a session token discloses nothing and errors for want of trigger context.
-- Worth settling separately, on a database where a failed write costs nothing.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- The specification, as a function. The revoke loop below is driven by it, and
-- `anon_execute_boundary_test.sql` asserts it returns nothing — so a DEFINER function
-- added later and granted to `anon` fails CI rather than sitting there unnoticed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.anon_executable_definer_functions()
RETURNS TABLE (out_function_name TEXT, out_arguments TEXT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
  SELECT p.proname::TEXT,
         pg_get_function_identity_arguments(p.oid)::TEXT
  FROM pg_proc p
  JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public'
    AND p.prosecdef
    AND has_function_privilege('anon', p.oid, 'EXECUTE')
    AND p.proname NOT IN (
      -- The public school directory. `anon` can read no table, so these three ARE the
      -- disclosure boundary. See the header, and lib/supabase.ts.
      'search_schools',
      'school_public_profile',
      'school_branding_by_slug'
    )
  ORDER BY p.proname;
$fn$;

COMMENT ON FUNCTION public.anon_executable_definer_functions() IS
  'Offenders: SECURITY DEFINER functions in public that anon may EXECUTE, excluding the three that serve the public school directory. Asserted empty by supabase/tests/rls/anon_execute_boundary_test.sql. Added by 0272, which closed 64.';

REVOKE ALL ON FUNCTION public.anon_executable_definer_functions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.anon_executable_definer_functions() FROM anon;
GRANT EXECUTE ON FUNCTION public.anon_executable_definer_functions() TO authenticated;


-- ---------------------------------------------------------------------------
-- Close them. Catalogue-driven rather than a list of 64 names, so replaying this
-- against an empty database in CI does the right thing for whatever exists by 0272.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  r        RECORD;
  v_sig    TEXT;
  n_closed INT := 0;
  n_worker INT := 0;
BEGIN
  FOR r IN SELECT * FROM public.anon_executable_definer_functions()
  LOOP
    v_sig := format('public.%I(%s)', r.out_function_name, r.out_arguments);

    -- Make `authenticated` explicit BEFORE removing PUBLIC. On a function whose only
    -- source of EXECUTE for authenticated is the PUBLIC default, doing this the other
    -- way round removes the capability along with the exposure, and succeeds.
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_sig);

    -- Both sources: the PUBLIC default and any explicit anon grant.
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', v_sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', v_sig);

    n_closed := n_closed + 1;
  END LOOP;

  RAISE NOTICE '0272: closed % SECURITY DEFINER functions to anon', n_closed;

  -- `worker_*` is a stronger rule and a declarative one, so a worker function added
  -- later is covered too: the service role bypasses grants entirely, so neither anon
  -- nor authenticated has any reason to hold EXECUTE. Verified: nothing outside
  -- apps/workers calls one.
  FOR r IN
    SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public'
      AND p.proname LIKE 'worker=_%' ESCAPE '='
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
  LOOP
    v_sig := format('public.%I(%s)', r.name, r.args);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', v_sig);
    n_worker := n_worker + 1;
  END LOOP;

  RAISE NOTICE '0272: closed % worker_* functions to authenticated', n_worker;
END;
$do$;


-- ---------------------------------------------------------------------------
-- Assert the properties that matter. "anon cannot" is the easy half; "authenticated
-- still can" is the half that would have made this migration a silent outage.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_left INT;
BEGIN
  SELECT count(*) INTO v_left FROM public.anon_executable_definer_functions();
  IF v_left <> 0 THEN
    RAISE EXCEPTION '0272: % SECURITY DEFINER functions are still anon-executable', v_left;
  END IF;

  -- The directory must still work, or /schools and every branded sign-in page break.
  IF NOT has_function_privilege('anon', 'public.school_public_profile(TEXT)', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.school_branding_by_slug(TEXT)', 'EXECUTE')
  THEN
    RAISE EXCEPTION '0272: the public directory lost its anon grant';
  END IF;

  -- The function with an actual victim, named explicitly in both directions.
  IF has_function_privilege('anon', 'public.worker_parent_push_tokens(TEXT[])', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.worker_parent_push_tokens(TEXT[])', 'EXECUTE')
  THEN
    RAISE EXCEPTION '0272: worker_parent_push_tokens is still reachable with a user token';
  END IF;

  -- Capability preserved: a parent must still be able to find their own children, and
  -- the office must still be able to verify a payment.
  IF NOT has_function_privilege('authenticated', 'public.my_children()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.verify_payment(UUID,TEXT,TEXT)', 'EXECUTE')
  THEN
    RAISE EXCEPTION '0272: revoked a capability authenticated callers need';
  END IF;

  RAISE NOTICE '0272: PASS  anon closed, directory intact, authenticated unaffected';
END;
$do$;
