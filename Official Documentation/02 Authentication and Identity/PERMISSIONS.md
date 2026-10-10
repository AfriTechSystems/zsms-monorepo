# PERMISSIONS.md — Permission Grant System

## Related Documents

- `docs/modules/auth/ROLES.md` — base role definitions and default access matrix
- `docs/modules/auth/AUTH.md` — authentication flows
- `docs/modules/auth/SESSIONS.md` — session management and elevated tokens
- `docs/RLS.md` — `has_permission_grant()` function and RLS integration
- `docs/DATABASE.md` — `staff_permission_grants` and `school_permissions` tables
- `docs/modules/admin/SUPERADMIN.md` — AfriTech platform-level permission management

---

## Purpose

This document defines the complete permission grant system in ZSMS. It explains how permissions that go beyond a user's base role are granted, how they are stored and enforced, how they expire, how they are audited, and how both school-level grants and AfriTech internal team grants work. Every feature that checks permissions must reference both this document and `docs/RLS.md`.

---

## Implementation Status (2026-10-11)

**Built and reachable as of migration `0236`.** Before then the tables, the
`has_permission_grant()` function and **15 live RLS policies** calling it all existed —
and there was no API route, no screen and no grant rows, so the function always returned
false and the whole system described below was unreachable.

Two corrections `0236` made to the schema, both from this document:

- `action` admitted only `read`/`write`/`delete`, so `export` and `publish` could not be
  granted at all — and `results_publish` is one of this document's own worked examples.
- `module` had **no CHECK**, so a typo stored cleanly and granted nothing. A permission
  that silently grants nothing is the hardest kind to notice.

**Writing goes through `grant_staff_permission()`, not the INSERT policy.** The rule
below — that a grantor cannot grant what they do not hold — cannot live only in a route,
because a direct PostgREST call skips the route entirely, and granting yourself a
permission is exactly what somebody would try that for. The INSERT policy was dropped and
the privilege revoked.

Screen: `/school/[code]/settings/permissions`.

**Not built:** the two-day expiry notification. There is no notification channel yet, so
the screen surfaces grants lapsing within two days instead.

---

## Overview

### The Core Philosophy

Every role in ZSMS starts with the minimum access needed to do its primary job. There are no permanent "can never" restrictions based on role alone. Any action can be unlocked through an explicit, audited, time-bounded grant from an authorised user.

This design exists because schools are real institutions with real operational challenges. Staff go on leave. Roles are vacated. Emergencies happen. The grant system allows a principal to give a teacher accountant-level fee recording access for two weeks, without changing the teacher's base role, without changing any RLS policy, and without creating a permanent security exception. When the grant expires, the teacher's access automatically reverts.

### Two-Layer Permission Model

**Layer 1 — Base role:** Defined in Clerk. Determines the default access level. Examples: `org:teacher`, `org:accountant`. Read `ROLES.md` for the complete default matrix.

**Layer 2 — Explicit grants:** Stored in `public.staff_permission_grants`. Override or extend the base role for specific modules and actions. Checked by the `has_permission_grant()` RLS function on every relevant database operation.

Both layers are checked independently. The base role check happens first. If the base role permits the action, the grant check is not needed. If the base role does not permit the action, the grant check runs. If an active, non-expired grant exists for this user, module, and action, the operation is permitted.

---

## The `staff_permission_grants` Table

Full schema is in `docs/DATABASE.md`. Key fields:

```sql
CREATE TABLE public.staff_permission_grants (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id        UUID REFERENCES public.schools(id) NOT NULL,
  grantee_user_id  TEXT NOT NULL,       -- Clerk user ID receiving the permission
  grantor_user_id  TEXT NOT NULL,       -- Clerk user ID who created the grant
  module           TEXT NOT NULL,       -- 'fees' | 'payments' | 'attendance' | 'results'
                                        -- 'students' | 'staff' | 'communication' | 'loans'
                                        -- 'settings' | 'reports' | 'assignments'
  action           TEXT NOT NULL,       -- 'read' | 'write' | 'delete' | 'export' | 'publish'
  scope_detail     TEXT,                -- Optional: class_id, subject_code, student_id
  reason           TEXT NOT NULL,       -- Mandatory human-readable reason
  is_active        BOOLEAN DEFAULT TRUE,
  expires_at       TIMESTAMPTZ,         -- NULL = manual revocation only
  granted_at       TIMESTAMPTZ DEFAULT NOW(),
  revoked_at       TIMESTAMPTZ,
  revoked_by       TEXT
);
```

### Module Values

| Module Value | What It Covers |
|---|---|
| `fees` | Fee structure reading and modification |
| `payments` | Recording, viewing, and reversing payments |
| `attendance` | Marking and viewing attendance records |
| `results` | Entering, editing, and viewing exam marks |
| `results_publish` | Publishing results for a term |
| `students` | Creating, updating, and soft-deleting student records |
| `parents` | Managing parent accounts and student-parent links |
| `staff` | Managing staff profiles and assignments |
| `assignments` | Class and subject assignment management |
| `communication` | Sending announcements and messages |
| `reports` | Accessing and exporting school reports |
| `settings` | School configuration changes |
| `loans` | Viewing loan application data |
| `audit` | Viewing the audit log |
| `permissions` | Granting permissions to other users |

### Action Values

| Action Value | What It Enables |
|---|---|
| `read` | SELECT queries on the module's tables |
| `write` | INSERT and UPDATE on the module's tables |
| `delete` | Soft-delete operations on the module's tables |
| `export` | Generating and downloading report exports |
| `publish` | Publishing results or approving data releases |

---

## Grant Hierarchy — Who Can Grant What

### School Domain

**`org:owner`** — can grant any module permission to any user at their school, for any action. The only constraint is they cannot grant permissions beyond what they themselves possess (they cannot grant access to `private` schema data because they do not have it).

**`org:principal`** — can grant module permissions to teachers and admins within their school. Cannot grant financial write permissions (`payments` write, `fee_structures` write) because they do not have those permissions themselves.

**`org:admin` and below** — cannot create grants. They can receive them.

**Enforcement:** The API route that creates a grant first checks whether the grantor holds the permission they are attempting to grant. If they do not, the grant creation is rejected with: "You cannot grant a permission you do not yourself hold."

### AfriTech Internal Domain

**`afritech:super_admin`** — can grant any permission to any user in any domain. This includes granting school-level write permissions to support agents for specific schools, granting loan data access to support agents for specific cases, and granting production database access to developers for specific maintenance windows.

**`afritech:regional_manager`** — can grant write permissions to support agents for schools within their assigned scope. Cannot grant permissions outside their scope or above their own permission level.

**`afritech:support_agent` and below** — cannot create grants.

---

## Practical Grant Scenarios

### Scenario 1 — Accountant on Leave, Teacher Covers Payments

**Situation:** The school accountant is on medical leave for 3 weeks. The principal needs someone to record cash payments in the meantime.

**Action:**
1. Principal opens Staff Management → Permission Grants
2. Selects Teacher Sarah Banda
3. Selects module: `payments`, action: `write`
4. Sets expiry: 21 days from today
5. Enters reason: "Accountant on medical leave — covering fee payment recording"
6. Saves

**Result:** Sarah can now record payments. She cannot see the full financial dashboard (she does not have `fees` read). She can insert payment rows and generate receipts. After 21 days, the grant expires automatically. The principal is notified 2 days before expiry in case extension is needed.

**Database record:**
```json
{
  "grantee_user_id": "user_sarah_banda",
  "grantor_user_id": "user_principal",
  "module": "payments",
  "action": "write",
  "reason": "Accountant on medical leave — covering fee payment recording",
  "expires_at": "2026-10-15T00:00:00Z"
}
```

---

### Scenario 2 — Department Head Reviews All Science Results

**Situation:** The Head of Sciences needs to see all science marks across all classes before the principal publishes results, to ensure grade moderation.

**Action:**
1. Principal creates a grant:
   - Module: `results`, action: `read`, scope_detail: `subject:science`
   - No expiry (manual revocation after term end)
   - Reason: "Science department head — moderation review"

**Result:** The science head can now see all science marks across all classes, not just their own assigned classes. The scope_detail `subject:science` is enforced at the application layer — the API route reads this scope and adds `WHERE subject_code = 'science'` to the query.

---

### Scenario 3 — Support Agent Fixes a Fee Record Error

**Situation:** A parent reports that a payment they made was recorded against the wrong student. A support agent needs to correct the fee record.

**Action:**
1. Super admin or Regional Manager creates a scoped grant for the support agent:
   - School: ZM-LSK-0001
   - Module: `payments`, action: `write`
   - Scope_detail: `student:STU-ZM-LSK-0001-00042` (the specific student)
   - Expiry: 4 hours
   - Reason: "Support ticket #2847 — payment recorded against wrong student"

**Result:** The support agent can record a reversal payment and a new correct payment for that specific student only. After 4 hours, the grant expires. The support agent's action is logged in audit_logs with both their user ID and the reason.

---

### Scenario 4 — Loan Officer Assists a Parent

**Situation:** A parent cannot complete their loan application and calls AfriTech support. The loan officer needs to view the specific application and help the parent.

**Action:**
1. Super admin creates a grant:
   - User: loan officer
   - Module: `loans`, action: `read`
   - Scope_detail: `loan_application:loan_app_uuid`
   - Expiry: 2 hours
   - Reason: "Parent support call — loan application assistance ticket #1203"

**Result:** The loan officer can read the specific loan application. They assist the parent. After 2 hours, access is revoked. The audit log shows the loan officer accessed the record and the business reason.

---

### Scenario 5 — Developer Needs Production Access for Migration

**Situation:** A developer needs to run a data migration on the production database during a maintenance window.

**Action:**
1. Super admin creates a grant:
   - User: developer
   - Module: `production_db`, action: `write`
   - Expiry: 2 hours (the maintenance window)
   - Reason: "Scheduled migration window — ticket #DEV-089"

**Result:** The developer's Supabase access is temporarily elevated for 2 hours. Every action they take is logged. After 2 hours, access reverts to staging-only.

---

## The `school_permissions` Table — School-Level Defaults

This is different from individual grants. The `school_permissions` table stores the default permission configuration for each role at a specific school. It is the school owner's tool for setting what each role can do by default at their school.

**Example use case:** School owner decides that teachers at their school can view fee balances (to tell parents if asked) but not at other schools where this might not be the policy.

```sql
-- Teachers at Sunrise Academy can READ fees (not the default)
INSERT INTO public.school_permissions (school_id, role, module, can_view)
VALUES ('sunrise-school-uuid', 'org:teacher', 'fees', true);
```

When a teacher queries fee data, the system checks:
1. Does their Clerk role (`org:teacher`) have default access? → No
2. Does their school's `school_permissions` table grant their role read access? → Yes → Permitted
3. If neither: check `staff_permission_grants` for an individual grant

This three-step check allows schools to customise default behaviour for all teachers without creating individual grants for each person.

---

## Grant Expiry and Notification

### Automatic expiry

A queue cron job runs every hour checking for grants where `expires_at < NOW() AND is_active = TRUE`. It sets `is_active = FALSE` on expired grants and writes an audit log entry. No action is required from any user.

### Pre-expiry notification

2 days before a grant expires, the grantor receives an in-app notification: "Permission grant for [Name] on [module] expires in 2 days. Renew or let it expire." This prevents situations where a covering staff member loses access unexpectedly.

### Mid-session expiry

If a grant expires while the user is actively in a session, their next database operation that requires the grant returns empty results (for reads) or a 403 (for writes). The UI shows: "Your temporary access to [module] has expired. Contact your school admin to renew if needed." Their base role permissions are unaffected.

---

## Grant Audit Trail

Every grant event writes to `public.audit_logs`:

| Event | Audit Action | What Is Logged |
|---|---|---|
| Grant created | `grant_permission` | grantor, grantee, module, action, scope, reason, expiry |
| Grant manually revoked | `revoke_permission` | revoker, grantee, module, action, revocation reason |
| Grant auto-expired | `permission_expired` | grantee, module, action, original expiry date |
| Grant used for write | `permission_grant_write` | grantee, module, record affected, grant ID used |

The last row — logging when a grant is actually used for a write operation — ensures a full chain of evidence: who was granted what, who used the grant, and what they changed.

---

## Business Rules

1. A user cannot grant a permission they do not themselves possess. This is enforced at the application layer before any INSERT to `staff_permission_grants`. Attempting to grant above your level returns: "You cannot grant a permission you do not hold."
2. All grants require a non-empty `reason` field. Grants without a reason string are rejected at the API layer with a validation error.
3. No grant can give access to the `private` schema tables to any school-level role. The private schema boundary is architectural — it cannot be overridden by the grant system.
4. AfriTech support agent grants that include financial write access must include a `scope_detail` value identifying the specific record or student the access applies to. Broad financial write grants to support agents without scope are rejected.
5. Grant expiry dates set in the past are rejected at creation time.
6. A user can hold multiple simultaneous grants for different modules. Each is tracked and expires independently.
7. Revoking a grant takes effect immediately — there is no grace period. The revoked user's next database operation returns the base role result.
8. The `school_permissions` table changes (school-wide defaults) are logged in the audit trail with the owner's user ID and the previous and new values.

---

## Edge Cases and Error Handling

**Two grants conflict:** A teacher has a grant for `results: read` and another grant for `results: write`. Both are active. The most permissive grant applies — the teacher can read and write. Conflicting grants do not cancel each other out.

**Grant created by a role that is later downgraded:** If a principal is downgraded to teacher after creating grants, those grants remain active. They are not revoked automatically. The school owner should review and revoke as appropriate. Grants are tied to the granting event, not to the grantor's current role.

**Grant for a user who leaves the school:** When a user is removed from the Clerk Organisation (school), their grants in `staff_permission_grants` remain as historical records (for the audit trail) but `is_active` is set to FALSE automatically via the Clerk webhook that fires on membership removal.

**School owner tries to grant `private` schema access:** The API returns: "This permission level is not available through the grant system. Contact AfriTech support if you need access to this data."

---

## Security Considerations

- The `has_permission_grant()` PostgreSQL function checks active, non-expired grants on every RLS evaluation. This runs on every query that touches a table with a permissive RLS policy. At current scale this is acceptable. At very high user counts, a materialised permissions cache may be needed.
- Grants that include `scope_detail` must be enforced at the application layer — RLS does not parse JSON scope values. Edge Functions and API routes must read `scope_detail` and apply it to the query filter.
- The grant reason field is visible to the school owner and super admin. Support agents should not include sensitive case details in the reason — only a ticket reference number is sufficient.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 2 auth documentation |
| 2026-04-26 | Added AfriTech internal grant scenarios | Confirmed support agent scoped write access model |
| 2026-04-26 | Added loan officer scoped access scenario | Confirmed loan support access pattern |

---

## Change Log

| Date | Change |
|---|---|
| 2026-10-11 | Marked built as of `0236`; recorded the `action` and `module` CHECK corrections and the move to a SECURITY DEFINER writer |
