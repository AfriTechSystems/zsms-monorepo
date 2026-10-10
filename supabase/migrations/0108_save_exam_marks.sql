-- Migration: 0108_save_exam_marks.sql
-- Created: 2026-09-26
-- Description: Saves a sheet of marks, computing each grade and recording the
--              scale version that produced it in the same row. The write path
--              ADR-041 requires.
-- Related documents: Official Documentation/01 Foundation Layer/DECISIONS.md — ADR-041
--                    Official Documentation/11 Examinations and Results/
--
-- ===========================================================================
-- WHY THIS IS A FUNCTION AND NOT AN UPSERT FROM THE APPLICATION
--
-- 0106 made a grade explainable by storing the scale version beside it. That
-- only holds if the letter and the version are written *together*. An
-- application that computes a grade, then writes it, then writes the version, has
-- three chances to produce a row whose letter does not match its stated
-- explanation — and the row would look perfectly valid.
--
-- So grading happens here, over the version resolved here, in one statement.
-- The same argument as `verify_payment`: the decision and its provenance are
-- written atomically or not at all.
--
-- It also keeps the grade boundary in one place. A percentage computed in
-- TypeScript and a percentage computed in NUMERIC disagree about 79.995, and the
-- disagreement surfaces as a parent asking why the portal says B and the report
-- card says A.
--
-- A SUBJECT WITH NO SCALE STILL TAKES MARKS
--
-- If the subject has no grading scale, `v_version` is NULL, the grade columns
-- stay NULL, and the raw marks are saved anyway. Refusing the write would lose a
-- teacher's afternoon over a settings screen they probably cannot reach. The
-- return value reports graded separately from saved so the caller can say so
-- rather than implying every mark got a letter.
-- ===========================================================================

-- === MIGRATION START ===

-- A one-argument form that resolves the school from the session, so callers
-- never pass a school id they could get wrong. The two-argument form from 0106
-- stays for server-side use.
CREATE OR REPLACE FUNCTION public.current_subject_scale_version(p_subject_code TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT public.current_subject_scale_version(public.current_school_uuid(), p_subject_code);
$$;

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
-- SECURITY INVOKER: every write below is still filtered by the policies in
-- 0074. This function exists to make the grade and its version atomic, never to
-- widen who may write a mark.
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

  -- A teacher must teach this class and subject. RLS would refuse the write
  -- anyway, but silently — an upsert that matches no policy affects zero rows
  -- and returns success, so the teacher would see "0 saved" and no reason. The
  -- explicit check turns that into a sentence. Management is scoped by RLS to
  -- its own school and needs no subject check.
  IF v_role = 'org:teacher'
     AND NOT public.teacher_teaches_subject(p_class_id, p_subject_code) THEN
    RAISE EXCEPTION
      'You are not assigned to teach % to %. Ask the principal to assign you before entering marks.',
      p_subject_code, p_class_id
      USING ERRCODE = '42501';
  END IF;

  -- Publication is the lock. Refused here as a whole sheet rather than row by
  -- row, so a teacher is never left with half a sheet saved and half refused.
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

  -- The version in force right now. Resolved ONCE for the whole sheet, so a
  -- revision landing mid-save cannot grade the first half of a class under one
  -- scale and the second half under another.
  v_version := public.current_subject_scale_version(v_school, p_subject_code);

  FOR v_mark IN SELECT * FROM jsonb_array_elements(p_marks)
  LOOP
    -- NULL clears a mark and is not zero. `->>` yields SQL NULL for JSON null,
    -- which is what carries the distinction through.
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
       -- Only claim a version when a grade was actually produced under it. A
       -- version beside a NULL letter would assert an explanation for a grade
       -- that does not exist.
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

COMMENT ON FUNCTION public.save_exam_marks(TEXT, TEXT, TEXT, TEXT, INT, NUMERIC, JSONB) IS
  'Saves a sheet of marks, grading each one under the subject''s current scale '
  'version and recording that version in the same row (ADR-041). Refuses a '
  'published sheet, and a teacher not assigned to the class and subject.';

GRANT EXECUTE ON FUNCTION public.current_subject_scale_version(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_exam_marks(TEXT, TEXT, TEXT, TEXT, INT, NUMERIC, JSONB) TO authenticated;

-- === MIGRATION END ===
