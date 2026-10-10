-- ---------------------------------------------------------------------------
-- 0206 — classes in school order, and a school day that can differ by grade
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/08 Staff Management/TIMETABLE.md`
--       `Official Documentation/04 Country and Configuration/ZM.md`
--
-- Two things, both reported from use.
--
-- ## Classes were in alphabetical order, which is the wrong order
--
-- `school_class_list()` ordered by `class_id`, a TEXT column, so a school read
-- `grade_10a, grade_11a, grade_12a, grade_1a, grade_2a` — ten before two. Grades have
-- a `level_order` precisely so they can be put in school order, and the stream letter
-- sorts within the grade. Nothing else in the product should sort a class by its label.
--
-- ## A school day can differ by grade
--
-- `timetable_periods` was school-wide: one set of periods for everybody. Real Zambian
-- schools do not work that way — a primary day often ends two periods before a
-- secondary one, and lower primary may have a longer break.
--
-- `applies_to_levels` names the grade levels a period belongs to. **NULL means every
-- grade**, which is both the sensible default and what every existing row means today,
-- so nothing has to be backfilled and a school that never touches this sees no change.
--
-- That also answers "replicate the periods to selected grades": a period applying to
-- several grades is one row naming them, not a copy per grade. Copies drift — somebody
-- changes the lunch time for Grade 8 and the identical Grade 9 row is left behind.
-- ---------------------------------------------------------------------------

ALTER TABLE public.timetable_periods
  ADD COLUMN IF NOT EXISTS applies_to_levels TEXT[];

COMMENT ON COLUMN public.timetable_periods.applies_to_levels IS
  'Grade levels (school_grade_levels.level_id) this period belongs to. NULL means '
  'every grade, which is what every row created before 0206 means.';

-- ---------------------------------------------------------------------------
-- 1. Classes, in the order a school reads them.
-- ---------------------------------------------------------------------------
-- Dropped first: `CREATE OR REPLACE` cannot widen a function's return type, and this
-- adds the grade order and stream the ordering depends on.
DROP FUNCTION IF EXISTS public.school_class_list();

CREATE FUNCTION public.school_class_list()
RETURNS TABLE (
  out_class_id    TEXT,
  out_pupils      INT,
  out_level_id    TEXT,
  out_level_name  TEXT,
  out_level_order INT,
  out_stream      TEXT
)
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

  RETURN QUERY
  SELECT c.class_id,
         c.pupils::INT,
         g.level_id,
         g.display_name,
         g.level_order,
         -- What is left after the grade prefix: the stream letter, usually `a`/`b`.
         NULLIF(substring(c.class_id FROM length(COALESCE(g.level_id, '')) + 1), '')
  FROM (
    SELECT s.class_id, COUNT(*) AS pupils
    FROM public.students s
    WHERE s.school_id = v_school
      AND s.is_deleted = FALSE
      AND s.status IN ('active', 'on_leave')
    GROUP BY s.class_id
  ) AS c
  LEFT JOIN LATERAL (
    SELECT gl.level_id, gl.display_name, gl.level_order
    FROM public.school_grade_levels gl
    WHERE gl.school_id = v_school
      AND gl.is_active
      AND c.class_id LIKE gl.level_id || '%'
    ORDER BY length(gl.level_id) DESC
    LIMIT 1
  ) AS g ON TRUE
  /*
    Grade first, then stream.

    Ordering by `class_id` put Grade 10 before Grade 2, because it is TEXT. A class
    whose label matches no grade sorts last rather than first — it is an oddity, and
    oddities belong at the bottom of a list, not the top.
  */
  ORDER BY g.level_order NULLS LAST, c.class_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Periods that know which grades they belong to.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_timetable_period(
  p_period_id    UUID,
  p_name         TEXT,
  p_start_time   TIME,
  p_end_time     TIME,
  p_order        INT,
  p_applies_days INT[] DEFAULT ARRAY[1, 2, 3, 4, 5],
  p_teaching     BOOLEAN DEFAULT TRUE,
  p_levels       TEXT[] DEFAULT NULL
)
RETURNS TABLE (out_period_id UUID, out_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_id     UUID;
  v_levels TEXT[];
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'Sign in to your school first' USING ERRCODE = '42501';
  END IF;

  IF public.get_user_role() NOT IN ('org:owner', 'org:principal', 'org:admin') THEN
    RAISE EXCEPTION 'Only the owner, principal or administrator may set the school day'
      USING ERRCODE = '42501';
  END IF;

  IF p_end_time <= p_start_time THEN
    RAISE EXCEPTION 'A period must end after it starts' USING ERRCODE = '22023';
  END IF;

  IF p_applies_days IS NULL OR array_length(p_applies_days, 1) IS NULL THEN
    RAISE EXCEPTION 'A period must run on at least one day' USING ERRCODE = '22023';
  END IF;

  -- An empty array and NULL both mean "every grade". Normalised so a later read never
  -- has to tell the two apart.
  v_levels := CASE
    WHEN p_levels IS NULL OR array_length(p_levels, 1) IS NULL THEN NULL
    ELSE p_levels
  END;

  /*
    Every named level must be this school's.

    Without this a school could name another's `level_id` and the period would appear
    on a grade list it has no business knowing exists.
  */
  IF v_levels IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM unnest(v_levels) AS lv
      WHERE NOT EXISTS (
        SELECT 1 FROM public.school_grade_levels gl
        WHERE gl.school_id = v_school AND gl.level_id = lv
      )
    ) THEN
      RAISE EXCEPTION 'One of those grade levels is not yours' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_period_id IS NULL THEN
    INSERT INTO public.timetable_periods
      (school_id, period_name, start_time, end_time, period_order, applies_days,
       is_teaching_period, applies_to_levels)
    VALUES (v_school, btrim(p_name), p_start_time, p_end_time, p_order,
            p_applies_days, p_teaching, v_levels)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.timetable_periods
       SET period_name = btrim(p_name),
           start_time = p_start_time,
           end_time = p_end_time,
           period_order = p_order,
           applies_days = p_applies_days,
           is_teaching_period = p_teaching,
           applies_to_levels = v_levels,
           updated_at = NOW()
     WHERE id = p_period_id AND school_id = v_school
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'No such period' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY SELECT v_id, 'Saved.'::TEXT;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Another period already uses position %', p_order
      USING ERRCODE = '23505';
END;
$$;

DROP FUNCTION IF EXISTS public.set_timetable_period(UUID, TEXT, TIME, TIME, INT, INT[], BOOLEAN);

-- ---------------------------------------------------------------------------
-- 3. The grid, showing only the periods that class's grade uses.
-- ---------------------------------------------------------------------------
-- Same reason: `out_notes` is a new column on the result.
DROP FUNCTION IF EXISTS public.school_timetable(UUID);

CREATE OR REPLACE FUNCTION public.school_timetable(
  p_timetable_id UUID DEFAULT NULL,
  p_class_id     TEXT DEFAULT NULL
)
RETURNS TABLE (
  out_timetable_id  UUID,
  out_name          TEXT,
  out_academic_year TEXT,
  out_term_number   INT,
  out_published     BOOLEAN,
  out_slot_id       UUID,
  out_class_id      TEXT,
  out_period_id     UUID,
  out_period_name   TEXT,
  out_start_time    TIME,
  out_end_time      TIME,
  out_period_order  INT,
  out_teaching      BOOLEAN,
  out_applies_days  INT[],
  out_day_of_week   INT,
  out_subject_id    UUID,
  out_subject_name  TEXT,
  out_staff_user_id TEXT,
  out_slot_type     TEXT,
  out_room          TEXT,
  out_notes         TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_tt     UUID;
  v_level  TEXT;
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'Sign in to your school first' USING ERRCODE = '42501';
  END IF;

  v_tt := COALESCE(
    p_timetable_id,
    (SELECT t.id FROM public.timetables t
      WHERE t.school_id = v_school AND t.is_active
      ORDER BY t.created_at DESC LIMIT 1)
  );

  -- Which grade the chosen class belongs to, so periods can be filtered to it.
  IF p_class_id IS NOT NULL THEN
    SELECT gl.level_id INTO v_level
    FROM public.school_grade_levels gl
    WHERE gl.school_id = v_school
      AND gl.is_active
      AND p_class_id LIKE gl.level_id || '%'
    ORDER BY length(gl.level_id) DESC
    LIMIT 1;
  END IF;

  RETURN QUERY
  SELECT
    t.id, t.name, t.academic_year, t.term_number, t.published,
    s.id, s.class_id,
    p.id, p.period_name, p.start_time, p.end_time, p.period_order,
    p.is_teaching_period, p.applies_days,
    s.day_of_week, s.subject_id, sub.subject_name, s.staff_user_id,
    s.slot_type, s.room, s.notes
  FROM public.timetables t
  CROSS JOIN public.timetable_periods p
  LEFT JOIN public.timetable_slots s
    ON s.timetable_id = t.id AND s.period_id = p.id
  LEFT JOIN public.school_subjects sub ON sub.id = s.subject_id
  WHERE t.id = v_tt
    AND p.school_id = v_school
    -- NULL means every grade, so a school that never splits its day is unaffected.
    AND (p.applies_to_levels IS NULL
         OR v_level IS NULL
         OR v_level = ANY (p.applies_to_levels))
  ORDER BY p.period_order, s.class_id NULLS LAST, s.day_of_week;
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
    'public.school_timetable(UUID, TEXT)',
    'public.set_timetable_period(UUID, TEXT, TIME, TIME, INT, INT[], BOOLEAN, TEXT[])'
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

-- ---------------------------------------------------------------------------
-- Prove Grade 2 now sorts before Grade 10, and that exactly one overload remains.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org   TEXT;
  v_first TEXT;
  v_n     INT;
BEGIN
  FOREACH v_first IN ARRAY ARRAY['school_timetable', 'set_timetable_period']
  LOOP
    SELECT COUNT(*) INTO v_n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_first;

    IF v_n <> 1 THEN
      RAISE EXCEPTION
        '% overloads of % — PostgREST cannot choose between them', v_n, v_first;
    END IF;
  END LOOP;

  SELECT sc.clerk_org_id INTO v_org
  FROM public.schools sc
  JOIN public.students st ON st.school_id = sc.id AND st.is_deleted = FALSE
  WHERE sc.clerk_org_id IS NOT NULL
  GROUP BY sc.clerk_org_id
  ORDER BY COUNT(DISTINCT st.class_id) DESC
  LIMIT 1;

  IF v_org IS NULL THEN
    RAISE NOTICE 'no school with classes — skipping the ordering check';
    RETURN;
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', 'verify_0206', 'role', 'authenticated',
      'o', json_build_object('id', v_org, 'rol', 'principal'))::text, TRUE);

  /*
    The property is "the first class is in the LOWEST grade", not a pattern on its name.

    The first version pattern-matched the label and fired on `grade_1a`, which is the
    correct answer — `LIKE` has no character classes and `_` is a single-character
    wildcard, so `grade_1_%` matched it. The test was wrong, not the ordering.
  */
  SELECT out_level_order INTO v_n FROM public.school_class_list() LIMIT 1;

  IF v_n IS NOT NULL
     AND v_n > (SELECT MIN(out_level_order) FROM public.school_class_list()
                 WHERE out_level_order IS NOT NULL) THEN
    RAISE EXCEPTION 'classes are not in grade order — the first is at level %', v_n;
  END IF;

  SELECT out_class_id INTO v_first FROM public.school_class_list() LIMIT 1;

  RAISE NOTICE 'verified: one overload each, and the first class is %', v_first;
  PERFORM set_config('request.jwt.claims', NULL, TRUE);
END;
$$;
