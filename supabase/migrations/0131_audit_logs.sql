-- Migration: 0131_audit_logs.sql
-- Created: 2026-09-27
-- Description: The immutable audit trail. Triggers on the tables that matter, plus a
--              logger for intent the trigger cannot infer.
-- Related documents: Official Documentation/01 Foundation Layer/DATABASE.md
--                    Official Documentation/01 Foundation Layer/COMPLIANCE.md
--                    Official Documentation/01 Foundation Layer/BUILD_SEQUENCE.md
--                    Official Documentation/09 Fee and Financial Management/AUDIT.md
--
-- ===========================================================================
-- THIS TABLE WAS SPECIFIED FROM THE START AND NEVER BUILT
--
-- `BUILD_SEQUENCE.md` sets two gates that cannot currently pass:
--
--   * Phase 0 — "pgTAP suite passes: … `audit_logs` not updatable"
--   * Phase 3 — "Every financial event writes an immutable `audit_logs` row"
--
-- Neither can, because the table does not exist. It is not under another name and not in
-- `private` — the only thing resembling it is Supabase's own `auth.audit_log_entries`,
-- which belongs to GoTrue and records nothing about ZSMS.
--
-- So payments have been recorded, verified and allocated with **no immutable record of who
-- decided what**. That is a compliance gap rather than a missing feature: the Zambia Data
-- Protection Act requires an account of processing, and the SOC 2 Type I readiness effort
-- cannot evidence change control without one. It is also the thing you most want to already
-- have on the day a parent disputes a payment.
--
-- ---------------------------------------------------------------------------
-- WHY TRIGGERS, WHEN THE SPEC SAYS EDGE FUNCTIONS
-- ---------------------------------------------------------------------------
-- `DATABASE.md` says audit rows are "written exclusively by Edge Functions using the
-- service role key". There are no Edge Functions in this project — `supabase/functions/`
-- is empty — and the acts worth auditing happen inside SQL functions like
-- `verify_payment()` and `allocate_payment()`.
--
-- But the deeper problem with that design is the word **every**. If auditing depends on each
-- function remembering to call a logger, then the first function that forgets is silently
-- unaudited, and nobody discovers it until an investigation needs the row that was never
-- written. An audit trail with a gap nobody knows about is worse than no audit trail,
-- because it is trusted.
--
-- **A trigger cannot forget.** So the record of *what changed* comes from AFTER triggers on
-- the tables themselves, which no application path can bypass — not a new route, not a
-- direct PostgREST call, not a future function written by somebody who has not read this
-- file.
--
-- What a trigger genuinely cannot know is **intent**: that an UPDATE to `results_published`
-- was a headteacher publishing, that a status change was a verification decision, that 320
-- rows arrived as one import. `log_audit_event()` records those, and the two are
-- complementary rather than alternatives.
--
-- ---------------------------------------------------------------------------
-- IMMUTABLE MEANS IMMUTABLE, WHICH RLS ALONE CANNOT DELIVER
-- ---------------------------------------------------------------------------
-- The obvious implementation is to grant no UPDATE or DELETE and rely on policies. That
-- stops `authenticated`, and it is not enough: **`service_role` bypasses RLS**, and a worker
-- or a future Edge Function holding that key could rewrite history with no trace.
--
-- So immutability is enforced by a trigger that raises on UPDATE or DELETE regardless of
-- who the caller is. Even the table owner is refused. The only way past it is to drop the
-- trigger, which is itself a schema change in a migration somebody has to write down.
--
-- ---------------------------------------------------------------------------
-- THE AUDIT LOG MUST NOT BECOME A SECOND COPY OF THE PII
-- ---------------------------------------------------------------------------
-- Snapshotting rows into an append-only table that a school owner can read would quietly
-- create an unprotected duplicate of `students.nrc_or_birth_cert` and of the encrypted
-- gateway credentials — data whose whole protection is that few people can reach it.
--
-- `mask_audit_values()` redacts by name, and two choices in it matter:
--
--   * It matches `%encrypted%` by pattern as well as by explicit name, so a column added
--     later following the established naming convention is masked without anybody
--     remembering to update this function.
--   * UPDATE records only the columns that actually **changed**. A full before-and-after
--     snapshot of every row is both far more data and a much larger surface of PII, for no
--     investigative benefit — the question is always what changed.
-- ===========================================================================

-- === MIGRATION START ===

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL for platform-level acts: creating a school, an AfriTech sign-in, a tier change.
  school_id             UUID REFERENCES public.schools(id),
  /**
   * The REAL actor. During impersonation this stays the AfriTech administrator, never the
   * teacher whose session was borrowed — otherwise the log would attribute an
   * administrator's act to the person they were impersonating, which is the exact opposite
   * of what an audit trail is for.
   */
  actor_user_id         TEXT NOT NULL,
  impersonated_user_id  TEXT,
  action                TEXT NOT NULL,
  table_name            TEXT NOT NULL,
  -- NULL for a bulk operation, which has no single record.
  record_id             UUID,
  -- Changed columns only, PII redacted. NULL on INSERT.
  old_values            JSONB,
  -- Changed columns only, PII redacted. NULL on DELETE.
  new_values            JSONB,
  ip_address            TEXT,
  user_agent            TEXT,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- No `updated_at`. This record never changes; see the immutability trigger below.
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_school ON public.audit_logs(school_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.audit_logs(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table_record
  ON public.audit_logs(table_name, record_id);
-- DESC, because every question asked of this table is "what happened most recently".
CREATE INDEX IF NOT EXISTS idx_audit_logs_created
  ON public.audit_logs(school_id, created_at DESC);

COMMENT ON TABLE public.audit_logs IS
  'Immutable append-only audit trail. Written by AFTER triggers (what changed) and by '
  'log_audit_event() (intent). UPDATE and DELETE are refused by trigger for EVERY role, '
  'including the table owner and service_role, because RLS does not constrain service_role.';

COMMENT ON COLUMN public.audit_logs.actor_user_id IS
  'The real actor. Under impersonation this is the AfriTech administrator, not the '
  'impersonated user, who goes in impersonated_user_id.';

-- ---------------------------------------------------------------------------
-- 1. Immutability, enforced against everybody.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refuse_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  /**
   * No role check, deliberately. There is no caller for whom rewriting the audit trail is
   * legitimate — not AfriTech, not a worker holding the service role key, not the owner of
   * the table. A correction is a new row saying what was corrected.
   */
  RAISE EXCEPTION
    'audit_logs is append-only. % is never permitted; record a correcting entry instead.',
    TG_OP
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER refuse_mutation_on_audit_logs
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.refuse_audit_mutation();

-- TRUNCATE takes a statement-level trigger; without this, one statement empties the trail.
CREATE TRIGGER refuse_truncate_on_audit_logs
  BEFORE TRUNCATE ON public.audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION public.refuse_audit_mutation();

-- ---------------------------------------------------------------------------
-- 2. Redaction.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mask_audit_values(p_values JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key    TEXT;
  v_result JSONB := p_values;
BEGIN
  IF p_values IS NULL THEN
    RETURN NULL;
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_values) LOOP
    IF
      -- Named explicitly: the national registration / birth certificate number.
      v_key = 'nrc_or_birth_cert'
      -- By convention, so a column added later is covered without editing this function.
      OR v_key LIKE '%encrypted%'
      OR v_key LIKE '%password%'
      OR v_key LIKE '%secret%'
      OR v_key LIKE '%api_key%'
    THEN
      -- The KEY is kept and only the value replaced: knowing that the identity number was
      -- changed is exactly what an investigation needs, and knowing what it changed to is
      -- exactly what it must not have.
      v_result := jsonb_set(v_result, ARRAY[v_key], '"[REDACTED]"'::jsonb);
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.mask_audit_values(JSONB) IS
  'Redacts PII and credentials before they enter the audit trail, keeping the key and '
  'replacing only the value. Matches %encrypted%/%secret%/%password%/%api_key% by pattern '
  'so a newly added column following the convention is covered automatically.';

-- ---------------------------------------------------------------------------
-- 3. The trigger that records what changed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS TRIGGER
LANGUAGE plpgsql
-- DEFINER because `authenticated` holds no INSERT on audit_logs, by design: an audit row
-- must not be something an end user can write directly.
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old     JSONB;
  v_new     JSONB;
  v_changed JSONB := '{}'::jsonb;
  v_before  JSONB := '{}'::jsonb;
  v_key     TEXT;
  v_school  UUID;
  v_action  TEXT;
  v_record  UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_new := to_jsonb(NEW);
    v_action := 'create';
  ELSIF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD);
    v_action := 'delete';
  ELSE
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);

    /**
     * Changed columns only. `is_deleted` flipping true is reported as `soft_delete` rather
     * than `update`, because that is what a reader of the trail is looking for — the
     * repository never hard-deletes a pupil, a fee record, a payment or a result, so a
     * removal only ever appears as this flag moving.
     */
    FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
      IF v_new -> v_key IS DISTINCT FROM v_old -> v_key THEN
        v_changed := v_changed || jsonb_build_object(v_key, v_new -> v_key);
        v_before  := v_before  || jsonb_build_object(v_key, v_old -> v_key);
      END IF;
    END LOOP;

    -- Nothing actually changed. An UPDATE that sets a column to its current value is not
    -- an event, and logging it would bury the real ones.
    IF v_changed = '{}'::jsonb THEN
      RETURN NULL;
    END IF;

    v_action := CASE
      WHEN (v_old ->> 'is_deleted') IS DISTINCT FROM (v_new ->> 'is_deleted')
           AND (v_new ->> 'is_deleted') = 'true'
        THEN 'soft_delete'
      WHEN (v_old ->> 'is_deleted') IS DISTINCT FROM (v_new ->> 'is_deleted')
           AND (v_new ->> 'is_deleted') = 'false'
        THEN 'restore'
      ELSE 'update'
    END;

    v_old := v_before;
    v_new := v_changed;
  END IF;

  -- The row's own school, not the session's. A worker acting across schools, or a function
  -- running as DEFINER, would otherwise attribute the change to whatever org the session
  -- happened to hold — or to nothing at all.
  v_school := COALESCE(
    (CASE WHEN TG_OP = 'DELETE' THEN v_old ELSE to_jsonb(NEW) END) ->> 'school_id',
    NULL
  )::UUID;

  v_record := COALESCE(
    (CASE WHEN TG_OP = 'DELETE' THEN v_old ELSE to_jsonb(NEW) END) ->> 'id',
    NULL
  )::UUID;

  INSERT INTO public.audit_logs (
    school_id, actor_user_id, impersonated_user_id, action, table_name, record_id,
    old_values, new_values, metadata
  ) VALUES (
    v_school,
    /**
     * `get_actor_id()` reads the `act` claim, which Clerk sets during impersonation and
     * which therefore holds the REAL administrator. It is preferred over `sub` for exactly
     * that reason. A worker has no JWT at all, so it falls through to a literal marker
     * rather than to NULL — `actor_user_id` is NOT NULL, and a job's writes must still be
     * attributable to something a human can interpret.
     */
    COALESCE(public.get_actor_id(), public.get_user_id(), 'system:worker'),
    -- Only meaningful when an actor claim exists: then `sub` is the borrowed session.
    CASE WHEN public.get_actor_id() IS NOT NULL THEN public.get_user_id() END,
    v_action,
    TG_TABLE_NAME,
    v_record,
    public.mask_audit_values(v_old),
    public.mask_audit_values(v_new),
    jsonb_build_object('op', TG_OP)
  );

  RETURN NULL;  -- AFTER trigger; the return value is ignored.
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Attach it to the tables where the record matters.
-- ---------------------------------------------------------------------------
/**
 * Money, marks, enrolment, and access. Not every table: an audit trail that records
 * everything is one nobody reads, and the cost of a row per write is real.
 *
 * `payments` and `fee_records` are the Phase 3 gate. `exam_results` is the academic record a
 * dispute turns on. `students` covers enrolment and soft deletion. `staff_members` and
 * `teacher_assignments` cover who was given reach over a class. `standalone_teacher_accounts`
 * covers a commercial state change on a paid account.
 */
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'payments', 'fee_records', 'fee_structures', 'exam_results', 'students',
    'staff_members', 'teacher_assignments', 'standalone_teacher_accounts'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS audit_changes_on_%1$s ON public.%1$I;
       CREATE TRIGGER audit_changes_on_%1$s
         AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
         FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 5. The logger for intent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_audit_event(
  p_action     TEXT,
  p_table_name TEXT,
  p_record_id  UUID    DEFAULT NULL,
  p_metadata   JSONB   DEFAULT '{}'::jsonb,
  p_school_id  UUID    DEFAULT NULL,
  p_ip_address TEXT    DEFAULT NULL,
  p_user_agent TEXT    DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id UUID;
BEGIN
  /**
   * For the things a trigger cannot see: that a status change was a verification decision,
   * that an UPDATE to `results_published` was a headteacher publishing, that 320 rows
   * arrived as a single import, that an impersonation session began.
   *
   * `p_school_id` defaults to the session's school rather than being required, so a caller
   * cannot accidentally file an event under no school at all. It stays overridable for a
   * worker, which has no session.
   */
  INSERT INTO public.audit_logs (
    school_id, actor_user_id, impersonated_user_id, action, table_name, record_id,
    metadata, ip_address, user_agent
  ) VALUES (
    COALESCE(p_school_id, public.current_school_uuid()),
    COALESCE(public.get_actor_id(), public.get_user_id(), 'system:worker'),
    CASE WHEN public.get_actor_id() IS NOT NULL THEN public.get_user_id() END,
    p_action,
    p_table_name,
    p_record_id,
    -- Masked too: a caller passing a changed identity number in metadata must not sneak it
    -- past the redaction that the trigger path applies.
    public.mask_audit_values(COALESCE(p_metadata, '{}'::jsonb)),
    p_ip_address,
    p_user_agent
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_audit_event(TEXT, TEXT, UUID, JSONB, UUID, TEXT, TEXT)
  TO authenticated;

COMMENT ON FUNCTION public.log_audit_event(TEXT, TEXT, UUID, JSONB, UUID, TEXT, TEXT) IS
  'Records INTENT, which a row trigger cannot infer — a publish, a verification decision, '
  'a bulk import, the start of an impersonation session. The record of what CHANGED comes '
  'from audit_row_change() instead, which no code path can bypass.';

-- ---------------------------------------------------------------------------
-- 6. RLS. Readable by the few, writable by nobody.
-- ---------------------------------------------------------------------------
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs FORCE  ROW LEVEL SECURITY;

/**
 * Restricted to the owner and principal within a school, not every role.
 *
 * These rows carry before-and-after values across fees, marks and enrolment. An accountant
 * who can read the whole trail can read every mark change in the school, and a teacher
 * could read salary-adjacent staff changes. The redaction protects identity numbers and
 * credentials; it does not make the rest of it everybody's business.
 *
 * AfriTech reads everything, which is what platform support and a breach investigation
 * require.
 */
CREATE POLICY leadership_read_own_school_audit_logs
  ON public.audit_logs FOR SELECT TO authenticated
  USING (
    (
      school_id = public.current_school_uuid()
      AND public.get_user_role() IN ('org:owner', 'org:principal')
    )
    OR COALESCE(public.is_afritech_admin(), FALSE)
  );

-- SELECT only. No INSERT grant: a row arrives through a DEFINER function or not at all.
-- No UPDATE or DELETE grant either, and the trigger above refuses them regardless.
GRANT SELECT ON public.audit_logs TO authenticated;

-- === MIGRATION END ===
