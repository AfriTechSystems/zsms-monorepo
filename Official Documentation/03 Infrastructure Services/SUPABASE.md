# SUPABASE.md — Supabase Infrastructure

## Related Documents

- `docs/ARCHITECTURE.md` — overall system architecture and database design
- `docs/DATABASE.md` — complete schema definitions and migration strategy
- `docs/RLS.md` — all RLS policies applied to the Supabase database
- `docs/ENV.md` — Supabase environment variables
- `docs/infra/RAILWAY.md` — standby database replication from Supabase
- `docs/infra/VERCEL.md` — Edge Function deployment alongside web app
- `docs/countries/ZM.md` — Zambia project configuration

---

## Implementation Status (2026-10-11)

**`zsms-dev` is complete and exercised. Staging and production do not exist.**

93 tables across `public`, `afritech` and `private`; RLS enabled AND forced on every one;
0 tables without a policy. CI applies every migration to an empty database on each push
and runs 38 pgTAP suites against the result.

`zsms-dev` being in `eu-west-1` is a documented exception, not a mistake — it holds
synthetic data only, so the ZDPA adequacy argument requiring `af-south-1` is not engaged.
**Staging and production must be `af-south-1`**, and neither exists yet, which is a
compliance blocker before any real school data.

---

## Purpose

This document covers everything needed to configure, operate, and maintain the Supabase projects that power ZSMS. It is the reference for every Claude Code session that writes migrations, deploys Edge Functions, configures Realtime, or troubleshoots database issues.

---

## Overview

ZSMS uses Supabase as its primary backend platform. Supabase provides managed PostgreSQL with Row Level Security, Edge Functions (Deno runtime), PostgREST auto-generated API, Realtime subscriptions, and file storage (R2 is used for file storage instead of Supabase Storage — see `docs/infra/R2.md`).

One Supabase project exists per environment per country. This means three projects for Zambia alone (dev, staging, production) and additional production projects as new countries are added.

---

## Project Structure

### Projects

| Project Name | Environment | Purpose | Branch |
|---|---|---|---|
| `zsms-dev` | Development | Local development and testing | `feature/*` |
| `zsms-staging` | Staging / UAT | Integration testing before production | `integration` |
| `zsms-zm` | Production — Zambia | Live schools | `main` |
| `zsms-bw` (future) | Production — Botswana | Botswana schools | `main` |

Each project is completely independent. Production data never appears in development or staging. Migrations are applied to dev and staging before production. A staging validation step is required before any migration reaches `zsms-zm`.

### Data Region

| Project | Region | Basis |
|---|---|---|
| `zsms-dev` | `eu-west-1` (Ireland) | **Documented exception** — synthetic and seed data only, no personal data, so no adequacy basis is engaged |
| `zsms-staging` | `af-south-1` | Required — UAT may involve real pilot data |
| `zsms-zm` | `af-south-1` | Required — POPIA adequacy under ZDPA; launch blocker |

Staging and production use the **Africa (South Africa — af-south-1)** region. This is the POPIA-adequacy basis satisfying the Zambia Data Protection Act 2021 requirement for adequate protection (note: the ZDPA requires adequacy, not Zambian territory).

**`zsms-dev` in `eu-west-1` is deliberate — do not "fix" it.** The exception holds only while that project contains no real school data: no production dumps, no anonymised extracts, no pilot records. Full rationale in `COMPLIANCE.md` → Environment Data Residency.

When adding countries with specific data residency requirements, confirm the region before project creation and record the decision per `HOSTING_STRATEGY.md`.

---

## Schema Structure

ZSMS uses three PostgreSQL schemas (66 tables total):

**`public`** (46 tables) — all standard application tables. Exposed via PostgREST. Protected by RLS policies.

**`private`** — loan application tables containing PII. NOT exposed via PostgREST. Accessible only through Edge Functions using the service role key.

**`afritech`** — AfriTech internal team tables (staff scope assignments, platform metrics). NOT exposed via PostgREST. Accessible only through the AfriTech admin panel Edge Functions.

**Confirming schema exposure in Supabase:**
Navigate to: Supabase Dashboard → Project Settings → API → Exposed schemas
Ensure only `public` is listed. Remove `private` and `afritech` if they appear.

---

## Migration Process

### Naming Convention

```
supabase/migrations/NNNN_description_of_change.sql

Examples:
0001_rls_helper_functions.sql
0002_create_schools_table.sql
0003_create_students_table.sql
```

### Commands

```bash
# Link local project to a Supabase project
supabase link --project-ref your-project-ref

# Apply all pending migrations to linked project
supabase db push

# Generate TypeScript types after schema changes
supabase gen types typescript --linked > packages/types/database.ts

# Check migration status
supabase migration list

# Reset local database (development only — NEVER on staging or production)
supabase db reset
```

### Migration Order for New Project Setup

When setting up a brand new Supabase project (e.g. for a new country), apply migrations in this exact order:

1. `0001_rls_helper_functions.sql` — must run first, all policies depend on these functions
2. Schema creation migrations in sequence
3. RLS policy migrations
4. Index creation migrations
5. Trigger creation migrations
6. Seed data (reference tables like `reference_subjects_zm`)

Never skip a migration or apply them out of order. The sequence is enforced by the numbered prefix.

### Migration Rules

- Every migration is forward-only. No rollback scripts.
- Never modify an existing migration file after it has been applied to any environment.
- Test every migration on `zsms-dev` and `zsms-staging` before applying to `zsms-zm`.
- After every migration, regenerate `packages/types/database.ts`.
- After applying to production, add a `CHANGELOG.md` entry.

---

## Edge Functions

### Structure

Every Edge Function lives in `supabase/functions/[function-name]/index.ts`. The function name uses kebab-case.

```
supabase/functions/
├── send-whatsapp/index.ts
├── generate-report-card/index.ts
├── process-bulk-import/index.ts
├── webhook-payment/index.ts
├── webhook-clerk/index.ts
├── webhook-loan/index.ts
├── loan-submit/index.ts
├── schedule-reminders/index.ts
├── whatsapp-inbound/index.ts
└── school-onboard/index.ts
```

### Deployment Commands

```bash
# Deploy a single function
supabase functions deploy send-whatsapp

# Deploy all functions
supabase functions deploy

# View function logs
supabase functions logs send-whatsapp --tail

# Set environment variables for functions
supabase secrets set META_WHATSAPP_ACCESS_TOKEN=your-token
supabase secrets list
```

### Standard Edge Function Structure

Every Edge Function follows this pattern:

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verify } from 'https://deno.land/x/djwt/mod.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Validate auth (Clerk JWT, queue provider signature, or webhook HMAC)
    // 2. Parse request body
    // 3. Validate input with Zod schema
    // 4. Execute business logic
    // 5. Write audit log
    // 6. Return response

    return new Response(JSON.stringify({ data: result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message, code: 'SERVER_ERROR' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
```

### Service Role Client in Edge Functions

The service role client bypasses all RLS. It is used only for:
- Writing to `audit_logs` (append-only, no user policy for INSERT)
- Updating loan application status from webhook (cross-schema write)
- AfriTech admin operations that span multiple schools

```typescript
// Service role client — Edge Functions only
const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// Standard anon client — use for all user-scoped operations
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_ANON_KEY')!,
  { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
)
```

---

## Realtime Subscriptions

Supabase Realtime is used for live progress updates during bulk report card generation. The frontend subscribes to changes on the `report_generation_jobs` table for a specific `run_id`.

### Configuration

Realtime must be enabled per table in Supabase Dashboard → Database → Replication → Tables. Enable Realtime for:
- `report_generation_jobs` — bulk generation progress
- `payments` — payment verification status updates for the accountant queue

Do not enable Realtime on all tables — it increases database load unnecessarily.

### Frontend Subscription Pattern

```typescript
const subscription = supabase
  .channel('report-progress')
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'report_generation_jobs',
    filter: `run_id=eq.${runId}`,
  }, (payload) => {
    updateProgress(payload.new.completed_students, payload.new.total_students)
  })
  .subscribe()

// Always clean up subscriptions
return () => supabase.removeChannel(subscription)
```

---

## Connection Pooling

Supabase uses PgBouncer for connection pooling. Two connection modes are available:

**Transaction mode (port 6543)** — use for all application connections. Each query gets a connection from the pool. Efficient for high-concurrency web requests.

**Session mode (port 5432)** — use only for migrations and `supabase gen types`. Required for commands that need persistent session state.

The `SUPABASE_DB_URL` in `.env` should use the session mode URL (port 5432) for migration commands. Application code uses the Supabase client which handles pooling automatically via the REST API.

---

## pgvector Extension (Future — AI Features)

For the AfriTech internal AI assistant and per-school AI assistant (Year 2 features), pgvector is required for storing document embeddings. Enable it when needed:

```sql
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Example embeddings table (future)
CREATE TABLE public.document_embeddings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  document_path TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON document_embeddings
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

Do not enable pgvector in Phase 1. Add it when AI features are built.

---

## Database Triggers — Deployment

Triggers are created via migration files, not the Supabase dashboard. They are applied as part of migration `0015_add_triggers.sql`. Key triggers:

- `set_updated_at_on_[table]` — auto-updates `updated_at` on every table with that column
- `queue_absence_notification_on_attendance` — enqueues a job through the queue abstraction when a student is marked absent
- `set_grace_period_on_student_parent_links` — sets 30-day grace period on parent unlink

---

## Monitoring and Maintenance

### Supabase Dashboard — Key Sections

- **Database → Query Performance** — identify slow queries. Any query consistently over 100ms should be investigated and likely needs an index.
- **Database → Logs** — real-time database logs. Filter by `ERROR` level for issue diagnosis.
- **Edge Functions → Logs** — per-function execution logs. Check after each deployment.
- **API → Logs** — PostgREST request logs. Useful for debugging RLS policy issues.

### Slow Query Identification

```sql
-- Find slowest queries in the last hour
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 20;
```

### RLS Policy Testing

```sql
-- Test RLS as a specific user (development only)
SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"user_id","o":{"id":"org_id","rol":"org:teacher"}}';
SELECT * FROM public.students LIMIT 5;
RESET ALL;
```

---

## Business Rules

1. Never apply migrations directly to `zsms-zm` (production) without first applying and verifying on `zsms-staging`.
2. The `private` and `afritech` schemas are never added to the Supabase PostgREST exposed schemas list.
3. The service role key is used only in Edge Functions. Never in Next.js API routes, never in frontend code, never in the mobile app.
4. Realtime is enabled only on tables that require it. Do not enable globally.
5. TypeScript types are regenerated after every migration using `supabase gen types typescript`. The generated file is never manually edited.
6. Edge Function environment variables (secrets) are set using `supabase secrets set`, not committed to version control.

---

## Known Limitations and Future Work

- Supabase does not yet have a data centre in Zambia. The af-south-1 region (South Africa) is the closest available. If Zambia introduces strict data localisation laws requiring in-country hosting, a self-hosted Supabase deployment would be required.
- The free tier Supabase project pauses after 7 days of inactivity. Development projects (`zsms-dev`) may pause during weekends or holidays. Upgrade to Pro tier or use `supabase db push` to wake them.
- Cross-country aggregate queries (AfriTech platform-wide metrics across ZM, BW, ZW projects) require querying multiple Supabase project URLs. These run as Edge Functions that aggregate results from all country databases.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 3 infrastructure documentation |
| 2026-04-26 | Added `afritech` schema to schema structure | Confirmed AfriTech internal team tables need separate schema |
| 2026-08-13 | Corrected schema count from two to three in the overview line | Body already described all three schemas; the lead-in contradicted it |
| 2026-08-13 | Documented per-project regions including the `zsms-dev` eu-west-1 exception | Previous text claimed all Zambia projects are af-south-1 |
