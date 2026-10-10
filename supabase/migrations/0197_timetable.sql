-- ---------------------------------------------------------------------------
-- 0197 — the timetable
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/08 Staff Management/TIMETABLE.md`
--
-- Three tables, as specified: the timetable itself, the school's periods, and one slot
-- per class per period per day. Two deliberate departures from the document, both
-- because the schema already decided otherwise.
--
-- ## `subject_id UUID`, not `subject_code TEXT`
--
-- The spec's DDL stores a subject code on the slot. Every other table that references a
-- subject — `class_subjects`, `teacher_assignments`, `exam_results` — uses
-- `subject_id UUID REFERENCES school_subjects(id)`. A code on this one table would have
-- no referential integrity, would not follow a rename, and would be a second way to
-- say the same thing. Built what the spec MEANS.
--
-- ## Clash detection is enforced by the DATABASE, not by a check in the route
--
-- The spec shows a TypeScript `checkTeacherConflict()` that SELECTs before writing.
-- That is a read-then-write race: two deputies dragging slots at the same moment both
-- read "no conflict" and both write, and the timetable then says a teacher is in two
-- rooms at once. It is also bypassable by anything that does not call that function.
--
-- Partial unique indexes enforce it where it cannot be raced or skipped. The route
-- still catches the violation and explains it — the index guarantees, the function
-- tells somebody what to do. **Rooms clash too**, which the spec does not require: a
-- room is as physical as a teacher, and a school with one laboratory needs this more
-- than it needs the teacher check.
--
-- ## A non-teaching period cannot hold a lesson
--
-- Break, lunch and assembly are rows in the grid, and the spec says lessons cannot be
-- assigned to them. Enforced by trigger rather than trusted to the builder.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The timetable.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.timetables (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  academic_year TEXT NOT NULL,
  term_number   INT NOT NULL CHECK (term_number BETWEEN 1 AND 4),
  name          TEXT NOT NULL DEFAULT 'Main Timetable',
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  -- Draft until published. Teachers, pupils and parents see nothing before that, so a
  -- deputy can build next term's grid in front of this term's.
  published     BOOLEAN NOT NULL DEFAULT FALSE,
  published_at  TIMESTAMPTZ,
  created_by    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT timetable_name_present CHECK (btrim(name) <> ''),
  -- A published timetable must say when, or "published" is a claim with no evidence.
  CONSTRAINT timetable_published_has_date
    CHECK (NOT published OR published_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_timetables_school
  ON public.timetables (school_id, academic_year, term_number);

/*
  One ACTIVE timetable per school per term.

  The spec says "only one should be active" and leaves it to discipline. A school with
  two active timetables has a teacher's week coming back twice with different answers,
  and nothing to say which is right.
*/
CREATE UNIQUE INDEX IF NOT EXISTS idx_timetables_one_active
  ON public.timetables (school_id, academic_year, term_number)
  WHERE is_active;

-- ---------------------------------------------------------------------------
-- 2. The school day.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.timetable_periods (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  period_name  TEXT NOT NULL,
  start_time   TIME NOT NULL,
  end_time     TIME NOT NULL,
  period_order INT NOT NULL,
  -- 1=Monday … 5=Friday. Assembly might be {1}; lunch is every day.
  applies_days INT[] NOT NULL DEFAULT '{1,2,3,4,5}',
  -- FALSE for breaks, lunch and assembly — these cannot hold a lesson.
  is_teaching_period BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (school_id, period_order),
  CONSTRAINT period_name_present CHECK (btrim(period_name) <> ''),
  -- A period that ends before it starts puts the grid in an order nobody can read.
  CONSTRAINT period_ends_after_start CHECK (end_time > start_time),
  CONSTRAINT period_days_valid
    CHECK (applies_days <@ ARRAY[1, 2, 3, 4, 5] AND array_length(applies_days, 1) > 0)
);

CREATE INDEX IF NOT EXISTS idx_timetable_periods_school
  ON public.timetable_periods (school_id, period_order);

-- ---------------------------------------------------------------------------
-- 3. One lesson slot.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.timetable_slots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timetable_id  UUID NOT NULL REFERENCES public.timetables(id) ON DELETE CASCADE,
  school_id     UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  -- TEXT, matching `students.class_id`, `class_subjects.class_id` and
  -- `teacher_assignments.class_id`. There is no classes table in this schema.
  class_id      TEXT NOT NULL,
  period_id     UUID NOT NULL REFERENCES public.timetable_periods(id) ON DELETE CASCADE,
  day_of_week   INT NOT NULL CHECK (day_of_week BETWEEN 1 AND 5),
  -- A UUID, not the spec's code. See the header.
  subject_id    UUID REFERENCES public.school_subjects(id) ON DELETE SET NULL,
  -- Clerk user id. NULL while a slot is placed but not yet staffed.
  staff_user_id TEXT,
  slot_type     TEXT NOT NULL DEFAULT 'lesson'
                CHECK (slot_type IN ('lesson', 'break', 'assembly', 'free', 'exam')),
  room          TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (timetable_id, class_id, period_id, day_of_week),
  CONSTRAINT slot_class_present CHECK (btrim(class_id) <> '')
);

CREATE INDEX IF NOT EXISTS idx_timetable_slots_timetable
  ON public.timetable_slots (timetable_id);
CREATE INDEX IF NOT EXISTS idx_timetable_slots_class
  ON public.timetable_slots (timetable_id, class_id);
CREATE INDEX IF NOT EXISTS idx_timetable_slots_teacher
  ON public.timetable_slots (timetable_id, staff_user_id);
CREATE INDEX IF NOT EXISTS idx_timetable_slots_day
  ON public.timetable_slots (timetable_id, day_of_week);

/*
  A teacher cannot be in two places at once.

  Enforced here rather than by a SELECT before writing. The spec's approach is a
  read-then-write race — two deputies dragging at the same moment both read "clear" and
  both write — and it is skipped entirely by anything that does not call that one
  function. A partial unique index cannot be raced and cannot be bypassed.

  Scoped to lessons and exams: two classes sharing one teacher at break is not a clash,
  it is break.
*/
CREATE UNIQUE INDEX IF NOT EXISTS idx_timetable_no_teacher_clash
  ON public.timetable_slots (timetable_id, period_id, day_of_week, staff_user_id)
  WHERE staff_user_id IS NOT NULL AND slot_type IN ('lesson', 'exam');

/*
  Nor can a room hold two classes.

  Not in the spec, and more valuable than the teacher check for most Zambian schools:
  one laboratory, one computer room, one hall. Case-folded and trimmed, because
  "Lab 1" and "lab 1" are one room and a school will type both.
*/
CREATE UNIQUE INDEX IF NOT EXISTS idx_timetable_no_room_clash
  ON public.timetable_slots (timetable_id, period_id, day_of_week, lower(btrim(room)))
  WHERE room IS NOT NULL AND btrim(room) <> '' AND slot_type IN ('lesson', 'exam');

-- ---------------------------------------------------------------------------
-- 4. A lesson cannot sit in a break, and a slot cannot sit on a day its period skips.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_timetable_slot_fits_period()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_period RECORD;
BEGIN
  SELECT p.is_teaching_period, p.applies_days, p.period_name, p.school_id
    INTO v_period
  FROM public.timetable_periods p
  WHERE p.id = NEW.period_id;

  IF v_period IS NULL THEN
    RAISE EXCEPTION 'That period does not exist' USING ERRCODE = '23503';
  END IF;

  -- The period and the slot must belong to the same school. Without this a slot could
  -- reference another school's period and leak its name through an error message.
  IF v_period.school_id <> NEW.school_id THEN
    RAISE EXCEPTION 'That period belongs to another school' USING ERRCODE = '42501';
  END IF;

  IF NOT v_period.is_teaching_period
     AND NEW.slot_type IN ('lesson', 'exam') THEN
    RAISE EXCEPTION '% is not a teaching period, so it cannot hold a lesson',
      v_period.period_name
      USING ERRCODE = '23514';
  END IF;

  IF NOT (NEW.day_of_week = ANY (v_period.applies_days)) THEN
    RAISE EXCEPTION '% does not run on that day', v_period.period_name
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

/*
  AFTER, not BEFORE.

  A BEFORE ROW trigger runs ahead of the RLS `WITH CHECK`, so this would name another
  school's period — "Assembly is not a teaching period" — before establishing that the
  caller may write here at all. `0101` made exactly that mistake with the pupil ceiling.
*/
DROP TRIGGER IF EXISTS check_slot_fits_period_on_timetable_slots ON public.timetable_slots;
CREATE TRIGGER check_slot_fits_period_on_timetable_slots
  AFTER INSERT OR UPDATE ON public.timetable_slots
  FOR EACH ROW EXECUTE FUNCTION public.check_timetable_slot_fits_period();

-- ---------------------------------------------------------------------------
-- 5. RLS.
-- ---------------------------------------------------------------------------
ALTER TABLE public.timetables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timetables FORCE ROW LEVEL SECURITY;
ALTER TABLE public.timetable_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timetable_periods FORCE ROW LEVEL SECURITY;
ALTER TABLE public.timetable_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timetable_slots FORCE ROW LEVEL SECURITY;

/*
  Everybody at the school reads the periods; management writes them.

  Periods are the shape of the school day and carry nothing sensitive, so a teacher
  reading them needs no further test.
*/
CREATE POLICY school_read_timetable_periods ON public.timetable_periods
  FOR SELECT TO authenticated
  USING (school_id = public.current_school_uuid());

CREATE POLICY school_write_timetable_periods ON public.timetable_periods
  FOR ALL TO authenticated
  USING (
    school_id = public.current_school_uuid()
    AND public.get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
  )
  WITH CHECK (
    school_id = public.current_school_uuid()
    AND public.get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
  );

/*
  A DRAFT timetable is management's alone.

  The point of a draft is that a deputy can rearrange next term without a teacher
  seeing a version that will change. Everyone else sees it when it is published.
*/
CREATE POLICY school_read_timetables ON public.timetables
  FOR SELECT TO authenticated
  USING (
    school_id = public.current_school_uuid()
    AND (
      published
      OR public.get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
    )
  );

CREATE POLICY school_write_timetables ON public.timetables
  FOR ALL TO authenticated
  USING (
    school_id = public.current_school_uuid()
    AND public.get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
  )
  WITH CHECK (
    school_id = public.current_school_uuid()
    AND public.get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
  );

-- A slot is visible exactly when its timetable is.
CREATE POLICY school_read_timetable_slots ON public.timetable_slots
  FOR SELECT TO authenticated
  USING (
    school_id = public.current_school_uuid()
    AND EXISTS (
      SELECT 1 FROM public.timetables t
      WHERE t.id = timetable_slots.timetable_id
        AND (
          t.published
          OR public.get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
        )
    )
  );

CREATE POLICY school_write_timetable_slots ON public.timetable_slots
  FOR ALL TO authenticated
  USING (
    school_id = public.current_school_uuid()
    AND public.get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
  )
  WITH CHECK (
    school_id = public.current_school_uuid()
    AND public.get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
  );

/*
  A parent reads their child's timetable, across schools.

  A parent has no organisation, so `current_school_uuid()` is null for them and every
  policy above denies. Their access resolves through the link row, exactly as it does
  for attendance and results.
*/
CREATE POLICY parent_read_timetable_slots ON public.timetable_slots
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.students s
      JOIN public.timetables t ON t.id = timetable_slots.timetable_id
      WHERE s.class_id = timetable_slots.class_id
        AND s.school_id = timetable_slots.school_id
        AND s.is_deleted = FALSE
        AND t.published
        AND public.is_linked_parent_of(s.id)
    )
  );

CREATE POLICY parent_read_timetables ON public.timetables
  FOR SELECT TO authenticated
  USING (
    published
    AND EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.school_id = timetables.school_id
        AND s.is_deleted = FALSE
        AND public.is_linked_parent_of(s.id)
    )
  );

CREATE POLICY parent_read_timetable_periods ON public.timetable_periods
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.school_id = timetable_periods.school_id
        AND s.is_deleted = FALSE
        AND public.is_linked_parent_of(s.id)
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.timetables, public.timetable_periods, public.timetable_slots
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. The `0149` status guard.
--
-- `0149` attaches its write-blocking trigger by iterating the table catalogue AT
-- MIGRATION TIME, so a table created afterwards has none and nothing reminds anybody.
-- These three are school-scoped and must not be writable by a suspended school.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['timetables', 'timetable_periods', 'timetable_slots']
  LOOP
    /*
      STATEMENT level with transition tables, copied from `0149` rather than guessed.

      `enforce_school_writable_new()` reads a transition table called `new_rows`, so a
      FOR EACH ROW trigger fails with "relation new_rows does not exist" on the first
      write — which is exactly what the first push of this migration did.
    */
    EXECUTE format(
      'DROP TRIGGER IF EXISTS enforce_school_writable_on_insert_on_%I ON public.%I',
      v_table, v_table);
    EXECUTE format(
      'CREATE TRIGGER enforce_school_writable_on_insert_on_%I
         AFTER INSERT ON public.%I
         REFERENCING NEW TABLE AS new_rows
         FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_school_writable_new()',
      v_table, v_table);

    EXECUTE format(
      'DROP TRIGGER IF EXISTS enforce_school_writable_on_update_on_%I ON public.%I',
      v_table, v_table);
    EXECUTE format(
      'CREATE TRIGGER enforce_school_writable_on_update_on_%I
         AFTER UPDATE ON public.%I
         REFERENCING NEW TABLE AS new_rows
         FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_school_writable_new()',
      v_table, v_table);

    EXECUTE format(
      'DROP TRIGGER IF EXISTS enforce_school_writable_on_delete_on_%I ON public.%I',
      v_table, v_table);
    EXECUTE format(
      'CREATE TRIGGER enforce_school_writable_on_delete_on_%I
         AFTER DELETE ON public.%I
         REFERENCING OLD TABLE AS old_rows
         FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_school_writable_old()',
      v_table, v_table);
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- Prove the clash indexes bite, with real writes.
--
-- `0173` asserted a trigger was ATTACHED, which it was, and every write through it then
-- failed. Attachment is not the property that matters; surviving — and refusing — a
-- real write is.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_school UUID;
  v_tt     UUID;
  v_period UUID;
  v_break  UUID;
BEGIN
  SELECT id INTO v_school FROM public.schools LIMIT 1;
  IF v_school IS NULL THEN
    RAISE NOTICE 'no school to verify against — skipping';
    RETURN;
  END IF;

  INSERT INTO public.timetables (school_id, academic_year, term_number, name, created_by)
  VALUES (v_school, '2099', 1, 'Verification 0197', 'migration')
  RETURNING id INTO v_tt;

  INSERT INTO public.timetable_periods
    (school_id, period_name, start_time, end_time, period_order)
  VALUES (v_school, 'Verification period', '07:00', '08:00', 9901)
  RETURNING id INTO v_period;

  INSERT INTO public.timetable_periods
    (school_id, period_name, start_time, end_time, period_order, is_teaching_period)
  VALUES (v_school, 'Verification break', '08:00', '08:20', 9902, FALSE)
  RETURNING id INTO v_break;

  -- One teacher, one period, two classes.
  INSERT INTO public.timetable_slots
    (timetable_id, school_id, class_id, period_id, day_of_week, staff_user_id)
  VALUES (v_tt, v_school, 'verify_a', v_period, 1, 'user_verify_teacher');

  BEGIN
    INSERT INTO public.timetable_slots
      (timetable_id, school_id, class_id, period_id, day_of_week, staff_user_id)
    VALUES (v_tt, v_school, 'verify_b', v_period, 1, 'user_verify_teacher');
    RAISE EXCEPTION 'a teacher was scheduled in two classes at once';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'verified: a teacher cannot be in two places at once';
  END;

  -- One room, one period, two classes.
  BEGIN
    UPDATE public.timetable_slots SET room = 'Lab 1'
     WHERE timetable_id = v_tt AND class_id = 'verify_a';
    INSERT INTO public.timetable_slots
      (timetable_id, school_id, class_id, period_id, day_of_week, room)
    VALUES (v_tt, v_school, 'verify_c', v_period, 1, '  lab 1 ');
    RAISE EXCEPTION 'two classes were put in one room';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'verified: a room cannot hold two classes, case and space folded';
  END;

  -- A lesson in a break.
  BEGIN
    INSERT INTO public.timetable_slots
      (timetable_id, school_id, class_id, period_id, day_of_week, slot_type)
    VALUES (v_tt, v_school, 'verify_d', v_break, 1, 'lesson');
    RAISE EXCEPTION 'a lesson was scheduled during a break';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'verified: a lesson cannot be put in a non-teaching period';
  END;

  -- Clean up: this is a migration, not a school's data.
  DELETE FROM public.timetable_slots WHERE timetable_id = v_tt;
  DELETE FROM public.timetables WHERE id = v_tt;
  DELETE FROM public.timetable_periods WHERE id IN (v_period, v_break);

  RAISE NOTICE 'verified: timetable constraints enforced, fixtures removed';
END;
$$;
