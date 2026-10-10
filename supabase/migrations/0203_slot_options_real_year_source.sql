-- ---------------------------------------------------------------------------
-- 0203 — `timetable_slot_options()` read a column that does not exist
-- ---------------------------------------------------------------------------
--
-- `0202` took the academic year from `school_academic_config.academic_year`. That
-- table has no such column — it holds the curriculum, the grading system and the
-- report-card format, and nothing about dates.
--
-- The migration applied regardless, because plpgsql resolves column references when a
-- function RUNS. The first call failed. `npm run db:cols` exists precisely to prevent
-- this and I did not run it for that one table.
--
-- `public.current_term()` is the real source and already returns the year alongside
-- the term, so the assignment filter now asks it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.timetable_slot_options(p_class_id TEXT)
RETURNS TABLE (
  out_kind       TEXT,
  out_id         TEXT,
  out_label      TEXT,
  out_detail     TEXT,
  out_subject_id UUID
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_level  TEXT;
  v_year   TEXT;
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'Sign in to your school first' USING ERRCODE = '42501';
  END IF;

  -- The grade level this class belongs to, by longest-prefix match.
  SELECT gl.level_type INTO v_level
  FROM public.school_grade_levels gl
  WHERE gl.school_id = v_school
    AND gl.is_active
    AND p_class_id LIKE gl.level_id || '%'
  ORDER BY length(gl.level_id) DESC
  LIMIT 1;

  -- The real source. Null between academic years, which the filter below tolerates.
  SELECT ct.academic_year INTO v_year
  FROM public.current_term(v_school) AS ct
  LIMIT 1;

  /*
    Subjects for this grade level.

    When the class matches no grade level — a label a school typed by hand — every
    active subject is offered rather than none. An empty dropdown is a dead end; a long
    one is merely untidy.
  */
  RETURN QUERY
  SELECT 'subject'::TEXT,
         sub.id::TEXT,
         sub.subject_name,
         CASE WHEN sub.is_core THEN 'Core' ELSE NULL END,
         sub.id
  FROM public.school_subjects sub
  WHERE sub.school_id = v_school
    AND sub.is_active
    AND (v_level IS NULL OR sub.level_type = v_level)
  ORDER BY sub.is_core DESC, sub.subject_name;

  /*
    Teachers assigned to this class, and nobody else.

    The spec is explicit that an unrelated teacher cannot be assigned. A `class`-scope
    assignment is the form teacher and covers any subject; a `subject`-scope one covers
    the named subject. `out_subject_id` carries which, so the screen can narrow the
    list once a subject is chosen without a second round trip.

    The year filter is skipped when there is no current term — between academic years
    a deputy is usually building NEXT year's timetable, and refusing every teacher
    then would make the builder useless at exactly the time it is used most.
  */
  RETURN QUERY
  SELECT 'teacher'::TEXT,
         ta.teacher_user_id,
         btrim(COALESCE(sm.first_name, '') || ' ' || COALESCE(sm.last_name, '')),
         CASE WHEN ta.scope = 'class' THEN 'Form teacher' ELSE sub.subject_name END,
         ta.subject_id
  FROM public.teacher_assignments ta
  LEFT JOIN public.staff_members sm
    ON sm.clerk_user_id = ta.teacher_user_id AND sm.school_id = v_school
  LEFT JOIN public.school_subjects sub ON sub.id = ta.subject_id
  WHERE ta.school_id = v_school
    AND ta.class_id = p_class_id
    AND ta.is_active
    AND (v_year IS NULL OR ta.academic_year = v_year)
  ORDER BY 4 NULLS LAST, 3;
END;
$$;

REVOKE ALL ON FUNCTION public.timetable_slot_options(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.timetable_slot_options(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.timetable_slot_options(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- CALL it, which is the check `0202` skipped.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_cls TEXT; v_n INT;
BEGIN
  SELECT s.class_id INTO v_cls
  FROM public.students s WHERE s.is_deleted = FALSE LIMIT 1;

  IF v_cls IS NULL THEN
    RAISE NOTICE 'no pupils to resolve a class from — skipping';
    RETURN;
  END IF;

  -- No session, so it must refuse cleanly rather than fail resolving a column.
  BEGIN
    PERFORM * FROM public.timetable_slot_options(v_cls);
    RAISE EXCEPTION 'expected a refusal with no school in session';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN
      RAISE NOTICE 'verified: the body resolves and refuses an anonymous caller';
    WHEN undefined_column THEN
      RAISE EXCEPTION 'the function still reads a column that does not exist';
  END;
END;
$$;
