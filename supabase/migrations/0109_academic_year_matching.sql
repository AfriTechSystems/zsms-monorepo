-- Migration: 0109_academic_year_matching.sql
-- Created: 2026-09-26
-- Description: Teaching scope no longer requires an academic year written as a
--              bare calendar year. Fixes a live defect in which a school using
--              '2026/2027' locked every teacher out of marks AND attendance.
-- Related documents: Official Documentation/01 Foundation Layer/DECISIONS.md — ADR-037, ADR-040
--                    Official Documentation/01 Foundation Layer/RLS.md
--
-- ===========================================================================
-- THE DEFECT
--
--   AND ta.academic_year = EXTRACT(YEAR FROM NOW())::TEXT
--
-- `teacher_assignments.academic_year` is TEXT precisely so a school can write
-- its year the way it writes it. Zambian schools write both '2026' and
-- '2026/2027'. The predicate above matches only the first, so at a school using
-- the second form the comparison is '2026/2027' = '2026' — false for every
-- assignment, for every teacher, all year.
--
-- The consequence is not subtle: `teacher_teaches_subject()` returns FALSE, so
-- no teacher can enter a mark, and `teacher_reaches_class()` returns FALSE, so
-- no teacher can mark a register either. Both functions carried the same line.
-- The scope model (ADR-037) is correct; only the year comparison was wrong.
--
-- Found while writing the marks-entry pgTAP fixture — the assignment had to be
-- given a bare-year value for the suite to pass, which is the tell.
--
-- THE FIX, AND WHY IT IS A SUBSTRING TEST
--
-- An academic-year label is current when the current calendar year appears in
-- it. '2026' is current during 2026; '2026/2027' is current during 2026 *and*
-- 2027, which is exactly right for a year that straddles a boundary. So the test
-- is "does this label contain the current year", not string equality.
--
-- This deliberately does NOT parse the label into a start and end year. Parsing
-- would need a format contract the column does not have and ADR-040 has not yet
-- settled — and a parser that guesses wrong fails closed, which is how this
-- defect behaved in the first place. A containment test cannot lock anybody out
-- for writing their year differently.
--
-- The trade-off, stated rather than hidden: during 2026, an assignment labelled
-- '2025/2026' also counts as current. That is generous by about a term, and
-- generous in the direction of a teacher being able to do their job. The
-- narrower reading belongs with a real format decision under ADR-040.
-- ===========================================================================

-- === MIGRATION START ===

-- STABLE, not IMMUTABLE: it reads NOW(). Marking it IMMUTABLE would let the
-- planner fold the result into a cached plan and a school would cross into
-- January still being told last year's assignments are current.
CREATE OR REPLACE FUNCTION public.academic_year_is_current(p_academic_year TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT p_academic_year IS NOT NULL
     AND position(EXTRACT(YEAR FROM NOW())::TEXT IN p_academic_year) > 0;
$$;

COMMENT ON FUNCTION public.academic_year_is_current(TEXT) IS
  'TRUE when an academic-year label covers the current calendar year. Accepts '
  '''2026'' and ''2026/2027'' alike, because the column is TEXT by design and a '
  'school writes its year its own way. See migration 0109.';

/**
 * TRUE when two academic-year labels refer to the same year.
 *
 * Used where the caller knows which year it is operating on — saving marks for a
 * named term, for instance — so scope can be checked against that year rather
 * than against today. Equality first, then the containment fallback, so
 * '2026' and '2026/2027' agree.
 */
CREATE OR REPLACE FUNCTION public.academic_years_match(p_left TEXT, p_right TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT p_left IS NOT NULL AND p_right IS NOT NULL
     AND (
       p_left = p_right
       -- A bare year inside a straddling label, in either direction.
       OR position(p_left IN p_right) > 0
       OR position(p_right IN p_left) > 0
     );
$$;

-- ---------------------------------------------------------------------------
-- The two scope functions, corrected. Bodies are otherwise unchanged — ADR-037's
-- model was never the problem.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_reaches_class(p_class_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.teacher_assignments ta
    WHERE ta.teacher_user_id = public.get_user_id()
      AND ta.school_id       = public.current_school_uuid()
      AND ta.class_id        = p_class_id
      AND ta.is_active       = TRUE
      AND public.academic_year_is_current(ta.academic_year)
  );
$$;

COMMENT ON FUNCTION public.teacher_reaches_class(TEXT) IS
  'TRUE when the calling teacher holds any active assignment reaching this class, '
  'at either scope (ADR-037). Year matching per 0109.';

CREATE OR REPLACE FUNCTION public.teacher_teaches_subject(
  p_class_id TEXT,
  p_subject_code TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.teacher_assignments ta
    LEFT JOIN public.school_subjects ss ON ss.id = ta.subject_id
    WHERE ta.teacher_user_id = public.get_user_id()
      AND ta.school_id       = public.current_school_uuid()
      AND ta.class_id        = p_class_id
      AND ta.is_active       = TRUE
      AND public.academic_year_is_current(ta.academic_year)
      AND (
        ta.scope = 'class'
        OR (ta.scope = 'subject' AND ss.subject_code = p_subject_code)
      )
  );
$$;

COMMENT ON FUNCTION public.teacher_teaches_subject(TEXT, TEXT) IS
  'ADR-037 narrowed to one subject: a scope=class teacher owns every subject in '
  'the class, a scope=subject teacher only their own. Year matching per 0109.';

/**
 * The same check against an explicit academic year.
 *
 * `save_exam_marks()` knows which year it is writing and should be checked
 * against that, not against the wall clock — otherwise entering a correction to
 * last year's term in January fails for a reason nobody could guess.
 */
CREATE OR REPLACE FUNCTION public.teacher_teaches_subject_in_year(
  p_class_id      TEXT,
  p_subject_code  TEXT,
  p_academic_year TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.teacher_assignments ta
    LEFT JOIN public.school_subjects ss ON ss.id = ta.subject_id
    WHERE ta.teacher_user_id = public.get_user_id()
      AND ta.school_id       = public.current_school_uuid()
      AND ta.class_id        = p_class_id
      AND ta.is_active       = TRUE
      AND public.academic_years_match(ta.academic_year, p_academic_year)
      AND (
        ta.scope = 'class'
        OR (ta.scope = 'subject' AND ss.subject_code = p_subject_code)
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.academic_year_is_current(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.academic_years_match(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_teaches_subject_in_year(TEXT, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Point mark entry at the year-aware check.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_exam_marks(
  p_class_id      TEXT,
  p_subject_code  TEXT,
  p_subject_name  TEXT,
  p_academic_year TEXT,
  p_term_number   INT,
  p_marks_total   NUMERIC,
  p_marks         JSONB
)
RETURNS TABLE (saved_count INT, graded_count INT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school  UUID := public.current_school_uuid();
  v_role    TEXT := public.get_user_role();
  v_version UUID;
  v_saved   INT  := 0;
  v_graded  INT  := 0;
  v_mark    JSONB;
  v_letter  TEXT;
  v_points  INT;
  v_obtained NUMERIC;
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'No school in session.' USING ERRCODE = '42501';
  END IF;

  IF p_marks_total IS NULL OR p_marks_total <= 0 THEN
    RAISE EXCEPTION 'The paper total must be greater than zero.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Checked against the year being written, not the wall clock (0109).
  IF v_role = 'org:teacher'
     AND NOT public.teacher_teaches_subject_in_year(
       p_class_id, p_subject_code, p_academic_year) THEN
    RAISE EXCEPTION
      'You are not assigned to teach % to % in %. Ask the principal to assign you before entering marks.',
      p_subject_code, p_class_id, p_academic_year
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.exam_results
    WHERE school_id     = v_school
      AND class_id      = p_class_id
      AND subject_code  = p_subject_code
      AND academic_year = p_academic_year
      AND term_number   = p_term_number
      AND results_published
  ) THEN
    RAISE EXCEPTION
      'These results are published and can no longer be edited. A correction '
      'after publication has to be made deliberately, not by re-saving the sheet.'
      USING ERRCODE = '42501';
  END IF;

  v_version := public.current_subject_scale_version(v_school, p_subject_code);

  FOR v_mark IN SELECT * FROM jsonb_array_elements(p_marks)
  LOOP
    v_obtained := NULLIF(v_mark->>'marks_obtained', '')::NUMERIC;
    v_letter := NULL;
    v_points := NULL;

    IF v_version IS NOT NULL AND v_obtained IS NOT NULL THEN
      SELECT g.grade_letter, g.grade_points
        INTO v_letter, v_points
      FROM public.grade_from_scale_version(v_version, v_obtained, p_marks_total) g;
    END IF;

    INSERT INTO public.exam_results
      (school_id, student_id, class_id, academic_year, term_number, subject_code,
       subject_name, entered_by_user_id, marks_obtained, marks_total,
       grade_letter, grade_points, comments,
       grading_scale_version_id, results_published)
    VALUES
      (v_school, (v_mark->>'student_id')::UUID, p_class_id, p_academic_year,
       p_term_number, p_subject_code, p_subject_name,
       COALESCE(current_setting('request.jwt.claims', true)::JSONB->>'sub', 'unknown'),
       v_obtained, p_marks_total, v_letter, v_points,
       NULLIF(btrim(COALESCE(v_mark->>'comments', '')), ''),
       CASE WHEN v_letter IS NOT NULL THEN v_version ELSE NULL END, FALSE)
    ON CONFLICT (school_id, student_id, academic_year, term_number, subject_code)
    DO UPDATE SET
      marks_obtained           = EXCLUDED.marks_obtained,
      marks_total              = EXCLUDED.marks_total,
      grade_letter             = EXCLUDED.grade_letter,
      grade_points             = EXCLUDED.grade_points,
      comments                 = EXCLUDED.comments,
      grading_scale_version_id = EXCLUDED.grading_scale_version_id,
      class_id                 = EXCLUDED.class_id,
      subject_name             = EXCLUDED.subject_name,
      entered_by_user_id       = EXCLUDED.entered_by_user_id,
      updated_at               = NOW();

    v_saved := v_saved + 1;
    IF v_letter IS NOT NULL THEN
      v_graded := v_graded + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_saved, v_graded;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_exam_marks(TEXT, TEXT, TEXT, TEXT, INT, NUMERIC, JSONB) TO authenticated;

-- === MIGRATION END ===
