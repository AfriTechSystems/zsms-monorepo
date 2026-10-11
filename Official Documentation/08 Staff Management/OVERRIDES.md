# OVERRIDES.md — Temporary Permission Grants for Staff

## Related Documents

- `docs/modules/auth/PERMISSIONS.md` — full permission grant system technical reference
- `docs/modules/staff/STAFF.md` — staff entity reference
- `docs/modules/staff/ASSIGNMENTS.md` — class and subject assignments
- `docs/DATABASE.md` — staff_permission_grants table
- `docs/RLS.md` — has_permission_grant() function

---

## Implementation Status (2026-10-11)

**Built and reachable as of `0236`** — see `PERMISSIONS.md` for the full account.

Before then the tables, `has_permission_grant()` and **15 live RLS policies** calling it
all existed, with no route, no screen and no rows, so the function always returned false
and everything this document describes was unreachable.

Screen: `/school/[code]/settings/permissions`. Writing goes through
`grant_staff_permission()` rather than an INSERT policy, because "you cannot grant what
you do not hold" cannot live in a route a direct PostgREST call skips.

**Not built:** the two-day expiry notification. There is no notification channel, so the
screen warns about grants lapsing within two days instead.

---

## Purpose

This document is the school-facing practical guide to the permission override system. Where `docs/modules/auth/PERMISSIONS.md` covers the technical implementation, this document covers real school scenarios — when to use grants, how to create them, how they expire, and how to manage them. Every Claude Code session building the grants management UI must read both documents.

---

## Overview

Every staff member starts with the minimum access their role requires. The grant system allows school owners and principals to temporarily extend any staff member's access for a defined period — without changing their permanent role.

The most common scenario: the accountant is on sick leave for two weeks. The principal needs someone to record payments. Rather than changing a teacher's role or creating a new account, the principal grants the teacher payment recording access for exactly 14 days. When the grant expires, the teacher's access automatically reverts. No manual revocation needed.

---

## Who Can Create Grants

| Role | Can Grant To | Modules They Can Grant |
|---|---|---|
| `org:owner` | Any staff member at their school | Any module the owner has access to |
| `org:principal` | Teachers and admins at their school | All except billing and subscription |
| `org:admin` | Cannot create grants | — |
| `org:accountant` | Cannot create grants | — |
| `org:teacher` | Cannot create grants | — |
| Custom role staff | Cannot create grants | — |
| AfriTech super admin | Any user at any school | Any module including private schema |
| AfriTech regional manager | Support agents in their region | Modules within their own access scope |

**Key rule:** You cannot grant access you do not yourself have.

---

## Creating a Grant

**Location:** Staff → [Staff Member Name] → Temporary Access → Add Grant

Or from the school-wide view: Staff → Permissions → Active Grants → Add Grant

### Grant Form

```
Grant temporary access to: [Staff Member Name — pre-filled]
Module: [dropdown]
  Fees — Record payments and view fee records
  Payments — Record and verify payments
  Results — View and enter exam marks
  Results (Publish) — Publish results for a term
  Students — Create and update student records
  Communication — Send school announcements
  Staff — Manage staff assignments
  Reports — Generate and export financial/academic reports

Action: [dropdown based on module selected]
  Read — View data only
  Write — Create and update records
  Export — Generate and download reports
  Publish — Approve and publish data

Scope (optional): [text field]
  Leave blank for full module access
  Or specify: "Grade 9A Mathematics only" / "Term 2 results only"

Reason (required): [text field]
  E.g. "Accountant on sick leave — covering fee payment recording"
  Or support ticket reference: "Support ticket #2847"

Duration: [radio buttons]
  ○ 7 days
  ○ 14 days
  ○ 30 days
  ○ Until end of term
  ○ Custom date: [date picker]
  ○ Manual revocation only (no expiry)

[Save Grant]
```

**Confirmation shown before saving:**
```
You are granting [Name] access to [Module — Action] until [Date].
This will be logged in the school audit trail.
[Confirm]   [Cancel]
```

---

## Common School Scenarios

### Scenario 1 — Accountant on Sick Leave

**Situation:** Accountant is ill. Parents are bringing fee payments to school. Receipts need to be issued.

**Action:** Principal grants the admin `Payments — Write` access for 14 days.

**Result:** Admin can record payments and generate receipts. Cannot access the full fee management module (fee structures, reports) unless additionally granted.

**Grant expires:** After 14 days, admin loses payment recording access automatically.

---

### Scenario 2 — Department Head Results Moderation

**Situation:** Head of Mathematics needs to review all maths results across all classes before the principal publishes, to check for grading inconsistencies.

**Action:** Principal grants the mathematics head `Results — Read` with scope "subject: mathematics".

**Result:** The head of department can see all mathematics marks across all classes, not just their own assigned class.

**Grant expires:** Principal sets expiry to end of term — after results are published this access is no longer needed.

---

### Scenario 3 — Acting Principal

**Situation:** Principal is travelling for two weeks. A senior teacher needs to manage the school.

**Action:** Owner grants the senior teacher `Results — Publish`, `Staff — Write`, and `Communication — Send` access for 14 days.

**Result:** The acting principal can publish results, manage staff assignments, and send school-wide announcements.

**Note:** The acting principal does not get full principal-level access — only the specific modules the owner explicitly grants.

---

### Scenario 4 — Support Agent Data Correction

**Situation:** AfriTech support receives a ticket — a student's name was recorded incorrectly during import.

**Action:** AfriTech regional manager grants the support agent `Students — Write` for 4 hours, scoped to the specific student ID.

**Result:** Support agent can update the student's name. Cannot access any other student records.

**Grant expires:** After 4 hours automatically.

---

### Scenario 5 — Teacher Covering Another Class

**Situation:** A teacher is absent. Another teacher needs to mark attendance for their class today.

**Action:** Principal grants the covering teacher `Attendance — Write` for 1 day.

**Alternative action:** The principal or admin marks attendance directly (they have write access by default).

---

## Viewing Active Grants

**Location:** Staff → Permissions → Active Grants

Shows a table of all currently active grants at the school:

| Staff Member | Module | Action | Granted By | Expires | Reason |
|---|---|---|---|---|---|
| Mr. Banda | Payments | Write | Mrs. Phiri (Principal) | Oct 15 (8 days) | Accountant sick leave |
| Mrs. Mwale | Results | Read | Mrs. Phiri (Principal) | End of term | Maths moderation |

**Actions available:**
- Revoke early — cancel the grant before it expires
- Extend — add more time to the grant

---

## Grant Expiry Notifications

### Pre-Expiry Warning

2 days before any active grant expires, the **grantor** receives an in-app notification:

```
⏰ Permission grant expiring soon
Mr. Banda's access to Payments — Write expires in 2 days (Oct 15).
[Extend Grant]   [Let it expire]
```

### Expiry Notification

When a grant expires, the **grantee** receives an in-app notification:

```
Your temporary access to Payments has ended.
Contact [Principal Name] if you need this extended.
```

The grantee's next action requiring the expired grant returns:

```
"Your temporary access to this feature has expired.
 Contact your school admin to renew if needed."
```

---

## Grant Audit Trail

Every grant event is written to `public.audit_logs`:

| Event | What Is Logged |
|---|---|
| Grant created | Grantor ID, grantee ID, module, action, scope, reason, expiry |
| Grant used for write | Grantee ID, module, record affected, grant ID used |
| Grant manually revoked | Revoker ID, grantee ID, module, revocation timestamp |
| Grant auto-expired | Grantee ID, module, original expiry date |

School owners can view their school's complete grant history in Settings → Audit Log → Filter by "Permission Grants".

---

## Business Rules

1. All grants require a non-empty reason. Grants without a reason are rejected at the API layer.
2. Grants cannot exceed the grantor's own permission level. A principal cannot grant billing access because the principal does not have billing access.
3. AfriTech support agent grants that include financial write access must include a scope_detail value identifying the specific record or student. Broad financial write grants to support agents are rejected.
4. The grant system supplements but does not replace role-based access. A grant for `Fees — Read` to a teacher gives them fee read access regardless of the school's default `school_permissions` setting for teachers on fees.
5. When a staff member is removed from the school, all their active grants at that school are immediately deactivated.
6. Grants with no expiry (`manual revocation only`) must be used sparingly. They should be reviewed quarterly by the school owner. The admin panel shows a warning for grants older than 30 days with no expiry.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 8 staff module documentation |
