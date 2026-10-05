-- ---------------------------------------------------------------------------
-- 0201 — a school can create its own timetable and set its own school day
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/08 Staff Management/TIMETABLE.md`
--
-- `0197` and `0200` built the grid and everything that edits it, and left no way to
-- create the timetable in the first place or to define the periods that are its rows.
-- The builder screen said "ask AfriTech, or add it from the database", which is the
-- failure this project keeps repeating: correct work that nobody can reach.
--
-- ## Periods are set once and reused
--
-- `timetable_periods` belongs to the SCHOOL, not to a timetable — the school day does
-- not change when next term's grid is drafted. So these are separate operations, and
-- changing a period changes every timetable at once, which is the intent.
--
-- ## Deleting a period is refused when lessons sit in it
--
-- Cascading would silently delete lessons across every timetable. A count and a
-- refusal lets somebody decide, which is the only honest option when the alternative
-- destroys work they cannot see from here.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_timetable(
  p_academic_year TEXT,
  p_term_number   INT,
  p_name          TEXT DEFAULT 'Main Timetable',
  p_make_active   BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (out_timetable_id UUID, out_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_user   TEXT := public.get_user_id();
  v_id     UUID;
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'Sign in to your school first' USING ERRCODE = '42501';
  END IF;

  IF public.get_user_role() NOT IN ('org:owner', 'org:principal', 'org:admin') THEN
    RAISE EXCEPTION 'Only the owner, principal or administrator may create a timetable'
      USING ERRCODE = '42501';
  END IF;

  /*
    One active timetable per school per term, enforced by a partial unique index.

    Standing the new one down rather than failing: a school creating a second timetable
    for a term almost always means "use this one now", and refusing would leave them
    deleting the old one to get there.
  */
  IF p_make_active THEN
    UPDATE public.timetables
       SET is_active = FALSE, updated_at = NOW()
     WHERE school_id = v_school
       AND academic_year = p_academic_year
       AND term_number = p_term_number
       AND is_active;
  END IF;

  INSERT INTO public.timetables
    (school_id, academic_year, term_number, name, is_active, created_by)
  VALUES (v_school, p_academic_year, p_term_number,
          COALESCE(NULLIF(btrim(p_name), ''), 'Main Timetable'),
          p_make_active, v_user)
  RETURNING id INTO v_id;

  PERFORM public.log_audit_event(
    'timetable_created', 'timetables', v_id,
    jsonb_build_object('year', p_academic_year, 'term', p_term_number), v_school
  );

  RETURN QUERY SELECT v_id, 'Created.'::TEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- The shape of the school day.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_timetable_period(
  p_period_id   UUID,
  p_name        TEXT,
  p_start_time  TIME,
  p_end_time    TIME,
  p_order       INT,
  p_applies_days INT[] DEFAULT ARRAY[1, 2, 3, 4, 5],
  p_teaching    BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (out_period_id UUID, out_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_id     UUID;
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

  IF p_period_id IS NULL THEN
    INSERT INTO public.timetable_periods
      (school_id, period_name, start_time, end_time, period_order, applies_days,
       is_teaching_period)
    VALUES (v_school, btrim(p_name), p_start_time, p_end_time, p_order,
            p_applies_days, p_teaching)
    RETURNING id INTO v_id;
  ELSE
    -- The tenant clause is this function's own: a DEFINER function bypasses RLS, so
    -- without it any period id would be editable by any school.
    UPDATE public.timetable_periods
       SET period_name = btrim(p_name),
           start_time = p_start_time,
           end_time = p_end_time,
           period_order = p_order,
           applies_days = p_applies_days,
           is_teaching_period = p_teaching,
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

CREATE OR REPLACE FUNCTION public.delete_timetable_period(p_period_id UUID)
RETURNS TABLE (out_done BOOLEAN, out_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_slots  INT;
  v_rows   INT;
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'Sign in to your school first' USING ERRCODE = '42501';
  END IF;

  IF public.get_user_role() NOT IN ('org:owner', 'org:principal', 'org:admin') THEN
    RAISE EXCEPTION 'Only the owner, principal or administrator may change the school day'
      USING ERRCODE = '42501';
  END IF;

  /*
    Refused while lessons sit in it, rather than cascading.

    The foreign key is ON DELETE CASCADE, so removing a period would silently take
    every lesson in it across EVERY timetable — work the person deleting cannot see
    from the screen they are on. A count and a refusal lets them decide.
  */
  SELECT COUNT(*) INTO v_slots
  FROM public.timetable_slots s
  WHERE s.period_id = p_period_id AND s.school_id = v_school;

  IF v_slots > 0 THEN
    RETURN QUERY SELECT FALSE, format(
      '%s lesson%s already sits in this period. Clear them first, or keep the period and mark it non-teaching.',
      v_slots, CASE WHEN v_slots = 1 THEN '' ELSE 's' END)::TEXT;
    RETURN;
  END IF;

  DELETE FROM public.timetable_periods
  WHERE id = p_period_id AND school_id = v_school;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN QUERY SELECT FALSE, 'No such period.'::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, 'Removed.'::TEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_fn TEXT;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.create_timetable(TEXT, INT, TEXT, BOOLEAN)',
    'public.set_timetable_period(UUID, TEXT, TIME, TIME, INT, INT[], BOOLEAN)',
    'public.delete_timetable_period(UUID)'
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
