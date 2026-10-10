-- ===========================================================================
-- 0209 — a swap exchanges the lessons, not the rows
--
-- `0208` was wrong, and its own comment asserted the thing that is false.
--
-- It claimed that writing both halves of a swap as one `UPDATE ... FROM` over a
-- two-row VALUES list would be "a single state change, which the constraint is
-- checked against once". It is not. PostgreSQL checks a non-deferrable UNIQUE
-- constraint **per row as the statement progresses**, so the moment row A is
-- written into row B's cell — while B is still in it — the constraint fires:
--
--     duplicate key value violates unique constraint
--     "timetable_slots_timetable_id_class_id_period_id_day_of_week_key"
--     Key (timetable_id, class_id, period_id, day_of_week)=(…, grade_1a, …, 5)
--     already exists.
--
-- Found by exercising the function against the real database immediately after
-- applying it, which is the only reason it did not ship. Reading the migration
-- again would not have found it: the SQL is valid, the logic looks atomic, and
-- the behaviour is a property of when constraints are evaluated rather than of
-- anything visible in the text.
--
-- ## The fix: swap the lessons, not the positions
--
-- Two rows cannot exchange positions without passing through a state where both
-- claim one cell. But they do not need to. A timetable slot IS a cell — the row
-- identifies (timetable, class, period, day) and carries a lesson as its
-- payload. So the two rows stay exactly where they are and exchange what they
-- hold: subject, teacher, type, room, notes.
--
-- The unique key never changes, so no intermediate state can collide, and the
-- result is indistinguishable to anyone looking at the grid.
--
-- The alternative was making the constraint DEFERRABLE and deferring it inside
-- the function. That works, but it weakens a constraint every other writer
-- depends on in order to serve one screen's gesture, and a deferral set inside a
-- function persists for the rest of the caller's transaction. Not worth it when
-- the rows do not need to move at all.
--
-- ## The teacher and room indexes are safe under this
--
-- `idx_timetable_no_teacher_clash` is keyed on
-- (timetable_id, period_id, day_of_week, staff_user_id). The two cells being
-- swapped differ in (period, day) by definition — they are different cells — so
-- exchanging their teachers cannot make the pair collide with each other. A
-- collision with some THIRD class's lesson is a real clash and is still
-- correctly refused. The same holds for the room index.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.move_timetable_slot(
  p_slot_id      UUID,
  p_period_id    UUID,
  p_day_of_week  INT
)
RETURNS TABLE (out_moved UUID, out_swapped_with UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_role   TEXT := public.get_user_role();
  v_slot   public.timetable_slots;
  v_other  public.timetable_slots;
  v_period public.timetable_periods;
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'Sign in to your school first' USING ERRCODE = '42501';
  END IF;

  /*
    The role check is inside the function, not expressed as a GRANT.

    `authenticated` is one role to PostgreSQL; the distinction between a deputy
    and a parent exists only in the claims.
  */
  IF v_role NOT IN ('org:owner', 'org:admin', 'org:head_teacher', 'org:deputy_head') THEN
    RAISE EXCEPTION 'Only school management can change a timetable'
      USING ERRCODE = '42501';
  END IF;

  -- Explicit tenant clause, never trusting the id argument on its own.
  SELECT * INTO v_slot
  FROM public.timetable_slots s
  WHERE s.id = p_slot_id AND s.school_id = v_school;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That lesson is not available' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_period
  FROM public.timetable_periods p
  WHERE p.id = p_period_id AND p.school_id = v_school;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That period is not available' USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_period.is_teaching_period THEN
    RAISE EXCEPTION '% holds no lessons', v_period.period_name
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT (p_day_of_week = ANY (v_period.applies_days)) THEN
    RAISE EXCEPTION '% does not run on that day', v_period.period_name
      USING ERRCODE = 'P0001';
  END IF;

  -- Nothing to do, and reporting it as a move would be a lie.
  IF v_slot.period_id = p_period_id AND v_slot.day_of_week = p_day_of_week THEN
    RETURN QUERY SELECT v_slot.id, NULL::UUID;
    RETURN;
  END IF;

  -- Is the destination occupied, for this same class?
  SELECT * INTO v_other
  FROM public.timetable_slots s
  WHERE s.timetable_id = v_slot.timetable_id
    AND s.class_id = v_slot.class_id
    AND s.period_id = p_period_id
    AND s.day_of_week = p_day_of_week
    AND s.school_id = v_school;

  IF FOUND THEN
    /*
      Exchange the LESSONS. Neither row moves, so the unique key on
      (timetable_id, class_id, period_id, day_of_week) never changes and there is
      no intermediate state to collide with.

      Two separate UPDATEs are fine here precisely because the key is untouched.
    */
    UPDATE public.timetable_slots s
    SET subject_id    = v_other.subject_id,
        staff_user_id = v_other.staff_user_id,
        slot_type     = v_other.slot_type,
        room          = v_other.room,
        notes         = v_other.notes,
        updated_at    = NOW()
    WHERE s.id = v_slot.id AND s.school_id = v_school;

    UPDATE public.timetable_slots s
    SET subject_id    = v_slot.subject_id,
        staff_user_id = v_slot.staff_user_id,
        slot_type     = v_slot.slot_type,
        room          = v_slot.room,
        notes         = v_slot.notes,
        updated_at    = NOW()
    WHERE s.id = v_other.id AND s.school_id = v_school;

    /*
      The lesson the caller dragged now lives in the row it was dropped ON, so
      that is the id reported as moved. A screen that highlighted `p_slot_id`
      would highlight the cell the lesson came FROM.
    */
    RETURN QUERY SELECT v_other.id, v_slot.id;
    RETURN;
  END IF;

  -- An empty destination needs no exchange, and moving the row is correct: the
  -- key changes once, to a cell nothing occupies.
  UPDATE public.timetable_slots s
  SET period_id   = p_period_id,
      day_of_week = p_day_of_week,
      updated_at  = NOW()
  WHERE s.id = p_slot_id
    AND s.school_id = v_school;

  RETURN QUERY SELECT v_slot.id, NULL::UUID;
END;
$$;

REVOKE ALL ON FUNCTION public.move_timetable_slot(UUID, UUID, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.move_timetable_slot(UUID, UUID, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.move_timetable_slot(UUID, UUID, INT) TO authenticated;

COMMENT ON FUNCTION public.move_timetable_slot(UUID, UUID, INT) IS
  'Moves a lesson to an empty cell, or exchanges two lessons within one class. A swap trades payloads rather than positions, because two rows cannot exchange a unique key without colliding. The class is taken from the slot, never from the caller.';
