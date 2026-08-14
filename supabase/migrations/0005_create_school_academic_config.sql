-- Migration: 0005_create_school_academic_config.sql
-- Created: 2026-08-14
-- Description: Per-school academic structure configuration, created during
--              onboarding and editable in settings. One row per school.
-- Related documents: Official Documentation/05 Core Database and API Reference/SCHEMA.md
--                    Official Documentation/06 School and Tenant Management/SCHOOL_CONFIG.md
--
-- NOTE: SCHEMA.md describes this table but DATABASE.md carries no CREATE TABLE
-- for it. Column definitions below are derived from SCHEMA.md's documented key
-- columns and the ZM curriculum values in 04 Country and Configuration/ZM.md.

-- === MIGRATION START ===

CREATE TABLE IF NOT EXISTS public.school_academic_config (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id               UUID NOT NULL UNIQUE REFERENCES public.schools(id),
  -- UNIQUE: one academic configuration per school.

  curriculum_type         TEXT NOT NULL DEFAULT 'ecz_grades'
                          CHECK (curriculum_type IN (
                            'ecz_grades', 'cambridge_forms', 'hybrid', 'custom'
                          )),
  -- Zambia runs two systems concurrently; most private schools are mid-transition.

  structure_type          TEXT,
  highest_level_offered   TEXT,

  grading_system          TEXT NOT NULL DEFAULT 'ecz_percentage'
                          CHECK (grading_system IN (
                            'ecz_percentage', 'cambridge_o_level',
                            'cambridge_a_level', 'custom'
                          )),

  report_card_format      TEXT,
  class_naming_convention TEXT,

  onboarding_complete     BOOLEAN NOT NULL DEFAULT FALSE,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_school_academic_config_school
  ON public.school_academic_config(school_id);

DROP TRIGGER IF EXISTS update_timestamp_on_school_academic_config ON public.school_academic_config;
CREATE TRIGGER update_timestamp_on_school_academic_config
  BEFORE UPDATE ON public.school_academic_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.school_academic_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_academic_config FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "afritech_admin_all_academic_config" ON public.school_academic_config;
CREATE POLICY "afritech_admin_all_academic_config"
ON public.school_academic_config FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

DROP POLICY IF EXISTS "school_staff_read_academic_config" ON public.school_academic_config;
CREATE POLICY "school_staff_read_academic_config"
ON public.school_academic_config FOR SELECT
USING (
  school_id = current_school_uuid()
);

DROP POLICY IF EXISTS "management_write_academic_config" ON public.school_academic_config;
CREATE POLICY "management_write_academic_config"
ON public.school_academic_config FOR ALL
USING (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
)
WITH CHECK (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
);

REVOKE ALL ON public.school_academic_config FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.school_academic_config TO authenticated;

-- === MIGRATION END ===
