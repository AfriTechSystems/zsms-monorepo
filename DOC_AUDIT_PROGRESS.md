# Documentation Audit — Progress Tracker

**What this is.** A walk through all 18 numbered folders of `Official Documentation/`, one
at a time, checking every claim each document makes against what is actually built —
database, API route, screen, and the link a user presses to reach it. Where something is
missing it gets built; where the document is wrong it gets corrected.

**Why it is tracked in a file.** The audit spans many sessions. Without a record, each one
re-derives which folders are done and what was deferred, and the deferrals quietly become
permanent.

**How to use it.** Read this before starting an audit pass. Update the row when a folder is
finished, and move anything deferred into *Carried forward* with a reason — a deferral with
no reason is how a gap disappears.

---

## Scoring

| Band | Meaning |
|---|---|
| **Excellent** (90–100%) | Built, reachable, matches the document, and verified by exercise |
| **Good** (70–89%) | Built and reachable; gaps are documented and deliberate |
| **Fair** (40–69%) | Substantially built, with real gaps or unreachable work |
| **Bad** (0–39%) | Mostly unbuilt, or the document describes something that does not exist |

A score measures **what is built against what the document promises**, not documentation
quality on its own.

---

## Progress

| # | Folder | Files | Status | Score | Finished |
|---|---|---:|---|---|---|
| 01 | Foundation Layer | 14 | **Done** | Good · 73% | 2026-10-06 |
| 02 | Authentication and Identity | 5 | **Assessed** | Fair · 55% | — |
| 03 | Infrastructure Services | 20 | Not started | — | — |
| 04 | Country and Configuration | 2 | Not started | — | — |
| 05 | Core Database and API Reference | 8 | Not started | — | — |
| 06 | School and Tenant | — | Not started | — | — |
| 07 | Students and Parents | — | Not started | — | — |
| 08 | Staff | — | Not started | — | — |
| 09 | Fees | — | Not started | — | — |
| 10 | Attendance | — | Not started | — | — |
| 11 | Exams | — | Not started | — | — |
| 12 | Communication | — | Not started | — | — |
| 13 | PDFs and Documents | — | Not started | — | — |
| 14 | Loans | — | Not started | — | — |
| 15 | Super Admin and Platform | 5 | Not started | — | — |
| 16 | Testing and Launch | 6 | Not started | — | — |
| 17 | Integration and Pricing | 5 | Not started | — | — |
| 18 | AI Module | 5 | Not started | — | — |

---

## 01 — Foundation Layer (Good, 73%) · 2026-10-06

14 documents, not 13. Per-document scores are in the session record; the summary:

**Strong.** CONVENTIONS 95%, RLS 95% (214 policies, 0 tables without RLS, forced
everywhere), DYNAMIC_CONFIG 92%, DESIGN_SYSTEM 90%.

**Weak.** CHANGELOG 25% (stale since 2026-08-14 — now caught up), ENV 45%, DATABASE 55%
(documented 49 of 93 tables).

**Built in response:** PostHog with autocapture off, origin security headers, ADR-012
custom staff roles (`0228`), ADR-015 marketing consent and the alumni access proof
(`0229`), ADR-023 integrations (`0230`), ADR-044 settling Edge Functions.

**Corrected:** `DATABASE.md` had said *"If there is a conflict between this document and
the code, this document takes precedence and the code must be corrected"* — removed, since
the schema is the fact and a document is a claim about it. Added generated
`SCHEMA_INVENTORY.md` rather than hand-transcribing 52 tables that would drift within a
week.

---

## 02 — Authentication and Identity (Fair, 55%) · assessed 2026-10-10

| Document | Score | Headline |
|---|---|---|
| ROLES.md | Good · 75% | All 16 roles typed; the six `afritech:*` are undifferentiated in practice |
| AUTH.md | Fair · 65% | JWT and RLS helpers match exactly; three login audiences do not exist |
| PERMISSIONS.md | Fair · 55% | Backend complete and wired into 15 policies — **and unreachable** |
| SESSIONS.md | Fair · 40% | Per-role durations and anomaly detection unbuilt |
| IMPERSONATION.md | Fair · 40% | Detection built, minting returns 501 |

### The finding that matters most

`staff_permission_grants`, `school_permissions` and `has_permission_grant()` all exist, and
the function is called by **15 live RLS policies** across students, parents, teaching
assignments, fee structures, fee records, payments, attendance and exam results.

There are **zero grant rows, no API route, and no screen.** The entire delegation
capability PERMISSIONS.md exists to describe — a principal covering for an accountant on
leave — cannot be used. This is the `zsms-feature` skill's most expensive failure shape:
work that is built, correct, and unreachable.

### Verified working

- The three RLS helpers (`get_school_id`, `get_user_role`, `get_user_id`) match AUTH.md's
  bodies exactly, as do `current_school_uuid()` and `is_afritech_admin()`.
- Email OTP only; no passwords, no social login.
- The multi-context role selector exists as `/welcome`, which **renders an inventory rather
  than redirecting on first match** — better than the document describes.
- SESSIONS.md business rule 4 — `confirmation_checkbox_at` fresh within 10 minutes — is
  enforced inside `allocate_payment`.
- ADR-012 custom roles on the `org:staff` base, built this week.

### Gaps

See *Carried forward*.

---

## Carried forward

Open items from finished folders. Each carries why it is still open.

| From | Item | Why still open |
|---|---|---|
| 01 | Inbound webhooks (4) | ADR-044 settles that they are Next.js routes. Blocked on Meta, gateway and Clerk webhook credentials. |
| 01 | `zsms-staging` / `zsms-zm` | Compliance requires `af-south-1` before real school data. Needs an account action. |
| 01 | Field encryption keys | `FIELD_ENCRYPTION_KEY`, `GATEWAY_ENCRYPTION_KEY` unset; `0230`'s CHECK refuses plaintext credentials until they exist. |
| 02 | Permission grant UI | **Next build item.** Backend done. |
| 02 | AfriTech role differentiation | Six roles collapse to one `is_afritech_admin()` boolean. Low risk at one operator, real on first hire. |
| 02 | Impersonation actor tokens | Needs a Clerk server-side mint; detection half already built. |
| 02 | Student portal | `org:student` is typed and appears in policies; no screen exists. |
| 02 | Alumni portal | `platform:alumni` typed and referenced nowhere; `alumni_profiles` absent. |
| 02 | Per-role session durations | Clerk has one lifetime per instance; per-role needs a decision before code. |

---

## Method

1. Read every document in the folder in full.
2. Check each concrete claim against the live schema (`npm run db:cols`, `pg_policies`,
   `pg_proc`) and the tree — never against another document.
3. Follow the chain for each feature: **docs → schema → function → route → screen → a link
   somebody can press.** A missing last link is the most common and most expensive gap.
4. Build what is missing; correct what the document gets wrong; raise an ADR when a
   decision is implied rather than recorded.
5. Score, update this file, and report in plain language before moving on.

**When a document and the schema disagree, the schema is the fact.** Documents here have
repeatedly described things the database could not do.

---

## Change Log

| Date | Change |
|---|---|
| 2026-10-06 | Folder 01 audited and remediated |
| 2026-10-10 | Tracker created; folder 02 assessed |
