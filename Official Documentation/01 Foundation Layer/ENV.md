# ENV.md — Environment Variables Reference

## Purpose

This document lists every environment variable used across ZSMS. Every variable is documented with its purpose, where it is set, and which services use it. Never commit secrets to Git. All secrets are set in Vercel project settings and Supabase Edge Function secrets.

---

## Vercel Environment Variables (Web App)

### Authentication

```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...
CLERK_WEBHOOK_SECRET=whsec_...
# Svix secret for verifying Clerk webhook events
```

### Supabase

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
# Service role — server-side only, never exposed to browser
```

### Country Configuration

```bash
NEXT_PUBLIC_COUNTRY_CODE=ZM
# Determines active country config — ZM, BW, ZW etc.
NEXT_PUBLIC_ZSMS_URL=https://zsms.co.zm
```

### Redis (Upstash)

```bash
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=...
# Rate limiting and feature access cache
```

### Encryption

```bash
GATEWAY_ENCRYPTION_KEY=...
# AES-256 key for encrypting payment gateway credentials,
# WhatsApp access tokens, lender API keys, loan application PII
# Must be 32 bytes (256 bits), base64 encoded
FIELD_ENCRYPTION_KEY=...
# Separate key for loan application sensitive fields (income, NRC)
```

### PostHog

```bash
NEXT_PUBLIC_POSTHOG_KEY=phc_...
# EU host by default. ZSMS keeps substantive personal data in `af-south-1`, and
# PostHog has no region there — so analytics carries NO personal data at all
# (see `apps/web/lib/analytics.ts`), and the host choice is about latency rather
# than residency. `app.posthog.com` is the US cloud; prefer `eu.i.posthog.com`.
NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com
```

### Sentry

```bash
NEXT_PUBLIC_SENTRY_DSN=https://...@sentry.io/...
SENTRY_AUTH_TOKEN=...
# For source map uploads during build
SENTRY_ORG=afritech-systems
SENTRY_PROJECT=zsms-web
```

---

### AI generators (`packages/ai`)

```bash
# WHICH generator runs. `template` (or unset) = the deterministic scaffold; `claude` =
# Anthropic. Separate from the keys ON PURPOSE: `resolveGenerator()` deliberately ignores
# ANTHROPIC_API_KEY, because a key appearing in an environment is not the same as a
# curriculum knowledge base having been ingested and a prompt reviewed. A generator that
# switches itself on when a variable appears is how an untested path reaches a paying teacher.
AI_GENERATOR=template

# Anthropic — generation: lesson plans, quizzes, homework, and later the AI assistant.
ANTHROPIC_API_KEY=sk-ant-...

# OpenAI — embeddings (`text-embedding-3-small`) for the lesson-planner RAG pipeline, and a
# fallback generator if Anthropic is unavailable. Not required for `AI_GENERATOR=claude`:
# the first curriculum store is relational, because subject + grade + topic are exact
# lookups and similarity search is the wrong tool for a question with a known key.
OPENAI_API_KEY=sk-...
```

**Local development puts these in the repo-root `.env.local`, not `apps/web/.env.local`** —
Turborepo reads root env for everything in `turbo.json`'s `globalEnv`, and all three names are
listed there. `env.local.template` section 7 is the committed reference.

**A key here cannot produce an unbounded bill.** Every generation is metered against the AI
credit ledger (`0132`), each row recording the model, token counts and real USD cost. An empty
wallet is refused with the shortfall stated *before* the model is invoked, and the prices and
allowances are configuration rows rather than code.

---

## Supabase Edge Function Secrets

Set via: `supabase secrets set KEY=value`

### Meta WhatsApp (AfriTech Shared Number)

```bash
META_WHATSAPP_PHONE_NUMBER_ID=...
META_WHATSAPP_ACCESS_TOKEN=...
META_WHATSAPP_BUSINESS_ACCOUNT_ID=...
META_APP_SECRET=...
# Used for HMAC signature verification of incoming webhooks
META_WEBHOOK_VERIFY_TOKEN=...
# Random string — used for webhook endpoint verification by Meta
```

### SMS Fallback (Twilio)

```bash
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=+1...
```

### Email (Resend)

```bash
RESEND_API_KEY=re_...
RESEND_FROM_ADDRESS=notifications@zsms.co.zm
```

### Job Queue

BullMQ is the default implementation (ADR-035). QStash variables are only required when the fallback is active.

```bash
# Default — BullMQ on Railway
BULLMQ_REDIS_URL=redis://default:password@railway-redis-host:6379
# JOB_QUEUE_PROVIDER may be omitted; it defaults to 'bullmq'

# Fallback only — set JOB_QUEUE_PROVIDER=qstash to activate
JOB_QUEUE_PROVIDER=qstash
QSTASH_TOKEN=...
QSTASH_CURRENT_SIGNING_KEY=...
QSTASH_NEXT_SIGNING_KEY=...
# For verifying QStash webhook signatures (fallback only)
```

### Payment Gateways

```bash
PAWAPAY_API_KEY=...
PAWAPAY_WEBHOOK_SECRET=...
FLUTTERWAVE_SECRET_KEY=...
FLUTTERWAVE_WEBHOOK_HASH=...
```

### Cloudflare R2

```bash
R2_PUBLIC_ENDPOINT=https://xxx.r2.cloudflarestorage.com
R2_PUBLIC_ACCESS_KEY_ID=...
R2_PUBLIC_SECRET_ACCESS_KEY=...
R2_PUBLIC_BUCKET_NAME=zsms-public-zm

R2_PRIVATE_ENDPOINT=https://xxx.r2.cloudflarestorage.com
R2_PRIVATE_ACCESS_KEY_ID=...
R2_PRIVATE_SECRET_ACCESS_KEY=...
R2_PRIVATE_BUCKET_NAME=zsms-private-zm
```

### Railway Standby

```bash
RAILWAY_DATABASE_URL=postgresql://...
# Standby read replica connection string
```

### AI / Claude API

> **These are NOT Edge Function secrets, despite this section's placement.** Corrected
> 2026-09-28. `packages/ai` runs inside `apps/web`'s API routes — `supabase/functions/` is
> still empty — so they belong with the **Web App** variables above, and that is where the
> canonical listing now lives. Kept here because the AI module documents reference this
> section.
>
> They must also appear in **`turbo.json`'s `globalEnv`**, or Turborepo neither passes them
> to the build nor invalidates its cache when they change — so flipping `AI_GENERATOR` would
> appear to do nothing against a warm cache.

### Integration Connectors OAuth

```bash
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
# For Google Sheets connector OAuth flow

HUBSPOT_OAUTH_CLIENT_ID=...
HUBSPOT_OAUTH_CLIENT_SECRET=...
# For HubSpot CRM connector OAuth flow

QUICKBOOKS_OAUTH_CLIENT_ID=...
QUICKBOOKS_OAUTH_CLIENT_SECRET=...
# For QuickBooks Online connector OAuth flow

XERO_OAUTH_CLIENT_ID=...
XERO_OAUTH_CLIENT_SECRET=...
# For Xero connector OAuth flow
```

### Encryption Keys

```bash
GATEWAY_ENCRYPTION_KEY=...
# Same key as in Vercel env — must match exactly
FIELD_ENCRYPTION_KEY=...
# Same key as in Vercel env — must match exactly
```

---

## Per-Environment Notes

### Environment and region summary

| Environment | Supabase Project | Region | Status | Data |
|---|---|---|---|---|
| Development | `zsms-dev` | `eu-west-1` (Ireland) | Provisioned 2026-08-12 | Synthetic / seed only |
| Staging | `zsms-staging` | `af-south-1` (South Africa) | Not yet created — Phase 0 final steps | Synthetic / seed; UAT data |
| Production | `zsms-zm` | `af-south-1` (South Africa) | Not yet created — Phase 6 | Real school data |

Per-country production projects (`zsms-bw`, `zsms-zw`) are future expansion and are not provisioned at this stage. Build against `zsms-dev` only until staging exists.

### Development (`zsms-dev` Supabase project)

- **Region: `eu-west-1` (Ireland) — deliberate exception, not an error.** See the Environment Data Residency section of `COMPLIANCE.md` for the full rationale.
- **Synthetic and seed data only. Real school data must never be loaded into this project** — no production dumps, no anonymised extracts, no pilot school records. The EU region exception rests entirely on this constraint. Generate fixtures per `TEST_DATA.md`; if realistic data is needed for debugging, reproduce it synthetically or use `zsms-staging`.
- The ZDPA/POPIA adequacy argument that requires `af-south-1` applies to environments holding personal data. `zsms-dev` holds none, so no adequacy basis is engaged.
- If `af-south-1` becomes available on AfriTech's Supabase plan, dev may be recreated there so all environments match. This is a consistency preference and is **not required**.
- Use Meta sandbox phone numbers for WhatsApp testing
- Use PawaPay sandbox credentials
- Use Twilio test credentials
- GATEWAY_ENCRYPTION_KEY must be set — use a different key from staging/production

### Staging (`zsms-staging` Supabase project)

- **Region: `af-south-1` (South Africa)** — required. UAT may involve real pilot school data, so the documented adequacy basis applies.
- Use Meta test numbers
- Use payment gateway sandbox mode
- GATEWAY_ENCRYPTION_KEY must be different from production

### Production (`zsms-zm` Supabase project)

- **Region: `af-south-1` (South Africa)** — required and a launch blocker. This is the POPIA-adequacy basis underpinning ZDPA cross-border compliance and the ZICTA Data Controller registration.
- All production credentials
- Never share with developers — accessed only via time-limited production grants
- Rotation schedule: API keys rotated every 6 months minimum

---

## School-Stored Configuration (NOT Environment Variables)

The following are stored in the database per school, not in environment variables. They are NOT env vars:

| Item | Storage Location | Notes |
|---|---|---|
| School WhatsApp credentials | `schools.whatsapp_phone_number_id`, `.whatsapp_access_token_enc` | Encrypted in DB |
| Payment gateway API keys | `payment_gateways.api_key_encrypted` | Encrypted in DB |
| Lender API keys | `lenders.api_key_encrypted` | Encrypted in DB |
| Integration OAuth tokens | `school_integrations.credentials_enc` | Encrypted in DB |

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Environment reference |
| 2026-04-26 | Added ANTHROPIC_API_KEY and OPENAI_API_KEY | AI module — Claude API and embeddings |
| 2026-09-28 | **Moved the AI variables to the Web App section and added `AI_GENERATOR`** | They were filed under Edge Function secrets, but `packages/ai` runs in `apps/web`'s API routes and `supabase/functions/` is empty. Also added all three to `turbo.json`'s `globalEnv`, without which Turborepo neither passes them to the build nor invalidates its cache when they change. |
| 2026-04-26 | Added integration connector OAuth client credentials | Accounting and CRM connectors |
| 2026-04-26 | Added META_APP_SECRET and HMAC variables | WhatsApp webhook signature verification |
| 2026-04-26 | Added FIELD_ENCRYPTION_KEY | Loan module sensitive field encryption |
| 2026-08-13 | Added environment and region summary table | `zsms-dev` provisioned; staging and production regions fixed to `af-south-1` |
| 2026-08-13 | Documented `zsms-dev` EU region exception and no-real-data constraint | Dev holds synthetic data only — adequacy basis not engaged |
| 2026-08-13 | Queue section restructured — `BULLMQ_REDIS_URL` is now the default; QStash vars are fallback-only | ADR-035 |
