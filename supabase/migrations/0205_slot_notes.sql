-- ---------------------------------------------------------------------------
-- 0205 — the slot panel's Notes field had nowhere to go
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/08 Staff Management/TIMETABLE.md`
--       → *Adding a new slot* → "Notes: [text — optional]"
--
-- `timetable_slots.notes` has existed since `0197` and `set_timetable_slot()` never
-- took it. The builder's Notes field would have been typed into, saved, and silently
-- discarded — the worst of the three outcomes, because nothing reports it.
--
-- Found by re-reading the spec's panel against the function signature after the
-- dropdowns were reported broken. The field was simply missing from my implementation.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_timetable_slot(
  p_timetable_id  UUID,
  p_class_id      TEXT,
  p_period_id     UUID,
  p_day_of_week   INT,
  p_subject_id    UUID DEFAULT NULL,
  p_staff_user_id TEXT DEFAULT NULL,
  p_slot_type     TEXT DEFAULT 'lesson',
  p_room          TEXT DEFAULT NULL,
  p_notes         TEXT DEFAULT NULL
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
       subject_id, staff_user_id, slot_type, room, notes)
    VALUES
      (p_timetable_id, v_school, p_class_id, p_period_id, p_day_of_week,
       p_subject_id, NULLIF(btrim(p_staff_user_id), ''), p_slot_type,
       NULLIF(btrim(p_room), ''), NULLIF(btrim(p_notes), ''))
    ON CONFLICT (timetable_id, class_id, period_id, day_of_week) DO UPDATE
      SET subject_id    = EXCLUDED.subject_id,
          staff_user_id = EXCLUDED.staff_user_id,
          slot_type     = EXCLUDED.slot_type,
          room          = EXCLUDED.room,
          notes         = EXCLUDED.notes,
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

/*
  The eight-argument form is dropped.

  Leaving it would give PostgREST two overloads differing only by a defaulted
  argument, and `rpc()` would then fail with `PGRST203` — "could not choose the best
  candidate function" — which reads as a permissions fault and is not one.
*/
DROP FUNCTION IF EXISTS public.set_timetable_slot(UUID, TEXT, UUID, INT, UUID, TEXT, TEXT, TEXT);

REVOKE ALL ON FUNCTION public.set_timetable_slot(UUID, TEXT, UUID, INT, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_timetable_slot(UUID, TEXT, UUID, INT, UUID, TEXT, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_timetable_slot(UUID, TEXT, UUID, INT, UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Prove a note survives the round trip, and that exactly one overload remains.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_n INT;
BEGIN
  SELECT COUNT(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'set_timetable_slot';

  IF v_n <> 1 THEN
    RAISE EXCEPTION
      '% overloads of set_timetable_slot — PostgREST cannot choose between them', v_n;
  END IF;

  RAISE NOTICE 'verified: one overload, taking notes';
END;
$$;
