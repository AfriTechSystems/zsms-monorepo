# ARCHITECTURE.md — System Architecture

## Related Documents

- `01 Foundation Layer/DECISIONS.md` — ADRs explaining why each architecture decision was made
- `01 Foundation Layer/THIRTEEN_LAYER_COMPLIANCE.md` — layer-by-layer audit of this architecture
- `01 Foundation Layer/DYNAMIC_CONFIG.md` — the configuration registry underpinning feature and pricing behaviour
- `01 Foundation Layer/BUILD_SEQUENCE.md` — the order in which this architecture is built
- `01 Foundation Layer/ENV.md` — environment variables per layer
- `01 Foundation Layer/DATABASE.md` — full database schema
- `03 Infrastructure Services/DEPLOYMENT_TOPOLOGY.md` — three-tier hosting model
- `03 Infrastructure Services/HOSTING_STRATEGY.md` — how a country is assigned to a tier
- `03 Infrastructure Services/SCALING.md`, `CACHING_CDN.md`, `AVAILABILITY.md`, `COST_MANAGEMENT.md` — cross-cutting infrastructure layers
- `03 Infrastructure Services/SUPABASE.md`, `CLERK.md`, `VERCEL.md`, `R2.md`, `BULLMQ.md`, `POWERSYNC.md`

---

## Purpose

This document gives a complete picture of how ZSMS is built — every layer, every service, how they connect, and the key design decisions that shape the architecture. Read this before starting any new Claude Code session.

---

## High-Level Architecture

ZSMS is a **modular monolith** with a serverless execution layer and event-driven edges. It is explicitly not microservices. The monorepo (Turborepo) provides logical separation between packages without deployment complexity.

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                             │
│                                                                   │
│  Next.js Web App         React Native / Expo     Teacher Hub     │
│  (school portal,         (teacher attendance,    (standalone     │
│   parent portal,          parent mobile app,      teacher tools, │
│   admin panel)            offline-capable)        lesson planner)│
└───────────────────────────┬──────────────────────────────────────┘
                             │ HTTPS / JWT (Clerk)
┌───────────────────────────▼──────────────────────────────────────┐
│                         API LAYER                                 │
│                                                                   │
│  Next.js API Routes (server-side, Vercel Edge Network)           │
│  Supabase Edge Functions (Deno, for heavy operations)            │
│  Rate limiting: Upstash Redis                                     │
└───────────────────────────┬──────────────────────────────────────┘
                             │
┌───────────────────────────▼──────────────────────────────────────┐
│                       DATA LAYER                                  │
│                                                                   │
│  Supabase PostgreSQL       Upstash Redis          Cloudflare R2  │
│  (primary DB, RLS,         (rate limiting,        (file storage, │
│   pgvector for AI)          feature cache)         two buckets)  │
│                                                                   │
│  Railway PostgreSQL (standby replication from Supabase)          │
└─────────────────────────────────────────────────────────────────┘

Edge (all inbound traffic):
  Cloudflare WAF + CDN → Vercel (origin restricted to Cloudflare IPs)

Background:
  Queue abstraction → BullMQ workers on Railway (default, ADR-035)
                    → QStash (swappable fallback)
                    → PDF generation, WhatsApp, imports, integrations
  PowerSync → Mobile offline sync (teacher device ↔ Supabase)
```

### Layer compliance

This architecture is audited against a thirteen-layer model in `THIRTEEN_LAYER_COMPLIANCE.md`, which maps every layer to its implementation, names the owning document, and flags thin coverage. That audit is re-run at every phase gate in `BUILD_SEQUENCE.md` and is the architectural half of the SOC 2 and ZICTA asset inventory.

---

## Monorepo Structure

```
AfriTechSystems/zsms-monorepo/
├── apps/
│   ├── web/                    Next.js 14 App Router — school portal, parent portal, admin panel, Teacher Hub
│   └── mobile/                 React Native / Expo — teacher attendance, parent app
├── packages/
│   ├── auth-provider/          Clerk wrapper — abstracted for future self-hosted swap (Keycloak)
│   ├── utils/                  Shared pure functions — grading, behaviour score, formatting, ID generation
│   ├── types/                  Shared TypeScript types generated from Supabase schema
│   └── config/                 Country configs, feature flag keys, constants
└── supabase/
    ├── migrations/             SQL migration files (0001_*.sql to 0065_*.sql)
    ├── functions/              Supabase Edge Functions (Deno)
    ├── seed/                   Development seed data scripts
    └── tests/                  pgTAP RLS tests
```

The `packages/auth-provider` abstraction is the key to future self-hosted deployments — Clerk is the current implementation but the interface is swap-compatible with Keycloak. No other package imports Clerk directly.

---

## Authentication Architecture (Clerk)

```
User logs in (email OTP)
→ Clerk issues JWT
→ JWT contains: sub (Clerk user ID), org_id (school's Clerk org), org_role, metadata
→ JWT verified by Next.js middleware on every request
→ Supabase receives JWT as Authorization header
→ Supabase RLS helper functions extract school_id and role from JWT claims
→ RLS enforces data isolation at query time
```

**Roles hierarchy:**

| Level | Role | Access |
|---|---|---|
| Platform | `afritech:super_admin` | Everything across all schools |
| Platform | `afritech:regional_manager` | Assigned countries/schools |
| Platform | `afritech:support_agent` | Assigned schools (read-only by default) |
| Platform | `afritech:loan_officer` | Loan module portfolio |
| Platform | `afritech:finance_officer` | AfriTech revenue data |
| Platform | `afritech:developer` | Staging + time-limited production access |
| Platform | `platform:teacher` | Standalone Teacher Hub (no school affiliation) |
| Platform | `platform:alumni` | Historical read-only access to own records |
| School | `org:owner` | Full school access |
| School | `org:principal` | Academic operations |
| School | `org:accountant` | Fees and payments |
| School | `org:teacher` | Own classes only |
| School | `org:staff` | Base role for custom-role holders (zero default access) |

Custom school roles are defined in `public.school_custom_roles` and applied to `org:staff` base users.

---

## Multi-Tenancy Model

Every school is a separate Clerk organisation. Every database table with school-scoped data has a `school_id` column with an RLS policy that filters to the authenticated user's school.

```sql
-- Example RLS policy on students table
CREATE POLICY "Students: school members only"
  ON public.students
  FOR ALL
  USING (school_id = get_school_id());  -- get_school_id() reads from JWT

-- Extracts school_id from Clerk JWT metadata
CREATE OR REPLACE FUNCTION get_school_id() RETURNS uuid AS $$
  SELECT COALESCE(
    current_setting('request.jwt.claims', true)::jsonb -> 'user_metadata' ->> 'school_id',
    current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'school_id'
  )::uuid
$$ LANGUAGE sql STABLE;
```

No query ever returns data from a different school — even if the application layer has a bug, the database refuses.

---

## Feature Toggle and Billing Architecture

All subscription pricing and feature availability is database-driven. No tier prices or feature inclusions are hardcoded.

```
School makes a request requiring Feature X
             ↓
    schoolHasFeature(schoolId, featureKey)
             ↓
    Check Redis cache (5-min TTL)
    Cache miss → resolve from DB:
             ↓
    1. Is subscription active?
       (check schools.status + extend_subscription override)
             ↓
    2. Is there a REVOKE override? → deny
    3. Is there a GRANT override? → allow
    4. Is there a TIER OVERRIDE? → use override tier
    5. Active module_subscription? → allow
    6. Check afritech.tier_features → allow/deny
             ↓
    Cache result in Redis
```

**Pricing tables (all in `afritech` schema):**
- `subscription_tiers` — tier prices, student limits, WhatsApp quotas
- `feature_flags` — all toggleable features with add-on prices
- `tier_features` — feature matrix (which tier includes what)
- `school_feature_overrides` — per-school exceptions (grant, revoke, extend, tier override)

Super admins change any of these from the admin panel. The pricing page at zsms.co.zm/pricing reads from these tables with 5-minute ISR revalidation.

---

## Teacher Hub Architecture

ZSMS serves two distinct product lines from the same codebase:

**Product 1 — ZSMS for Schools**
School management system. Accessed via school portal after org:* Clerk role. Routes under `/school/[school-id]/...`.

**Product 2 — ZSMS Teacher Hub**
Standalone teacher productivity tools. Accessed via `platform:teacher` Clerk role. Routes under `/teacher/...`. No school affiliation required.

**Dual-context navigation for linked teachers:**
When a teacher has both a standalone account and a school membership, the top navigation shows both contexts — "My Tools" (personal Teacher Hub) and the school name (school dashboard). Switching between contexts is a client-side context change, not a new login.

**Account linking flow:**
School admin invites teacher by email → ZSMS detects existing standalone account → Clerk org membership added → `standalone_teacher_accounts.linked_school_id` set → Teacher's existing lesson plans remain accessible → Teacher now has dual context navigation.

---

## Offline Architecture (PowerSync)

The teacher mobile app is offline-first. Teachers mark attendance and enter marks without internet. PowerSync handles bidirectional sync with Supabase.

```
Teacher device (React Native + PowerSync local SQLite)
         ↑↓ sync when connected
Supabase PostgreSQL (primary)
         ↑↓ replication
Railway PostgreSQL (standby)
```

**Sync rules:** Only the teacher's assigned classes and their subjects sync to their device. A teacher with 3 classes syncs approximately 120 student records, 14,400 attendance records, and 30 timetable slots — approximately 1MB, syncing in under 30 seconds on 3G.

**Conflict resolution:** PowerSync uses last-write-wins with server authority. If a teacher marks a student absent offline and the same student is later marked present by another teacher while offline, the server's record at sync time wins.

---

## AI Module Architecture

Four distinct systems — only Systems 2 and 3 involve LLM calls:

```
System 1: Smart Analytics
  SQL aggregations → visualisations (no LLM, no cost per query)

System 2: AI Assistant
  User question → Intent extraction (Claude) → ZSMS API (RLS-enforced)
  → Structured data → Narration (Claude) → Response
  Cost: ~$0.003 per interaction. Rate limited: 100/school/day.

System 3: Lesson Planner (RAG)
  Teacher request → Query embedding → pgvector similarity search
  → Curriculum context → Claude generation → Lesson plan
  Knowledge base: ECZ syllabuses, Cambridge specs, MESVTEE framework
  Available to: school-linked teachers AND standalone platform:teacher accounts

System 4: Predictive Intelligence (Phase 4)
  Requires 18+ months data, 50+ schools, data scientist
  Do not build before Phase 4
```

**Data quality gate:** AI insights (Systems 1 and 2) require >= 70% data completeness score. Below 50% locks AI insights. Calculated fresh on every page load. System 3 (Lesson Planner) has no school data dependency.

---

## Integrations Architecture

Three tiers of external system connectivity:

**Tier 1 — Native Webhooks (Phase 1, already built)**
`school_webhooks` table. Any webhook-capable system connects. HMAC-signed payloads. No AfriTech maintenance required per integration.

**Tier 2 — Pre-Built Connectors (Phase 2)**
`school_integrations` table. OAuth-based connectors for Sage Business Cloud, QuickBooks, Xero, Google Sheets, HubSpot. ZSMS translates events into each system's native API format. Async dispatch via the queue — integration failures never block school operations.

**Tier 3 — Zapier/Make (Phase 3)**
Published Zapier app exposing all ZSMS events and actions. Schools connect ZSMS to 5,000+ apps without AfriTech building individual connectors.

---

## Data Residency Architecture

Three-layer approach to ZDPA compliance:

**Layer 1 — Substantive personal data in Southern Africa**
All academic records, financial records, attendance, and exam results live in Supabase `af-south-1` (South Africa). POPIA (South African data protection law) is recognised as adequate under the ZDPA. This is the primary legal basis for data stored outside Zambia.

**Layer 2 — Authentication credentials in US (Clerk) with DPA**
Names, emails, and phone numbers flow through Clerk (US). Covered by a Data Processing Agreement equivalent to GDPR standard terms. Authentication infrastructure is universally accepted as a specialist provider activity — regulators do not classify this the same as substantive personal data.

**Layer 3 — Self-hosted option for regulated markets**
For countries mandating strict local data hosting, ZSMS deploys self-hosted: Supabase self-hosted (local VPS), MinIO (replaces R2), Keycloak (replaces Clerk), and BullMQ against a local Redis — the same queue implementation as the default deployment, only a different connection string. The `packages/auth-provider` abstraction makes the auth swap a configuration change. Country partners operate the local infrastructure; AfriTech provides software, updates, and support.

---

## Deployment Topology

The residency layers above are realised through three deployment tiers, specified in full in `DEPLOYMENT_TOPOLOGY.md`:

| Tier | Model | Operated by | Used when |
|---|---|---|---|
| **1 — Central public cloud** | Vercel, Supabase, Clerk, Upstash, R2 | AfriTech | Default — cross-border transfer to an adequate jurisdiction is permitted |
| **2 — Per-country self-hosted** | Supabase self-hosted, Keycloak, BullMQ/Redis, MinIO on local VPS | Country partner | Only when local storage is legally mandated and no adequacy route exists |
| **3 — Central encrypted backup vault** | Encrypted daily exports, per-country keys | AfriTech (ciphertext only) | Always, alongside Tier 1 and Tier 2 |

Tier selection is a documented compliance decision made once per country before any infrastructure is provisioned — the process is in `HOSTING_STRATEGY.md`. Public cloud is the default; self-hosting is accepted only on a written legal opinion, never on customer preference.

**Three abstractions make tier selection a configuration decision rather than a fork:** `packages/auth-provider` (Clerk ↔ Keycloak), the queue abstraction (BullMQ in both tiers — only the Redis connection string differs), and the S3-compatible storage interface (R2 ↔ MinIO). Schema, RLS policies, and migrations are identical across all tiers. If application code can tell which tier it is running in, an abstraction has leaked.

---

## PDF Generation Architecture

```
Bulk report card generation request
→ queued job queued (35-student batches run in parallel)
→ Edge Function: fetch student data + load template config
→ Load fonts from R2 (once per batch, not per student)
→ Load school logo as base64 data URL (once per batch)
→ For each student: renderToBuffer(@react-pdf/renderer)
→ Upload PDF buffer directly to R2 (no disk write)
→ Update report_generation_jobs progress
→ Realtime subscription in browser updates progress bar
Target: 400 students in under 90 seconds
```

---

## WhatsApp Architecture

Two delivery modes — selected per school:

**Mode A — AfriTech Shared Number (default)**
`schools.whatsapp_owns_number = FALSE`
All messages dispatched using AfriTech's Meta WABA credentials from environment variables. All schools share the same sending number but each school's messages are scoped to their parent audience.

**Mode B — School-Specific Number**
`schools.whatsapp_owns_number = TRUE`
The Edge Function reads `schools.whatsapp_phone_number_id` and decrypts `schools.whatsapp_access_token_enc` to dispatch using the school's own Meta credentials. Messages appear from the school's own number. School manages their own Meta quota.

Fallback chain: WhatsApp → Email (Resend) → SMS (Twilio, critical messages only).

---

## Async Job Architecture (Queue Abstraction)

All background work goes through the queue abstraction in `packages/utils/queue`. **BullMQ on Railway is the default implementation; QStash is the swappable fallback (ADR-035).** Application code never imports either client directly — see `BULLMQ.md`.

```
Trigger (API route or webhook)
→ getQueue().enqueue(jobType, payload)   ← IDs only, no PII in queue
→ Queue delivers to worker
    · BullMQ (default): persistent Railway worker, priority-aware
    · QStash (fallback): HTTP delivery to Edge Function endpoint
→ Worker fetches full data by ID
→ Processes job
→ On failure: retry with exponential backoff (30s, 5m, 30m)
→ After 3 failures: Dead Letter Queue → manual retry from admin panel
```

Job priority separation — bulk report card runs must not starve payment confirmations — is specified in `SCALING.md` and is one of the reasons BullMQ is the default.

Jobs: PDF bulk generation, WhatsApp dispatch, bulk import processing, fee reminders, integration event dispatch, scheduled announcements, override expiry checks, platform metrics calculation, RAG embedding pipeline.

---

## Multi-Country Architecture

One codebase, one Turborepo monorepo. Per-country configuration:

```
packages/config/countries/
  ZM.ts    ← Zambia (active)
  BW.ts    ← Botswana (future)
  ZW.ts    ← Zimbabwe (future)
```

Per-country isolation:
- Supabase project per country (independent database)
- Vercel deployment per country (`zsms-zm`, `zsms-bw`)
- R2 buckets per country (`zsms-public-zm`, `zsms-private-zm`)
- `NEXT_PUBLIC_COUNTRY_CODE` environment variable selects the active country
- School IDs prefixed with country code (`ZM-LSK-0001`, `BW-GAB-0001`)

---

## Key Architecture Decisions Summary

| Decision | Choice | Why |
|---|---|---|
| Monolith vs microservices | Modular monolith | Solo developer — operational simplicity |
| Auth provider | Clerk (abstracted) | Multi-tenant org management out of the box |
| Database | Supabase PostgreSQL + RLS | Security at DB layer, not app layer |
| Mobile offline | PowerSync | Core requirement — Zambian connectivity |
| File storage | Cloudflare R2 (2 buckets) | No egress fees, sensitive/public separation |
| Async jobs | Queue abstraction, BullMQ default (ADR-035) | Job priorities, concurrency control, cost at volume, Tier 2 parity |
| Pricing | Database-driven | No code deploy needed for price changes |
| Configuration | Database-driven registry (ADR-031) | Business parameters change without deployment |
| Deployment | Three-tier topology (ADR-032) | Public cloud default, self-hosted only when legally forced |
| Auth abstraction | packages/auth-provider | Clerk today, Keycloak tomorrow if needed |
| AI architecture | Four distinct systems | Statistical analytics ≠ LLM ≠ RAG ≠ ML |
| Lesson planner | RAG not generic LLM | Zambian curriculum knowledge base is the moat |
| Integrations | Three-tier | Webhooks now, connectors Phase 2, Zapier Phase 3 |

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Pre-development architecture reference |
| 2026-04-26 | Added feature toggle billing architecture | Dynamic pricing system confirmed |
| 2026-04-26 | Added Teacher Hub product line | Standalone teacher B2C product confirmed |
| 2026-04-26 | Added AI module four-system architecture | AI stage designed and documented |
| 2026-04-26 | Added integrations three-tier architecture | CRM and accounting integrations confirmed |
| 2026-04-26 | Added data residency three-layer strategy | ZDPA compliance approach confirmed |
| 2026-04-26 | Added self-hosted option for regulated markets | Countries requiring local data hosting |
| 2026-04-26 | Added per-school WhatsApp mode selection | School-specific WhatsApp numbers confirmed |
| 2026-08-13 | Added Cloudflare WAF to the stack diagram | WAF layer existed in CLOUDFLARE_WAF.md but was omitted here |
| 2026-08-13 | **Queue section rewritten — BullMQ is the default, QStash the fallback** | ADR-035; supersedes the QStash-first description |
| 2026-08-13 | Added Deployment Topology section (three tiers) | ADR-032 — formalises the hosting model behind the residency layers |
| 2026-08-13 | Added thirteen-layer compliance reference | ADR-030 — architecture is now audited layer by layer |
| 2026-08-13 | Decisions summary extended with configuration and deployment rows | ADR-031 and ADR-032 |
