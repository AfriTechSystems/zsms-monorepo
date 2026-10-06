-- ===========================================================================
-- 0221 — the data completeness score (ADR-029)
--
-- Spec: `Official Documentation/18 AI Module/AI_DATA_REQUIREMENTS.md`
--       → *The Data Completeness Score*
--
-- The score has been specified since 2026-04-26, referenced by ADR-029, by
-- `AI_ASSISTANT.md`'s gating section and by `CLAUDE.md`'s "Systems 1 and 2 are
-- gated behind a data-completeness score" — and **no implementation has ever
-- existed**. Nothing in the schema computed it and nothing consulted it.
--
-- ## The formula, exactly as documented
--
--   attendance  0.40   days with attendance marked for ALL active classes
--                      ÷ school days in the term
--   marks       0.40   exam_results rows filled
--                      ÷ (students × subjects × current term)
--   parent      0.20   students with at least one active linked parent
--                      ÷ active students
--
-- ## What the gate does, and what it emphatically does not do
--
-- `AI_DATA_REQUIREMENTS.md` is explicit, and it is the opposite of what "gate"
-- suggests:
--
--   > The assistant never refuses to respond due to low completeness. It always
--   > answers with what data is available and is explicit about gaps.
--
-- So this function does not block anything. It returns a score and the specific
-- gaps, and the assistant uses them to QUALIFY an answer — "marks are only 45%
-- complete for this term, so the at-risk list may be incomplete". A school at
-- 30% can still ask questions; it simply gets answers that say what is missing.
--
-- Which is also why the assistant is one of the better ways for such a school to
-- improve: it tells them what is missing every time they ask.
--
-- ## A function, not a stored column
--
-- The inputs change every time a register is marked. A stored score would be
-- stale within the hour and would need a trigger on three busy tables to keep
-- current — which is a lot of machinery to avoid one query.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.school_data_completeness(p_school_id UUID DEFAULT NULL)
RETURNS TABLE (
  out_attendance_pct  NUMERIC,
  out_marks_pct       NUMERIC,
  out_parent_link_pct NUMERIC,
  out_overall         NUMERIC,
  out_status          TEXT,
  out_gaps            JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school    UUID;
  v_year      TEXT;
  v_term      INT;
  v_start     DATE;
  v_end       DATE;

  v_classes   INT;
  v_days      INT;
  v_marked    INT;
  v_att_pct   NUMERIC := 0;

  v_students  INT;
  v_subjects  INT;
  v_expected  INT;
  v_filled    INT;
  v_mk_pct    NUMERIC := 0;

  v_linked    INT;
  v_pl_pct    NUMERIC := 0;

  v_overall   NUMERIC;
  v_gaps      JSONB := '[]'::JSONB;
BEGIN
  /*
    Never trust the id argument. AfriTech may name a school; everybody else is
    resolved from the session and the argument is ignored.
  */
  IF public.is_afritech_admin() THEN
    v_school := COALESCE(p_school_id, public.current_school_uuid());
  ELSE
    v_school := public.current_school_uuid();
  END IF;

  IF v_school IS NULL THEN
    RAISE EXCEPTION 'Sign in to your school first' USING ERRCODE = '42501';
  END IF;

  SELECT t.academic_year, t.term_number, t.starts_on, t.ends_on
  INTO v_year, v_term, v_start, v_end
  FROM public.current_term(v_school, CURRENT_DATE) t;

  IF v_year IS NULL THEN
    -- No term configured. Not an error: a school mid-onboarding has none, and
    -- reporting zero with a named gap is more useful than refusing.
    RETURN QUERY SELECT 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, 'locked'::TEXT,
      jsonb_build_array(jsonb_build_object(
        'area', 'term_dates',
        'detail', 'No term dates are set, so nothing can be measured against them.'));
    RETURN;
  END IF;

  -- ---------------------------------------------------------------- attendance
  SELECT COUNT(DISTINCT c.level_id) INTO v_classes
  FROM public.school_grade_levels c
  WHERE c.school_id = v_school AND c.is_active;

  /*
    School days, counted as weekdays in the term up to today.

    Not the whole term: a school three weeks into a thirteen-week term would score
    23% through no fault of its own, and a measure that punishes being early is one
    nobody trusts.
  */
  SELECT COUNT(*) INTO v_days
  FROM generate_series(v_start, LEAST(v_end, CURRENT_DATE), '1 day') d
  WHERE EXTRACT(ISODOW FROM d) < 6;

  IF v_days > 0 AND v_classes > 0 THEN
    /*
      A day counts only if EVERY active class has at least one record, per the
      document. One class marking its register does not make the day marked.
    */
    SELECT COUNT(*) INTO v_marked
    FROM (
      SELECT a.attendance_date
      FROM public.attendance_records a
      WHERE a.school_id = v_school
        AND a.attendance_date BETWEEN v_start AND LEAST(v_end, CURRENT_DATE)
      GROUP BY a.attendance_date
      HAVING COUNT(DISTINCT a.class_id) >= v_classes
    ) fully_marked;

    v_att_pct := ROUND((v_marked::NUMERIC / v_days) * 100, 1);
  END IF;

  IF v_att_pct < 70 THEN
    v_gaps := v_gaps || jsonb_build_object(
      'area', 'attendance',
      'detail', format('%s of %s school days this term have a register from every class.',
                       COALESCE(v_marked, 0), v_days));
  END IF;

  -- --------------------------------------------------------------------- marks
  SELECT COUNT(*) INTO v_students
  FROM public.students s
  WHERE s.school_id = v_school AND s.status IN ('active', 'on_leave') AND NOT s.is_deleted;

  SELECT COUNT(*) INTO v_subjects
  FROM public.school_subjects sub
  WHERE sub.school_id = v_school AND sub.is_active;

  v_expected := v_students * v_subjects;

  IF v_expected > 0 THEN
    SELECT COUNT(*) INTO v_filled
    FROM public.exam_results r
    WHERE r.school_id = v_school
      AND r.academic_year = v_year
      AND r.term_number = v_term
      AND r.marks_obtained IS NOT NULL;

    -- Capped at 100: a school running two assessments per subject per term
    -- legitimately exceeds one row per pupil per subject, and 140% is not a score.
    v_mk_pct := LEAST(ROUND((v_filled::NUMERIC / v_expected) * 100, 1), 100);
  END IF;

  IF v_mk_pct < 70 THEN
    v_gaps := v_gaps || jsonb_build_object(
      'area', 'marks',
      'detail', format('%s of about %s expected marks are entered for term %s.',
                       COALESCE(v_filled, 0), v_expected, v_term));
  END IF;

  -- -------------------------------------------------------------- parent links
  IF v_students > 0 THEN
    SELECT COUNT(DISTINCT l.student_id) INTO v_linked
    FROM public.student_parent_links l
    JOIN public.students s ON s.id = l.student_id
    WHERE s.school_id = v_school
      AND s.status IN ('active', 'on_leave')
      AND NOT s.is_deleted
      AND l.unlinked_at IS NULL;

    v_pl_pct := ROUND((v_linked::NUMERIC / v_students) * 100, 1);
  END IF;

  IF v_pl_pct < 70 THEN
    v_gaps := v_gaps || jsonb_build_object(
      'area', 'parent_links',
      'detail', format('%s of %s pupils have a parent linked.',
                       COALESCE(v_linked, 0), v_students));
  END IF;

  -- ------------------------------------------------------------------ composite
  v_overall := ROUND(v_att_pct * 0.40 + v_mk_pct * 0.40 + v_pl_pct * 0.20, 1);

  RETURN QUERY SELECT
    v_att_pct, v_mk_pct, v_pl_pct, v_overall,
    CASE
      WHEN v_overall >= 70 THEN 'full'
      WHEN v_overall >= 50 THEN 'limited'
      ELSE 'locked'
    END,
    v_gaps;
END;
$$;

REVOKE ALL ON FUNCTION public.school_data_completeness(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.school_data_completeness(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.school_data_completeness(UUID) TO authenticated;

COMMENT ON FUNCTION public.school_data_completeness(UUID) IS
  'ADR-029 data completeness: attendance 40%, marks 40%, parent links 20%. Returns the score and the specific gaps. Does NOT block anything — AI_DATA_REQUIREMENTS.md says the assistant always answers and is explicit about gaps (0221).';

-- ---------------------------------------------------------------------------
-- Prove it computes rather than merely exists.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_school UUID;
  v_org    TEXT;
  v_r      RECORD;
BEGIN
  SELECT s.id, s.clerk_org_id INTO v_school, v_org
  FROM public.schools s
  WHERE s.clerk_org_id IS NOT NULL AND s.status = 'active'
  LIMIT 1;

  IF v_school IS NULL THEN
    RAISE NOTICE '0221: no active school to exercise against; skipping';
    RETURN;
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub','user_0221_probe','role','authenticated',
    'o', json_build_object('id', v_org, 'rol','owner'))::text, TRUE);

  SELECT * INTO v_r FROM public.school_data_completeness(NULL);

  IF v_r.out_overall IS NULL THEN
    RAISE EXCEPTION '0221: the score came back NULL';
  END IF;

  IF v_r.out_overall < 0 OR v_r.out_overall > 100 THEN
    RAISE EXCEPTION '0221: overall score % is outside 0-100', v_r.out_overall;
  END IF;

  IF v_r.out_status NOT IN ('full', 'limited', 'locked') THEN
    RAISE EXCEPTION '0221: unexpected status %', v_r.out_status;
  END IF;

  -- The composite must actually be the documented weighting, not an average.
  IF ROUND(v_r.out_attendance_pct * 0.40
         + v_r.out_marks_pct * 0.40
         + v_r.out_parent_link_pct * 0.20, 1) <> v_r.out_overall THEN
    RAISE EXCEPTION '0221: the composite does not match the 40/40/20 weighting';
  END IF;

  RAISE NOTICE '0221: verified — attendance %, marks %, links %, overall % (%)',
    v_r.out_attendance_pct, v_r.out_marks_pct, v_r.out_parent_link_pct,
    v_r.out_overall, v_r.out_status;
END;
$$;
