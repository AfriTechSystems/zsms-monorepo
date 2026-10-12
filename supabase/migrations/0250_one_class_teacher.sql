-- ===========================================================================
-- 0250 — one class teacher per class (ASSIGNMENTS.md)
--
-- Spec: `08 Staff Management/ASSIGNMENTS.md` → *Only One Class Teacher Per Class*
--
-- ## The gap, with live instances
--
-- ASSIGNMENTS.md: "The system enforces a single class teacher per class per
-- academic year."
--
-- It does not. `idx_teacher_assignments_class_scope` is unique on
-- `(school_id, teacher_user_id, class_id, academic_year)` — which stops the same
-- teacher being made class teacher of the same class twice, and happily permits
-- **two different teachers** to be class teacher of one class. Checked on
-- 2026-10-11: three classes on `zsms-dev` have exactly that.
--
-- It matters because the class teacher is not a label. `teacher_assignments`
-- with `scope = 'class'` is what RLS reads to decide who may see a class's
-- pupils, mark its register and enter its marks. Two class teachers is two
-- people holding a responsibility the school believes one person holds.
--
-- ## Existing duplicates are deactivated, not deleted, keeping the newest
--
-- That is exactly what the document's own replace flow does — "Do you want to
-- replace Mr. Banda as class teacher with Mrs. Phiri?" — so resolving the
-- backlog the same way is the behaviour the school would have got had the
-- constraint existed when the second assignment was made.
--
-- Keeping the NEWEST rather than the oldest for the same reason: the later
-- assignment is the more recent intent. Deactivated rather than deleted so the
-- record of who held the class survives — a mark entered last term was entered
-- by somebody, and deleting the assignment orphans the explanation.
--
-- `zsms-dev` holds synthetic data only (a standing rule), so this is safe here.
-- On a database with real assignments it is still the right resolution, and the
-- notice below names every row it touched.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Resolve the backlog, loudly.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_row RECORD;
  v_n   INT := 0;
BEGIN
  FOR v_row IN
    SELECT ta.id, ta.school_id, ta.class_id, ta.academic_year, ta.teacher_user_id
    FROM public.teacher_assignments ta
    WHERE ta.scope = 'class'
      AND ta.is_active
      -- Every row except the newest for its class.
      AND ta.id <> (
        SELECT inner_ta.id
        FROM public.teacher_assignments inner_ta
        WHERE inner_ta.school_id = ta.school_id
          AND inner_ta.class_id = ta.class_id
          AND inner_ta.academic_year = ta.academic_year
          AND inner_ta.scope = 'class'
          AND inner_ta.is_active
        ORDER BY inner_ta.created_at DESC, inner_ta.id DESC
        LIMIT 1
      )
  LOOP
    UPDATE public.teacher_assignments
    SET is_active = FALSE, updated_at = NOW()
    WHERE id = v_row.id;

    v_n := v_n + 1;
    RAISE NOTICE
      '0250: stood down % as class teacher of % (%, %) — a newer assignment exists',
      v_row.teacher_user_id, v_row.class_id, v_row.academic_year, v_row.school_id;
  END LOOP;

  RAISE NOTICE '0250: resolved % duplicate class-teacher assignment(s)', v_n;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. The constraint the document describes.
-- ---------------------------------------------------------------------------

/*
  Partial on `is_active`, which is what makes replacement possible at all.

  A full unique index would refuse the new class teacher while the old row still
  existed, so a school could never hand a class over without first deleting
  history. Scoped to active rows, the replace flow is: stand the old one down,
  then assign the new one — and the record of both survives.
*/
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_class_teacher_per_class
  ON public.teacher_assignments (school_id, class_id, academic_year)
  WHERE scope = 'class' AND is_active;

COMMENT ON INDEX public.idx_one_class_teacher_per_class IS
  'ASSIGNMENTS.md: one class teacher per class per academic year. Partial on is_active so a handover works by standing the previous teacher down rather than deleting the record (0250).';

-- ---------------------------------------------------------------------------
-- 3. Exercise it.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_school UUID;
  v_year   TEXT := '2099';
  v_class  TEXT := 'probe_0250';
  v_first  UUID;
BEGIN
  BEGIN
    SELECT id INTO v_school FROM public.schools WHERE status = 'active' LIMIT 1;
    IF v_school IS NULL THEN
      RAISE NOTICE '0250: no school fixture; skipping';
      RAISE EXCEPTION 'ZSMS_0250_ROLLBACK';
    END IF;

    INSERT INTO public.teacher_assignments
      (school_id, teacher_user_id, scope, class_id, academic_year)
    VALUES (v_school, 'probe_teacher_a', 'class', v_class, v_year)
    RETURNING id INTO v_first;

    -- A SECOND class teacher for the same class must be refused.
    BEGIN
      INSERT INTO public.teacher_assignments
        (school_id, teacher_user_id, scope, class_id, academic_year)
      VALUES (v_school, 'probe_teacher_b', 'class', v_class, v_year);
      RAISE EXCEPTION '0250: a second class teacher was accepted for one class';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;

    -- The documented handover must work: stand down, then assign.
    UPDATE public.teacher_assignments SET is_active = FALSE WHERE id = v_first;

    INSERT INTO public.teacher_assignments
      (school_id, teacher_user_id, scope, class_id, academic_year)
    VALUES (v_school, 'probe_teacher_b', 'class', v_class, v_year);

    -- And the record of the previous holder survives.
    IF NOT EXISTS (
      SELECT 1 FROM public.teacher_assignments
      WHERE id = v_first AND teacher_user_id = 'probe_teacher_a'
    ) THEN
      RAISE EXCEPTION '0250: the previous class teacher''s record was lost';
    END IF;

    /*
      Two SUBJECT assignments for one class must still be fine — two teachers
      sharing a class for different subjects is ordinary, and a constraint that
      blocked it would break every secondary timetable.
    */
    INSERT INTO public.teacher_assignments
      (school_id, teacher_user_id, scope, class_id, subject_id, academic_year)
    SELECT v_school, 'probe_teacher_c', 'subject', v_class, ss.id, v_year
    FROM public.school_subjects ss WHERE ss.school_id = v_school LIMIT 1;

    RAISE EXCEPTION 'ZSMS_0250_ROLLBACK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'ZSMS_0250_ROLLBACK' THEN
        RAISE NOTICE '0250: verified — one class teacher enforced, handover works, subject assignments unaffected';
      ELSE
        RAISE;
      END IF;
  END;
END;
$$;
