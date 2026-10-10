-- Migration: 0019_revoke_delete_privileges.sql
-- Created: 2026-08-15
-- Description: Removes the DELETE and TRUNCATE privileges that Supabase's
--              default grants hand to `authenticated` on every new table in
--              `public`.
-- Related documents: Official Documentation/01 Foundation Layer/CONVENTIONS.md — prohibition 8
--                    Official Documentation/01 Foundation Layer/RLS.md
--
-- WHY THIS EXISTS
-- ---------------
-- Found by the isolation suite, not by review. Two assertions failed:
--   - `authenticated holds no DELETE privilege on students`  (have 1, want 0)
--   - `owner A cannot hard-delete even their OWN student`    (no exception raised)
--
-- Supabase configures default privileges so that a newly created table in
-- `public` is granted ALL to `anon` and `authenticated`. Migrations 0003–0018
-- revoked that for `anon` but only ADDED `SELECT, INSERT, UPDATE` for
-- `authenticated` — which does not take away the DELETE it already had.
--
-- Nothing was destroyed. `students` has no DELETE policy, so RLS filtered the
-- delete to zero rows and the row survived (the suite verified this
-- separately). But the guarantee was resting on RLS alone, and two things make
-- that thin:
--
--   1. Policies written `FOR ALL` — `afritech_admin_all_students`,
--      `management_write_staff`, `school_management_links` — cover DELETE as
--      well as SELECT/INSERT/UPDATE. On those paths the privilege is live, so
--      an AfriTech super admin could hard-delete a student. Prohibition 8 says
--      that must be impossible for anyone.
--   2. A future `FOR ALL` policy added to any of these tables would silently
--      re-open hard deletes, with no test failing to say so.
--
-- Removing the privilege makes the prohibition structural: no policy, present
-- or future, can grant what the role does not hold.

-- === MIGRATION START ===

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'schools',
    'school_academic_config',
    'school_grade_levels',
    'school_subjects',
    'school_grading_scales',
    'reference_subjects_zm',
    'onboarding_checklists',
    'students',
    'parents',
    'student_parent_links',
    'school_permissions',
    'staff_permission_grants',
    'staff_members',
    'staff_assignments',
    'staff_requests'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('REVOKE DELETE, TRUNCATE ON public.%I FROM authenticated, anon', t);
  END LOOP;
END;
$$;

-- Also correct the default for every table created from here on, so the next
-- migration does not reintroduce the same gap by simply existing.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE DELETE, TRUNCATE ON TABLES FROM authenticated, anon;

-- Verification, inline. If this migration ever stops doing its job the failure
-- surfaces at apply time rather than in a later audit.
DO $$
DECLARE
  leaked INT;
BEGIN
  SELECT count(*) INTO leaked
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND grantee IN ('authenticated', 'anon')
    AND privilege_type IN ('DELETE', 'TRUNCATE');

  IF leaked > 0 THEN
    RAISE EXCEPTION
      'DELETE/TRUNCATE still granted in % place(s) — prohibition 8 is not enforced', leaked;
  END IF;
END;
$$;

-- === MIGRATION END ===
