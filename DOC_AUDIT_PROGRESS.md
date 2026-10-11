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
| 03 | Infrastructure Services | 20 | **Done** | Good · 78% | 2026-10-11 |
| 04 | Country and Configuration | 2 | **Done** | Excellent · 90% | 2026-10-11 |
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

## 03 — Infrastructure Services (Good, 78%) · 2026-10-11

Assessed at **Fair 52%**, then remediated. The pattern was sharp and worth remembering:
**where ZSMS writes code it was done; where ZSMS needs an account it was not.**

### Built this pass

- **HTTP rate limiting** (`lib/rate-limit.ts`). There was none. `ai_assistant_quota()`
  and `consume_message_quota()` are real but are BILLING limits — neither notices ten
  thousand requests a minute. Middleware, ahead of authentication, failing open.
- **API integration, Tier 2 end to end** (`0241`). `school_api_keys` was specified and
  absent. Keys hashed and shown once, owner-only, `/api/v1/` read endpoints, usage log
  including refusals, management screen. Tenant isolation tested, not reasoned about.
- **Unit economics** (`0240`, `/admin/costs`). Consumption per school, no invented money.
- **Cache convention** — the doc changed to match the code, per the decision that
  `zsms:` namespacing is worth keeping in a shared Redis.

### Scores after

| Band | Documents |
|---|---|
| Excellent | R2 95, BULLMQ 90, SUPABASE 90 |
| Good | CLERK 85, POSTHOG 85, API_INTEGRATION 80, CACHING_CDN 80, SENTRY 70, HOSTING_STRATEGY 70, COST_MANAGEMENT 70 |
| Fair | META_API 55, TWILIO 55, QSTASH 55, VERCEL 50, CLOUDFLARE_WAF 50, RAILWAY 45, DEPLOYMENT_TOPOLOGY 40, SCALING 40, AVAILABILITY 35 |
| Deferred | POWERSYNC — paid service, online-first by decision |

Every one of the twenty now carries an **Implementation Status** block saying what is
built, what is credential-blocked, and what is deferred — so the next reader does not
have to re-derive which is which.

### Still open

- **AVAILABILITY is the weakest.** `/api/health` reports component status and **nothing
  polls it.** No alerting, no PITR verification, no standby. Recovery objectives are
  targets with nothing measuring them — worth knowing before quoting them to a customer.
- API write endpoints (Tier 1/3): a write with no user behind it needs idempotency on a
  caller-supplied key, or a retry double-records a payment.
- Outbound webhook registration (`webhooks:receive` scope exists, no endpoint).
- Billing alerts, which want real spend data first.

## 04 — Country and Configuration (Excellent, 90%) · 2026-10-11

Two documents, and the smallest folder so far — but it held one real product gap.

**`reference_subjects_zm` held 16 of the 62 subjects ZM.md lists, and none at A-level.**
That table is what a school picks from during onboarding, so a secondary school found
about a quarter of its curriculum and typed the rest by hand — at exactly the moment it
is deciding whether ZSMS knows anything about Zambian schooling. A sixth form found
nothing. `0242` seeds all 62, extracted from ZM.md's own tables by script rather than
transcribed, because a mistyped code does not fail — it quietly never appears.

**`npm run country:check`** is new: it prints every place in the live schema that assumes
Zambia. `ADDING_COUNTRY.md` is an eight-step runbook that would have failed *gradually* —
the first school in a new country refused by one CHECK, then another, each looking like a
bug. ADR-040 rightly defers widening them; what was missing was that the list existed
nowhere, so the runbook promised a path nobody had walked.

The script found **ten** places where ADR-040 listed five, and corrected it twice:

- **`term_number` is not coupled.** Every CHECK admits 1–4, so a four-term country
  already works. One fewer thing to do.
- **`school_subjects.curriculum_type` was missed**, and it is on a table schools write to
  — so it would have been met sooner and read as a stranger bug.

Also added `appName` and `whatsAppSenderId`, which ZM.md specified and the type omitted.

**Already country-neutral, and worth not re-solving:** `packages/config` has the country
index Step 2 describes — keyed by code, selected by `NEXT_PUBLIC_COUNTRY_CODE`, with an
error naming the runbook. Step 2 is satisfied.

## Carried forward

Open items from finished folders. Each carries why it is still open.

| From | Item | Why still open |
|---|---|---|
| 01 | Inbound webhooks (4) | ADR-044 settles that they are Next.js routes. Blocked on Meta, gateway and Clerk webhook credentials. |
| 01 | `zsms-staging` / `zsms-zm` | Compliance requires `af-south-1` before real school data. Needs an account action. |
| 01 | Field encryption keys | `FIELD_ENCRYPTION_KEY`, `GATEWAY_ENCRYPTION_KEY` unset; `0230`'s CHECK refuses plaintext credentials until they exist. |

| 02 | 32 of 34 `admin_*` functions still ungated | `0237` built the matrix; only the two guarding personal data are gated so far. Worth narrowing per release, not in one unverifiable sweep. |
| 02 | Suspicious activity detection | None of SESSIONS.md's five patterns, and no alerting path. `audit_logs` could detect two retrospectively. |


| 04 | Multi-country constraint widening | ADR-040 defers it until a second country is real. `npm run country:check` keeps the inventory honest in the meantime. |
| 03 | Uptime monitoring and alerting | `/api/health` exists and nothing polls it. Needs an external monitor, not code. |
| 03 | API write endpoints (Tier 1/3) | Needs idempotency on a caller-supplied key, or a retried request double-records a payment. |
| 03 | PITR and the Railway standby | Paid plans. `zsms-dev` is free and synthetic, so there is nothing yet to verify against. |
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
| 2026-10-11 | Folder 03 assessed and remediated, 52% -> 78% |
| 2026-10-11 | Folder 04 assessed and remediated, 90% |
