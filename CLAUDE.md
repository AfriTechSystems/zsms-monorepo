# CLAUDE.md — ZSMS

## What this repository currently is

**Phases 0–3 complete, plus the fee arrears model. Phase 4 in progress — the design foundation and the AfriTech admin dashboard are complete, and the school portal has its shell, dashboard, and pupil screens. No parent or teacher screens yet.**

ZSMS is a school management SaaS by AfriTech Systems Limited, targeting Zambia (`zsms.co.zm`) with a multi-country expansion path. Commercial launch is dated January 2027. The documentation set was completed pre-development, so the docs still specify more than exists.

The tree is:

| Path | State |
|---|---|
| `Official Documentation/` | 119 markdown files across 18 numbered folders — the specification |
| `apps/web` | Next.js 15 App Router (pinned `15.5.23`). Builds. **49 API routes**; Clerk mounted (middleware + provider); the admin dashboard (5 screens), the school portal (shell, dashboard, pupil list/enrol/detail, staff and invitations, teaching assignments, attendance register, fees, results, pupil-field settings, bulk import, announcements), the **parent portal** (home, attendance, results, fees, notices), the **School Network dashboard**, the **teacher landing page**, plus `/design` preview. Teacher landing page exists; standalone Teacher Hub does not |
| `apps/mobile` | Expo 52 / RN 0.76. Type-checks. **No screens yet** |
| `apps/workers` | Railway background workers. Four registered: receipts, fee reminders, scheduled announcements, report-card batches |
| `packages/` | `auth-provider`, `queue`, `storage`, `utils`, `types`, `config`, `notifications`, `documents`, `design-tokens` — `types/database.ts` generated from the live schema |
| `supabase/migrations/` | **`0001`–`0021`, `0069`–`0123` applied to `zsms-dev`** (76 migrations). Role enforcement verified against Clerk's bare `o.rol` form for all nine role claims |
| `supabase/tests/rls/` | **19 pgTAP suites, 473 assertions, all passing** — tenant isolation (72), fees/attendance/results (45), fee arrears (38), communications (47), worker boundary (26), school branding (38), student ceiling (41), staff access (17), teaching assignments (13), attendance register (10), fee payment flow (13), grading scale versioning (20), exam marks entry (11), academic year scope (9), custom student fields (18), student import (9), announcement audience (16), multi-school access (11), school networks (19). `npm run db:test` checks every `plan(N)` against the real assertion count first |
| `supabase/tests/e2e/` | `payment-verified-e2e.ts` — 28 checks, run via `npx tsx` |
| `supabase/functions/` | Empty — no Edge Functions yet |
| `supabase/seed/` | `dev_seed.sql` — 6 synthetic schools spanning health bands. `npm run db:seed`, which **refuses any project but `zsms-dev`**. Seeds 6 grading scales, 24 subjects, and 95 exam results graded through `grade_from_scale_version()` with the scale version recorded — the fixture exercises the real grading path rather than hardcoding letters. |

**What exists is a backend, a design system, and one portal.** 39 `public` tables and 4 `afritech` tables with RLS enabled *and* forced on every one, six `security_invoker` views, and the API routes below. Phase 4 has added `packages/design-tokens` (the single source of colour, type, spacing, and per-school theming), the `apps/web/components` primitives built on it, `/design` (a preview page rendering the whole foundation including a live WCAG contrast audit), and the **AfriTech admin dashboard** — overview, schools list, school detail, health, features, pricing. **The school, parent, and teacher portals do not exist**, nor do any mobile screens.

**Clerk is now actually mounted.** `apps/web/middleware.ts` re-exports `authMiddleware` from `@zsms/auth-provider/middleware`, and the root layout wraps `SessionProvider` from `@zsms/auth-provider/react` — both provider-neutral names, so ADR-032 still holds. Without the middleware, `auth()` **throws** rather than returning "signed out", which surfaced as a 500 from every route that asks who the caller is. Note also that Supabase authenticates Clerk as a **third-party auth provider**, not via the deprecated `supabase` JWT template: `getSupabaseToken()` returns the plain session token, and the token needs a `role: "authenticated"` claim or PostgREST treats it as anonymous.

**API routes built** (all `/api/…`): `health` · `schools` · `school/overview` · `school/structure` · `school/staff` · `school/staff/members` · `school/teaching` · `school/attendance/register` · `school/fees` · `school/fees/[studentId]` · `school/fees/verify` · `school/fees/generate` · `school/results` · `school/results/publish` · `school/custom-fields` · `school/students/import` · `school/students/[id]/custom-values` · `school/announcements` · `school/recipients` · `session/schools` · `network/overview` · `teacher/overview` · `admin/networks` · `parent/overview` · `parent/fees` · `parent/attendance` · `parent/results` · `parent/notices` · `session/whoami` · `students` · `students/[id]` · `staff` · `fees/structures` · `fees/records` · `payments` · `payments/[id]/verify` · `attendance` · `results` · `results/publish` · `announcements` · `announcements/[id]/read` · `messages` · `admin/overview` · `admin/schools` · `admin/schools/[id]` · `admin/features` · `admin/tiers` · `admin/overrides` · `admin/impersonate` (501 — needs Clerk actor tokens)

**Phase 3 caveat — the logic is proven, the delivery is not.** Communications and PDF generation are verified against the real handlers, the real renderer, and the real fallback chain, but **no job has round-tripped through Redis and no message has left this machine.** There is no Redis locally and no Meta/Resend/Twilio credentials, so every channel runs through the mock provider. Live BullMQ→Redis transport and real delivery are **Phase 6, with credentials.** Do not build on the assumption that either has been exercised.

**Running locally.** `npm run dev` frees port 3000, starts `apps/web` on it, and prints the LAN address a phone can reach. `npm run dev:clean` also clears `apps/web/.next`; `npm run port:free` just releases the port. Use these rather than `turbo dev` directly (`dev:turbo` if you need it): a killed turbo wrapper leaves `next dev` orphaned, holding port 3000 with a broken compiler worker pool, and the symptom is a 500 reading "Jest worker encountered 2 child process exceptions" — which looks like an application error and is not one. Next's fallback to port 3001 is silent, so every URL written down becomes wrong. Workers are excluded on purpose — they need Redis and provider credentials a UI session has no reason to hold, and a worker crash used to take the web app down with it. Use `npm run dev:workers` to run one deliberately, or `npm run dev:all` for the whole set. Note also that `next build` overwrites the `.next` that `next dev` serves from, so a build run while the dev server is up wedges it — `npm run dev:clean` is the recovery. And `node --experimental-strip-types` is **not** a drop-in TypeScript runner: it requires explicit `.ts` on every relative import, and it has silently broken two scripts in this repo. Use `tsx`.

**Read `JOURNAL.md` first.** It records what each session actually did, the defects found, and what was deliberately deferred — including several cases where a documented claim turned out not to match the schema.

---

## Reading the documentation

Docs are grouped by domain in numbered folders:

| Folder | Contents |
|---|---|
| `01 Foundation Layer` | ARCHITECTURE, DATABASE, CONVENTIONS, DECISIONS (ADRs), DESIGN_SYSTEM, DYNAMIC_CONFIG, RLS, GLOSSARY, COMPLIANCE, SECURITY_POLICIES, ENV, CHANGELOG |
| `02 Authentication and Identity` | AUTH, ROLES, PERMISSIONS, SESSIONS, IMPERSONATION |
| `03 Infrastructure Services` | Supabase, Clerk, Vercel, R2, QStash, BullMQ, PowerSync, Twilio, Railway, Sentry, PostHog, Cloudflare WAF, Meta API |
| `04 Country and Configuration` | ZM (Zambia reference), ADDING_COUNTRY |
| `05 Core Database and API Reference` | SCHEMA, MIGRATIONS, INDEXES, ENDPOINTS, EDGE_FUNCTIONS, WEBHOOKS, ERROR_CODES, RATE_LIMITS |
| `06`–`14` | Domain modules: school/tenant, students/parents, staff, fees, attendance, exams, communication, PDFs, loans |
| `15 Super Admin and Platform` | SUPERADMIN, ONBOARDING, PLATFORM_METRICS, SCHOOL_HEALTH_SCORES, IMPERSONATION_FLOW |
| `16 Testing and Launch` | TEST_STRATEGY, TEST_DATA, UAT/LAUNCH/PERFORMANCE checklists, SECURITY_AUDIT |
| `17 Integration and Pricing` | PRICING, INTEGRATIONS, accounting/CRM connectors, CUSTOM_WEBHOOK |
| `18 AI Module` | AI_OVERVIEW, AI_ASSISTANT, LESSON_PLANNER, ANALYTICS_INTELLIGENCE, AI_DATA_REQUIREMENTS |

**Cross-reference paths inside the docs are wrong.** Every file references siblings as `docs/ARCHITECTURE.md`, `docs/modules/fees/PAYMENTS.md`, etc. That layout does not exist. Resolve by filename against the folder map above.

Start any substantive task by reading `01 Foundation Layer/CONVENTIONS.md` and `01 Foundation Layer/DECISIONS.md`. `DECISIONS.md` holds 43 ADRs — check it before proposing an architectural change, so settled decisions are not relitigated.

---

## Architecture essentials

Modular monolith (explicitly **not** microservices), Turborepo monorepo.

- **Clients** — Next.js 15 App Router (`apps/web`, pinned `15.5.23` per ADR-036), React Native/Expo (`apps/mobile`)
- **API** — Next.js API routes + Supabase Edge Functions (Deno), rate-limited via Upstash Redis
- **Data** — Supabase PostgreSQL, Upstash Redis, Cloudflare R2 (two buckets: public + private), Railway Postgres hot standby
- **Async** — **BullMQ over Redis is the default** (ADR-035), QStash the fallback; both sides of the abstraction live in `packages/queue` (`enqueue()` and `createWorker()`). Nothing outside that package imports `bullmq` or `ioredis`
- **Offline** — PowerSync syncs teacher mobile ↔ Supabase (last-write-wins, server authority)
- **Auth** — Clerk, email OTP only (SMS OTP disabled), wrapped by `packages/auth-provider` so Keycloak can be swapped in for self-hosted deployments. No other package imports Clerk directly.

Two decisions shape almost everything else:

1. **Tenant isolation lives in the database, not the application.** Every `public` table carries `school_id`; RLS policies filter through the `get_school_id()` helper reading Clerk JWT claims. A new table without an RLS policy is a defect.
2. **Pricing and feature access are entirely database-driven.** Four `afritech`-schema tables (`subscription_tiers`, `feature_flags`, `tier_features`, `school_feature_overrides`) drive everything. Never hardcode a price, tier, or feature inclusion. Gate features through **`public.school_has_feature(school_id, feature_key)`** (migration `0095`), whose resolution order is fixed: **revoke override → grant override → tier override → tier matrix.**

   **Two corrections to what this file used to say, both found by building against it:**

   - Until 2026-08-17 **three of those four tables did not exist.** `afritech` held `subscription_tiers` alone. They were created in `0095`, to the DDL `PRICING.md` already specified, seed matrix included. The claim was written from the documentation rather than from the schema — the same failure the *Known documentation inconsistencies* section below warns about, in this file's own text.
   - The resolution order lists **five** steps; the implemented one has **four**. There is no module-subscription table in this schema, so that step is omitted rather than faked. It slots between the tier override and the matrix when per-module billing is built.

   `schoolHasFeature()` is the TypeScript wrapper named throughout the docs. **It does not exist yet** — nothing in `apps/` or `packages/` calls the resolver. `school_has_feature()` in the database is the only implementation.

   **The student ceiling resolves the same way** (migrations `0101`–`0103`). Never read `subscription_tiers.student_limit` directly and never read `schools.max_students` at all — that column is deprecated and unenforced. Use **`public.school_student_limit(school_id)`** for the ceiling (order: `student_limit_override` → `tier_override` → tier) or **`public.school_student_capacity(school_id)`** for the ceiling plus the current roll, and `public.school_capacity` for a whole list in one query. An **AFTER** trigger on `students` enforces it on INSERT and on any UPDATE that puts a pupil back on the roll, raising `SQLSTATE ZS001`, which `fromPostgrestError` renders as a `CONFLICT` carrying the ceiling in the message. Pupils count toward it when `status IN ('active','on_leave')` and not soft-deleted.

   **Why AFTER matters, and the general rule it stands for:** a BEFORE ROW trigger runs *ahead of* the RLS `WITH CHECK`, so `0101`'s guard told School B the exact ceiling of a full School A before establishing that School B could write there at all. **Any trigger that raises a message describing tenant state must be AFTER**, or it speaks before the policy has decided whether the caller is entitled to hear it.

---

## Supabase environments

Only the dev project exists. Build against it exclusively.

| Environment | Project | Ref | Region | Status |
|---|---|---|---|---|
| Development | `zsms-dev` | `tevblmcebsqqjgzjptgw` | `eu-west-1` | Live, 58 migrations applied |
| Staging | `zsms-staging` | — | `af-south-1` | Phase 0 final steps |
| Production | `zsms-zm` | — | `af-south-1` | Phase 6 |

**`zsms-dev` being in `eu-west-1` is a deliberate, documented exception — do not "fix" it.** Dev holds synthetic and seed data only, so the ZDPA/POPIA adequacy argument that requires `af-south-1` is not engaged. Staging and production must be `af-south-1`. Full rationale in `COMPLIANCE.md` → Environment Data Residency.

**Never load real school data into `zsms-dev`** — no production dumps, no anonymised extracts, no pilot records. The region exception depends entirely on that constraint. Generate fixtures per `TEST_DATA.md`.

Extensions already enabled on dev beyond Supabase defaults: `vector` (pgvector, for the AI knowledge base) and `pgtap` (for RLS tests), both in the `extensions` schema — never `public`. Migration 0001 declares them idempotently with `CREATE EXTENSION IF NOT EXISTS ... WITH SCHEMA extensions`, since staging and production start clean.

### Applying migrations

**Use the Supabase CLI, never the MCP.** `MIGRATIONS.md` → *Migration Versioning and Application Procedure* is authoritative; the short version:

```bash
npm run db:push     # apply to the linked project
npm run db:list     # versions must be four-digit and match filenames
npm run db:types    # regenerate types after every migration
```

- Create migration files **by hand** as `NNNN_description.sql`. Never run `supabase migration new` — it generates a timestamp filename, breaking the `NNNN_` convention.
- **Take the number from `MIGRATIONS.md` → *Next Available Sequence Number*, never from the highest file on disk.** Most of the sequence is planned in that document long before it exists as a file; reading the filesystem instead is how `0019`–`0021` were written onto numbers already claimed for fee migrations. `0022`–`0068` are now void — they sort below the applied high-water mark, so `db push` would skip anything written there.
- Run the pgTAP suites after any migration touching RLS: `npm run db:test`. **This needs Docker**, which is not installed on the current machine — until it is, the suites are executed through the Supabase MCP with session-scoped `SET ROLE` instead of the file's `SET LOCAL`. Same assertions, different identity-switching mechanism.
- The MCP's `apply_migration` records a **timestamp version** in `supabase_migrations.schema_migrations` regardless of filename. This desynced `0001` and had to be corrected by hand. Timestamp versions also sort *after* every four-digit version, silently reordering the sequence. Use it on `zsms-dev` for exploration only, and correct the history row in the same session.
- **Only `zsms-dev` may be migrated by automated tooling.** Staging and production are release actions requiring explicit human approval each time (prohibition 10). Re-link to dev immediately after touching either.

---

## Non-negotiable conventions

From `01 Foundation Layer/CONVENTIONS.md` — that file is authoritative; this is the short list.

**Naming**

| Context | Convention |
|---|---|
| Files, folders, Edge Functions | kebab-case (`send-whatsapp`, `fee-management.ts`) |
| React components | PascalCase, filename matches component |
| TS types/interfaces | PascalCase · variables/functions camelCase · constants SCREAMING_SNAKE_CASE |
| DB tables | snake_case, plural · columns snake_case |
| Indexes | `idx_[table]_[columns]` · triggers `[action]_[description]_on_[table]` |
| RLS policies | `[role_or_scope]_[action]_[table]` |
| Migrations | `NNNN_description.sql`, four-digit zero-padded. Numbers are assigned when a migration is written, never reserved |
| Docs | UPPER_SNAKE_CASE `.md` |
| Branches | `type/description` — `feature/`, `fix/`, `docs/`, `chore/`, `db/`, `rls/` |
| Commits | `type: description` — `feat`, `fix`, `db`, `rls`, `docs`, `chore`, `test`, `refactor`, `style` |

**Identifiers:** School `ZM-LSK-0001` · Student `STU-ZM-LSK-0001-00042` · Receipt `REC-ZM-LSK-0001-000001`

**Never do these** (verbatim from CONVENTIONS.md):

1. The Supabase service role key is never used outside a **trusted server-side context** — an Edge Function, or a Railway background worker (amended; ADR-042). Never in client-reachable code. A worker's connection bypasses RLS, so all of its data access goes through the `worker_*` functions (0090/0091): **`.from(` anywhere in `apps/workers` is a defect.**
2. Real credentials, API keys, or secrets are never committed.
3. Database types are never manually defined — always generated via `supabase gen types typescript`.
4. New tables are never created without a corresponding RLS policy.
5. Financial amounts are never stored as FLOAT or REAL — use `NUMERIC(12,2)`.
6. Timestamps are never stored without time zone — use `TIMESTAMPTZ`.
7. New features are never added to an existing migration file — always a new migration.
8. Hard deletes are never performed on students, fee records, payments, or exam results — soft delete only.
9. The `private` schema is never referenced in client-side code.
10. A migration is never applied to production without first being applied to integration and verified.

**Git workflow:** `feature/*` → `integration` (UAT) → `main` (production). Direct push to `main` is blocked.

**API shapes:** success `{ data, meta? }`; error `{ error, code, details? }` where `code` is one of `VALIDATION_ERROR | UNAUTHORIZED | FORBIDDEN | NOT_FOUND | CONFLICT | SERVER_ERROR`.

---

## Known documentation inconsistencies

The 2026-04-26 / 2026-06-23 conflicts that used to be listed here — session lengths, schema counts, QStash vs BullMQ, the missing WAF, the missing ADRs — **have all been resolved.** `DECISIONS.md` now holds 43 ADRs.

**A pattern worth knowing before you trust any doc — and before you trust *this* one:** repeatedly, a document has described something the schema could not do. The most recent instance was in this file: the line above about four `afritech` tables was true of the documentation and false of the database for the whole of Phases 0–3. Repeatedly, a document has described something the schema could not do. `class_enrolments` was referenced by four documents and defined by none. `GLOSSARY.md` promised a fee statement with a running balance that nothing could produce. `DATABASE.md`'s `payments` DDL omitted the verification columns `SCHEMA.md` specified. Each was found by *implementing against the doc*, not by reading it. **Verify against the applied schema before building on a documented claim.**

### Open, tracked

| Item | Where | Status |
|---|---|---|
| **Multi-country config hardening** | ADR-040 | Deferred. `curriculum_type`, `grading_system`, `examination_type`, `level_type`, and `term_number` are hardcoded CHECK constraints; `reference_subjects_zm` bakes the country into a table name. Each needs a migration to admit a second country. Decide when the second country is real. |
| Migration numbering | `MIGRATIONS.md` | `0022`–`0068` are **void** — they sort below the applied high-water mark and `db push` would skip them. Numbers are assigned when a migration is written, never reserved. Read *Next Available Sequence Number*. |
| **`schoolHasFeature()` has no TypeScript implementation** | `ARCHITECTURE.md`, ADR-014 | Open. `public.school_has_feature()` exists in the database (`0095`) and the admin API calls it by RPC. No package exports the wrapper the docs name, and nothing caches it — ADR-014 specifies a Redis cache (5-min overrides / 60-min tier). Write it when the first feature is actually gated. |
| **Per-module subscription** | `PRICING.md`, `DYNAMIC_CONFIG.md` | Open. The documented resolution order has five steps; the implementation has four. No table exists for per-module billing, so the step is omitted rather than faked. |
| **`payments.payment_method` has no `mobile_money`** | `SCHEMA.md`, `ZM.md` | Open. The CHECK admits `cash`/`bank_deposit`/`cheque`/`online_gateway`/`loan_disbursement`/`reversal`/`waiver`. Mobile money is the dominant rail in Zambia and currently has to be recorded as `online_gateway`, which loses the distinction on every receipt and reconciliation. Needs a migration and a product decision. |
| **`schools.max_students` is a dead column still holding data** | migration `0003`, `0102` | Open, needs approval to drop. Deprecated by comment in `0102` and removed from every screen and from `PATCH /api/admin/schools/[id]`. Nothing has ever read it to make a decision; the live ceiling is `public.school_student_limit()`. Left in the table because dropping a column is destructive and the seeded values are the only record of what onboarding intended. |
| **The tier form has no optimistic concurrency** | `app/admin/pricing/page.tsx` | Open, low priority. Every field is rendered, so saving a stale tab silently reverts a value changed elsewhere — observed on 2026-08-23, when a pre-migration tab put Professional's ceiling back to unlimited. `admin_update_tier` treats NULL as "unchanged" for the other fields, but a checkbox has no unchanged state to send. Acceptable for a single-operator panel; revisit if a second admin exists. |
| **`/api/admin/schools/[id]` issues one RPC per feature** | `app/api/admin/schools/[id]/route.ts` | Open, performance. Resolved access calls `school_has_feature()` once per feature — 13 PostgREST round-trips today, growing with the catalogue. Correct, but an N+1 over the network. Wants a single set-returning `school_feature_resolution(school_id)` when the catalogue grows or the page feels slow. |
| **Staff seats: decided, not yet implemented** | `PRICING.md`, `CLERK.md`, `ONBOARDING.md` | **Decided 2026-08-23: staff are not a priced dimension.** School onboarding passes `maxAllowedMemberships: 0` (unlimited) so no school can be blocked from adding a teacher, and `afritech.subscription_tiers` gains no staff-seat column. Tiers price on students and WhatsApp only. Reversible — pricing seats later means a column, a per-school override, and a Clerk backfill. Remove this row once `school-onboard` sets the limit. |
| **Clerk roles carry no permissions, by decision** | `CLERK.md`, `ROLES.md` | Resolved 2026-08-23 — all seven `org:*` roles now exist in the Clerk instance. Their Clerk **permission sets are intentionally empty**: enforcement is RLS plus the role checks in `lib/roles.ts`, and a second permission model in Clerk would be a rule nothing tests. One consequence to verify before school onboarding: Clerk gates its own organisation management on `org:sys_*` permissions, so a school owner holding a custom role with none of them cannot invite members through Clerk's own UI. ZSMS invites server-side through the Backend API, which is unaffected — but the "Manage organisation" affordance in the org switcher will be inert for them. |
| **Clerk instance settings are undocumented configuration** | `CLERK.md` | Open. "Allow user-created organisations" must be **off** in production (only ZSMS provisions school orgs; otherwise the reserved-slug check is bypassable), and "new members can delete organisations" must stay disabled (deleting the org orphans every `clerk_org_id` in `schools`). Neither is expressible in the repository. `CLERK.md` needs an instance-settings section that a new environment is checked against. |
| **Network billing and quota are per-school** | `PRICING.md`, `0123` | Open, and commercial rather than technical. `school_networks.billing_mode` records `per_school` (default) or `consolidated` and **nothing reads it** — ZSMS has no invoicing anywhere, so there is nothing to consolidate yet. Two decisions are written up in PRICING.md → *School Network Pricing*: whether a 100-school network pays 100 × tier, and whether WhatsApp quota is pooled or per-school (`consume_message_quota()` is per-school today). The admin screen, the attach flow and the deliberate Clerk access grant are all built and tested. |
| **Parent accounts cannot be signed into on a dev machine without a helper** | `scripts/link-dev-parent.mjs` | Open by nature, not a defect. `dev_seed.sql` creates parents with synthetic Clerk ids, which are rows and not accounts, so parent RLS matches nothing for a real sign-in and the portal renders correctly empty. `npm run dev:link-parent -- <clerk-user-id>` repoints seeded links at a real account (dev project only). Remove this row if Clerk test users are ever seeded properly. |
| Layer 7 (CI-CD) | `THIRTEEN_LAYER_COMPLIANCE.md` | Still **Thin**. No CI exists, so no test blocks a merge. Layer 1 (Frontend) now has a foundation — `DESIGN_SYSTEM.md` and `packages/design-tokens` — but no portal screens yet. |

If you resolve one of these, remove its row.

---

## Documentation maintenance

`CONVENTIONS.md` requires every session that builds or changes a feature to end by updating the relevant module doc: new/changed endpoints, business rules, tables and columns, integration points, plus a dated Change Log row. Also check that doc's Related Documents section for siblings that need the same update.

Every doc follows a fixed template: Related Documents → Purpose → Overview → sections → Business Rules → Edge Cases and Error Handling → Integration Points → Security Considerations → Known Limitations and Future Work → Change Log. Match it when creating a new doc.

If a convention is not defined in `CONVENTIONS.md`, do not invent one — ask, agree, add it there, then apply it.

---

## Domain context worth knowing

- **Zambia runs two education systems at once.** Traditional ECZ (Grades 1–12) and the 2023 reform (Grades 1–6 then Forms 1–6). Most private schools are mid-transition, so grade levels are school-configurable and both old and new subject codes stay valid simultaneously. See `04 Country and Configuration/ZM.md`.
- **Four grading systems** are supported: ECZ Traditional, Cambridge O-Level, Cambridge A-Level, and school-defined custom.
- **Two product lines share one codebase** — ZSMS for Schools (`org:*` roles, `/school/[school-id]/...`) and the standalone Teacher Hub (`platform:teacher`, `/teacher/...`, no school affiliation).
- **AI is four separate systems**, not one: Smart Analytics (SQL only, no LLM), AI Assistant (Claude, RLS-enforced), Lesson Planner (RAG over a Zambian curriculum knowledge base), Predictive Intelligence (Phase 4, blocked until 18+ months of data across 50+ schools). Systems 1 and 2 are gated behind a data-completeness score — ≥70% full, 50–69% limited, <50% locked.
- **Compliance:** Zambia Data Protection Act 2021, ZICTA registration, 72-hour breach notification, and an in-progress SOC 2 Type I readiness effort. Substantive personal data stays in `af-south-1`; only auth credentials transit Clerk (US) under a DPA.
