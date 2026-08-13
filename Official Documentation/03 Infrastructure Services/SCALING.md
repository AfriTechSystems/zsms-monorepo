# SCALING.md — Scaling and Load Distribution

## Related Documents

- `01 Foundation Layer/THIRTEEN_LAYER_COMPLIANCE.md` — this document owns Layer 11 (Load Balancing / Scaling)
- `16 Testing and Launch/LOAD_TESTING.md` — the tests that verify the targets defined here
- `16 Testing and Launch/PERFORMANCE_CHECKLIST.md` — per-operation latency targets
- `03 Infrastructure Services/COST_MANAGEMENT.md` — scaling decisions are cost decisions
- `03 Infrastructure Services/CACHING_CDN.md` — caching is the first line of scale defence
- `03 Infrastructure Services/BULLMQ.md` — worker scaling for the queue layer
- `03 Infrastructure Services/RAILWAY.md` — worker and standby database hosting
- `05 Core Database and API Reference/INDEXES.md` — query performance under load

---

## Purpose

This document defines how ZSMS scales: what scales automatically, what requires manual intervention, where the hard ceilings are, and what load the system must sustain at each growth milestone. It exists so that capacity questions have answers before they become incidents. Every Claude Code session introducing a query on a hot path, a new background job, or a Realtime subscription should check the constraints here.

---

## Overview

ZSMS has an unusual load profile that shapes every scaling decision: **school traffic is extremely bursty and highly synchronised.** Schools do not generate smooth traffic. They generate near-zero load overnight, a sharp spike at 07:00–08:00 as teachers mark attendance, another at end of term when results publish and four hundred report cards generate at once, and another when fee reminders go out.

Worse, these spikes are correlated. Every school in Zambia marks morning attendance in roughly the same half hour. Every school publishes end-of-term results in roughly the same fortnight. The system must handle *N schools simultaneously*, not *N schools averaged over a day*.

The architecture responds to this in three ways: serverless functions that scale to zero and back without provisioning, background jobs that absorb bursts into a queue rather than a request path, and offline-first mobile that removes the morning attendance spike from the request path almost entirely.

---

## What Scales Automatically

| Component | Scaling behaviour | Ceiling |
|---|---|---|
| Vercel serverless functions | Automatic, per-invocation | Plan concurrency limit |
| Cloudflare CDN and WAF | Automatic, global edge | Effectively none at this scale |
| Supabase Edge Functions | Automatic, per-invocation | 50-second execution timeout |
| Upstash Redis | Automatic, serverless | Per-command billing |
| Cloudflare R2 | Automatic | Effectively none |
| QStash (fallback only) | Automatic | Per-message billing; no priority support |

## What Requires Manual Intervention

| Component | Scaling action | Trigger |
|---|---|---|
| Supabase compute tier | Upgrade instance size | Sustained CPU > 70% or connection pressure |
| Supabase connection pool | Increase pool size / pooling mode | Connection exhaustion errors |
| Railway BullMQ workers | Increase replica count | Queue depth sustained above threshold |
| Railway standby database | Match primary sizing | Primary upgrade |
| Read replicas | Provision (Phase 3) | Read load exceeding primary headroom |

---

## Connection Pooling

This is the most common way a serverless application takes down its own database, and it is worth stating precisely.

Vercel scales function instances independently. Two hundred concurrent invocations each opening a direct PostgreSQL connection means two hundred connections — comfortably beyond what a small Supabase instance allows. The connections are also short-lived and mostly idle, which is the worst possible pattern for PostgreSQL.

**All application traffic connects through Supavisor in transaction mode**, never directly to PostgreSQL.

| Connection path | Port | Mode | Used by |
|---|---|---|---|
| Supavisor transaction pooler | 6543 | Transaction | All API routes, Edge Functions, BullMQ workers |
| Supavisor session pooler | 5432 | Session | Migrations, admin tooling |
| Direct connection | 5432 | — | Never used by application code |

**Transaction mode constraints.** Transaction pooling does not support session-level state. Prepared statements, `SET` session variables, `LISTEN`/`NOTIFY`, and advisory locks held across statements do not work. This matters for RLS: the JWT claims that `get_school_id()` reads are set per transaction, not per session, and the Supabase client handles this correctly. Hand-rolled connection code that sets session variables will break under the pooler in ways that are intermittent and difficult to diagnose.

**Migrations use the session pooler.** DDL requires session state.

---

## Background Job Scaling

The queue is what converts a burst into a manageable stream. Per `BULLMQ.md` and ADR-035, all background work goes through the queue abstraction, and **BullMQ on Railway is the default implementation**. The job priority separation below is one of the principal reasons BullMQ is the default — QStash, the fallback, does not support priorities.

**Queue sizing principle.** Jobs are enqueued per batch, never per record. Bulk report card generation uses batches of 35 students (per `ARCHITECTURE.md`), which turns a 400-student run into 12 jobs rather than 400. This matters for cost (`COST_MANAGEMENT.md`) and for queue throughput equally.

**Worker scaling.** BullMQ workers on Railway scale by replica count. Each replica processes jobs concurrently up to its configured concurrency setting.

| Metric | Healthy | Warning | Action |
|---|---|---|---|
| Queue depth | < 50 | > 200 sustained 5 min | Add worker replica |
| Job wait time | < 30s | > 5 min | Add worker replica |
| Failed job rate | < 1% | > 5% | Investigate — scaling will not fix a bug |
| Worker CPU | < 60% | > 85% sustained | Add replica or increase size |

**Priority separation.** Not all jobs are equal. A parent waiting for a payment receipt should not queue behind a 400-student report card run.

| Priority | Jobs | Target latency |
|---|---|---|
| High | Payment confirmation, receipt generation, OTP-adjacent flows | < 10s |
| Normal | WhatsApp dispatch, notifications, integration events | < 60s |
| Bulk | Report card generation, bulk import, scheduled reminders | < 15 min |

Bulk jobs run on separate worker replicas so a term-end report card run cannot starve payment confirmations.

---

## Realtime Scaling

Supabase Realtime bills and limits on concurrent connections. ZSMS uses Realtime for bulk generation progress bars — an admin watching 400 report cards render.

Constraints: subscribe only to the specific job row, never to a whole table; tear the subscription down on job completion and on component unmount; and never use Realtime as a general data-sync mechanism. Mobile data sync is PowerSync's job, and the two must not be confused.

A leaked Realtime subscription per admin session accumulates silently and is a known cause of connection exhaustion.

---

## Growth Milestones and Load Targets

Targets scale with the business milestones in `BUILD_SEQUENCE.md` and `LAUNCH_CHECKLIST.md`. Each is verified by the corresponding scenario in `LOAD_TESTING.md`.

### Milestone 1 — Pilot (September 2026, 10 schools)

| Dimension | Target |
|---|---|
| Schools | 10 |
| Total students | ~4,000 |
| Peak concurrent users | 200 |
| Peak requests/second | 50 |
| Morning attendance window | 10 schools × 30 min |
| Concurrent report card jobs | 2 schools × 400 students |

### Milestone 2 — Commercial launch (January 2027, 50 schools)

| Dimension | Target |
|---|---|
| Schools | 50 |
| Total students | ~20,000 |
| Peak concurrent users | 1,000 |
| Peak requests/second | 250 |
| Morning attendance window | 50 schools in the same 30 min |
| Concurrent report card jobs | 10 schools × 400 students |

### Milestone 3 — Scale (2028, 200 schools)

| Dimension | Target |
|---|---|
| Schools | 200 |
| Total students | ~80,000 |
| Peak concurrent users | 4,000 |
| Peak requests/second | 1,000 |
| Morning attendance window | 200 schools in the same 30 min |
| Concurrent report card jobs | 40 schools × 400 students |

Milestone 3 is the point at which read replicas and a dedicated Supabase compute tier become necessary rather than optional.

### Fixed performance targets

These hold at every milestone and align with `PERFORMANCE_CHECKLIST.md`:

| Operation | Target |
|---|---|
| Authenticated page load (p95) | < 2s |
| API read (p95) | < 500ms |
| API write (p95) | < 1s |
| Feature access check (cached) | < 50ms |
| 400-student report card run | < 90s |
| PowerSync initial sync (3 classes, 3G) | < 30s |
| Error rate under peak load | < 0.5% |

---

## Scaling Sequence Under Pressure

When load exceeds capacity, the response order is fixed. Each step is cheaper and lower-risk than the one after it.

```
1. Verify caching is working        ← most "scaling problems" are cache misses
2. Check for a missing index        ← INDEXES.md; one query is usually the culprit
3. Increase Redis TTLs              ← if data staleness tolerance permits
4. Add BullMQ worker replicas       ← if the pressure is queue depth
5. Upgrade Supabase compute tier    ← if the pressure is database CPU
6. Increase connection pool size    ← if the pressure is connection exhaustion
7. Provision read replicas          ← Phase 3; genuine read saturation only
8. Consider country sharding        ← already the architecture; one project per country
```

Steps 1 and 2 resolve the overwhelming majority of apparent scaling problems. **Reaching for infrastructure before checking the cache and the query plan is how a system becomes expensive without becoming fast.**

Country sharding at step 8 deserves note: because ADR-009 already gives each country an independent Supabase project, per-country growth is naturally bounded. Zambia at 200 schools is a single-project problem; Zambia plus Botswana plus Zimbabwe is three separate single-project problems.

---

## Business Rules

1. All application traffic connects through the Supavisor transaction pooler. Direct PostgreSQL connections from application code are prohibited.
2. Background jobs are enqueued per batch, never per record, wherever the operation permits batching.
3. Bulk-priority jobs run on separate worker replicas from high-priority jobs so bulk work cannot starve user-facing work.
4. Realtime subscriptions target a specific row and are torn down on completion and unmount. Realtime is never a general data-sync mechanism.
5. Scaling responses follow the sequence above. Infrastructure is not upgraded before caching and indexing have been verified.
6. Every growth milestone is verified by load test before the corresponding launch gate, per `LOAD_TESTING.md`.
7. New hot-path queries require an index review against `INDEXES.md` before merge.

---

## Edge Cases and Error Handling

**Correlated morning spike.** Every school marks attendance at the same time. The primary mitigation is architectural: the mobile app is offline-first, so attendance is recorded locally and synced afterwards. Sync is spread over minutes rather than concentrated at the moment of marking. This converts a hard spike into a broad shoulder.

**Term-end report card storm.** Multiple schools generating hundreds of report cards within the same days. Mitigated by batching (35 students per job), bulk priority isolation, and the fact that generation is asynchronous with progress feedback — parents and admins are not blocked on it.

**Connection exhaustion.** Presents as intermittent `too many connections` errors under load. Almost always caused by code bypassing the pooler or a long-running transaction holding a connection. Investigate the code path before increasing the pool.

**A single school with disproportionate load.** A large Enterprise school can dominate a shared database. Visible through per-school metrics in `PLATFORM_METRICS.md`. Options are tier-appropriate rate limits or, at extreme scale, a dedicated project.

**Edge Function 50-second timeout.** Any operation approaching this ceiling must be decomposed into queued batches. The timeout is a hard architectural constraint, not a tuning parameter, and is the original reason for ADR-005.

**Worker replica scaled to zero.** Railway workers must not scale to zero. A cold worker means jobs sit unprocessed until the next scale-up, which turns a 10-second receipt into a several-minute one.

---

## Integration Points

- `LOAD_TESTING.md` — verifies every target in this document
- `PERFORMANCE_CHECKLIST.md` — per-operation latency targets, verified pre-launch
- `BULLMQ.md` — the queue abstraction whose workers this document scales
- `RAILWAY.md` — worker and standby database hosting
- `CACHING_CDN.md` — first line of scale defence
- `INDEXES.md` — second line of scale defence
- `COST_MANAGEMENT.md` — every scaling action has a cost consequence
- `AVAILABILITY.md` — scaling failures present as availability incidents

---

## Security Considerations

Rate limiting (`RATE_LIMITS.md`) is a scaling control as much as a security control — it bounds the load any single actor can generate. The Cloudflare Worker edge limits are particularly important because they reject abusive traffic before it reaches Vercel and becomes both a scaling problem and a billing one.

Load testing must run against staging only. Running a load test against production is a self-inflicted denial of service and would also pollute real school data and platform metrics.

Scaling events should be correlated with security monitoring. An unexplained traffic spike may be abuse rather than growth, and the distinction determines whether the correct response is adding capacity or blocking a source.

---

## Known Limitations and Future Work

- Load targets are projections. No production traffic data exists until the September 2026 pilot; every figure here should be re-derived from real pilot data before the January 2027 launch.
- Read replicas are Phase 3 and unspecified in detail. Read/write splitting requires application-layer routing that does not yet exist.
- No autoscaling for Railway workers. Replica count is manual, so a burst outside working hours queues until someone intervenes. Queue-depth-triggered autoscaling would close this.
- No per-school rate limiting by tier. All schools share the same limits regardless of what they pay.
- PowerSync scaling characteristics under many hundreds of concurrent syncing devices are unproven and untested at target scale.
- The 50-second Edge Function ceiling constrains any future synchronous operation over large datasets. Batching is the only answer available.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-08-13 | Initial complete draft | Layer 11 (Load Balancing / Scaling) had no owning document |
| 2026-08-13 | Connection pooling mandated through Supavisor transaction mode | Serverless connection exhaustion is the most likely self-inflicted outage |
| 2026-08-13 | Growth milestones defined at 10, 50, and 200 schools | Load targets tied to pilot, commercial launch, and scale milestones |
| 2026-08-13 | Job priority separation documented | Bulk report card runs must not starve payment confirmations |
