/**
 * QStash implementation — the swappable FALLBACK (ADR-035).
 *
 * Active only when JOB_QUEUE_PROVIDER=qstash. See QSTASH.md.
 * This is the only file in the monorepo permitted to import `@upstash/qstash`.
 *
 * Known limitations relative to the BullMQ default:
 *   - No job priorities. `options.priority` is accepted and ignored, so bulk
 *     work competes with user-facing work in one undifferentiated stream.
 *   - No per-worker concurrency control or rate limiting.
 *   - Per-message pricing scales linearly with school count.
 *
 * These are the reasons it is the fallback rather than the default.
 */

import {
  type EnqueueResult,
  type JobOptions,
  type JobPayload,
  type JobQueue,
  type JobType,
  type QueueProvider,
} from './types'

interface QStashClientLike {
  publishJSON(opts: Record<string, unknown>): Promise<{ messageId: string }>
  schedules: { create(opts: Record<string, unknown>): Promise<unknown> }
  messages: { delete(id: string): Promise<unknown> }
}

export class QStashQueue implements JobQueue {
  readonly provider: QueueProvider = 'qstash'

  private client: QStashClientLike | null = null
  private token: string
  private baseUrl: string

  constructor() {
    const token = process.env['QSTASH_TOKEN']
    const baseUrl = process.env['NEXT_PUBLIC_ZSMS_URL']

    if (!token) {
      throw new Error('QSTASH_TOKEN is required when JOB_QUEUE_PROVIDER=qstash.')
    }
    if (!baseUrl) {
      throw new Error('NEXT_PUBLIC_ZSMS_URL is required for QStash job delivery URLs.')
    }

    this.token = token
    this.baseUrl = baseUrl
  }

  private async getClient(): Promise<QStashClientLike> {
    if (this.client) return this.client

    // TODO(Phase 0): install `@upstash/qstash` and replace with a static import.
    const { Client } = (await import('@upstash/qstash')) as unknown as {
      Client: new (opts: { token: string }) => QStashClientLike
    }

    this.client = new Client({ token: this.token })
    return this.client
  }

  async enqueue(
    jobType: JobType,
    payload: JobPayload,
    options: JobOptions = {},
  ): Promise<EnqueueResult> {
    const client = await this.getClient()

    // options.priority is intentionally dropped — QStash has no equivalent.
    const response = await client.publishJSON({
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
    payload: JobPayload = {},
  ): Promise<void> {
    const client = await this.getClient()
    await client.schedules.create({
      destination: `${this.baseUrl}/api/jobs/${jobType}`,
      cron: cronExpression,
      body: JSON.stringify(payload),
    })
  }

  async cancel(jobId: string): Promise<boolean> {
    try {
      const client = await this.getClient()
      await client.messages.delete(jobId)
      return true
    } catch {
      return false
    }
  }
}
