# COST_MANAGEMENT.md — Cloud Cost Monitoring and Control

## Related Documents

- `01 Foundation Layer/THIRTEEN_LAYER_COMPLIANCE.md` — this document owns Layer 6 (Cloud / Compute)
- `03 Infrastructure Services/SCALING.md` — scaling decisions that drive cost
- `03 Infrastructure Services/CACHING_CDN.md` — caching is the primary cost lever
- `17 Integration and Pricing/PRICING.md` — tier prices that cost-per-school must stay below
- `15 Super Admin and Platform/PLATFORM_METRICS.md` — where cost metrics surface
- `03 Infrastructure Services/VERCEL.md`, `SUPABASE.md`, `R2.md`, `QSTASH.md`, `RAILWAY.md` — the billed services

---

## Implementation Status (2026-10-11)

**Unit economics built; cost tracking is not, and cannot be from inside ZSMS.**

`/admin/costs` (`0240`) reports what each school CONSUMES — pupils, staff, AI credits
spent, messages against quota, documents, audited writes. Gated on `billing:read`, so a
loan officer is refused.

It shows no money, deliberately. The nine services below are external accounts with
their own credentials; ZSMS cannot read their invoices, and a figure invented here would
eventually be used to price a tier. Consumption is the part that can be measured
honestly, and it is the part that decides whether a tier is priced right — a 40-pupil
school sending 2,000 messages is a different proposition from a 900-pupil school sending
50, and no hosting invoice reveals that.

**Not built:** billing alerts, and the expensive-patterns audit. Both want real spend
data first.

---

## Purpose

This document defines how AfriTech monitors, attributes, and controls cloud spend across every ZSMS service. It sets billing alert thresholds, defines the cost-per-school unit economics that determine whether tier pricing is sustainable, and catalogues the expensive code patterns that cause surprise bills. Every Claude Code session introducing a new external service call, a scheduled job, or a bulk operation should check this document for the pattern it is about to create.

---

## Overview

ZSMS is a low-margin product sold in Zambian Kwacha to schools with tight budgets. The Starter tier is K600 per month — roughly $22. If infrastructure costs $8 per school per month, the business does not work. Cost is therefore not an operations concern to be handled later; it is a product constraint that shapes architecture decisions from the start.

Two properties of the architecture already control cost significantly. Cloudflare R2 has **no egress fees**, which matters enormously for a product whose main output is PDF documents parents download repeatedly. And feature access checks are **cached in Redis**, which converts three to four database queries per request into one cache read.

The risk is not steady-state cost. It is the cliff: a single unbounded loop calling an LLM, a cron job that scans every row in every school, or a bulk PDF run that re-downloads fonts per student. Each of these is cheap at one school and ruinous at two hundred.

---

## Billed Services and Cost Drivers

| Service | Billing model | Primary cost driver | Controlled by |
|---|---|---|---|
| Vercel | Per function invocation + bandwidth | API route calls, page renders | Caching, ISR, edge rate limiting |
| Supabase | Tier + compute + storage + egress | Database size, connection count, egress | Indexes, pooling, R2 for files |
| Cloudflare R2 | Storage + operations (**no egress**) | Object count, PUT/GET operations | Batch operations, signed URL reuse |
| Cloudflare WAF/CDN | Plan tier + requests | Request volume | Edge caching, bot filtering |
| Upstash Redis | Per command + storage | Cache reads/writes | TTL tuning, key hygiene |
| Railway | Per container hour + database | BullMQ worker replicas, Redis, standby DB | Replica sizing, autoscale limits |
| QStash (fallback only) | Per message published | Background job count | Batching, not per-record jobs |
| Clerk | Per monthly active user | Total users across all schools | — (scales with revenue, acceptable) |
| Anthropic API | Per token | AI assistant + lesson planner usage | Rate limits, prompt size, caching |
| OpenAI API | Per token | RAG embedding pipeline | One-time per KB chunk, not per query |
| Sentry | Per event | Error volume | Sampling, noisy-error suppression |
| PostHog | Per event | Analytics event volume | Event selection discipline |
| Resend | Per email | Transactional email volume | Portal-first model limits this |
| Meta WhatsApp | Per conversation | Message volume | Quotas, portal-first model |
| Twilio | Per SMS | Fallback SMS only | Narrow scope by design |

**Clerk deserves a note.** It bills per monthly active user, and ZSMS gives every parent, student, and alumnus a permanent account (ADR-015). Alumni accounts accumulate indefinitely and generate no revenue. At pilot scale this is negligible. By 2028 the alumni population could exceed the active population. This should be modelled before it becomes a surprise — see Known Limitations.

---

## Cost-Per-School Unit Economics

The number that matters is **infrastructure cost per school per month**, compared against tier revenue.

| Tier | Monthly revenue | Target infra cost | Target gross margin |
|---|---|---|---|
| Starter | K600 (~$22) | < $4 | > 80% |
| Growth | K1,100 (~$40) | < $7 | > 82% |
| Professional | K2,000 (~$73) | < $12 | > 83% |
| Enterprise | K3,000 (~$109) | < $18 | > 83% |

These are targets, not measurements — no production data exists yet. The first real figures arrive during the September 2026 pilot with ten schools, and the tier pricing in `PRICING.md` should be revisited against them before the January 2027 commercial launch.

**Attribution method.** Most services do not bill per tenant, so cost per school is derived rather than measured:

- **Directly attributable** — WhatsApp conversations, AI tokens, PDF generation jobs, storage bytes. Tracked per school and stored in `afritech.platform_metrics`.
- **Proportionally allocated** — Vercel invocations, Supabase compute, Redis commands. Allocated by that school's share of total request volume.
- **Fixed overhead** — Cloudflare plan, Railway standby, Sentry, PostHog. Divided evenly across active schools.

A monthly queued job computes this and writes it to `afritech.platform_metrics`, surfaced in the admin panel per `PLATFORM_METRICS.md`.

---

## Billing Alerts

Every service that supports a spend alert has one configured. Alerts route to the AfriTech operations email and to Slack.

| Service | Warning | Critical | Action on critical |
|---|---|---|---|
| Vercel | 60% of plan | 85% of plan | Review function invocation patterns |
| Supabase | 60% of tier | 85% of tier | Review egress and database size |
| Upstash Redis | $20/mo | $50/mo | Audit cache key growth and TTLs |
| QStash (if fallback active) | $15/mo | $40/mo | Audit job volume — likely per-record enqueueing |
| Cloudflare R2 | $15/mo | $40/mo | Audit object count and lifecycle policy |
| Railway | $30/mo | $70/mo | Review worker replica count |
| Anthropic API | $50/mo | $150/mo | Check AI rate limits are enforced |
| OpenAI API | $20/mo | $60/mo | Embedding pipeline should be near-idle after KB build |
| Clerk | 80% of MAU tier | 95% of MAU tier | Model alumni account growth |

**A critical alert is an incident.** It is investigated the same day, not at the end of the month. The overwhelming majority of cost spikes are bugs — a retry loop, an unbounded query, a job enqueued per record instead of per batch — and a bug that costs money is still a bug.

---

## Expensive Patterns Audit

These are the patterns that turn a $200 month into a $2,000 month. Each has a documented correct form.

### 1. Per-record job enqueueing

```typescript
// ✗ Expensive — 400 jobs, 400 worker cycles
for (const student of students) {
  await getQueue().enqueue('generate-report-card', { studentId: student.id })
}

// ✓ Correct — 12 jobs, batches of 35, per ARCHITECTURE.md
for (const batch of chunk(students, 35)) {
  await getQueue().enqueue('generate-report-card', { studentIds: batch.map(s => s.id) })
}
```

Note the abstraction — `getQueue()`, never a provider client directly (ADR-035).

### 2. Per-item resource loading inside a batch

Loading fonts and the school logo once per student instead of once per batch is the single most expensive mistake available in the PDF pipeline. `PDF_GENERATION.md` specifies loading both once per batch. At 400 students this is the difference between 12 font fetches and 400.

### 3. Unbounded LLM calls

Every Claude API call path must be behind a rate limit resolved from configuration (`ai_daily_limit`, default 100/school/day). An AI feature without a rate limit is an unbounded liability. The lesson planner additionally counts against the standalone teacher's plan quota.

### 4. Cross-tenant cron scans

```sql
-- ✗ Scans every row in every school every night
SELECT * FROM fee_records WHERE status IN ('unpaid','partial');

-- ✓ Bounded by the indexed partial index from INDEXES.md
SELECT id, school_id, student_id, due_date FROM fee_records
WHERE status IN ('unpaid','partial')
  AND due_date BETWEEN NOW() - INTERVAL '31 days' AND NOW()
```

Select only the columns the job needs. A nightly `SELECT *` across all schools is both a cost problem and a Supabase egress problem.

### 5. Missing cache on a hot path

`schoolHasFeature()` runs on essentially every authenticated request. Uncached it is three to four queries per request. The Redis cache is not an optimisation — it is load-bearing for both latency and cost. Any new hot-path lookup should be assessed for the same treatment.

### 6. Realtime subscriptions left open

Supabase Realtime bills on concurrent connections. Bulk generation progress bars subscribe to `report_generation_jobs`. The subscription must be torn down when the job completes or the component unmounts — a leaked subscription per admin session accumulates silently.

### 7. Storing generated documents that can be regenerated

Report card PDFs are stored because parents access them for years and regeneration requires historical data that may have changed. Intermediate artefacts — preview renders, draft exports, failed batch output — should not be. R2 lifecycle rules expire these; see `STORAGE.md`.

### 8. Chatty PowerSync sync rules

PowerSync sync rules scope to a teacher's assigned classes. Broadening them "temporarily" to debug a sync issue multiplies both sync volume and Supabase egress across every mobile device. Sync rule changes are reviewed like schema changes.

---

## Monthly Cost Review

A fixed monthly review, owned by the CTO, covering:

1. Actual spend per service against the previous month and against alert thresholds.
2. Cost per school per tier against the targets above.
3. Any critical alert fired during the month, with root cause and remediation.
4. The five most expensive query patterns from `pg_stat_statements`.
5. R2 object count and growth rate.
6. Clerk MAU, split active versus alumni.

Findings that change architecture become an ADR. Findings that change pricing become a `PRICING.md` update.

---

## Business Rules

1. Every billed service has a warning and a critical spend alert configured before it is used in production.
2. A critical billing alert is treated as an incident and investigated the same day.
3. Every AI API call path is behind a configurable rate limit. An unrated AI endpoint may not ship.
4. Background jobs are enqueued per batch, never per record, where the operation permits batching.
5. Bulk operations load shared resources (fonts, logos, templates, configuration) once per batch, never per item.
6. Cost per school per tier is reviewed monthly against the targets in this document. Sustained breach triggers a `PRICING.md` review, not silent margin erosion.
7. New external service integrations require a documented cost model before adoption — billing unit, expected volume, and worst-case monthly cost.

---

## Edge Cases and Error Handling

**A single school driving disproportionate cost.** A large Enterprise school generating heavy WhatsApp and PDF volume may exceed its tier's cost target legitimately. This is a pricing conversation, not an incident — but it must be visible, which is what per-school attribution provides.

**Free-trial schools.** Trial schools generate cost and no revenue for 30 days. At pilot scale this is a marketing expense. If trial abuse appears (repeated registrations to reset trials), the mitigation is registration verification, not cost controls.

**Cost spike during load testing.** Load tests against staging generate real spend. Run them against staging only, announce them so alerts are not mistaken for incidents, and include their cost in the monthly review. See `LOAD_TESTING.md`.

**Self-hosted deployments.** Country partners bear their own infrastructure cost. AfriTech's cost model covers only centrally hosted countries plus the encrypted backup vault. See `DEPLOYMENT_TOPOLOGY.md`.

---

## Integration Points

- `PLATFORM_METRICS.md` — cost metrics surface in the AfriTech admin dashboard
- `SCALING.md` — scaling decisions are cost decisions
- `CACHING_CDN.md` — caching is the primary cost lever on Vercel and Supabase
- `PRICING.md` — unit economics feed tier price reviews
- `LOAD_TESTING.md` — load tests generate real spend against staging

---

## Security Considerations

Billing dashboards and cost attribution data are commercially sensitive but contain no personal data. Access is restricted to `afritech:super_admin` and `afritech:finance_officer`.

Cost anomalies are a security signal as well as a financial one. An unexplained spike in API calls, WhatsApp messages, or AI tokens may indicate a compromised API key or a scraping attempt before any security alert fires. Investigate cost spikes for abuse, not only for bugs.

---

## Known Limitations and Future Work

- Cost targets are estimates. No production data exists until the September 2026 pilot; treat every figure here as a hypothesis to be tested.
- Clerk's per-MAU model interacts poorly with permanent alumni accounts (ADR-015). Alumni may eventually outnumber active users while generating no revenue. Model this before it becomes material — options include an alumni-tier arrangement with Clerk or moving alumni to a lighter authentication path.
- Cost attribution is derived, not measured, for shared services. Proportional allocation by request share is a reasonable approximation but will misattribute an unusually query-heavy school.
- No automated cost anomaly detection. Alerts are threshold-based, so a spike that stays under threshold goes unnoticed until the monthly review.
- Anthropic and OpenAI spend is not attributed per school in Phase 1. `ai_conversations` records interactions but not token counts. Adding token accounting would enable true AI cost attribution.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-08-13 | Initial complete draft | Layer 6 (Cloud / Compute) had no owning document |
| 2026-08-13 | Cost-per-school targets defined per tier | Infrastructure cost is a product constraint at Zambian price points |
| 2026-08-13 | Expensive patterns audit documented | Cost cliffs come from specific code patterns, not steady-state growth |
| 2026-08-13 | Flagged Clerk MAU vs permanent alumni accounts | ADR-015 creates unbounded non-revenue user growth |
