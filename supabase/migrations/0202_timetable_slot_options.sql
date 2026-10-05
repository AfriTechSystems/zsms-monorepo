-- ---------------------------------------------------------------------------
-- 0202 — the classes, subjects and teachers a timetable cell may actually hold
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/08 Staff Management/TIMETABLE.md`
--       → *Timetable Builder UI* → *Adding a new slot*
--
-- The builder's three dropdowns were wrong, and one of them could never work.
--
-- ## The class list was derived from slots that did not exist yet
--
-- A new timetable has no slots, so the list of classes was empty, so no cell could be
-- opened, so no slot could ever be created. A chicken-and-egg I shipped. The school's
-- classes come from its PUPILS — `students.class_id` — which exist long before any
-- timetable does.
--
-- ## The subject list ignored the grade level
--
-- The spec says "the school's configured subjects **for this grade level**". A Grade 2
-- class was being offered A-Level Biology. `school_subjects.level_type` is the scope,
-- and `school_grade_levels.level_type` is what a class resolves to.
--
-- ## The teacher list ignored assignments entirely
--
-- The spec is explicit: "Teacher dropdown only shows teachers with a matching
-- assignment — cannot assign an unrelated teacher." Every active member of staff was
-- being offered, including the bursar.
--
-- `teacher_assignments` has two scopes: `class` (a form teacher, any subject) and
-- `subject` (a subject teacher for one class). Both qualify, and the function says
-- which — a deputy choosing between two names wants to know that one of them is the
-- form teacher.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The school's classes, from its pupils.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.school_class_list()
RETURNS TABLE (out_class_id TEXT, out_pupils INT, out_level_id TEXT, out_level_name TEXT)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'Sign in to your school first' USING ERRCODE = '42501';
  END IF;

  /*
    `class_id` is a TEXT label like `grade_8a`, and the grade is its prefix — there is
    no classes table in this schema and no foreign key to follow. Matching the longest
    grade level that prefixes the class is how `0183` already derives a stream, so the
    same reading is used here rather than inventing a second one.
  */
  RETURN QUERY
  SELECT c.class_id,
         c.pupils::INT,
         g.level_id,
         g.display_name
  FROM (
    SELECT s.class_id, COUNT(*) AS pupils
    FROM public.students s
    WHERE s.school_id = v_school
      AND s.is_deleted = FALSE
      AND s.status IN ('active', 'on_leave')
    GROUP BY s.class_id
  ) AS c
  LEFT JOIN LATERAL (
    SELECT gl.level_id, gl.display_name, gl.level_type
    FROM public.school_grade_levels gl
    WHERE gl.school_id = v_school
      AND gl.is_active
      AND c.class_id LIKE gl.level_id || '%'
    ORDER BY length(gl.level_id) DESC
    LIMIT 1
  ) AS g ON TRUE
  ORDER BY c.class_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. What may go in one cell.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.timetable_slot_options(p_class_id TEXT)
RETURNS TABLE (
  out_kind         TEXT,
  out_id           TEXT,
  out_label        TEXT,
  out_detail       TEXT,
  out_subject_id   UUID
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

  SELECT academic_year INTO v_year
  FROM public.school_academic_config
  WHERE school_id = v_school;

  /*
    Subjects for this grade level.

    When the class matches no grade level — a label a school typed by hand — every
    active subject is offered rather than none. An empty dropdown is a dead end; a
    long one is merely untidy.
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

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_fn TEXT;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.school_class_list()',
    'public.timetable_slot_options(TEXT)'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', v_fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_fn);

    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon can execute %', v_fn;
    END IF;
  END LOOP;
END;
$$;
