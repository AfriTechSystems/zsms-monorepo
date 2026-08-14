# CHANGELOG.md — ZSMS Development Changelog

## Purpose

This document records all significant changes to ZSMS by date. It serves as the human-readable history of product decisions, feature additions, and architectural changes. Updated at the end of every development sprint or significant documentation session.

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
