-- Migration: 0149_school_status_enforcement.sql
-- Created: 2026-09-29
-- Description: Makes school status binding. Until now a suspended, expired or terminated school
--              wrote exactly as freely as a paying one.
-- Related documents: Official Documentation/06 School and Tenant Management/SCHOOL_SETUP.md
--                    Official Documentation/06 School and Tenant Management/TRIAL.md
--                    Official Documentation/06 School and Tenant Management/SUBSCRIPTION.md
--
-- ===========================================================================
-- A LIFECYCLE TABLE NOTHING HONOURED
--
-- `SCHOOL_SETUP.md` has published this since April:
--
--   | Status               | Read | Write |
--   | pending_verification | yes  | limited |
--   | trial                | yes  | yes   |
--   | trial_expired        | yes  | NO    |
--   | active               | yes  | yes   |
--   | suspended            | yes  | NO    |
--   | terminated           | NO   | NO    |
--
-- Not one of those rules existed in the schema. A school whose trial lapsed, whose subscription
-- lapsed, or that AfriTech had terminated could enrol pupils, record payments and publish results
-- indefinitely. `0142` added the `trial_expired` value and said in its own header that the status
-- was recordable and not binding. This is the migration that binds it.
--
-- ---------------------------------------------------------------------------
-- WHY A TRIGGER AND NOT A POLICY
-- ---------------------------------------------------------------------------
-- The obvious implementation is a RESTRICTIVE policy per table. It was written, and then
-- abandoned, for one reason: **on Supabase the `postgres` role carries BYPASSRLS.** Every
-- SECURITY DEFINER function in this schema is owned by it — `save_exam_marks()`,
-- `verify_payment()`, `import_students()`, `generate_fee_records()` — so each of them would sail
-- straight past any policy. A rule that the busiest write paths ignore is not a rule.
--
-- Workers are the same story from the other end: `service_role` also bypasses RLS by design.
--
-- A trigger fires for everyone. Superuser, BYPASSRLS, SECURITY DEFINER, worker — there is no seat
-- from which it does not run. For an enforcement rule that is the whole requirement.
--
-- ---------------------------------------------------------------------------
-- WHY AFTER, WHICH IS NOT A DETAIL
-- ---------------------------------------------------------------------------
-- `0103` learned this the hard way. A BEFORE ROW trigger runs **ahead of** the RLS `WITH CHECK`,
-- so `0101`'s ceiling guard told School B the exact pupil limit of a full School A before anything
-- had established that School B could write there at all.
--
-- This trigger raises a message naming another tenant's commercial standing — *"this school is
-- suspended"* — which is the same class of disclosure. AFTER, so the policy decides whether the
-- caller is entitled to hear it, and only then does the trigger speak.
--
-- ---------------------------------------------------------------------------
-- STATEMENT LEVEL, WITH TRANSITION TABLES
-- ---------------------------------------------------------------------------
-- FOR EACH STATEMENT rather than FOR EACH ROW. `import_students()` writes four hundred pupils in
-- one statement; a row trigger would resolve the same school's status four hundred times to reach
-- the same answer. The transition table makes it one `SELECT DISTINCT`.
--
-- ---------------------------------------------------------------------------
-- WHAT IS DELIBERATELY NOT ENFORCED
-- ---------------------------------------------------------------------------
-- **`pending_verification` is treated as fully writable**, though the table above says "limited".
-- The documents disagree with each other about what limited means: `SCHOOL_SETUP.md` business
-- rule 4 says such a school "cannot invite parents or import students until activated", while
-- `ONBOARDING.md`'s pilot process has AfriTech importing student data *during* the guided session
-- and activating the school afterwards. Building a rule from a spec that contradicts itself would
-- produce a limit nobody could predict. Tracked in CLAUDE.md instead.
--
-- **Reads are not touched.** `terminated` says no reads, and revoking them would also revoke
-- AfriTech's view of the school it just terminated, and the school's own ability to export its
-- data — which `TRIAL.md` business rule 6 explicitly preserves. Blocking writes is the rule with
-- teeth; blocking reads is a data-retention decision with a legal clock on it, and belongs with
-- the archiving work rather than here.
-- ===========================================================================

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- 1. The rule, in one place.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.school_can_write(p_school_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
-- DEFINER so the status is read whatever the caller can see. A school user's own policy would
-- show them their row, but a worker or a cross-tenant attempt must get a real answer rather than
-- "no row visible", which would read as FALSE for the wrong reason.
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    /**
     * No school at all. `teaching_resources` and `ai_credit_accounts` carry a nullable school_id
     * because a standalone Teacher Hub user has no school, and `announcements` carries one because
     * AfriTech sends platform-wide notices. None of them has a school status to consult, and
     * returning FALSE here would lock every standalone teacher out of their own work.
     */
    WHEN p_school_id IS NULL THEN TRUE

    -- AfriTech acts on schools in every state — that is what the states are for.
    WHEN public.is_afritech_admin() THEN TRUE

    ELSE COALESCE(
      (SELECT s.status IN ('pending_verification', 'trial', 'active')
         FROM public.schools s WHERE s.id = p_school_id),
      -- A school_id pointing at no school. Refuse rather than allow: every table here has a
      -- foreign key, so this is unreachable, and the safe answer to an impossible state is no.
      FALSE
    )
  END;
$$;

GRANT EXECUTE ON FUNCTION public.school_can_write(UUID) TO authenticated;

COMMENT ON FUNCTION public.school_can_write(UUID) IS
  'Whether a school may be written to, per the SCHOOL_SETUP.md lifecycle. NULL school_id is TRUE '
  '(standalone teacher, or a platform-wide row). AfriTech is always TRUE.';

-- ---------------------------------------------------------------------------
-- 2. The guards.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_school_writable_new()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT s.status INTO v_status
    FROM new_rows n
    JOIN public.schools s ON s.id = n.school_id
   WHERE NOT public.school_can_write(n.school_id)
   LIMIT 1;

  IF v_status IS NOT NULL THEN
    RAISE EXCEPTION
      'This school is %, so its records cannot be changed. Reading and exporting still work. '
      'Contact AfriTech to restore it.', v_status
      USING ERRCODE = 'ZS002';
  END IF;

  RETURN NULL;   -- AFTER STATEMENT triggers ignore the return value.
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_school_writable_old()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT s.status INTO v_status
    FROM old_rows o
    JOIN public.schools s ON s.id = o.school_id
   WHERE NOT public.school_can_write(o.school_id)
   LIMIT 1;

  IF v_status IS NOT NULL THEN
    RAISE EXCEPTION
      'This school is %, so its records cannot be deleted.', v_status
      USING ERRCODE = 'ZS002';
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.enforce_school_writable_new() IS
  'AFTER STATEMENT guard for INSERT and UPDATE. AFTER, not BEFORE: the message names another '
  'tenant''s commercial standing, so RLS must decide entitlement first — see 0103.';

-- ---------------------------------------------------------------------------
-- 3. Attached to every school-scoped table, by discovery rather than by list.
-- ---------------------------------------------------------------------------
/**
 * Discovered from the catalogue rather than enumerated, so a table added later is covered by
 * re-running this block rather than by somebody remembering. The exclusions are named with their
 * reasons; everything else with a UUID `school_id` is in.
 *
 * `public.schools` is excluded automatically by the type filter — its `school_id` is the TEXT
 * identifier `ZM-LSK-0001`, not a foreign key — and named as well, because relying on that
 * coincidence would be a trap for whoever reads this next.
 */
DO $$
DECLARE
  t TEXT;
  n INT := 0;
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      JOIN pg_attribute a  ON a.attrelid = c.oid
                          AND a.attname = 'school_id'
                          AND a.attnum > 0
                          AND NOT a.attisdropped
     WHERE ns.nspname = 'public'
       AND c.relkind = 'r'
       AND a.atttypid = 'uuid'::regtype
       AND c.relname NOT IN (
         -- The status lives here. Changing it must stay possible, and its `school_id` is TEXT.
         'schools',
         -- The record of what happened, including the suspension. An audit trail that stops
         -- recording when a school is suspended is not an audit trail. 0131 also makes it
         -- immutable, so a guard here could never be satisfied by a correction either.
         'audit_logs',
         -- AfriTech's own alerting. An incident about a suspended school is exactly the kind
         -- worth raising.
         'platform_incidents',
         -- Worker bookkeeping and delivery receipts. The final "your subscription has lapsed"
         -- message must still be sent and still be logged, which means a row in both.
         'job_runs',
         'message_log',
         -- AfriTech-only, and the place a termination is recorded.
         'school_onboarding'
       )
     ORDER BY c.relname
  LOOP
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

  RAISE NOTICE 'school status enforcement attached to % tables', n;

  IF n < 25 THEN
    RAISE EXCEPTION
      'Only % tables were guarded, which is far fewer than the schema has. The discovery query '
      'is wrong — check it before trusting this migration.', n;
  END IF;
END;
$$;

-- === MIGRATION END ===
