# RLS.md — Row Level Security Policies

## Related Documents

- `docs/ARCHITECTURE.md` — overall system architecture and multi-tenancy model
- `docs/DATABASE.md` — full schema definitions for every table referenced here
- `docs/CONVENTIONS.md` — naming conventions for policies, functions, and roles
- `docs/modules/auth/AUTH.md` — authentication flows and JWT structure
- `docs/modules/auth/ROLES.md` — Clerk role definitions and permission matrix
- `docs/modules/auth/PERMISSIONS.md` — staff_permission_grants table and grant flow
- `docs/modules/auth/SESSIONS.md` — session management, grace periods, expiry
- `docs/modules/loans/LOANS.md` — private schema access and loan module boundaries
- `docs/modules/admin/IMPERSONATION.md` — super admin impersonation and audit trail
- `docs/infra/SUPABASE.md` — Supabase project setup, migration process, schema config

---

## Purpose

This document defines every Row Level Security policy in the ZSMS database. It is the authoritative reference for how data access is enforced at the PostgreSQL engine level across all tables, schemas, and user roles. Every Claude Code session that creates or modifies database tables, adds new API routes, or changes authentication flows must read this document first.

RLS is ZSMS's primary security layer. It operates independently of the application layer — even if a bug exists in the Next.js API routes or Edge Functions, the database engine enforces these policies on every query and returns no data for unauthorised access. The application layer adds a second independent check, but RLS is the guarantee.

---

## Overview

### Design Philosophy

ZSMS RLS follows one governing principle: **permissive by explicit grant, restrictive by default**. Every role begins with the minimum access required to perform its primary job. Everything beyond that minimum requires an explicit, audited, time-bounded grant from an authorised user. There are no permanent "can never" restrictions based on role alone — any action can be unlocked through the grant system. But without an explicit grant, the default is no access.

This design accommodates the real operational reality of schools. Staff go on leave, roles are vacated, emergencies arise. The grant system allows a principal to give a teacher temporary accountant permissions for two weeks without changing the teacher's base role and without compromising the default security posture.

### Dual Enforcement Layer

Every data access in ZSMS is checked twice:

**Layer 1 — RLS at the database engine.** PostgreSQL evaluates the relevant policy on every query. If no policy permits the operation, the database returns zero rows for SELECT operations and throws a permission error for write operations. This layer cannot be bypassed by application code.

**Layer 2 — Application-level role check.** Every API route and Edge Function independently validates the user's Clerk role and checks the `staff_permission_grants` table before issuing any database query. This layer catches permission violations before they reach the database and returns structured error responses to the client.

Both layers must pass. Document both layers when implementing any new feature. RLS is not a fallback — it is a co-equal security control.

### Multi-Tenancy Enforcement

Every table in the `public` schema has a `school_id` column that is a foreign key to the `schools` table. RLS policies use this column as the primary tenant isolation mechanism. A user's JWT, issued by Clerk, contains their organisation ID — which equals the school's `clerk_org_id` in the `schools` table. The `get_school_id()` helper function extracts this from the JWT on every query.

A user at School A can never retrieve, modify, or delete data belonging to School B — not because the application prevents it, but because the database engine returns no matching rows when the `school_id` in the JWT does not match the `school_id` in the queried rows.

---

## Helper Functions

These functions are created once during database initialisation and used by every RLS policy. They must exist before any policy is created. Migration file: `supabase/migrations/0001_rls_helper_functions.sql`.

```sql
-- Returns the Clerk organisation ID from the current session JWT.
-- This value equals the school's clerk_org_id and is the primary tenant key.
CREATE OR REPLACE FUNCTION get_school_id()
RETURNS TEXT
LANGUAGE SQL STABLE
AS $$
  SELECT COALESCE(
    auth.jwt() -> 'o' ->> 'id',
    auth.jwt() ->> 'sub'
  )::TEXT;
$$;

-- Returns the user's Clerk role within their current organisation.
-- Canonical values per 02 Authentication and Identity/ROLES.md:
--   'org:owner' | 'org:principal' | 'org:admin' | 'org:accountant' |
--   'org:teacher' | 'org:staff' | 'org:parent' | 'org:student' | 'none'
-- 'org:staff' is the zero-default-access base role for custom-role holders
-- (ADR-012); its permissions come entirely from staff_permission_grants.
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT
LANGUAGE SQL STABLE
AS $$
  SELECT COALESCE(
    auth.jwt() -> 'o' ->> 'rol',
    'none'
  )::TEXT;
$$;

-- Returns the authenticated Clerk user ID (sub claim).
CREATE OR REPLACE FUNCTION get_user_id()
RETURNS TEXT
LANGUAGE SQL STABLE
AS $$
  SELECT auth.jwt() ->> 'sub';
$$;

-- Returns true only for AfriTech super admin accounts.
-- Super admins belong to the reserved 'afritech-systems-admin' organisation.
CREATE OR REPLACE FUNCTION is_afritech_admin()
RETURNS BOOLEAN
LANGUAGE SQL STABLE
AS $$
  SELECT (auth.jwt() -> 'o' ->> 'slg') = 'afritech-systems-admin';
$$;

-- Returns true when the current session is an impersonation session.
-- The 'act' claim is present only when a super admin is impersonating a user.
CREATE OR REPLACE FUNCTION is_impersonation_session()
RETURNS BOOLEAN
LANGUAGE SQL STABLE
AS $$
  SELECT (auth.jwt() -> 'act') IS NOT NULL;
$$;

-- Returns the real actor's user ID during an impersonation session.
-- Returns NULL when not in an impersonation session.
CREATE OR REPLACE FUNCTION get_actor_id()
RETURNS TEXT
LANGUAGE SQL STABLE
AS $$
  SELECT auth.jwt() -> 'act' ->> 'sub';
$$;

-- Checks whether the current user has an active explicit permission grant
-- for a specific action on a specific module.
-- Used alongside base role checks for the grant override system.
CREATE OR REPLACE FUNCTION has_permission_grant(
  p_module TEXT,
  p_action TEXT  -- 'read' | 'write' | 'delete'
)
RETURNS BOOLEAN
LANGUAGE SQL STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff_permission_grants
    WHERE grantee_user_id = get_user_id()
      AND school_id = (
        SELECT id FROM public.schools WHERE clerk_org_id = get_school_id()
      )
      AND module = p_module
      AND action = p_action
      AND is_active = TRUE
      AND (expires_at IS NULL OR expires_at > NOW())
  );
$$;
```

---

## Core Tables

### `staff_permission_grants`

This table is the foundation of the permission grant system. It stores every explicit, audited, time-bounded permission granted to any user beyond their base role. RLS policies check this table using the `has_permission_grant()` helper when a user's base role alone does not permit an action.

```sql
CREATE TABLE public.staff_permission_grants (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id        UUID REFERENCES public.schools(id) NOT NULL,
  grantee_user_id  TEXT NOT NULL,         -- Clerk user ID of the recipient
  grantor_user_id  TEXT NOT NULL,         -- Clerk user ID of who granted it
  module           TEXT NOT NULL,         -- 'fees' | 'attendance' | 'results' | 'loans' | etc
  action           TEXT NOT NULL,         -- 'read' | 'write' | 'delete'
  scope_detail     TEXT,                  -- optional: class_id, subject_code, specific record
  reason           TEXT NOT NULL,         -- mandatory human-readable reason
  is_active        BOOLEAN DEFAULT TRUE,
  expires_at       TIMESTAMPTZ,           -- NULL means manual revocation only
  granted_at       TIMESTAMPTZ DEFAULT NOW(),
  revoked_at       TIMESTAMPTZ,
  revoked_by       TEXT                   -- Clerk user ID of revoker
);

CREATE INDEX idx_grants_grantee ON staff_permission_grants(grantee_user_id, school_id, is_active);
CREATE INDEX idx_grants_expiry ON staff_permission_grants(expires_at) WHERE is_active = TRUE;
```

**Grant hierarchy — who can grant what:**

- **AfriTech Super Admin** — can grant any permission to any user at any school, including access to the private schema. No restrictions.
- **School Owner (`org:owner`)** — can grant any permission that exists within their school to any user at that school. Cannot grant permissions that exceed their own access level.
- **Principal (`org:principal`)** — can grant any permission within their school except billing, subscription management, and private schema access.
- **Any other role** — cannot grant permissions. A teacher cannot grant another teacher additional access.

**A user cannot grant a permission they do not themselves possess.** This rule is enforced at the application layer before the grant record is written.

---

## RLS Policies — `public` Schema

### `schools` table

```sql
ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;

-- AfriTech super admin has full access to all schools.
CREATE POLICY "afritech_admin_all_schools"
ON public.schools FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

-- School staff can read their own school record only.
CREATE POLICY "school_staff_read_own_school"
ON public.schools FOR SELECT
USING (clerk_org_id = get_school_id());

-- Only AfriTech super admin can create school records.
-- Schools do not create themselves in the database.
CREATE POLICY "only_admin_insert_school"
ON public.schools FOR INSERT
WITH CHECK (is_afritech_admin());

-- School owners can update their own school's non-billing fields.
-- Billing fields (subscription_tier, subscription_ends_at) are
-- restricted to AfriTech admin at the application layer.
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

-- No DELETE policy. Schools are never hard deleted.
-- Status is set to 'suspended' or 'terminated' by AfriTech admin only.
```

---

### `students` table

```sql
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

-- AfriTech super admin full access.
CREATE POLICY "afritech_admin_all_students"
ON public.students FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

-- School staff with management roles can read all students at their school.
CREATE POLICY "school_management_read_students"
ON public.students FOR SELECT
USING (
  school_id = (SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin', 'org:accountant')
);

-- Teachers can read students in their assigned classes only.
CREATE POLICY "teacher_read_assigned_students"
ON public.students FOR SELECT
USING (
  school_id = (SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())
  AND get_user_role() = 'org:teacher'
  AND id IN (
    SELECT student_id FROM public.class_enrolments
    WHERE class_id IN (
      SELECT class_id FROM public.staff_assignments
      WHERE staff_user_id = get_user_id()
        AND academic_year = EXTRACT(YEAR FROM NOW())::TEXT
    )
  )
);

-- Parents read only their own linked children.
CREATE POLICY "parent_read_own_children"
ON public.students FOR SELECT
USING (
  id IN (
    SELECT student_id FROM public.student_parent_links
    WHERE parent_user_id = get_user_id()
      AND (
        is_active = TRUE
        OR (is_active = FALSE AND grace_period_ends_at > NOW())
      )
  )
);

-- Students can read only their own record.
CREATE POLICY "student_read_own_record"
ON public.students FOR SELECT
USING (
  clerk_user_id = get_user_id()
);

-- Write access: owner, principal, admin by default.
-- Teachers and accountants can gain write access through explicit grant.
CREATE POLICY "management_write_students"
ON public.students FOR INSERT
WITH CHECK (
  school_id = (SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())
  AND (
    get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
    OR has_permission_grant('students', 'write')
  )
);

CREATE POLICY "management_update_students"
ON public.students FOR UPDATE
USING (
  school_id = (SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())
  AND (
    get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
    OR has_permission_grant('students', 'write')
  )
)
WITH CHECK (
  school_id = (SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())
);

-- No hard DELETE policy. Soft delete only via is_deleted flag.
-- The UPDATE policy covers setting is_deleted = TRUE.
```

---

### `parents` table

```sql
ALTER TABLE public.parents ENABLE ROW LEVEL SECURITY;

-- AfriTech super admin full access.
CREATE POLICY "afritech_admin_all_parents"
ON public.parents FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

-- Parents can read and update their own record only.
CREATE POLICY "parent_read_own_record"
ON public.parents FOR SELECT
USING (clerk_user_id = get_user_id());

CREATE POLICY "parent_update_own_record"
ON public.parents FOR UPDATE
USING (clerk_user_id = get_user_id())
WITH CHECK (clerk_user_id = get_user_id());

-- School management roles can read parent records linked to their school's students.
CREATE POLICY "school_management_read_parents"
ON public.parents FOR SELECT
USING (
  id IN (
    SELECT spl.parent_id
    FROM public.student_parent_links spl
    JOIN public.students s ON s.id = spl.student_id
    WHERE s.school_id = (
      SELECT id FROM public.schools WHERE clerk_org_id = get_school_id()
    )
  )
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin', 'org:accountant')
);

-- School management can insert parent records (when adding a parent during student enrolment).
CREATE POLICY "school_management_insert_parents"
ON public.parents FOR INSERT
WITH CHECK (
  get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
  OR has_permission_grant('parents', 'write')
);
```

---

### `student_parent_links` table

```sql
ALTER TABLE public.student_parent_links ENABLE ROW LEVEL SECURITY;

-- AfriTech super admin full access.
CREATE POLICY "afritech_admin_all_links"
ON public.student_parent_links FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

-- Parents can see their own links (to discover which children and schools they are linked to).
CREATE POLICY "parent_read_own_links"
ON public.student_parent_links FOR SELECT
USING (parent_user_id = get_user_id());

-- School management can read and manage links for students at their school.
CREATE POLICY "school_management_links"
ON public.student_parent_links FOR ALL
USING (
  student_id IN (
    SELECT id FROM public.students
    WHERE school_id = (SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())
  )
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
)
WITH CHECK (
  student_id IN (
    SELECT id FROM public.students
    WHERE school_id = (SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())
  )
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
);

-- Note: When is_active is set to FALSE, the grace_period_ends_at is set to NOW() + 30 days.
-- The parent_read_own_children policy on the students table checks this field.
-- After grace_period_ends_at passes, the parent loses read access automatically.
```

---

### `fee_structures` table

```sql
ALTER TABLE public.fee_structures ENABLE ROW LEVEL SECURITY;

-- AfriTech super admin full access.
CREATE POLICY "afritech_admin_all_fee_structures"
ON public.fee_structures FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

-- All school staff can read fee structures (teachers need this to know term fee amounts).
CREATE POLICY "school_staff_read_fee_structures"
ON public.fee_structures FOR SELECT
USING (
  school_id = (SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin', 'org:accountant', 'org:teacher')
);

-- Parents can read fee structures to understand what is owed.
CREATE POLICY "parent_read_fee_structures"
ON public.fee_structures FOR SELECT
USING (
  school_id IN (
    SELECT s.school_id FROM public.student_parent_links spl
    JOIN public.students s ON s.id = spl.student_id
    WHERE spl.parent_user_id = get_user_id() AND spl.is_active = TRUE
  )
);

-- Write access: owner, accountant by default. Others via explicit grant.
CREATE POLICY "fee_structure_write"
ON public.fee_structures FOR INSERT
WITH CHECK (
  school_id = (SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())
  AND (
    get_user_role() IN ('org:owner', 'org:accountant')
    OR has_permission_grant('fee_structures', 'write')
  )
);

CREATE POLICY "fee_structure_update"
ON public.fee_structures FOR UPDATE
USING (
  school_id = (SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())
  AND (
    get_user_role() IN ('org:owner', 'org:accountant')
    OR has_permission_grant('fee_structures', 'write')
  )
);
```

---

### `fee_records` table

```sql
ALTER TABLE public.fee_records ENABLE ROW LEVEL SECURITY;

-- AfriTech super admin full access.
CREATE POLICY "afritech_admin_all_fee_records"
ON public.fee_records FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

-- Financial management roles can read all fee records at their school.
CREATE POLICY "financial_staff_read_fee_records"
ON public.fee_records FOR SELECT
USING (
  school_id = (SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())
  AND (
    get_user_role() IN ('org:owner', 'org:principal', 'org:accountant')
    OR has_permission_grant('fees', 'read')
  )
);

-- Admin can read fee records (e.g. to check clearance status) but not write.
CREATE POLICY "admin_read_fee_records"
ON public.fee_records FOR SELECT
USING (
  school_id = (SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())
  AND get_user_role() = 'org:admin'
);

-- Parents can read their own children's fee records.
CREATE POLICY "parent_read_own_fee_records"
ON public.fee_records FOR SELECT
USING (
  student_id IN (
    SELECT student_id FROM public.student_parent_links
    WHERE parent_user_id = get_user_id()
      AND (
        is_active = TRUE
        OR (is_active = FALSE AND grace_period_ends_at > NOW())
      )
  )
);

-- Write access: accountant by default. Others via explicit grant.
-- This is the most important write restriction — fee record creation
-- should not happen without proper financial authorisation.
CREATE POLICY "fee_record_insert"
ON public.fee_records FOR INSERT
WITH CHECK (
  school_id = (SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())
  AND (
    get_user_role() IN ('org:owner', 'org:accountant')
    OR has_permission_grant('fees', 'write')
  )
);

CREATE POLICY "fee_record_update"
ON public.fee_records FOR UPDATE
USING (
  school_id = (SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())
  AND (
    get_user_role() IN ('org:owner', 'org:accountant')
    OR has_permission_grant('fees', 'write')
  )
);

-- No DELETE policy. Fee records are never hard deleted.
-- Voiding is done via a status field update covered by the UPDATE policy.
```

---

### `payments` table

```sql
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- AfriTech super admin full access.
CREATE POLICY "afritech_admin_all_payments"
ON public.payments FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

-- Financial roles can read all payments at their school.
CREATE POLICY "financial_staff_read_payments"
ON public.payments FOR SELECT
USING (
  school_id = (SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())
  AND (
    get_user_role() IN ('org:owner', 'org:principal', 'org:accountant')
    OR has_permission_grant('payments', 'read')
  )
);

-- Parents can read payment records for their own children.
CREATE POLICY "parent_read_own_payments"
ON public.payments FOR SELECT
USING (
  fee_record_id IN (
    SELECT fr.id FROM public.fee_records fr
    JOIN public.student_parent_links spl ON spl.student_id = fr.student_id
    WHERE spl.parent_user_id = get_user_id()
      AND (spl.is_active = TRUE OR spl.grace_period_ends_at > NOW())
  )
);

-- INSERT only — payments cannot be updated after creation.
-- Corrections require a reversal entry, not an edit.
CREATE POLICY "payment_insert"
ON public.payments FOR INSERT
WITH CHECK (
  school_id = (SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())
  AND (
    get_user_role() IN ('org:owner', 'org:accountant')
    OR has_permission_grant('payments', 'write')
  )
);

-- No UPDATE or DELETE policy for standard users.
-- Payment corrections are INSERT operations (reversal records).
-- AfriTech super admin UPDATE is covered by the admin policy above.
```

---

### `attendance_records` table

```sql
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;

-- AfriTech super admin full access.
CREATE POLICY "afritech_admin_all_attendance"
ON public.attendance_records FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

-- School management can read all attendance at their school.
CREATE POLICY "management_read_attendance"
ON public.attendance_records FOR SELECT
USING (
  school_id = (SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
);

-- Teachers can read attendance for their assigned classes only.
CREATE POLICY "teacher_read_own_class_attendance"
ON public.attendance_records FOR SELECT
USING (
  school_id = (SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())
  AND get_user_role() = 'org:teacher'
  AND class_id IN (
    SELECT class_id FROM public.staff_assignments
    WHERE staff_user_id = get_user_id()
  )
);

-- Parents can read attendance for their own children.
CREATE POLICY "parent_read_own_child_attendance"
ON public.attendance_records FOR SELECT
USING (
  student_id IN (
    SELECT student_id FROM public.student_parent_links
    WHERE parent_user_id = get_user_id()
      AND (is_active = TRUE OR grace_period_ends_at > NOW())
  )
);

-- Students can read their own attendance.
CREATE POLICY "student_read_own_attendance"
ON public.attendance_records FOR SELECT
USING (
  student_id IN (
    SELECT id FROM public.students WHERE clerk_user_id = get_user_id()
  )
);

-- Teachers INSERT for their own assigned classes.
-- Others via explicit grant.
CREATE POLICY "attendance_insert"
ON public.attendance_records FOR INSERT
WITH CHECK (
  school_id = (SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())
  AND (
    (
      get_user_role() = 'org:teacher'
      AND class_id IN (
        SELECT class_id FROM public.staff_assignments
        WHERE staff_user_id = get_user_id()
      )
    )
    OR get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
    OR has_permission_grant('attendance', 'write')
  )
);

-- Teachers can UPDATE attendance they recorded (same-day corrections only).
-- The application layer enforces the same-day restriction.
-- RLS enforces ownership of the record.
CREATE POLICY "attendance_update"
ON public.attendance_records FOR UPDATE
USING (
  school_id = (SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())
  AND (
    recorded_by_user_id = get_user_id()
    OR get_user_role() IN ('org:owner', 'org:principal')
    OR has_permission_grant('attendance', 'write')
  )
);
```

---

### `exam_results` table

```sql
ALTER TABLE public.exam_results ENABLE ROW LEVEL SECURITY;

-- AfriTech super admin full access.
CREATE POLICY "afritech_admin_all_results"
ON public.exam_results FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

-- Management can read all results at their school.
CREATE POLICY "management_read_results"
ON public.exam_results FOR SELECT
USING (
  school_id = (SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
);

-- Teachers can read results for their assigned subjects and classes.
CREATE POLICY "teacher_read_own_subject_results"
ON public.exam_results FOR SELECT
USING (
  school_id = (SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())
  AND get_user_role() = 'org:teacher'
  AND subject_code IN (
    SELECT subject_code FROM public.staff_assignments
    WHERE staff_user_id = get_user_id()
  )
);

-- Parents can read their children's results after results are published.
CREATE POLICY "parent_read_published_results"
ON public.exam_results FOR SELECT
USING (
  student_id IN (
    SELECT student_id FROM public.student_parent_links
    WHERE parent_user_id = get_user_id()
      AND (is_active = TRUE OR grace_period_ends_at > NOW())
  )
  AND results_published = TRUE
);

-- Students can read their own published results.
CREATE POLICY "student_read_own_results"
ON public.exam_results FOR SELECT
USING (
  student_id IN (
    SELECT id FROM public.students WHERE clerk_user_id = get_user_id()
  )
  AND results_published = TRUE
);

-- Teachers INSERT for their own assigned subjects.
-- Results cannot be inserted after the principal has published them for that term.
-- The application layer enforces the publication lock.
CREATE POLICY "teacher_insert_results"
ON public.exam_results FOR INSERT
WITH CHECK (
  school_id = (SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())
  AND (
    (
      get_user_role() = 'org:teacher'
      AND subject_code IN (
        SELECT subject_code FROM public.staff_assignments
        WHERE staff_user_id = get_user_id()
      )
    )
    OR get_user_role() IN ('org:owner', 'org:principal')
    OR has_permission_grant('results', 'write')
  )
);

-- Teachers can UPDATE their own results before publication.
CREATE POLICY "teacher_update_unpublished_results"
ON public.exam_results FOR UPDATE
USING (
  school_id = (SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())
  AND results_published = FALSE
  AND (
    entered_by_user_id = get_user_id()
    OR get_user_role() IN ('org:owner', 'org:principal')
    OR has_permission_grant('results', 'write')
  )
);
```

---

### `staff_members` table

```sql
ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;

-- AfriTech super admin full access.
CREATE POLICY "afritech_admin_all_staff"
ON public.staff_members FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

-- School management can read all staff at their school.
CREATE POLICY "management_read_staff"
ON public.staff_members FOR SELECT
USING (
  school_id = (SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
);

-- Staff members can read their own record.
CREATE POLICY "staff_read_own_record"
ON public.staff_members FOR SELECT
USING (clerk_user_id = get_user_id());

-- Owner and principal manage staff records.
CREATE POLICY "management_write_staff"
ON public.staff_members FOR ALL
USING (
  school_id = (SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())
  AND get_user_role() IN ('org:owner', 'org:principal')
)
WITH CHECK (
  school_id = (SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())
  AND get_user_role() IN ('org:owner', 'org:principal')
);
```

---

### `staff_assignments` table

```sql
ALTER TABLE public.staff_assignments ENABLE ROW LEVEL SECURITY;

-- AfriTech super admin full access.
CREATE POLICY "afritech_admin_all_assignments"
ON public.staff_assignments FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

-- School management read all assignments.
CREATE POLICY "management_read_assignments"
ON public.staff_assignments FOR SELECT
USING (
  school_id = (SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
);

-- Teachers can read their own assignments (to know which classes they have).
CREATE POLICY "teacher_read_own_assignments"
ON public.staff_assignments FOR SELECT
USING (staff_user_id = get_user_id());

-- Owner and principal manage assignments.
CREATE POLICY "management_write_assignments"
ON public.staff_assignments FOR ALL
USING (
  school_id = (SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())
  AND (
    get_user_role() IN ('org:owner', 'org:principal')
    OR has_permission_grant('assignments', 'write')
  )
)
WITH CHECK (
  school_id = (SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())
);
```

---

### `audit_logs` table

```sql
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- AfriTech super admin can read all audit logs across all schools.
CREATE POLICY "afritech_admin_all_audit_logs"
ON public.audit_logs FOR SELECT
USING (is_afritech_admin());

-- School owners and admins can read their own school's audit log.
CREATE POLICY "school_owner_read_audit_logs"
ON public.audit_logs FOR SELECT
USING (
  school_id = (SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())
  AND get_user_role() IN ('org:owner', 'org:principal')
);

-- Audit logs are written only by the system via service role in Edge Functions.
-- No user-facing INSERT policy. The application uses the service role key
-- exclusively for audit log writes — this is the ONE permitted use of the
-- service role key, isolated in a dedicated audit Edge Function.
-- No UPDATE or DELETE policy for any user including super admin.
-- Audit logs are permanently immutable.
```

---

### `message_log` table

```sql
ALTER TABLE public.message_log ENABLE ROW LEVEL SECURITY;

-- AfriTech super admin full access.
CREATE POLICY "afritech_admin_all_messages"
ON public.message_log FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

-- School management can read their school's message log.
CREATE POLICY "school_management_read_messages"
ON public.message_log FOR SELECT
USING (
  school_id = (SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
);

-- System INSERT only via Edge Functions. No user-facing INSERT policy.
-- No UPDATE or DELETE. Message logs are append-only.
```

---

### `school_permissions` table

```sql
ALTER TABLE public.school_permissions ENABLE ROW LEVEL SECURITY;

-- AfriTech super admin full access.
CREATE POLICY "afritech_admin_all_school_permissions"
ON public.school_permissions FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

-- Owners and principals can read and manage their school's permission config.
CREATE POLICY "owner_manage_school_permissions"
ON public.school_permissions FOR ALL
USING (
  school_id = (SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())
  AND get_user_role() IN ('org:owner', 'org:principal')
)
WITH CHECK (
  school_id = (SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())
  AND get_user_role() IN ('org:owner', 'org:principal')
);
```

---

### `staff_permission_grants` table

```sql
ALTER TABLE public.staff_permission_grants ENABLE ROW LEVEL SECURITY;

-- AfriTech super admin full access.
CREATE POLICY "afritech_admin_all_grants"
ON public.staff_permission_grants FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

-- Owners and principals can read all grants at their school.
CREATE POLICY "management_read_grants"
ON public.staff_permission_grants FOR SELECT
USING (
  school_id = (SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())
  AND get_user_role() IN ('org:owner', 'org:principal')
);

-- Grantees can read their own active grants.
CREATE POLICY "grantee_read_own_grants"
ON public.staff_permission_grants FOR SELECT
USING (grantee_user_id = get_user_id());

-- Owners and principals can create grants.
-- Application layer validates: grantor cannot grant what they do not possess.
CREATE POLICY "management_insert_grants"
ON public.staff_permission_grants FOR INSERT
WITH CHECK (
  school_id = (SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())
  AND get_user_role() IN ('org:owner', 'org:principal')
  AND grantor_user_id = get_user_id()
);

-- Grants can be revoked (is_active set to FALSE) by the grantor or a higher role.
CREATE POLICY "management_revoke_grants"
ON public.staff_permission_grants FOR UPDATE
USING (
  school_id = (SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())
  AND (
    grantor_user_id = get_user_id()
    OR get_user_role() IN ('org:owner', 'org:principal')
  )
);
```

---

## RLS Policies — `private` Schema

The `private` schema contains all loan-related tables. This schema is entirely separate from the `public` schema. No school-level role — regardless of grants — has access to the `private` schema. This boundary is enforced at the schema level, not the policy level. School-level permission grants cannot override it.

Only two parties have access to the `private` schema:
1. The parent who submitted the application — for their own records only.
2. AfriTech Super Admin — for platform management and commission reporting.

Support staff who need to assist a parent with a loan application receive a scoped, time-limited grant from a super admin. This grant is recorded in the `public.staff_permission_grants` table with `module = 'loans'` and is valid only for the duration specified. The Edge Function handling the loan read validates this grant before querying the private schema using the service role key.

```sql
-- Private schema: grant usage to authenticated role
GRANT USAGE ON SCHEMA private TO authenticated;
-- Tables are NOT granted by default. Policies handle access.

ALTER TABLE private.loan_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.loan_consent_log ENABLE ROW LEVEL SECURITY;
```

### `private.loan_applications`

```sql
-- AfriTech super admin full access.
CREATE POLICY "afritech_admin_all_loan_applications"
ON private.loan_applications FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

-- Parents can read their own loan applications.
CREATE POLICY "parent_read_own_loan_applications"
ON private.loan_applications FOR SELECT
USING (parent_user_id = get_user_id());

-- Parents can INSERT their own loan application.
-- The 2FA gate is enforced at the Edge Function layer before this is reached.
-- The application layer also validates that no active application already exists.
CREATE POLICY "parent_insert_loan_application"
ON private.loan_applications FOR INSERT
WITH CHECK (
  parent_user_id = get_user_id()
);

-- No UPDATE policy for parents. Application status is updated only by:
-- 1. The loan-submit Edge Function (using service role) on submission.
-- 2. The webhook-loan Edge Function (using service role) on lender response.
-- 3. AfriTech super admin directly.
-- No school staff member at any level can read, insert, or update loan applications.
```

### `private.loan_consent_log`

```sql
-- AfriTech super admin read access.
CREATE POLICY "afritech_admin_read_consent_log"
ON private.loan_consent_log FOR SELECT
USING (is_afritech_admin());

-- Parents can read their own consent records.
CREATE POLICY "parent_read_own_consent"
ON private.loan_consent_log FOR SELECT
USING (parent_user_id = get_user_id());

-- INSERT only via Edge Function using service role.
-- No user-facing INSERT policy.
-- Absolutely no UPDATE or DELETE policy for any user including super admin.
-- Consent records are permanently immutable.
```

---

## Impersonation and Super Admin Access

### How Impersonation Affects RLS

When a super admin impersonates a user, the JWT contains:
- `sub` — the impersonated user's Clerk ID (what RLS reads for `get_user_id()`)
- `act.sub` — the real super admin's Clerk ID

During impersonation, RLS policies evaluate based on the `sub` claim — meaning the super admin sees exactly what the impersonated user sees and has exactly the same database access as that user. This is intentional. Impersonation is for diagnostic purposes: seeing what the user sees.

For actions that require super admin access beyond the impersonated user's permissions — such as editing data the impersonated user cannot edit — the super admin exits impersonation and acts directly as themselves. The `is_afritech_admin()` function reads the `o.slg` claim which reflects the super admin's actual organisation, not the impersonated user's, allowing the distinction to be made even during impersonation.

Every write operation during an impersonation session is logged in `audit_logs` with both `actor_user_id` (the super admin) and `impersonated_user_id` (the user being impersonated). The audit log always reflects the real human who performed the action.

### Financial Write Block During Impersonation

Any Edge Function that performs a financial write — recording a payment, submitting a loan, modifying a fee record — checks `is_impersonation_session()` before processing. If the function returns TRUE, the operation is blocked with a 403 response and the attempt is logged. This prevents accidental or intentional financial actions being attributed to an impersonated user.

Super admins who need to make a genuine correction to financial data exit impersonation first and act as themselves. All AfriTech super admin financial writes are thus fully attributed and auditable.

---

## Business Rules

The following rules are enforced at both the RLS layer and the application layer. They cannot be violated by any user including super admins except where explicitly noted.

1. Every table in the `public` schema has `school_id` as a tenant isolation key. No RLS policy may be written that allows cross-school data access for any non-super-admin role.

2. No row in `payments` may be updated or deleted by any school-level user. Corrections are made by inserting a reversal payment record. AfriTech super admin may update a payment record only when supporting a confirmed data error, and the action is logged.

3. No row in `audit_logs` or `private.loan_consent_log` may be updated or deleted by any user including AfriTech super admin. These tables are permanently append-only.

4. No row in `students` may be hard deleted. The `is_deleted` flag and `deleted_at` timestamp are used for soft deletion. The UPDATE policy covers this operation.

5. Exam results become immutable after `results_published` is set to TRUE for that term. No UPDATE policy applies to published results for any school-level user. AfriTech super admin may correct published results only with explicit documented justification logged in the audit trail.

6. No school-level role — regardless of permission grants — may access the `private` schema. This boundary is architectural, not policy-based.

7. The `has_permission_grant()` function checks for active, non-expired grants only. An expired grant is treated identically to no grant.

8. A user cannot grant a permission they do not possess. This is enforced at the application layer before any INSERT to `staff_permission_grants`.

9. Financial write operations (payments, fee record modifications, loan status updates) are blocked during impersonation sessions regardless of the impersonated user's permissions.

10. The Supabase service role key is used exclusively in Edge Functions for two purposes: writing to `audit_logs`, and updating loan application status via webhooks. It must never appear in any client-facing code, environment variable accessible to the browser, or any repository file.

---

## Edge Cases and Error Handling

**Policy returns no rows vs policy returns error.** RLS SELECT policies that do not match return zero rows, not an error. This is intentional — it prevents data existence leakage. A parent querying a student they are not linked to receives an empty result, not a 404 or 403. The application layer adds the meaningful error message based on the empty result.

**Grant expired mid-session.** If a permission grant expires while a user is actively using the application, their next database query will fail the `has_permission_grant()` check. The application layer handles this as a 403 response with the message "Your temporary access to this feature has expired." The user's base role permissions remain intact.

**Grace period for unlinked parents.** The `student_parent_links.grace_period_ends_at` field is set to `NOW() + 30 days` when `is_active` is set to FALSE. RLS policies check this field alongside `is_active`. After the grace period expires, all parent policies that reference `student_parent_links` will exclude those records. A scheduled database function checks for expired grace periods daily and sets `is_active` to FALSE permanently after expiry.

**Concurrent grant creation.** If two principals attempt to create conflicting grants simultaneously, the `UNIQUE` constraint on `(school_id, grantee_user_id, module, action)` for active grants prevents duplicates. The second insert fails with a unique constraint violation which the application layer catches and returns as a conflict error.

**Service role writes to audit log.** The audit log INSERT is the only operation using the service role key. If the audit write fails, the primary operation (payment, student update, etc.) is rolled back via a database transaction. The primary operation and its audit log entry are written atomically. No operation completes without an audit record.

---

## Security Considerations

- Never expose the `get_school_id()` or `get_user_role()` function return values directly in API responses. They are internal database-level functions.
- The service role key must be stored only in Supabase Edge Function environment variables, never in the Next.js application environment, never in the mobile app, and never in version control.
- The `private` schema tables should not appear in the Supabase auto-generated API (PostgREST). Confirm `private` schema is excluded from the PostgREST schema exposure in Supabase project settings.
- All RLS policies must be reviewed when a new Clerk role is added. Default is no access for any new role until explicit policies are written.
- Lovable-generated code must be reviewed to confirm it uses the anon key Supabase client, not the service role client. RLS is bypassed entirely when queries use the service role key.

---

## Known Limitations and Future Work

- The `has_permission_grant()` function issues a subquery on every RLS check. At very high scale (millions of rows in `staff_permission_grants`) this may require an optimised index strategy or a cached permission lookup. For the current scale (under 100,000 users) this is not a concern.
- The current design does not support row-level grants (granting access to one specific student's fee record rather than all fee records). This is a potential future requirement for audit and compliance scenarios.
- Department head permission overrides (e.g. can view all results for a specific subject across all classes) are planned but not yet implemented in the RLS layer. They will use the `staff_permission_grants` table with a `scope_detail` value specifying the subject code.
- Multi-school owner aggregate views require a separate query pattern that joins across multiple `school_id` values. The current RLS model scopes to one school per session. The aggregate dashboard queries will use the service role key in a dedicated Edge Function with explicit multi-school authorisation validation.

---

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-04-26 | Initial complete draft | Pre-development documentation — covers all confirmed design decisions |
| 2026-08-13 | Added `org:staff` to the `get_user_role()` canonical value list | ROLES.md defines eight `org:*` roles; this comment listed seven, omitting the custom-role base role |
| 2026-08-13 | Helper functions implemented verbatim in migration `0001` and applied to `zsms-dev` | Phase 0 scaffold — RLS.md remains authoritative for all seven bodies |
