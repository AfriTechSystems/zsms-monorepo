# RAILWAY.md — Railway Standby Database and Queue Workers

## Related Documents

- `03 Infrastructure Services/SUPABASE.md` — primary database that Railway replicates from
- `03 Infrastructure Services/BULLMQ.md` — the queue workers Railway hosts (ADR-035)
- `03 Infrastructure Services/SCALING.md` — worker replica scaling and job priority separation
- `03 Infrastructure Services/AVAILABILITY.md` — failover runbooks
- `01 Foundation Layer/ARCHITECTURE.md` — overall infrastructure resilience design
- `01 Foundation Layer/ENV.md` — Railway environment variables

---

## Implementation Status (2026-10-11)

**Workers yes, standby no.**

Built: four BullMQ workers — receipts, fee reminders, scheduled announcements, report-card
batches. The worker boundary is enforced by a pgTAP suite: a worker's connection bypasses
RLS, so all its access goes through `worker_*` functions and `.from(` anywhere in
`apps/workers` is a defect.

Not built: the Postgres hot standby, the replication setup below, and lag monitoring. That
is a paid Railway database and a one-time configuration, not code.

---

## Purpose

This document covers Railway's two roles in ZSMS: the PostgreSQL standby database (replication, failover, health monitoring) and the persistent BullMQ queue workers plus their Redis instance. The standby is passive infrastructure that is critical when needed; the workers are active infrastructure the platform depends on continuously.

---

## Overview

Railway serves two distinct purposes.

**1 — Hot standby database (passive).** A PostgreSQL instance replicating continuously from the primary Supabase database. During normal operation the application never reads from or writes to it — it exists solely as a failover target. If the primary becomes unavailable, the application switches to Railway within 60 seconds and continues operating.

This is not a backup — it is a live replica, current to within seconds of the primary. A replica faithfully reproduces a bad migration or a mistaken bulk delete, so recovery from data corruption uses PITR or the encrypted vault, never the standby. See `AVAILABILITY.md`.

**2 — BullMQ queue workers and Redis (active).** Since ADR-035, BullMQ is the default job queue implementation, and its persistent workers run on Railway alongside a Railway Redis instance. Unlike the standby, this is on the critical path: if the workers stop, background processing stops — no report cards, no WhatsApp dispatch, no scheduled reminders. Worker replica counts, job priority separation, and queue depth thresholds are specified in `SCALING.md`; the worker implementation is in `BULLMQ.md`.

**Workers must not scale to zero.** A cold worker means jobs sit unprocessed until the next scale-up, turning a 10-second receipt into a several-minute one.

---

## Replication Setup

Railway PostgreSQL uses logical replication from Supabase. Logical replication streams row-level changes from the primary to the standby in real time.

### Configuration Steps (One-Time Setup)

**On Supabase (primary):**

```sql
-- Enable logical replication (already enabled on Supabase Pro tier)
-- Create a replication slot for Railway
SELECT pg_create_logical_replication_slot('railway_replica', 'pgoutput');

-- Create a publication for all tables
CREATE PUBLICATION zsms_publication FOR ALL TABLES;
```

**On Railway (standby):**

```sql
-- Create subscription pointing at Supabase
CREATE SUBSCRIPTION zsms_subscription
  CONNECTION 'postgresql://postgres:password@supabase-host:5432/postgres'
  PUBLICATION zsms_publication
  WITH (slot_name = 'railway_replica');
```

### Replication Lag Monitoring

Replication lag should stay under 5 seconds under normal load. Check lag:

```sql
-- Run on Railway standby
SELECT now() - pg_last_xact_replay_timestamp() AS replication_lag;
```

If lag exceeds 30 seconds consistently, investigate network issues between Supabase and Railway.

---

## Failover Process

Failover is currently manual in Phase 1. Automatic failover tooling (PgBouncer with health checks or Patroni) is a Phase 3 infrastructure upgrade.

### When to Trigger Failover

Trigger failover when:
- Supabase status page reports a database outage in the af-south-1 region
- Application error rate in Sentry shows `PGRST` (PostgREST) errors across all endpoints
- Supabase dashboard is inaccessible and Sentry confirms database connection failures

### Failover Steps

```bash
# 1. Promote Railway standby to primary (stops receiving replication)
# Run on Railway database:
SELECT pg_promote();

# 2. Update environment variables in Vercel to point at Railway
# Change NEXT_PUBLIC_SUPABASE_URL and related vars to Railway connection string
# This triggers a Vercel redeployment automatically

# 3. Update Edge Function secrets in Supabase (if Supabase is still accessible)
# If Supabase is completely down, Edge Functions are also unavailable
# BullMQ workers keep running on Railway and jobs accumulate in Railway Redis;
# any job whose handler needs Supabase will retry until the database returns

# 4. Monitor Railway database under primary load
# Railway is not optimised for primary workloads — this is temporary

# 5. When Supabase recovers, restore it as primary and re-establish replication
```

### Target Recovery Time

- Detection: 1–2 minutes (Sentry alerts + Supabase status)
- Decision to failover: 2–3 minutes
- Environment variable update and redeployment: 3–5 minutes
- **Total: under 10 minutes from incident detection to restoration**

The 60-second figure referenced in architecture documents refers to the future automated failover target, not the current manual process.

---

## Railway Project Configuration

**Standby database service**

- **Project name:** `zsms-standby-zm`
- **Database:** PostgreSQL 15 (match Supabase version exactly)
- **Region:** Closest available to af-south-1 (Supabase Africa region)
- **Plan:** Developer plan ($5/month) is sufficient for a standby that rarely handles load

**Queue worker services** (ADR-035)

- **Worker service:** `zsms-workers` — BullMQ workers, replica count per `SCALING.md`
- **Redis:** Railway Redis, the BullMQ backing store (`BULLMQ_REDIS_URL`)
- **Separation:** bulk-priority and high-priority workers run as separate replica sets so bulk report card runs cannot starve payment confirmations
- **Never scales to zero** — a cold worker delays every user-facing background job

One Railway project per country (same as Supabase — one per country production deployment). Cost alerts for the combined Railway spend are in `COST_MANAGEMENT.md`.

---

## What Is NOT on Railway

Railway does not host:
- Edge Functions (those are Supabase-specific)
- File storage (that is Cloudflare R2)
- The web application (that is Vercel)

**Railway is no longer a database-only service.** Since ADR-035 it also hosts the default queue workers and their Redis. This changes its availability profile: the standby database is passive and only matters during failover, but the workers are on the critical path continuously. `AVAILABILITY.md` Runbook 4 covers the queue-stopped scenario.

During a Supabase outage, BullMQ workers on Railway keep running and jobs accumulate in Railway Redis. Handlers that need Supabase retry with backoff and drain automatically once the database returns — no jobs are lost.

---

## Business Rules

1. Railway's standby database is never used for primary reads or writes during normal operation.
2. Failover to Railway is always a deliberate, human-initiated decision — not automatic in Phase 1.
3. Replication lag is checked weekly. Consistent lag over 30 seconds requires investigation.
4. After every Supabase schema migration, verify the migration replicated to Railway correctly.
5. Railway database version must always match the Supabase PostgreSQL version exactly.
6. BullMQ worker services must never scale to zero.
7. Bulk-priority workers run as a separate replica set from high-priority workers (`SCALING.md`).

---

## Known Limitations and Future Work

- Manual failover introduces human delay. Automatic failover using health check tooling is planned for Phase 3 once the platform has paying schools depending on high availability.
- Edge Functions are not replicated to Railway. During a Supabase outage, job handlers that call Edge Functions retry until Supabase recovers; jobs are held in Railway Redis without loss.
- The RLS policies and helper functions must exist on Railway as well. After any migration that adds or modifies RLS policies, verify the migration replicated to Railway.
- Railway now carries both a passive and a critical-path role. A Railway-wide outage takes out the standby *and* all background processing simultaneously — a correlated failure the architecture does not currently mitigate. Falling back to QStash (`BULLMQ.md`) is the manual workaround.
- Worker replica count is manual; there is no queue-depth-triggered autoscaling (`SCALING.md`).

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 3 infrastructure documentation |
| 2026-08-13 | **Scope expanded from standby database to standby + BullMQ queue workers** | ADR-035 makes BullMQ the default queue; its workers and Redis run on Railway |
| 2026-08-13 | Removed "Railway is a database only" statement | No longer true — it is now on the critical path continuously |
| 2026-08-13 | Added worker service configuration and business rules 6–7 | Workers must not scale to zero; bulk and high priority separated |
| 2026-08-13 | Flagged correlated failure risk (standby + workers on one provider) | A Railway outage now removes failover target and background processing together |
