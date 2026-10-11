# SUPERADMIN.md — AfriTech Super Admin Panel

## Related Documents

- `docs/modules/admin/ONBOARDING.md` — school onboarding workflow
- `docs/modules/admin/PLATFORM_METRICS.md` — revenue and platform metrics
- `docs/modules/admin/IMPERSONATION_FLOW.md` — impersonation operational guide
- `docs/modules/auth/ROLES.md` — AfriTech internal role definitions
- `docs/modules/auth/IMPERSONATION.md` — impersonation technical reference
- `docs/modules/auth/PERMISSIONS.md` — permission grant system
- `docs/DATABASE.md` — afritech schema tables
- `docs/RLS.md` — AfriTech role RLS policies

---

## Implementation Status (2026-10-11)

**Built, with the role differentiation this document asks for.**

`/admin` carries the overview, schools, health, pricing, features, overrides, billing,
networks, lenders, loans, incidents, curriculum, price bands and the Teacher Hub view.

**`0237` separated the AfriTech roles** this document describes — `super_admin`,
`regional_manager`, `support_agent`, `loan_officer`, `finance_officer`, `developer` — via
`afritech_role()` and `has_afritech_capability()`, with `afritech.staff_scope_assignments`
for regional scoping.

**`is_afritech_admin()` was deliberately left unchanged**, because 91 policies call it.
Differentiation sits *above* it: the broad function still answers "is this AfriTech at
all", and capability checks narrow from there. Rewriting it would have re-scoped 91
policies in one migration.

**A missing role claim resolves to `developer`, the least privileged role, not the most.**
A missing claim is a configuration fault, and the safe reading of a configuration fault is
"can see, cannot act".

**Still open:** 32 of 34 `admin_*` functions use the broad `is_afritech_admin()` rather
than a capability. The two that do not are the revenue functions added in `0261`, which
check `billing:read` — because a support engineer does not need MRR in order to do
support.

---

## Purpose

This document defines the AfriTech admin panel — what each internal role can see and do, how the panel is structured, and what tools are available for managing the ZSMS platform across all schools. Every Claude Code session building any AfriTech admin panel feature must read this document.

---

## Overview

The AfriTech admin panel is a separate authenticated section of the ZSMS web application accessible only to users with an `afritech:*` Clerk role. It sits at `zsms.co.zm/admin` and is completely invisible to school users — there is no link, button, or menu item that reveals its existence to non-AfriTech staff.

The panel is the operational hub for AfriTech Systems Limited — managing schools, monitoring the platform, supporting customers, overseeing loans, and tracking revenue.

---

## AfriTech Internal Roles

### `afritech:super_admin`

Full access to everything. Can access and modify any data at any school. Can impersonate any user. Can create and revoke access for other AfriTech team members. Can modify subscription tiers, apply discounts, and override billing. The only role that can delete school records or terminate accounts.

**Who holds this role:** Mwando (CTO), Julius (CFO), and any future C-level appointees.

### `afritech:regional_manager`

Scoped to their assigned country or region (from `afritech.staff_scope_assignments`). Can view all schools in their scope, manage onboarding tasks, and access school-level data read-only. Can grant support agents access to schools within their scope. Cannot modify billing, subscription tiers, or access schools outside their scope.

### `afritech:support_agent`

Read-only access to schools explicitly assigned to them via scope assignments or per-ticket grants. Can impersonate users read-only (no write operations). Write access requires a scoped time-bounded grant from a regional manager or super admin. Every impersonation session is logged with the support ticket reference.

### `afritech:loan_officer`

Access to the loan portfolio across all schools. Can view all loan applications, update application statuses (Phase 1 manual updates), manage the lender registry, track commission receivables, and view behaviour scores. Cannot access school operational data (student records, fee records, results) beyond what is directly tied to loan applications.

### `afritech:finance_officer`

Access to AfriTech's own financial data: subscription revenue, commission earned, billing records, and invoices. Manages school subscription changes (tier upgrades, discounts, billing adjustments). Cannot access individual school data or loan application PII.

### `afritech:developer`

Staging environment access by default. Production access via time-limited grants (automated request → super admin approval → auto-expiry after 4 hours maximum). Can access Edge Function logs, database query tools (read-only), and deployment status. Cannot impersonate users. All production access is logged.

---

## Admin Panel Structure

```
zsms.co.zm/admin
│
├── Dashboard          — Platform health overview (all roles)
├── Schools            — All schools management
│   ├── All Schools    — Search, filter, view any school
│   ├── Onboarding     — Schools in setup, task queue
│   ├── Trials         — Active trials, expiry timeline
│   └── At Risk        — Amber and red health schools
├── Loans              — Loan module operations (loan_officer)
│   ├── Applications   — All pending/active applications
│   ├── Lenders        — Lender registry management
│   └── Commissions    — Commission tracking and invoicing
├── Finance            — AfriTech revenue (finance_officer)
│   ├── MRR / ARR      — Revenue metrics
│   ├── Subscriptions  — Active subscriptions, billing
│   └── Discounts      — Applied adjustments, approvals
├── Alumni             — Alumni marketing (super_admin)
│   ├── Opted-In Users — Alumni with marketing_opt_in = TRUE
│   └── Campaigns      — Promotional message campaigns
├── Platform           — System health and metrics
│   ├── Metrics        — Nightly platform metrics dashboard
│   ├── Errors         — Sentry integration, error spikes
│   └── Jobs           — queue status, DLQ
├── Access             — AfriTech team management (super_admin)
│   ├── Team Members   — All AfriTech staff accounts
│   ├── Scope Assignments — Regional and school scopes
│   └── Dev Grants     — Production access request queue
└── Audit              — Global audit log
    ├── All Events     — Full audit log, searchable
    ├── AfriTech Access — Impersonation log
    └── Financial      — Financial events only
```

---

## School Health Dashboard

The main dashboard shows all schools in a health grid. Each school card shows:

```
┌──────────────────────────────────────────────┐
│  🟢 Sunrise Academy          ZM-LSK-0001     │
│  Active · Growth · 412 students              │
│  Setup: 94% complete                         │
│  Last activity: 2 hours ago                  │
│  MRR: K1,100 · Renews: Oct 31               │
│  [View]  [Contact]  [Impersonate]            │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│  🟡 Rainbow Academy          ZM-CBE-0003     │
│  Trial · Starter · 87 students               │
│  Setup: 38% complete · Trial ends: 8 days    │
│  Last activity: 3 days ago                   │
│  ⚠️ No contact recorded — follow up needed   │
│  [View]  [Contact]  [Impersonate]            │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│  🔴 Horizon School           ZM-LSK-0007     │
│  Suspended · Starter                         │
│  Subscription expired 12 days ago            │
│  Last contact: Sep 1 · No response           │
│  [View]  [Contact]  [Reactivate]             │
└──────────────────────────────────────────────┘
```

**Health thresholds:**
- 🟢 Green: Active subscription + checklist ≥ 80% + activity in last 7 days
- 🟡 Amber: Trial with < 14 days remaining OR checklist < 40% OR no activity in 14 days
- 🔴 Red: Suspended / trial expired / no activity in 30 days / checklist < 20%

---

## Platform Search

Super admins and regional managers can search across the entire platform from a universal search bar at the top of the admin panel:

**Search by:**
- School name or school ID (`ZM-LSK-0001`)
- Student ID (`STU-ZM-LSK-0001-00042`)
- Parent phone number (`+260977123456`)
- Staff email address
- Loan application reference (`LAP-ZM-LSK-0001-000001`)
- Receipt number (`REC-ZM-LSK-0001-000042`)
- Transaction reference

**Search results show:**
- Matching entity with school context
- Quick links to view the record
- Last activity timestamp
- For parents: all linked children and schools

The search is essential for support — a parent calls AfriTech saying "my payment was not confirmed" and the support agent finds the payment record in seconds using the parent's phone number.

---

## Lender Marketplace Management (Loan Officer)

```
Admin → Loans → Lenders

┌─────────────────────────────────────────────┐
│ Madison Finance                    ✅ Active  │
│ School Fee Loan · Emergency Loan            │
│ Min score: 500 · Commission: 2.5%           │
│ Integration: Email (Phase 1)                │
│ Total applications: 47 · Disbursed: 31      │
│ Commission earned: K8,525.00 (pending)      │
│ [Edit]  [View Applications]  [Deactivate]   │
└─────────────────────────────────────────────┘

[+ Add New Lender]
```

The loan officer manages lender details, updates commission tracking, marks commissions as received after payment, and monitors the loan portfolio by lender.

---

## Alumni Marketing Dashboard (Super Admin)

```
Admin → Alumni → Opted-In Users

Total alumni with marketing_opt_in = TRUE: 1,247
  Zambia (ZM):    1,156
  Other:             91

By graduation year:
  2026: 312 (this year's Form 6 graduates)
  2025: 428
  2024: 507

By school:
  Sunrise Academy:    234 opted-in alumni
  Rainbow Academy:    189 opted-in alumni
  ...

[Send Campaign]   [Export List]   [View Opt-Out History]
```

Campaign sending allows AfriTech to send promotional messages (scholarship announcements, marketplace promotions, study abroad opportunities) to all opted-in alumni or a filtered subset.

---

## Developer Access Request Flow

```
1. Developer logs into admin panel with staging credentials
2. Navigates to Admin → Access → Dev Grants → Request Production Access
3. Fills request form:
   Reason: "Investigating queued job failure on webhook-payment — support ticket #2847"
   Duration requested: 2 hours (max allowed: 4 hours)
   [Submit Request]

4. Super admin receives notification: "Developer [name] requesting production access"
   [Approve — 2 hours]   [Approve — 1 hour]   [Reject]

5. On approval:
   → staff_permission_grants row created: expires_at = NOW() + 2 hours
   → Developer notified: "Production access granted until [time]"
   → Developer can now run read queries on production Supabase
   → All queries logged in audit_logs

6. At expiry:
   → Grant auto-expires
   → Developer notified: "Production access has expired"
   → Audit log entry: "Dev grant expired for [developer]"
```

Maximum grant duration is 4 hours. After 4 hours, a new request must be submitted. This prevents access grants being left open indefinitely.

---

## Business Rules

1. The admin panel at `/admin` is inaccessible to any user without an `afritech:*` Clerk role. The middleware redirects them to the school dashboard.
2. Super admins can see and do everything. All their write actions on school data are logged with a mandatory reason.
3. Support agents have read-only impersonation by default. Every impersonation session requires a support ticket reference. Write access requires an explicit time-bounded grant from a regional manager or super admin.
4. Regional managers can only see schools within their assigned country or region scope. The scope is enforced at the RLS level using `afritech.staff_scope_assignments`.
5. Loan officers can see loan application PII (income, employment) because their role requires it. They cannot see school operational data (attendance, results, non-loan payments).
6. Finance officers see AfriTech's revenue data. They cannot see individual school data, student records, or loan application PII.
7. The developer role has no school data access by default. Every production access event is audited.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 15 admin module documentation |
| 2026-04-26 | Added lender marketplace management | Loan module confirmed with lender onboarding |
| 2026-04-26 | Added alumni marketing dashboard | Graduated account model confirmed |
| 2026-04-26 | Added automated developer access request | Decision 3 confirmed — automated with approval |
