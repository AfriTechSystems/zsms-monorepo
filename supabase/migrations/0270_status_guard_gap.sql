-- ===========================================================================
-- 0270 — the status guard on ten tables that never had one
--
-- ## What this found
--
-- `0149` attaches its write-blocking triggers by iterating the table catalogue **at
-- migration time**. Every school-scoped table created afterwards has therefore had no
-- guard, and nothing reported it. CLAUDE.md has carried this as a known trap since
-- `0152`; writing `saved_views` (`0269`) was the first time anybody actually looked.
--
-- Fourteen tables were unguarded, not one. Among them: `school_api_keys`,
-- `school_fee_reminder_settings`, `school_public_profiles`, `document_templates` and
-- the AI credit tables. **A suspended school could create API keys, change when its
-- parents are chased for money, and edit its public listing** — all of which `0149`
-- exists to stop, and all of which read as working correctly because the refusal they
-- should have met never fired.
--
-- ## Why the omission was silent, and what stops it recurring
--
-- The trap is not that a table was missed. It is that missing one produces no symptom
-- at all: the writes simply succeed. So the second half of this migration is a
-- catalogue check, `unguarded_school_tables()`, asserted empty by a pgTAP suite that
-- runs in CI. The tracked row offered an event trigger on CREATE TABLE as the
-- alternative; the assertion wins because it fails where somebody would notice and
-- needs no privilege the migration role may not have.
--
-- ## Which tables are exempt, and why
--
-- `0149` already documents six exemptions and they are kept verbatim. This adds six
-- more, each for a stated reason — the test is whether the SCHOOL is the party doing
-- the writing:
--
--   * **`api_key_usage`, `integration_log`, `webhook_events`** — written BY the
--     platform as a side effect. Blocking the log does not block the act; it only
--     loses the record of it, which is the opposite of what a guard is for.
--   * **`parent_link_claims`, `school_join_requests`** — the parent and the teacher
--     are not the suspended party. Stranding a parent because their child's school
--     has lapsed punishes the wrong person, and the approval step is a function that
--     checks status separately.
--   * **`school_credit_purchases`** — a suspended school paying is how it stops being
--     suspended. Blocking payment would make the suspension unrecoverable.
-- ===========================================================================

DO $do$
DECLARE
  t TEXT;
  n INT := 0;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ai_conversations',
    'announcement_starters',
    'document_templates',
    'saved_views',
    'school_api_keys',
    'school_attendance_alert_settings',
    'school_credit_assignments',
    'school_credit_settings',
    'school_fee_reminder_settings',
    'school_public_profiles'
  ]
  LOOP
    -- Skip anything that does not exist on this database rather than failing: the
    -- list spans several features and a future environment may not have them all.
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;

    /*
      AFTER STATEMENT with transition tables, exactly as `0149` builds them.

      Not BEFORE ROW. The message names another tenant's commercial standing, and a
      BEFORE ROW trigger runs AHEAD of the RLS `WITH CHECK` — so it would tell school
      B the status of school A before establishing that B could write there at all.
      That is the `0101`/`0103` lesson, and it applies to every one of these.
    */
    EXECUTE format(
      'DROP TRIGGER IF EXISTS enforce_school_writable_on_insert_on_%I ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER enforce_school_writable_on_insert_on_%I
         AFTER INSERT ON public.%I
         REFERENCING NEW TABLE AS new_rows
         FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_school_writable_new()', t, t);

    EXECUTE format(
      'DROP TRIGGER IF EXISTS enforce_school_writable_on_update_on_%I ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER enforce_school_writable_on_update_on_%I
         AFTER UPDATE ON public.%I
         REFERENCING NEW TABLE AS new_rows
         FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_school_writable_new()', t, t);

    EXECUTE format(
      'DROP TRIGGER IF EXISTS enforce_school_writable_on_delete_on_%I ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER enforce_school_writable_on_delete_on_%I
         AFTER DELETE ON public.%I
         REFERENCING OLD TABLE AS old_rows
         FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_school_writable_old()', t, t);

    n := n + 1;
  END LOOP;

  RAISE NOTICE '0270: guarded % tables that 0149 could not see', n;
END;
$do$;

-- ---------------------------------------------------------------------------
-- The catalogue check, so this cannot recur quietly.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.unguarded_school_tables()
RETURNS TABLE (out_table_name TEXT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
  SELECT c.relname::TEXT
  FROM pg_class c
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid
                      AND a.attname = 'school_id'
                      AND a.attnum > 0
                      AND NOT a.attisdropped
  WHERE ns.nspname = 'public'
    AND c.relkind = 'r'
    AND a.atttypid = 'uuid'::REGTYPE
    AND NOT EXISTS (
      SELECT 1 FROM pg_trigger g
      WHERE g.tgrelid = c.oid
        AND NOT g.tgisinternal
        AND g.tgname LIKE 'enforce_school_writable_on_insert%'
    )
    AND c.relname NOT IN (
      -- 0149's own six. Reasons are in that migration and unchanged.
      'schools',
      'audit_logs',
      'platform_incidents',
      'job_runs',
      'message_log',
      'school_onboarding',
      -- Written BY the platform as a side effect; blocking the log loses the record
      -- without blocking the act.
      'api_key_usage',
      'integration_log',
      'webhook_events',
      -- The requester is not the suspended party.
      'parent_link_claims',
      'school_join_requests',
      -- AfriTech logging a call TO a suspended school. That call is largely what the
      -- suspension is about, so a guard here would block the conversation that ends
      -- it. Named as correctly exempt in CLAUDE.md since 0152.
      'school_onboarding_contacts',
      -- Paying is how a suspension ends; blocking it makes it unrecoverable.
      'school_credit_purchases',
      -- Provisioning runs before a school is ever active.
      'school_provisioning_steps'
    )
  GROUP BY c.relname
  ORDER BY c.relname;
$fn$;

COMMENT ON FUNCTION public.unguarded_school_tables() IS
  'School-scoped tables with no 0149 write guard, minus documented exemptions. Asserted empty in CI: a table created after 0149 gets no guard, and the omission has no symptom - the writes simply succeed (0270).';

REVOKE ALL ON FUNCTION public.unguarded_school_tables() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unguarded_school_tables() FROM anon;
GRANT EXECUTE ON FUNCTION public.unguarded_school_tables() TO authenticated;

-- ---------------------------------------------------------------------------
-- Exercise it.
-- ---------------------------------------------------------------------------

DO $do$
DECLARE
  v_unguarded TEXT;
  v_is_before BOOLEAN;
BEGIN
  SELECT string_agg(out_table_name, ', ') INTO v_unguarded
  FROM public.unguarded_school_tables();

  IF v_unguarded IS NOT NULL THEN
    RAISE EXCEPTION
      '0270: these school-scoped tables still have no write guard: %. Attach 0149 triggers, or add the table to the exemption list in unguarded_school_tables() WITH A REASON.',
      v_unguarded;
  END IF;

  -- The guard must be AFTER, not BEFORE: a BEFORE trigger would name another
  -- tenant's commercial standing before RLS had decided entitlement.
  SELECT (tgtype & 2) = 2 INTO v_is_before
  FROM pg_trigger
  WHERE tgrelid = 'public.saved_views'::REGCLASS
    AND tgname = 'enforce_school_writable_on_insert_on_saved_views';

  IF v_is_before IS NOT FALSE THEN
    RAISE EXCEPTION '0270: the guard on saved_views is not an AFTER trigger';
  END IF;

  RAISE NOTICE '0270: verified - no school-scoped table is unguarded, and the guards are AFTER';
END;
$do$;
