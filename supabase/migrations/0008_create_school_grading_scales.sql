-- Migration: 0008_create_school_grading_scales.sql
-- Created: 2026-08-14
-- Description: Grading scale definitions per school. A school using ECZ
--              percentages for primary and Cambridge letters for secondary has
--              two rows. Also adds the deferred FK from school_subjects.
-- Related documents: Official Documentation/05 Core Database and API Reference/SCHEMA.md
--
-- NOTE: described in SCHEMA.md; no CREATE TABLE exists in DATABASE.md.

-- === MIGRATION START ===

CREATE TABLE IF NOT EXISTS public.school_grading_scales (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id          UUID NOT NULL REFERENCES public.schools(id),

  scale_name         TEXT NOT NULL,
  scale_type         TEXT NOT NULL
                     CHECK (scale_type IN ('percentage', 'letter', 'custom')),

  grade_bands        JSONB NOT NULL DEFAULT '[]'::JSONB,
  -- Array of {letter, min, max, points, descriptor}.

  pass_mark          NUMERIC(5,2),
  credit_mark        NUMERIC(5,2),
  -- NUMERIC, never FLOAT (CONVENTIONS.md prohibition 5 — the rule exists for
  -- money, and marks feed grade boundaries where rounding drift is equally bad).

  applies_to_levels  TEXT[] NOT NULL DEFAULT '{}',

  is_active          BOOLEAN NOT NULL DEFAULT TRUE,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (school_id, scale_name)
);

CREATE INDEX IF NOT EXISTS idx_school_grading_scales_school
  ON public.school_grading_scales(school_id);

DROP TRIGGER IF EXISTS update_timestamp_on_school_grading_scales ON public.school_grading_scales;
CREATE TRIGGER update_timestamp_on_school_grading_scales
  BEFORE UPDATE ON public.school_grading_scales
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Deferred FK from 0007, now that the target table exists.
ALTER TABLE public.school_subjects
  DROP CONSTRAINT IF EXISTS fk_school_subjects_grading_scale;
ALTER TABLE public.school_subjects
  ADD CONSTRAINT fk_school_subjects_grading_scale
  FOREIGN KEY (grading_scale_id) REFERENCES public.school_grading_scales(id);

ALTER TABLE public.school_grading_scales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_grading_scales FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "afritech_admin_all_grading_scales" ON public.school_grading_scales;
CREATE POLICY "afritech_admin_all_grading_scales"
ON public.school_grading_scales FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

DROP POLICY IF EXISTS "school_staff_read_grading_scales" ON public.school_grading_scales;
CREATE POLICY "school_staff_read_grading_scales"
ON public.school_grading_scales FOR SELECT
USING (
  school_id = current_school_uuid()
);

DROP POLICY IF EXISTS "management_write_grading_scales" ON public.school_grading_scales;
CREATE POLICY "management_write_grading_scales"
ON public.school_grading_scales FOR ALL
USING (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
)
WITH CHECK (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
);

REVOKE ALL ON public.school_grading_scales FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.school_grading_scales TO authenticated;

-- === MIGRATION END ===
