# CREDENTIALS_CHECKLIST.md — what AfriTech must provide

## Related Documents

- `01 Foundation Layer/ENV.md` — every variable, grouped by surface
- `env.local.template` (repo root) — the committed template for local development
- `01 Foundation Layer/BUILD_SEQUENCE.md` — which phase each service belongs to
- `03 Infrastructure Services/` — one document per service, for configuration detail

---

## Purpose

A single list of every account, key and credential a human must obtain, in the order that unblocks
the most work. Everything here is something **only AfriTech can supply** — the code that consumes
it already exists.

**This list was derived by grepping `process.env` across `apps/` and `packages/`, not from
`ENV.md`.** That matters: `ENV.md` lists several variables nothing reads, and omitted `AI_GENERATOR`
entirely until 2026-09-28. Where a variable below is marked *(SDK reads it)*, our code never
mentions it by name but the library requires it — `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is the
example, and grepping alone would wrongly conclude it is unused.

---

## Overview

| Service | Status | Blocks |
|---|---|---|
| Supabase — `zsms-dev` | **Have** | — |
| **Supabase service role key** | **Missing from `.env.local`** | Every background worker, even with Redis |
| Clerk — development instance | **Have** | — |
| Anthropic API key | **Have, no credit** | Failover *to* Anthropic; PDF-native syllabus reading |
| OpenAI API key | **Have, verified live 2026-09-29** | — |
| **Redis (Upstash)** | **Missing** | Every background job, rate limiting |
| **Meta WhatsApp** | **Missing** | All parent messaging |
| **Resend** | **Missing** | Email fallback, receipts by email |
| **Twilio** | **Missing** | SMS fallback |
| **Cloudflare R2** | **Missing** | Logo upload, stored receipts and report cards |
| **Sentry** | **Missing, not installed** | Any visibility of unhandled errors |
| Supabase — `zsms-staging` | Missing | Prohibition 10 (nothing reaches production unverified) |
| Supabase — `zsms-zm` (production) | Missing | Launch |
| Vercel | Missing | Deploying the web app anywhere but a laptop |
| Railway | Missing | Running workers anywhere but a laptop |
| PostHog | Missing | Product analytics |
| QStash | Not needed | Fallback queue only; BullMQ is the default (ADR-035) |

---

## 1. Blocking real work today

### 1.1 Redis — Upstash

**The single highest-value credential on this list.** Four workers are written, registered and
tested against their handlers, and **not one job has ever round-tripped through a queue**. Fee
reminders, receipt generation, scheduled announcements and report-card batches all sit behind this.

```bash
REDIS_URL=rediss://...                 # or BULLMQ_REDIS_URL — both are read
JOB_QUEUE_PROVIDER=bullmq              # default per ADR-035
UPSTASH_REDIS_REST_URL=https://...     # rate limiting, separate from the queue connection
UPSTASH_REDIS_REST_TOKEN=...
```

- **Where:** console.upstash.com → Redis → create a database in `eu-west-1` (dev) and
  `af-south-1` (staging/production).
- **Read by:** `packages/queue/src/bullmq-queue.ts`, `apps/web/app/api/health/route.ts`.
- **Without it:** a worker starts and idles. Nothing is broken, nothing runs.

### 1.2 Supabase service role key — already available, just not set

Not a new account: it is in the `zsms-dev` dashboard under **Settings → API → service_role**. It is
simply absent from `.env.local`, and `apps/workers/src/db.ts` throws without it. Redis and this key
are both required before any worker runs; obtaining Redis and discovering this afterwards is an
avoidable second trip.

```bash
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

**This key bypasses RLS completely.** It is the one credential in this document that must never
reach `apps/web` or a browser (CONVENTIONS prohibition 1).

### 1.3 Anthropic — add credit to the existing key

**The OpenAI half of the chain is now proven.** `npm run ai:smoke` made a real request on
2026-09-29: answered by `openai/gpt-4o` in 6.2s, 120 in / 99 out, $0.00129, schema-valid structured
output including a Mermaid diagram. The module graph, the classifier and the cost accounting all
work against a live provider.

What remains is Anthropic, whose key is configured but has no balance:

- **Failover *to* Anthropic has still never executed.** Failover *away* from a provider is proven;
  arrival at the second one is not. The chain is genuinely half-tested. Raise Anthropic's priority
  in `afritech.ai_models` once topped up, so the other direction runs too.
- **Scanned syllabus PDFs cannot be ingested.** Extraction reads the text layer, and a scan has
  none. Anthropic reads PDFs natively and would handle it; OpenAI's chat completions cannot.

Note that `AI_GENERATOR` is still `template`, so nothing in the product calls a model yet. That is
deliberate — see business rule 5.

### 1.4 Sentry — account **and** installation

`CLAUDE.md` and `ENV.md` both imply Sentry is wired. **It is not installed at all** — no
`@sentry/*` dependency, no config file, no `captureException`. Today an unhandled exception reaches
nobody.

```bash
SENTRY_DSN=https://...@o0.ingest.sentry.io/0
SENTRY_AUTH_TOKEN=...                  # source maps at build time
```

- **Where:** sentry.io → create project → Next.js.
- **Note:** `platform_incidents` (migration `0134`) covers business-level failures with an
  acknowledge/resolve lifecycle Sentry does not have. They are complementary: Sentry catches the
  stack trace, incidents catch the thing a human must act on.

---

## 2. Blocking launch

### 2.1 Meta WhatsApp Business

The primary channel for every parent notification. Nothing has ever left this machine.

```bash
META_ACCESS_TOKEN=...
META_PHONE_NUMBER_ID=...
META_APP_SECRET=...                    # inbound webhook signature verification
META_VERIFY_TOKEN=...                  # a string you choose; Meta echoes it back
NOTIFICATION_PROVIDER=live             # unset or `mock` keeps everything local
```

- **Where:** developers.facebook.com → WhatsApp Business Platform. Needs a verified business and a
  dedicated number.
- **Lead time is the risk here, not the work.** Business verification takes days to weeks, and
  message templates need Meta's approval before any can be sent. Start this first among the
  launch items.

### 2.2 Resend — transactional email

```bash
RESEND_API_KEY=re_...
RESEND_FROM_ADDRESS=noreply@zsms.co.zm
```

- **Where:** resend.com. Requires DNS records on `zsms.co.zm` (SPF, DKIM) before delivery works.

### 2.3 Twilio — SMS fallback

Last in the fallback chain, and the one that reaches a parent with no smartphone.

```bash
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=+260...
```

- **Where:** twilio.com. A Zambian sender ID may need regulatory registration — check before
  assuming a lead time.

### 2.4 Cloudflare R2 — two buckets

```bash
R2_PUBLIC_ENDPOINT=https://<account>.r2.cloudflarestorage.com
R2_PUBLIC_ACCESS_KEY_ID=...
R2_PUBLIC_SECRET_ACCESS_KEY=...
R2_PUBLIC_BUCKET_NAME=zsms-public-zm

R2_PRIVATE_ENDPOINT=https://<account>.r2.cloudflarestorage.com
R2_PRIVATE_ACCESS_KEY_ID=...
R2_PRIVATE_SECRET_ACCESS_KEY=...
R2_PRIVATE_BUCKET_NAME=zsms-private-zm
```

- **Two buckets, and the split is not cosmetic.** Public holds school logos, which appear in
  browsers and emails. Private holds receipts and report cards, which name a child and an amount.
  A single bucket would put a pupil's report card one guessed URL away from the public internet.

### 2.5 Supabase — staging, then production

| Environment | Project | Region | Why the region |
|---|---|---|---|
| Staging | `zsms-staging` | **`af-south-1`** | Real-shaped data engages ZDPA/POPIA residency |
| Production | `zsms-zm` | **`af-south-1`** | Same, and non-negotiable |

`zsms-dev` being in `eu-west-1` is a documented exception that holds **only** because it contains
synthetic data. Never load real school data into it.

### 2.6 Clerk — production instance

The development instance issues `pk_test_` / `sk_test_` keys against test users. Production needs
its own instance, its own keys, and the session-token template re-applied — migration `0001`'s RLS
helpers read `o.id`, `o.slg`, `o.rol` and `sub`, and a production instance without that template
makes every policy deny.

```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...   # (SDK reads it)
CLERK_SECRET_KEY=sk_live_...
AUTH_PROVIDER=clerk
```

---

## 3. Hosting

### 3.1 Vercel — the web app

Every variable in sections 1 and 2 must be set in the Vercel project, per environment. The build
itself must never need a real secret: CI proves this by building with syntactically valid
placeholders.

### 3.2 Railway — workers and the standby database

```bash
RAILWAY_DATABASE_URL=postgresql://...
SUPABASE_SERVICE_ROLE_KEY=...          # workers ONLY, never apps/web
```

**`SUPABASE_SERVICE_ROLE_KEY` bypasses RLS entirely.** It belongs in the Railway environment and
nowhere else. `apps/web` has no code path that reads it, deliberately — see `lib/supabase.ts`.

---

## 4. Not needed yet

| Variable | Why not |
|---|---|
| `QSTASH_TOKEN` | Fallback queue. BullMQ is the default (ADR-035); only needed if Redis is dropped. |
| `FIELD_ENCRYPTION_KEY` | Nothing encrypts a field yet. |
| `GOOGLE_OAUTH_*`, `XERO_*`, `QUICKBOOKS_*` | Integration connectors — Phase 5, none built. |
| `POSTHOG_*` | Product analytics; not installed. |

---

## 5. Where each one goes

| Surface | File or place | Notes |
|---|---|---|
| Local development | **`.env.local` at the repo ROOT** | One file, never a copy per app — see below. |
| CI | **Nowhere** | The build must never need a real credential. |
| Production web | Vercel project environment variables | Per environment. |
| Workers | Railway environment variables | The only place the service role key lives. |

**One root file, loaded by each app itself.** Next reads `.env.local` from `apps/web`, not the repo
root, so `apps/web/next.config.mjs` loads the root file explicitly at module scope. `apps/workers`
had no equivalent and therefore loaded nothing — `npm run dev:workers` threw *"NEXT_PUBLIC_SUPABASE_URL
is not set"* against a fully populated root file, which reads as a missing variable rather than a
file nobody loaded. Fixed 2026-09-29 with `--env-file-if-exists=../../.env.local` on `dev:worker`.
In both cases a variable already in the real environment wins, so Vercel and Railway stay
authoritative.

**`turbo build` runs in strict env mode** (verified: `turbo build --dry=json` reports
`envMode: strict`). A variable absent from `turbo.json`'s `globalEnv` is stripped from the task
environment and does not participate in the cache key. Two mitigations already exist — each app
loads the root file itself, and `globalDependencies` lists `.env.local` so any edit to it busts the
cache — but **a new variable still belongs in `globalEnv`**, because those mitigations do not cover
a value supplied by the platform rather than the file. This has already caught one variable,
`AI_GENERATOR`.

---

## Business Rules

1. Real credentials are **never** committed (CONVENTIONS prohibition 2). `.env.local` is gitignored;
   `env.local.template` is the committed reference.
2. The Supabase service role key is used **only** in a trusted server-side context — a worker or an
   Edge Function (ADR-042). Never in `apps/web`.
3. Staging and production migrations are release actions requiring explicit human approval each
   time. Only `zsms-dev` may be migrated by tooling.
4. Substantive personal data stays in `af-south-1`. Only authentication credentials transit Clerk
   (US) under a DPA.
5. A key being present must never, by itself, switch a feature on. `AI_GENERATOR` is deliberately
   independent of `ANTHROPIC_API_KEY` for this reason: a key appearing in an environment is not the
   same as the path having been tested.

---

## Known Limitations and Future Work

- **Meta business verification is the longest lead time on this list** and is not engineering work.
  It should start before anything else in section 2.
- **Sentry needs installing, not just an account.** The dependency, config files and a
  `global-error.tsx` do not exist.
- **No secret rotation procedure is written down.** When a key is rotated, nothing tells an operator
  which surfaces to update. Worth a runbook before production.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-09-29 | Initial document | A single actionable list was needed; `ENV.md` groups by surface rather than by what a human must go and obtain, and lists variables nothing reads. Derived by grepping `process.env` across `apps/` and `packages/`. |
