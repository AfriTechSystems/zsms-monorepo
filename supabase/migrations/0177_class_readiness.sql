-- ---------------------------------------------------------------------------
-- 0177 — what is outstanding, by grade and by class
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/10 Attendance Management/ATTENDANCE.md`
--       `Official Documentation/11 Examinations and Results/RESULTS.md`
--       `Official Documentation/15 Super Admin and Platform/SCHOOL_HEALTH_SCORES.md`
--
-- ## The question nobody could ask
--
-- An owner opening the school portal could see a pupil, a class, a mark sheet —
-- one at a time, by choosing it. What they could not see is the thing they
-- actually open the portal for: **which classes are behind**. Finding out meant
-- opening the attendance register for each class in turn and looking.
--
-- So the drill-down had no top. `SCHOOL_HEALTH_SCORES.md` computes exactly these
-- signals for AfriTech's view of a school, and the school itself — the people who
-- can act on them — had no equivalent.
--
-- ## Two signals, chosen because they are the two that decay
--
--   * **registers not marked.** Attendance is marked daily or it is lost; a day
--     nobody recorded cannot be reconstructed a week later.
--   * **subjects with no marks.** A subject assigned to a class with nothing
--     entered is what blocks publication at the end of term, and the end of term
--     is when it is discovered.
--
-- Fees are deliberately not here. A class is not late on fees — a family is — and
-- putting arrears on a teaching screen would mix a pastoral view with a financial
-- one and put a pupil's family circumstances in front of people who do not need it.
--
-- ## Registers are counted against days the school ALREADY marked
--
-- The naive version counts school days in the term and subtracts. It is wrong
-- everywhere: public holidays, a day the school closed for a funeral, the fact
-- that term dates describe a range rather than a timetable.
--
-- So the denominator is the set of dates on which THIS SCHOOL marked a register
-- for ANY class. If a school marked attendance on 42 days and a class has 38 of
-- them, that class is 4 behind — measured against what the school itself did,
-- which needs no calendar and no holiday table and is right by construction.
-- A school that has never marked anything shows nothing outstanding, which is
-- correct: there is no evidence it should have.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.school_class_readiness(
  p_academic_year TEXT DEFAULT NULL,
  p_term_number   INT  DEFAULT NULL
)
RETURNS TABLE (
  out_grade_id            TEXT,
  out_class_id            TEXT,
  out_pupils              INT,
  out_register_days       INT,
  out_register_days_missing INT,
  out_subjects_assigned   INT,
  out_subjects_with_marks INT,
  out_marks_missing       INT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_year   TEXT;
  v_term   INT;
  v_days   INT;
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'Only a school can read its own class readiness' USING ERRCODE = '42501';
  END IF;

  -- Default to the term the school is actually in, so the screen is right without
  -- the caller having to know. `current_term()` already resolves it from the
  -- school's own term dates.
  SELECT COALESCE(p_academic_year, (SELECT ct.academic_year::TEXT FROM public.current_term() AS ct)),
         COALESCE(p_term_number,   (SELECT ct.term_number FROM public.current_term() AS ct))
    INTO v_year, v_term;

  -- Days this school marked a register at all. See the header: the denominator is
  -- what the school did, not what a calendar says it should have done.
  SELECT COUNT(DISTINCT a.attendance_date) INTO v_days
  FROM public.attendance_records AS a
  WHERE a.school_id = v_school
    AND a.academic_year = v_year
    AND a.term_number = v_term;

  RETURN QUERY
  WITH classes AS (
    -- Classes that currently hold a pupil. A class with nobody in it is not
    -- "behind"; it is empty, and listing it would bury the ones that matter.
    SELECT s.grade_id, s.class_id, COUNT(*)::INT AS pupils
    FROM public.students AS s
    WHERE s.school_id = v_school
      AND s.is_deleted = FALSE
      AND s.status IN ('active', 'on_leave')
      AND s.class_id IS NOT NULL
    GROUP BY s.grade_id, s.class_id
  ),
  marked AS (
    SELECT a.class_id, COUNT(DISTINCT a.attendance_date)::INT AS days
    FROM public.attendance_records AS a
    WHERE a.school_id = v_school
      AND a.academic_year = v_year
      AND a.term_number = v_term
    GROUP BY a.class_id
  ),
  assigned AS (
    SELECT t.class_id, COUNT(DISTINCT t.subject_id)::INT AS subjects
    FROM public.teacher_assignments AS t
    WHERE t.school_id = v_school
      AND t.academic_year = v_year
      AND t.term_number = v_term
      AND t.is_active
      AND t.class_id IS NOT NULL
    GROUP BY t.class_id
  ),
  entered AS (
    SELECT r.class_id, COUNT(DISTINCT r.subject_code)::INT AS subjects
    FROM public.exam_results AS r
    WHERE r.school_id = v_school
      AND r.academic_year = v_year
      AND r.term_number = v_term
      AND r.marks_obtained IS NOT NULL
    GROUP BY r.class_id
  )
  SELECT
    c.grade_id,
    c.class_id,
    c.pupils,
    COALESCE(m.days, 0),
    GREATEST(0, v_days - COALESCE(m.days, 0)),
    COALESCE(a.subjects, 0),
    COALESCE(e.subjects, 0),
    GREATEST(0, COALESCE(a.subjects, 0) - COALESCE(e.subjects, 0))
  FROM classes AS c
  LEFT JOIN marked   AS m ON m.class_id = c.class_id
  LEFT JOIN assigned AS a ON a.class_id = c.class_id
  LEFT JOIN entered  AS e ON e.class_id = c.class_id
  -- Worst first: the screen exists to surface what is behind, so what is behind
  -- goes at the top rather than in alphabetical order somewhere down the page.
  ORDER BY
    GREATEST(0, v_days - COALESCE(m.days, 0)) DESC,
    GREATEST(0, COALESCE(a.subjects, 0) - COALESCE(e.subjects, 0)) DESC,
    c.grade_id,
    c.class_id;
END;
$$;

REVOKE ALL ON FUNCTION public.school_class_readiness(TEXT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.school_class_readiness(TEXT, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.school_class_readiness(TEXT, INT) TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.school_class_readiness(TEXT, INT)', 'EXECUTE') THEN
    RAISE EXCEPTION 'school_class_readiness is executable by anon';
  END IF;
  IF NOT has_function_privilege(
       'authenticated', 'public.school_class_readiness(TEXT, INT)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot execute school_class_readiness';
  END IF;
END;
$$;
