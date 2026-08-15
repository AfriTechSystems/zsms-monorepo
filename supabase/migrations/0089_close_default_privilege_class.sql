-- Migration: 0089_close_default_privilege_class.sql
-- Created: 2026-08-15
-- Description: Revokes the inherited INSERT/UPDATE on message_log and
--              school_message_quotas, and stops the whole class of bug by
--              changing the default for every table created from here on.
-- Related documents: Official Documentation/01 Foundation Layer/RLS.md
--
-- ============================================================================
-- THIS IS THE THIRD OCCURRENCE OF ONE MECHANISM. FIXING THE INSTANCE IS NOT
-- ENOUGH.
-- ============================================================================
--   0019 — `authenticated` held DELETE on every Phase 1 table.
--   0076 — `authenticated` held UPDATE on payments.
--   0089 — `authenticated` holds INSERT and UPDATE on message_log and
--          school_message_quotas.
--
-- Each time the migration granted what the table needed and assumed that was
-- the whole story. **GRANT is not a whitelist.** Supabase's default privileges
-- already give `authenticated` and `anon` ALL on any new table in `public`, so
-- a migration that only ever adds grants leaves everything it did not think
-- about switched on.
--
-- The consequences here were real, not theoretical:
--   * message_log INSERT would let a user fabricate a delivery record — the
--     exact artefact a school would rely on to claim a parent was warned.
--   * school_message_quotas UPDATE would let a school reset messages_used to
--     zero and send without limit, at AfriTech's expense.
--
-- RLS covered both (neither table has an INSERT or UPDATE policy), so nothing
-- was exploitable in practice. But that means a single future `FOR ALL` policy
-- — the shape used for every afritech_admin_* policy in this codebase — would
-- have silently opened it. Relying on that is exactly the thin guarantee 0019
-- and 0076 already documented.
--
-- THE STRUCTURAL FIX is the ALTER DEFAULT PRIVILEGES below: new tables in
-- `public` now arrive with NOTHING granted to end-user roles, and every
-- migration must grant explicitly. From here on, forgetting to grant produces a
-- visible permission error rather than an invisible hole.

-- === MIGRATION START ===

-- 1. Close the two live instances.
REVOKE INSERT, UPDATE ON public.message_log            FROM authenticated, anon;
REVOKE INSERT, UPDATE ON public.school_message_quotas  FROM authenticated, anon;

-- 2a. VIEWS are read surfaces and must never be writable.
--
-- Found by this migration's own verification step, which is the only reason it
-- is here: `fee_record_status` and `student_fee_balance` (0077) both carried
-- INSERT and UPDATE for `authenticated`.
--
-- `fee_record_status` is a simple view over fee_records with a WHERE clause,
-- which makes it AUTO-UPDATABLE in PostgreSQL — a write through the view
-- reaches the table beneath. `security_invoker = true` meant fee_records' own
-- RLS still applied, so nothing was exploitable; but it was an entire write
-- path nobody designed, reviewed, or tested.
--
-- The first sweep missed these because it joined `pg_tables`, which excludes
-- views. That is precisely the kind of gap a narrow query creates and a broad
-- assertion catches.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT g.table_name, g.privilege_type, g.grantee
    FROM information_schema.role_table_grants g
    JOIN pg_views v ON v.viewname = g.table_name AND v.schemaname = g.table_schema
    WHERE g.table_schema = 'public'
      AND g.grantee IN ('authenticated', 'anon')
      AND g.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
  LOOP
    EXECUTE format('REVOKE %s ON public.%I FROM %I', r.privilege_type, r.table_name, r.grantee);
    RAISE NOTICE 'revoked % on view public.% from %', r.privilege_type, r.table_name, r.grantee;
  END LOOP;
END;
$$;

-- 2b. Sweep existing TABLES for mutating privileges no policy backs.
--     Deliberately narrow: only removes a privilege where the table has no
--     policy of that command, so it cannot break a working write path.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT t.tablename, g.privilege_type, g.grantee
    FROM information_schema.role_table_grants g
    JOIN pg_tables t ON t.tablename = g.table_name AND t.schemaname = g.table_schema
    WHERE g.table_schema = 'public'
      AND g.grantee IN ('authenticated', 'anon')
      AND g.privilege_type IN ('INSERT', 'UPDATE')
      AND NOT EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename = g.table_name
          AND (p.cmd = g.privilege_type OR p.cmd = 'ALL')
      )
  LOOP
    EXECUTE format('REVOKE %s ON public.%I FROM %I', r.privilege_type, r.tablename, r.grantee);
    RAISE NOTICE 'revoked % on public.% from %', r.privilege_type, r.tablename, r.grantee;
  END LOOP;
END;
$$;

-- 3. Change the default so this cannot recur.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM authenticated, anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM authenticated, anon;

-- 4. Verify inline. If a later migration re-introduces an ungoverned mutating
--    privilege, this fails at apply time rather than in an audit months later.
DO $$
DECLARE
  leaked INT;
  detail TEXT;
BEGIN
  SELECT count(*), COALESCE(string_agg(DISTINCT g.table_name || '.' || g.privilege_type, ', '), '')
  INTO leaked, detail
  FROM information_schema.role_table_grants g
  WHERE g.table_schema = 'public'
    AND g.grantee IN ('authenticated', 'anon')
    AND g.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
    -- Views are covered by 2a and never carry policies of their own.
    AND EXISTS (SELECT 1 FROM pg_tables t WHERE t.schemaname='public' AND t.tablename=g.table_name)
    AND NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = g.table_name
        AND (p.cmd = g.privilege_type OR p.cmd = 'ALL')
    );

  IF leaked > 0 THEN
    RAISE EXCEPTION
      'Mutating privileges with no backing policy remain: % (%). Grant deliberately or revoke.',
      leaked, detail;
  END IF;
END;
$$;

-- === MIGRATION END ===
