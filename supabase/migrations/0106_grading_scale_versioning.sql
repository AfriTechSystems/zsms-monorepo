-- Migration: 0106_grading_scale_versioning.sql
-- Created: 2026-09-26
-- Description: Closes ADR-041. A stored grade now records the grading-scale
--              version that produced it, so a scale revision leaves historical
--              results explainable instead of unexplainable.
-- Related documents: Official Documentation/01 Foundation Layer/DECISIONS.md — ADR-041, ADR-020
--                    Official Documentation/11 Examinations and Results/
--                    Official Documentation/01 Foundation Layer/DYNAMIC_CONFIG.md
--
-- ===========================================================================
-- THE DEFECT
--
-- `exam_results` stored `grade_letter` and `grade_points` and nothing about the
-- scale that produced them. A school that moves its distinction boundary from
-- 80 to 75 in August makes every grade awarded in March unexplainable: the
-- letter says "A", the scale on file says an A needs 75, and nothing records
-- that in March it needed 80. A parent disputing a grade cannot be answered,
-- and neither can an auditor.
--
-- THE SHAPE, AND WHAT IT MIRRORS
--
-- ADR-041 names the precedent: `afritech.score_config` versions loan scoring so
-- a historical behaviour score stays explainable after weights change, and an
-- application records the `config_version` it was scored under (ADR-020, whose
-- operative phrase is "snapshot calculated at application time only").
--
-- One honest caveat, because this file would otherwise imply more than is true:
-- `afritech.score_config` **does not exist in this schema.** It is documented in
-- DYNAMIC_CONFIG.md and referenced by two ADRs, and the loan module is unbuilt.
-- So what follows mirrors a documented *design*, not working code — exactly the
-- "verify against the applied schema" trap CLAUDE.md warns about, noted here so
-- the next reader does not go looking for a table to copy.
--
-- THE DECISION THAT ADR-041 LEFT OPEN
--
-- The ADR deferred on "whether published results are ever recomputed". Settled
-- here: **they are not.** A published grade is a statement of record that has
-- reached a parent. Silently restating it because a boundary moved is worse
-- than a stale grade, and recomputation would make the version column
-- decorative — it exists so an old grade can be EXPLAINED, never so it can be
-- quietly changed. A genuine error is corrected by an explicit, attributed
-- re-grade, not by a background job. This is ADR-020's snapshot rule applied to
-- marks.
--
-- WHY A SEPARATE VERSIONS TABLE RATHER THAN A `version` COLUMN
--
-- ADR-041 sketched both. A version column means a revision creates a new scale
-- row with a new id, and `school_subjects.grading_scale_id` — a live FK — would
-- need repointing on every revision. So the scale keeps a stable identity
-- ("ECZ Primary" is the same scale across revisions) and the bands move into
-- immutable per-version snapshots.
-- ===========================================================================

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- 1. The versions table — an immutable snapshot of what a scale meant.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_grading_scale_versions (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id           UUID NOT NULL REFERENCES public.schools(id),
  grading_scale_id    UUID NOT NULL REFERENCES public.school_grading_scales(id),

  version_number      INT  NOT NULL CHECK (version_number >= 1),

  -- The snapshot. Same shape as `school_grading_scales.grade_bands`:
  -- an array of {letter, min, max, points, descriptor}.
  grade_bands         JSONB NOT NULL,

  pass_mark           NUMERIC(5,2),
  credit_mark         NUMERIC(5,2),
  -- NUMERIC, never FLOAT — CONVENTIONS.md prohibition 5. The rule is written
  -- for money, and a grade boundary is exactly as unforgiving of rounding
  -- drift: 79.995 must not become a distinction.

  -- Why this version was created. Required for a revision, because a boundary
  -- change nobody can explain is the problem this migration exists to fix.
  revision_reason     TEXT,
  created_by_user_id  TEXT,

  effective_from      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_at       TIMESTAMPTZ,
  -- NULL means current. Exactly one such row per scale, enforced below.

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (grading_scale_id, version_number),

  -- A revision must say why. Version 1 is the original scale, not a revision,
  -- so it is exempt — there is no prior state to justify departing from.
  CONSTRAINT grading_scale_versions_revision_has_reason CHECK (
    version_number = 1 OR revision_reason IS NOT NULL
  ),

  CONSTRAINT grading_scale_versions_superseded_after_effective CHECK (
    superseded_at IS NULL OR superseded_at >= effective_from
  )
);

CREATE INDEX IF NOT EXISTS idx_school_grading_scale_versions_scale
  ON public.school_grading_scale_versions(grading_scale_id);

CREATE INDEX IF NOT EXISTS idx_school_grading_scale_versions_school
  ON public.school_grading_scale_versions(school_id);

-- Exactly one current version per scale. Partial on `superseded_at IS NULL`
-- so the full revision history stays legal while "which one is live" cannot
-- become ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS idx_school_grading_scale_versions_one_current
  ON public.school_grading_scale_versions(grading_scale_id)
  WHERE superseded_at IS NULL;

COMMENT ON TABLE public.school_grading_scale_versions IS
  'Immutable snapshots of a grading scale. A revision creates a new row; rows '
  'that have graded anything can never be edited. exam_results.grading_scale_version_id '
  'points here so a historical grade stays explainable. See ADR-041.';

-- ---------------------------------------------------------------------------
-- 2. Backfill — version 1 for every scale that already exists.
--
--    This is the only backfill that is honest. The bands currently on the scale
--    ARE what produced any grade awarded so far, because there has been no way
--    to revise them without overwriting. Existing results are attached to this
--    version in step 4.
-- ---------------------------------------------------------------------------
INSERT INTO public.school_grading_scale_versions
  (school_id, grading_scale_id, version_number, grade_bands, pass_mark,
   credit_mark, revision_reason, effective_from, created_at)
SELECT s.school_id, s.id, 1, s.grade_bands, s.pass_mark, s.credit_mark,
       NULL, s.created_at, s.created_at
FROM   public.school_grading_scales s
WHERE  NOT EXISTS (
  SELECT 1 FROM public.school_grading_scale_versions v
  WHERE v.grading_scale_id = s.id
);

-- ---------------------------------------------------------------------------
-- 3. The link from a result to its explanation.
-- ---------------------------------------------------------------------------
ALTER TABLE public.exam_results
  ADD COLUMN IF NOT EXISTS grading_scale_version_id UUID
    REFERENCES public.school_grading_scale_versions(id);

CREATE INDEX IF NOT EXISTS idx_exam_results_grading_scale_version
  ON public.exam_results(grading_scale_version_id);

COMMENT ON COLUMN public.exam_results.grading_scale_version_id IS
  'The scale version that produced grade_letter/grade_points. NULL means the '
  'row predates ADR-041 and its grade cannot be explained — deliberately '
  'distinguishable from a known scale rather than backfilled with a guess.';

-- ---------------------------------------------------------------------------
-- 4. Attach existing graded results to version 1 of their subject's scale.
--
--    Only where the subject actually names a scale. Where it does not, the
--    column stays NULL: a NULL that means "we do not know" is worth far more
--    than a plausible id that means "we guessed", which is precisely the
--    unexplainable state ADR-041 is about.
-- ---------------------------------------------------------------------------
UPDATE public.exam_results r
SET    grading_scale_version_id = v.id
FROM   public.school_subjects sub
JOIN   public.school_grading_scale_versions v
       ON v.grading_scale_id = sub.grading_scale_id
      AND v.version_number = 1
WHERE  r.grading_scale_version_id IS NULL
  AND  r.grade_letter IS NOT NULL
  AND  sub.school_id = r.school_id
  AND  sub.subject_code = r.subject_code
  AND  sub.grading_scale_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. A version that has graded anything is frozen.
--
--    AFTER, not BEFORE. CLAUDE.md's rule from migration 0101: a trigger whose
--    message describes tenant state must run after the policy has decided the
--    caller is entitled to hear it. This one says a version is in use, which is
--    a fact about the school's own data.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_used_grading_scale_version_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Superseding a version is the one permitted change: it retires the version
  -- without altering what it meant. Everything else rewrites history.
  IF TG_OP = 'UPDATE'
     AND NEW.grade_bands     IS NOT DISTINCT FROM OLD.grade_bands
     AND NEW.pass_mark       IS NOT DISTINCT FROM OLD.pass_mark
     AND NEW.credit_mark     IS NOT DISTINCT FROM OLD.credit_mark
     AND NEW.version_number  IS NOT DISTINCT FROM OLD.version_number
     AND NEW.effective_from  IS NOT DISTINCT FROM OLD.effective_from THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.exam_results
    WHERE grading_scale_version_id = OLD.id
  ) THEN
    RAISE EXCEPTION
      'This grading scale version has already been used to grade results and '
      'cannot be changed. Create a new version instead — revise_grading_scale().'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS reject_change_on_school_grading_scale_versions
  ON public.school_grading_scale_versions;
CREATE TRIGGER reject_change_on_school_grading_scale_versions
  AFTER UPDATE OR DELETE ON public.school_grading_scale_versions
  FOR EACH ROW EXECUTE FUNCTION public.reject_used_grading_scale_version_change();

-- ---------------------------------------------------------------------------
-- 6. The scale's own band columns become derived, and stop being writable.
--
--    `school_grading_scales.grade_bands` is kept as a mirror of the current
--    version so existing readers keep working. Two copies of the same truth is
--    a divergence waiting to happen, so the copy is maintained here and a
--    direct write to it is refused with a pointer to the function that does it
--    properly. Without this guard the mirror could silently disagree with the
--    version every result points at — which is the original defect wearing a
--    different hat.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_direct_grading_band_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current public.school_grading_scale_versions;
BEGIN
  IF NEW.grade_bands IS NOT DISTINCT FROM OLD.grade_bands
     AND NEW.pass_mark IS NOT DISTINCT FROM OLD.pass_mark
     AND NEW.credit_mark IS NOT DISTINCT FROM OLD.credit_mark THEN
    RETURN NULL;
  END IF;

  -- The mirror is allowed to move to AGREE with the current version, which is
  -- what revise_grading_scale() does on its last statement. Anything else is a
  -- band change that skipped versioning.
  --
  -- Phrased as "must match the current version" rather than "only the revise
  -- function may write" on purpose: a flag saying "I am the revise function"
  -- is something any caller can set, so the guard would be decorative. This
  -- version cannot be bypassed, because satisfying it requires having created
  -- the version first — which is the thing we actually want.
  SELECT * INTO v_current
  FROM   public.school_grading_scale_versions
  WHERE  grading_scale_id = NEW.id
    AND  superseded_at IS NULL;

  IF FOUND
     AND NEW.grade_bands IS NOT DISTINCT FROM v_current.grade_bands
     AND NEW.pass_mark   IS NOT DISTINCT FROM v_current.pass_mark
     AND NEW.credit_mark IS NOT DISTINCT FROM v_current.credit_mark THEN
    RETURN NULL;
  END IF;

  RAISE EXCEPTION
    'Grade bands are versioned and cannot be edited in place. Use '
    'revise_grading_scale(scale_id, bands, pass_mark, credit_mark, reason), '
    'which creates a new version and leaves existing results explainable.'
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS reject_band_write_on_school_grading_scales
  ON public.school_grading_scales;
CREATE TRIGGER reject_band_write_on_school_grading_scales
  AFTER UPDATE ON public.school_grading_scales
  FOR EACH ROW EXECUTE FUNCTION public.reject_direct_grading_band_write();

COMMENT ON COLUMN public.school_grading_scales.grade_bands IS
  'DERIVED — a mirror of the current version in school_grading_scale_versions, '
  'maintained by revise_grading_scale(). Not directly writable (ADR-041).';

-- ---------------------------------------------------------------------------
-- 7. Resolving and applying a scale.
-- ---------------------------------------------------------------------------

-- The version in force for a scale right now.
CREATE OR REPLACE FUNCTION public.current_grading_scale_version(p_scale_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT id FROM public.school_grading_scale_versions
  WHERE  grading_scale_id = p_scale_id
    AND  superseded_at IS NULL;
$$;

-- The version in force for a given subject right now.
CREATE OR REPLACE FUNCTION public.current_subject_scale_version(
  p_school_id UUID, p_subject_code TEXT
)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT v.id
  FROM   public.school_subjects s
  JOIN   public.school_grading_scale_versions v
         ON v.grading_scale_id = s.grading_scale_id
        AND v.superseded_at IS NULL
  WHERE  s.school_id = p_school_id
    AND  s.subject_code = p_subject_code
    AND  s.is_active
  LIMIT  1;
$$;

/**
 * The grade a mark earns under one specific version.
 *
 * Takes a version id rather than a scale id, on purpose: this is the function
 * that must be able to answer "what did this mark mean in March", and a scale
 * id would always resolve to today's answer.
 *
 * Bands are matched on percentage, so a subject marked out of 30 and one marked
 * out of 100 use the same boundaries.
 */
CREATE OR REPLACE FUNCTION public.grade_from_scale_version(
  p_version_id     UUID,
  p_marks_obtained NUMERIC,
  p_marks_total    NUMERIC
)
RETURNS TABLE (grade_letter TEXT, grade_points INT)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bands JSONB;
  v_pct   NUMERIC;
BEGIN
  IF p_version_id IS NULL OR p_marks_obtained IS NULL OR p_marks_total IS NULL
     OR p_marks_total <= 0 THEN
    RETURN;
  END IF;

  SELECT grade_bands INTO v_bands
  FROM   public.school_grading_scale_versions
  WHERE  id = p_version_id;

  IF v_bands IS NULL THEN
    RETURN;
  END IF;

  -- Rounded to two places before comparison. An unrounded 79.9999 from NUMERIC
  -- division must not miss an 80 boundary by a rounding artefact.
  v_pct := ROUND((p_marks_obtained / p_marks_total) * 100, 2);

  RETURN QUERY
  SELECT (b->>'letter')::TEXT,
         NULLIF(b->>'points', '')::INT
  FROM   jsonb_array_elements(v_bands) AS b
  WHERE  v_pct >= COALESCE((b->>'min')::NUMERIC, 0)
    AND  v_pct <= COALESCE((b->>'max')::NUMERIC, 100)
  -- Highest matching band wins, so overlapping bands degrade to a defined
  -- answer rather than an arbitrary one.
  ORDER BY COALESCE((b->>'min')::NUMERIC, 0) DESC
  LIMIT 1;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Revising a scale — the only way to change what a grade means.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revise_grading_scale(
  p_scale_id    UUID,
  p_grade_bands JSONB,
  p_pass_mark   NUMERIC DEFAULT NULL,
  p_credit_mark NUMERIC DEFAULT NULL,
  p_reason      TEXT    DEFAULT NULL
)
RETURNS public.school_grading_scale_versions
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_scale   public.school_grading_scales;
  v_next    INT;
  v_new     public.school_grading_scale_versions;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION
      'A scale revision must say why. Every grade already awarded keeps its '
      'old version, and the reason is what explains the difference.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_grade_bands IS NULL OR jsonb_typeof(p_grade_bands) <> 'array'
     OR jsonb_array_length(p_grade_bands) = 0 THEN
    RAISE EXCEPTION 'Grade bands must be a non-empty array.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- RLS on school_grading_scales decides whether this caller may see the scale
  -- at all; a scale belonging to another school simply is not found.
  SELECT * INTO v_scale FROM public.school_grading_scales WHERE id = p_scale_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Grading scale not found.' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next
  FROM   public.school_grading_scale_versions
  WHERE  grading_scale_id = p_scale_id;

  -- Retire the current version first. The partial unique index guarantees there
  -- is at most one, and would reject the insert below if this were skipped.
  UPDATE public.school_grading_scale_versions
  SET    superseded_at = NOW()
  WHERE  grading_scale_id = p_scale_id
    AND  superseded_at IS NULL;

  INSERT INTO public.school_grading_scale_versions
    (school_id, grading_scale_id, version_number, grade_bands, pass_mark,
     credit_mark, revision_reason, created_by_user_id)
  VALUES
    (v_scale.school_id, p_scale_id, v_next, p_grade_bands, p_pass_mark,
     p_credit_mark, btrim(p_reason),
     NULLIF(btrim(COALESCE(current_setting('request.jwt.claims', true), '')), '')::JSONB->>'sub')
  RETURNING * INTO v_new;

  -- Keep the derived mirror in step. This passes the guard trigger precisely
  -- because the new version now exists and these values match it — the ordering
  -- is load-bearing, not incidental.
  UPDATE public.school_grading_scales
  SET    grade_bands = p_grade_bands,
         pass_mark   = p_pass_mark,
         credit_mark = p_credit_mark
  WHERE  id = p_scale_id;

  RETURN v_new;
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. RLS. A new table without a policy is a defect (prohibition 4).
-- ---------------------------------------------------------------------------
ALTER TABLE public.school_grading_scale_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_grading_scale_versions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "afritech_admin_all_grading_scale_versions"
  ON public.school_grading_scale_versions;
CREATE POLICY "afritech_admin_all_grading_scale_versions"
ON public.school_grading_scale_versions FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

-- Every member of staff reads versions. A teacher entering marks needs the
-- bands, and a parent disputing a grade is answered by someone who can see what
-- the scale said at the time.
DROP POLICY IF EXISTS "school_staff_read_grading_scale_versions"
  ON public.school_grading_scale_versions;
CREATE POLICY "school_staff_read_grading_scale_versions"
ON public.school_grading_scale_versions FOR SELECT
USING (school_id = current_school_uuid());

-- Writing is management only, and matches who may write the scale itself in
-- 0008 — a revision is a change to what a grade means.
DROP POLICY IF EXISTS "management_write_grading_scale_versions"
  ON public.school_grading_scale_versions;
CREATE POLICY "management_write_grading_scale_versions"
ON public.school_grading_scale_versions FOR INSERT
WITH CHECK (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
);

DROP POLICY IF EXISTS "management_supersede_grading_scale_versions"
  ON public.school_grading_scale_versions;
CREATE POLICY "management_supersede_grading_scale_versions"
ON public.school_grading_scale_versions FOR UPDATE
USING (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
)
WITH CHECK (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
);

-- No DELETE policy, deliberately. A version is the explanation of every grade
-- that points at it; deleting one re-creates exactly the defect this migration
-- closes. The trigger in step 5 refuses it for used versions; the absence of a
-- policy refuses it for the rest.

REVOKE ALL ON public.school_grading_scale_versions FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.school_grading_scale_versions TO authenticated;

GRANT EXECUTE ON FUNCTION public.current_grading_scale_version(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_subject_scale_version(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.grade_from_scale_version(UUID, NUMERIC, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revise_grading_scale(UUID, JSONB, NUMERIC, NUMERIC, TEXT) TO authenticated;

-- === MIGRATION END ===
