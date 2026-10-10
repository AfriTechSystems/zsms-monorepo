-- ---------------------------------------------------------------------------
-- 0200 — reading and editing a timetable
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/08 Staff Management/TIMETABLE.md`
--
-- `0197` built the tables and the clash indexes. This is what the four screens call.
--
-- ## The clash message is the whole point of `set_timetable_slot()`
--
-- The indexes already make a clash impossible. What they cannot do is say anything
-- useful: a unique violation reaches the browser as
-- `duplicate key value violates unique constraint "idx_timetable_no_teacher_clash"`,
-- which tells a deputy nothing about WHERE the teacher already is.
--
-- So the function catches the violation and looks up the conflicting slot, returning
-- "Mrs Banda is already teaching 9B at this time". The index guarantees correctness;
-- this supplies the explanation. Neither alone is enough — a pre-flight SELECT would
-- race, and a bare index cannot be acted on.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The whole grid, for the builder.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.school_timetable(p_timetable_id UUID DEFAULT NULL)
RETURNS TABLE (
  out_timetable_id UUID,
  out_name         TEXT,
  out_academic_year TEXT,
  out_term_number  INT,
  out_published    BOOLEAN,
  out_slot_id      UUID,
  out_class_id     TEXT,
  out_period_id    UUID,
  out_period_name  TEXT,
  out_start_time   TIME,
  out_end_time     TIME,
  out_period_order INT,
  out_teaching     BOOLEAN,
  out_applies_days INT[],
  out_day_of_week  INT,
  out_subject_id   UUID,
  out_subject_name TEXT,
  out_staff_user_id TEXT,
  out_slot_type    TEXT,
  out_room         TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_tt     UUID;
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'Sign in to your school first' USING ERRCODE = '42501';
  END IF;

  -- The active one when none is named, which is what a screen opening cold wants.
  v_tt := COALESCE(
    p_timetable_id,
    (SELECT t.id FROM public.timetables t
      WHERE t.school_id = v_school AND t.is_active
      ORDER BY t.created_at DESC LIMIT 1)
  );

  /*
    SECURITY INVOKER, deliberately.

    The policies on all three tables already express exactly this — a draft is
    management's, a published one is everybody's at the school, and a parent reads
    through the link row. A DEFINER function here would have to restate all of that and
    would be the copy that drifts.

    Every period is returned, joined to its slot or to nothing: the grid needs the EMPTY
    cells as much as the full ones, and a builder that only received filled slots would
    have to invent the rest from a second query.
  */
  RETURN QUERY
  SELECT
    t.id, t.name, t.academic_year, t.term_number, t.published,
    s.id, s.class_id,
    p.id, p.period_name, p.start_time, p.end_time, p.period_order,
    p.is_teaching_period, p.applies_days,
    s.day_of_week, s.subject_id, sub.subject_name, s.staff_user_id,
    s.slot_type, s.room
  FROM public.timetables t
  CROSS JOIN public.timetable_periods p
  LEFT JOIN public.timetable_slots s
    ON s.timetable_id = t.id AND s.period_id = p.id
  LEFT JOIN public.school_subjects sub ON sub.id = s.subject_id
  WHERE t.id = v_tt
    AND p.school_id = v_school
  ORDER BY p.period_order, s.class_id NULLS LAST, s.day_of_week;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Place or change one slot.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_timetable_slot(
  p_timetable_id UUID,
  p_class_id     TEXT,
  p_period_id    UUID,
  p_day_of_week  INT,
  p_subject_id   UUID DEFAULT NULL,
  p_staff_user_id TEXT DEFAULT NULL,
  p_slot_type    TEXT DEFAULT 'lesson',
  p_room         TEXT DEFAULT NULL
)
RETURNS TABLE (out_slot_id UUID, out_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_slot   UUID;
  v_other  RECORD;
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'Sign in to your school first' USING ERRCODE = '42501';
  END IF;

  IF public.get_user_role() NOT IN ('org:owner', 'org:principal', 'org:admin') THEN
    RAISE EXCEPTION 'Only the owner, principal or administrator may edit the timetable'
      USING ERRCODE = '42501';
  END IF;

  -- The timetable must be this school's. A DEFINER function bypasses RLS, so the
  -- tenant clause is this function's own responsibility.
  IF NOT EXISTS (
    SELECT 1 FROM public.timetables t
    WHERE t.id = p_timetable_id AND t.school_id = v_school
  ) THEN
    RAISE EXCEPTION 'No such timetable' USING ERRCODE = '42501';
  END IF;

  BEGIN
    INSERT INTO public.timetable_slots
      (timetable_id, school_id, class_id, period_id, day_of_week,
       subject_id, staff_user_id, slot_type, room)
    VALUES
      (p_timetable_id, v_school, p_class_id, p_period_id, p_day_of_week,
       p_subject_id, NULLIF(btrim(p_staff_user_id), ''), p_slot_type,
       NULLIF(btrim(p_room), ''))
    ON CONFLICT (timetable_id, class_id, period_id, day_of_week) DO UPDATE
      SET subject_id    = EXCLUDED.subject_id,
          staff_user_id = EXCLUDED.staff_user_id,
          slot_type     = EXCLUDED.slot_type,
          room          = EXCLUDED.room,
          updated_at    = NOW()
    RETURNING id INTO v_slot;

  EXCEPTION
    WHEN unique_violation THEN
      /*
        A clash. The index refused it; this works out what to SAY.

        Without this the browser receives "duplicate key value violates unique
        constraint idx_timetable_no_teacher_clash", which tells a deputy nothing about
        where the teacher already is.
      */
      SELECT s.class_id, sub.subject_name, s.room INTO v_other
      FROM public.timetable_slots s
      LEFT JOIN public.school_subjects sub ON sub.id = s.subject_id
      WHERE s.timetable_id = p_timetable_id
        AND s.period_id = p_period_id
        AND s.day_of_week = p_day_of_week
        AND (
          (p_staff_user_id IS NOT NULL AND s.staff_user_id = btrim(p_staff_user_id))
          OR (p_room IS NOT NULL AND lower(btrim(s.room)) = lower(btrim(p_room)))
        )
      LIMIT 1;

      /*
        Composed with `format()` and raised with one placeholder.

        plpgsql's RAISE takes `%` alone — `%%` is a literal percent and `%s` is not a
        placeholder at all, which is how the first version of this came to pass more
        arguments than it had slots for.
      */
      IF p_staff_user_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM public.timetable_slots s2
           WHERE s2.timetable_id = p_timetable_id AND s2.period_id = p_period_id
             AND s2.day_of_week = p_day_of_week
             AND s2.staff_user_id = btrim(p_staff_user_id)
         ) THEN
        RAISE EXCEPTION '%', format(
          'That teacher is already taking %s at this time%s',
          COALESCE(v_other.class_id, 'another class'),
          COALESCE(' (' || v_other.subject_name || ')', ''))
          USING ERRCODE = '23505';

      ELSIF v_other.class_id IS NOT NULL THEN
        RAISE EXCEPTION '%', format(
          '%s is already in use by %s at this time',
          COALESCE(v_other.room, 'That room'), v_other.class_id)
          USING ERRCODE = '23505';

      ELSE
        RAISE EXCEPTION 'That slot clashes with another lesson at the same time'
          USING ERRCODE = '23505';
      END IF;
  END;

  RETURN QUERY SELECT v_slot, 'Saved.'::TEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Empty a cell.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clear_timetable_slot(p_slot_id UUID)
RETURNS TABLE (out_done BOOLEAN, out_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_rows   INT;
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'Sign in to your school first' USING ERRCODE = '42501';
  END IF;

  IF public.get_user_role() NOT IN ('org:owner', 'org:principal', 'org:admin') THEN
    RAISE EXCEPTION 'Only the owner, principal or administrator may edit the timetable'
      USING ERRCODE = '42501';
  END IF;

  -- A timetable slot is configuration, not a record of anything that happened, so a
  -- real delete is right here — prohibition 8 covers pupils, fees and results.
  DELETE FROM public.timetable_slots s
  WHERE s.id = p_slot_id AND s.school_id = v_school;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN QUERY SELECT FALSE, 'That slot no longer exists.'::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, 'Cleared.'::TEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Publish, which is what makes it visible to everybody else.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.publish_timetable(
  p_timetable_id UUID,
  p_published    BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (out_done BOOLEAN, out_message TEXT, out_unstaffed INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school     UUID := public.current_school_uuid();
  v_unstaffed  INT;
  v_rows       INT;
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'Sign in to your school first' USING ERRCODE = '42501';
  END IF;

  IF public.get_user_role() NOT IN ('org:owner', 'org:principal', 'org:admin') THEN
    RAISE EXCEPTION 'Only the owner, principal or administrator may publish a timetable'
      USING ERRCODE = '42501';
  END IF;

  /*
    Counted and reported, not refused.

    A lesson with no teacher yet is a normal state in the week before term, and a school
    publishing a mostly-complete timetable so teachers can see their week is doing the
    right thing. The count goes back so the screen can say "published, 4 lessons still
    have no teacher" rather than either blocking or staying silent.
  */
  SELECT COUNT(*) INTO v_unstaffed
  FROM public.timetable_slots s
  WHERE s.timetable_id = p_timetable_id
    AND s.school_id = v_school
    AND s.slot_type = 'lesson'
    AND s.staff_user_id IS NULL;

  UPDATE public.timetables t
     SET published = p_published,
         published_at = CASE WHEN p_published THEN NOW() END,
         updated_at = NOW()
   WHERE t.id = p_timetable_id AND t.school_id = v_school;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN QUERY SELECT FALSE, 'No such timetable.'::TEXT, 0;
    RETURN;
  END IF;

  PERFORM public.log_audit_event(
    CASE WHEN p_published THEN 'timetable_published' ELSE 'timetable_unpublished' END,
    'timetables', p_timetable_id, jsonb_build_object('unstaffed', v_unstaffed), v_school
  );

  RETURN QUERY SELECT TRUE,
    CASE WHEN p_published THEN 'Published.' ELSE 'Withdrawn — only management can see it now.' END::TEXT,
    v_unstaffed;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. A teacher's own week.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_timetable()
RETURNS TABLE (
  out_day_of_week  INT,
  out_period_name  TEXT,
  out_start_time   TIME,
  out_end_time     TIME,
  out_period_order INT,
  out_class_id     TEXT,
  out_subject_name TEXT,
  out_room         TEXT,
  out_slot_type    TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user TEXT := public.get_user_id();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;

  -- INVOKER: the slot policy already hides a draft from a teacher, so filtering on
  -- `published` here as well would be the second copy that drifts.
  RETURN QUERY
  SELECT s.day_of_week, p.period_name, p.start_time, p.end_time, p.period_order,
         s.class_id, sub.subject_name, s.room, s.slot_type
  FROM public.timetable_slots s
  JOIN public.timetable_periods p ON p.id = s.period_id
  JOIN public.timetables t ON t.id = s.timetable_id
  LEFT JOIN public.school_subjects sub ON sub.id = s.subject_id
  WHERE s.staff_user_id = v_user
    AND t.is_active
  ORDER BY s.day_of_week, p.period_order;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. A child's week, for a parent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.child_timetable(p_student_id UUID)
RETURNS TABLE (
  out_day_of_week  INT,
  out_period_name  TEXT,
  out_start_time   TIME,
  out_end_time     TIME,
  out_period_order INT,
  out_subject_name TEXT,
  out_teacher_name TEXT,
  out_room         TEXT,
  out_slot_type    TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_class  TEXT;
  v_school UUID;
BEGIN
  /*
    The link row is the authorisation, checked before anything is read.

    A parent has no organisation, so there is no school to scope by — `is_linked_parent_of`
    is the whole of the test, exactly as it is for attendance and results.
  */
  IF NOT public.is_linked_parent_of(p_student_id) THEN
    RAISE EXCEPTION 'That is not one of your children' USING ERRCODE = '42501';
  END IF;

  SELECT st.class_id, st.school_id INTO v_class, v_school
  FROM public.students st
  WHERE st.id = p_student_id AND st.is_deleted = FALSE;

  IF v_class IS NULL THEN
    RETURN;
  END IF;

  /*
    The teacher's name, not their user id.

    A parent is entitled to know who teaches their child. They are not entitled to a
    Clerk identifier, which is a handle for addressing that person elsewhere in the
    system.
  */
  RETURN QUERY
  SELECT s.day_of_week, p.period_name, p.start_time, p.end_time, p.period_order,
         sub.subject_name,
         NULLIF(btrim(COALESCE(sm.first_name, '') || ' ' || COALESCE(sm.last_name, '')), ''),
         s.room, s.slot_type
  FROM public.timetable_slots s
  JOIN public.timetables t ON t.id = s.timetable_id
  JOIN public.timetable_periods p ON p.id = s.period_id
  LEFT JOIN public.school_subjects sub ON sub.id = s.subject_id
  LEFT JOIN public.staff_members sm
    ON sm.clerk_user_id = s.staff_user_id AND sm.school_id = s.school_id
  WHERE s.school_id = v_school
    AND s.class_id = v_class
    AND t.is_active
    AND t.published
  ORDER BY s.day_of_week, p.period_order;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_fn TEXT;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.school_timetable(UUID)',
    'public.set_timetable_slot(UUID, TEXT, UUID, INT, UUID, TEXT, TEXT, TEXT)',
    'public.clear_timetable_slot(UUID)',
    'public.publish_timetable(UUID, BOOLEAN)',
    'public.my_timetable()',
    'public.child_timetable(UUID)'
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
