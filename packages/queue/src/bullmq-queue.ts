/**
 * BullMQ implementation — the DEFAULT (ADR-035).
 *
 * Backed by Railway Redis; persistent workers run on Railway per RAILWAY.md.
 * This is the only file in the monorepo permitted to import `bullmq`.
 *
 * Phase 0 status: interface-complete, dependency not yet installed. The
 * dynamic import below is resolved at first enqueue so the scaffold
 * type-checks and builds without `bullmq` present.
 */

import {
  DEFAULT_QUEUE_PROVIDER,
  type EnqueueResult,
  type JobOptions,
  type JobPayload,
  type JobQueue,
  type JobType,
  type QueueProvider,
} from './types.js'

/** Minimal structural type for the bullmq Queue surface we use. */
interface BullQueueLike {
  add(
    name: string,
    data: JobPayload,
    opts?: Record<string, unknown>,
  ): Promise<{ id?: string | undefined }>
  remove(jobId: string): Promise<number>
}

export class BullMQQueue implements JobQueue {
  readonly provider: QueueProvider = DEFAULT_QUEUE_PROVIDER

  private queues = new Map<JobType, BullQueueLike>()
  private connectionUrl: string

  constructor() {
    const url = process.env['BULLMQ_REDIS_URL']
    if (!url) {
      throw new Error(
        'BULLMQ_REDIS_URL is required when the queue provider is "bullmq" ' +
          '(the default per ADR-035). Set it, or set JOB_QUEUE_PROVIDER=qstash ' +
          'to use the fallback implementation.',
      )
    }
    this.connectionUrl = url
  }

  private async getQueue(jobType: JobType): Promise<BullQueueLike> {
    const existing = this.queues.get(jobType)
    if (existing) return existing

    // TODO(Phase 0): install `bullmq` + `ioredis` and replace with a static import.
    const { Queue } = (await import('bullmq')) as unknown as {
      Queue: new (name: string, opts: Record<string, unknown>) => BullQueueLike
    }

    const queue = new Queue(jobType, {
      connection: { url: this.connectionUrl },
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    })

    this.queues.set(jobType, queue)
    return queue
  }

  async enqueue(
    jobType: JobType,
    payload: JobPayload,
    options: JobOptions = {},
  ): Promise<EnqueueResult> {
    const queue = await this.getQueue(jobType)

    const job = await queue.add(jobType, payload, {
      delay: options.delay !== undefined ? options.delay * 1000 : undefined,
      priority: options.priority,
      attempts: options.attempts ?? 3,
      backoff: options.backoff,
      jobId: options.deduplicationId,
    })

    if (!job.id) throw new Error(`BullMQ returned no job id for "${jobType}"`)
    return { jobId: job.id }
  }

  async scheduleRecurring(
    jobType: JobType,
    cronExpression: string,
    payload: JobPayload = {},
  ): Promise<void> {
    const queue = await this.getQueue(jobType)
    await queue.add(jobType, payload, {
      repeat: { pattern: cronExpression, tz: 'Africa/Lusaka' },
    })
  }

  async cancel(jobId: string): Promise<boolean> {
    for (const queue of this.queues.values()) {
      try {
        const removed = await queue.remove(jobId)
        if (removed > 0) return true
      } catch {
        // Job not in this queue — continue.
      }
    }
    return false
  }
}
