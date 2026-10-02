-- ---------------------------------------------------------------------------
-- 0182 — moving a cohort up a year, and letting a pupil leave
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/07 Student and Parent Modules/STUDENTS.md`
--         → *Student Grade Promotion*
--       `Official Documentation/07 Student and Parent Modules/TRANSFER.md`
--
-- ## Two year-end operations with no implementation at all
--
-- The gap audit on 2026-10-02 found both documented at length and backed by
-- nothing: no table, no function, no route. A school reaching the end of its
-- first ZSMS year would have had to re-enrol every pupil by hand to move them up
-- a grade, and would have had no way at all to record one leaving.
--
-- ## Promotion follows the SCHOOL's ladder, never a hardcoded one
--
-- Zambia runs two systems at once — ECZ Grades 1–12, and the 2023 reform's
-- Grades 1–6 then Forms 1–6 — and most private schools are mid-transition. So
-- "the next grade" cannot be `grade_id + 1`, or arithmetic on a label: Form 1
-- follows Grade 6 at one school and Grade 7 follows it at another.
--
-- `school_grade_levels.level_order` already encodes each school's own
-- progression, which is why grade levels are school-configurable in the first
-- place. Promotion steps along that order and nothing else.
--
-- ## The final year is never promoted
--
-- A pupil in the highest `level_order` has nowhere to go: `STUDENTS.md` says
-- they "will be graduated separately", and graduating is a different decision
-- made against examination results. They are counted and reported, never moved —
-- promoting them would invent a grade the school does not run.
--
-- ## A dry run is the default
--
-- `p_dry_run` defaults TRUE. Promotion rewrites every pupil's grade in one
-- statement; a school that ran it against the wrong year would have no undo
-- short of a backup. The screen shows the counts first and asks again.
--
-- ## Transfer records the leaving, not the paperwork
--
-- `TRANSFER.md` also specifies a transfer letter PDF stored permanently in R2.
-- That is **not built here** and the reason is recorded rather than hidden: R2
-- has no credentials, so nothing can be stored at all (see CLAUDE.md). The state
-- change, the parent's grace period and the audit trail are what a school needs
-- on the day a pupil leaves; the letter can be generated later from the same row.
--
-- Business rule 1 says a transfer sets `alumni_status = 'transferred'`. **That
-- column does not exist and deliberately was not added** (`0181`): `status`
-- already admits `transferred`, `graduated` and `withdrawn`, and two columns
-- meaning the same thing is a question with no answer. Transfer sets `status`.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Promote a cohort.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.promote_students(
  p_dry_run BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
  out_from_grade   TEXT,
  out_to_grade     TEXT,
  out_pupils       INT,
  out_is_final     BOOLEAN,
  out_applied      BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_role   TEXT := auth.jwt() -> 'o' ->> 'rol';
  v_moved  INT  := 0;
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'Sign in to your school first' USING ERRCODE = '42501';
  END IF;

  -- Owner and principal only. A year-end promotion rewrites the grade of every
  -- pupil on the roll, which is not an act a teacher or bursar performs.
  IF v_role NOT IN ('owner', 'principal') THEN
    RAISE EXCEPTION 'Only the owner or principal may promote pupils'
      USING ERRCODE = '42501';
  END IF;

  /*
    The school's own ladder. `level_order` is what makes this work across both
    Zambian systems at once — the next grade is the next ORDER, whatever it is
    called, so Form 1 following Grade 6 needs no special case.
  */
  CREATE TEMP TABLE IF NOT EXISTS _ladder ON COMMIT DROP AS
  SELECT
    g.level_id,
    g.level_order,
    LEAD(g.level_id) OVER (ORDER BY g.level_order) AS next_level_id
  FROM public.school_grade_levels AS g
  WHERE g.school_id = v_school
    AND g.is_active
  ORDER BY g.level_order;

  IF p_dry_run THEN
    RETURN QUERY
    SELECT
      l.level_id,
      COALESCE(l.next_level_id, '(graduating)'),
      COUNT(s.id)::INT,
      l.next_level_id IS NULL,
      FALSE
    FROM _ladder AS l
    LEFT JOIN public.students AS s
      ON s.grade_id = l.level_id
     AND s.school_id = v_school
     AND s.is_deleted = FALSE
     AND s.status IN ('active', 'on_leave')
    GROUP BY l.level_id, l.level_order, l.next_level_id
    HAVING COUNT(s.id) > 0
    ORDER BY l.level_order;
    RETURN;
  END IF;

  /*
    Highest grade FIRST.

    Updating Grade 8 → 9 before Grade 9 → 10 would move a pupil twice in one
    statement sequence: they land in 9, then the next update catches them and
    sends them to 10. Descending `level_order` means a pupil is only ever seen by
    the update for the grade they started in.
  */
  UPDATE public.students AS s
     SET grade_id = l.next_level_id,
         -- The class goes with it: `8A` has no meaning in Grade 9, and leaving a
         -- stale class is worse than leaving none — registers and mark sheets
         -- both key on it. The school reassigns classes after promotion.
         class_id = NULL,
         updated_at = NOW()
  FROM _ladder AS l
  WHERE s.grade_id = l.level_id
    AND l.next_level_id IS NOT NULL
    AND s.school_id = v_school
    AND s.is_deleted = FALSE
    AND s.status IN ('active', 'on_leave');

  GET DIAGNOSTICS v_moved = ROW_COUNT;

  PERFORM public.log_audit_event(
    'students_promoted', 'students', NULL,
    jsonb_build_object('pupils_moved', v_moved),
    v_school
  );

  RETURN QUERY
  SELECT
    l.level_id,
    COALESCE(l.next_level_id, '(graduating)'),
    COUNT(s.id)::INT,
    l.next_level_id IS NULL,
    TRUE
  FROM _ladder AS l
  LEFT JOIN public.students AS s
    ON s.grade_id = l.level_id
   AND s.school_id = v_school
   AND s.is_deleted = FALSE
   AND s.status IN ('active', 'on_leave')
  GROUP BY l.level_id, l.level_order, l.next_level_id
  ORDER BY l.level_order;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. A pupil leaves.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transfer_student(
  p_student_id  UUID,
  p_reason      TEXT,
  p_destination TEXT DEFAULT NULL,
  p_kind        TEXT DEFAULT 'transferred'
)
RETURNS TABLE (out_done BOOLEAN, out_access_until TIMESTAMPTZ, out_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_user   TEXT := public.get_user_id();
  v_role   TEXT := auth.jwt() -> 'o' ->> 'rol';
  v_until  TIMESTAMPTZ := NOW() + INTERVAL '30 days';
  v_name   TEXT;
BEGIN
  IF v_school IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in to your school first' USING ERRCODE = '42501';
  END IF;

  IF v_role NOT IN ('owner', 'principal', 'admin') THEN
    RAISE EXCEPTION 'Only the owner, principal or administrator may transfer a pupil'
      USING ERRCODE = '42501';
  END IF;

  -- `graduated` is deliberately absent: graduating a cohort is a decision made
  -- against examination results, not a pupil leaving, and conflating them would
  -- let one screen do both by accident.
  IF p_kind NOT IN ('transferred', 'withdrawn') THEN
    RAISE EXCEPTION 'A pupil leaves as transferred or withdrawn, not %', p_kind
      USING ERRCODE = '22023';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required when a pupil leaves' USING ERRCODE = '22023';
  END IF;

  SELECT s.first_name || ' ' || s.last_name INTO v_name
  FROM public.students AS s
  WHERE s.id = p_student_id
    AND s.school_id = v_school
    AND s.is_deleted = FALSE;

  IF v_name IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TIMESTAMPTZ, 'That pupil is not at this school.'::TEXT;
    RETURN;
  END IF;

  -- Never a delete. Business rule 1, and `CONVENTIONS.md` prohibition 8: a pupil's
  -- record survives their leaving, because their results and payments reference it.
  UPDATE public.students AS s
     SET status = p_kind,
         updated_at = NOW()
   WHERE s.id = p_student_id
     AND s.school_id = v_school;

  /*
    The parents' 30-day grace period (business rule 2).

    The same window `unlink_parent_from_student()` uses, and `is_linked_parent_of()`
    already honours it — so a family who has just left can still download a receipt
    for fees they paid and the term's results, which is the entire point of a grace
    period rather than a hard cut on the day.
  */
  UPDATE public.student_parent_links AS spl
     SET grace_period_ends_at = v_until
   WHERE spl.student_id = p_student_id
     AND spl.is_active;

  PERFORM public.log_audit_event(
    CASE WHEN p_kind = 'withdrawn' THEN 'student_withdrawn' ELSE 'student_transferred' END,
    'students', p_student_id,
    jsonb_build_object(
      'reason', btrim(p_reason),
      'destination', NULLIF(btrim(COALESCE(p_destination, '')), ''),
      'parent_access_until', v_until
    ),
    v_school
  );

  RETURN QUERY SELECT
    TRUE,
    v_until,
    (v_name || ' is recorded as ' || p_kind
      || '. Their family keeps access to past records for 30 days.')::TEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_fn TEXT;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.promote_students(BOOLEAN)',
    'public.transfer_student(UUID, TEXT, TEXT, TEXT)'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', v_fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_fn);

    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon can execute %', v_fn;
    END IF;
    IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated cannot execute %', v_fn;
    END IF;
  END LOOP;
END;
$$;
