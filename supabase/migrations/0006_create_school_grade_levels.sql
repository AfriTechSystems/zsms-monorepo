-- Migration: 0006_create_school_grade_levels.sql
-- Created: 2026-08-14
-- Description: The grade or form levels a school offers. Supersedes the simpler
--              grade_config approach and supports both Zambian education systems
--              running concurrently.
-- Related documents: Official Documentation/05 Core Database and API Reference/SCHEMA.md
--                    Official Documentation/04 Country and Configuration/ZM.md
--
-- NOTE: described in SCHEMA.md; no CREATE TABLE exists in DATABASE.md. Columns
-- derived from SCHEMA.md's documented key columns.

-- === MIGRATION START ===

CREATE TABLE IF NOT EXISTS public.school_grade_levels (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id         UUID NOT NULL REFERENCES public.schools(id),

  level_id          TEXT NOT NULL,
  -- E.g. 'grade_7', 'form_1'. students.grade_id carries this value.

  display_name      TEXT NOT NULL,
  -- What appears on report cards and in the UI. Transitioning schools use
  -- combined names such as 'Grade 7 / Form 1'.

  level_order       INT NOT NULL,
  level_type        TEXT NOT NULL
                    CHECK (level_type IN (
                      'primary', 'junior_secondary', 'senior_secondary', 'a_level'
                    )),
  examination_type  TEXT NOT NULL DEFAULT 'internal'
                    CHECK (examination_type IN ('ecz', 'cambridge', 'internal', 'none')),

  is_active         BOOLEAN NOT NULL DEFAULT TRUE,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (school_id, level_id)
);

CREATE INDEX IF NOT EXISTS idx_school_grade_levels_school
  ON public.school_grade_levels(school_id);
CREATE INDEX IF NOT EXISTS idx_school_grade_levels_school_active
  ON public.school_grade_levels(school_id, is_active);

DROP TRIGGER IF EXISTS update_timestamp_on_school_grade_levels ON public.school_grade_levels;
CREATE TRIGGER update_timestamp_on_school_grade_levels
  BEFORE UPDATE ON public.school_grade_levels
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.school_grade_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_grade_levels FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "afritech_admin_all_grade_levels" ON public.school_grade_levels;
CREATE POLICY "afritech_admin_all_grade_levels"
ON public.school_grade_levels FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

DROP POLICY IF EXISTS "school_staff_read_grade_levels" ON public.school_grade_levels;
CREATE POLICY "school_staff_read_grade_levels"
ON public.school_grade_levels FOR SELECT
USING (
  school_id = current_school_uuid()
);

DROP POLICY IF EXISTS "management_write_grade_levels" ON public.school_grade_levels;
CREATE POLICY "management_write_grade_levels"
ON public.school_grade_levels FOR ALL
USING (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
)
WITH CHECK (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
);

REVOKE ALL ON public.school_grade_levels FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.school_grade_levels TO authenticated;

-- === MIGRATION END ===
