# IMPERSONATION_FLOW.md — Impersonation Operational Guide

## Related Documents

- `docs/modules/auth/IMPERSONATION.md` — technical impersonation implementation
- `docs/modules/admin/SUPERADMIN.md` — admin panel impersonation entry point
- `docs/modules/auth/ROLES.md` — AfriTech roles and their impersonation limits
- `docs/modules/auth/PERMISSIONS.md` — write grants during impersonation
- `docs/DATABASE.md` — audit_logs impersonation fields

---

## Implementation Status (2026-10-11)

**Fully built — and `CLAUDE.md` said otherwise until today.**

That file's API route list carried `admin/impersonate` *(501 — needs Clerk actor tokens)*.
There is no 501 in the route. It mints a real Clerk actor token through `@clerk/backend`,
records the session via `begin_impersonation_session()`, and **revokes the token if the
database refuses** — so a trail can never claim a session that did not happen.

The order is deliberate and worth preserving: mint first, record second, undo the mint on
refusal. Recording first would leave the trail asserting a session that failed to start.

`impersonation_sessions`, `end_impersonation_session()`, `my_impersonation_context()` and
`is_impersonation_session()` all exist, and the token's two-hour lifetime is what this
document recommends — which matters because if the operator closes the tab without ending
the session, nothing else does.

Authorisation lives in `begin_impersonation_session()`, which enforces the `impersonate`
capability: a developer and a regional manager are both refused there per ROLES.md. The
route does not re-check, because a second copy would drift and the route is the copy a
direct call skips.

---

## Purpose

This document is the operational guide for AfriTech team members who use impersonation to support schools. Where `IMPERSONATION.md` covers the technical implementation, this document covers the practical workflow — when to impersonate, how to start and end a session, what you can and cannot do, what is logged, and what school owners can see about AfriTech access to their data.

---

## Overview

Impersonation allows AfriTech team members to see exactly what a school user sees, diagnose issues from within their account, and — for super admins — make corrections on their behalf. It is a powerful tool that must be used deliberately, with a documented reason, and ended cleanly. Every impersonation session is logged permanently.

---

## When to Impersonate

Impersonate only when:
- A school user reports an issue that cannot be diagnosed from the admin panel view
- A data correction needs to be made that the school user cannot do themselves
- AfriTech is performing a scheduled audit or account review (advance notice required)

Do not impersonate:
- To browse a school's data out of curiosity
- When the issue can be resolved by asking the school user to share a screenshot
- When the audit log already shows what happened

---

## Starting an Impersonation Session

### Step 1 — Initiate from Admin Panel

```
Admin → Schools → [School Name] → [Impersonate as ▼]
  Impersonate as school owner
  Impersonate as principal
  Impersonate as accountant
  Impersonate as teacher [select specific teacher]
  Impersonate as parent [search by phone]
```

### Step 2 — Mandatory Reason and Ticket Reference

```
Start Impersonation Session
━━━━━━━━━━━━━━━━━━━━━━━━━━

School:     Sunrise Academy (ZM-LSK-0001)
Impersonate as: School Owner (Grace Mwale)

Reason (required):
[text field — min 20 characters]
"Investigating payment verification failure reported by school owner — ticket #2847"

Support ticket reference (required for support agents):
[text field]
"#2847"

Duration: This session will be logged. End it when your task is complete.

[Start Impersonation]   [Cancel]
```

### Step 3 — Audit Log Entry on Start

```typescript
// Written before the impersonation token is generated
await supabaseAdmin.from('public.audit_logs').insert({
  school_id: schoolId,
  actor_user_id: afriTechStaffId,
  impersonated_user_id: targetUserId,
  action: 'impersonation_start',
  metadata: {
    reason: reason,
    ticket_reference: ticketRef,
    afritech_role: staffRole,
    target_role: targetRole,
    session_start: new Date().toISOString(),
  }
})
```

### Step 4 — The Impersonation Session

After clicking Start Impersonation, the AfriTech team member is redirected to the school's dashboard as the impersonated user. A persistent banner appears at the top of every page:

```
🔒 IMPERSONATION MODE
You are viewing Sunrise Academy as Grace Mwale (Owner)
Support ticket: #2847
Your actions here are logged and visible to the school owner.

[End Impersonation Session]
```

This banner cannot be dismissed. It is always visible so the team member never forgets they are in an impersonated session.

---

## What You Can Do During Impersonation

### Support Agent (Read-Only by Default)

```
✅ View any school data (students, fees, results, attendance, staff)
✅ View the school's audit log
✅ View message delivery logs
✅ Diagnose configuration issues
✅ Take screenshots for documentation

❌ Create, update, or delete any record
❌ Change subscription or billing settings
❌ Send WhatsApp messages or announcements
❌ Access private schema (loan PII)
```

### Support Agent with Write Grant

A regional manager or super admin can grant a support agent temporary write access for a specific scope:

```
Grant: payments:write
Scope: "Specific payment ID: pay-uuid-123"
Duration: 2 hours
Reason: "Correct incorrectly recorded payment amount — ticket #2847"
```

Every write action during an impersonation session with a write grant is logged with both the real actor (support agent) and the impersonated user identity:

```json
{
  "action": "payment_verify",
  "actor_user_id": "support_agent_clerk_id",
  "impersonated_user_id": "school_owner_clerk_id",
  "school_id": "school-uuid",
  "metadata": {
    "grant_id": "grant-uuid",
    "ticket_reference": "#2847"
  }
}
```

### Super Admin (Full CRUD)

Super admins have full CRUD during impersonation. Every write action requires a reason:

```
⚠️ You are about to update a payment record while impersonating Grace Mwale.
This action will be permanently logged.

Reason for this change (required):
[text field]
"Correcting amount entered as K2,500 instead of K2,050 — confirmed with school owner by phone"

[Confirm Update]   [Cancel]
```

The reason is stored in the audit log entry alongside the old and new values.

---

## Ending an Impersonation Session

The team member clicks "End Impersonation Session" in the persistent banner. This:

1. Revokes the Clerk actor token
2. Redirects to the AfriTech admin panel (not the school dashboard)
3. Writes a session end audit log entry:

```typescript
await supabaseAdmin.from('public.audit_logs').insert({
  school_id: schoolId,
  actor_user_id: afriTechStaffId,
  impersonated_user_id: targetUserId,
  action: 'impersonation_end',
  metadata: {
    session_duration_minutes: Math.round(sessionDurationMs / 60000),
    actions_taken: writeActionCount,
    ticket_reference: ticketRef,
  }
})
```

If the team member closes the browser without ending the session, the Clerk actor token expires automatically after 30 minutes of inactivity.

---

## What the School Owner Sees

School owners can see a log of every time AfriTech has accessed their school's data. This is a transparency and trust-building feature.

**Location:** Settings → Security → AfriTech Access Log

```
AfriTech Access Log — Sunrise Academy

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

15 Sep 2026 · 14:22 — 14:38 (16 minutes)
Role: Support Agent
Reason: Payment verification issue investigation
Ticket: #2847
Actions taken: Read-only view

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

3 Sep 2026 · 09:15 — 09:47 (32 minutes)
Role: Regional Manager
Reason: Onboarding assistance — grade structure setup
No ticket
Actions taken: Read-only view + 2 configuration changes

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Contact AfriTech about an access event]
```

**What the school owner sees:**
- AfriTech team member's role (not their name — privacy for AfriTech staff)
- Date, time, and duration of the session
- The reason provided
- Whether any changes were made and how many
- A contact button to query any access event

**What the school owner does NOT see:**
- The AfriTech team member's name or identity
- Exactly which records were viewed
- The content of any data accessed

This log is built from the `audit_logs` table filtered to `action IN ('impersonation_start', 'impersonation_end')` and `actor_user_id` within the AfriTech staff scope.

---

## Impersonation Without the School Owner's Knowledge

Impersonation is designed to be invisible to the impersonated user (school owner, teacher, parent). The impersonated user does not receive any notification that their account is being accessed. Only the school owner can see the access log in Settings → Security.

This is the standard model for enterprise SaaS support. However:

- AfriTech must never impersonate a user to read data for any purpose other than support
- AfriTech must never share impersonated session data externally
- Impersonation for commercial intelligence or competitive analysis is strictly prohibited
- All impersonation sessions are audited and can be reviewed by AfriTech's own compliance function

---

## Audit Log Retention for Impersonation

Impersonation audit log entries are retained indefinitely — they are never archived or deleted. This ensures that even years later, AfriTech can demonstrate exactly what its team accessed and why.

For school-level audit log entries created during an impersonation session (e.g. a payment correction), the `impersonated_user_id` field makes them permanently distinguishable from genuine school user actions.

---

## Business Rules

1. Every impersonation session requires a non-empty reason (minimum 20 characters). Sessions without a reason cannot be started.
2. Support agents require a support ticket reference for every session. Regional managers and super admins do not — they may access schools proactively for onboarding and account management.
3. Support agent write access during impersonation requires an explicit time-bounded grant from a regional manager or super admin. Default is read-only.
4. Super admin write actions during impersonation require a per-action reason. The reason is stored in the audit log entry alongside old and new values.
5. Impersonation sessions automatically expire after 30 minutes of inactivity. The Clerk actor token is time-limited.
6. School owners can view the AfriTech access log in Settings → Security. They see role, date, duration, and action count — not staff names or data details.
7. Impersonation audit log entries are retained indefinitely and cannot be deleted by any user including super admins.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 15 admin module documentation |
| 2026-04-26 | Added school owner access log visibility | Decision 1 confirmed — transparency feature |
| 2026-04-26 | Added per-action reason for super admin writes | Full CRUD requires documented justification |
| 2026-04-26 | Added 30-minute session auto-expiry | Prevents forgotten impersonation sessions |
