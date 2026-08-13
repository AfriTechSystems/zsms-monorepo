# AVAILABILITY.md — Availability, Backup, and Recovery

## Related Documents

- `01 Foundation Layer/THIRTEEN_LAYER_COMPLIANCE.md` — this document owns Layer 13 (Availability / Recovery)
- `03 Infrastructure Services/RAILWAY.md` — standby database and failover mechanics
- `03 Infrastructure Services/SUPABASE.md` — backups and point-in-time recovery
- `03 Infrastructure Services/SENTRY.md` — error alerting that precedes most incidents
- `03 Infrastructure Services/SCALING.md` — capacity failures present as availability incidents
- `01 Foundation Layer/SECURITY_POLICIES.md` — incident response and breach notification
- `01 Foundation Layer/COMPLIANCE.md` — SOC 2 Availability criterion, ZDPA 72-hour notification
- `03 Infrastructure Services/DEPLOYMENT_TOPOLOGY.md` — the encrypted backup vault tier

---

## Purpose

This document defines ZSMS's availability commitments, how uptime is monitored, how backups are taken and — more importantly — verified, and the consolidated runbooks for recovering from each failure mode. It is the operational counterpart to `SECURITY_POLICIES.md` and supplies the evidence the SOC 2 Availability criterion requires.

---

## Overview

Schools depend on ZSMS during school hours. A teacher who cannot mark attendance at 07:30 does not wait until the system recovers — they use paper, and the data may never be entered. Availability failures in this product cause permanent data loss at the edges even when no database row is lost.

That said, ZSMS is not a system where every minute of downtime is equal. Availability requirements are strongly time-of-day and time-of-term dependent:

| Window | Criticality | Rationale |
|---|---|---|
| 06:00–08:00 school days | **Critical** | Morning attendance marking across all schools |
| 08:00–17:00 school days | **High** | Normal school operations, parent portal use |
| 17:00–22:00 | Medium | Parent portal, fee payments, results checking |
| 22:00–06:00 | Low | Batch jobs, near-zero user traffic |
| End of term (results/reports) | **Critical** | Bulk generation and publication windows |
| School holidays | Low | Minimal usage |

Maintenance is scheduled in the low windows. Deployments are avoided entirely during critical windows.

**The offline-first mobile architecture is the single most valuable availability control in the system.** A teacher marking attendance during a total backend outage does not notice, because PowerSync writes to local SQLite and syncs later. No other design decision buys as much resilience for the highest-criticality window.

---

## Availability Targets

| Environment | Target | Measurement | Basis |
|---|---|---|---|
| Production (`zsms-zm`) | 99.5% monthly | External probe, 1-min interval | ~3.6 hours downtime/month |
| Production, critical windows | 99.9% | External probe | ~2 minutes/month in-window |
| Staging (`zsms-staging`) | Best effort | — | No commitment |
| Development (`zsms-dev`) | None | — | No commitment |

99.5% is deliberately modest for a pre-launch product operated by a small team. It should be raised as operational maturity grows, and it must not be published as a contractual SLA until it has been sustained for two consecutive quarters. Committing to a number that has never been measured is how availability commitments become liabilities.

### Recovery objectives

| Objective | Target | Meaning |
|---|---|---|
| RTO (Recovery Time Objective) | 1 hour | Maximum time to restore service |
| RPO (Recovery Point Objective) | 5 minutes | Maximum acceptable data loss |
| Standby failover | 60 seconds | Railway standby promotion (per `RAILWAY.md`) |

---

## Uptime Monitoring

External probes run from outside the infrastructure — monitoring that runs inside the system it monitors cannot report the system being down.

| Probe | Target | Interval | Alert after |
|---|---|---|---|
| Web app health | `/api/health` | 60s | 2 consecutive failures |
| Database connectivity | Health endpoint DB check | 60s | 2 consecutive failures |
| Edge Function | Function health endpoint | 5 min | 2 consecutive failures |
| Queue processing | Worker heartbeat | 5 min | 3 consecutive failures |
| Public site | `/` and `/pricing` | 5 min | 2 consecutive failures |
| Certificate expiry | TLS on primary domain | Daily | 21 days before expiry |

The health endpoint returns component-level status rather than a bare 200, so an alert distinguishes "the app is down" from "the app is up but cannot reach the database":

```
GET /api/health
{
  "status": "ok" | "degraded" | "down",
  "checks": {
    "database": "ok",
    "redis": "ok",        // degraded, not down — see CACHING_CDN.md
    "queue": "ok",
    "storage": "ok"
  },
  "version": "<git sha>",
  "timestamp": "<iso8601>"
}
```

Redis being unavailable returns `degraded`, never `down` — a cache outage degrades latency but the application remains correct.

### Alert routing

| Severity | Condition | Route | Response |
|---|---|---|---|
| Critical | Production down, or down in a critical window | Phone + Slack + email | Immediate |
| High | Component degraded, elevated error rate | Slack + email | Within 1 hour |
| Medium | Staging down, queue backlog, cost alert | Slack | Same day |
| Low | Certificate expiry warning, capacity trend | Email | Same week |

---

## Backups

### What is backed up

| Data | Mechanism | Frequency | Retention |
|---|---|---|---|
| Supabase PostgreSQL | Automated backup + PITR | Continuous (PITR), daily snapshot | 7 days PITR, 30 days snapshot |
| Railway standby | Streaming replication | Continuous | Live replica, not a backup |
| Cloudflare R2 | Bucket versioning | On write | 30 days for deleted objects |
| Encrypted backup vault | Scheduled export | Daily | 90 days |
| Migration files | Git | Per commit | Permanent |
| Configuration (`afritech`) | Included in DB backup | Continuous | As database |

**A replica is not a backup.** The Railway standby protects against Supabase becoming unavailable. It does not protect against a bad migration or a mistaken bulk delete — those replicate to the standby immediately and faithfully. Only PITR and snapshots protect against that class of failure, and this distinction must be understood before an incident rather than during one.

### Backup verification

An unverified backup is a hypothesis. The only evidence that a backup works is a restore.

| Verification | Frequency | Owner | Evidence |
|---|---|---|---|
| Restore a snapshot to a scratch project | Monthly | CTO | Restore log + row count comparison |
| PITR restore to a chosen timestamp | Quarterly | CTO | Restore log + spot-check of known records |
| R2 object version restore | Quarterly | CTO | Restored object checksum match |
| Full recovery drill (see runbook) | Twice yearly | CTO | Timed drill report against RTO/RPO |
| Encrypted vault restore | Quarterly | CTO | Decrypt + integrity check |

Every verification produces a dated artefact. These artefacts are the SOC 2 Availability evidence — and they are also the only reason to believe the RTO above is real.

---

## Recovery Runbooks

Each runbook assumes the responder has production access via a time-limited grant per `SECURITY_POLICIES.md`.

### Runbook 1 — Supabase primary unavailable

```
1. Confirm via Supabase status page and independent probe
   → If Supabase-wide incident, note ETA; failover may be unnecessary
2. Assess duration. Under 15 min in a non-critical window → wait
3. If failing over:
   a. Promote Railway standby to primary (RAILWAY.md)
   b. Update SUPABASE_URL / connection strings in Vercel env
   c. Redeploy or trigger env refresh
   d. Verify /api/health returns ok
4. Announce degraded state — standby is read-optimised; expect
   reduced write throughput
5. When Supabase recovers: reverse-replicate, verify row counts,
   schedule cutback in a low window
6. Post-incident review within 48 hours
```

### Runbook 2 — Bad migration applied to production

```
1. STOP. Do not attempt a corrective migration under pressure.
2. Assess blast radius: which tables, how many rows, is data lost
   or only structurally wrong
3. If structural only and reversible → forward-fix migration,
   applied to integration first (CONVENTIONS.md #10)
4. If data lost → PITR restore to the timestamp immediately before
   the migration:
   a. Restore to a NEW project, never over the live one
   b. Verify the restored state
   c. Export affected tables
   d. Reconcile into production
5. Root cause: this should have been caught at integration.
   Update CI checks (see THIRTEEN_LAYER_COMPLIANCE.md Layer 7 gap)
```

### Runbook 3 — Data loss from application bug or mistaken bulk action

```
1. Identify scope and time window of the loss
2. Check soft delete first — ADR-010 means students, fee records,
   payments, and exam results are never hard deleted.
   Recovery may be a flag update, not a restore.
3. If genuinely deleted: PITR restore to a scratch project,
   extract affected rows, reconcile
4. If audit_logs is intact, reconstruct the sequence of events
   (append-only, no delete policy for any role)
5. Notify affected schools if their data was visibly wrong
6. Assess ZDPA notification obligation — data loss is not
   automatically a breach, but availability failure affecting
   personal data may require notification (COMPLIANCE.md)
```

### Runbook 4 — Queue stopped processing

```
1. Check worker health on Railway — replicas running?
2. Check queue depth and failed job count (BULLMQ.md)
3. If workers down: restart replicas
4. If workers up but not consuming: check Redis connectivity
5. If jobs failing repeatedly: inspect dead letter queue,
   fix root cause before retrying
6. Replay from DLQ once the cause is fixed
7. Assess user impact — unsent receipts, ungenerated report cards,
   undelivered notifications — and communicate to affected schools
```

### Runbook 5 — R2 storage unavailable

```
1. Confirm via Cloudflare status
2. Impact: no PDF generation, no document downloads, no uploads.
   Core academic and fee operations continue.
3. Queue generation jobs rather than failing them —
   they will process when storage returns
4. Communicate: documents temporarily unavailable, no data lost
5. If objects are lost rather than unreachable: restore from
   bucket versioning; regenerate report cards from source data
   if versioning has expired
```

### Runbook 6 — Total region loss

```
1. This is the disaster scenario the encrypted backup vault exists for
   (DEPLOYMENT_TOPOLOGY.md)
2. Provision new Supabase project in an alternate region
3. Restore from the most recent vault export
4. Restore R2 objects (R2 is globally distributed — likely unaffected)
5. Repoint Vercel environment variables and redeploy
6. Expect RPO up to 24 hours in this scenario, not 5 minutes —
   the vault exports daily
7. Notify ZICTA if the recovery region changes data residency posture
   (COMPLIANCE.md)
```

---

## Maintenance Windows

| Type | Window | Notice |
|---|---|---|
| Routine deployment | Any time outside 06:00–08:00 school days | None |
| Database migration | 22:00–05:00 | 48 hours to schools |
| Supabase tier upgrade | 22:00–05:00 | 48 hours |
| Breaking change | School holidays | 2 weeks |

**No deployments during 06:00–08:00 on school days, and none during end-of-term results windows.** These are the two periods where failure causes unrecoverable data loss at the edge.

---

## Business Rules

1. Production availability target is 99.5% monthly, 99.9% within critical windows. This is not published as a contractual SLA until sustained for two consecutive quarters.
2. Backups are verified by restore on the schedule above. An unverified backup does not count as a backup.
3. The Railway standby is a replica, not a backup. Recovery from data corruption uses PITR or vault exports, never the standby.
4. No deployments during 06:00–08:00 on school days or during end-of-term results windows.
5. PITR restores always target a new project, never overwrite the live one.
6. Every critical incident produces a post-incident review within 48 hours, recorded and retained as SOC 2 evidence.
7. Soft delete is checked before any restore is attempted — ADR-010 means most apparent data loss is recoverable with a flag update.
8. Health endpoints report component-level status. Redis unavailability is `degraded`, never `down`.

---

## Edge Cases and Error Handling

**Partial availability.** The app is up but WhatsApp dispatch is failing. This is `degraded`, not `down` — communicate the specific impaired capability rather than declaring an outage. The fallback chain (WhatsApp → Email → SMS) already absorbs some of this.

**Offline clients during an outage.** Teachers continue marking attendance offline throughout a backend outage and sync afterwards. Sync conflicts resolve last-write-wins with server authority per `POWERSYNC.md`. A long outage produces a large sync burst on recovery — expect and absorb it rather than treating it as a second incident.

**Failover during a bulk job.** Report card generation in flight during failover will have partially completed batches. `report_generation_jobs` tracks per-batch progress, so the run resumes rather than restarting from zero.

**Certificate expiry.** Automated through Vercel and Cloudflare, but the 21-day probe exists because expired certificates are a completely avoidable and highly visible outage.

**Self-hosted country deployment failure.** AfriTech does not operate country partner infrastructure and cannot restore it. The encrypted backup vault provides the data of last resort; recovery is the partner's responsibility with AfriTech support. This division must be explicit in the country partner agreement, not discovered during an incident.

---

## Integration Points

- `RAILWAY.md` — standby mechanics and promotion procedure
- `SUPABASE.md` — backup configuration and PITR operation
- `SENTRY.md` — error alerting, typically the earliest incident signal
- `SCALING.md` — capacity failures that present as availability incidents
- `SECURITY_POLICIES.md` — incident response process and production access grants
- `COMPLIANCE.md` — SOC 2 Availability criterion and ZDPA 72-hour breach notification
- `DEPLOYMENT_TOPOLOGY.md` — the encrypted backup vault tier
- `LAUNCH_CHECKLIST.md` — backup verification is a go/no-go item

---

## Security Considerations

Backups contain the complete personal data set and are as sensitive as the production database. Vault exports are encrypted at rest, access is restricted to `afritech:super_admin`, and every restore is logged.

**A restore to a scratch project creates a second copy of production personal data.** Scratch projects must be created in a compliant region, access-restricted, and destroyed immediately after verification. A forgotten restore project is a data breach waiting to be discovered — and it will be discovered by an auditor, not by you.

Availability incidents affecting personal data may trigger ZDPA notification obligations. Loss of availability is a recognised category of personal data incident. Assess notification obligations during every incident review rather than assuming that only confidentiality breaches count.

---

## Known Limitations and Future Work

- The 99.5% target is aspirational and unverified — no production operating history exists.
- Failover is manual. The 60-second standby promotion in `RAILWAY.md` describes the mechanism, not an automated trigger. Real RTO includes human detection and decision time, which is realistically 15–30 minutes outside working hours.
- No status page for schools. During an incident, schools have no self-service way to learn what is happening, which converts every outage into a support burden.
- Backup verification is manual and depends on one person. This is a single point of failure in both the process and the evidence trail.
- No chaos or failure injection testing. Runbooks have never been executed against a real failure, so their accuracy is untested until the first drill.
- Vault export is daily, so the region-loss RPO is up to 24 hours, well outside the 5-minute target that applies to other failure modes.
- Self-hosted country deployments have no AfriTech-verified backup regime beyond the vault.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-08-13 | Initial complete draft | Layer 13 (Availability / Recovery) had no owning document |
| 2026-08-13 | Six recovery runbooks consolidated | Recovery steps were scattered across RAILWAY.md and SUPABASE.md |
| 2026-08-13 | Backup verification schedule defined | An unverified backup is a hypothesis; SOC 2 requires evidence |
| 2026-08-13 | Time-of-day criticality windows documented | Availability requirements are not uniform across the school day |
