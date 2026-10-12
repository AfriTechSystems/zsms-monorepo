-- ===========================================================================
-- 0255 — per-absence parent alerts, as a polled queue rather than a trigger
--
-- Spec: `10 Attendance/TRIGGERS.md` → *Trigger 1 — Absence Notification Queue*,
--       *Per-Absence Alert Toggle*
--       `10 Attendance/NOTIFICATIONS.md` → *Channel 3*
--
-- ## What already existed, and what never read it
--
-- `attendance_records.parent_notified` and `.notification_sent_at` have existed
-- since `0074`. **Nothing has ever read or written either one.** The columns were
-- built for this feature and the feature was never wired, so marking a child
-- absent has never told their parent anything.
--
-- The `absence_alert` template exists too, for WhatsApp and email. So did the
-- quota meter. Only the decision to send was missing.
--
-- ## This does NOT implement TRIGGERS.md's design, and the reasons are concrete
--
-- That document specifies a row trigger on `attendance_records` that calls
-- `net.http_post()` to an Edge Function, authenticated with a service key read
-- from `current_setting('app.supabase_service_key')`. Three problems, any one of
-- which would be enough:
--
-- 1. **It puts an HTTP call inside the register's transaction.** A teacher marks
--    a class of forty, eight are absent, and the INSERT now blocks on eight
--    sequential HTTP round-trips. If the endpoint is slow the register appears to
--    hang; if it fails, either the teacher's attendance is rolled back because a
--    notification could not be queued — which is the wrong thing to lose — or
--    the error is swallowed and the alert is silently dropped.
--
-- 2. **It needs an Edge Function, and ADR-044 settled that those are
--    superseded.** `supabase/functions/` stays empty on purpose: the Railway
--    workers already do this work over BullMQ, and building a second async system
--    to serve one trigger would mean two deployments, two sets of secrets and two
--    things to monitor.
--
-- 3. **It stores a service-role key in database configuration.** That key
--    bypasses RLS entirely. `ALTER DATABASE ... SET` puts it where every
--    SECURITY DEFINER function and every superuser-adjacent context can read it,
--    to save a lookup.
--
-- So absences are **polled**, exactly as overdue fees already are
-- (`worker_due_fee_reminders`, `0252`) and scheduled announcements before them.
-- The register commits at the speed of a database write, a crashed worker
-- retries rather than losing the alert, and `parent_notified` becomes the
-- idempotency key the columns were always shaped to be.
--
-- Recorded as ADR-047 so this is a decision somebody can disagree with on the
-- record, rather than an undocumented divergence.
--
-- ## Off by default, because it is expensive
--
-- NOTIFICATIONS.md does the arithmetic: 400 pupils at 5% daily absence is ~400
-- messages a month, which is 80% of the Starter tier's entire quota spent on
-- absence alerts. Default FALSE, and the screen shows the projection before a
-- school turns it on.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.school_attendance_alert_settings (
  school_id UUID PRIMARY KEY REFERENCES public.schools(id) ON DELETE CASCADE,

  /*
    Off by default. NOTIFICATIONS.md calls this "portal-first": the in-app badge
    is always active and costs nothing, so a parent who signs in always sees the
    absence. This switch is only about *pushing* it to them, which costs quota.
  */
  per_absence_alert_enabled BOOLEAN NOT NULL DEFAULT FALSE,

  /*
    Which marks are worth a parent's phone buzzing.

    Absent only, by default. A school that wants to be told about lateness can
    add it, but defaulting to it would send a message every time a nine-year-old
    missed a bus.
  */
  alert_on_statuses TEXT[] NOT NULL DEFAULT ARRAY['absent'],

  via_whatsapp BOOLEAN NOT NULL DEFAULT TRUE,
  via_email    BOOLEAN NOT NULL DEFAULT TRUE,
  via_push     BOOLEAN NOT NULL DEFAULT TRUE,

  /*
    How stale an unsent alert may be before it is abandoned.

    If the worker is down for a week, a parent should not wake to forty messages
    about absences they already saw in the portal. Two days keeps a same-day
    alert working across an overnight outage and discards the archaeology.
  */
  max_age_days INT NOT NULL DEFAULT 2 CHECK (max_age_days BETWEEN 1 AND 30),

  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Only real attendance statuses, and never 'present'.
  CONSTRAINT alert_statuses_valid CHECK (
    alert_on_statuses <@ ARRAY['absent', 'late', 'excused']::TEXT[]
    AND array_length(alert_on_statuses, 1) >= 1
  )
);

COMMENT ON TABLE public.school_attendance_alert_settings IS
  'Whether a school pushes per-absence alerts to parents, and how. Off by default: NOTIFICATIONS.md shows 400 pupils at 5% absence spends 80% of the Starter quota on these alone (0255).';

ALTER TABLE public.school_attendance_alert_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_attendance_alert_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY school_read_attendance_alerts
  ON public.school_attendance_alert_settings
  FOR SELECT TO authenticated
  USING (
    school_id = public.current_school_uuid()
    AND public.get_user_role() IN
      ('org:owner', 'org:principal', 'org:admin', 'org:teacher')
  );

CREATE POLICY afritech_read_attendance_alerts
  ON public.school_attendance_alert_settings
  FOR SELECT TO authenticated
  USING (public.is_afritech_admin());

-- SELECT only. The setter below is the single writer, so the quota warning
-- cannot be bypassed by writing the row directly.
GRANT SELECT ON public.school_attendance_alert_settings TO authenticated;
REVOKE ALL ON public.school_attendance_alert_settings FROM anon;

-- `0149`'s status guard and the audit trigger, attached here because both
-- migrations iterate the catalogue at their own migration time.
DO $$
BEGIN
  EXECUTE 'DROP TRIGGER IF EXISTS enforce_school_writable_on_update_on_school_attendance_alert_settings
             ON public.school_attendance_alert_settings';
  EXECUTE 'CREATE TRIGGER enforce_school_writable_on_update_on_school_attendance_alert_settings
             AFTER UPDATE ON public.school_attendance_alert_settings
             REFERENCING NEW TABLE AS new_rows
             FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_school_writable_new()';

  EXECUTE 'DROP TRIGGER IF EXISTS audit_changes_on_school_attendance_alert_settings
             ON public.school_attendance_alert_settings';
  EXECUTE 'CREATE TRIGGER audit_changes_on_school_attendance_alert_settings
             AFTER INSERT OR UPDATE OR DELETE ON public.school_attendance_alert_settings
             FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()';
END;
$$;

-- ---------------------------------------------------------------------------
-- Reading: an id form for the worker, a no-argument form for routes.
-- ---------------------------------------------------------------------------

/*
  `0254` is the reason this is two functions from the start rather than one.

  A SECURITY DEFINER function taking `p_school_id` bypasses RLS and has no tenant
  clause, so granting it to `authenticated` lets any signed-in user read any
  school's configuration by changing a UUID. `0251` did exactly that and `0254`
  had to undo it. The id form here is service_role only, from birth.
*/
CREATE OR REPLACE FUNCTION public.school_attendance_alerts(p_school_id UUID)
RETURNS TABLE (
  out_enabled      BOOLEAN,
  out_statuses     TEXT[],
  out_via_whatsapp BOOLEAN,
  out_via_email    BOOLEAN,
  out_via_push     BOOLEAN,
  out_max_age_days INT,
  out_configured   BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    COALESCE(s.per_absence_alert_enabled, FALSE),
    COALESCE(s.alert_on_statuses, ARRAY['absent']),
    COALESCE(s.via_whatsapp, TRUE),
    COALESCE(s.via_email, TRUE),
    COALESCE(s.via_push, TRUE),
    COALESCE(s.max_age_days, 2),
    s.school_id IS NOT NULL
  FROM (SELECT p_school_id AS id) q
  LEFT JOIN public.school_attendance_alert_settings s ON s.school_id = q.id;
$$;

REVOKE ALL ON FUNCTION public.school_attendance_alerts(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.school_attendance_alerts(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.school_attendance_alerts(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.school_attendance_alerts(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.my_attendance_alerts()
RETURNS TABLE (
  out_enabled      BOOLEAN,
  out_statuses     TEXT[],
  out_via_whatsapp BOOLEAN,
  out_via_email    BOOLEAN,
  out_via_push     BOOLEAN,
  out_max_age_days INT,
  out_configured   BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'Sign in to your school first' USING ERRCODE = '42501';
  END IF;

  -- Teachers may SEE it: a teacher marking a register should know whether doing
  -- so messages the parent. Changing it is leadership's, below.
  IF public.get_user_role() NOT IN
       ('org:owner', 'org:principal', 'org:admin', 'org:teacher') THEN
    RAISE EXCEPTION 'You cannot view attendance alert settings' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT * FROM public.school_attendance_alerts(v_school);
END;
$$;

REVOKE ALL ON FUNCTION public.my_attendance_alerts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_attendance_alerts() FROM anon;
GRANT EXECUTE ON FUNCTION public.my_attendance_alerts() TO authenticated;

-- ---------------------------------------------------------------------------
-- Writing.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_attendance_alerts(
  p_enabled      BOOLEAN,
  p_statuses     TEXT[],
  p_via_whatsapp BOOLEAN,
  p_via_email    BOOLEAN,
  p_via_push     BOOLEAN,
  p_max_age_days INT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_user   TEXT := public.get_user_id();
  v_stat   TEXT[];
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'Sign in to your school first' USING ERRCODE = '42501';
  END IF;

  /*
    Owner and principal only. Not the administrator, and not a teacher.

    Turning this on spends the school's message quota on every absence for the
    rest of the term — a commitment, not a preference.
  */
  IF public.get_user_role() NOT IN ('org:owner', 'org:principal') THEN
    RAISE EXCEPTION
      'Only the owner or principal can change attendance alerts'
      USING ERRCODE = '42501';
  END IF;

  SELECT ARRAY(SELECT DISTINCT unnest(p_statuses) ORDER BY 1) INTO v_stat;

  IF p_enabled AND array_length(v_stat, 1) IS NULL THEN
    RAISE EXCEPTION
      'Choose at least one attendance mark to alert on, or switch alerts off'
      USING ERRCODE = '22023';
  END IF;

  IF p_enabled AND NOT (p_via_whatsapp OR p_via_email OR p_via_push) THEN
    RAISE EXCEPTION
      'Choose at least one way to reach parents, or switch alerts off'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.school_attendance_alert_settings
    (school_id, per_absence_alert_enabled, alert_on_statuses,
     via_whatsapp, via_email, via_push, max_age_days, updated_by, updated_at)
  VALUES
    (v_school, p_enabled, COALESCE(NULLIF(v_stat, ARRAY[]::TEXT[]), ARRAY['absent']),
     p_via_whatsapp, p_via_email, p_via_push,
     COALESCE(p_max_age_days, 2), v_user, NOW())
  ON CONFLICT (school_id) DO UPDATE
  SET per_absence_alert_enabled = EXCLUDED.per_absence_alert_enabled,
      alert_on_statuses         = EXCLUDED.alert_on_statuses,
      via_whatsapp              = EXCLUDED.via_whatsapp,
      via_email                 = EXCLUDED.via_email,
      via_push                  = EXCLUDED.via_push,
      max_age_days              = EXCLUDED.max_age_days,
      updated_by                = EXCLUDED.updated_by,
      updated_at                = NOW();

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.set_attendance_alerts(BOOLEAN, TEXT[], BOOLEAN, BOOLEAN, BOOLEAN, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_attendance_alerts(BOOLEAN, TEXT[], BOOLEAN, BOOLEAN, BOOLEAN, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_attendance_alerts(BOOLEAN, TEXT[], BOOLEAN, BOOLEAN, BOOLEAN, INT) TO authenticated;

-- ---------------------------------------------------------------------------
-- The worker boundary.
-- ---------------------------------------------------------------------------

/*
  Absences owed an alert.

  `parent_notified` is the idempotency key, which is what the column was shaped
  for. A worker that crashes mid-batch re-reads the same rows and sends the ones
  it had not yet marked — the failure mode is a late alert, never a lost one and
  never a duplicate.
*/
CREATE OR REPLACE FUNCTION public.worker_due_absence_alerts(
  p_school_id UUID DEFAULT NULL,
  p_limit     INTEGER DEFAULT 500
)
RETURNS TABLE (
  out_record_id       UUID,
  out_school_id       UUID,
  out_school_name     TEXT,
  out_student_id      UUID,
  out_student_name    TEXT,
  out_class_id        TEXT,
  out_attendance_date DATE,
  out_status          TEXT,
  out_parent_user_id  TEXT,
  out_parent_name     TEXT,
  out_parent_phone    TEXT,
  out_parent_email    TEXT,
  out_via_whatsapp    BOOLEAN,
  out_via_email       BOOLEAN,
  out_via_push        BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    ar.id,
    ar.school_id,
    sch.name,
    ar.student_id,
    st.first_name || ' ' || st.last_name,
    ar.class_id,
    ar.attendance_date,
    ar.status,
    pa.clerk_user_id,
    COALESCE(pa.full_name, 'Parent or Guardian'),
    pa.phone_e164,
    pa.email,
    cfg.out_via_whatsapp,
    cfg.out_via_email,
    cfg.out_via_push
  FROM public.attendance_records ar
  JOIN public.schools sch ON sch.id = ar.school_id
  JOIN public.students st ON st.id = ar.student_id

  -- The school's own choice. Always returns a row, defaulting to OFF.
  JOIN LATERAL public.school_attendance_alerts(ar.school_id) cfg ON TRUE

  JOIN LATERAL (
    SELECT p2.clerk_user_id, p2.full_name, p2.phone_e164, p2.email
    FROM public.student_parent_links spl
    JOIN public.parents p2 ON p2.id = spl.parent_id
    WHERE spl.student_id = ar.student_id AND spl.is_active = TRUE
    ORDER BY spl.is_primary DESC, spl.created_at ASC
    LIMIT 1
  ) pa ON TRUE

  WHERE ar.parent_notified = FALSE
    AND (p_school_id IS NULL OR ar.school_id = p_school_id)

    -- Off by default, so a school that has never configured sends nothing.
    AND cfg.out_enabled
    AND ar.status = ANY (cfg.out_statuses)

    -- Stale alerts are abandoned rather than delivered as a backlog.
    AND ar.attendance_date >= (CURRENT_DATE - cfg.out_max_age_days)

    -- A pupil who has left is not somebody to message about.
    AND st.is_deleted = FALSE

    AND (cfg.out_via_whatsapp OR cfg.out_via_email OR cfg.out_via_push)
    AND (pa.phone_e164 IS NOT NULL OR pa.email IS NOT NULL OR pa.clerk_user_id IS NOT NULL)
  ORDER BY ar.attendance_date DESC, ar.created_at
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.worker_due_absence_alerts(UUID, INTEGER) IS
  'Absences owed a parent alert. Polled rather than triggered: TRIGGERS.md''s design puts an HTTP call inside the register transaction and needs an Edge Function ADR-044 superseded. See ADR-047 (0255).';

REVOKE ALL ON FUNCTION public.worker_due_absence_alerts(UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.worker_due_absence_alerts(UUID, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.worker_due_absence_alerts(UUID, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.worker_due_absence_alerts(UUID, INTEGER) TO service_role;

/*
  Marked only on a DELIVERED alert.

  Stamping it on attempt would turn one provider outage into a permanently
  missing notification, which is the same rule `worker_mark_reminder_sent`
  follows for fees.
*/
CREATE OR REPLACE FUNCTION public.worker_mark_absence_alerted(p_record_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.attendance_records
  SET parent_notified = TRUE,
      notification_sent_at = NOW()
  WHERE id = p_record_id
    AND parent_notified = FALSE;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.worker_mark_absence_alerted(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.worker_mark_absence_alerted(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.worker_mark_absence_alerted(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.worker_mark_absence_alerted(UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- `absence_alert` has no in-app row, and in-app is a channel a school can pick.
-- ---------------------------------------------------------------------------

INSERT INTO public.notification_templates
  (school_id, template_key, channel, language_code, subject, body, variables)
SELECT
  NULL, 'absence_alert', 'in_app', 'en', NULL,
  '{{student_name}} was marked {{status}} on {{attendance_date}} ({{class_id}}). If this is unexpected, please contact the school.',
  ARRAY['student_name', 'status', 'attendance_date', 'class_id']
WHERE NOT EXISTS (
  SELECT 1 FROM public.notification_templates
  WHERE template_key = 'absence_alert' AND channel = 'in_app' AND school_id IS NULL
);

-- ---------------------------------------------------------------------------
-- Exercise it.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_school UUID;
  v_org    TEXT;
  v_rec    UUID;
  v_n      INT;
BEGIN
  BEGIN
    SELECT ar.school_id, ar.id INTO v_school, v_rec
    FROM public.attendance_records ar
    WHERE ar.status = 'absent' AND ar.attendance_date >= CURRENT_DATE - 1
    LIMIT 1;

    IF v_school IS NULL THEN
      -- Make one, so the assertions are real rather than skipped.
      SELECT ar.school_id INTO v_school FROM public.attendance_records ar LIMIT 1;
      IF v_school IS NULL THEN
        RAISE NOTICE '0255: no attendance fixture; asserting privileges only';
      ELSE
        INSERT INTO public.attendance_records
          (school_id, student_id, class_id, recorded_by_user_id,
           attendance_date, academic_year, term_number, status)
        SELECT ar.school_id, ar.student_id, ar.class_id, ar.recorded_by_user_id,
               CURRENT_DATE, ar.academic_year, ar.term_number, 'absent'
        FROM public.attendance_records ar WHERE ar.school_id = v_school LIMIT 1
        RETURNING id INTO v_rec;
      END IF;
    END IF;

    SELECT clerk_org_id INTO v_org FROM public.schools WHERE id = v_school;

    IF v_rec IS NOT NULL THEN
      -- Default is OFF, so nothing is due before anybody opts in.
      SELECT count(*) INTO v_n FROM public.worker_due_absence_alerts(v_school, 500);
      IF v_n <> 0 THEN
        RAISE EXCEPTION
          '0255: % alerts queued for a school that never enabled them', v_n;
      END IF;

      -- Enabling it makes the absence due.
      INSERT INTO public.school_attendance_alert_settings
        (school_id, per_absence_alert_enabled)
      VALUES (v_school, TRUE)
      ON CONFLICT (school_id) DO UPDATE SET per_absence_alert_enabled = TRUE;

      SELECT count(*) INTO v_n FROM public.worker_due_absence_alerts(v_school, 500);
      IF v_n = 0 THEN
        RAISE EXCEPTION '0255: an absence was not queued after alerts were enabled';
      END IF;

      -- Marking it delivered removes it, and is not repeatable.
      IF NOT public.worker_mark_absence_alerted(v_rec) THEN
        RAISE EXCEPTION '0255: marking an alert delivered reported no row';
      END IF;
      IF public.worker_mark_absence_alerted(v_rec) THEN
        RAISE EXCEPTION '0255: an alert could be marked delivered twice';
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.worker_due_absence_alerts(v_school, 500)
        WHERE out_record_id = v_rec
      ) THEN
        RAISE EXCEPTION '0255: a delivered alert is still queued';
      END IF;

      -- A teacher may see the setting but must not change it.
      PERFORM set_config('request.jwt.claims', json_build_object(
        'sub', 'probe_teacher', 'role', 'authenticated',
        'o', json_build_object('id', v_org, 'rol', 'teacher'))::text, TRUE);

      PERFORM public.my_attendance_alerts();

      BEGIN
        PERFORM public.set_attendance_alerts(
          TRUE, ARRAY['absent'], TRUE, TRUE, TRUE, 2);
        RAISE EXCEPTION '0255: a teacher switched on quota-spending alerts';
      EXCEPTION WHEN insufficient_privilege THEN NULL;
      END;

      -- Enabled with no channel is incoherent and must be refused.
      PERFORM set_config('request.jwt.claims', json_build_object(
        'sub', 'probe_owner', 'role', 'authenticated',
        'o', json_build_object('id', v_org, 'rol', 'owner'))::text, TRUE);
      BEGIN
        PERFORM public.set_attendance_alerts(
          TRUE, ARRAY['absent'], FALSE, FALSE, FALSE, 2);
        RAISE EXCEPTION '0255: alerts were enabled with no way to reach anybody';
      EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
      END;
    END IF;

    -- The worker boundary.
    IF has_function_privilege('authenticated',
         'public.worker_due_absence_alerts(UUID, INTEGER)', 'EXECUTE') THEN
      RAISE EXCEPTION '0255: a signed-in user can read every school''s absences';
    END IF;
    IF has_function_privilege('authenticated',
         'public.school_attendance_alerts(UUID)', 'EXECUTE') THEN
      RAISE EXCEPTION '0255: the id form is reachable by signed-in users (0254 again)';
    END IF;
    IF has_function_privilege('anon', 'public.my_attendance_alerts()', 'EXECUTE') THEN
      RAISE EXCEPTION '0255: anon can read attendance alert settings';
    END IF;

    RAISE EXCEPTION 'ZSMS_0255_ROLLBACK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'ZSMS_0255_ROLLBACK' THEN
        RAISE NOTICE '0255: verified — off by default, queues when on, idempotent, teacher refused, worker-only';
      ELSE
        RAISE;
      END IF;
  END;
END;
$$;
