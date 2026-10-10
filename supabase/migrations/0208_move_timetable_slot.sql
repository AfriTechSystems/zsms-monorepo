-- ===========================================================================
-- 0208 — move a lesson, or swap two, in one statement
--
-- Asked for on 2026-10-05: drag a lesson to another cell, swap two lessons by
-- dropping one onto the other, and be warned about any clash that results.
--
-- ## Why this is a function and not two calls from the screen
--
-- A move is a DELETE and an INSERT. Done from the application that is two round
-- trips with no transaction around them, and the failure is not hypothetical:
-- the second call is the one that can be refused — by the teacher-clash index,
-- the room-clash index, or the period-fit trigger — and when it is, the lesson
-- has already been removed from where it was. A deputy drags Mathematics onto a
-- cell where the teacher is busy and Mathematics is simply gone.
--
-- One function, one transaction. Either the lesson is in its new cell or it
-- never left the old one.
--
-- ## A swap cannot be done as two moves at all
--
-- Even inside one transaction, moving A onto B's cell violates the UNIQUE
-- (timetable_id, class_id, period_id, day_of_week) constraint while B is still
-- there. So a swap writes both rows' new positions in a single UPDATE ... FROM
-- over the pair, which the constraint sees as one state change rather than an
-- intermediate collision.
--
-- The unique constraints are not deferrable, and making them so would weaken
-- the guarantee for every other writer to serve one screen.
--
-- ## Clashes stay the database's decision
--
-- The screen warns before it asks, because a warning after the fact is a
-- refusal. But the warning is advisory: the two partial unique indexes from
-- `0197` remain the enforcement, and this function does not re-check what they
-- already refuse. One rule, one place. What it does add is a readable message —
-- a raw unique-violation on `idx_timetable_no_teacher_clash` tells a deputy
-- nothing about which class already has that teacher.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Where a teacher already is, for the screen's advance warning.
-- ---------------------------------------------------------------------------

/*
  The screen needs this BEFORE the drop, to warn rather than refuse.

  Returns the clashes a proposed move would cause, as rows. Empty means clear.
  Deliberately a question, not an action: it changes nothing, so the screen can
  ask it on hover without consequence.
*/
CREATE OR REPLACE FUNCTION public.timetable_move_conflicts(
  p_slot_id      UUID,
  p_period_id    UUID,
  p_day_of_week  INT
)
RETURNS TABLE (
  out_kind       TEXT,
  out_class_id   TEXT,
  out_detail     TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_slot   public.timetable_slots;
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'Sign in to your school first' USING ERRCODE = '42501';
  END IF;

  /*
    SECURITY INVOKER, so the SELECT below is filtered by the same policies the
    grid reads through. A DEFINER function here would have to restate who may
    see a draft timetable and would be the copy that drifts.
  */
  SELECT * INTO v_slot
  FROM public.timetable_slots s
  WHERE s.id = p_slot_id AND s.school_id = v_school;

  IF NOT FOUND THEN
    -- Not found and not permitted are one answer: confirming the row exists
    -- would tell a caller about another school's timetable.
    RETURN;
  END IF;

  -- The teacher, if this lesson has one.
  IF v_slot.staff_user_id IS NOT NULL AND v_slot.slot_type IN ('lesson', 'exam') THEN
    RETURN QUERY
    SELECT
      'teacher'::TEXT,
      o.class_id,
      format('%s already teaches %s then',
             COALESCE(st.first_name || ' ' || st.last_name, 'That teacher'),
             o.class_id)
    FROM public.timetable_slots o
    LEFT JOIN public.staff_members st
      ON st.clerk_user_id = o.staff_user_id AND st.school_id = v_school
    WHERE o.timetable_id = v_slot.timetable_id
      AND o.period_id = p_period_id
      AND o.day_of_week = p_day_of_week
      AND o.staff_user_id = v_slot.staff_user_id
      AND o.slot_type IN ('lesson', 'exam')
      AND o.id <> p_slot_id;
  END IF;

  -- The room, if this lesson names one.
  IF v_slot.room IS NOT NULL AND btrim(v_slot.room) <> ''
     AND v_slot.slot_type IN ('lesson', 'exam') THEN
    RETURN QUERY
    SELECT
      'room'::TEXT,
      o.class_id,
      format('%s is already used by %s then', btrim(v_slot.room), o.class_id)
    FROM public.timetable_slots o
    WHERE o.timetable_id = v_slot.timetable_id
      AND o.period_id = p_period_id
      AND o.day_of_week = p_day_of_week
      AND lower(btrim(o.room)) = lower(btrim(v_slot.room))
      AND o.slot_type IN ('lesson', 'exam')
      AND o.id <> p_slot_id;
  END IF;

  /*
    The destination period not being a teaching period.

    The `0197` trigger refuses this, but it refuses with "a lesson cannot sit in
    a break" AFTER the drop. Warning first means the cell can simply refuse the
    drag.
  */
  RETURN QUERY
  SELECT 'period'::TEXT, NULL::TEXT, format('%s holds no lessons', p.period_name)
  FROM public.timetable_periods p
  WHERE p.id = p_period_id
    AND p.school_id = v_school
    AND NOT p.is_teaching_period;

  -- The destination day not being one the period runs.
  RETURN QUERY
  SELECT 'day'::TEXT, NULL::TEXT, format('%s does not run that day', p.period_name)
  FROM public.timetable_periods p
  WHERE p.id = p_period_id
    AND p.school_id = v_school
    AND NOT (p_day_of_week = ANY (p.applies_days));
END;
$$;

REVOKE ALL ON FUNCTION public.timetable_move_conflicts(UUID, UUID, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.timetable_move_conflicts(UUID, UUID, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.timetable_move_conflicts(UUID, UUID, INT) TO authenticated;

COMMENT ON FUNCTION public.timetable_move_conflicts(UUID, UUID, INT) IS
  'Clashes a proposed drag would cause. Advisory — the partial unique indexes in 0197 are the enforcement.';

-- ---------------------------------------------------------------------------
-- 2. The move itself.
-- ---------------------------------------------------------------------------

/*
  Moves `p_slot_id` to (`p_period_id`, `p_day_of_week`) within its own class.

  When a lesson is already in the destination cell of the same class, the two
  exchange places. That is what dropping one lesson onto another means, and the
  alternative — refusing, or overwriting — would either make the gesture useless
  or silently destroy a lesson.

  The class is NOT a parameter. A slot belongs to a class, and letting a caller
  pass one would let a drag in Grade 1's grid rewrite Grade 7's.
*/
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
    and a parent exists only in the claims. Checking here keeps the rule in the
    same place as the write it guards.
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

  -- Named here as well as by the trigger, because this message can say which
  -- period rather than merely that a rule was broken.
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
      A swap, written as ONE statement.

      Two sequential UPDATEs would collide with UNIQUE (timetable_id, class_id,
      period_id, day_of_week) at the halfway point, because the first row would
      briefly occupy the second's cell. `UPDATE ... FROM` over a two-row list is
      a single state change, which the constraint is checked against once.
    */
    UPDATE public.timetable_slots s
    SET period_id   = t.new_period,
        day_of_week = t.new_day,
        updated_at  = NOW()
    FROM (
      VALUES
        (v_slot.id,  p_period_id,        p_day_of_week),
        (v_other.id, v_slot.period_id,   v_slot.day_of_week)
    ) AS t(id, new_period, new_day)
    WHERE s.id = t.id
      AND s.school_id = v_school;

    RETURN QUERY SELECT v_slot.id, v_other.id;
    RETURN;
  END IF;

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
  'Moves a lesson, or swaps two within one class, in a single transaction. The class is taken from the slot, never from the caller.';

-- ---------------------------------------------------------------------------
-- 3. Assert the shapes PostgREST depends on.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_n INT;
BEGIN
  -- Two overloads differing only by a defaulted argument make PostgREST raise
  -- PGRST203 rather than choose, and it has happened in this schema before.
  SELECT COUNT(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('move_timetable_slot', 'timetable_move_conflicts');

  IF v_n <> 2 THEN
    RAISE EXCEPTION 'Expected exactly 2 functions, found % — an overload would break PostgREST', v_n;
  END IF;

  -- `schemas = ["public"]` in config.toml means a function outside public is
  -- reachable from SQL and never from a route. Checked, because that trap has
  -- cost this schema five separate sessions.
  SELECT COUNT(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'move_timetable_slot';

  IF v_n <> 1 THEN
    RAISE EXCEPTION 'move_timetable_slot is not in public — no route could call it';
  END IF;
END;
$$;
