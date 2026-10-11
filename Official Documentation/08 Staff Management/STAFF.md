# STAFF.md — Staff Entity Reference

## Related Documents

- `docs/modules/staff/INVITATIONS.md` — staff onboarding flows
- `docs/modules/staff/ASSIGNMENTS.md` — class and subject assignments
- `docs/modules/staff/OVERRIDES.md` — temporary permission grants
- `docs/modules/staff/TIMETABLE.md` — timetable builder and management
- `docs/modules/school/SCHOOL_CONFIG.md` — custom roles configuration
- `docs/modules/auth/ROLES.md` — Clerk role definitions
- `docs/modules/auth/PERMISSIONS.md` — permission grant system
- `docs/DATABASE.md` — staff_members, school_custom_roles tables
- `docs/RLS.md` — staff table RLS policies

---

## Implementation Status (2026-10-11)

**Self-management built (`0249`).** Staff could READ their own record since `0014` and
there was no UPDATE path, so a teacher whose phone number changed had to ask the office.
The seven fields this document lists are now editable on `/account`.

**It goes through a function, not a policy, and the reason is worth knowing before
anybody "simplifies" it.** `authenticated` already holds a **table-level UPDATE** on
`staff_members`, granted so `management_write_staff` could work. A column grant does not
narrow a table grant — it unions with it. So a self-scoped UPDATE policy would let every
member of staff write any column on their own row: `school_id`, moving themselves into
another school's roster; `is_active`, undoing their own removal; `staff_number`.

`0249`'s own assertion caught that in its first draft.

**Multi-school staff is handled**: the update applies to every row for that person,
because a phone number belongs to a person rather than to an employment. The per-school
facts — staff number, department, employment type, start date — are shown read-only with
a line saying who to ask.

**Not self-managed, by design:** `department`. This document does not list it, and
`0246` reads it to find a school's principal for the transfer letter signature line. A
field that decides who signs a document is not one somebody sets about themselves.

---

## Purpose

This document defines the complete staff entity — what a staff profile contains, how staff types differ, how staff work across multiple schools, how the `org:staff` base role works for custom role holders, and what staff can self-manage vs what requires admin action. Every Claude Code session building any staff management feature must read this document.

---

## Overview

ZSMS staff fall into two categories. Standard role staff hold one of the predefined Clerk roles (`org:teacher`, `org:accountant`, `org:admin`, `org:principal`, `org:owner`) with their default access defined in `docs/modules/auth/ROLES.md`. Custom role staff hold the `org:staff` Clerk base role and have their access entirely defined by the school's custom role configuration in `school_custom_roles`.

Both categories have a row in `public.staff_members`. The difference is which Clerk role they hold and whether `staff_members.custom_role_id` is populated.

---

## Staff Profile Fields

### Core Identity

| Field | Required | Editable By | Notes |
|---|---|---|---|
| `clerk_user_id` | System | System only | Links to Clerk account — never manually set |
| `staff_number` | No | Admin, Owner | Optional school-assigned identifier |
| `first_name` | Yes | Staff (own), Admin, Owner | |
| `last_name` | Yes | Staff (own), Admin, Owner | |
| `phone_e164` | No | Staff (own), Admin, Owner | E.164 format |
| `email` | No | Staff (own), Admin, Owner | |
| `photo_url` | No | Staff (own), Admin | R2 path — school logo-style upload |
| `department` | No | Admin, Owner | Mathematics, Sciences, Administration, etc. |
| `employment_type` | Yes | Admin, Owner | full_time / part_time / contract / volunteer |
| `join_date` | No | Admin, Owner | Date staff member joined the school |
| `location` | No | Staff (own), Admin | City/province — useful for AfriTech regional reporting |
| `qualifications` | No | Staff (own), Admin | Free text — teaching qualifications, degrees |
| `is_active` | System | Admin, Owner | Set to FALSE on membership removal |

### Role Fields

| Field | Notes |
|---|---|
| `clerk_role` | Denormalised from Clerk membership — org:teacher, org:admin, etc. |
| `custom_role_id` | Foreign key to school_custom_roles — NULL for standard roles |

### System Fields

| Field | Notes |
|---|---|
| `school_id` | The school this staff member belongs to |
| `created_at`, `updated_at` | Auto-managed |

---

## Staff Types

### Standard Role Staff

These staff hold a predefined Clerk role. Their access is governed by the role definitions in `ROLES.md` and any permission overrides in `school_permissions` and `staff_permission_grants`.

| Clerk Role | Typical Title | Primary Function |
|---|---|---|
| `org:owner` | School Owner / Director | Full school management, billing |
| `org:principal` | Principal / Head Teacher | Academic leadership, results, staff |
| `org:admin` | Administrator / Registrar | Student management, timetable, communication |
| `org:accountant` | Accountant / Bursar | Fee management, payments, receipts |
| `org:teacher` | Teacher / Lecturer | Attendance marking, marks entry |

### Custom Role Staff

These staff hold the `org:staff` Clerk base role (zero default access). Their access is entirely defined by the `school_custom_roles` record their `custom_role_id` points to.

**Examples of custom roles:**

| Role Name | Typical Permissions |
|---|---|
| Head of Boarding | Students read, Attendance read/write, Communication send |
| Dormitory Matron/Master | Students read, Attendance read |
| Dining / Catering Manager | Students read |
| School Nurse | Students read, Attendance read |
| Librarian | Students read |
| IT Technician | Students read |
| Sports Coach | Students read, Attendance read (own classes only) |
| Registrar | Students read/write, Attendance read |
| Examination Officer | Students read, Results read |

Custom roles are created and managed by the school owner or principal in Settings → Staff Roles. See `docs/modules/school/SCHOOL_CONFIG.md` for the full custom role setup documentation.

---

## Multi-School Staff

A staff member who works at two schools has one Clerk account and two `staff_members` rows — one per school. Their Clerk account has Organisation memberships for both schools with potentially different roles (e.g. `org:teacher` at School A and `org:admin` at School B).

When they log in, the OrganisationSwitcher allows them to select which school context to work in. The selected school determines which dashboard they see, which data is visible, and which permissions apply. Switching schools changes the JWT's `o.id` and `o.rol` claims.

---

## Staff Profile Self-Management

Staff can update their own profile through Profile → Settings accessible from the top navigation. Fields they can self-manage:

- First name, last name
- Phone number
- Email address
- Photo
- Location (city/province)
- Qualifications (free text)

Fields they cannot self-manage (require admin action):
- School assignment (which school they are assigned to)
- Role (Clerk role changes require admin via Clerk organisation management)
- Custom role (admin assigns custom role from the school's configured list)
- Employment type, join date, staff number

---

## Staff Activity Tracking

The `staff_members.last_login_at` field (populated from the Clerk session.created webhook) allows admins to see which staff members have recently logged in. This is shown in the Staff Management screen and used by AfriTech regional managers to identify schools where staff are not using the system.

---

## Payroll Module (Phase 3 — Planned)

The payroll module is planned for Phase 3 (Year 2) as a toggleable add-on feature. It is not built in the current phase but the staff data model is designed to support it without schema changes.

**What Phase 3 payroll will cover:**
- Monthly salary configuration per staff member
- Payslip generation (PDF using the document template system)
- Basic Zambia PAYE tax calculation
- ZRA-compliant payslip format
- NAPSA (National Pension Scheme Authority) deduction tracking
- Salary history and audit trail
- Payroll reports for the accountant

**Why Phase 3 and not now:**
- Payroll tax rules vary significantly by country — a Zambia-specific implementation cannot be reused for Botswana or Zimbabwe without significant rework
- ZRA compliance requirements need legal review before implementation
- The commercial priority is getting the core SIS, fees, and results modules stable first

**Pre-requisite work for Phase 3 payroll:**
The `staff_members` table already has `employment_type` which is the primary input for payroll eligibility. A `staff_salary_config` table will be added in the Phase 3 migration — no changes to the current schema are needed.

---

## Business Rules

1. Every school must have at least one `org:owner` at all times. Removal of the last owner is blocked at the application layer.
2. Custom role staff (`org:staff` Clerk role) have zero access by default. If their `custom_role_id` is deleted or deactivated, they lose all access and appear in a "Staff without role" warning list in the admin panel.
3. Staff profiles are soft-referenced — removing a staff member from the Clerk Organisation sets `is_active = FALSE` but does not delete the `staff_members` row. Historical records (attendance marked, results entered) retain the original staff user ID.
4. A staff member's Clerk account is not deleted when they leave a school. They may work at another school. Only AfriTech super admin can delete a Clerk user account entirely.
5. Staff can self-update personal details (name, photo, contact) but cannot change their own role, school assignment, or permissions.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 8 staff module documentation |
| 2026-04-26 | Added custom role staff type with org:staff base role | Custom roles feature confirmed |
| 2026-04-26 | Added payroll as Phase 3 planned feature | Confirmed — add later as feature toggle add-on |
| 2026-04-26 | Added location field for AfriTech regional reporting | Confirmed optional staff location tracking |
