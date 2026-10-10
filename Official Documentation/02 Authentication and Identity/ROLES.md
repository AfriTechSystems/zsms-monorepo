# ROLES.md — Role Definitions

## Related Documents

- `docs/modules/auth/AUTH.md` — login flows per role
- `docs/modules/auth/SESSIONS.md` — session durations per role
- `docs/modules/auth/PERMISSIONS.md` — permission grant system
- `docs/DATABASE.md` — school_custom_roles table
- `docs/modules/school/TEACHER_PORTAL.md` — platform:teacher role

---

## Purpose

This document defines every role in ZSMS — what each role can do, how it is assigned, and its Clerk representation. Every Claude Code session implementing access control must read this document.

---

## Role Architecture

ZSMS has three role levels:

1. **Platform roles** (`afritech:*`, `platform:*`) — AfriTech staff and platform-level users with no school scope
2. **School roles** (`org:*`) — School users scoped to a specific Clerk organisation (school)
3. **Custom roles** — School-defined roles using `org:staff` as base with DB-defined permissions

---

## Platform Roles

### `afritech:super_admin`
Full access to everything. Can access and modify data at any school. Can impersonate any user. Can modify subscription tiers, apply overrides, and terminate accounts.
**Who:** Mwando (CTO), Julius (CFO), future C-level appointees.

### `afritech:regional_manager`
Scoped to assigned country or region via `afritech.staff_scope_assignments`. Read access to all schools in scope. Cannot modify billing. Cannot access schools outside scope.

### `afritech:support_agent`
Read-only by default. Write access via explicit time-bounded grant. Every impersonation requires a support ticket reference. Cannot access private schema.

### `afritech:loan_officer`
Access to loan portfolio across all schools. Can update application statuses (Phase 1 manual), manage lender registry, track commissions. Cannot access school operational data beyond loan-linked records.

### `afritech:finance_officer`
Access to AfriTech revenue data — MRR, subscriptions, billing, invoices. Cannot access individual school data or loan PII.

### `afritech:developer`
Staging access by default. Production access via automated request → super admin approval → 4-hour maximum grant. All production access audited. Cannot impersonate users.

### `platform:teacher`
Standalone teacher with no school affiliation. Access to Teacher Hub tools (lesson planner, quiz generator, homework creator). No access to any school operational data. Can coexist with `org:teacher` membership — a linked teacher has both.

### `platform:alumni`
Graduated student or parent of graduated student. Permanent read-only access to their own historical records (report cards, receipts, attendance certificates). No access to current school operational data.

**Session duration: 30 days, not indefinite.** This paragraph said "indefinite" and
contradicted SESSIONS.md, which revised it on 2026-06-23 for SOC 2 CC6.1. The record
ACCESS is permanent; the SESSION is not. Corrected 2026-10-11.

**Built as part of the student portal, not separately** — ADR-046. Access is keyed on
`students.clerk_user_id` and never on an organisation claim, which is what lets it
survive the org membership being revoked at graduation.

---

## School Roles (`org:*`)

All school roles are scoped to a specific Clerk organisation (school). A user with `org:owner` at School A has no access to School B.

### `org:owner`
Full access to their school. All modules. Can invite and remove staff. Can change school configuration and subscription. Can see all financial data. Cannot delete school records (soft delete only).

### `org:principal`
Academic operations. Can publish results, generate report cards, view all student performance data, manage the timetable, send announcements, and view attendance. Cannot access billing or subscription settings.

### `org:accountant`
Fee and payment management. Can record and verify payments, generate receipts, view fee records, access the loan module (application review), and generate financial reports. Cannot access exam results or attendance in detail.

### `org:teacher`
Scoped to assigned classes. Can mark attendance, enter marks, view their timetable, and communicate with parents via announcements. Cannot see students outside their assigned classes. Cannot access fee data.

### `org:admin`
Administrative operations without full owner access. Can manage student records, run bulk imports, send announcements, and configure school settings. Cannot change subscription or billing.

### `org:parent`
Parent portal access. Can view their linked children's results, attendance, fee balance, and announcements. Cannot see other students' data. Cannot enter any data — read-only.

### `org:student`
Student portal access. Can view own results, timetable, and announcements. Read-only. 30-day session duration (SESSIONS.md).

### `org:staff` — Custom Role Base
**Zero default access.** This is the Clerk base role for any custom role holder. A staff member with `org:staff` and no custom role assignment sees only the ZSMS homepage. All access comes from the `school_custom_roles` table. Examples of custom roles built on `org:staff`:
- Head of Boarding (attendance + boarding student access)
- School Nurse (student health notes — future feature)
- Transport Coordinator (student transport assignments — future feature)
- Librarian (future)

---

## Custom Role System

Schools define their own staff roles beyond the standard set. Stored in `public.school_custom_roles`.

```sql
-- Example: Head of Boarding role
{
  role_name: 'Head of Boarding',
  permissions: {
    students: { read: true, filter: 'boarding_only' },
    attendance: { read: true },
    announcements: { read: true, write: false }
  }
}
```

**Tier limits for custom roles:**

| Tier | Custom Role Limit |
|---|---|
| Starter | 3 |
| Growth | 10 |
| Professional | Unlimited |
| Enterprise | Unlimited |

**How custom roles work with Clerk:**
1. Admin creates a custom role in Settings → Staff → Custom Roles
2. Admin invites the staff member with `org:staff` base Clerk role
3. Admin assigns the custom role to the staff member
4. ZSMS permission checks read the custom role's permissions from DB
5. The staff member sees only the modules their custom role permits

---

## Permission Grants

Any role can be given temporary elevated permissions via the grant system:

```typescript
// Example: Support agent granted write access for a specific ticket
{
  grantee_user_id: 'support_agent_clerk_id',
  school_id: 'school_uuid',
  permission: 'payments:write',
  scope: 'payment_id:pay-uuid-123',
  granted_by: 'regional_manager_clerk_id',
  expires_at: 'now() + 2 hours',
  reason: 'Correcting payment amount — ticket #2847'
}
```

Grants are checked after the base role but before RLS. A grant never elevates above the granting user's own permissions.

---

## Role Assignment Reference

| Role | How Assigned | Revoked By |
|---|---|---|
| `afritech:*` | Super admin via Clerk dashboard | Super admin |
| `platform:teacher` | Self-registration via Teacher Hub | Account deletion or subscription cancellation |
| `platform:alumni` | Automatic on student graduation/transfer | Never — permanent |
| `org:owner` | First user to register a school (automatic) | Cannot be revoked (must transfer ownership) |
| `org:*` (other) | School owner/admin via Staff → Invite | School owner/admin |
| `org:staff` (custom) | School admin assigns custom role | School admin removes assignment |

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Pre-development roles reference |
| 2026-04-26 | Added org:staff as custom role base with zero default access | Custom roles confirmed — Clerk org:staff base |
| 2026-04-26 | Added platform:alumni with indefinite session | Graduated account model |
| 2026-04-26 | Added platform:teacher for standalone Teacher Hub | Teacher Hub B2C product |
| 2026-04-26 | Added custom role tier limits (Starter 3, Growth 10) | Feature toggle billing confirmed |
| 2026-08-13 | Corrected student session from 365 days to 30 days | Reconciled with the 2026-06-23 revision in SESSIONS.md |

---

## Implementation Status (2026-10-11)

The six `afritech:*` roles were **a single boolean** until migration `0237`. Every limit
described above — the finance officer who may not see loan PII, the developer who may not
impersonate, the read-only support agent — was imaginary, because `is_afritech_admin()`
returned true for anybody in the AfriTech organisation and nothing else was consulted.

`0237` adds `afritech_role()` and `has_afritech_capability()`, which encode the matrix
above, plus `afritech.staff_scope_assignments` for the regional scoping this document
names. `is_afritech_admin()` is deliberately unchanged — **91 policies call it** — so it
still means "is this AfriTech staff at all" and the differentiation sits above it.

`/admin/team` shows the matrix, because a boundary nobody can see is one you discover by
hiring somebody and watching them fail.

**Scope is opt-in.** `afritech_school_in_scope()` returns TRUE for anybody with no scope
rows, so the migration did not silently remove access from a live account. An unscoped
regional manager still sees every school.

**Still collapsed:** 32 of the 34 `admin_*` functions keep the plain
`is_afritech_admin()` check. Only `admin_loan_applications()` and the impersonation
functions are capability-gated so far — the two that guard somebody's personal
information. Narrowing the rest is worth doing per release rather than in one unverifiable
sweep.
