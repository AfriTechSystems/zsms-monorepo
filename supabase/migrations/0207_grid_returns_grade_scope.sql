-- ---------------------------------------------------------------------------
-- 0207 — the grid did not report which grades a period belongs to
-- ---------------------------------------------------------------------------
--
-- `0206` added `timetable_periods.applies_to_levels` and used it to FILTER the grid,
-- but `school_timetable()` never returned it. So the setup panel — which lists the
-- periods and lets somebody scope one to particular grades — had no way to show the
-- current scope, and every period would have rendered as though it applied everywhere.
--
-- A setting you can change and cannot see is worse than one you cannot change: it
-- reads as having had no effect.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.school_timetable(UUID, TEXT);

CREATE FUNCTION public.school_timetable(
  p_timetable_id UUID DEFAULT NULL,
  p_class_id     TEXT DEFAULT NULL
)
RETURNS TABLE (
  out_timetable_id    UUID,
  out_name            TEXT,
  out_academic_year   TEXT,
  out_term_number     INT,
  out_published       BOOLEAN,
  out_slot_id         UUID,
  out_class_id        TEXT,
  out_period_id       UUID,
  out_period_name     TEXT,
  out_start_time      TIME,
  out_end_time        TIME,
  out_period_order    INT,
  out_teaching        BOOLEAN,
  out_applies_days    INT[],
  out_applies_to_levels TEXT[],
  out_day_of_week     INT,
  out_subject_id      UUID,
  out_subject_name    TEXT,
  out_staff_user_id   TEXT,
  out_slot_type       TEXT,
  out_room            TEXT,
  out_notes           TEXT
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

  /*
    SECURITY INVOKER, deliberately: the policies on all three tables already say who
    sees a draft and who sees a published timetable, and a DEFINER function here would
    restate all of it and be the copy that drifts.

    Every period is returned joined to its slot or to nothing, because the grid needs
    the EMPTY cells as much as the full ones.
  */
  RETURN QUERY
  SELECT
    t.id, t.name, t.academic_year, t.term_number, t.published,
    s.id, s.class_id,
    p.id, p.period_name, p.start_time, p.end_time, p.period_order,
    p.is_teaching_period, p.applies_days, p.applies_to_levels,
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

REVOKE ALL ON FUNCTION public.school_timetable(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.school_timetable(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.school_timetable(UUID, TEXT) TO authenticated;

DO $$
DECLARE v_n INT;
BEGIN
  SELECT COUNT(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'school_timetable';

  IF v_n <> 1 THEN
    RAISE EXCEPTION '% overloads — PostgREST cannot choose between them', v_n;
  END IF;

  IF NOT (SELECT pg_get_function_result(p.oid) ILIKE '%applies_to_levels%'
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'school_timetable') THEN
    RAISE EXCEPTION 'the grid still does not report the grade scope';
  END IF;

  RAISE NOTICE 'verified: one overload, reporting applies_to_levels';
END;
$$;
