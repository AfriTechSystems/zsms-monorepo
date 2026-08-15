# DECISIONS.md — Architectural Decision Records

## Purpose

This document records every significant architectural and product decision made during the design and build of ZSMS. Each ADR explains what was decided, why, and what alternatives were considered. Claude Code sessions read this to understand the reasoning behind design choices and avoid revisiting settled decisions.

---

## ADR-001 — Modular Monolith Over Microservices

**Status:** Confirmed
**Decision:** Build as a modular monolith with a serverless execution layer, not microservices.
**Reason:** Solo developer building a pre-revenue product. Microservices add operational overhead that provides no benefit at current scale.
**Alternatives considered:** Microservices (rejected — too complex), pure serverless (rejected — cold start latency).

---

## ADR-002 — Supabase with RLS as Security Core

**Status:** Confirmed
**Decision:** Supabase PostgreSQL with Row Level Security as the primary data security mechanism. All school data isolation enforced at the database layer.
**Reason:** RLS provides defence-in-depth. Even if application layer has a bug, the database refuses to return wrong-tenant data.
**Alternatives considered:** Application-layer filtering only (rejected — single point of failure), separate DB per school (rejected — prohibitively expensive).

---

## ADR-003 — Clerk for Authentication

**Status:** Confirmed
**Decision:** Clerk for all authentication — email OTP only, SMS OTP disabled.
**Reason:** Clerk handles multi-tenant organisations, invitation flows, JWT generation. SMS OTP disabled for cost and reliability.
**Data residency note:** Clerk is US-based. Authentication credentials flow through US infrastructure. Substantive personal data lives in Supabase af-south-1. DPA with Clerk covers cross-border transfer under ZDPA.

---

## ADR-004 — PowerSync for Offline Mobile

**Status:** Confirmed
**Decision:** PowerSync for offline data sync on the teacher mobile app (attendance, marks entry).
**Reason:** Zambian schools have unreliable internet. Offline-first is a core requirement for teacher attendance and marks workflows.

---

## ADR-005 — Queue-Based Async Processing

**Status:** Confirmed — **implementation choice superseded by ADR-035**
**Decision:** All background jobs over 2 seconds run through a job queue rather than in the request path.
**Reason:** Supabase Edge Functions have a 50-second timeout. A queue provides reliable retry, scheduling, and a dead letter queue.
**Superseded detail:** This ADR originally named Upstash QStash as the implementation. **ADR-035 makes BullMQ the default implementation and QStash the swappable fallback.** The underlying reasoning here — that background work belongs in a queue with retry and scheduling — is unchanged and still governs.

---

## ADR-006 — Cloudflare R2 for File Storage

**Status:** Confirmed
**Decision:** Two-bucket architecture — public (documents/assets) and private (payment proofs, loan payslips).
**Reason:** R2 has no egress fees. Two-bucket separation ensures sensitive files cannot be accidentally made public.

---

## ADR-007 — No OTP for Financial Submissions

**Status:** Confirmed
**Decision:** Payment submissions and loan applications use a three-layer security model: (1) consent log, (2) confirmation checkbox with 10-minute freshness check, (3) documentary evidence upload.
**Reason:** SMS delivery is unreliable in Zambia. The three-layer model is stronger for the specific fraud risks of fee payments and loans.

---

## ADR-008 — Portal-First Communication Model

**Status:** Confirmed
**Decision:** WhatsApp used for high-value, low-frequency messages only. Per-absence WhatsApp alerts are opt-in (disabled by default). Monthly summaries are the WhatsApp default.
**Reason:** Uncontrolled messaging exhausts quotas and gets the number blocked. The portal provides a permanent record of all communications.

---

## ADR-009 — One Supabase Project Per Country

**Status:** Confirmed
**Decision:** Each country deployment has its own Supabase project with an independent database.
**Reason:** Data sovereignty — Zambian school data must not be co-mingled with other countries. Different countries may have different data residency requirements.

---

## ADR-010 — Soft Delete Only for Financial and Academic Records

**Status:** Confirmed
**Decision:** No hard deletes for students, fee records, payments, exam results, or audit logs. Soft delete with is_deleted flag. Audit log is append-only with no delete policy for any user.
**Reason:** Financial and academic records may be needed for regulatory compliance, disputes, and historical reporting.

---

## ADR-011 — Two-Branch Git Workflow

**Status:** Confirmed
**Decision:** feature/* → integration (staging) → main (production). Direct push to main blocked via branch protection.
**Reason:** Solo developer. Three-branch Gitflow adds overhead without benefit.

---

## ADR-012 — Custom Staff Roles via Database

**Status:** Confirmed
**Decision:** School-defined custom roles live in the ZSMS database (school_custom_roles table). Custom role holders use org:staff as their Clerk base role with zero default access. All permissions from the database.
**Reason:** Creating school-specific Clerk roles would create thousands of org-specific roles — unmanageable. Database-driven approach keeps Clerk clean.
**Tier limits:** Starter 3, Growth 10, Professional/Enterprise unlimited.

---

## ADR-013 — Timetable as Core Module

**Status:** Confirmed
**Decision:** Timetable builder is a core ZSMS feature. Included in Growth and above. Available as K100/month add-on for Starter.
**Reason:** Timetable connects every other module — staff assignments drive PowerSync sync rules, conflict detection prevents scheduling errors, parents and students use it daily.
**Conflict detection:** Server-side check before every slot save. Teacher cannot be in two places at the same time. UNIQUE constraint prevents double-booking.

---

## ADR-014 — Feature Toggle Billing Model

**Status:** Confirmed
**Decision:** Base tier + feature add-on toggle model. All pricing stored in database. Super admins change prices without code deployments.
**Reason:** Fixed tiers create poor fit for many schools. Dynamic pricing allows iteration without deployments.
**Implementation:** afritech.subscription_tiers, afritech.feature_flags, afritech.tier_features, afritech.school_feature_overrides. Feature access via schoolHasFeature() with Redis cache (5-min TTL for overrides, 60-min for tier features).

---

## ADR-015 — Graduated Account Model (Alumni Network)

**Status:** Confirmed
**Decision:** When a student graduates or leaves, their ZSMS account remains active permanently with read-only historical access. AfriTech may send promotional content to users who explicitly opt in (parents.marketing_opt_in — defaults to FALSE).
**Reason:** Permanent accounts create a valuable user base for AfriTech's future marketing revenue. Parents retain access to historical report cards and receipts permanently.
**Privacy:** marketing_opt_in is separate from whatsapp_opted_in. Marketing requires explicit opt-in. The two fields are independent.

---

## ADR-016 — School-Specific WhatsApp Business Numbers

**Status:** Confirmed — Built in Phase 1
**Decision:** Schools can use their own WhatsApp Business number. When schools.whatsapp_owns_number = TRUE, their own phone_number_id and encrypted access token are used instead of AfriTech defaults.
**Reason:** Branded sender experience increases parent trust. Schools using own number have independent Meta quota.

---

## ADR-017 — Full Announcement Read Tracking

**Status:** Confirmed
**Decision:** Every announcement read tracked for all schools, all announcements, all users via announcement_reads table. One row per user per announcement.
**Reason:** Schools need visibility into whether parents have read important announcements. AfriTech needs engagement data for platform analytics.

---

## ADR-018 — Loan Module Evolution to ZSMS MFI

**Status:** Confirmed — Three-Phase Plan
**Decision:** Phase 1: referral to partner MFIs. Phase 2: direct API integration. Phase 3: ZSMS registers as licensed MFI and lends directly.
**Reason:** The distribution advantage (parents logging in daily) and payment history data make ZSMS a natural lender. Building for Phase 3 now costs little extra.
**Architecture:** zsms_is_lender flag on applications, zsms_internal integration type in lenders table, fee_record_id nullable for non-school loans.

---

## ADR-019 — Lender Marketplace Model

**Status:** Confirmed
**Decision:** Multiple lenders onboarded as partners. Parents choose from available lenders. AfriTech earns origination commission per disbursed loan.
**Reason:** Single-lender creates concentration risk and limits parent choice. Marketplace creates competitive pressure and scales commission revenue.

---

## ADR-020 — Payment Behaviour Score Algorithm

**Status:** Confirmed
**Decision:** Proprietary payment behaviour score on 300–850 scale. Four weighted categories: Payment History (35%), Payment Capacity (25%), Account Behaviour (20%), Risk Indicators (20%).
**Reason:** 300–850 matches Southern African credit score conventions. Factor-based design ensures explainability for future regulatory compliance.
**Ethical constraints:** Score never uses gender, ethnicity, religion, or location. Snapshot calculated at application time only. ZSMS is not a credit bureau.

---

## ADR-021 — Three-Layer Loan Submission Security

**Status:** Confirmed
**Decision:** Loan applications secured by: (1) lender-specific consent log with scroll verification and SHA-256 hash, (2) confirmation checkbox with 10-minute server-side freshness check, (3) income document upload with R2 object existence validation.
**Reason:** SMS OTP is unreliable and adds friction. Three-layer model is stronger for loan application fraud risks. Satisfies Bank of Zambia digital lending guidelines for two-factor submission without SMS.

---

## ADR-022 — Data Residency Strategy (Three Layers)

**Status:** Confirmed
**Decision:** (1) Substantive personal data in Supabase af-south-1 (South Africa — POPIA recognised as adequate under ZDPA). (2) Authentication credentials in Clerk (US) covered by DPA. (3) Self-hosted deployment option for countries requiring strict local hosting.
**Reason:** Supabase has no Zambian data centre. The ZDPA requires adequate protection, not Zambian territory. Self-hosted path uses Supabase self-hosted, MinIO, BullMQ, and Keycloak on local VPS.
**Auth abstraction:** packages/auth-provider wraps Clerk today. Swapping to Keycloak for self-hosted is a configuration change, not a rewrite.

---

## ADR-023 — Integrations Framework (Three-Tier)

**Status:** Confirmed
**Decision:** (1) Native webhooks — already built, any webhook-capable system connects immediately. (2) Pre-built connectors for Sage, QuickBooks, Xero, Google Sheets, HubSpot (Phase 2). (3) Zapier/Make app (Phase 3).
**Reason:** Tiers are independent and can be shipped incrementally. Tier 1 provides immediate value. Tier 2 serves non-technical users. Tier 3 handles the long tail.
**Database:** school_integrations and integration_log tables built in Phase 1 so Phase 2 connectors need no schema changes.

---

## ADR-024 — Dynamic Pricing and Super Admin Overrides

**Status:** Confirmed
**Decision:** All tier prices, feature inclusions, and add-on prices stored in afritech schema tables. Super admins change prices, toggle features in/out of tiers, and grant per-school overrides — all without code deployments.
**Override types:** grant_feature, revoke_feature, extend_subscription, extend_trial, tier_override. All require mandatory reason and are logged in audit trail.

---

## ADR-025 — Examination Number Field on Students

**Status:** Confirmed
**Decision:** students.examination_number TEXT — optional field for ECZ/Cambridge candidate registration numbers. Shown on report cards for examination classes and in marks entry screen.
**Reason:** Bridges ZSMS internal assessments and national examinations. Teachers cross-reference physical mark sheets using candidate numbers.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | ADR-001 to ADR-011 | Initial architecture decisions — pre-development |
| 2026-04-26 | ADR-012 to ADR-025 | Confirmed decisions from stages 6–17 |
| 2026-04-26 | ADR-026 to ADR-029 | AI module architecture decisions |
| 2026-08-13 | ADR-030 — Thirteen-layer architecture compliance model | Architectural completeness needed a reproducible audit |
| 2026-08-13 | ADR-031 — Dynamic configuration for all operational parameters | Generalises ADR-014 from pricing to every business parameter |
| 2026-08-13 | ADR-032 — Three-tier deployment topology | Formalises the hosting model behind the ADR-022 residency layers |
| 2026-08-13 | ADR-033 — k6 as primary load testing tool | Scaling targets were unverified with no tool selected |
| 2026-08-13 | ADR-034 — Context-aware navigational AI assistant with approval-gated writes | Extends the assistant to all roles; writes never bypass confirmation |
| 2026-08-13 | ADR-035 — BullMQ as the default job queue implementation | Job priorities, concurrency control, cost at volume, Tier 2 parity |
| 2026-08-13 | ADR-005 marked superseded in its implementation choice by ADR-035 | Queue reasoning stands; the named provider changed |
| 2026-08-14 | ADR-036 — Next.js 15 as the web framework baseline | The 14.x line stopped receiving security backports; ~21 advisories fixed only in 15.5.x, several affecting tenant isolation |
| 2026-08-14 | ADR-036 amended — `apps/web` moves to React 19; React pinned at the workspace root | The upgrade surfaced a hoisting fault: root-hoisted `styled-jsx` resolved React against the root, loading a second instance during prerender |

**Note on document structure:** this Change Log sits mid-document for historical reasons — ADR-026 onward were appended after it. ADRs are numbered sequentially throughout; read to the end of the file for the complete set.

---

## ADR-026 — AI Module Architecture (Four-System Design)

**Status:** Confirmed
**Decision:** ZSMS AI is four distinct systems: (1) Smart Analytics — SQL aggregations, no LLM, Phase 2; (2) AI Assistant — Claude API with RLS-enforced structured queries, Phase 2; (3) Lesson Planner — RAG with Zambian curriculum knowledge base, Phase 3; (4) Predictive Intelligence — ML models requiring 18+ months of data, Phase 4.
**Reason:** Most educational AI failures come from treating all AI as the same thing. Statistical analytics (System 1) are cheap and immediately available. LLM-based features (Systems 2 and 3) have per-call costs and require thoughtful design. ML predictions (System 4) require data volume that does not exist at launch.
**Key constraint:** The data quality gate — AI insights require >= 70% data completeness. Below 50% locks AI insights entirely. This prevents misleading insights from incomplete data, which destroys teacher and administrator trust.

---

## ADR-027 — Lesson Planner as Standalone B2C Product

**Status:** Confirmed
**Decision:** Individual teachers not affiliated with any ZSMS school can sign up for a standalone `platform:teacher` account and pay a monthly subscription (K300/month) to access the lesson planner independently.
**Reason:** Teachers are a large addressable market independent of their schools. A standalone product creates a lead generation flywheel — teachers recommend ZSMS to their schools. The knowledge base (not the LLM) is the defensible moat.
**Account type:** `platform:teacher` — platform-level, not school-scoped. No access to school operational data. Lesson plans carry over when the teacher optionally links to a ZSMS-registered school.

---

## ADR-028 — RAG Architecture for Lesson Planner (Not Generic LLM)

**Status:** Confirmed
**Decision:** The lesson planner uses Retrieval-Augmented Generation with a Zambian curriculum knowledge base rather than prompting a general-purpose LLM directly.
**Reason:** General LLMs have poor knowledge of ECZ Grade 9 Mathematics specifics, Zambian textbook series, MESVTEE curriculum frameworks, and Cambridge specifications as applied in Zambia. Without grounding in actual curriculum content, generated lesson plans are generic and untrustworthy to Zambian teachers.
**The knowledge base is the product.** Any competitor can call the Claude API. Building properly structured, embedded Zambian curriculum content takes months of content work and is the defensible competitive advantage.
**Implementation:** pgvector in Supabase with IVFFlat index, OpenAI text-embedding-3-small for embeddings, Claude Sonnet for generation. Similarity threshold 0.70 minimum — if retrieval quality is poor for a topic, AfriTech adds content rather than lowering the threshold.

---

## ADR-029 — Data Completeness Gate for AI Insights

**Status:** Confirmed
**Decision:** AI analytics insights (System 1 and 2) require a minimum data completeness score of 70% (full insights) or 50% (limited insights with warnings). Below 50%, only data improvement guidance is shown.
**Reason:** Insights generated from partial data are worse than no insights — they create false confidence. A principal who acts on an AI report that 90% of students have good attendance when only 60% of teachers are marking attendance will make wrong decisions and lose trust in the system.
**Scoring:** Weighted composite of attendance completeness (40%), marks completeness (40%), and parent link completeness (20%). Calculated fresh on every AI feature page load — never served from cache for gating decisions.
**Exception:** The lesson planner (System 3) has no school data dependency — it uses the AfriTech knowledge base, not school operational data. A school with 0% completeness can still use the lesson planner.

---

## ADR-030 — Thirteen-Layer Architecture Compliance Model

**Status:** Confirmed
**Decision:** ZSMS architecture is audited against a fixed thirteen-layer model — Frontend, APIs/Backend, Database/Storage, Auth/Permissions, Hosting/Deployment, Cloud/Compute, CI-CD/Version Control, Security/RLS, Rate Limiting, Caching/CDN, Load Balancing/Scaling, Error Tracking/Logs, Availability/Recovery. Every layer has a named owning document and an honest coverage verdict, recorded in `THIRTEEN_LAYER_COMPLIANCE.md`.
**Reason:** A system is not complete because its features work. Without a layer checklist, cross-cutting concerns — caching, scaling, cost, recovery — are discovered during an incident rather than designed. The model also supplies the architectural half of the SOC 2 and ZICTA asset inventory, which is otherwise assembled from scratch under audit pressure.
**Alternatives considered:** Ad-hoc architecture review (rejected — no reproducible completeness signal); adopting a vendor's Well-Architected Framework wholesale (rejected — assumes a scale and team size ZSMS does not have).
**Consequences:** Every new infrastructure component must be assigned to exactly one layer. The audit is re-run at every phase gate in `BUILD_SEQUENCE.md`, with verdicts revised in both directions. A layer at **Gap** verdict blocks the January 2027 commercial launch. Layers 1 (Frontend) and 7 (CI-CD) are currently **Thin** with named remediation owners.

---

## ADR-031 — Dynamic Configuration for All Operational Parameters

**Status:** Confirmed
**Decision:** Every operational parameter a business person might reasonably want to change lives in the database and is editable by a super admin without a code deployment. The complete registry is `DYNAMIC_CONFIG.md`, backed by `afritech` schema tables with Redis caching. This generalises ADR-014 from pricing to all business parameters.
**Reason:** A hardcoded price means a deployment to change a price, and deployments carry risk, take time, and require the one person who can do them. A hardcoded threshold is never tuned because tuning is too expensive to bother with. A hardcoded country assumption makes the second country a rewrite.
**Scope:** Tier prices, per-feature add-on pricing, discounts and promo codes, trial length, WhatsApp quotas, behaviour-score weights and thresholds, commission rates, data-completeness gate thresholds, session durations, rate limits, early-warning thresholds, currency and exchange rates, tax/VAT rates, grading scales and term structures, notification templates and send-times, payment-gateway selection, loan-product parameters, and the standalone-teacher trial plan count.
**Explicit inverse:** Things that are not business decisions stay in code. Feature access resolution order, RLS policy structure, the 30-day session ceiling, soft-delete-only on financial and academic records, currency decimal precision, country configuration files, and the behaviour-score prohibited inputs from ADR-020 are invariants. Making a security invariant configurable creates the illusion of flexibility while multiplying the ways the system can be misconfigured into an unsafe state.
**Alternatives considered:** Environment variables (rejected — still requires a deployment, and no audit trail); a config file in the repo (rejected — same problem, plus no per-school scoping).
**Consequences:** Every configurable parameter must be registered in `DYNAMIC_CONFIG.md` in the same change that introduces it. Every configuration table write invalidates its cache keys in the same request handler. Every commercial or scoring change requires a mandatory reason and an `audit_logs` row.

---

## ADR-032 — Three-Tier Deployment Topology

**Status:** Confirmed
**Decision:** ZSMS supports exactly three deployment tiers from one codebase, one schema, and one release: **Tier 1** central public cloud (default), **Tier 2** per-country self-hosted (only where local storage is legally mandated), and **Tier 3** a central encrypted backup vault that operates alongside both. Specified in `DEPLOYMENT_TOPOLOGY.md`; tier selection process in `HOSTING_STRATEGY.md`.
**Reason:** Data protection regimes across target markets range from permissive to strictly localising. A product that can only deploy one way can only sell into one kind of market. Three tiers cover the range without forking the codebase.
**Public cloud is the default, and self-hosting is accepted only on a written legal opinion citing a specific localisation provision — never on customer preference.** Self-hosting trades a solved problem for an unsolved one: it replaces automated backups, monitoring, and patched dependencies with a country partner's operational maturity, which AfriTech cannot observe or control.
**Enabling abstractions:** `packages/auth-provider` (Clerk ↔ Keycloak), the queue abstraction (BullMQ across both tiers, only the Redis connection differs), and the S3-compatible storage interface (R2 ↔ MinIO). Schema, RLS policies, and migrations are identical across tiers. If application code can tell which tier it is running in, an abstraction has leaked.
**Tier 3 key custody:** exports are encrypted before leaving the source deployment with a per-country key. AfriTech holds ciphertext it cannot read. Any proposal to decrypt centrally "for convenience" defeats the model entirely.
**Alternatives considered:** Public cloud only (rejected — forecloses localisation-mandating markets); self-hosted only (rejected — enormous operational burden for no benefit in permissive markets); per-market codebase forks (rejected — unmaintainable by a small team).
**Consequences:** No Tier 2 deployment exists yet, and PowerSync has no documented self-hosted path — the largest open risk in the model, recorded in `DEPLOYMENT_TOPOLOGY.md`.

---

## ADR-033 — k6 as Primary Load Testing Tool

**Status:** Confirmed
**Decision:** k6 is the primary load testing tool. Artillery is secondary, used for YAML-defined smoke tests and WebSocket testing of Supabase Realtime subscriptions. Scenarios and thresholds are in `LOAD_TESTING.md`.
**Reason:** k6 scripts are JavaScript, matching the team's language. Thresholds are declarative, so pass/fail is unambiguous rather than a matter of reading graphs — which matters when load test results gate a launch. It runs in CI without a control plane and handles the Milestone 3 concurrency targets on modest hardware.
**Why load testing at all:** ZSMS load is extremely bursty and highly correlated — every school marks attendance in the same half hour, every school publishes results in the same fortnight. A test that averages load across a day proves nothing about the only moments that matter. Every scenario models a real, named school event.
**Alternatives considered:** JMeter (rejected — XML configuration, heavyweight, poor CI ergonomics); Gatling (rejected — Scala DSL, unfamiliar to the team); Locust (rejected — Python, adds a second language to the test stack); Artillery alone (rejected as primary — less precise threshold control at high concurrency, but retained for smoke and WebSocket work).
**Consequences:** Load tests run against staging only — never production, never `zsms-dev`. Each growth milestone in `SCALING.md` must pass its required scenario set before the corresponding launch gate. A failing threshold blocks the gate and is not waived without an ADR recording the accepted risk.

---

## ADR-034 — Context-Aware Navigational AI Assistant with Approval-Gated Writes

**Status:** Confirmed
**Decision:** The AI assistant is extended from a question-answering interface into a context-aware navigational assistant available to **every** user role. It knows the user's current page and section, can navigate to any part of ZSMS the user may access, can perform read operations, and can perform write/CRUD operations — but **every write is approval-gated: nothing is written without explicit user confirmation of a rendered preview.** All operations inherit the current user's RLS boundaries and permission grants without exception. Availability is country-customisable via feature flags. Specified in `AI_ASSISTANT.md`.
**Reason:** ZSMS spans a large surface — students, fees, attendance, results, timetables, communication, documents — and the users least able to navigate it are often the ones with the least training. A parent who can ask "what do I owe?" and be taken to the right screen is better served than one who must learn an information architecture. The same applies to a teacher entering marks under time pressure.
**Why writes are approval-gated without exception:** an LLM misinterpreting intent on a read operation shows the wrong screen. An LLM misinterpreting intent on a write operation marks the wrong student absent, records the wrong payment amount, or publishes unfinished results. The asymmetry is severe enough that no confidence threshold, no "safe" operation category, and no per-user preference is permitted to bypass confirmation. The assistant proposes; the user disposes.
**Why permissions are inherited rather than granted:** the assistant executes as the user, through the same RLS-enforced API layer as the UI. It holds no elevated capability. A user cannot reach data or actions through the assistant that they could not reach through the interface, which means the assistant adds no new authorisation surface to audit.
**Alternatives considered:** Read-only assistant (rejected — leaves the largest usability win unrealised); autonomous writes above a confidence threshold (rejected — confidence is not correctness, and the failure modes touch money and academic records); admin-only availability (rejected — parents and teachers benefit most).
**Consequences:** Every write intent requires a preview-and-confirm cycle, which is slower than direct manipulation and deliberately so. Write intents are logged to `audit_logs` with the originating natural-language request. Approval-gating is a security control, not a UX preference, and cannot be disabled by configuration.

---

## ADR-035 — BullMQ as the Default Job Queue Implementation

**Status:** Confirmed — supersedes the queue implementation choice in ADR-005
**Decision:** **BullMQ running on Railway workers is the default job queue implementation for ZSMS. QStash is the swappable fallback.** The queue abstraction in `packages/utils/queue` is unchanged and remains mandatory — only the default implementation changes. `JOB_QUEUE_PROVIDER` defaults to `bullmq` when unset.

**This ADR is the single source of truth for queue default selection.** `BULLMQ.md`, `QSTASH.md`, and `ARCHITECTURE.md` all reference it. If any document appears to state otherwise, this ADR governs and that document is wrong.

**Reason:**
- **Job priorities.** `SCALING.md` requires that bulk report card runs cannot starve payment confirmations. BullMQ supports priority and separate worker pools natively; QStash does not.
- **Concurrency control.** Per-worker concurrency and rate limiting (for example Meta's API limits) are configured directly on the worker.
- **Cost at volume.** Per-message pricing scales linearly with school count; a persistent worker does not (`COST_MANAGEMENT.md`).
- **Operational visibility.** Bull Board provides queue depth, retry history, and dead letter queue inspection in one view.
- **Tier 2 parity.** Self-hosted deployments (ADR-032) run BullMQ against local Redis — the same implementation, not a substitute. This removes an entire class of behavioural divergence between deployment tiers.

**What ADR-005 got right and what changed.** ADR-005 correctly identified that Supabase Edge Functions have a 50-second timeout and that background work needs a reliable queue with retry and scheduling. That reasoning stands. What changed is the implementation choice: ADR-005 named QStash for operational simplicity at launch, before job priority separation and Tier 2 parity were requirements. Both are now requirements, and both favour BullMQ.

**Alternatives considered:** Retaining QStash as default and adding BullMQ later (rejected — migrating a live queue is riskier than starting on the target implementation, and the abstraction means BullMQ costs nothing extra to adopt now); dropping QStash entirely (rejected — a fallback with no persistent-worker requirement is genuinely useful for constrained deployments and for Railway incidents).
**Consequences:** Railway workers and Redis are provisioned in Phase 0 of `BUILD_SEQUENCE.md` rather than being a later addition. Switching providers in either direction remains a one-line configuration change. When switching, cron schedules on the provider being left must be cancelled first — schedules active on both providers cause double dispatch.

---

## ADR-036 — Next.js 15 as the Web Framework Baseline

**Status:** Confirmed — supersedes the Next.js 14 pin recorded in `CHANGELOG.md` (2026-04-26)
**Decision:** **`apps/web` targets the Next.js 15.5 line, pinned at an exact patch version.** The App Router, the `packages/*` abstraction boundaries, and every other architectural decision are unchanged — this is a framework version decision only.

**Reason:**

The original stack selection named Next.js 14. Verification during the pre-Phase-1 cleanup showed that **the 14.x line no longer receives security backports.** Patching the December 2025 React Server Components advisory moved `apps/web` to `14.2.35` — the newest release the 14 line will get — and `npm audit` still reported roughly twenty-one further advisories against it, every one of them fixed only in `15.5.x` or later.

Several are directly relevant to a multi-tenant system whose isolation guarantees are the product:

| Advisory class | Fixed in |
|---|---|
| SSRF in rewrites via attacker-controlled destination hostname | 15.5.21 |
| SSRF in Server Actions on custom servers | 15.5.21 |
| Unauthenticated disclosure of internal Server Function endpoints | 15.5.21 |
| Cross-site scripting in App Router applications using CSP nonces | 15.5.16 |
| Cache poisoning in React Server Component responses | 15.5.16 |
| HTTP request smuggling in rewrites | 15.5.13 |

Cache poisoning and response-body confusion are the sharpest of these. ZSMS serves every school from one deployment, so a cached response crossing a tenant boundary is a data breach under the Zambia Data Protection Act 2021, with a 72-hour notification obligation (`COMPLIANCE.md`). RLS protects the database; it does not protect an HTTP cache.

**Timing.** The upgrade was taken while `apps/web` contained two routes and no business logic, before Phase 1. The cost of a framework major rises monotonically with the amount of application code built on it, and never falls.

**Version choice.** `15.5.23` — above the `15.5.21` threshold that clears every advisory listed above, and the newest patch on the line at the time of decision. Next.js 16 was considered and rejected for now: it is two majors from the specification, carries a larger reconciliation and breaking-change surface, and 15.5 already resolves every known advisory. Revisit before production launch.

**React version — `apps/web` moves to React 19.** This was not the original intent. Next.js 15.5 declares `^18.2.0 || ^19.0.0`, so React 18.3.x appeared viable, but the build failed while prerendering `/_error` with `Cannot read properties of null (reading 'useContext')` — the signature of two React copies in one bundle.

**The cause is npm hoisting, not application code.** The failing module was identified from the require stack:

```
node_modules/styled-jsx/dist/index/index.js        ← monorepo ROOT
  └─ next/dist/compiled/next-server/pages.runtime.prod.js
      └─ apps/web/.next/server/pages/_document.js
```

`styled-jsx` is a transitive dependency of `next`. npm hoists it to the **workspace root**, while `next` itself stays nested in `apps/web`. From the root, `styled-jsx` resolves `react` against the **root** `node_modules` — and the root held `react@18.3.1`, hoisted there because `apps/mobile` requires exactly that version for React Native 0.76. Prerendering `_document` therefore instantiated a second React, and the two instances shared no dispatcher.

The repository genuinely needs two React majors: Next.js 15's App Router expects 19, and React Native 0.76 pins 18.3.1. They cannot be reconciled by choosing one. What matters is **which version occupies the root slot**, because hoisted transitive dependencies resolve against it.

The fix declares `react` and `react-dom` at `19.2.8` in the **root** `package.json`. The root builds nothing; the entry exists solely to control hoisting. It puts `apps/web`, Clerk, and `styled-jsx` on one React instance, and nests Expo's 18.3.1 under `apps/mobile`. A scoped `overrides` entry additionally pins `@clerk/nextjs`'s `next` peer to `15.5.23`, so npm's automatic peer installation cannot place a second Next.js at the root.

**Three hypotheses were tested and rejected before this one**, each by experiment rather than reasoning: React major mismatch (the build failed with 18 *and* 19 in `apps/web`); `transpilePackages` pulling `packages/auth-provider` into the bundle (removing it changed nothing, and `apps/web` imports only `@zsms/config`); and a mismatched SWC binary (the `@next/swc` warning proved to be a benign hoisting artifact, correct at `15.5.23`). A pristine Next.js 15.5.23 + React 19.2.8 application outside the monorepo built cleanly, which localised the fault to the dependency tree rather than the framework.

**The general lesson:** in an npm workspace, a hoisted transitive dependency resolves its own peers against the root, not against the workspace that owns it. Where two majors of a framework-coupled library must coexist, the root slot is a deliberate architectural choice — not something to leave to npm's resolution order. Revisit when React Native supports React 19; the whole repository can then share one version and both entries can be removed.

**Alternatives considered:** Remaining on `14.2.35` and accepting the open advisories (rejected — the exposure is permanent, since no fix will ever be backported, and the affected classes are exactly those that breach tenant isolation); jumping to Next.js 16.3.x (rejected for now — no additional security benefit over 15.5.23, at higher migration cost).
**Consequences:** `ARCHITECTURE.md`, `THIRTEEN_LAYER_COMPLIANCE.md`, and `CLAUDE.md` are updated to state Next.js 15. Phase 1 work must follow Next.js 15 conventions — most importantly that `cookies()`, `headers()`, `draftMode()`, `params`, and `searchParams` are **asynchronous** and must be awaited, and that `fetch` and `GET` route handlers are **no longer cached by default**. The Phase 0 scaffold used none of these APIs, so the upgrade required no code changes. The exact patch version stays pinned; `npm audit` is checked against `next` at every phase boundary.

---

## ADR-037 — Scope-Based Teaching Assignment Model

**Status:** Confirmed — replaces the undefined `class_enrolments` and supersedes `staff_assignments`
**Decision:** **A teacher's relationship to students is expressed by `public.teacher_assignments`, a single table carrying a `scope` field with two values — `'class'` and `'subject'` — where every row carries `class_id` regardless of scope.** `public.class_subjects` records which subjects a class is taught. RLS resolves teacher reach through one `SECURITY DEFINER` predicate, `teacher_reaches_class()`, which returns TRUE for an assignment at either scope.

**Reason:**

Four documents — `RLS.md`, `ASSIGNMENTS.md`, `POWERSYNC.md`, `OFFLINE_SYNC.md` — resolved a teacher's students through `public.class_enrolments`. That table had no `CREATE TABLE` in `DATABASE.md`, no entry in `SCHEMA.md`'s inventory, and no migration in `MIGRATIONS.md`. It was a reference with nothing behind it.

The obvious repair — match `students.class_id` directly — is correct for a primary school, where one teacher owns one class, and wrong for a secondary school, where a subject teacher reaches many classes and a class is reached by many teachers. Zambia's private schools include both, and the 2023 reform leaves many mid-transition (`ZM.md`), so a school may be both at once across different grade bands.

**Why `scope`, rather than two tables or a school-type flag:**

- **A school-type flag would be a branch in security code.** `IF school.type = 'primary' THEN ... ELSE ...` inside an RLS predicate means two code paths, one of which is exercised far less often, both of which must stay correct. The shape of a school is data; it should not be a code path.
- **Two tables — `class_teachers` and `subject_teachers` — would need a UNION in every policy** and would make "does this teacher reach this student" two lookups that can disagree. One table with a discriminator keeps the predicate a single `EXISTS`.
- **Both scopes carrying `class_id` is the load-bearing detail.** It is what allows `teacher_reaches_class()` to ignore `scope` entirely. Adding a third scope later — a head of department reaching a whole grade, say — changes the helper only if that scope does not resolve to a set of classes.

**Constraint, not convention.** `teacher_assignment_scope_shape` enforces that `scope='class'` carries no subject and `scope='subject'` carries one. This is a security control: a `scope='subject'` row with a NULL `subject_id` would read to the predicate as an assignment reaching the entire class, silently widening that teacher.

**Write access is owner and principal only.** Teacher reach is derived from this table, so a teacher able to insert their own row could grant themselves any class's students. The pgTAP suite asserts this directly.

**`students.class_id` is unchanged** and remains the student's home or registration class. Nothing about enrolment moves into these tables.

**Alternatives considered:** defining `class_enrolments` as originally referenced (rejected — a student-to-class join table duplicates `students.class_id` and creates two answers to which class a student is in); a `teacher_class_subjects` table with a nullable `subject_id` and no `scope` field (rejected — the nullable column becomes the discriminator implicitly, with nothing preventing a row that means neither thing clearly); keeping `staff_assignments` and adding `is_class_teacher` semantics to RLS (rejected — `is_class_teacher` is an attribute of an assignment, not a scope, and a row with `is_class_teacher = TRUE` still names a single subject).

**Consequences:** `teacher_read_assigned_students` is repointed at `teacher_reaches_class()` in migration `0021`, and `teacher_assigned_to_class()` — the interim helper from `0016` — is dropped so that only one predicate answers this question. `staff_assignments` is marked superseded and retained; it should be dropped in a dedicated migration once `ASSIGNMENTS.md` and the timetable module reference `teacher_assignments` only. The timetable, marks, and attendance modules in Phase 2 build on `teacher_assignments` and `class_subjects` rather than inventing their own scoping. The pgTAP isolation suite covers both scopes, the mixed case, and — the assertion that matters — that a subject teacher cannot see students in a class they do not teach.

---

## ADR-038 — Derived Arrears, Never Enforced

**Status:** Confirmed
**Decision:** **Outstanding fee balances are DERIVED from `public.fee_records`, never materialised as carry-forward rows, and the model computes and exposes only — it never gates any action.** `student_fee_balance` and `fee_record_status` are `security_invoker` views; `fee_statement()` renders a ledger with a computed *"Balance brought forward"* opening line.

**Reason:**

Before this decision, fee records existed per term with no cumulative view. Prior-term rows persisted, so debt did not reset — but there was no arrears concept at all: no linkage between terms, no running balance, no overdue signal, and no endpoint answering *"what does this student owe?"*. `GLOSSARY.md`, `PDF_GENERATION.md`, and `CHATBOT.md` all already promised a running balance the schema could not produce.

**Derived, not brought-forward rows.** Writing a *"Balance brought forward"* line into each new term is how a bursar's ledger reads, and it was the tempting design. It double-counts the moment the original record still exists, and reconciling that requires settlement logic that can itself drift — two rows now claim the same debt, and any bug makes a family's balance wrong in a way nobody can reconstruct. `fee_records` stays the single source of truth; the brought-forward line is emitted by `fee_statement()` at render time. **One truth in the data, ledger-style on the page.**

**`security_invoker` is load-bearing.** A PostgreSQL view runs with its *owner's* privileges by default, which would bypass RLS on `fee_records` entirely and show every parent every family's balance. Every view here sets `security_invoker = true`, and the isolation suite attacks that specific failure.

**Overdue is a separate axis from payment progress.** `status` means how much has been paid; `is_overdue` / `days_overdue` / `arrears_amount` are derived from `due_date`. Adding `overdue` to the status enum would conflate the two and break the balance trigger's state machine — a record can be `partial` and overdue, or `partial` and not yet due, and both are meaningful.

**Carry-forward spans terms AND academic years, and survives status changes.** Zambian school debt does not wipe at a year boundary, so `student_fee_balance` has no year filter. It also does not filter on `students.status`: a transferred, graduated, or alumni student keeps a visible balance, because schools withhold transfer letters and certificates until it is cleared. Hiding the balance when the status changed would make the debt disappear from exactly the screens that need it.

**THE MODEL NEVER ENFORCES.** Nothing here refuses a result, a certificate, a transfer letter, or a re-registration because a balance is outstanding. In Zambia arrears commonly *do* gate those things — which is precisely why it must be a **per-school setting, admin-configurable and OFF by default**, rather than behaviour welded into the schema. A school that does not withhold results must not inherit the behaviour of one that does. That setting is not built here; when it is, it reads these columns and decides. The suite asserts that publishing results succeeds while a student is in arrears, so a future gate cannot be added silently.

**Allocation is oldest-first by default and overridable.** `payments.fee_record_id` names one record, so a lump sum — the normal shape of mobile money, a bank transfer, or cash at the office — had no representation. `suggest_payment_allocation()` proposes an oldest-first split for one-tap acceptance; `allocate_payment()` accepts an explicit override. **The override is not a convenience.** Clearing the current term so a child can sit an exam while an older disputed amount stays open is a legitimate bursar instruction, and a system that silently swallowed that payment into the disputed debt would be wrong.

**Revision is a distinct act.** `generate_fee_records()` is idempotent by `ON CONFLICT DO NOTHING`, which prevents double-billing but also silently blocked correcting a mis-keyed fee on an already-generated term. `revise_fee_records()` is the explicit path: it refuses to drop a fee below what has already been verified as paid, audits every change to `fee_record_revisions`, and re-derives status.

**Loan linkage is enabled, not built.** `records_overdue`, `days_overdue`, `payments.paid_at`, and `fee_records.due_date` are the raw material a fee-payment reliability signal would need (`BEHAVIOUR_SCORE.md`). No loan coupling is created here; it is simply not precluded.

**Alternatives considered:** materialised brought-forward rows (rejected — double-counting, as above); a stored `balance` column on `students` (rejected — a denormalised money total that must be kept in step with every payment, discount, and revision is a drift bug waiting to happen, and the trigger surface would be large); adding `overdue` to the `status` enum (rejected — conflates progress with time); auto-allocating lump sums oldest-first with no override (rejected — removes a decision that is legitimately the bursar's).

**Consequences:** `GLOSSARY.md`, `PDF_GENERATION.md`, and `CHATBOT.md` now describe something the schema can produce. Phase 3 fee reminders read `arrears_amount` and `days_overdue` rather than recomputing them. Any future arrears gating is a separate, school-configurable feature and must not be added to these views or functions.

---

## ADR-039 — AI-Assisted Capture as a Planned Phase 4/5 Module

**Status:** Planned — design recorded, **not built**
**Decision:** **Teachers will be able to photograph paper mark sheets, registers, enrolment lists, and payment proofs; a queued vision-extraction job pre-fills a verification screen; and only teacher-approved data is written, through the existing RLS-gated APIs.** The module is credit-priced, with every limit and rate in dynamic configuration. Full design in `18 AI Module/AI_CAPTURE.md`.

**Reason:**

Zambian teachers mark on paper. Transcription into ZSMS is the slowest and most error-prone part of the workflow, and it is the single largest barrier to the data completeness that gates the analytics and assistant features (`AI_OVERVIEW.md` — systems 1 and 2 unlock at ≥70% completeness). Removing the typing without removing the teacher is the highest-leverage AI application in the product.

**Assist, never autopilot.** Every extracted value is a draft. There is no confidence level, setting, or role that permits a direct write — the module inherits ADR-034's approval gate exactly. A mark written to the wrong student surfaces weeks later via a parent, after the report card has issued; the asymmetry between the cost of a wrong write and the cost of a second look is not close.

**Context-anchored matching is the reason this is feasible.** Handwriting recognition against an open vocabulary is unreliable; recognition against a known roster of about thirty names is a constrained match. Extraction always runs inside a context the teacher already occupies — this class, this term, this subject — and matches only against that class's roster, resolved through `teacher_reaches_class()` (ADR-037). **The roster is never widened to the whole school to find a match**, because that is precisely how a mark lands on a same-named child in another grade. It is also a privacy control: the roster leaves the system in the prompt, so it must be the minimum set.

**Credit-priced, because the cost is per use.** Each capture is a vision-API call. Metering it inside a flat subscription tier would either subsidise heavy users or cap the feature below usefulness. Trial allowance, school purchase, individual purchase, and per-capture rates are all `afritech` configuration per ADR-031 — hardcoding any of them would make a pricing correction a release.

**Individual purchase is deliberate.** A teacher at a school that has not bought capture, and a standalone Teacher Hub user with no school at all, both need a path that does not depend on an institutional budget.

**Balance is derived from an append-only ledger**, not stored as a mutable column — the same reasoning as ADR-038's derived arrears.

**Compatibility confirmed, not assumed.** The Phase 2 marks and attendance schema was assessed against this flow. Drafts never enter domain tables; the existing unique keys already make repeated approval idempotent; `entered_by_user_id` correctly names the approving teacher rather than the model; and the payments verification workflow is already the right shape for payment-proof capture. **No schema change is required now.** Two changes land with the module: an added `sync_source` value, and an optional `source_capture_id` for provenance that cannot be backfilled.

**Alternatives considered:** direct write above a confidence threshold (rejected — creates a class of error nobody reviews, and the threshold would inevitably be tuned down under time pressure); matching against the full student body (rejected — the accuracy gain is illusory and the failure mode is cross-grade misattribution); bundling capture into a subscription tier (rejected — transfers all volume risk to AfriTech and caps a metered feature at a flat price); building it in Phase 3 (rejected — it depends on BullMQ workers and on marks/attendance being settled, and it is not on the launch path).

**Consequences:** `DYNAMIC_CONFIG.md` gains the capture-credit keys. `BUILD_SEQUENCE.md` lists the module in Phase 4/5. `PRICING.md` gains a usage-based revenue line alongside subscription tiers, and `COST_MANAGEMENT.md` must track cost-per-capture as a first-class metric once live — the credit price has to clear the vision-API cost with headroom for a provider price change. A pilot against real Zambian mark sheets is required before pricing is fixed, since the credit price depends on the retry rate.

---

## ADR-040 — Multi-Country Config Hardening (Deferred)

**Status:** Open — deferred. **Decide when a second country becomes real.**
**Decision:** **Recorded, not resolved.** Several schema constraints encode Zambia/Cambridge assumptions that contradict ADR-031's dynamic-configuration principle. They are catalogued here so the debt is visible and costed rather than rediscovered mid-expansion.

**What is genuinely config-driven today** — and should not be disturbed:

- Grading scales: `school_grading_scales.grade_bands` is JSONB, so a school defines its own bands, pass mark, and credit mark.
- `exam_results.grade_letter` (TEXT) and `grade_points` (INT) are **scale-agnostic** — no Zambian grading is baked into the results table.
- Grade and form structures: `school_grade_levels` is per school, supporting ECZ grades, Cambridge forms, and the transitional both-at-once case (`ZM.md`).
- Class identifiers, report-card format, subject lists, and `marks_total` are all per school.

**What is hardcoded** — each requires a migration to admit another country's system:

| Column | Constrained to | Table(s) |
|---|---|---|
| `curriculum_type` | `ecz_grades`, `cambridge_forms`, `hybrid`, `custom` | `school_academic_config` |
| `grading_system` | `ecz_percentage`, `cambridge_o_level`, `cambridge_a_level`, `custom` | `school_academic_config` |
| `examination_type` | `ecz`, `cambridge`, `internal`, `none` | `school_grade_levels` |
| `curriculum_type` | `ecz`, `cambridge`, `both` | `school_subjects`, `reference_subjects_zm` |
| `level_type` | `primary` / `secondary` / `a_level` (+ junior/senior variants) | 3 tables |
| `term_number` | `BETWEEN 1 AND 4` | `fee_structures`, `fee_records`, `attendance_records`, `exam_results` |

Also: **`reference_subjects_zm` bakes the country into the table name** even though it carries a `country_code` column and a uniqueness key that already spans countries. The schema supports multi-country; the name implies one table per country.

**Why this is deferred rather than fixed now.** The `custom` escape hatch means a new market is not blocked — it is degraded. A Kenyan school on CBC, or anywhere running two semesters rather than three or four terms, would either be forced into `custom` (losing the semantic value of the field) or wait for a migration. That is a real cost, but it is a cost paid once per country, and paying it now would mean designing a configuration vocabulary against a single known market — which usually produces the wrong abstraction. **The second country is what will reveal the right shape.**

**What to do when that happens** — in preference order: promote the constrained values into `afritech` reference tables keyed by `country_code` (consistent with ADR-031); or, if only one or two markets are ever in scope, extend the CHECK constraints and accept the migration. Do **not** relax the constraints to free text without a reference table — the CHECKs are currently the only thing preventing a typo becoming a silently unmatched curriculum.

**`term_number BETWEEN 1 AND 4` deserves separate thought.** It is a ceiling rather than a country assumption, and four accommodates every configuration currently documented. It is listed because it is still a hardcoded bound on an axis that varies by education system, not because it is known to be wrong.

**Consequences:** No code changes now. `CLAUDE.md` carries this as a tracked open item. Any Phase 3+ work that adds a country-shaped enum should add it to this list rather than assuming it is fine.

---

## ADR-041 — Grading Scale Versioning for Exam Results (Open Data-Integrity Gap)

**Status:** Open — **must be resolved before results are relied on long term.** Not a multi-country concern; it affects a single Zambian school.
**Decision:** **Recorded as a defect, not yet fixed.** `public.exam_results` stores `grade_letter` and `grade_points` but no reference to the grading scale that produced them. A school that revises its scale mid-year makes every historical grade unexplainable.

**The problem, concretely.** A school grades on ECZ percentages where 75 is a `B`. In Term 2 the board revises the bands and 75 becomes an `A`. `exam_results` now holds Term 1 rows saying `B` and Term 2 rows saying `A` for the same mark, with **nothing recording that the rule changed**. Nobody can answer *"why is this a B?"* — and a parent disputing a report card is asking exactly that. Recomputing from `marks_obtained` against the current scale silently rewrites history; not recomputing leaves two inconsistent letters with no explanation.

**This is a solved problem elsewhere in ZSMS.** `afritech.score_config` versions loan scoring precisely so that a historical behaviour score remains explainable after weights change, and a loan application records the `config_version` it was scored under (ADR-020). Results need the same treatment and did not get it.

**Sketch of the fix** (not built, and the shape is not final):

- Version `school_grading_scales` — either a `version` column with the scale immutable once used, or a separate `school_grading_scale_versions` table holding the bands.
- Add `grading_scale_version_id` to `exam_results`, populated at mark-entry time.
- Treat a scale in use as immutable: a revision creates a new version rather than editing bands in place, exactly as the loan score config does.
- Backfill is impossible for rows written before the column exists, which is the argument for doing this **before** a school accumulates a year of results.

**Why it is not fixed in this pass.** It changes the marks-entry write path and needs a decision on whether published results are ever recomputed — a product question, not a schema one. It is recorded here so it is not rediscovered when a parent disputes a grade.

**Consequences:** Flagged in `CLAUDE.md` as an open data-integrity item. Should be scheduled before the first cohort's results are treated as a permanent record — realistically before Phase 6 pilot, and certainly before any school completes a full academic year in ZSMS.
