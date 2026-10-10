-- ===========================================================================
-- 0231 — revoke inherited DELETE, and protect the one unguarded afritech table
--
-- Spec: `01 Foundation Layer/CONVENTIONS.md` prohibitions 4 and 8,
--       `supabase/tests/rls/tenant_isolation_test.sql` section 8
--
-- Found by CI, which is the only place that runs the pgTAP suites against a
-- from-scratch database. `npm run ci:checks` runs the fast half locally and the
-- database job needs Docker, so **the branch had been red for roughly twenty
-- commits without anybody noticing** — including while this session reported it
-- as green, reading a stale line in `CLAUDE.md` rather than asking GitHub.
--
-- ## What `0019` established, and what eroded it
--
-- `tenant_isolation_test` section 8 explains the mechanism: Supabase's default
-- privileges grant ALL on a new `public` table to `authenticated`, so a migration
-- that creates a table and adds SELECT/INSERT/UPDATE **without revoking DELETE**
-- leaves the inherited DELETE live. RLS still blocks it where no DELETE policy
-- exists — but a policy written `FOR ALL` covers DELETE too, and on those paths
-- the privilege is real.
--
-- `0019` removed every such grant and the suite has asserted zero ever since.
-- Ten tables have since reintroduced it. Checked against the application rather
-- than assumed: **nine of the ten are never deleted from by any code.** They are
-- the inherited privilege, not a decision.
--
-- `announcement_starters`, `lenders`, `school_custom_roles` (0228),
-- `school_integrations` (0230), `school_payment_details` (0212),
-- `teaching_resource_ratings`, `timetable_periods`, `timetable_slots`,
-- `timetables` — all revoked here. Three of those are this session's own.
--
-- ## The one real exception
--
-- `staff_custom_role_assignments` IS deleted from: removing somebody from a
-- custom role is `DELETE FROM staff_custom_role_assignments`, and that is the
-- right shape. It is a join row recording a present fact, not a historical
-- record — "this person is an Exams Officer" either holds or it does not, and
-- prohibition 8 names students, fee records, payments and exam results, none of
-- which this is.
--
-- The removal is not lost: `0228` attached `audit_row_change()` to this table, so
-- the delete writes an audit row naming who did it and when.
--
-- The suite is amended in the same change to allow exactly this table by name,
-- rather than loosened to a count — so the next inherited DELETE still fails.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Revoke the nine.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t TEXT;
  -- Every table that grants DELETE and that no code deletes from.
  v_tables TEXT[] := ARRAY[
    'announcement_starters',
    'lenders',
    'school_custom_roles',
    'school_integrations',
    'school_payment_details',
    'teaching_resource_ratings',
    'timetable_periods',
    'timetable_slots',
    'timetables'
  ];
BEGIN
  FOREACH t IN ARRAY v_tables
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('REVOKE DELETE, TRUNCATE ON public.%I FROM authenticated', t);
      EXECUTE format('REVOKE DELETE, TRUNCATE ON public.%I FROM anon', t);
    END IF;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. `afritech.school_credit_plans` had no row-level security at all.
-- ---------------------------------------------------------------------------

/*
  Prohibition 4: a new table without an RLS policy is a defect.

  Not a live hole today — the table grants nothing to `authenticated` or `anon`,
  so nobody can reach it whatever the policies say. It is the NEXT grant that
  would open it silently, which is exactly why `communications_test` asserts
  every `afritech` table is enabled AND forced rather than waiting for one.
*/
ALTER TABLE afritech.school_credit_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE afritech.school_credit_plans FORCE ROW LEVEL SECURITY;

/*
  AfriTech only, and said once.

  `afritech` is unreachable from PostgREST (`schemas = ["public"]`), so this
  policy exists for SQL callers and for the day somebody adds a `public` wrapper
  — at which point the default must already be closed rather than remembered.
*/
DROP POLICY IF EXISTS afritech_admin_all_school_credit_plans
  ON afritech.school_credit_plans;
CREATE POLICY afritech_admin_all_school_credit_plans
  ON afritech.school_credit_plans
  FOR ALL TO authenticated
  USING (public.is_afritech_admin())
  WITH CHECK (public.is_afritech_admin());

-- ---------------------------------------------------------------------------
-- 3. Prove both, by asking the catalogue the same question the suites ask.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_deletes INT;
  v_unguarded INT;
  v_offenders TEXT;
BEGIN
  SELECT COUNT(*), string_agg(DISTINCT table_name, ', ')
    INTO v_deletes, v_offenders
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND grantee IN ('authenticated', 'anon')
    AND privilege_type IN ('DELETE', 'TRUNCATE')
    -- The one documented exception; see the header.
    AND table_name <> 'staff_custom_role_assignments';

  IF v_deletes > 0 THEN
    RAISE EXCEPTION '0231: DELETE still granted on: %', v_offenders;
  END IF;

  SELECT COUNT(*) INTO v_unguarded
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'afritech' AND c.relkind = 'r'
    AND NOT (c.relrowsecurity AND c.relforcerowsecurity);

  IF v_unguarded > 0 THEN
    RAISE EXCEPTION '0231: % afritech table(s) still lack forced RLS', v_unguarded;
  END IF;

  RAISE NOTICE '0231: verified — one documented DELETE exception, every afritech table forced';
END;
$$;
