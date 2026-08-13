# IMPERSONATION.md — AfriTech Staff Impersonation

## Related Documents

- `docs/modules/auth/AUTH.md` — authentication flows
- `docs/modules/auth/ROLES.md` — AfriTech internal role definitions
- `docs/modules/auth/SESSIONS.md` — session mechanics and duration
- `docs/modules/auth/PERMISSIONS.md` — permission grant system for support staff
- `docs/DATABASE.md` — audit_logs table, impersonation event recording
- `docs/RLS.md` — how act claim affects RLS, is_impersonation_session() function
- `docs/modules/admin/SUPERADMIN.md` — super admin panel where impersonation is initiated

---

## Purpose

This document defines the complete impersonation system in ZSMS — how AfriTech staff access user sessions for support and platform management, what they can do during impersonation, how every action is tracked, and how different AfriTech roles experience impersonation differently. Every Claude Code session building any impersonation feature, actor token handling, or impersonation-aware access control must read this document.

---

## Overview

Impersonation allows authorised AfriTech staff to view and operate the ZSMS platform exactly as a specific user would — seeing their school, their data, their dashboard — for the purpose of providing support, diagnosing issues, or making corrections on behalf of the user. It is implemented using Clerk's actor token mechanism.

ZSMS impersonation has one fundamental rule that distinguishes it from most SaaS platforms: **AfriTech super admins retain full CRUD access during impersonation**. All other AfriTech roles (regional managers, support agents) have financial write operations restricted during their impersonation sessions. This distinction is intentional and reflects the different purposes of impersonation across roles.

---

## How Impersonation Works Technically

### The Actor Token

When a super admin impersonates a user, Clerk generates an actor token. This is a JWT where:

- `sub` — the impersonated user's Clerk ID (what `get_user_id()` reads)
- `o.id` — the impersonated user's organisation ID (what `get_school_id()` reads)
- `o.rol` — the impersonated user's role (what `get_user_role()` reads)
- `act.sub` — the real AfriTech staff member's Clerk ID (what `get_actor_id()` reads)

This means RLS policies evaluate as if the impersonated user is making the request. The super admin sees exactly what the user sees. Simultaneously, `is_impersonation_session()` returns TRUE (because `act` is present), and `get_actor_id()` returns the super admin's real identity.

### JWT Comparison

```json
// Normal school owner session
{
  "sub": "user_owner_abc",
  "o": { "id": "org_ZM-LSK-0001", "rol": "org:owner" },
  "act": null
}

// Super admin impersonating that school owner
{
  "sub": "user_owner_abc",
  "o": { "id": "org_ZM-LSK-0001", "rol": "org:owner" },
  "act": { "sub": "user_mwando_superadmin" }
}
```

Every system component — RLS policies, Edge Functions, API routes — receives the same JWT. They all see the school owner's identity as `sub` and the real actor via `act.sub`.

---

## Impersonation by Role

### AfriTech Super Admin — Full CRUD During Impersonation

Super admins (`afritech:super_admin`) retain complete access during impersonation. They can:

- Read any data the impersonated user can read
- Create, update, and delete any data the impersonated user can modify
- Additionally perform actions the impersonated user cannot — for example, correcting a fee record that is normally immutable, or accessing data the school role cannot see — because the super admin's own RLS override (`is_afritech_admin()`) remains active even during impersonation

**Why super admins need full CRUD during impersonation:** When a school owner calls AfriTech support because a student record was created with the wrong name, the super admin needs to fix it immediately while on the call — not explain to the school owner how to do it themselves. The super admin's ability to act is what makes support effective.

**The safety mechanism is the audit trail, not access restriction.** Every action taken during impersonation is logged with the actor's real identity. This is more effective than blocking writes — it creates accountability rather than just preventing action.

### AfriTech Regional Manager — Read-Only Impersonation

Regional managers can impersonate users within their assigned scope for diagnostic purposes. During their impersonation session:

- Full read access to everything the impersonated user sees
- No write operations of any kind
- The impersonation banner shows their name and role

If a regional manager needs to make a change during a support session, they must either: escalate to a super admin, or receive a time-bounded write grant from a super admin that activates during the impersonation session.

### AfriTech Support Agent — Read-Only Impersonation with Scoped Write Grants

Support agents can impersonate users within their assigned schools. During impersonation:

- Full read access within their scope
- Write access only where an explicit scoped grant exists (e.g. "can update this specific student's phone number at this school for 4 hours")
- Financial write operations (payments, fee record modifications) require an explicit grant even if a general write grant exists

This means a support agent diagnosing why a parent cannot see their child's results can impersonate the parent, see exactly what they see, and identify the issue — but cannot accidentally change fee records or payment data while investigating.

---

## Initiating an Impersonation Session

### From the Super Admin Panel

```
1. Super admin opens Platform → Users
2. Searches by: name, phone number, email, or school ID
3. User profile opens showing: role, school, last login, recent audit events
4. Super admin clicks "Impersonate User"
5. A confirmation prompt appears:
   "You are about to impersonate [Name] at [School].
    All actions will be logged under your identity.
    Reason for impersonation: [required text field]"
6. Super admin enters a reason (support ticket number or description)
7. ZSMS calls Clerk API: createActorToken(targetUserId)
8. A new browser tab opens with the impersonation session active
9. The impersonation session starts
```

The reason field is mandatory. Impersonation without a stated reason is rejected at the API layer. The reason is stored in the audit log entry for this impersonation session.

### From a Support Ticket (Future)

When a support ticketing system is integrated, impersonation can be initiated directly from a ticket context. The ticket ID auto-populates the reason field. Not implemented in Phase 1 — manual reason entry is sufficient.

---

## The Impersonation Banner

Every page rendered during an impersonation session shows a persistent banner at the top. The banner cannot be dismissed, hidden, or scrolled past.

**For super admins:**
```
🔴  You are viewing as [Full Name] — [Role] at [School Name]
    Acting as: Mwando Hamwenda (Super Admin)  |  [End Impersonation]
```

**For support agents:**
```
🟡  Support View — [Full Name] at [School Name]  (Read Only)
    Agent: [Agent Name]  |  [End Impersonation]
```

The colour distinction (red for super admin full access, yellow for read-only) prevents confusion about what level of access is active. This is important when a super admin is switching between multiple impersonation sessions.

**Ending impersonation:** Clicking "End Impersonation" closes the tab and expires the actor token. The super admin returns to their own session in the original tab. If the tab is closed without clicking End Impersonation, the actor token expires at the same time the impersonated user's session would normally expire — but because these tokens are short-lived (configurable, recommended 2 hours), the exposure window is limited.

---

## What Is Logged During Impersonation

Every database write during an impersonation session produces an audit log entry with both identities. Every significant read is also logged (views of financial data, loan applications, personal details).

### Audit Log Fields During Impersonation

```json
{
  "actor_user_id": "user_mwando_superadmin",
  "impersonated_user_id": "user_owner_abc",
  "action": "update",
  "table_name": "students",
  "record_id": "student-uuid",
  "old_values": { "first_name": "Chanda", "last_name": "Bwalya" },
  "new_values": { "first_name": "Chanda", "last_name": "Mwale" },
  "metadata": {
    "impersonation_reason": "Support ticket #2847 — name correction",
    "impersonation_session_id": "session-uuid"
  },
  "ip_address": "197.x.x.x",
  "created_at": "2026-09-15T10:23:00Z"
}
```

The impersonated user's audit log view (visible to school owners) shows this entry as: "Record updated by AfriTech Support (on behalf of [School Name])." The full actor details are visible to AfriTech super admins only — the school owner sees that an AfriTech staff member made a change, but not which specific person.

### Impersonation Start and End Events

Two additional audit log entries are created for every impersonation session:

```json
// Session start
{
  "actor_user_id": "user_mwando_superadmin",
  "impersonated_user_id": "user_owner_abc",
  "action": "impersonate_start",
  "table_name": "sessions",
  "metadata": {
    "reason": "Support ticket #2847 — name correction",
    "impersonated_role": "org:owner",
    "impersonated_school": "ZM-LSK-0001"
  }
}

// Session end
{
  "actor_user_id": "user_mwando_superadmin",
  "impersonated_user_id": "user_owner_abc",
  "action": "impersonate_end",
  "table_name": "sessions",
  "metadata": {
    "session_duration_minutes": 12,
    "actions_taken": 2
  }
}
```

---

## Impersonating AfriTech Internal Users

Super admins can also impersonate other AfriTech team members. This is used for:

- Diagnosing permission issues a support agent is experiencing
- Verifying that a scope assignment is working correctly
- Training — walking through the support agent experience

The same actor token mechanism applies. The audit trail captures: super admin A impersonating support agent B. All actions taken during this session are attributed to super admin A.

Only super admins can impersonate other AfriTech team members. A regional manager cannot impersonate a support agent.

---

## Private Schema Access During Impersonation

The `private` schema (loan applications, consent logs) behaves differently during impersonation:

**Super admin impersonating a parent:** The super admin can access the parent's loan applications — because `is_afritech_admin()` returns TRUE based on their actor token's organisation affiliation, not the impersonated user's. The impersonated parent's own RLS policy also allows reading their own records. Both policies permit access.

**Super admin impersonating a school accountant:** The super admin can see the loan dashboard summary (which the accountant normally sees). The super admin can also access the full loan application details — because `is_afritech_admin()` still returns TRUE. The accountant's RLS policy alone would not permit this access.

**Support agent impersonating anyone:** Support agents do not have `is_afritech_admin()` returning TRUE. When impersonating a parent, they can only see what the parent sees (their own loan applications). When impersonating a school accountant, they see only the summary-level loan data the accountant is permitted to see. Private schema PII remains protected.

---

## Impersonation and the Payment Verification Workflow

When a super admin is impersonating a school accountant and needs to approve or reject a parent's payment proof, the verification action is permitted — super admins retain full CRUD. The audit log records:

```
actor: super_admin
impersonating: accountant_user
action: update
table: payments
field: status
old_value: pending_verification
new_value: verified
reason: "Support call — accountant locked out, urgent payment approval needed"
```

This creates a clear record that AfriTech staff performed an action that school staff normally perform, with an explicit reason. The school owner can see this in their audit log.

---

## Impersonation Limits and Safeguards

**Concurrent impersonation:** A super admin can have multiple impersonation sessions open in multiple browser tabs simultaneously. Each tab is an independent Clerk actor token. This is permitted because super admins sometimes need to cross-reference what two different school users see. Every session is independently logged.

**Impersonation of another super admin:** Super admins can impersonate other super admins. This is intentional — used for debugging permission issues. The actor chain in the JWT distinguishes who is really acting.

**Loop prevention:** A support agent cannot use their impersonated session to impersonate another user. Clerk's actor token does not support actor-within-actor chaining. If a support agent needs to impersonate a second user during a session, they must end their current impersonation and start a new one.

**Notification to impersonated user (optional):** A configuration option exists to notify users when their account is impersonated. For school owners, this can be enabled in school settings: "Notify me when AfriTech staff access my account." When enabled, an in-app notification is sent: "AfriTech support accessed your account on [date] for support purposes." This builds trust. Not enabled by default in Phase 1 — recommended to enable once schools are comfortable with the platform.

---

## Business Rules

1. Every impersonation session requires a reason. The API rejects impersonation requests with an empty reason field.
2. Super admins retain full CRUD during impersonation. There are no write restrictions for this role.
3. Regional managers and support agents have read-only impersonation by default. Write access requires an explicit scoped grant created before or during the session.
4. All impersonation events — session start, every write action, session end — are logged in `audit_logs` with both actor and impersonated user identities.
5. The impersonation banner is rendered server-side and cannot be suppressed by client-side code. It appears on every page during an impersonation session.
6. Actor tokens are short-lived (2 hours recommended). After expiry, the impersonation session ends and the super admin must initiate a new session if more work is needed.
7. Private schema access during impersonation is governed by the real actor's AfriTech role, not the impersonated user's role. Super admins always have private schema access regardless of who they are impersonating.
8. The `afritech-systems-admin` organisation contains all AfriTech internal roles. A user in this organisation can impersonate any user in any school organisation. No school-domain user can impersonate any other user.

---

## Edge Cases and Error Handling

**Super admin impersonates a user whose school is suspended:** The impersonated session shows the suspended school's read-only view — the same view the school owner would see. This allows the super admin to verify the school's experience and explain what the owner will see when they try to log in.

**Actor token expires mid-session:** The Clerk SDK detects the expired actor token on the next JWT refresh attempt. The browser tab redirects to a "Impersonation session expired" page with a button to return to the super admin panel and restart if needed. Any unsaved form data is lost — this is an edge case that occurs only after 2 hours of continuous impersonation.

**Support agent attempts a write during read-only impersonation:** The API returns 403 with code `IMPERSONATION_WRITE_RESTRICTED`. The support agent sees: "This action is not available in support view. Contact your manager to request temporary write access." The attempt is logged in the audit trail.

**School owner reports that a change was made without their knowledge:** The super admin panel provides a full impersonation history for every school — who accessed what, when, and what they changed. This history is the first reference point for any dispute.

---

## Security Considerations

- Actor tokens are issued by Clerk and cannot be forged by application code. The application does not generate actor tokens — it requests them from Clerk's API using the Clerk secret key.
- The Clerk secret key used to create actor tokens is available only in Edge Functions and server-side API routes. It cannot be accessed from the browser or mobile app.
- Impersonation is a super admin capability only — it requires membership in the `afritech-systems-admin` organisation. Even if a school owner somehow obtained a super admin's JWT, they could not create actor tokens for other users without the Clerk secret key.
- The audit trail for impersonation is immutable. Once an impersonation event is written to `audit_logs`, it cannot be deleted or modified by any user including super admins.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 2 auth documentation |
| 2026-04-26 | Confirmed super admin full CRUD during impersonation | AfriTech support operational requirement |
| 2026-04-26 | Added regional manager and support agent impersonation model | Confirmed internal team role structure |
| 2026-04-26 | Added private schema impersonation behaviour | Clarified loan data access rules during impersonation |
