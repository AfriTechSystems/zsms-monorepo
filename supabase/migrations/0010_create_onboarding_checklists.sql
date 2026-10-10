-- Migration: 0010_create_onboarding_checklists.sql
-- Created: 2026-08-14
-- Description: Tracks onboarding progress per school. One row per checklist item.
-- Related documents: Official Documentation/05 Core Database and API Reference/SCHEMA.md
--                    Official Documentation/15 Super Admin and Platform/ONBOARDING.md

-- === MIGRATION START ===

CREATE TABLE IF NOT EXISTS public.onboarding_checklists (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id     UUID NOT NULL REFERENCES public.schools(id),

  item_key      TEXT NOT NULL
                CHECK (item_key IN (
                  'school_profile', 'grade_structure', 'grading_system',
                  'subjects', 'fee_structure', 'first_student', 'first_staff',
                  'payment_gateway', 'logo', 'term_dates'
                )),

  is_complete   BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at  TIMESTAMPTZ,
  completed_by  TEXT,
  -- Clerk user ID.

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (school_id, item_key)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_checklists_school
  ON public.onboarding_checklists(school_id, is_complete);

DROP TRIGGER IF EXISTS update_timestamp_on_onboarding_checklists ON public.onboarding_checklists;
CREATE TRIGGER update_timestamp_on_onboarding_checklists
  BEFORE UPDATE ON public.onboarding_checklists
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.onboarding_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_checklists FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "afritech_admin_all_onboarding" ON public.onboarding_checklists;
CREATE POLICY "afritech_admin_all_onboarding"
ON public.onboarding_checklists FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

DROP POLICY IF EXISTS "school_staff_read_onboarding" ON public.onboarding_checklists;
CREATE POLICY "school_staff_read_onboarding"
ON public.onboarding_checklists FOR SELECT
USING (
  school_id = current_school_uuid()
);

DROP POLICY IF EXISTS "management_write_onboarding" ON public.onboarding_checklists;
CREATE POLICY "management_write_onboarding"
ON public.onboarding_checklists FOR ALL
USING (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
)
WITH CHECK (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
);

REVOKE ALL ON public.onboarding_checklists FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.onboarding_checklists TO authenticated;

-- === MIGRATION END ===
