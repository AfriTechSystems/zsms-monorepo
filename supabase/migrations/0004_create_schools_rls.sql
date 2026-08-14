-- Migration: 0004_create_schools_rls.sql
-- Created: 2026-08-14
-- Description: Applies RLS policies to public.schools. Implemented verbatim
--              from RLS.md, which is authoritative for every policy body.
-- Related documents: Official Documentation/01 Foundation Layer/RLS.md — schools table

-- === MIGRATION START ===

ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;

-- FORCE applies RLS to the table owner as well. Without it, any connection that
-- ends up as the owning role bypasses every policy below — which would make the
-- isolation tests pass against a boundary that does not hold in production.
ALTER TABLE public.schools FORCE ROW LEVEL SECURITY;

-- AfriTech super admin has full access to all schools.
DROP POLICY IF EXISTS "afritech_admin_all_schools" ON public.schools;
CREATE POLICY "afritech_admin_all_schools"
ON public.schools FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

-- School staff can read their own school record only.
DROP POLICY IF EXISTS "school_staff_read_own_school" ON public.schools;
CREATE POLICY "school_staff_read_own_school"
ON public.schools FOR SELECT
USING (clerk_org_id = get_school_id());

-- Only AfriTech super admin can create school records.
-- Schools do not create themselves in the database.
DROP POLICY IF EXISTS "only_admin_insert_school" ON public.schools;
CREATE POLICY "only_admin_insert_school"
ON public.schools FOR INSERT
WITH CHECK (is_afritech_admin());

-- School owners can update their own school's non-billing fields.
-- Billing fields (subscription_tier, subscription_ends_at) are restricted to
-- AfriTech admin at the application layer.
DROP POLICY IF EXISTS "owner_update_own_school" ON public.schools;
CREATE POLICY "owner_update_own_school"
ON public.schools FOR UPDATE
USING (
  clerk_org_id = get_school_id()
  AND get_user_role() IN ('org:owner')
)
WITH CHECK (
  clerk_org_id = get_school_id()
  AND get_user_role() IN ('org:owner')
);

-- No DELETE policy. Schools are never hard deleted. Status is set to
-- 'suspended' or 'terminated' by AfriTech admin only.

-- === MIGRATION END ===
