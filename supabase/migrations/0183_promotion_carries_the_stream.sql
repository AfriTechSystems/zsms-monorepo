-- ---------------------------------------------------------------------------
-- 0183 — promotion keeps the pupil's stream
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/07 Student and Parent Modules/STUDENTS.md`
--         → *Student Grade Promotion*
--
-- ## The bug in 0182
--
-- `promote_students()` set `class_id = NULL` on the reasoning that `8A` has no
-- meaning in Grade 9. **`students.class_id` is NOT NULL**, so the first real run
-- raised `23502` and promoted nobody. Written without checking the column, which
-- is the fourth time in this sequence a column's shape was assumed rather than
-- read.
--
-- ## Carrying the stream is better than clearing it anyway
--
-- Classes follow one convention in this schema — `class_id = grade_id` plus a
-- stream letter, so `grade_8a` sits in `grade_8`. That makes the right answer
-- derivable rather than invented: a pupil in `grade_8a` becomes `grade_9a`, which
-- is exactly what a school does by hand. The document's own example says the same
-- thing — "Grade 8A → Grade 9A".
--
-- Classes are not a table; `/api/school/structure` derives the class list from
-- the pupils in them. So promoting a cohort into `grade_9a` creates that class in
-- the only sense the schema has.
--
-- A class that does NOT follow the convention is left alone rather than guessed
-- at. The pupil still moves up a grade — that is the operation being asked for —
-- and their class shows up as an oddity on a screen a human reads, which is
-- better than inventing a stream the school does not run.
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

  IF v_role NOT IN ('owner', 'principal') THEN
    RAISE EXCEPTION 'Only the owner or principal may promote pupils'
      USING ERRCODE = '42501';
  END IF;

  -- The school's own ladder: `level_order`, never arithmetic on a label. Form 1
  -- follows Grade 6 at one school and Grade 7 at another, and both are correct.
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
    Highest grade FIRST, so a pupil is only seen by the update for the grade they
    started in. Ascending order would move Grade 8 into 9 and then the Grade 9
    update would catch the same pupil and send them to 10.
  */
  UPDATE public.students AS s
     SET grade_id = l.next_level_id,
         /*
           The stream travels with them: `grade_8a` becomes `grade_9a`.

           `class_id` is NOT NULL, so it cannot simply be cleared — 0182 tried and
           raised 23502 on the first real run. Carrying the suffix is also the
           better answer: it is derivable from the convention rather than invented,
           and it is what STUDENTS.md's own example shows.

           A class not following the convention keeps its value. The pupil still
           moves up, and the odd class surfaces on a screen a human reads instead
           of this function guessing at a stream the school may not run.
         */
         class_id = CASE
           WHEN s.class_id LIKE l.level_id || '%'
             THEN l.next_level_id || substring(s.class_id FROM length(l.level_id) + 1)
           ELSE s.class_id
         END,
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

-- The column really is NOT NULL, which is what 0182 assumed away. Asserted so a
-- later change that relaxes it does not silently re-enable the clearing idea
-- without somebody deciding to.
DO $$
BEGIN
  IF (SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'students'
         AND column_name = 'class_id') <> 'NO' THEN
    RAISE WARNING 'students.class_id is now nullable — promotion could clear it instead';
  END IF;
END;
$$;
