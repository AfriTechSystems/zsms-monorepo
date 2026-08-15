-- Migration: 0018_create_permission_rls.sql
-- Created: 2026-08-14
-- Description: RLS policies for school_permissions and staff_permission_grants.
--              RLS was enabled on both in 0014; this migration supplies the
--              policies, closing the fail-closed window.
-- Related documents: Official Documentation/01 Foundation Layer/RLS.md
--                    Official Documentation/02 Authentication and Identity/PERMISSIONS.md
--
-- GAP: RLS.md specifies the staff_permission_grants SCHEMA and the grant
-- hierarchy in prose, but gives no policy bodies. These implement that prose:
--   - AfriTech super admin: unrestricted.
--   - Owner and principal: grant and revoke within their own school.
--   - Everyone else: may read grants naming them, and nothing more.
--
-- The grantee-read policy is load-bearing, not a convenience.
-- has_permission_grant() is a plain STABLE function, so it reads this table as
-- the calling user under RLS. Without a policy letting a grantee see their own
-- grants, that helper would return FALSE for everyone and every grant-based
-- override in the system would silently stop working — a failure that looks
-- like "permissions just don't apply" rather than an error.

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- school_permissions
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "afritech_admin_all_school_permissions" ON public.school_permissions;
CREATE POLICY "afritech_admin_all_school_permissions"
ON public.school_permissions FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

-- Any member of the school may read its permission matrix — the UI needs it to
-- decide what to render, and it describes the reader's own capabilities.
DROP POLICY IF EXISTS "school_staff_read_school_permissions" ON public.school_permissions;
CREATE POLICY "school_staff_read_school_permissions"
ON public.school_permissions FOR SELECT
USING (school_id = current_school_uuid());

-- Only owner and principal change what a role can do by default.
DROP POLICY IF EXISTS "management_write_school_permissions" ON public.school_permissions;
CREATE POLICY "management_write_school_permissions"
ON public.school_permissions FOR ALL
USING (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal')
)
WITH CHECK (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal')
);

-- ---------------------------------------------------------------------------
-- staff_permission_grants
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "afritech_admin_all_grants" ON public.staff_permission_grants;
CREATE POLICY "afritech_admin_all_grants"
ON public.staff_permission_grants FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

-- A grantee reads grants naming them. Required by has_permission_grant().
DROP POLICY IF EXISTS "grantee_read_own_grants" ON public.staff_permission_grants;
CREATE POLICY "grantee_read_own_grants"
ON public.staff_permission_grants FOR SELECT
USING (grantee_user_id = get_user_id());

-- Management read every grant issued at their school — this table is the audit
-- trail for privilege escalation, so it must be reviewable in full.
DROP POLICY IF EXISTS "management_read_grants" ON public.staff_permission_grants;
CREATE POLICY "management_read_grants"
ON public.staff_permission_grants FOR SELECT
USING (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
);

-- Only owner and principal issue grants, and only at their own school, and only
-- recording themselves as grantor. RLS.md: "a teacher cannot grant another
-- teacher additional access."
--
-- The grantor_user_id check matters: without it a principal could write another
-- user's ID into the grantor column and the audit trail would name the wrong
-- person for a privilege escalation.
DROP POLICY IF EXISTS "management_issue_grants" ON public.staff_permission_grants;
CREATE POLICY "management_issue_grants"
ON public.staff_permission_grants FOR INSERT
WITH CHECK (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal')
  AND grantor_user_id = get_user_id()
);

-- Revocation is an UPDATE (is_active = FALSE). Grants are never hard deleted —
-- the row is the audit record.
DROP POLICY IF EXISTS "management_revoke_grants" ON public.staff_permission_grants;
CREATE POLICY "management_revoke_grants"
ON public.staff_permission_grants FOR UPDATE
USING (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal')
)
WITH CHECK (
  school_id = current_school_uuid()
);

-- === MIGRATION END ===
