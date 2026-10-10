-- Migration: 0009_create_reference_subjects_zm.sql
-- Created: 2026-08-14
-- Description: Global, read-only reference list of Zambian curriculum subjects,
--              used as the suggestion list during school onboarding.
-- Related documents: Official Documentation/05 Core Database and API Reference/SCHEMA.md
--                    Official Documentation/04 Country and Configuration/ZM.md
--
-- This table has NO school_id and is deliberately NOT tenant-scoped: it is
-- shared reference data, identical for every Zambian school. It is readable by
-- any authenticated user and writable by AfriTech admin only.

-- === MIGRATION START ===

CREATE TABLE IF NOT EXISTS public.reference_subjects_zm (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  country_code     TEXT NOT NULL DEFAULT 'ZM'
                   CHECK (country_code ~ '^[A-Z]{2}$'),

  subject_code     TEXT NOT NULL,
  subject_name     TEXT NOT NULL,

  level_type       TEXT NOT NULL
                   CHECK (level_type IN ('primary', 'secondary', 'a_level')),

  is_core          BOOLEAN NOT NULL DEFAULT FALSE,

  curriculum_type  TEXT NOT NULL DEFAULT 'ecz'
                   CHECK (curriculum_type IN ('ecz', 'cambridge', 'both')),

  is_active        BOOLEAN NOT NULL DEFAULT TRUE,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (country_code, subject_code, level_type)
);

CREATE INDEX IF NOT EXISTS idx_reference_subjects_zm_lookup
  ON public.reference_subjects_zm(country_code, level_type, is_active);

-- Core subject seed. ZM.md carries the full curriculum list; the complete seed
-- lands with the onboarding module, which is what consumes it. Seeding the core
-- set here keeps the reference table non-empty for Phase 1 without committing a
-- partial list as if it were complete.
INSERT INTO public.reference_subjects_zm
  (country_code, subject_code, subject_name, level_type, is_core, curriculum_type)
VALUES
  ('ZM', 'ENG',  'English',                    'primary',   TRUE,  'ecz'),
  ('ZM', 'MAT',  'Mathematics',                'primary',   TRUE,  'ecz'),
  ('ZM', 'SCI',  'Integrated Science',         'primary',   TRUE,  'ecz'),
  ('ZM', 'SST',  'Social Studies',             'primary',   TRUE,  'ecz'),
  ('ZM', 'CTS',  'Creative and Technology Studies', 'primary', FALSE, 'ecz'),
  ('ZM', 'ZLA',  'Zambian Languages',          'primary',   FALSE, 'ecz'),
  ('ZM', 'ENG',  'English Language',           'secondary', TRUE,  'both'),
  ('ZM', 'MAT',  'Mathematics',                'secondary', TRUE,  'both'),
  ('ZM', 'BIO',  'Biology',                    'secondary', FALSE, 'both'),
  ('ZM', 'CHE',  'Chemistry',                  'secondary', FALSE, 'both'),
  ('ZM', 'PHY',  'Physics',                    'secondary', FALSE, 'both'),
  ('ZM', 'HIS',  'History',                    'secondary', FALSE, 'both'),
  ('ZM', 'GEO',  'Geography',                  'secondary', FALSE, 'both'),
  ('ZM', 'CIV',  'Civic Education',            'secondary', FALSE, 'ecz'),
  ('ZM', 'COM',  'Computer Studies',           'secondary', FALSE, 'both'),
  ('ZM', 'BUS',  'Business Studies',           'secondary', FALSE, 'both')
ON CONFLICT (country_code, subject_code, level_type) DO NOTHING;

ALTER TABLE public.reference_subjects_zm ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reference_subjects_zm FORCE ROW LEVEL SECURITY;

-- Readable by every authenticated user regardless of school. There is no tenant
-- data here, so there is no tenant boundary to enforce.
DROP POLICY IF EXISTS "authenticated_read_reference_subjects" ON public.reference_subjects_zm;
CREATE POLICY "authenticated_read_reference_subjects"
ON public.reference_subjects_zm FOR SELECT
USING (TRUE);

DROP POLICY IF EXISTS "afritech_admin_write_reference_subjects" ON public.reference_subjects_zm;
CREATE POLICY "afritech_admin_write_reference_subjects"
ON public.reference_subjects_zm FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

REVOKE ALL ON public.reference_subjects_zm FROM anon;
GRANT SELECT ON public.reference_subjects_zm TO authenticated;

-- === MIGRATION END ===
