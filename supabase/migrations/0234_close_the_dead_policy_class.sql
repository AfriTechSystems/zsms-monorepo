-- ===========================================================================
-- 0234 — the last three dead policies, and a guard so the class cannot recur
--
-- Spec: `01 Foundation Layer/RLS.md`, `CONVENTIONS.md` prohibition 4
--
-- ## The defect, for the seventh time
--
-- **RLS does not imply a GRANT.** Postgres checks the privilege first, so a table
-- with carefully written policies and no grant to `authenticated` is dead code
-- that reads as protection. Every read is refused, and the refusal looks like a
-- permissions bug rather than a missing line in a migration.
--
-- This repository has now hit it seven times: `0212`, `0218`, `0233`'s two, and
-- the three closed here — `parent_link_claims`, `school_credit_assignments` and
-- `school_credit_settings`, with three, three and two policies respectively and
-- nothing granted on any of them.
--
-- All three are read by a route (`/api/parent/link-claims`, `/api/school/credits`)
-- which has therefore been answering "permission denied" to real users since each
-- table was created. Every call site SELECTs; every write goes through a SECURITY
-- DEFINER function, which needs no grant.
--
-- ## Why this migration adds a guard rather than just the grants
--
-- Six previous fixes did not stop the seventh. Each was correct and none of them
-- made the next occurrence visible, because nothing asks the question — the
-- symptom only appears when a human clicks the button or a pgTAP suite happens to
-- cover that table.
--
-- The guard below is a function CI can call, listing every `public` table that has
-- policies and no grant. `tenant_isolation_test` asserts it returns nothing, so
-- the eighth occurrence fails a build instead of reaching a school.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The three grants.
-- ---------------------------------------------------------------------------

GRANT SELECT ON public.parent_link_claims TO authenticated;
GRANT SELECT ON public.school_credit_assignments TO authenticated;
GRANT SELECT ON public.school_credit_settings TO authenticated;

REVOKE ALL ON public.parent_link_claims FROM anon;
REVOKE ALL ON public.school_credit_assignments FROM anon;
REVOKE ALL ON public.school_credit_settings FROM anon;

-- ---------------------------------------------------------------------------
-- 2. The guard.
-- ---------------------------------------------------------------------------

/*
  Every `public` table with at least one policy and no grant to `authenticated`.

  Returns rows only when something is wrong, so an empty result is the healthy
  state and the suite can assert a count of zero.

  Not SECURITY DEFINER: it reads the catalogue, which every role may read, and a
  diagnostic has no business running with elevated privilege.
*/
CREATE OR REPLACE FUNCTION public.tables_with_dead_policies()
RETURNS TABLE (out_table_name TEXT, out_policy_count BIGINT)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT c.relname::TEXT,
         (SELECT COUNT(*) FROM pg_policies p
           WHERE p.schemaname = 'public' AND p.tablename = c.relname)
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = c.relname
    )
    AND NOT EXISTS (
      SELECT 1 FROM information_schema.table_privileges g
      WHERE g.table_schema = 'public'
        AND g.table_name = c.relname
        AND g.grantee = 'authenticated'
    )
  ORDER BY c.relname;
$$;

COMMENT ON FUNCTION public.tables_with_dead_policies() IS
  'Diagnostic: public tables whose policies cannot take effect because authenticated holds no privilege on them. Empty is healthy; tenant_isolation_test asserts that (0234).';

REVOKE ALL ON FUNCTION public.tables_with_dead_policies() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tables_with_dead_policies() FROM anon;
GRANT EXECUTE ON FUNCTION public.tables_with_dead_policies() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Prove it, and prove the guard would have caught the seven.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_n    INT;
  v_list TEXT;
BEGIN
  SELECT COUNT(*), string_agg(out_table_name, ', ')
    INTO v_n, v_list
  FROM public.tables_with_dead_policies();

  IF v_n > 0 THEN
    RAISE EXCEPTION
      '0234: % table(s) still have policies with no grant: %', v_n, v_list;
  END IF;

  -- And the grants themselves took.
  IF NOT has_table_privilege('authenticated', 'public.parent_link_claims', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.school_credit_assignments', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.school_credit_settings', 'SELECT') THEN
    RAISE EXCEPTION '0234: a SELECT grant did not take';
  END IF;

  RAISE NOTICE '0234: verified — no dead policies remain, and the guard now reports them';
END;
$$;
