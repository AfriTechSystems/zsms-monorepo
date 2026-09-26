-- Migration: 0107_grading_scale_first_version.sql
-- Created: 2026-09-26
-- Description: Every grading scale gets version 1 the moment it is created.
--              Closes a gap left by 0106, which backfilled existing scales but
--              left newly created ones with no version at all.
-- Related documents: Official Documentation/01 Foundation Layer/DECISIONS.md — ADR-041
--
-- ===========================================================================
-- WHAT 0106 MISSED
--
-- 0106 gave every *existing* scale a version 1 and made the versions table the
-- source of truth for what a grade means. It did not make a new scale create
-- one. So a school adding "Cambridge A-Level" after that migration got a scale
-- whose `current_grading_scale_version()` was NULL — and since a mark can only
-- be graded through a version, the scale silently could not grade anything.
--
-- Found by probing the applied schema rather than re-reading the migration:
-- inserting a scale and counting the versions it produced. Zero.
--
-- THE RULE THIS ESTABLISHES
--
-- "Every scale has exactly one current version" is an invariant, and an
-- invariant that depends on every caller remembering a second INSERT is not an
-- invariant. It belongs in the database, so it is a trigger rather than a note
-- in an API route.
-- ===========================================================================

-- === MIGRATION START ===

CREATE OR REPLACE FUNCTION public.create_initial_grading_scale_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
-- SECURITY DEFINER because the row is written on the caller's behalf as part
-- of creating the scale, and the INSERT policy on the versions table checks the
-- caller's role a second time for a row they did not ask to write. Whoever was
-- entitled to create the scale is by definition entitled to its version 1 —
-- the two are one act. `school_id` is copied from the scale row, never taken
-- from the caller, so this cannot write into another tenant.
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.school_grading_scale_versions
    (school_id, grading_scale_id, version_number, grade_bands, pass_mark,
     credit_mark, revision_reason, effective_from, created_at)
  VALUES
    (NEW.school_id, NEW.id, 1, NEW.grade_bands, NEW.pass_mark, NEW.credit_mark,
     -- Version 1 is the scale as created, not a revision, so it carries no
     -- reason — matching the CHECK in 0106 that exempts it.
     NULL, NEW.created_at, NEW.created_at);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS create_first_version_on_school_grading_scales
  ON public.school_grading_scales;
CREATE TRIGGER create_first_version_on_school_grading_scales
  AFTER INSERT ON public.school_grading_scales
  FOR EACH ROW EXECUTE FUNCTION public.create_initial_grading_scale_version();

-- Catch any scale created between 0106 and this migration.
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

COMMENT ON FUNCTION public.create_initial_grading_scale_version() IS
  'Gives every new grading scale its version 1. Without it a scale resolves to '
  'no current version and cannot grade anything (ADR-041).';

-- === MIGRATION END ===
