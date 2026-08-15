-- Migration: 0007_create_school_subjects.sql
-- Created: 2026-08-14
-- Description: Per-school subject registry. Populated from reference_subjects_zm
--              during onboarding, plus any custom subjects the school adds.
-- Related documents: Official Documentation/05 Core Database and API Reference/SCHEMA.md
--                    Official Documentation/04 Country and Configuration/ZM.md
--
-- NOTE: described in SCHEMA.md; no CREATE TABLE exists in DATABASE.md.

-- === MIGRATION START ===

CREATE TABLE IF NOT EXISTS public.school_subjects (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id         UUID NOT NULL REFERENCES public.schools(id),

  subject_code      TEXT NOT NULL,
  subject_name      TEXT NOT NULL,

  level_type        TEXT NOT NULL
                    CHECK (level_type IN ('primary', 'secondary', 'a_level')),

  is_core           BOOLEAN NOT NULL DEFAULT FALSE,

  curriculum_type   TEXT NOT NULL DEFAULT 'ecz'
                    CHECK (curriculum_type IN ('ecz', 'cambridge', 'both')),

  grading_scale_id  UUID,
  -- FK added in 0008, after school_grading_scales exists.

  is_active         BOOLEAN NOT NULL DEFAULT TRUE,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (school_id, subject_code, level_type)
);

CREATE INDEX IF NOT EXISTS idx_school_subjects_school
  ON public.school_subjects(school_id);
CREATE INDEX IF NOT EXISTS idx_school_subjects_school_active
  ON public.school_subjects(school_id, is_active);

DROP TRIGGER IF EXISTS update_timestamp_on_school_subjects ON public.school_subjects;
CREATE TRIGGER update_timestamp_on_school_subjects
  BEFORE UPDATE ON public.school_subjects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.school_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_subjects FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "afritech_admin_all_subjects" ON public.school_subjects;
CREATE POLICY "afritech_admin_all_subjects"
ON public.school_subjects FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

DROP POLICY IF EXISTS "school_staff_read_subjects" ON public.school_subjects;
CREATE POLICY "school_staff_read_subjects"
ON public.school_subjects FOR SELECT
USING (
  school_id = current_school_uuid()
);

DROP POLICY IF EXISTS "management_write_subjects" ON public.school_subjects;
CREATE POLICY "management_write_subjects"
ON public.school_subjects FOR ALL
USING (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
)
WITH CHECK (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
);

REVOKE ALL ON public.school_subjects FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.school_subjects TO authenticated;

-- === MIGRATION END ===
