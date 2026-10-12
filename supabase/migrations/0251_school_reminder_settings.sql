-- ===========================================================================
-- 0251 — reminder timing is a school's decision, not a constant in a handler
--
-- Spec: `09 Fee and Financial Management/REMINDERS.md` → *Reminder Settings*,
--       `01 Foundation Layer/DYNAMIC_CONFIG.md`
--
-- ## What was hardcoded
--
-- `apps/workers/src/handlers/fee-reminders.ts`:
--
--     minDaysOverdue: options.minDaysOverdue ?? 3,
--     cooldownDays:   options.cooldownDays   ?? 7,
--
-- Two numbers, in TypeScript, that decide when every school in Zambia chases a
-- parent for money. Nothing passes those options, so the defaults ARE the
-- behaviour — and they do not match REMINDERS.md, which specifies reminders at
-- **7, 14 and 30 days** with 3 and 60 as optional extras a school may enable.
--
-- `CLAUDE.md` is explicit that a price, tier or feature inclusion is never
-- hardcoded. A debt-collection schedule is the same kind of thing: it is a
-- commercial and relational decision a school makes about its own parents, and
-- a boarding school chasing at three days is a different institution from a
-- community school chasing at thirty.
--
-- ## Why a table rather than `platform_settings`
--
-- Platform settings are one value for everybody. This has to differ per school,
-- which is the whole point. The row is created on demand with the documented
-- defaults, so a school that never opens the screen behaves exactly as
-- REMINDERS.md says it should — rather than as whatever a handler last defaulted
-- to.
--
-- ## Channels are here too, and one of them costs money
--
-- WhatsApp draws on the school's monthly quota; email and in-app do not.
-- REMINDERS.md puts all three on the same screen for that reason — a school
-- watching its quota needs to turn one off without turning reminders off.
-- ===========================================================================

/*
  A CHECK cannot contain a subquery (`0A000`), which the first draft of this
  migration learned the hard way — "every element between 1 and 730" wants an
  `unnest`, and `unnest` is a subquery.

  So the rule lives in an IMMUTABLE function the constraint calls. IMMUTABLE is
  required rather than decorative: Postgres will not accept a volatile function
  in a CHECK, because the constraint has to mean the same thing when a row is
  re-validated years later.
*/
CREATE OR REPLACE FUNCTION public.reminder_days_are_sane(p_days INT[])
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT p_days IS NULL
      OR array_length(p_days, 1) IS NULL
      OR (
        array_length(p_days, 1) <= 10
        -- No reminder before a fee is due, and none beyond two years overdue.
        AND (SELECT bool_and(d BETWEEN 1 AND 730) FROM unnest(p_days) AS d)
      );
$fn$;

COMMENT ON FUNCTION public.reminder_days_are_sane(INT[]) IS
  'CHECK helper for school_fee_reminder_settings.reminder_days. A function because a CHECK constraint cannot hold a subquery, and bounding every element needs unnest (0251).';

CREATE TABLE IF NOT EXISTS public.school_fee_reminder_settings (
  school_id UUID PRIMARY KEY REFERENCES public.schools(id) ON DELETE CASCADE,

  /*
    The days overdue at which a reminder goes out.

    An array rather than columns, because REMINDERS.md's own list is a set a
    school ticks — 7, 14, 30 by default, with 3 and 60 offered. Columns would
    mean a migration every time somebody wants a different rung.

    Sorted and de-duplicated on write by the setter below, so the worker can
    rely on the order without re-sorting on every run.
  */
  reminder_days INT[] NOT NULL DEFAULT ARRAY[7, 14, 30],

  /*
    Channels. WhatsApp costs the school quota; the other two do not, which is why
    they can be turned off independently.
  */
  via_whatsapp BOOLEAN NOT NULL DEFAULT TRUE,
  via_email    BOOLEAN NOT NULL DEFAULT TRUE,
  via_in_app   BOOLEAN NOT NULL DEFAULT TRUE,

  /*
    Days before the same fee record may be chased again.

    Separate from `reminder_days` because it guards against a different failure:
    the schedule says WHEN to chase, this says never twice within N days however
    the schedule is configured. A school that ticks 7, 14 and 30 and then adds 3
    should not accidentally send two reminders in one week.
  */
  cooldown_days INT NOT NULL DEFAULT 7 CHECK (cooldown_days BETWEEN 1 AND 90),

  /** Reminders off entirely, without losing the configuration. */
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,

  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Nothing absurd: no reminder before the due date, none after two years.
  CONSTRAINT reminder_days_sane CHECK (public.reminder_days_are_sane(reminder_days))
);

COMMENT ON TABLE public.school_fee_reminder_settings IS
  'When and how a school chases overdue fees (REMINDERS.md). Replaces two hardcoded constants in the reminder worker — a debt-collection schedule is a school''s decision about its own parents (0251).';

ALTER TABLE public.school_fee_reminder_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_fee_reminder_settings FORCE ROW LEVEL SECURITY;

/*
  Readable by anyone who can see fees, writable by those who manage money.

  A teacher does not need to know the chasing schedule; an accountant plainly
  does, and it is the accountant who will be asked why a parent got a message.
*/
CREATE POLICY school_read_reminder_settings
  ON public.school_fee_reminder_settings
  FOR SELECT TO authenticated
  USING (
    school_id = public.current_school_uuid()
    AND public.get_user_role() IN
      ('org:owner', 'org:principal', 'org:accountant', 'org:admin')
  );

CREATE POLICY afritech_read_reminder_settings
  ON public.school_fee_reminder_settings
  FOR SELECT TO authenticated
  USING (public.is_afritech_admin());

-- SELECT only; the setter below is the single writer, so the sorting and
-- de-duplication cannot be bypassed.
GRANT SELECT ON public.school_fee_reminder_settings TO authenticated;
REVOKE ALL ON public.school_fee_reminder_settings FROM anon;

-- The 0149 status guard and the audit trigger, attached here rather than left to
-- those migrations' frozen catalogue iteration.
DO $$
BEGIN
  EXECUTE 'DROP TRIGGER IF EXISTS enforce_school_writable_on_update_on_school_fee_reminder_settings
             ON public.school_fee_reminder_settings';
  EXECUTE 'CREATE TRIGGER enforce_school_writable_on_update_on_school_fee_reminder_settings
             AFTER UPDATE ON public.school_fee_reminder_settings
             REFERENCING NEW TABLE AS new_rows
             FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_school_writable_new()';

  -- Changing when parents are chased for money is worth a record of who did it.
  EXECUTE 'DROP TRIGGER IF EXISTS audit_changes_on_school_fee_reminder_settings
             ON public.school_fee_reminder_settings';
  EXECUTE 'CREATE TRIGGER audit_changes_on_school_fee_reminder_settings
             AFTER INSERT OR UPDATE OR DELETE ON public.school_fee_reminder_settings
             FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()';
END;
$$;

-- ---------------------------------------------------------------------------
-- Reading, with the documented defaults for a school that has never configured.
-- ---------------------------------------------------------------------------

/*
  Always returns a row.

  A school with no settings behaves as REMINDERS.md describes — 7, 14, 30, all
  channels, seven-day cooldown — rather than as whatever a caller last defaulted
  to. That is the difference between a documented default and an accidental one.
*/
CREATE OR REPLACE FUNCTION public.school_reminder_settings(p_school_id UUID)
RETURNS TABLE (
  out_reminder_days INT[],
  out_via_whatsapp  BOOLEAN,
  out_via_email     BOOLEAN,
  out_via_in_app    BOOLEAN,
  out_cooldown_days INT,
  out_is_enabled    BOOLEAN,
  out_configured    BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    COALESCE(s.reminder_days, ARRAY[7, 14, 30]),
    COALESCE(s.via_whatsapp, TRUE),
    COALESCE(s.via_email, TRUE),
    COALESCE(s.via_in_app, TRUE),
    COALESCE(s.cooldown_days, 7),
    COALESCE(s.is_enabled, TRUE),
    -- So a screen can say "using the defaults" rather than implying somebody chose them.
    s.school_id IS NOT NULL
  FROM (SELECT p_school_id AS id) q
  LEFT JOIN public.school_fee_reminder_settings s ON s.school_id = q.id;
$$;

REVOKE ALL ON FUNCTION public.school_reminder_settings(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.school_reminder_settings(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.school_reminder_settings(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.school_reminder_settings(UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- Writing.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_reminder_settings(
  p_reminder_days INT[],
  p_via_whatsapp  BOOLEAN,
  p_via_email     BOOLEAN,
  p_via_in_app    BOOLEAN,
  p_cooldown_days INT,
  p_is_enabled    BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_user   TEXT := public.get_user_id();
  v_days   INT[];
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'Sign in to your school first' USING ERRCODE = '42501';
  END IF;

  -- Money decisions: owner, principal, accountant. Not an administrator.
  IF public.get_user_role() NOT IN ('org:owner', 'org:principal', 'org:accountant') THEN
    RAISE EXCEPTION
      'Only the owner, principal or accountant can change reminder settings'
      USING ERRCODE = '42501';
  END IF;

  -- Sorted and de-duplicated once, here, so the worker never has to.
  SELECT ARRAY(SELECT DISTINCT unnest(p_reminder_days) ORDER BY 1) INTO v_days;

  IF array_length(v_days, 1) IS NULL AND p_is_enabled THEN
    RAISE EXCEPTION
      'Choose at least one reminder day, or switch reminders off entirely'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.school_fee_reminder_settings
    (school_id, reminder_days, via_whatsapp, via_email, via_in_app,
     cooldown_days, is_enabled, updated_by, updated_at)
  VALUES
    (v_school, v_days, p_via_whatsapp, p_via_email, p_via_in_app,
     COALESCE(p_cooldown_days, 7), p_is_enabled, v_user, NOW())
  ON CONFLICT (school_id) DO UPDATE
  SET reminder_days = EXCLUDED.reminder_days,
      via_whatsapp  = EXCLUDED.via_whatsapp,
      via_email     = EXCLUDED.via_email,
      via_in_app    = EXCLUDED.via_in_app,
      cooldown_days = EXCLUDED.cooldown_days,
      is_enabled    = EXCLUDED.is_enabled,
      updated_by    = EXCLUDED.updated_by,
      updated_at    = NOW();

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.set_reminder_settings(INT[], BOOLEAN, BOOLEAN, BOOLEAN, INT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_reminder_settings(INT[], BOOLEAN, BOOLEAN, BOOLEAN, INT, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_reminder_settings(INT[], BOOLEAN, BOOLEAN, BOOLEAN, INT, BOOLEAN) TO authenticated;

-- ---------------------------------------------------------------------------
-- Exercise it.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_school UUID;
  v_org    TEXT;
  v_row    RECORD;
BEGIN
  BEGIN
    SELECT id, clerk_org_id INTO v_school, v_org FROM public.schools
    WHERE status = 'active' AND clerk_org_id IS NOT NULL LIMIT 1;

    IF v_school IS NULL THEN
      RAISE NOTICE '0251: no school fixture; skipping';
      RAISE EXCEPTION 'ZSMS_0251_ROLLBACK';
    END IF;

    -- An unconfigured school gets REMINDERS.md's documented schedule.
    SELECT * INTO v_row FROM public.school_reminder_settings(v_school);
    IF v_row.out_reminder_days <> ARRAY[7, 14, 30] THEN
      RAISE EXCEPTION '0251: the default schedule is % not 7,14,30', v_row.out_reminder_days;
    END IF;
    IF v_row.out_configured THEN
      RAISE EXCEPTION '0251: an unconfigured school reported itself as configured';
    END IF;

    -- A teacher must not change when parents are chased for money.
    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', 'probe_teacher', 'role', 'authenticated',
      'o', json_build_object('id', v_org, 'rol', 'teacher'))::text, TRUE);
    BEGIN
      PERFORM public.set_reminder_settings(ARRAY[7], TRUE, TRUE, TRUE, 7, TRUE);
      RAISE EXCEPTION '0251: a teacher changed the reminder schedule';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    -- The accountant may, and the days are sorted and de-duplicated.
    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', 'probe_accountant', 'role', 'authenticated',
      'o', json_build_object('id', v_org, 'rol', 'accountant'))::text, TRUE);

    PERFORM public.set_reminder_settings(ARRAY[30, 7, 14, 7], FALSE, TRUE, TRUE, 10, TRUE);

    SELECT * INTO v_row FROM public.school_reminder_settings(v_school);
    IF v_row.out_reminder_days <> ARRAY[7, 14, 30] THEN
      RAISE EXCEPTION '0251: days were not sorted and de-duplicated: %', v_row.out_reminder_days;
    END IF;
    IF v_row.out_via_whatsapp THEN
      RAISE EXCEPTION '0251: switching WhatsApp off did not take';
    END IF;
    IF v_row.out_cooldown_days <> 10 THEN
      RAISE EXCEPTION '0251: the cooldown did not take';
    END IF;
    IF NOT v_row.out_configured THEN
      RAISE EXCEPTION '0251: a configured school still reports as unconfigured';
    END IF;

    -- Reminders on with no days is incoherent and must be refused.
    BEGIN
      PERFORM public.set_reminder_settings(ARRAY[]::INT[], TRUE, TRUE, TRUE, 7, TRUE);
      RAISE EXCEPTION '0251: reminders were left on with no days chosen';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;

    RAISE EXCEPTION 'ZSMS_0251_ROLLBACK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'ZSMS_0251_ROLLBACK' THEN
        RAISE NOTICE '0251: verified — documented defaults, teacher refused, days normalised, empty schedule refused';
      ELSE
        RAISE;
      END IF;
  END;
END;
$$;
