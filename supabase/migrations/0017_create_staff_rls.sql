-- Migration: 0017_create_staff_rls.sql
-- Created: 2026-08-14
-- Description: RLS policies for staff_members, staff_assignments, and
--              staff_requests. Implemented from RLS.md.
-- Related documents: Official Documentation/01 Foundation Layer/RLS.md — staff tables
--
-- GAP: RLS.md defines policies for staff_members and staff_assignments but NOT
-- for staff_requests, even though MIGRATIONS.md schedules it in the same
-- migration. The policies below follow the same shape as its siblings —
-- management reads and decides within their own school, a requester sees only
-- their own request. Flagged so RLS.md can be updated to match rather than the
-- table quietly acquiring undocumented rules.

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- staff_members
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "afritech_admin_all_staff" ON public.staff_members;
CREATE POLICY "afritech_admin_all_staff"
ON public.staff_members FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

DROP POLICY IF EXISTS "management_read_staff" ON public.staff_members;
CREATE POLICY "management_read_staff"
ON public.staff_members FOR SELECT
USING (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
);

-- A staff member can always read their own row.
DROP POLICY IF EXISTS "staff_read_own_record" ON public.staff_members;
CREATE POLICY "staff_read_own_record"
ON public.staff_members FOR SELECT
USING (clerk_user_id = get_user_id());

DROP POLICY IF EXISTS "management_write_staff" ON public.staff_members;
CREATE POLICY "management_write_staff"
ON public.staff_members FOR ALL
USING (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal')
)
WITH CHECK (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal')
);

-- ---------------------------------------------------------------------------
-- staff_assignments
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "afritech_admin_all_assignments" ON public.staff_assignments;
CREATE POLICY "afritech_admin_all_assignments"
ON public.staff_assignments FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

DROP POLICY IF EXISTS "management_read_assignments" ON public.staff_assignments;
CREATE POLICY "management_read_assignments"
ON public.staff_assignments FOR SELECT
USING (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
);

-- Teachers read their own assignments, so they know which classes they hold.
DROP POLICY IF EXISTS "teacher_read_own_assignments" ON public.staff_assignments;
CREATE POLICY "teacher_read_own_assignments"
ON public.staff_assignments FOR SELECT
USING (staff_user_id = get_user_id());

DROP POLICY IF EXISTS "management_write_assignments" ON public.staff_assignments;
CREATE POLICY "management_write_assignments"
ON public.staff_assignments FOR ALL
USING (
  school_id = current_school_uuid()
  AND (
    get_user_role() IN ('org:owner', 'org:principal')
    OR has_permission_grant('assignments', 'write')
  )
)
WITH CHECK (
  school_id = current_school_uuid()
);

-- ---------------------------------------------------------------------------
-- staff_requests  (see GAP note above)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "afritech_admin_all_staff_requests" ON public.staff_requests;
CREATE POLICY "afritech_admin_all_staff_requests"
ON public.staff_requests FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

-- The requester sees their own request and its outcome. Scoped by Clerk user ID
-- rather than by school, because a requester is not yet an org member and so has
-- no org claim in their JWT to match against.
DROP POLICY IF EXISTS "requester_read_own_request" ON public.staff_requests;
CREATE POLICY "requester_read_own_request"
ON public.staff_requests FOR SELECT
USING (clerk_user_id = get_user_id());

DROP POLICY IF EXISTS "requester_insert_own_request" ON public.staff_requests;
CREATE POLICY "requester_insert_own_request"
ON public.staff_requests FOR INSERT
WITH CHECK (clerk_user_id = get_user_id());

DROP POLICY IF EXISTS "management_read_staff_requests" ON public.staff_requests;
CREATE POLICY "management_read_staff_requests"
ON public.staff_requests FOR SELECT
USING (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
);

-- Only owner and principal approve or reject, matching who may create staff.
DROP POLICY IF EXISTS "management_review_staff_requests" ON public.staff_requests;
CREATE POLICY "management_review_staff_requests"
ON public.staff_requests FOR UPDATE
USING (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal')
)
WITH CHECK (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal')
);

-- === MIGRATION END ===
