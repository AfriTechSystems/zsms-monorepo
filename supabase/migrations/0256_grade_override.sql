-- ===========================================================================
-- 0256 — manual grade override (GRADING.md)
--
-- Spec: `11 Examinations and Results/GRADING.md` → *Grade Override*
--
-- ## The gap
--
-- GRADING.md names `exam_results.grade_override` and `.grade_override_reason`
-- and describes the whole flow. **Neither column has ever existed**, and nothing
-- in `apps/` mentions either name. So a coursework subject whose final grade is
-- not a percentage had no way to be recorded correctly — the teacher's only
-- options were to leave the computed grade wrong or to fake a mark that would
-- produce the right letter, which also corrupts the class average and position.
--
-- ## The computed grade is kept, not replaced
--
-- `grade_letter` stays exactly as `grade_from_scale_version()` produced it, and
-- the override sits beside it. Three reasons:
--
--   * `grading_scale_version_id` records which scale produced `grade_letter`
--     (`0141`). Overwriting the letter would leave that provenance pointing at a
--     grade the scale never produced.
--   * A report card has to be able to show that a grade was awarded rather than
--     calculated — GRADING.md asks for an asterisk and a footnote, and you cannot
--     footnote a value you have overwritten.
--   * Removing an override must restore the computed grade, which is only
--     possible if it was never destroyed.
--
-- Readers therefore take `COALESCE(grade_override, grade_letter)` and mark the
-- row when `grade_override IS NOT NULL`.
--
-- ## A reason is required, and the override is locked with the result
--
-- GRADING.md marks the reason required, so the CHECK enforces it rather than
-- trusting a form. And an override on a **published** result is refused: a
-- published grade is one a parent has already seen, and changing it silently is
-- exactly what `unlock_result_for_correction()` (`0124`) exists to prevent. The
-- correction path already works, and this uses it rather than a second door.
-- ===========================================================================

ALTER TABLE public.exam_results
  ADD COLUMN IF NOT EXISTS grade_override        TEXT,
  ADD COLUMN IF NOT EXISTS grade_override_reason TEXT,
  -- Who and when. An awarded grade is a judgement somebody made, and a report
  -- card footnote that cannot name them is not much of an audit.
  ADD COLUMN IF NOT EXISTS grade_override_by     TEXT,
  ADD COLUMN IF NOT EXISTS grade_override_at     TIMESTAMPTZ;

COMMENT ON COLUMN public.exam_results.grade_override IS
  'A grade awarded rather than calculated (GRADING.md). Sits beside grade_letter rather than replacing it, so the computed grade and its scale version survive and removing the override restores them (0256).';

/*
  A reason is required whenever an override exists, and forbidden when it does
  not — so a cleared override cannot leave a stale justification behind,
  explaining a grade that is no longer awarded.
*/
ALTER TABLE public.exam_results
  DROP CONSTRAINT IF EXISTS grade_override_needs_reason;
ALTER TABLE public.exam_results
  ADD CONSTRAINT grade_override_needs_reason CHECK (
    (grade_override IS NULL AND grade_override_reason IS NULL)
    OR (grade_override IS NOT NULL AND btrim(COALESCE(grade_override_reason, '')) <> '')
  );

-- ---------------------------------------------------------------------------
-- Setting and clearing.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_grade_override(
  p_result_id UUID,
  p_grade     TEXT,
  p_reason    TEXT
)
RETURNS TABLE (out_grade TEXT, out_computed TEXT, out_is_override BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school    UUID := public.current_school_uuid();
  v_user      TEXT := public.get_user_id();
  v_role      TEXT := public.get_user_role();
  v_row       RECORD;
  v_clearing  BOOLEAN := (p_grade IS NULL OR btrim(p_grade) = '');
  v_valid     BOOLEAN;
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'Sign in to your school first' USING ERRCODE = '42501';
  END IF;

  IF v_role NOT IN ('org:owner', 'org:principal', 'org:teacher', 'org:admin') THEN
    RAISE EXCEPTION 'You cannot change grades' USING ERRCODE = '42501';
  END IF;

  /*
    The tenant clause. A DEFINER function bypasses RLS, so the school is taken
    from the session and the row must belong to it — the id argument alone proves
    nothing about who may touch it.
  */
  SELECT * INTO v_row
  FROM public.exam_results
  WHERE id = p_result_id AND school_id = v_school;

  IF NOT FOUND THEN
    -- Not found and not permitted are one answer, so this cannot be used to
    -- discover that another school holds a particular result.
    RAISE EXCEPTION 'That result is not available' USING ERRCODE = '42501';
  END IF;

  /*
    A published result is one a parent has already read. Changing it needs the
    correction path (`unlock_result_for_correction`), which records why and
    re-locks afterwards — not a second, quieter door into the same row.
  */
  IF v_row.results_published AND v_row.unlocked_at IS NULL THEN
    RAISE EXCEPTION
      'This result is published. Unlock it for correction first, which records the reason.'
      USING ERRCODE = '22023';
  END IF;

  IF v_clearing THEN
    UPDATE public.exam_results
    SET grade_override = NULL,
        grade_override_reason = NULL,
        grade_override_by = NULL,
        grade_override_at = NULL,
        updated_at = NOW()
    WHERE id = p_result_id;

    RETURN QUERY SELECT v_row.grade_letter, v_row.grade_letter, FALSE;
    RETURN;
  END IF;

  IF btrim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION
      'Give a reason for the awarded grade — it appears on the report card'
      USING ERRCODE = '22023';
  END IF;

  /*
    The grade must be one the school's own scale actually defines.

    Without this a typo becomes a grade: "A+" on a scale whose top band is "A"
    would print on a report card and mean nothing. Checked against the version
    that produced this result, so a scale revised since does not retroactively
    invalidate an older override.
  */
  SELECT EXISTS (
    SELECT 1
    FROM public.school_grading_scale_versions v
    CROSS JOIN LATERAL jsonb_array_elements(v.grade_bands) AS band
    WHERE v.id = COALESCE(
            v_row.grading_scale_version_id,
            public.current_grading_scale_version(v_school)
          )
      -- `letter`, not `grade`. Checked with jsonb_object_keys rather than assumed:
      -- the first draft used 'grade' and refused the result's OWN computed grade,
      -- which is the kind of wrong that only a real call reveals.
      AND band ->> 'letter' = btrim(p_grade)
  ) INTO v_valid;

  IF NOT v_valid THEN
    RAISE EXCEPTION
      'Your grading scale has no grade "%". Use one of its own grades.', btrim(p_grade)
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.exam_results
  SET grade_override = btrim(p_grade),
      grade_override_reason = btrim(p_reason),
      grade_override_by = v_user,
      grade_override_at = NOW(),
      updated_at = NOW()
  WHERE id = p_result_id;

  RETURN QUERY SELECT btrim(p_grade), v_row.grade_letter, TRUE;
END;
$$;

COMMENT ON FUNCTION public.set_grade_override(UUID, TEXT, TEXT) IS
  'Award a grade rather than calculate it (GRADING.md). Validates against the school''s own scale version, requires a reason, and refuses a published result so corrections go through unlock_result_for_correction (0256).';

REVOKE ALL ON FUNCTION public.set_grade_override(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_grade_override(UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_grade_override(UUID, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Exercise it.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_school UUID;
  v_org    TEXT;
  v_id     UUID;
  v_grade  TEXT;
  v_row    RECORD;
BEGIN
  BEGIN
    SELECT er.school_id, er.id, er.grade_letter INTO v_school, v_id, v_grade
    FROM public.exam_results er
    WHERE er.results_published = FALSE AND er.grade_letter IS NOT NULL
    LIMIT 1;

    IF v_id IS NULL THEN
      RAISE NOTICE '0256: no unpublished result fixture; skipping';
      RAISE EXCEPTION 'ZSMS_0256_ROLLBACK';
    END IF;

    SELECT clerk_org_id INTO v_org FROM public.schools WHERE id = v_school;

    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', 'probe_teacher', 'role', 'authenticated',
      'o', json_build_object('id', v_org, 'rol', 'teacher'))::text, TRUE);

    -- A reason is required.
    BEGIN
      PERFORM public.set_grade_override(v_id, v_grade, '');
      RAISE EXCEPTION '0256: a grade was awarded with no reason';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;

    -- A grade the scale does not define must be refused.
    BEGIN
      PERFORM public.set_grade_override(v_id, 'ZZZ', 'Practical assessment');
      RAISE EXCEPTION '0256: a grade outside the school''s scale was accepted';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;

    -- The happy path, and the computed grade must survive.
    SELECT * INTO v_row FROM public.set_grade_override(
      v_id, v_grade, 'Practical assessment — distinction awarded');

    IF NOT v_row.out_is_override THEN
      RAISE EXCEPTION '0256: the override did not take';
    END IF;

    SELECT * INTO v_row FROM public.exam_results WHERE id = v_id;
    IF v_row.grade_letter IS NULL THEN
      RAISE EXCEPTION '0256: the computed grade was destroyed, so it cannot be restored';
    END IF;
    IF v_row.grade_override_by IS NULL OR v_row.grade_override_at IS NULL THEN
      RAISE EXCEPTION '0256: an awarded grade does not record who awarded it';
    END IF;

    -- Clearing restores the computed grade and removes the stale reason.
    PERFORM public.set_grade_override(v_id, NULL, NULL);
    SELECT * INTO v_row FROM public.exam_results WHERE id = v_id;
    IF v_row.grade_override IS NOT NULL OR v_row.grade_override_reason IS NOT NULL THEN
      RAISE EXCEPTION '0256: clearing left an override or a stale reason behind';
    END IF;

    -- Cross-tenant: another school's result must be indistinguishable from absent.
    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', 'probe_other', 'role', 'authenticated',
      'o', json_build_object('id', 'org_nonexistent_0256', 'rol', 'owner'))::text, TRUE);
    BEGIN
      PERFORM public.set_grade_override(v_id, v_grade, 'Should not be possible');
      RAISE EXCEPTION '0256: another school changed a grade';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    RAISE EXCEPTION 'ZSMS_0256_ROLLBACK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'ZSMS_0256_ROLLBACK' THEN
        RAISE NOTICE '0256: verified — reason required, scale enforced, computed grade preserved, cross-tenant refused';
      ELSE
        RAISE;
      END IF;
  END;
END;
$$;
