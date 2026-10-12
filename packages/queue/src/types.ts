/**
 * Job queue abstraction — type contract.
 *
 * Spec: `Official Documentation/03 Infrastructure Services/BULLMQ.md`
 * Decision: ADR-035 — BullMQ is the DEFAULT implementation, QStash the
 * swappable fallback. ADR-035 is the single source of truth for that choice.
 *
 * Application code never imports `bullmq` or `@upstash/qstash` directly.
 * The only supported entry point is `getQueue()` from this package.
 */

/** Every background job type in ZSMS. Adding a job type starts here. */
export type JobType =
  | 'send-whatsapp'
  | 'generate-report-card'
  | 'generate-receipt'
  | 'bulk-import-process'
  | 'submit-to-lender'
  | 'dispatch-integration-event'
  | 'check-scheduled-announcements'
  /*
    Moves a school past `trial_ends_at` from `trial` to `trial_expired` (`0244`).

    A trial expires because time passed, not because anybody acted, so there is no
    write to hang a trigger on — it needs a job on a clock. Idempotent, so a cron
    firing twice during a deploy is harmless.
  */
  | 'expire-trials'
  /*
    Renders the letter a family carries to the next school (`0246`, TRANSFER.md).

    Queued rather than rendered in the request, because it must be stored
    permanently in R2 and recorded in `generated_documents` — the same shape
    receipts and report cards already have. It also means a transfer still
    completes when R2 is briefly unavailable: the pupil's status is what must not
    fail, and the letter can be retried.
  */
  | 'generate-transfer-letter'
  | 'calculate-platform-metrics'
  | 'calculate-school-health-scores'
  | 'calculate-churn-risk'
  | 'check-trial-expiry'
  | 'check-override-expiry'
  | 'send-fee-reminders'
  | 'send-absence-alerts'
  | 'send-attendance-summary'
  | 'generate-lesson-plan'

/**
 * Job priority bands.
 *
 * SCALING.md requires that bulk work cannot starve user-facing work — a parent
 * waiting on a payment receipt must not queue behind a 400-student report card
 * run. Bulk jobs run on separate worker replica sets.
 *
 * Priority is one of the principal reasons BullMQ is the default: QStash has
 * no equivalent, so under the fallback these bands are accepted and ignored.
 */
export const JobPriority = {
  HIGH: 1, // payment confirmation, receipts — target < 10s
  NORMAL: 5, // WhatsApp, notifications, integrations — target < 60s
  BULK: 10, // report cards, bulk import, reminders — target < 15min
} as const

export type JobPriorityValue = (typeof JobPriority)[keyof typeof JobPriority]

export interface JobOptions {
  /** Delay before processing, in seconds. */
  delay?: number
  /** 1 (highest) to 10 (lowest). See `JobPriority`. Ignored by QStash. */
  priority?: JobPriorityValue | number
  /** Max attempts before the job lands in the dead letter queue. */
  attempts?: number
  backoff?: {
    type: 'exponential' | 'fixed'
    /** Base delay in milliseconds. */
    delay: number
  }
  /** Absolute time to process at, for scheduled work. */
  scheduledAt?: Date
  /** Same ID = same job. Prevents duplicate dispatch on retry. */
  deduplicationId?: string
}

/**
 * Job payloads carry record IDs only — never PII, never financial amounts.
 * The worker fetches full data by ID at processing time.
 *
 * This is both a payload-size constraint and a security one: a queue is not
 * an RLS-enforced surface, so nothing that RLS protects may enter it.
 * BULLMQ.md business rule 2.
 */
export interface JobPayload {
  [key: string]: string | number | boolean | null | string[] | number[] | undefined
}

export interface EnqueueResult {
  jobId: string
}

export interface JobQueue {
  enqueue(
    jobType: JobType,
    payload: JobPayload,
    options?: JobOptions,
  ): Promise<EnqueueResult>

  scheduleRecurring(
    jobType: JobType,
    cronExpression: string,
    payload?: JobPayload,
  ): Promise<void>

  cancel(jobId: string): Promise<boolean>

  /** Which implementation is active. For health endpoints and diagnostics. */
  readonly provider: QueueProvider
}

export type QueueProvider = 'bullmq' | 'qstash'

/** Resolution: env var if set, otherwise the ADR-035 default. */
export const DEFAULT_QUEUE_PROVIDER: QueueProvider = 'bullmq'
