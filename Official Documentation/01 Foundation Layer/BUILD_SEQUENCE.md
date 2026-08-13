# BUILD_SEQUENCE.md — Phased Build Plan

## Related Documents

- `01 Foundation Layer/THIRTEEN_LAYER_COMPLIANCE.md` — re-audited at every phase gate
- `16 Testing and Launch/TEST_STRATEGY.md` — the E2E tests that gate each phase
- `16 Testing and Launch/LAUNCH_CHECKLIST.md` — the Phase 6 go/no-go gate
- `16 Testing and Launch/LOAD_TESTING.md` — milestone load verification
- `05 Core Database and API Reference/MIGRATIONS.md` — migration sequence 0001–0065
- `01 Foundation Layer/DYNAMIC_CONFIG.md` — configuration tables built in Phase 0
- `01 Foundation Layer/DECISIONS.md` — ADR-030 through ADR-035
- `01 Foundation Layer/ENV.md` — environment provisioning per phase

---

## Purpose

This document defines the order in which ZSMS is built: six build phases after a foundation phase, each one backend-first, each gated by end-to-end tests that must pass before the next phase begins. It exists so that build order is a decision made once, deliberately, rather than re-litigated every time a new module looks more interesting than the one in progress.

---

## Overview

### Backend-first, within every phase

Each phase builds in the same fixed order:

```
1. Migration          → schema, constraints, indexes
2. RLS policies       → every new table, tested with pgTAP
3. Types              → supabase gen types typescript
4. API / Edge Fns     → business logic, validated inputs
5. Integration tests  → the API works without a UI
6. UI                 → web, then mobile where applicable
7. E2E gate           → the phase is not done until this passes
```

The reason for this order is specific to how ZSMS enforces security. Tenant isolation lives in the database (ADR-002), so RLS is not a late hardening step — it is the second thing built, before any code depends on the table. A table that gets a UI before it gets a policy will ship without one, and `CONVENTIONS.md` prohibition #4 exists precisely because that is the default failure mode of UI-first development.

### Two meanings of "phase" — do not confuse them

The documentation uses "phase" in two distinct senses, and conflating them causes real planning errors:

| Term | Meaning | Where used |
|---|---|---|
| **Build phase** (this document) | Phase 0–6, the construction order | This document only |
| **Product phase** | Long-run product evolution | `LOANS.md` (1–3), `AI_OVERVIEW.md` (2–4), `INTEGRATIONS.md` (1–3) |

The loan module's "Phase 3" (ZSMS as licensed MFI, 2028+) and the AI module's "Phase 4" (predictive intelligence, 2028+) are product phases far beyond this build plan. **Build Phase 6 delivers the commercial launch, not the full product roadmap.** Where this document says "Phase", it means build phase.

---

## Phase 0 — Foundation and Scaffold

**Goal:** an empty but complete skeleton — schema, security, auth, and pipeline — that every later phase plugs into.

| Workstream | Deliverable |
|---|---|
| Monorepo | Turborepo, `apps/web`, `apps/mobile`, `packages/{auth-provider,types,utils,validators,config}` |
| Database | Migrations `0001`–`0065` applied to `zsms-dev` |
| Extensions | `vector` and `pgtap` in the `extensions` schema (already enabled on dev) |
| Config tables | The eight `afritech` configuration tables — migrations `0061`–`0065` |
| RLS | `get_school_id()` and policies for every table, with pgTAP coverage |
| Auth | Clerk behind `packages/auth-provider`; no direct Clerk import elsewhere |
| Queue | Queue abstraction with the BullMQ driver as default (ADR-035) |
| CI/CD | GitHub Actions: lint, type-check, unit tests, pgTAP, migration verification |
| Observability | Sentry, PostHog, health endpoint |
| Environments | **`zsms-staging` provisioned in `af-south-1` at the end of this phase** |

**Phase 0 closes the Layer 7 gap.** `THIRTEEN_LAYER_COMPLIANCE.md` records CI-CD as **Thin**, and `CONVENTIONS.md` prohibition #10 — no migration reaches production without integration verification — currently depends on discipline alone. Phase 0 is where that becomes automated, and it must be done before the first production migration rather than after.

**E2E gate:**
- A user signs up, a school is created, a Clerk organisation is provisioned, and the user lands authenticated on an empty dashboard.
- pgTAP suite passes: cross-school isolation, teacher class scoping, parent child scoping, `private` schema inaccessible to `anon`, `audit_logs` not updatable.
- A job enqueued through the abstraction is processed by a worker.
- CI blocks a merge that adds a table without an RLS policy.

---

## Phase 1 — Core School Operations

**Goal:** the entities everything else references.

Schools and tenancy (`SCHOOL_SETUP.md`, `SCHOOL_CONFIG.md`, `PUBLIC_DIRECTORY.md`), students and the ID system (`STUDENTS.md`, `STUDENT_ID.md`, `BULK_IMPORT.md`, `TRANSFER.md`), parents (`PARENT_LINKING.md`), staff and permissions (`STAFF.md`, `INVITATIONS.md`, `ASSIGNMENTS.md`, `OVERRIDES.md`), and trial lifecycle (`TRIAL.md`).

**E2E gate:**
- Admin onboards a school, configures grade levels using the hybrid ECZ/Form option, and invites staff.
- Admin bulk-imports 50 students from CSV with column mapping and duplicate detection.
- A parent links to a student and sees only their own children.
- A teacher is assigned classes and sees only those classes.
- Trial countdown and expiry notifications fire on schedule.

---

## Phase 2 — Academic Operations

**Goal:** the daily-use core — the reason a teacher opens ZSMS every morning.

Attendance (`ATTENDANCE.md`, `TRIGGERS.md`, `OFFLINE_SYNC.md`), timetable (`TIMETABLE.md`), examinations and results (`RESULTS.md`, `GRADING.md`, `PUBLISHING.md`), and the mobile app with PowerSync.

**This is the phase where the mobile app becomes real.** Offline-first attendance is a core requirement (ADR-004) and the single most valuable availability control in the system (`AVAILABILITY.md`) — it is not a later port of the web app.

**E2E gate:**
- Teacher marks attendance on mobile **with the device offline**, sees a pending indicator, and the record syncs within 30 seconds of connectivity returning.
- Teacher enters marks; grades calculate live against the school's configured scale; positions rank with correct tie handling.
- Principal reviews and publishes results; the marks lock engages; parents see published results and not unpublished ones.
- All four grading systems (ECZ, Cambridge O, Cambridge A, custom) produce correct letters and aggregates.
- Timetable conflict detection prevents double-booking a teacher.

---

## Phase 3 — Financial Operations

**Goal:** the module with direct financial consequence, and the first that touches money.

Fee structures (`FEE_STRUCTURES.md`), payments (`PAYMENTS.md`, `GATEWAY.md`), receipts (`RECEIPTS.md`), reminders (`REMINDERS.md`), and the financial audit trail (`AUDIT.md`).

**Phase 3 has the least tolerance for defects in the whole plan.** A grading bug produces an embarrassing report card; a payment bug takes or loses a parent's money. `TEST_STRATEGY.md` names payment verification as one of its four high-risk areas, and integration test coverage here is not optional.

**E2E gate:**
- Parent submits a payment with proof upload and confirmation checkbox; accountant verifies; fee record updates; receipt generates with a correctly sequenced number.
- Partial payment leaves the fee record `partial`, not `paid`.
- Duplicate gateway reference is detected and rejected.
- Concurrent payment submissions produce **zero duplicate receipt numbers** (load-tested, per Scenario 5 of `LOAD_TESTING.md`).
- Every financial event writes an immutable `audit_logs` row.
- Soft delete verified: no hard delete path exists on fee records or payments.

---

## Phase 4 — Communication and Documents

**Goal:** everything that leaves the system and reaches a parent.

WhatsApp (`WHATSAPP.md`, `META_API.md`, `TEMPLATES.md`), SMS fallback (`SMS.md`), announcements (`ANNOUNCEMENTS.md`), message log (`MESSAGE_LOG.md`), and the PDF pipeline (`PDF_GENERATION.md`, `TEMPLATE_SYSTEM.md`, `REPORT_CARDS.md`, `BULK_GENERATION.md`, `STORAGE.md`).

**E2E gate:**
- A fee confirmation dispatches over WhatsApp in both Mode A (AfriTech shared number) and Mode B (school's own number).
- Fallback chain verified: WhatsApp fails → email → SMS for critical messages only.
- **400 report cards generate in under 90 seconds**, with realtime progress and per-batch failure isolation.
- Fonts and the school logo load once per batch, not once per student.
- Announcement read tracking records one row per user per announcement.
- Parent opt-out is honoured across every channel.

---

## Phase 5 — Platform, Admin, and Integrations

**Goal:** the tooling AfriTech needs to operate the product, and the surfaces that make configuration real.

Super admin panel (`SUPERADMIN.md`), dynamic pricing (`PRICING.md`, `DYNAMIC_CONFIG.md`), platform metrics (`PLATFORM_METRICS.md`), school health scores (`SCHOOL_HEALTH_SCORES.md`), onboarding workflow (`ONBOARDING.md`), impersonation (`IMPERSONATION.md`, `IMPERSONATION_FLOW.md`), and Tier 1 integrations (`INTEGRATIONS.md`, `CUSTOM_WEBHOOK.md`, `API_INTEGRATION.md`).

**The dynamic configuration surfaces built here are what make the whole `DYNAMIC_CONFIG.md` model real.** Until Phase 5, values live in seed rows and nobody can change them without SQL.

**E2E gate:**
- Super admin changes a tier price; the cache invalidates; `schoolHasFeature()` reflects it immediately; the public pricing page updates within its ISR window.
- Toggling a feature out of a tier warns about affected schools before committing.
- A per-school override grants a feature outside the school's tier, with a mandatory reason, and expires on schedule.
- Impersonation session starts, is fully logged, and ends cleanly with the school able to see the access record.
- A webhook fires with a valid HMAC signature and a failure does not block school operations.

---

## Phase 6 — Production, Pilot, and Launch

**Goal:** real schools, real data.

| Step | Deliverable |
|---|---|
| Production provisioning | **`zsms-zm` created in `af-south-1`** |
| Compliance | ZICTA Data Controller registration; privacy policy and terms published |
| Security | `SECURITY_AUDIT.md` executed in full |
| Performance | `PERFORMANCE_CHECKLIST.md` verified |
| Load | Pilot and launch milestones pass in `LOAD_TESTING.md` |
| Recovery | Backup restore verified per `AVAILABILITY.md` |
| Pilot | September 2026, 10 schools, `UAT_CHECKLIST.md` all 10 scenarios |
| Launch | January 2027, open self-registration |

**E2E gate — this is `LAUNCH_CHECKLIST.md` in full.** No layer in `THIRTEEN_LAYER_COMPLIANCE.md` may be at **Gap** verdict. Every UAT scenario passes for every pilot school before that school goes live.

---

## Phase Gate Rules

A phase is complete only when all of the following hold:

1. Every E2E scenario for the phase passes against staging.
2. pgTAP RLS tests pass for every table introduced in the phase.
3. Unit tests pass for every pure function introduced (`TEST_STRATEGY.md` Layer 1).
4. Module documentation is updated with a dated Change Log row, per `CONVENTIONS.md`.
5. `THIRTEEN_LAYER_COMPLIANCE.md` is re-audited and verdicts revised honestly, including downgrades.
6. No table introduced in the phase lacks an RLS policy.
7. Any new configurable value is registered in `DYNAMIC_CONFIG.md`.

**Phases do not overlap.** A solo developer running two phases in parallel produces two half-finished phases, and the E2E gate is what prevents that from being discovered late.

**The gate may be failed.** A phase that does not pass its gate is not "done with a follow-up ticket" — it is not done. The cost of carrying an unfinished phase forward compounds through every phase that depends on it.

---

## Sequencing Rationale

**Why financial before communication.** Payments generate receipts and confirmations, so Phase 3 defines what Phase 4 dispatches. Building notifications first would mean building them twice.

**Why academic before financial.** Fee structures attach to grade levels and terms, which Phase 2 establishes. It also gets the daily-use module in front of pilot schools earliest, which is where real feedback comes from.

**Why admin tooling last among build phases.** Phase 5 configures things that must exist to be configured. A pricing panel with no schools on tiers cannot be meaningfully tested.

**Why the AI module is not a build phase.** Per `AI_OVERVIEW.md`, System 1 and 2 are product Phase 2 (post-pilot 2027), System 3 is product Phase 3 (mid-2027), and System 4 is blocked until 18+ months of data across 50+ schools. None is in scope before commercial launch. The `knowledge_base` table and `vector` extension exist from Phase 0 so no migration rework is needed later.

**Why the loan module is not a build phase.** `loan_module` is a Professional-tier feature flag gated behind `schoolHasFeature()`. The `private` schema tables are created in Phase 0 and the module is built after commercial launch, per `LOANS.md` product Phase 1.

---

## Business Rules

1. Build phases execute in order. A phase does not begin until the previous phase's E2E gate passes.
2. Within every phase, the build order is migration → RLS → types → API → integration tests → UI → E2E.
3. No table ships without an RLS policy, verified by pgTAP within the same phase.
4. Every phase ends with module documentation updated and a dated Change Log row.
5. `THIRTEEN_LAYER_COMPLIANCE.md` is re-audited at every phase gate, with verdicts revised honestly in both directions.
6. `zsms-staging` is provisioned in `af-south-1` at the end of Phase 0. `zsms-zm` is provisioned in `af-south-1` in Phase 6.
7. Any new configurable parameter is registered in `DYNAMIC_CONFIG.md` in the same change that introduces it.
8. Build phases and product phases are distinct. Documentation referring to a phase states which kind it means.

---

## Edge Cases and Error Handling

**A pilot school requests a Phase 5 feature during Phase 3.** The answer is the sequence. Out-of-order feature work is how a plan becomes a backlog. If the request is genuinely launch-blocking, it becomes an ADR and the plan changes deliberately rather than silently.

**A phase gate fails on a single scenario.** The phase is not complete. Fix and re-run the full gate, not only the failing scenario — a fix that breaks a previously passing scenario is common and is exactly what re-running catches.

**A defect surfaces in a completed phase.** Fixed immediately in the current phase, with its E2E scenario extended so the regression cannot recur silently. Completed phases are not frozen; their gates are cumulative.

**Migration numbering conflicts.** `MIGRATIONS.md` specifies `0001`–`0065`, including the eight `afritech` configuration tables added in `0061`–`0065`. New tables identified during a phase append to the sequence and are recorded in `MIGRATIONS.md` in the same change. A migration file is never edited after being applied to any shared environment (`CONVENTIONS.md` #7).

**Schedule pressure before the September 2026 pilot.** Cut scope, never gates. Shipping a phase with failing RLS tests to meet a date is how a tenant isolation bug reaches production, and that class of failure is unrecoverable from a trust perspective.

---

## Integration Points

- `TEST_STRATEGY.md` — the test layers each gate depends on
- `LOAD_TESTING.md` — milestone verification at Phase 6
- `LAUNCH_CHECKLIST.md` — the Phase 6 gate in full
- `MIGRATIONS.md` — migration sequence extended per phase
- `DYNAMIC_CONFIG.md` — config tables in Phase 0, surfaces in Phase 5
- `THIRTEEN_LAYER_COMPLIANCE.md` — re-audited at every gate
- `ENV.md` — environment provisioning at Phase 0 and Phase 6

---

## Security Considerations

Building RLS in step 2 of every phase rather than as a hardening pass is the central security property of this plan. It means no table exists without a policy for any meaningful window, and pgTAP coverage arrives with the table rather than after it.

The Phase 0 CI pipeline is a security control. Automating the check that every table has an RLS policy — and that migrations reach integration before production — removes the two failure modes most likely to produce a tenant isolation bug.

Phase 6 is the first time real personal data exists in ZSMS. Everything before it runs on synthetic data, which is why the `zsms-dev` EU region exception in `COMPLIANCE.md` holds for the entire build. That exception ends the moment real data appears, and real data appears only in `af-south-1`.

---

## Known Limitations and Future Work

- Phase durations are deliberately unestimated. The sequence and the gates are the commitment; dates against a solo developer would be fiction.
- The plan assumes one developer working sequentially. Adding capacity would permit some parallelism, but not across the RLS-to-UI dependency within a phase.
- Phase 5 integrations cover Tier 1 (native webhooks) only. Tier 2 connectors and Tier 3 Zapier are product phases after launch.
- The mobile app appears only in Phase 2. If pilot schools need a mobile-first onboarding experience earlier, that is a plan change requiring an ADR.
- No rollback plan per phase. Rolling back a completed phase would mean reversing migrations, which `CONVENTIONS.md` prohibitions make deliberately difficult.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-08-13 | Initial complete draft | Build order needed a single deliberate decision rather than per-module improvisation |
| 2026-08-13 | Backend-first order fixed within every phase | RLS must precede UI; ADR-002 makes the database the security boundary |
| 2026-08-13 | E2E gate defined per phase | A phase without a verifiable exit condition is not a phase |
| 2026-08-13 | Build phases distinguished from product phases | `LOANS.md` and `AI_OVERVIEW.md` use "Phase" in a different sense |
| 2026-08-13 | Phase 0 assigned ownership of the Layer 7 CI-CD gap | Prohibition #10 currently depends on discipline alone |
