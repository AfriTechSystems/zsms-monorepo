# CLAUDE.md — ZSMS

## What this repository currently is

**Phases 0–3 complete, plus the fee arrears model. Phase 4 not started.**

ZSMS is a school management SaaS by AfriTech Systems Limited, targeting Zambia (`zsms.co.zm`) with a multi-country expansion path. Commercial launch is dated January 2027. The documentation set was completed pre-development, so the docs still specify more than exists.

The tree is:

| Path | State |
|---|---|
| `Official Documentation/` | 119 markdown files across 18 numbered folders — the specification |
| `apps/web` | Next.js 15 App Router (pinned `15.5.23`). Builds. **15 API routes**, no UI beyond `/` |
| `apps/mobile` | Expo 52 / RN 0.76. Type-checks. **No screens yet** |
| `apps/workers` | Railway background workers. Four registered: receipts, fee reminders, scheduled announcements, report-card batches |
| `packages/` | `auth-provider`, `queue`, `storage`, `utils`, `types`, `config`, `notifications`, `documents` — `types/database.ts` generated from the live schema |
| `supabase/migrations/` | **`0001`–`0021`, `0069`–`0091` applied to `zsms-dev`** (44 migrations) |
| `supabase/tests/rls/` | **5 pgTAP suites, 225 assertions** — tenant isolation (72), fees/attendance/results (44), fee arrears (38), communications (45), worker boundary (26). `npm run db:test` checks every `plan(N)` against the real assertion count first |
| `supabase/tests/e2e/` | `payment-verified-e2e.ts` — 28 checks, run via `npx tsx` |
| `supabase/functions/`, `seed/` | Empty — no Edge Functions yet |

**What exists is a backend, not a product.** 31 `public` tables with RLS enabled *and* forced on every one, 124 policies, two `security_invoker` views, and the API routes below. **There is still no user interface** — no dashboard, no parent portal, no mobile screens.

**API routes built** (all `/api/…`): `health` · `schools` · `students` · `students/[id]` · `staff` · `fees/structures` · `fees/records` · `payments` · `payments/[id]/verify` · `attendance` · `results` · `results/publish` · `announcements` · `announcements/[id]/read` · `messages`

**Phase 3 caveat — the logic is proven, the delivery is not.** Communications and PDF generation are verified against the real handlers, the real renderer, and the real fallback chain, but **no job has round-tripped through Redis and no message has left this machine.** There is no Redis locally and no Meta/Resend/Twilio credentials, so every channel runs through the mock provider. Live BullMQ→Redis transport and real delivery are **Phase 6, with credentials.** Do not build on the assumption that either has been exercised.

**Read `JOURNAL.md` first.** It records what each session actually did, the defects found, and what was deliberately deferred — including several cases where a documented claim turned out not to match the schema.

---

## Reading the documentation

Docs are grouped by domain in numbered folders:

| Folder | Contents |
|---|---|
| `01 Foundation Layer` | ARCHITECTURE, DATABASE, CONVENTIONS, DECISIONS (ADRs), RLS, GLOSSARY, COMPLIANCE, SECURITY_POLICIES, ENV, CHANGELOG |
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

Start any substantive task by reading `01 Foundation Layer/CONVENTIONS.md` and `01 Foundation Layer/DECISIONS.md`. `DECISIONS.md` holds 42 ADRs — check it before proposing an architectural change, so settled decisions are not relitigated.

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
2. **Pricing and feature access are entirely database-driven.** Four `afritech`-schema tables (`subscription_tiers`, `feature_flags`, `tier_features`, `school_feature_overrides`) drive everything. Never hardcode a price, tier, or feature inclusion. Gate features through `schoolHasFeature()`, whose resolution order is fixed: revoke override → grant override → tier override → module subscription → tier matrix.

---

## Supabase environments

Only the dev project exists. Build against it exclusively.

| Environment | Project | Ref | Region | Status |
|---|---|---|---|---|
| Development | `zsms-dev` | `tevblmcebsqqjgzjptgw` | `eu-west-1` | Live, 44 migrations applied |
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

The 2026-04-26 / 2026-06-23 conflicts that used to be listed here — session lengths, schema counts, QStash vs BullMQ, the missing WAF, the missing ADRs — **have all been resolved.** `DECISIONS.md` now holds 42 ADRs.

**A pattern worth knowing before you trust any doc:** repeatedly, a document has described something the schema could not do. `class_enrolments` was referenced by four documents and defined by none. `GLOSSARY.md` promised a fee statement with a running balance that nothing could produce. `DATABASE.md`'s `payments` DDL omitted the verification columns `SCHEMA.md` specified. Each was found by *implementing against the doc*, not by reading it. **Verify against the applied schema before building on a documented claim.**

### Open, tracked

| Item | Where | Status |
|---|---|---|
| **Multi-country config hardening** | ADR-040 | Deferred. `curriculum_type`, `grading_system`, `examination_type`, `level_type`, and `term_number` are hardcoded CHECK constraints; `reference_subjects_zm` bakes the country into a table name. Each needs a migration to admit a second country. Decide when the second country is real. |
| **Grading-scale versioning on `exam_results`** | ADR-041 | **Open data-integrity gap.** A grade letter is stored without the scale that produced it, so a mid-year scale revision makes historical grades unexplainable. Needs fixing before results are relied on long term. |
| Migration numbering | `MIGRATIONS.md` | `0022`–`0068` are **void** — they sort below the applied high-water mark and `db push` would skip them. Numbers are assigned when a migration is written, never reserved. Read *Next Available Sequence Number*. |
| Layer 1 (Frontend), Layer 7 (CI-CD) | `THIRTEEN_LAYER_COMPLIANCE.md` | Still **Thin**. No CI exists, so no test blocks a merge. |

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
