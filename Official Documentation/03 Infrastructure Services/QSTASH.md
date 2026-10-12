# QSTASH.md — Upstash QStash Job Queue (Fallback Implementation)

## Related Documents

- `03 Infrastructure Services/BULLMQ.md` — the queue abstraction and the **default** implementation
- `01 Foundation Layer/DECISIONS.md` — **ADR-035 is the single source of truth for queue default selection**
- `01 Foundation Layer/ARCHITECTURE.md` — async job architecture overview
- `03 Infrastructure Services/SUPABASE.md` — Edge Functions that process jobs
- `03 Infrastructure Services/META_API.md` — WhatsApp dispatch triggered via the queue
- `11 Examinations and Results/BULK_GENERATION.md` — PDF generation job batching
- `09 Fee and Financial Management/REMINDERS.md` — scheduled reminder cron jobs
- `07 Student and Parent Modules/BULK_IMPORT.md` — import processing via the queue
- `01 Foundation Layer/ENV.md` — QStash environment variables

---

## Status — Fallback Implementation

> **BullMQ is the default job queue implementation for ZSMS (ADR-035). QStash is the swappable fallback.**
>
> This document describes how QStash is configured and behaves when it is the selected provider. It does **not** describe the default runtime configuration. For the queue abstraction, the default implementation, and the provider switching procedure, see `BULLMQ.md`.
>
> If any statement here appears to conflict with ADR-035, ADR-035 governs.

---

## Implementation Status (2026-10-11)

**Deliberately idle, and correct.** ADR-035 makes BullMQ over Upstash Redis the default,
and it is proven — `npm run queue:smoke` round-trips a real job, and the commands BullMQ
needs (`EVAL`, `XADD`, `BZPOPMIN`) all work on the Upstash free tier.

`packages/queue` abstracts both sides, so QStash remains the fallback it was specified as.
Nothing here is missing; it is unused on purpose.

---

## Purpose

This document covers how QStash is configured and used when selected as the queue provider via `JOB_QUEUE_PROVIDER=qstash`. Every Claude Code session that writes code triggering a background job must use the queue abstraction in `BULLMQ.md` rather than the QStash client directly — this document exists to explain provider behaviour, not to be called from application code.

---

## Overview

QStash is an HTTP message queue provided by Upstash. When selected as the provider, it carries all ZSMS background processing: every operation that takes more than 2 seconds, involves bulk data, or must not block a user-facing request.

The principle is provider-independent: API routes and Edge Functions enqueue jobs immediately and return to the user. The queue delivers those jobs to workers asynchronously. The user sees a progress indicator updated via Supabase Realtime, not a loading spinner waiting for the work to complete.

**Known limitations relative to the BullMQ default.** QStash does not support job priorities or per-worker concurrency control, both of which `SCALING.md` relies on to prevent bulk report card runs from starving payment confirmations. Running on QStash means accepting that bulk and user-facing jobs compete in a single undifferentiated stream. Its per-message pricing also scales linearly with school count (`COST_MANAGEMENT.md`). These are the reasons it is the fallback rather than the default.

---

## How QStash Works

```
User action
  → API route validates and authorises
  → API route calls QStash HTTP API to enqueue a job
  → API route returns 202 Accepted immediately with job ID
  → QStash stores the job
  → QStash delivers the job as an HTTP POST to the worker Edge Function URL
  → Worker Edge Function processes the job
  → Worker writes result to database
  → Supabase Realtime notifies the frontend
  → Frontend updates to show completion
```

QStash retries failed jobs automatically. Dead letter queue captures permanently failing jobs. Rate limiting prevents API abuse. Scheduled jobs replace cron.

---

## Enqueuing a Job

```typescript
// From an API route or Edge Function
const response = await fetch(`${Deno.env.get('QSTASH_URL')}/v2/publish/${workerUrl}`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${Deno.env.get('QSTASH_TOKEN')}`,
    'Content-Type': 'application/json',
    'Upstash-Retries': '3',
    'Upstash-Retry-Delay': '10s',
  },
  body: JSON.stringify({
    school_id: schoolId,
    run_id: runId,
    class_id: classId,
    academic_year: academicYear,
    term_number: termNumber,
  }),
})

const { messageId } = await response.json()
```

The `workerUrl` is the full URL of the Edge Function that will process this job. For production:
`https://[project-ref].supabase.co/functions/v1/generate-report-card`

---

## Verifying QStash Delivery in Worker Functions

Every worker Edge Function must verify that the incoming request is genuinely from QStash, not a spoofed request:

```typescript
import { Receiver } from 'https://esm.sh/@upstash/qstash@2'

const receiver = new Receiver({
  currentSigningKey: Deno.env.get('QSTASH_CURRENT_SIGNING_KEY')!,
  nextSigningKey: Deno.env.get('QSTASH_NEXT_SIGNING_KEY')!,
})

const isValid = await receiver.verify({
  signature: req.headers.get('Upstash-Signature')!,
  body: await req.text(),
})

if (!isValid) {
  return new Response('Unauthorized', { status: 401 })
}
```

QStash rotates signing keys periodically. Both `currentSigningKey` and `nextSigningKey` are validated to handle the transition window.

---

## Job Types and Configuration

### Bulk Report Card Generation

**Trigger:** Principal clicks "Generate All Report Cards"
**Worker:** `generate-report-card` Edge Function
**Batch size:** 30-35 students per job (stays within Edge Function memory limits)
**Retry config:** 3 retries, 30-second delay between retries
**Rate limiting:** None — these jobs run as fast as possible, each independently

```typescript
// Enqueue one job per class
for (const classId of schoolClasses) {
  await enqueueJob('generate-report-card', {
    school_id: schoolId,
    run_id: runId,
    class_id: classId,
    academic_year: year,
    term_number: term,
  }, {
    retries: 3,
    retryDelay: '30s',
  })
}
```

### WhatsApp Bulk Dispatch

**Trigger:** Principal clicks "Send Report Cards to Parents" or bulk announcement
**Worker:** `send-whatsapp` Edge Function
**Rate limiting:** Maximum 60 messages per minute (Meta API limit enforcement)
**Retry config:** 3 retries, 60-second delay (allows Meta API to recover)
**Fallback:** On permanent failure, `send-sms` job enqueued via dead letter queue

```typescript
// Rate-limited WhatsApp dispatch
await fetch(`${QSTASH_URL}/v2/publish/${workerUrl}`, {
  headers: {
    'Upstash-Delay': `${messageIndex}s`,  // Spread messages over time
    'Upstash-Retries': '3',
    'Upstash-Retry-Delay': '60s',
  },
  body: JSON.stringify(messagePayload),
})
```

The `Upstash-Delay` header staggers message dispatch. Message 1 sends immediately, message 2 after 1 second, message 3 after 2 seconds — keeping dispatch rate at 60/minute.

### Student Bulk Import

**Trigger:** Admin uploads student spreadsheet
**Worker:** `process-bulk-import` Edge Function
**Batch size:** 50 rows per job
**Retry config:** 2 retries, 10-second delay
**Note:** Bulk import is not idempotent by default — the worker checks for existing records before inserting to prevent duplicates on retry

### Scheduled Fee Reminders

**Trigger:** Daily cron at 06:00 UTC (08:00 Lusaka time)
**Worker:** `schedule-reminders` Edge Function
**Configuration:** QStash Schedule (cron expression)

```typescript
// Set up the daily reminder schedule (run once during infrastructure setup)
await fetch(`${QSTASH_URL}/v2/schedules`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${QSTASH_TOKEN}`,
    'Content-Type': 'application/json',
    'Upstash-Cron': '0 6 * * *',  // 06:00 UTC daily
  },
  body: JSON.stringify({
    destination: workerUrl,
    body: JSON.stringify({ trigger: 'daily_reminders' }),
  }),
})
```

### Absence Notifications

**Trigger:** Database trigger on `attendance_records` INSERT where `status = 'absent'`
**Worker:** `send-whatsapp` Edge Function
**Retry config:** 3 retries, 10-second delay
**Fallback:** Email notification if WhatsApp fails (within school's monthly quota)
**Note:** Rate limited to prevent flooding when a teacher syncs many days of offline attendance at once — maximum 10 notifications per parent per hour

### Trial Expiry Checks

**Trigger:** Daily cron at 01:00 UTC (03:00 Lusaka time)
**Worker:** `check-trial-expiry` Edge Function
**Action:** Sets `schools.status = 'trial_expired'` for schools where `trial_ends_at < NOW()`, sends notification to AfriTech admin panel

---

## Dead Letter Queue

When a job fails all retry attempts, QStash moves it to the dead letter queue (DLQ). The DLQ requires manual intervention.

**Monitoring:** Check the Upstash console → QStash → Dead Letter Queue daily during pilot phase. Set up an alert (Upstash supports webhook alerts on DLQ events) to notify the AfriTech admin when a job enters the DLQ.

**Common DLQ causes and resolutions:**

| Cause | Resolution |
|---|---|
| Edge Function timeout | Reduce batch size for that job type |
| Invalid payload | Fix the enqueuing code; replay with corrected payload |
| External API down (Meta, lender) | Wait for service recovery, replay from DLQ |
| Database connection error | Usually self-resolves; replay the job |

**Replaying a DLQ job:**
```bash
# Via Upstash console UI or API
curl -X POST "${QSTASH_URL}/v2/dlq/{message_id}/replay" \
  -H "Authorization: Bearer ${QSTASH_TOKEN}"
```

---

## WhatsApp Message Quota Enforcement

School-level WhatsApp quotas are tracked in the database. Before enqueuing a WhatsApp job, the API route checks the school's remaining quota for the current billing period:

```typescript
async function checkAndDeductWhatsAppQuota(
  schoolId: string,
  messageCount: number
): Promise<boolean> {
  const { data: quota } = await supabase
    .from('school_message_quotas')
    .select('remaining_messages')
    .eq('school_id', schoolId)
    .eq('billing_period', currentBillingPeriod())
    .single()

  if (!quota || quota.remaining_messages < messageCount) {
    return false  // Quota exceeded — do not enqueue
  }

  await supabase.rpc('deduct_message_quota', {
    school_id: schoolId,
    count: messageCount,
  })

  return true
}
```

If quota is exceeded, the school sees a notification: "WhatsApp message quota reached for this period. Upgrade your plan or purchase additional credits to send more messages."

---

## Monitoring

**Upstash Console → QStash → Messages** — view all queued, processing, delivered, and failed messages.

**Key metrics to watch:**
- DLQ depth — should be zero at all times
- Average delivery latency — should be under 5 seconds for most jobs
- Retry rate — consistently high retry rate indicates a recurring issue with a worker

**Sentry integration:** Worker Edge Functions report errors to Sentry. If a job fails, the error appears in Sentry before it appears in the DLQ. Sentry is the first place to check when investigating a failing job.

---

## Business Rules

1. Every user-facing API request that triggers background work must return within 2 seconds. The QStash enqueue call is the boundary — enqueue and return, do not wait.
2. All QStash worker Edge Functions must verify the `Upstash-Signature` header before processing. Requests without a valid signature are rejected with 401.
3. Worker functions must be idempotent where possible. QStash retries may deliver the same job multiple times. Workers check for existing results before creating duplicates.
4. WhatsApp job enqueueing checks school quota before adding to the queue. A job is never enqueued for a school that has exceeded its quota.
5. The daily fee reminder cron schedule is configured once during infrastructure setup and is not touched by application deployments.
6. Dead letter queue items are reviewed within 24 hours. Unresolved DLQ items indicate a systemic issue that must be investigated.

---

## Known Limitations and Future Work

- QStash does not support job priorities natively. If report card generation and fee reminders are both queued simultaneously, they compete equally. Future: implement separate queues per job type using different QStash topics.
- The `Upstash-Delay` approach for rate-limited WhatsApp dispatch is functional but not perfectly precise at high volumes. Future: implement a proper token bucket rate limiter using Upstash Redis.
- QStash scheduled jobs (cron) do not have a built-in monitoring dashboard beyond the Upstash console. Future: log each cron execution to a `cron_execution_log` table for reporting.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 3 infrastructure documentation |
| 2026-04-26 | Added WhatsApp quota enforcement section | Portal-first communication model with tiered quotas |
| 2026-04-26 | Added trial expiry check cron job | Confirmed 30-day trial model |
| 2026-08-13 | **Reclassified from primary queue to swappable fallback** | ADR-035 confirms BullMQ as the default implementation |
| 2026-08-13 | Added status banner pointing to BULLMQ.md and ADR-035 | Prevents this document being read as the default runtime configuration |
| 2026-08-13 | Documented limitations relative to BullMQ (no priorities, no concurrency control, linear cost) | Makes the fallback trade-off explicit rather than implied |
