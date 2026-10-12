# CHANGELOG.md — ZSMS Development Changelog

## Purpose

This document records all significant changes to ZSMS by date. It serves as the human-readable history of product decisions, feature additions, and architectural changes. Updated at the end of every development sprint or significant documentation session.

---

## 2026-10-10 — CI Green, and `main` Merged for the First Time

### Bug Fix
- **`allocate_payment` had been broken on its main path since `0213`** — it selected `s.allocate` from `suggest_payment_allocation()`, which returns `suggested`. plpgsql resolves names at run time, so the migration applied cleanly and the function raised 42703 on every call. `POST /api/payments` and the parent payment claim both use that branch, so **every payment recorded without explicit allocations had failed**. Fixed in `0232`.
- **Seven tables had policies and no GRANT** (`0233`, `0234`). Postgres checks the privilege before RLS, so the policies were dead code that read as protection and several screens returned "permission denied" to real users. `0234` adds `tables_with_dead_policies()` and `tenant_isolation_test` asserts it is empty, so the eighth occurrence fails a build.
- **Nine inherited DELETE grants** (`0231`). Supabase grants ALL on a new table by default; nine of the ten were never deleted from by any code.
- **`afritech.school_credit_plans` had no RLS at all** (`0231`).
- **Provenance was editable** (`0233`) — `0218`'s table-level UPDATE grant implied column-level UPDATE on `content` and `generator_name`, so a teacher could rewrite what the model produced and whose model produced it. Now column-level.
- **Four policies were broader than their screens** (`0235`), live only because the grants above had just been fixed. Scoped to the audiences in `lib/roles.ts`.
- **The audit trail spoke two languages** (`0233`) — the trigger wrote `insert`, the explicit calls `create`. Now `create`; history deliberately not rewritten, and the UI reconciles both.

### Infrastructure
- **R2 live.** 14 checks across both buckets and the full document chain end to end. Report cards and receipts can be delivered.
- **PostHog live**, EU region, autocapture off.
- **CI green on both jobs**, 38 suites, 881 assertions — and **`main` merged up to date with `integration`** (PR #1, 222 commits), the first time since before the fees module.

### Architecture
- **ADR-044** — Edge Functions superseded; inbound webhooks are Next.js routes.

### Breaking Changes
- None. `0231`–`0235` are corrective.

---

## 2026-10-06 — Foundation Layer Audit and Remediation

### Documentation
- Audited all 14 Foundation Layer documents against the live schema and the tree. Overall **73%, Good**. `CONVENTIONS` and `RLS` scored 95%; this file scored **25%**, having stopped on 2026-08-14 with 214 commits since.
- Added generated `SCHEMA_INVENTORY.md` (`npm run db:inventory`). `DATABASE.md` documented 49 of 93 tables; hand-writing the other 52 would have been accurate for about a week, so the list is now read from the schema instead. `DATABASE.md` keeps the DDL and the reasoning, which is what is worth writing by hand.

### Feature
- **Custom staff roles (ADR-012)** — `school_custom_roles`, assignments, tier ceiling (Starter 3 / Growth 10 / unlimited), and `/school/[code]/settings/roles`. Holders carry `org:staff` with zero default access.
- **Marketing consent (ADR-015)** — `parents.marketing_opt_in`, defaulting FALSE and independent of `whatsapp_opted_in`. New `/parent/account` surface; the portal had none.
- **Integrations framework (ADR-023)** — `school_integrations` and `integration_log`, with `/school/[code]/settings/integrations`.
- **PostHog product analytics** — autocapture, input capture and session recording all OFF. Query strings stripped and dynamic path segments replaced before anything leaves the browser.
- **Security headers at the origin** — the five `CLOUDFLARE_WAF.md` headers set in `next.config.mjs` as well as at the edge, so they survive the orange cloud being greyed.

### Architecture
- ADR-015 was found to need no new table: it describes an account that is not revoked, and no parent policy filters on `students.status`. Proven by exercise in `supabase/tests/adr015_graduation_access.sql` rather than by reading the policies.
- ADR-023's claim that tier 1 was "already built" was **wrong** — no webhook table or dispatcher existed.

### Security
- Integration credentials cannot be stored at all: `FIELD_ENCRYPTION_KEY` is unset, so a CHECK refuses anything not already encrypted rather than letting a token sit in plaintext.
- `integration_log` has no INSERT, UPDATE or DELETE policy for any user — it is worker-written, and an append-only record a user can edit is not a record.

### Breaking Changes
- None. Migrations `0228`–`0230` are additive.

---

## 2026-10-01 to 2026-10-05 — Phase 5: Mobile, AI Assistant, Loans, Audit

### Feature
- **Mobile app** — 27 screens across parent, teacher and school audiences; APK built for both ABIs after `armeabi-v7a`-only installs failed on older handsets.
- **Role-based AI assistant** (`AI_ASSISTANT.md`) — right-side panel, "Ask AI" in every shell, conversation history, intent execution gated by role. Capped per role, then billed from AI credits.
- **Loan module (ADR-018)** — `private.loan_applications`, consent log, behaviour score (300–850), lender integration, AfriTech toggle. Parent consent is three screens with a SHA-256 of the consent text recorded.
- **Audit trail** — deep scan against the docs; `0223` covered five tables that had been missed, and the UI gained filters, an overview and role-scoped permissions.
- **Timetable** — move and swap lessons with conflict detection. `0209` corrected `0208`, which wrongly assumed a two-row `UPDATE ... FROM` is constraint-checked once.
- **Community Library**, **R2 download chain**, **curriculum extraction**, **parent payment claims**, **`schoolHasFeature()`** with an Upstash cache, and a unified toggle section in admin settings.

### Bug Fix
- Five of 312 payments were `pending_verification` while holding receipt numbers; `0211` separates `PAY-` on insert from `REC-` on verification.
- `allocate_payment` manufactured consent timestamps (`0213`).
- `teaching_resources` had an UPDATE policy with **no GRANT**, so Hub rename, edit and share had never worked (`0218`).
- `0227` fixed a real hole: the behaviour score trusted a user id passed as an argument, so any signed-in user could read another parent's credit score.

### Breaking Changes
- None.

---

## 2026-09-26 to 2026-09-30 — Phase 4: Portals, Billing, CI

### Feature
- School Networks — aggregates for an owner of up to 100 schools.
- Billing screens — admin run and record, school subscription, network consolidated.
- Results: marks entry that records what a grade meant, via `grading_scale_version_id` (ADR-041).
- School provisioning, self-registration, the onboarding task queue, the public schools directory, and per-student pricing.
- Sidebar navigation for every portal; the platform incidents screen.

### Infrastructure
- **CI green for the first time** (`.github/workflows/ci.yml`). It immediately caught three defects, one of them a broken live route — all three from reasoning about a migration in isolation without re-running the suites covering the ground it touched.
- `npm run lint` had been doing nothing: the script was `next lint` with no config, failing opaquely under turbo. Replaced with `eslint` and a flat config; nine dead imports removed.
- Upstash Redis proven end to end — `EVAL`, `XADD` and `BZPOPMIN` all work on the free tier.
- One real AI call made (`openai/gpt-4o`, 6.2s, $0.00129, schema-valid structured output).

### Bug Fix
- Clerk's `force_organization_selection` locked out three of five audiences — a standalone teacher, a parent and a school owner mid-registration all have no organisation by design. `npm run clerk:check` now mints a real token and decodes it.

### Breaking Changes
- None.

---

## 2026-08-15 to 2026-08-26 — Phase 3 Completion and the School Portal

### Feature
- Clerk mounted — middleware and `SessionProvider`, both provider-neutral names (ADR-032).
- The AfriTech admin dashboard finished; the school portal through groups 0–3 — pupils, staff and invitations, teaching assignments, attendance, fees.
- Organisation switcher and account menu in both shells.
- Dynamic student ceilings (`0101`–`0103`) resolving through `school_student_limit()`.

### Architecture
- **ADR-042** — the worker boundary. A worker's connection bypasses RLS, so all its data access goes through `worker_*` functions; `.from(` anywhere in `apps/workers` is a defect.
- `0095` created the three `afritech` tables that `PRICING.md` had specified and the database had never had — the documentation had been describing them as built for the whole of Phases 0–3.

### Performance
- School page render halved; auth screens branded.

### Breaking Changes
- None.

---

## 2026-08-14 — Pre-Phase-1 Cleanup

### Security
- **Upgraded `apps/web` from Next.js 14 to 15.5.23** (ADR-036). The 14.x line no longer receives security backports — patching the December 2025 RSC advisory to `14.2.35` still left roughly twenty-one advisories fixed only in `15.5.x`, including SSRF in rewrites and Server Actions, cache poisoning in RSC responses, and XSS via CSP nonces. Cache poisoning is the sharpest for ZSMS: one deployment serves every school, and a cached response crossing a tenant boundary is a ZDPA-reportable breach.
- `apps/web` moved to React 19.2.x, and a scoped `overrides` entry pins `@clerk/nextjs`'s `next` peer. Both were forced by a dependency-tree defect found during the upgrade — see ADR-036.
- Remaining known exposure: `postcss` (build-time only) and `sharp` (`<0.35.0`, libvips CVEs) reach the tree through Next.js. Neither is currently reachable — no image passes through the Next.js optimizer yet. **This must be resolved before any user-uploaded image is served through `next/image`.**

### Database
- Established the migration versioning procedure (`MIGRATIONS.md`). The Supabase CLI is now the only supported way to apply a migration; it is pinned as a root `devDependency`. The MCP's `apply_migration` writes a timestamp version that desynced `0001` from its filename, and timestamp versions sort after every four-digit version, silently reordering the sequence.
- Only `zsms-dev` may be migrated by automated tooling. Staging and production are release actions requiring explicit human approval.

### Tooling
- Added a tracked permission configuration and a `PreToolUse` guard hook that escalates destructive SQL and any non-`zsms-dev` project to human approval.

---

## 2026-04-26 — Pre-Development Documentation Complete

### Architecture
- Confirmed modular monolith architecture with Turborepo monorepo
- Finalised tech stack: Next.js 14, React Native/Expo, Supabase, Clerk, PowerSync, QStash, Cloudflare R2, Vercel
- Confirmed two-branch Git workflow (feature → integration → main)
- Confirmed soft-delete only for all financial and academic records
- Added data residency three-layer strategy (Supabase af-south-1, Clerk DPA, self-hosted option)
- Added packages/auth-provider abstraction for future Keycloak swap

### Authentication and Roles
- Confirmed email OTP only — SMS OTP disabled
- Added org:staff as Clerk base role for custom role holders (zero default access)
- Added platform:teacher role for standalone Teacher Hub access
- Added platform:alumni role for permanent historical read-only access
- Confirmed 365-day sessions for parents and students
- Confirmed indefinite sessions for platform:alumni
- Added role selector for multi-context users (linked teachers, multi-school parents)

### Database Schema
- Finalised 58-table schema across public (46), private (4), and afritech (8) schemas
- Added school_custom_roles — school-defined staff roles
- Added module_subscriptions — per-school feature add-on tracking
- Added timetables, timetable_periods, timetable_slots — timetable module
- Added announcements, announcement_reads — full read tracking confirmed
- Added parent_push_tokens — Expo push notifications
- Added alumni_profiles — permanent platform-level alumni accounts
- Added lenders — loan marketplace partner registry
- Added school_integrations, integration_log — accounting and CRM integrations
- Added afritech.subscription_tiers, feature_flags, tier_features, school_feature_overrides — dynamic pricing
- Added afritech.loan_commissions, platform_metrics — financial tracking
- Added knowledge_base (pgvector), lesson_plans, ai_conversations, standalone_teacher_accounts — AI module
- Added fields to schools: whatsapp_phone_number_id, whatsapp_access_token_enc, whatsapp_business_acct_id, whatsapp_owns_number
- Added fields to parents: marketing_opt_in (default FALSE)
- Added fields to students: examination_number, alumni_status
- Expanded private.loan_applications: lender_id, loan_product_id, product_type, fee_record_id (nullable), repayment_schedule, collection_account, zsms_is_lender

### Subscription and Billing
- Replaced fixed-tier pricing model with database-driven base tier + feature add-on model
- All pricing stored in afritech schema tables — no hardcoded prices
- Super admin pricing panel: edit tier prices, toggle feature matrix, apply school overrides
- Override types: grant_feature, revoke_feature, extend_subscription, extend_trial, tier_override
- Feature access resolution: revoke override → grant override → tier override → module subscription → tier features
- Redis cache for feature access (5-min TTL overrides, 60-min TTL tier features)
- Added standalone teacher subscription (K300/month, 5-plan free trial)

### Communication Module
- Confirmed portal-first communication model
- Added school-specific WhatsApp Business number support (Mode A: shared, Mode B: school-own)
- Added per-absence alert toggle (opt-in, disabled by default)
- Full announcement read tracking confirmed for all announcements, all schools
- Added marketing_opt_in field — completely separate from whatsapp_opted_in

### Student Lifecycle
- Added examination_number field (optional, for ECZ/Cambridge candidate numbers)
- Added alumni_status field (NULL = enrolled, graduated, transferred)
- Graduation flow: creates alumni_profiles, prompts marketing opt-in (never pre-ticked)
- Transfer flow: sets grace period, creates alumni profile, prompts marketing opt-in
- Alumni retain permanent read-only access to all historical records

### Teacher Hub (Standalone B2C Product)
- Added standalone teacher product — platform:teacher account, no school required
- Tools: lesson planner, quiz generator, homework creator, community library
- Free trial: 5 lesson plans (no time limit)
- Monthly subscription: K300/month, Annual: K3,000/year
- Account linking: standalone teacher seamlessly links when school joins ZSMS
- Dual-context navigation for linked teachers (My Tools + school contexts)
- Lesson plans belong to the teacher — not the school — carry over on linking

### AI Module
- Four-system architecture: smart analytics, AI assistant, lesson planner (RAG), predictive intelligence
- Smart analytics (System 1): SQL aggregations, no LLM, available Phase 2
- AI assistant (System 2): Claude API, role-based, RLS-enforced structured queries
- Lesson planner (System 3): RAG with Zambian curriculum knowledge base, Phase 3
- Predictive intelligence (System 4): requires 18+ months data, 50+ schools, Phase 4
- Data completeness gate: AI insights require ≥70% completeness (50-69%: limited, <50%: locked)
- Knowledge base: ECZ syllabuses, Cambridge specs, MESVTEE framework, pgvector embeddings
- Standalone lesson planner available to platform:teacher accounts independently
- Knowledge base is the competitive moat — not the LLM

### Loan Module
- Three-phase evolution: facilitation → API integration → ZSMS MFI
- Added lender marketplace model — multiple lenders onboarded as partners
- Behaviour score: 300-850 scale, four categories, factor-based for explainability
- Three-layer submission security: consent log + confirmation checkbox + documentary evidence
- Repayment collection details displayed in parent portal (Phase 1)
- In-portal repayment initiation via PawaPay (Phase 2)
- Non-school loans (personal, emergency, device) added — fee_record_id nullable
- fee_record_id made nullable for non-school loan products

### Integrations Module
- Three-tier architecture: native webhooks (Phase 1) → pre-built connectors (Phase 2) → Zapier (Phase 3)
- Pre-built connectors: Sage 50 (CSV export), Sage Business Cloud, QuickBooks, Xero, Google Sheets, HubSpot
- Integration dispatch via the queue — failures never block school operations
- school_integrations and integration_log tables built in Phase 1

### Document Updates (All Pre-Development)
- ADR-001 through ADR-029 recorded in DECISIONS.md
- 60+ terms added to GLOSSARY.md
- All new tables added to DATABASE.md and SCHEMA.md
- Migrations 0001-0061 documented in MIGRATIONS.md
- Indexes for all new tables added to INDEXES.md
- SUBSCRIPTION.md fully rewritten for dynamic pricing model
- ARCHITECTURE.md updated with all new systems
- AUTH.md, ROLES.md, SESSIONS.md updated for new roles
- RLS.md updated with policies for all new tables
- META_API.md updated for per-school WhatsApp number selection
- SCHOOL_CONFIG.md updated with WhatsApp config, timetable config, integrations
- STUDENTS.md updated with alumni lifecycle
- PARENT_LINKING.md updated with marketing_opt_in model
- TRANSFER.md updated with alumni access

### New Documents Created
- PRICING.md — dynamic pricing admin panel reference
- TEACHER_PORTAL.md — standalone Teacher Hub product (Stage 6)
- INTEGRATIONS.md — integrations framework overview
- ACCOUNTING_CONNECTORS.md — Sage, QuickBooks, Xero, Google Sheets
- CRM_CONNECTORS.md — HubSpot and custom webhook
- CUSTOM_WEBHOOK.md — school-facing webhook configuration
- AI_OVERVIEW.md — four-system AI architecture
- AI_ASSISTANT.md — role-based conversational assistant
- LESSON_PLANNER.md — RAG lesson planner with B2C product
- ANALYTICS_INTELLIGENCE.md — smart analytics and early warning system
- AI_DATA_REQUIREMENTS.md — data completeness requirements

---

## 2026-08-13 — Architecture Reconciliation and Gap Fill

### Architecture

- **BullMQ confirmed as the default job queue implementation; QStash reclassified as the swappable fallback** (ADR-035). Supersedes the QStash-first implementation choice recorded in the 2026-04-26 stack entry above and in ADR-005. The queue abstraction is unchanged — only the default driver.
- Railway's role expanded from standby database only to standby database **plus** BullMQ workers and Redis. Railway is now on the critical path continuously.
- Thirteen-layer architecture compliance model adopted (ADR-030), with `THIRTEEN_LAYER_COMPLIANCE.md` as the audit.
- Three-tier deployment topology formalised (ADR-032): central public cloud, per-country self-hosted, central encrypted backup vault.
- Dynamic-config-everything principle adopted (ADR-031), generalising ADR-014 from pricing to all business parameters.
- Cloudflare WAF added to the `ARCHITECTURE.md` stack diagram — it existed in `CLOUDFLARE_WAF.md` but was omitted from the architecture overview.

### Testing

- k6 adopted as the primary load testing tool, Artillery as secondary (ADR-033). Added as Layer 6 of `TEST_STRATEGY.md`.

### AI Module

- AI assistant extended into a context-aware navigational assistant (ADR-034): page and section awareness, navigation intents, read operations, and approval-gated write/CRUD operations. Available to every user role, inheriting the user's RLS and permissions. Country-customisable via feature flags.

### Environments

- `zsms-dev` provisioned in `eu-west-1` as a documented exception — synthetic and seed data only, no adequacy basis engaged. Staging and production remain `af-south-1`.
- `vector` and `pgtap` extensions enabled on `zsms-dev` in the `extensions` schema.

### New Documents Created

- THIRTEEN_LAYER_COMPLIANCE.md, DYNAMIC_CONFIG.md, BUILD_SEQUENCE.md
- COST_MANAGEMENT.md, CACHING_CDN.md, SCALING.md, AVAILABILITY.md, DEPLOYMENT_TOPOLOGY.md, HOSTING_STRATEGY.md
- LOAD_TESTING.md

### Breaking Changes

- `JOB_QUEUE_PROVIDER` now defaults to `bullmq` when unset (previously `qstash`). Deployments relying on the old default must set `JOB_QUEUE_PROVIDER=qstash` explicitly.
- `BULLMQ_REDIS_URL` is now a required environment variable for the default configuration.

---

## Change Log Format

Future entries follow this format:

```
## YYYY-MM-DD — Sprint/Release Description

### Category (Architecture / Feature / Bug Fix / Documentation)
- Change description
- Change description

### Breaking Changes
- Any changes that require migration or code updates
```

---

## Versioning

ZSMS follows semantic versioning for production releases:
- **Major (X.0.0):** Breaking schema changes or fundamental architecture changes
- **Minor (0.X.0):** New features, new modules
- **Patch (0.0.X):** Bug fixes, performance improvements, documentation updates

Pre-launch (before January 2027 commercial launch): all versions are 0.X.X.
