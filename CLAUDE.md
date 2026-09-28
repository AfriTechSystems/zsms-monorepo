# CLAUDE.md — ZSMS

## What this repository currently is

**Phases 0–3 complete. Phase 4 is substantially complete — every product surface now exists.** The design foundation, the AfriTech admin dashboard, the school portal, the parent portal, the School Network dashboard, billing, and the standalone Teacher Hub are all built. What remains in Phase 4 is depth rather than breadth: no mobile screens, no Community Library, and the Teacher Hub's generator has no model behind it yet — see the tracked rows below.

ZSMS is a school management SaaS by AfriTech Systems Limited, targeting Zambia (`zsms.co.zm`) with a multi-country expansion path. Commercial launch is dated January 2027. The documentation set was completed pre-development, so the docs still specify more than exists.

The tree is:

| Path | State |
|---|---|
| `Official Documentation/` | 119 markdown files across 18 numbered folders — the specification |
| `apps/web` | Next.js 15 App Router (pinned `15.5.23`). Builds. **57 API routes**; Clerk mounted (middleware + provider); the admin dashboard (5 screens), the school portal (shell, dashboard, pupil list/enrol/detail, staff and invitations, teaching assignments, attendance register, fees, results, pupil-field settings, bulk import, announcements), the **parent portal** (home, attendance, results, fees, notices), the **School Network dashboard**, the **teacher landing page**, **billing** (admin + per-school subscription), and the **standalone Teacher Hub** (`/teacher` — profile setup, dashboard, generator, library, resource view, account), plus `/design` preview. **Every portal uses the shared sidebar shell** (`components/layout/app-shell.tsx`) — grouped navigation, collapsible, remembered per browser, drawer on mobile; the parent portal uses bottom tabs instead, being phone-first |
| `apps/mobile` | Expo 52 / RN 0.76. Type-checks. **No screens yet** |
| `apps/workers` | Railway background workers. Four registered: receipts, fee reminders, scheduled announcements, report-card batches |
| `packages/` | `auth-provider`, `queue`, `storage`, `utils`, `types`, `config`, `notifications`, `documents`, `design-tokens`, `ai` — `types/database.ts` generated from the live schema |
| `supabase/migrations/` | **`0001`–`0021`, `0069`–`0135` applied to `zsms-dev`** (88 migrations), and **verified to apply cleanly to an empty database by CI**. Role enforcement verified against Clerk's bare `o.rol` form for all nine role claims |
| `supabase/tests/rls/` | **25 pgTAP suites, 600 assertions, all passing** — tenant isolation (72), fees/attendance/results (45), fee arrears (38), communications (47), worker boundary (26), school branding (38), student ceiling (41), staff access (17), teaching assignments (13), attendance register (10), fee payment flow (13), grading scale versioning (20), exam marks entry (11), academic year scope (9), custom student fields (18), student import (9), announcement audience (16), multi-school access (11), school networks (19), per-student pricing (15), subscription invoicing (20), teacher hub (23), audit trail (22), AI credits (29), platform incidents (18). `npm run db:test` checks every `plan(N)` against the real assertion count first |
| `supabase/tests/e2e/` | `payment-verified-e2e.ts` — 28 checks, run via `npx tsx` |
| `supabase/functions/` | Empty — no Edge Functions yet |
| `supabase/seed/` | `dev_seed.sql` — 6 synthetic schools spanning health bands. `npm run db:seed`, which **refuses any project but `zsms-dev`**. Seeds 6 grading scales, 24 subjects, and 95 exam results graded through `grade_from_scale_version()` with the scale version recorded — the fixture exercises the real grading path rather than hardcoding letters. |

**What exists is a backend, a design system, and every web portal.** 46 `public` tables and 15 `afritech` tables with RLS enabled *and* forced on every one, ten `security_invoker` views, and the API routes below. `packages/design-tokens` is the single source of colour, type, spacing and per-school theming; the `apps/web/components` primitives are built on it; `/design` renders the whole foundation including a live WCAG contrast audit. All five portals are built — AfriTech admin, school, parent, School Network and the standalone Teacher Hub — each inside the shared sidebar shell. **No mobile screens exist**, which is the largest remaining gap and a Phase 2 commitment (ADR-004 offline-first attendance).

*(This paragraph said "one portal" and "the school, parent, and teacher portals do not exist" for several sessions after all three shipped. If a claim here reads as stale, check it against the tree rather than trusting it — that is the standing warning in* Known documentation inconsistencies *applied to this file itself.)*

**Clerk is now actually mounted.** `apps/web/middleware.ts` re-exports `authMiddleware` from `@zsms/auth-provider/middleware`, and the root layout wraps `SessionProvider` from `@zsms/auth-provider/react` — both provider-neutral names, so ADR-032 still holds. Without the middleware, `auth()` **throws** rather than returning "signed out", which surfaced as a 500 from every route that asks who the caller is. Note also that Supabase authenticates Clerk as a **third-party auth provider**, not via the deprecated `supabase` JWT template: `getSupabaseToken()` returns the plain session token, and the token needs a `role: "authenticated"` claim or PostgREST treats it as anonymous.

**API routes built** (all `/api/…`): `health` · `schools` · `school/overview` · `school/structure` · `school/staff` · `school/staff/members` · `school/teaching` · `school/attendance/register` · `school/fees` · `school/fees/[studentId]` · `school/fees/verify` · `school/fees/generate` · `school/results` · `school/results/publish` · `school/custom-fields` · `school/students/import` · `school/students/[id]/custom-values` · `school/announcements` · `school/recipients` · `session/schools` · `network/overview` · `teacher/overview` · `admin/networks` · `admin/billing` · `school/subscription` · `parent/overview` · `parent/fees` · `parent/attendance` · `parent/results` · `parent/notices` · `session/whoami` · `students` · `students/[id]` · `staff` · `fees/structures` · `fees/records` · `payments` · `payments/[id]/verify` · `attendance` · `results` · `results/publish` · `announcements` · `announcements/[id]/read` · `messages` · `admin/overview` · `admin/schools` · `admin/schools/[id]` · `admin/features` · `admin/tiers` · `admin/overrides` · `admin/impersonate` (501 — needs Clerk actor tokens) · `teacher/hub` · `teacher/hub/resources` · `teacher/hub/resources/[id]` · `teacher/hub/subscription` · `admin/teacher-hub` · `admin/incidents`

**Phase 3 caveat — the logic is proven, the delivery is not.** Communications and PDF generation are verified against the real handlers, the real renderer, and the real fallback chain, but **no job has round-tripped through Redis and no message has left this machine.** There is no Redis locally and no Meta/Resend/Twilio credentials, so every channel runs through the mock provider. Live BullMQ→Redis transport and real delivery are **Phase 6, with credentials.** Do not build on the assumption that either has been exercised.

**CI.** `.github/workflows/ci.yml`, two jobs, **both green as of 2026-09-27** (run `36305510617`). `npm run ci:checks` runs the whole fast half locally — migration-sequence guard, pgTAP plan counts, type-check, lint, build — and is what to run before pushing. The `database` job starts a local Supabase, applies **every migration to an empty database** via `db reset`, and runs all 25 pgTAP suites; it needs Docker and so cannot run on this machine, which is exactly why it matters. Read runs with `"/c/Program Files/GitHub CLI/gh.exe" run list` — `gh` is installed and authenticated but not on PATH in a Git Bash session.

**CI caught three defects on its first complete run, and the shape of all three is worth remembering:** reasoning about one migration in isolation without re-running the suites that already covered the ground it touched. `db:test:plans` counts assertions *without executing them*, so a suite that errors on its first line still passes the plan check. Only a real database running every suite finds that class of problem. One of the three was a broken API route (`/api/announcements`), not a broken test — see `0129`.

**`npm run lint` did nothing until 2026-09-27**: the script was `next lint` with no config, which prompts interactively and surfaced under turbo as an opaque non-zero exit. It is now `eslint` with a flat config in `apps/web/eslint.config.mjs`, and the nine dead imports it immediately found are gone.

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
- Run the pgTAP suites after any migration touching RLS: `npm run db:test`. **This needs Docker**, which is not installed on the current machine — until it is, the suites are executed through the Supabase MCP with session-scoped `SET ROLE` instead of the file's `SET LOCAL`. Same assertions, different identity-switching mechanism. **CI runs them properly** against a from-scratch database on every push, so a migration that breaks an older suite is caught there rather than here — and it has been. Push before assuming a migration is safe.
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
| **Billing has no payment gateway and no dunning** | `PRICING.md`, `0126` | Open by decision. Invoicing works end to end with **manual** recording: AfriTech records bank-transfer or mobile-money receipts against an invoice, which is its own verification. The gateway foundation exists in `invoice_payments` (gateway columns plus a unique `(gateway_name, gateway_reference)` idempotency key), but no webhook handler, no charge initiation, and no automatic retry/reminder flow. Also unbuilt: a credit note (a paid invoice cannot be voided, by design), and a scheduled billing run — `run_billing()` exists and is invoked from the admin screen by hand. |
| **Parent accounts cannot be signed into on a dev machine without a helper** | `scripts/link-dev-parent.mjs` | Open by nature, not a defect. `dev_seed.sql` creates parents with synthetic Clerk ids, which are rows and not accounts, so parent RLS matches nothing for a real sign-in and the portal renders correctly empty. `npm run dev:link-parent -- <clerk-user-id>` repoints seeded links at a real account (dev project only). Remove this row if Clerk test users are ever seeded properly. |
| **AI credits: reserve/settle is designed but not implemented** | `0132`, `AI_CAPTURE.md` | Open, and deliberately scoped. The ledger admits `reserve` and `release` and carries `reservation_id`, but only `ai_credit_consume()` exists. Synchronous generation does not need reservations — it calls the model, then charges with the real token count, discarding the output if the charge fails. **AI capture does**: a queued offline capture must reserve on queue and settle on successful extraction, or a teacher queues twenty captures against a balance of two and finds out a day later. Write the three functions with capture; the table shape is already right, so it is not a migration against a financial table holding live rows. |
| **AI credit prices and allowances are seeded guesses** | `afritech.ai_credit_prices`, `tier_ai_allowances`, `teacher_hub_plans` | Open, needs a business decision and then a pilot. Seeded: 1 credit per lesson plan/quiz/homework, 2 per photographed page, 0 per spreadsheet import; packs at K150/50, K600/250, K2000/1000; Hub paid plans 60 credits a month. **No tier has an allowance row yet**, so schools currently include nothing. All of it is configuration editable without a deployment, which is the point — but `AI_CAPTURE.md` is right that the capture price cannot be fixed until the retry rate is measured against real Zambian paper. |
| **The AI chain has never made a real HTTP request** | `packages/ai`, `scripts/ai-smoke.ts` | Open, and only you can close it. The Anthropic and OpenAI adapters, the error classifier and the failover chain are written, type-checked and exercised end to end **with no keys** — `npm run ai:smoke` proves the module graph, the classification, the walk across both providers and the critical total-failure incident. What has never happened is a real call: the keys are in `.env.local`, which is gitignored and unreadable from a session. Run `npm run ai:smoke` with keys present to verify, then set `AI_GENERATOR=live`. **Anthropic is wired but unverified in the other direction** — its key has no credit, so failover TO it has never executed; raise its priority in `afritech.ai_models` once topped up. |
| **Sentry is documented but not installed** | `CLAUDE.md`, `ENV.md`, `SENTRY.md` | Open. No `@sentry/*` dependency, no config file, no `captureException`, no `global-error.tsx`. `0134`'s `platform_incidents` covers business-level failures AfriTech must act on, with an acknowledge/resolve lifecycle Sentry does not have — but nothing yet captures an unhandled exception with a stack trace, and no route funnels its own 500s into the incidents table. Both are small and both are worth doing. |
| **The Teacher Hub's prompt has no published version yet** | `afritech.ai_prompt_templates` | Open, and it is what gates live generation. `resolveGenerator()` requires BOTH `AI_GENERATOR=live` AND an active prompt row, so setting the switch alone degrades to the scaffold with a console warning rather than erroring. Publishing one is `afritech.publish_prompt_template()`; the prompt text itself is product work, not a migration. |
| **Teacher Hub: Community Library, PDF/Word export, and Clerk linking are not built** | `TEACHER_PORTAL.md` | Open, deliberately scoped out. The Community Library is Phase 3 in its own spec, and there is **no broad SELECT policy on `teaching_resources`** — a shared plan must expose a first name and a subject, never `created_by`, so when it is built it gets a SECURITY DEFINER function returning the non-identifying columns rather than a widened policy. Export is browser print for now; wiring `packages/documents` is a job of its own. Account linking is not a code path at all: ZSMS invites staff server-side through the Backend API, so a standalone teacher joins a school by being invited, and the Hub dashboard says so rather than offering an invitation-code box that cannot work. |
| **A teacher subscribing mid-month gets 55 credits, not 60** | `ai_credit_balance()`, `0132` | Open, small, and a commercial decision rather than a bug. A monthly allowance is summed over the **calendar month**, and the five trial spends are allowance-funded rows — so a teacher who uses their trial and subscribes the same month sees 55 of their first 60. It self-corrects the following month. Observed while verifying the `0133` meter change. The fix, if wanted, is to window a paid plan's allowance from `subscription_started_at` rather than the calendar month; the alternative reading is that five free resources were genuinely consumed and counting them once is correct. Decide before charging real teachers. |
| **Form drafts cover three forms, not every form** | `lib/use-form-draft.ts` | Open by decision, not omission. Wired into the announcement composer, the Hub generator and the Hub profile step. **Enrolment and payment forms are excluded by rule** — they hold `nrc_or_birth_cert`, medical notes and payment references, and `localStorage` on a shared school office machine survives sign-out. Widening this needs a deliberate decision about sensitive fields, not just another `useFormDraft` call. Bulk-import mapping was dropped on implementation: the CSV it describes is held in memory only, so a restored mapping would point at a file the user no longer has. |
| **`integration` has ~61 commits never merged to `main`** | git | Open, a release decision rather than an engineering one. Everything from Phase 4 onward lives on `integration`, which is green in CI. `main` has not been updated since before the fees module. At some point this wants a single pull request to `main` so CI gates it as a unit. |

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
