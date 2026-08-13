# CLAUDE.md — ZSMS

## What this repository currently is

**Documentation only. There is no source code here yet.**

The tree is `Official Documentation/` (108 markdown files across 18 numbered folders) and `.claude/`. The `apps/`, `packages/`, and `supabase/` directories described throughout the docs **do not exist** — they are the specification for what will be built.

ZSMS is a school management SaaS by AfriTech Systems Limited, targeting Zambia (`zsms.co.zm`) with a multi-country expansion path. Commercial launch is dated January 2027. The documentation set was completed pre-development.

Before writing any code, confirm with the user whether you are scaffolding the project for the first time.

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

Start any substantive task by reading `01 Foundation Layer/CONVENTIONS.md` and `01 Foundation Layer/DECISIONS.md`. `DECISIONS.md` holds 29 ADRs — check it before proposing an architectural change, so settled decisions are not relitigated.

---

## Architecture essentials

Modular monolith (explicitly **not** microservices), Turborepo monorepo.

- **Clients** — Next.js 14 App Router (`apps/web`), React Native/Expo (`apps/mobile`)
- **API** — Next.js API routes + Supabase Edge Functions (Deno), rate-limited via Upstash Redis
- **Data** — Supabase PostgreSQL, Upstash Redis, Cloudflare R2 (two buckets: public + private), Railway Postgres hot standby
- **Async** — Upstash QStash; `03 Infrastructure Services/BULLMQ.md` defines a queue abstraction so BullMQ can replace it in Phase 2
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
| Development | `zsms-dev` | `tevblmcebsqqjgzjptgw` | `eu-west-1` | Live, schema empty |
| Staging | `zsms-staging` | — | `af-south-1` | Phase 0 final steps |
| Production | `zsms-zm` | — | `af-south-1` | Phase 6 |

**`zsms-dev` being in `eu-west-1` is a deliberate, documented exception — do not "fix" it.** Dev holds synthetic and seed data only, so the ZDPA/POPIA adequacy argument that requires `af-south-1` is not engaged. Staging and production must be `af-south-1`. Full rationale in `COMPLIANCE.md` → Environment Data Residency.

**Never load real school data into `zsms-dev`** — no production dumps, no anonymised extracts, no pilot records. The region exception depends entirely on that constraint. Generate fixtures per `TEST_DATA.md`.

Extensions already enabled on dev beyond Supabase defaults: `vector` (pgvector, for the AI knowledge base) and `pgtap` (for RLS tests). Migration 0001 should still declare them idempotently with `CREATE EXTENSION IF NOT EXISTS`, since staging and production start clean.

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
| Migrations | `NNNN_description.sql`, four-digit zero-padded (0001–0061 already specified) |
| Docs | UPPER_SNAKE_CASE `.md` |
| Branches | `type/description` — `feature/`, `fix/`, `docs/`, `chore/`, `db/`, `rls/` |
| Commits | `type: description` — `feat`, `fix`, `db`, `rls`, `docs`, `chore`, `test`, `refactor`, `style` |

**Identifiers:** School `ZM-LSK-0001` · Student `STU-ZM-LSK-0001-00042` · Receipt `REC-ZM-LSK-0001-000001`

**Never do these** (verbatim from CONVENTIONS.md):

1. The Supabase service role key is never used outside an Edge Function.
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

The docs were written in two waves — **2026-04-26** (420 change-log entries) and **2026-06-23** (23 entries, adding a SOC 2 / ZDPA compliance layer). The April docs were **not** fully reconciled with the June revisions. Where they disagree, the June doc wins.

| Conflict | Resolution |
|---|---|
| Session length | `SESSIONS.md` (June) caps **all** end-user sessions at **30 days** — parent/student revised down from 365, alumni from indefinite. `CHANGELOG.md` and `ARCHITECTURE.md` still state the old values. **30 days is correct.** |
| Schema count | `DATABASE.md` opens "two PostgreSQL schemas" and describes only `public` and `private`, but references `afritech.` 14 times in its own body. There are **three** schemas: `public` (46 tables), `private` (4), `afritech` (8) — 58 total. |
| Queue technology | `ARCHITECTURE.md` names QStash directly. `BULLMQ.md` (June) introduces a queue abstraction with QStash as the Phase 1 implementation. **Build against the abstraction.** |
| Missing WAF | `ARCHITECTURE.md` omits the Cloudflare WAF layer added in `CLOUDFLARE_WAF.md` (June). |
| Missing ADRs | `DECISIONS.md` stops at ADR-029 (April). The June decisions — WAF, queue abstraction, the session-length reversal, school health scoring — have no ADRs. |

If you resolve any of these in the docs, remove the corresponding row here.

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
