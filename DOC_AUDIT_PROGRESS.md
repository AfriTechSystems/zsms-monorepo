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
| 02 | Authentication and Identity | 5 | **Done** | Good · 88% | 2026-10-11 |
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

## 02 — Authentication and Identity (Good, 88%) · 2026-10-11

Assessed at **Fair 55%**, then remediated in the same pass. Re-scored after.

| Document | Was | Now | What changed |
|---|---|---|---|
| PERMISSIONS.md | 55% | **95%** | The whole system was unreachable; `0236` made it usable |
| ROLES.md | 75% | **92%** | The six `afritech:*` roles were one boolean; `0237` separated them |
| IMPERSONATION.md | 40% | **85%** | `0238` mints real actor tokens, records sessions, shows a banner |
| AUTH.md | 65% | **85%** | Student and alumni portals built; entry-point table corrected to reality |
| SESSIONS.md | 40% | **80%** | ADR-045 settles the duration question honestly; anomaly detection still unbuilt |

### What was built

- **`0236` — permission grants.** The tables, the function and **15 live RLS policies**
  existed with no route, no screen and no rows, so the function always returned false.
  Writing now goes through `grant_staff_permission()` rather than the INSERT policy,
  because "you cannot grant what you do not hold" cannot live in a route a direct
  PostgREST call skips. Screen at `/school/[code]/settings/permissions`.
- **`0237` — AfriTech roles.** `afritech_role()`, `has_afritech_capability()` and
  `afritech.staff_scope_assignments`. `is_afritech_admin()` is unchanged because **91
  policies call it**. Matrix visible at `/admin/team`.
- **`0238` — impersonation.** Actor tokens minted through `auth-provider` (ADR-032
  intact), sessions recorded separately from `audit_logs`, banner in the root layout, and
  a school owner can read sessions against their own school.
- **`0239` — pupils and alumni.** Policies keyed on `students.clerk_user_id` and never on
  the org claim, which is what lets a graduated pupil keep reading their history after
  their membership is revoked. One portal for both (ADR-046).

### Decisions recorded

- **ADR-045** — one Clerk session lifetime (7 days), not fifteen. SESSIONS.md's table is
  not expressible as Clerk configuration, and a parallel session store would sign people
  out mid-payment when two clocks disagreed.
- **ADR-046** — pupils and alumni share one portal. `alumni_profiles` is not built and
  should not be.

### Still open

- Suspicious activity detection: none of the five patterns, and no alerting path.
- 32 of 34 `admin_*` functions still use the plain `is_afritech_admin()` check.
- The two-day grant expiry notification needs a notification channel.
- Phone-based login is blocked on SMS OTP, which was disabled on cost grounds.

## Carried forward

Open items from finished folders. Each carries why it is still open.

| From | Item | Why still open |
|---|---|---|
| 01 | Inbound webhooks (4) | ADR-044 settles that they are Next.js routes. Blocked on Meta, gateway and Clerk webhook credentials. |
| 01 | `zsms-staging` / `zsms-zm` | Compliance requires `af-south-1` before real school data. Needs an account action. |
| 01 | Field encryption keys | `FIELD_ENCRYPTION_KEY`, `GATEWAY_ENCRYPTION_KEY` unset; `0230`'s CHECK refuses plaintext credentials until they exist. |

| 02 | 32 of 34 `admin_*` functions still ungated | `0237` built the matrix; only the two guarding personal data are gated so far. Worth narrowing per release, not in one unverifiable sweep. |
| 02 | Suspicious activity detection | None of SESSIONS.md's five patterns, and no alerting path. `audit_logs` could detect two retrospectively. |


| 02 | Phone-based login | Blocked on SMS OTP, disabled on cost grounds in Zambia. Parents match on verified email instead. |

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
| 2026-10-11 | Folder 02 remediated and re-scored 55% -> 88% |
