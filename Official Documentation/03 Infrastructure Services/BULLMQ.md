# BULLMQ.md — Job Queue Architecture (BullMQ Default, QStash Fallback)

## Related Documents

- `01 Foundation Layer/DECISIONS.md` — **ADR-035 is the single source of truth for queue default selection**
- `01 Foundation Layer/ARCHITECTURE.md` — queue position in the overall stack
- `03 Infrastructure Services/QSTASH.md` — the swappable fallback implementation
- `03 Infrastructure Services/RAILWAY.md` — hosts the BullMQ workers and Redis
- `03 Infrastructure Services/SCALING.md` — worker scaling and job priority separation
- `05 Core Database and API Reference/EDGE_FUNCTIONS.md` — Edge Functions that process jobs
- `01 Foundation Layer/ENV.md` — queue environment variables

---

## Purpose

This document defines the job queue architecture — the abstraction layer that keeps all background job dispatch independent of the underlying queue provider. **BullMQ is the default implementation. QStash is the swappable fallback.** Every Claude Code session building any background job must use the queue abstraction defined here — never call BullMQ or QStash directly.

---

## Default Implementation

**BullMQ on Railway is the default job queue implementation for ZSMS, confirmed in ADR-035.** QStash remains a fully supported alternative implementation behind the same interface, retained as a fallback for deployments where running persistent workers is impractical.

`DECISIONS.md` ADR-035 is the single source of truth for this decision. If any document appears to state otherwise, ADR-035 governs and the other document is wrong.

**Why BullMQ is the default:**

| Reason | Detail |
|---|---|
| Job priorities | `SCALING.md` requires bulk report card runs not to starve payment confirmations. BullMQ supports priority natively; QStash does not. |
| Concurrency control | Per-worker concurrency and rate limiting (e.g. Meta's API limits) are configured directly on the worker. |
| Cost at volume | Per-message pricing scales linearly with school count; a persistent worker does not. |
| Operational visibility | Bull Board gives queue depth, retry history, and a dead letter queue in one view. |
| Self-hosted parity | Tier 2 deployments (`DEPLOYMENT_TOPOLOGY.md`) run BullMQ on local Redis — the same implementation, not a substitute. |

**When QStash is used instead:** deployments without persistent worker hosting, or as a temporary fallback if Railway workers are unavailable. Switching is one environment variable.

---

## The Abstraction Principle

The single most important rule for all background job code:

```
NEVER import BullMQ or QStash clients directly in application code.
ALWAYS use the JobQueue interface from packages/utils/queue.
```

The default implementation can change — and has — without any feature code changing. That property is the point of the abstraction and must be preserved.

---

## The JobQueue Interface

```typescript
// packages/utils/queue/types.ts

export interface JobOptions {
  delay?: number           // Delay in seconds before processing
  priority?: number        // 1 (highest) to 10 (lowest) — BullMQ only
  attempts?: number        // Max retry attempts (default: 3)
  backoff?: {
    type: 'exponential' | 'fixed'
    delay: number          // Base delay in milliseconds
  }
  scheduledAt?: Date       // Specific time to process (cron scheduling)
  deduplicationId?: string // Prevent duplicate jobs — same ID = same job
}

export interface JobQueue {
  enqueue(
    jobType: JobType,
    payload: JobPayload,
    options?: JobOptions
  ): Promise<{ jobId: string }>

  scheduleRecurring(
    jobType: JobType,
    cronExpression: string,
    payload?: Partial<JobPayload>
  ): Promise<void>

  cancel(jobId: string): Promise<boolean>
}

export type JobType =
  | 'send-whatsapp'
  | 'generate-report-card'
  | 'generate-receipt'
  | 'bulk-import-process'
  | 'submit-to-lender'
  | 'dispatch-integration-event'
  | 'check-scheduled-announcements'
  | 'calculate-platform-metrics'
  | 'calculate-school-health-scores'
  | 'calculate-churn-risk'
  | 'check-trial-expiry'
  | 'check-override-expiry'
  | 'send-fee-reminders'
  | 'send-attendance-summary'
  | 'generate-lesson-plan'
```

---

## Fallback Implementation — QStash

Retained as a supported alternative behind the same interface. Not the default.

```typescript
// packages/utils/queue/qstash-queue.ts

import { Client } from '@upstash/qstash'

export class QStashQueue implements JobQueue {
  private client: Client
  private baseUrl: string

  constructor() {
    this.client = new Client({ token: process.env.QSTASH_TOKEN! })
    this.baseUrl = process.env.NEXT_PUBLIC_ZSMS_URL!
  }

  async enqueue(
    jobType: JobType,
    payload: JobPayload,
    options: JobOptions = {}
  ): Promise<{ jobId: string }> {
    const response = await this.client.publishJSON({
      url: `${this.baseUrl}/api/jobs/${jobType}`,
      body: payload,
      delay: options.delay,
      notBefore: options.scheduledAt
        ? Math.floor(options.scheduledAt.getTime() / 1000)
        : undefined,
      retries: options.attempts ?? 3,
      deduplicationId: options.deduplicationId,
    })

    return { jobId: response.messageId }
  }

  async scheduleRecurring(
    jobType: JobType,
    cronExpression: string,
    payload: Partial<JobPayload> = {}
  ): Promise<void> {
    await this.client.schedules.create({
      destination: `${this.baseUrl}/api/jobs/${jobType}`,
      cron: cronExpression,
      body: JSON.stringify(payload),
    })
  }

  async cancel(jobId: string): Promise<boolean> {
    try {
      await this.client.messages.delete(jobId)
      return true
    } catch {
      return false
    }
  }
}
```

---

## Default Implementation — BullMQ

This is the implementation ZSMS runs by default (ADR-035).

```typescript
// packages/utils/queue/bullmq-queue.ts

import { Queue, QueueScheduler } from 'bullmq'
import IORedis from 'ioredis'

export class BullMQQueue implements JobQueue {
  private queues: Map<JobType, Queue> = new Map()
  private connection: IORedis

  constructor() {
    this.connection = new IORedis(process.env.BULLMQ_REDIS_URL!, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    })
  }

  private getQueue(jobType: JobType): Queue {
    if (!this.queues.has(jobType)) {
      this.queues.set(jobType, new Queue(jobType, {
        connection: this.connection,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 30000 },
          removeOnComplete: { count: 1000 },
          removeOnFail: { count: 5000 },
        },
      }))
    }
    return this.queues.get(jobType)!
  }

  async enqueue(
    jobType: JobType,
    payload: JobPayload,
    options: JobOptions = {}
  ): Promise<{ jobId: string }> {
    const queue = this.getQueue(jobType)

    const job = await queue.add(jobType, payload, {
      delay: options.delay ? options.delay * 1000 : undefined,
      priority: options.priority,
      attempts: options.attempts ?? 3,
      backoff: options.backoff,
      jobId: options.deduplicationId,  // BullMQ deduplication via jobId
    })

    return { jobId: job.id! }
  }

  async scheduleRecurring(
    jobType: JobType,
    cronExpression: string,
    payload: Partial<JobPayload> = {}
  ): Promise<void> {
    const queue = this.getQueue(jobType)
    await queue.add(jobType, payload, {
      repeat: { cron: cronExpression, tz: 'Africa/Lusaka' },
    })
  }

  async cancel(jobId: string): Promise<boolean> {
    // BullMQ requires knowing which queue the job is in
    // Implementation depends on job tracking store
    return false // Override if needed
  }
}
```

---

## The Queue Factory — Zero-Config Switching

```typescript
// packages/utils/queue/index.ts
// This is the ONLY export that application code should import

import { QStashQueue } from './qstash-queue'
import { BullMQQueue } from './bullmq-queue'
import type { JobQueue } from './types'

let queueInstance: JobQueue | null = null

export function getQueue(): JobQueue {
  if (!queueInstance) {
    // BullMQ is the default (ADR-035). QStash is opt-in fallback.
    const provider = process.env.JOB_QUEUE_PROVIDER ?? 'bullmq'

    queueInstance = provider === 'qstash'
      ? new QStashQueue()
      : new BullMQQueue()
  }
  return queueInstance
}

// Re-export types for convenience
export type { JobQueue, JobType, JobOptions } from './types'
```

**Default configuration — BullMQ:**
```bash
# In .env — JOB_QUEUE_PROVIDER may be omitted; bullmq is the default
BULLMQ_REDIS_URL=redis://default:password@railway-redis-host:6379
```

**Falling back to QStash:**
```bash
# In .env — one line change
JOB_QUEUE_PROVIDER=qstash
QSTASH_TOKEN=...
```

Zero application code changes in either direction. All `getQueue().enqueue(...)` calls follow the configured provider.

---

## Usage in Application Code

```typescript
// Correct — uses the abstraction (resolves to BullMQ by default)
import { getQueue } from '@zsms/utils/queue'

await getQueue().enqueue('send-whatsapp', {
  message_log_id: logId,
  school_id: schoolId,
  recipient_phone: phone,
  template_id: 'fee_payment_confirmed',
  variables: [schoolName, studentName, amount],
}, {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30000 },
})

// WRONG — never do this
import { Client } from '@upstash/qstash'   // ❌ Direct import
import { Queue } from 'bullmq'              // ❌ Direct import
```

---

## BullMQ Workers on Railway

Persistent workers run on Railway, separate from the Vercel web app. These are provisioned in Phase 0 of `BUILD_SEQUENCE.md` — they are part of the default stack, not a later addition. Worker replica counts and job priority separation are specified in `SCALING.md`.

```typescript
// railway-workers/src/workers/whatsapp-worker.ts
import { Worker } from 'bullmq'
import IORedis from 'ioredis'

const connection = new IORedis(process.env.BULLMQ_REDIS_URL!)

const whatsappWorker = new Worker(
  'send-whatsapp',
  async (job) => {
    const { message_log_id, school_id, recipient_phone, template_id, variables } = job.data

    await processWhatsAppJob({
      messageLogId: message_log_id,
      schoolId: school_id,
      recipientPhone: recipient_phone,
      templateId: template_id,
      variables,
    })
  },
  {
    connection,
    concurrency: 10,    // Process 10 WhatsApp jobs simultaneously
    limiter: {
      max: 100,         // Max 100 jobs per duration
      duration: 1000,   // Per second (Meta API rate limit)
    },
  }
)

// Worker health monitoring
whatsappWorker.on('completed', (job) => {
  console.log(`Job ${job.id} completed`)
})

whatsappWorker.on('failed', (job, error) => {
  console.error(`Job ${job?.id} failed:`, error.message)
  // Sentry alert for repeated failures
})
```

**Worker deployment on Railway:**
```yaml
# railway.toml
[[services]]
name = "zsms-workers"
source = "railway-workers"
startCommand = "node dist/index.js"
healthcheckPath = "/health"
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
```

---

## BullMQ Dashboard (Bull Board)

BullMQ provides Bull Board — a web dashboard for monitoring job queues:

```typescript
// railway-workers/src/dashboard.ts
import { createBullBoard } from '@bull-board/api'
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter'
import { ExpressAdapter } from '@bull-board/express'
import express from 'express'

const serverAdapter = new ExpressAdapter()
serverAdapter.setBasePath('/admin/queues')

createBullBoard({
  queues: [
    new BullMQAdapter(whatsappQueue),
    new BullMQAdapter(reportCardQueue),
    new BullMQAdapter(integrationQueue),
    // ... all queues
  ],
  serverAdapter,
})

// Protected behind AfriTech staff authentication
app.use('/admin/queues', authenticateAfriTechStaff, serverAdapter.getRouter())
```

The Bull Board is accessible only to AfriTech developers and super admins. It shows:
- Jobs in queue, processing, completed, and failed
- Job retry history
- Queue throughput metrics
- Dead letter queue (failed jobs for manual inspection)

---

## Cron Jobs Schedule

Both implementations support cron scheduling, so the schedule is provider-independent. Standard ZSMS crons:

| Job | Cron Expression | Timezone | Description |
|---|---|---|---|
| `check-trial-expiry` | `0 6 * * *` | Africa/Lusaka | Daily at 08:00 CAT |
| `check-override-expiry` | `30 0 * * *` | UTC | Daily at 02:30 UTC |
| `calculate-platform-metrics` | `0 2 * * *` | UTC | Daily at 02:00 UTC |
| `calculate-school-health-scores` | `0 3 * * *` | UTC | Daily at 03:00 UTC |
| `calculate-churn-risk` | `0 4 * * *` | UTC | Daily at 04:00 UTC |
| `check-scheduled-announcements` | `*/15 * * * *` | UTC | Every 15 minutes |
| `send-fee-reminders` | `0 8 * * *` | Africa/Lusaka | Daily at 08:00 CAT |
| `send-attendance-summary` | `0 20 28-31 * *` | Africa/Lusaka | Last days of month at 20:00 |

---

## Provider Switching

Switching providers in either direction is a configuration change, never a code change. This is the property ADR-035 depends on and it is verified by running the queue integration tests against both providers.

**Falling back to QStash** (persistent workers unavailable, or a Railway incident):
```
1. Set JOB_QUEUE_PROVIDER=qstash and QSTASH_TOKEN in the environment
2. Redeploy or refresh environment variables
3. Re-register cron schedules with QStash
4. Verify jobs are dispatching (Sentry + message_log)
5. Accept the known loss: no job priorities, no per-worker concurrency control
```

**Returning to BullMQ** (the default):
```
1. Ensure Railway Redis and workers are running
2. Set BULLMQ_REDIS_URL; remove JOB_QUEUE_PROVIDER or set it to bullmq
3. Redeploy
4. Verify via Bull Board that workers are consuming
5. Cancel QStash schedules so jobs are not dispatched twice
```

**The double-dispatch risk is the one real hazard in switching.** Cron schedules registered with both providers will both fire. Always cancel schedules on the provider being left before considering the switch complete.

---

## Self-Hosted Deployments

Tier 2 deployments (`DEPLOYMENT_TOPOLOGY.md`) run BullMQ against a local Redis instance. Because BullMQ is the default rather than a substitute, self-hosted and centrally hosted deployments run **the same queue implementation** — only the Redis connection string differs. This removes an entire class of behavioural divergence between tiers.

---

## Business Rules

1. Application code NEVER imports BullMQ or QStash clients directly. The `getQueue()` factory is the only entry point.
2. All job payloads contain only IDs — never PII, never financial amounts. The worker fetches full data from the database by ID. This is required for payload size limits and for security (no sensitive data in the queue).
3. Every job is idempotent where possible — processing the same job twice produces the same result without side effects.
4. Job failures are logged to Sentry AND update the relevant ZSMS record (e.g. `message_log.status = 'failed'`). Silent failures are not acceptable.
5. **BullMQ is the default implementation (ADR-035).** The `JOB_QUEUE_PROVIDER` environment variable defaults to `bullmq` when unset. Setting it to `qstash` switches all dispatch to the fallback implementation.
6. When switching providers, cron schedules on the provider being left are cancelled before the switch is considered complete. Schedules active on both providers cause double dispatch.
7. Jobs are enqueued per batch, never per record, wherever the operation permits batching (`COST_MANAGEMENT.md`).
8. Bulk-priority jobs run on separate worker replicas from high-priority jobs so bulk work cannot starve user-facing work (`SCALING.md`).

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-06-23 | Initial complete draft | Job queue abstraction confirmed as architecture improvement |
| 2026-06-23 | QStash implementation as Phase 1 default | Operational simplicity for launch |
| 2026-06-23 | BullMQ implementation ready for Phase 2 | Migration plan with zero code changes |
| 2026-06-23 | Railway workers configuration | BullMQ requires persistent workers |
| 2026-08-13 | **BullMQ confirmed as the DEFAULT implementation; QStash reclassified as swappable fallback** | ADR-035 — job priorities, concurrency control, cost at volume, and Tier 2 parity |
| 2026-08-13 | Queue factory default changed from `qstash` to `bullmq` | Reflects ADR-035; `JOB_QUEUE_PROVIDER` unset now resolves to BullMQ |
| 2026-08-13 | Migration plan replaced with bidirectional provider switching | Switching is now a fallback procedure, not a one-way upgrade |
| 2026-08-13 | ADR-035 named as single source of truth for queue default | Prevents the QStash-first/BullMQ-first contradiction recurring |
