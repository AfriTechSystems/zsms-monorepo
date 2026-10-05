-- ---------------------------------------------------------------------------
-- 0204 — the subject filter could never match, because the two vocabularies differ
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/08 Staff Management/TIMETABLE.md`
--       → "Subject: dropdown — school's configured subjects for this grade level"
--
-- `0202`/`0203` filtered subjects by `school_subjects.level_type = school_grade_levels.level_type`.
-- The column name is the same and the VALUE SETS are not:
--
--   `school_grade_levels.level_type`  primary · junior_secondary · senior_secondary · a_level
--   `school_subjects.level_type`      primary · secondary · a_level
--
-- So a junior-secondary class matched no subject at all, and the dropdown was empty —
-- which on a seeded school is every secondary class. Found by running the function
-- against real data rather than by reading it.
--
-- Mapped rather than "fixed" in either table. Both vocabularies are correct for what
-- they describe: a school really does distinguish junior from senior secondary for
-- GRADES, and really does not for SUBJECTS — Mathematics is one subject across both.
-- Changing either would be a migration against live data to serve a dropdown.
--
-- **And the list is never empty.** If the mapped filter still finds nothing — a class
-- label a school typed by hand, a subject set that does not cover a level — every
-- active subject is offered. An empty dropdown is a dead end a deputy cannot act on;
-- a long one is merely untidy.
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
  v_school  UUID := public.current_school_uuid();
  v_grade   TEXT;
  v_subject TEXT;
  v_year    TEXT;
  v_count   INT;
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'Sign in to your school first' USING ERRCODE = '42501';
  END IF;

  -- The grade level this class belongs to, by longest-prefix match. `class_id` is a
  -- TEXT label like `grade_8a` and there is no classes table to join.
  SELECT gl.level_type INTO v_grade
  FROM public.school_grade_levels gl
  WHERE gl.school_id = v_school
    AND gl.is_active
    AND p_class_id LIKE gl.level_id || '%'
  ORDER BY length(gl.level_id) DESC
  LIMIT 1;

  -- Across the gap between the two vocabularies.
  v_subject := CASE v_grade
    WHEN 'primary' THEN 'primary'
    WHEN 'junior_secondary' THEN 'secondary'
    WHEN 'senior_secondary' THEN 'secondary'
    WHEN 'a_level' THEN 'a_level'
    ELSE NULL
  END;

  -- Would the scoped filter find anything? If not, do not apply it.
  IF v_subject IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count
    FROM public.school_subjects sub
    WHERE sub.school_id = v_school AND sub.is_active AND sub.level_type = v_subject;

    IF v_count = 0 THEN
      v_subject := NULL;
    END IF;
  END IF;

  SELECT ct.academic_year INTO v_year
  FROM public.current_term(v_school) AS ct
  LIMIT 1;

  RETURN QUERY
  SELECT 'subject'::TEXT,
         sub.id::TEXT,
         sub.subject_name,
         CASE WHEN sub.is_core THEN 'Core' ELSE NULL END,
         sub.id
  FROM public.school_subjects sub
  WHERE sub.school_id = v_school
    AND sub.is_active
    AND (v_subject IS NULL OR sub.level_type = v_subject)
  ORDER BY sub.is_core DESC, sub.subject_name;

  /*
    Teachers assigned to this class, and nobody else — the spec is explicit that an
    unrelated teacher cannot be assigned. A `class`-scope assignment is the form
    teacher and covers any subject; a `subject`-scope one covers the named subject.

    The year filter is skipped when there is no current term: between academic years a
    deputy is usually building NEXT year's grid, and refusing every teacher then would
    make the builder useless at exactly the time it is used most.
  */
  RETURN QUERY
  SELECT 'teacher'::TEXT,
         ta.teacher_user_id,
         NULLIF(btrim(COALESCE(sm.first_name, '') || ' ' || COALESCE(sm.last_name, '')), ''),
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
-- Prove a secondary class now gets subjects.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_org TEXT; v_cls TEXT; v_n INT;
BEGIN
  SELECT sc.clerk_org_id INTO v_org
  FROM public.schools sc
  JOIN public.school_subjects sub ON sub.school_id = sc.id AND sub.is_active
  WHERE sc.clerk_org_id IS NOT NULL
  GROUP BY sc.clerk_org_id
  ORDER BY COUNT(*) DESC
  LIMIT 1;

  IF v_org IS NULL THEN
    RAISE NOTICE 'no school with subjects — skipping';
    RETURN;
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', 'verify_0204', 'role', 'authenticated',
      'o', json_build_object('id', v_org, 'rol', 'principal'))::text, TRUE);

  SELECT out_class_id INTO v_cls FROM public.school_class_list() LIMIT 1;
  IF v_cls IS NULL THEN
    RAISE NOTICE 'no classes at that school — skipping';
    PERFORM set_config('request.jwt.claims', NULL, TRUE);
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_n
  FROM public.timetable_slot_options(v_cls) WHERE out_kind = 'subject';

  IF v_n = 0 THEN
    RAISE EXCEPTION 'the subject dropdown is still empty for class %', v_cls;
  END IF;

  RAISE NOTICE 'verified: % subjects offered for %', v_n, v_cls;
  PERFORM set_config('request.jwt.claims', NULL, TRUE);
END;
$$;
