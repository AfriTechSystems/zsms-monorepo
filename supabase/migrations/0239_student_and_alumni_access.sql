-- ===========================================================================
-- 0239 — students and alumni can finally reach their own records
--
-- Spec: `02 Authentication and Identity/AUTH.md` → Student and Alumni login flows,
--       `02 Authentication and Identity/ROLES.md` → `org:student`, `platform:alumni`,
--       `01 Foundation Layer/DECISIONS.md` → ADR-015
--
-- ## What was there
--
-- `org:student` is declared in `packages/auth-provider`, appears in a handful of
-- role lists, and **is named by not one policy**. `platform:alumni` is declared
-- and referenced nowhere at all. `students.clerk_user_id` exists and nothing
-- reads it.
--
-- So two of the six audiences ROLES.md describes could sign in and reach
-- precisely nothing.
--
-- ## One access model for both, and why
--
-- AUTH.md describes two login flows and two portals. The DATA is the same
-- question in both — *this person's own records* — and the only real difference
-- is that an alumnus has left.
--
-- Every policy below is therefore keyed on `students.clerk_user_id =
-- get_user_id()` and **says nothing about the organisation claim**. That single
-- decision does the work:
--
--   * a current student has `org:student` and matches;
--   * an alumnus has no organisation at all (SESSIONS.md: "School org session
--     revoked, platform:alumni session issued") and still matches, because the
--     link is the Clerk id on their pupil row rather than a membership.
--
-- It is the same shape the parent policies already use — `is_linked_parent_of()`
-- reads a link row and never an org claim — and it is what ADR-015 means by an
-- account that is not revoked. Two parallel policy sets would have to be kept
-- in step forever to express one idea.
--
-- ## What is deliberately NOT granted
--
-- Fees. ROLES.md gives a student "own results, timetable, and announcements",
-- and AUTH.md adds an attendance summary. Money is between the school and
-- whoever pays, and a child's portal is not the place to tell them their family
-- is in arrears.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Is this pupil row the caller's own.
-- ---------------------------------------------------------------------------

/*
  SECURITY DEFINER so the policies below can ask about `students` without
  recursing through the `students` policies that call this function.

  Note what it does NOT check: the organisation. That absence is the feature —
  it is what lets a graduated pupil keep reading their own history after their
  org membership is gone.
*/
CREATE OR REPLACE FUNCTION public.is_own_student_record(p_student_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.id = p_student_id
      AND s.clerk_user_id IS NOT NULL
      AND s.clerk_user_id = public.get_user_id()
      AND COALESCE(s.is_deleted, FALSE) = FALSE
  );
$$;

COMMENT ON FUNCTION public.is_own_student_record(UUID) IS
  'Is this pupil row the signed-in person themselves. Deliberately ignores the org claim, so it keeps answering TRUE after graduation — ADR-015 (0239).';

REVOKE ALL ON FUNCTION public.is_own_student_record(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_own_student_record(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_own_student_record(UUID) TO authenticated;

/*
  Has this person left. Drives what the portal shows, not what it permits.

  An alumnus sees the same records; the portal frames them as a historical record
  rather than as this term's work.
*/
CREATE OR REPLACE FUNCTION public.my_student_record()
RETURNS TABLE (
  out_student_id   UUID,
  out_display_id   TEXT,
  out_first_name   TEXT,
  out_last_name    TEXT,
  out_school_id    UUID,
  out_school_name  TEXT,
  out_grade_id     TEXT,
  out_class_id     TEXT,
  out_status       TEXT,
  out_is_alumnus   BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.id, s.student_id, s.first_name, s.last_name,
         s.school_id, sc.name, s.grade_id, s.class_id, s.status,
         s.status IN ('graduated', 'transferred', 'withdrawn')
  FROM public.students s
  JOIN public.schools sc ON sc.id = s.school_id
  WHERE s.clerk_user_id = public.get_user_id()
    AND COALESCE(s.is_deleted, FALSE) = FALSE
  ORDER BY s.created_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.my_student_record() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_student_record() FROM anon;
GRANT EXECUTE ON FUNCTION public.my_student_record() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Their own pupil row.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS student_read_own_record ON public.students;
CREATE POLICY student_read_own_record
  ON public.students
  FOR SELECT TO authenticated
  USING (
    clerk_user_id IS NOT NULL
    AND clerk_user_id = public.get_user_id()
    AND COALESCE(is_deleted, FALSE) = FALSE
  );

-- ---------------------------------------------------------------------------
-- 3. Results — published only, exactly as a parent sees them.
-- ---------------------------------------------------------------------------

/*
  `results_published = TRUE` matters as much here as for a parent, and for a
  sharper reason: a pupil reading an unmoderated mark before the school has
  released it is how a grade gets disputed before anybody has checked it.
*/
DROP POLICY IF EXISTS student_read_own_published_results ON public.exam_results;
CREATE POLICY student_read_own_published_results
  ON public.exam_results
  FOR SELECT TO authenticated
  USING (public.is_own_student_record(student_id) AND results_published = TRUE);

-- ---------------------------------------------------------------------------
-- 4. Attendance.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS student_read_own_attendance ON public.attendance_records;
CREATE POLICY student_read_own_attendance
  ON public.attendance_records
  FOR SELECT TO authenticated
  USING (public.is_own_student_record(student_id));

-- ---------------------------------------------------------------------------
-- 5. Timetable.
-- ---------------------------------------------------------------------------

/*
  A timetable is published to a class, not to a pupil, so the join is through
  the class rather than through `is_own_student_record()`.

  Only a published timetable. A draft is a work in progress, and a pupil turning
  up to a room that moved before the school announced it is the failure.

  `timetables.published` is a BOOLEAN, not a `status` column — checked with
  `db:cols` rather than assumed, which is the difference between this applying
  and failing on `column "status" does not exist`.
*/
DROP POLICY IF EXISTS student_read_own_timetable ON public.timetables;
CREATE POLICY student_read_own_timetable
  ON public.timetables
  FOR SELECT TO authenticated
  USING (
    published = TRUE
    AND EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.clerk_user_id = public.get_user_id()
        AND s.school_id = timetables.school_id
        AND COALESCE(s.is_deleted, FALSE) = FALSE
    )
  );

DROP POLICY IF EXISTS student_read_own_timetable_slots ON public.timetable_slots;
CREATE POLICY student_read_own_timetable_slots
  ON public.timetable_slots
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.timetables t
      JOIN public.students s ON s.school_id = t.school_id
      WHERE t.id = timetable_slots.timetable_id
        AND t.published = TRUE
        AND s.clerk_user_id = public.get_user_id()
        AND s.class_id = timetable_slots.class_id
        AND COALESCE(s.is_deleted, FALSE) = FALSE
    )
  );

DROP POLICY IF EXISTS student_read_timetable_periods ON public.timetable_periods;
CREATE POLICY student_read_timetable_periods
  ON public.timetable_periods
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.clerk_user_id = public.get_user_id()
        AND s.school_id = timetable_periods.school_id
        AND COALESCE(s.is_deleted, FALSE) = FALSE
    )
  );

-- ---------------------------------------------------------------------------
-- 6. Grants, which RLS does not imply.
-- ---------------------------------------------------------------------------

/*
  Every one of these tables already grants SELECT to `authenticated` for other
  audiences, so nothing new is needed — but the seven times this repository has
  shipped a policy with no grant make it worth asserting rather than assuming.
*/
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'students', 'exam_results', 'attendance_records',
    'timetables', 'timetable_slots', 'timetable_periods'
  ]
  LOOP
    IF NOT has_table_privilege('authenticated', 'public.' || t, 'SELECT') THEN
      EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
      RAISE NOTICE '0239: granted the missing SELECT on %', t;
    END IF;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Exercise it, as a current pupil and then as the same person graduated.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_student UUID;
  v_school  UUID;
  v_org     TEXT;
  v_before  INT;
  v_after   INT;
BEGIN
  BEGIN
    SELECT s.id, s.school_id, sc.clerk_org_id
      INTO v_student, v_school, v_org
    FROM public.students s
    JOIN public.schools sc ON sc.id = s.school_id
    WHERE COALESCE(s.is_deleted, FALSE) = FALSE
    LIMIT 1;

    IF v_student IS NULL THEN
      RAISE NOTICE '0239: no pupil fixture; skipping';
      RAISE EXCEPTION 'ZSMS_0239_ROLLBACK';
    END IF;

    -- Give them an account.
    UPDATE public.students SET clerk_user_id = 'user_probe_student'
    WHERE id = v_student;

    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', 'user_probe_student', 'role', 'authenticated',
      'o', json_build_object('id', v_org, 'rol', 'student'))::text, TRUE);

    IF NOT public.is_own_student_record(v_student) THEN
      RAISE EXCEPTION '0239: a pupil does not recognise their own record';
    END IF;

    SELECT COUNT(*) INTO v_before FROM public.my_student_record();
    IF v_before <> 1 THEN
      RAISE EXCEPTION '0239: my_student_record() returned % rows as a pupil', v_before;
    END IF;

    /*
      Graduate them AND drop the organisation claim, which is what SESSIONS.md
      describes happening: "School org session revoked, platform:alumni session
      issued". This is the whole point of keying on the Clerk id.
    */
    UPDATE public.students SET status = 'graduated' WHERE id = v_student;

    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', 'user_probe_student', 'role', 'authenticated')::text, TRUE);

    IF NOT public.is_own_student_record(v_student) THEN
      RAISE EXCEPTION
        '0239: an alumnus with no org claim lost access to their own record';
    END IF;

    SELECT COUNT(*) INTO v_after FROM public.my_student_record();
    IF v_after <> 1 THEN
      RAISE EXCEPTION '0239: my_student_record() returned % rows as an alumnus', v_after;
    END IF;

    IF NOT (SELECT out_is_alumnus FROM public.my_student_record()) THEN
      RAISE EXCEPTION '0239: a graduated pupil is not reported as an alumnus';
    END IF;

    -- And somebody else's id must reach nothing.
    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', 'user_a_stranger', 'role', 'authenticated')::text, TRUE);

    IF public.is_own_student_record(v_student) THEN
      RAISE EXCEPTION '0239: a stranger reads another pupil''s record';
    END IF;

    RAISE EXCEPTION 'ZSMS_0239_ROLLBACK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'ZSMS_0239_ROLLBACK' THEN
        RAISE NOTICE '0239: verified — a pupil reads their own record, keeps it after graduating with no org claim, and a stranger reads nothing';
      ELSE
        RAISE;
      END IF;
  END;
END;
$$;
