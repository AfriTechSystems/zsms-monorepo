# CREDENTIALS_CHECKLIST.md — what AfriTech must provide

## Related Documents

- `01 Foundation Layer/ENV.md` — every variable, grouped by surface
- `env.local.template` (repo root) — the committed template for local development
- `01 Foundation Layer/BUILD_SEQUENCE.md` — which phase each service belongs to
- `03 Infrastructure Services/` — one document per service, for configuration detail

---

## Where This Stands (2026-10-18)

**Done since this list was written:** Cloudflare R2 (both buckets), PostHog, Upstash
Redis, the Supabase service role key, Sentry's server half, and Docker Hub for CI. R2
was the largest single blocker in the tree — report cards and receipts generated
correctly for weeks and could not be delivered.

**Four rows of this document were wrong on 2026-10-18, all in the same direction:
reporting finished work as missing.** Redis, the service role key, Sentry and Docker Hub
were each marked blocking and each was already done. That error is more expensive than
the opposite, because it sends somebody to obtain something they already have and to
distrust the parts that are right. Statuses are now verified by presence in
`.env.local` and by running the smoke script, never by reading another document — the
same rule `DOC_AUDIT_PROGRESS.md` sets for the schema.

**The four that still block finished work, in the order they unlock most:**

1. **AI API credit.** Both keys are present; both were out of credit when this was
   written. OpenAI answered live on 2026-09-29 (`npm run ai:smoke`, `openai/gpt-4o`,
   schema-valid structured output), so re-check before buying — the one definitely
   outstanding is **credit on the Anthropic key**, which blocks failover ever executing
   *to* a provider and blocks reading a scanned syllabus, since Anthropic reads PDFs
   natively and OpenAI chat completions cannot. Note `AI_GENERATOR` is `template`, so
   flipping it to `live` stays a separate, deliberate step — business rule 5 below.
2. **The `zsms.co.zm` domain.** Gates Resend, and a verified Meta Business account needs
   it too. One purchase unblocks two channels.
3. **A paid Clerk plan.** The free tier caps an organisation at FIVE members, verified on
   the live instance. A school with six staff cannot be fully onboarded — a launch
   prerequisite, not an optimisation.
4. **`FIELD_ENCRYPTION_KEY` / `GATEWAY_ENCRYPTION_KEY`.** Integration and gateway
   credentials cannot be stored at all until these exist; `0230`'s CHECK refuses anything
   not already encrypted, deliberately, so the failure is loud rather than a plaintext
   token sitting in every backup.

**Deferred by decision, not missing:** PowerSync (paid, online-first for now), QStash
(BullMQ is the default per ADR-035), the Railway hot standby, and the Cloudflare zone.
Also `NEXT_PUBLIC_SENTRY_DSN` — see §1.4; a browser DSN is public by construction and
that trade should be accepted explicitly rather than inherited from the server key.

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

**Every status below was re-verified against `.env.local` and the live services on 2026-10-18**, by presence rather than by reading any document. Four rows were wrong in the direction that costs most — they reported finished work as missing: the service role key, Redis, Sentry and (in §1.3b) Docker Hub. A stale blocker sends somebody to obtain something they already have.

| Service | Status | Blocks |
|---|---|---|
| Supabase — `zsms-dev` | **Have** | — |
| Supabase service role key | **Have** — present in `.env.local`, verified 2026-10-18 | — |
| Clerk — development instance | **Have** | — |
| Anthropic API key | **Have, no credit** | Failover *to* Anthropic; PDF-native syllabus reading |
| OpenAI API key | **Have, verified live 2026-09-29** | — |
| Redis (Upstash) | **DONE 2026-09-30** | Verified again 2026-10-18: `npm run queue:smoke` round-tripped a real job — `BULLMQ_REDIS_URL` present, worker received it, marker matched. `EVAL`/`XADD`/`BZPOPMIN` all work on the free tier. |
| **Meta WhatsApp** | **Missing** | All parent messaging. **Longest lead time on this list** — business verification takes days to weeks and templates need Meta's approval. Start it first. |
| **Resend** | **Missing** | Email fallback, receipts by email |
| **Twilio** | **Missing** | SMS fallback |
| **Cloudflare R2** | **DONE 2026-10-11** | Logo upload, stored receipts and report cards. Verified by `npm run r2:smoke` (14 checks, both buckets) and `npm run docs:smoke` (the whole chain, byte-identical). |
| **Sentry** | **Installed** (`@sentry/nextjs ^11.1.0`); server reporting live. Only `NEXT_PUBLIC_SENTRY_DSN` outstanding, by decision | Browser-side error visibility |
| Supabase — `zsms-staging` | Missing | Prohibition 10 (nothing reaches production unverified) |
| Supabase — `zsms-zm` (production) | Missing | Launch |
| Vercel | Missing | Deploying the web app anywhere but a laptop |
| Railway | Missing | Running workers anywhere but a laptop |
| PostHog | **DONE 2026-10-11** | Product analytics, EU region. Verified by `npm run posthog:smoke`. Autocapture OFF — see POSTHOG.md for why that must not change. |
| QStash | Not needed | Fallback queue only; BullMQ is the default (ADR-035) |

---

## 1. Blocking real work today

### 1.1 Redis — Upstash — DONE 2026-09-30

**Corrected 2026-10-18.** This section called Redis "the single highest-value credential on this
list" and said "**not one job has ever round-tripped through a queue**". Both were true when
written and neither is true now. Upstash is configured and `npm run queue:smoke` round-trips a
real job on demand — re-run on 2026-10-18: `BULLMQ_REDIS_URL` present, `enqueue()` accepted the
job, a `createWorker()` worker received it, the payload marker matched. The commands BullMQ
depends on were verified directly against Upstash too — `EVAL`, `XADD` and `BZPOPMIN` all work,
so the free tier is sufficient.

**The transport is proven. Delivery is not.** No Meta, Resend or Twilio credentials exist, so
every channel still runs through the mock provider and no message has ever left this machine.
Do not read "the queue works" as "a parent received something".

Variables, for a new environment: `BULLMQ_REDIS_URL` (or `REDIS_URL`),
`JOB_QUEUE_PROVIDER=bullmq`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.
**Where:** console.upstash.com — `eu-west-1` for dev, `af-south-1` for staging and production.

### 1.2 Supabase service role key — DONE

**Corrected 2026-10-18:** present in `.env.local`, verified by presence. This section said it was
"already available, just not set", which is no longer the case.

Not a new account — it is in the `zsms-dev` dashboard under Settings → API → `service_role`. It
bypasses RLS completely, so per CONVENTIONS.md prohibition 1 as amended by ADR-042 it may reach a
Railway worker or an Edge Function and **never `apps/web`, and never a browser**. A worker's data
access goes through the `worker_*` functions; `.from(` anywhere in `apps/workers` is a defect.

Note that `0272` closed the two `worker_*` functions that had been granted to `anon` and
`authenticated` — the service role is unaffected, because it holds its own grant and bypasses
RLS regardless.

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

### 1.3b Docker Hub — DONE

**Corrected 2026-10-18.** `.github/workflows/ci.yml:126` runs `docker/login-action@v3` with `secrets.DOCKERHUB_USERNAME` / `secrets.DOCKERHUB_TOKEN`, and the `database` job's **✓ Authenticate to Docker Hub** step passes on every run. The secrets live in GitHub, not in `.env.local`, which is correct and is why a local grep cannot see them.

Kept rather than deleted, because the failure it describes is one nobody diagnoses twice without help. Not a ZSMS dependency. The `database` CI job starts a local Supabase, which pulls roughly a dozen
container images from Docker Hub, and **unauthenticated pulls from a GitHub runner share a rate limit
with every other unauthenticated runner on that IP**. Observed twice on 2026-09-30:

```
Error response from daemon: toomanyrequests: Rate exceeded
Error response from daemon: toomanyrequests: Data limit exceeded
```

The suites never ran. It looks exactly like a broken build and is not one, which is the reason it
belongs on this list — the cost is a re-run and twenty minutes of wondering what changed.

```
DOCKERHUB_USERNAME      # GitHub Actions secret
DOCKERHUB_TOKEN         # a read-only access token, not the account password
```

- **Where:** hub.docker.com → free account → Account Settings → Personal access tokens, scoped
  *Public Repo Read-only*.
- **Then:** add a `docker/login-action` step to the `database` job before it starts Supabase.
- **Alternative:** point the images at a mirror, which needs no account and more configuration.

### 1.4 Sentry — INSTALLED. One browser variable outstanding.

**Corrected 2026-10-18.** This section said "It is not installed at all — no `@sentry/*`
dependency, no config file, no `captureException`" and every part of that is false:
`apps/web/package.json` carries **`@sentry/nextjs ^11.1.0`**, with
`apps/web/instrumentation.ts`, `apps/web/instrumentation-client.ts`,
`apps/web/lib/report-error.ts` and `app/global-error.tsx` all wired. The server half
reports — `SENTRY_DSN` is set on dev.

What is actually outstanding is **`NEXT_PUBLIC_SENTRY_DSN`** alone, and leaving it unset was
a second deliberate decision rather than an oversight: a DSN inlined into a browser bundle is
public, readable by anyone who views source and usable by anyone who wants to spend the quota.
That is the accepted trade for browser error reporting and should be accepted explicitly.
Worth setting — most of what a school reports as "ZSMS is broken today" is a browser
exception nobody else can see.

A stale blocker is more expensive than a missing one: it sends somebody to install a
dependency that is already there, and this entry survived several passes.

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

### How to verify any of section 2, the moment it lands

`npm run notifications:smoke -- --to-phone +260... --to-email you@example.com`

Written 2026-10-18, before the credentials, so their arrival is a five-minute
confirmation rather than another round of discovery. It sends **one real message per
configured channel** and then exercises the WhatsApp → email → SMS chain, reporting
which channel actually delivered.

Two refusals are deliberate and worth knowing before you run it:

- **It exits non-zero unless `NOTIFICATION_PROVIDER=live`.** Otherwise every channel
  is `MockChannel`, which always succeeds — a green run against the mock would report
  delivery that did not happen, which is the false confidence that let this gap
  survive as long as it has.
- **It has no default recipient.** A seeded fixture number belongs to a real handset
  in Lusaka. Pass the destination explicitly.

A channel with absent credentials reports **SKIP**, never PASS, and the summary says
so: "we did not try" and "it worked" must not look the same.

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
| `POSTHOG_*` | Done. `NEXT_PUBLIC_POSTHOG_KEY` and `_HOST` are set; autocapture is off by design. |

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
- ~~**Sentry needs installing, not just an account.**~~ **Wrong, corrected 2026-10-18.**
  `@sentry/nextjs ^11.1.0`, `instrumentation.ts`, `instrumentation-client.ts`,
  `lib/report-error.ts` and `app/global-error.tsx` all exist. Only
  `NEXT_PUBLIC_SENTRY_DSN` is outstanding, and that by decision — see §1.4.
- **This document's own statuses are the thing most likely to be wrong.** Four were, on
  2026-10-18, all reporting finished work as missing. Verify by presence in `.env.local`
  or by running the relevant smoke script (`queue:smoke`, `r2:smoke`, `posthog:smoke`,
  `ai:smoke`, `docs:smoke`, `clerk:check`) before acting on any row here.
- **No secret rotation procedure is written down.** When a key is rotated, nothing tells an operator
  which surfaces to update. Worth a runbook before production.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-10-18 | Re-verified every status against `.env.local` and the live services; corrected four that reported finished work as missing | Redis (`queue:smoke` round-tripped a real job again), the Supabase service role key (present), Sentry (installed — only `NEXT_PUBLIC_SENTRY_DSN` outstanding, by decision) and Docker Hub (CI authenticates on every run) were each marked blocking and each was already done. A stale blocker costs more than a missing one: it sends somebody to obtain what they already have, and it makes the accurate rows look untrustworthy too. R2 and PostHog confirmed still configured. |
| 2026-09-30 | Added Docker Hub | CI's database job pulls a dozen images per run and hit Docker Hub's unauthenticated rate limit twice in one day. The suites do not run and it reads as a code failure. |
| 2026-09-29 | Initial document | A single actionable list was needed; `ENV.md` groups by surface rather than by what a human must go and obtain, and lists variables nothing reads. Derived by grepping `process.env` across `apps/` and `packages/`. |
