/**
 * Job queue factory — the ONLY export application code may import.
 *
 * Spec: `Official Documentation/03 Infrastructure Services/BULLMQ.md`
 * Decision: ADR-035 — BullMQ default, QStash swappable fallback.
 *
 *   import { getQueue, JobPriority } from '@zsms/queue'
 *   await getQueue().enqueue('send-whatsapp', { message_log_id }, {
 *     priority: JobPriority.HIGH,
 *   })
 *
 * Never:
 *   import { Queue } from 'bullmq'          // ✗
 *   import { Client } from '@upstash/qstash' // ✗
 */

import { BullMQQueue } from './bullmq-queue'
import { QStashQueue } from './qstash-queue'
import { DEFAULT_QUEUE_PROVIDER, type JobQueue, type QueueProvider } from './types'

let instance: JobQueue | null = null

function resolveProvider(): QueueProvider {
  const configured = process.env['JOB_QUEUE_PROVIDER']?.trim().toLowerCase()

  if (!configured) return DEFAULT_QUEUE_PROVIDER
  if (configured === 'bullmq' || configured === 'qstash') return configured

  throw new Error(
    `Invalid JOB_QUEUE_PROVIDER: "${configured}". Expected "bullmq" or "qstash". ` +
      `Unset the variable to use the default ("${DEFAULT_QUEUE_PROVIDER}", ADR-035).`,
  )
}

/**
 * Returns the process-wide queue instance, constructing it on first call.
 *
 * BullMQ unless JOB_QUEUE_PROVIDER=qstash is set explicitly. A typo in that
 * variable throws rather than silently falling back — a queue running on the
 * wrong provider loses job priorities without any visible signal.
 */
export function getQueue(): JobQueue {
  if (instance) return instance

  const provider = resolveProvider()
  instance = provider === 'qstash' ? new QStashQueue() : new BullMQQueue()
  return instance
}

/** Test-only. Resets the memoised instance so provider selection can be re-run. */
export function __resetQueueForTests(): void {
  instance = null
}

export {
  JobPriority,
  DEFAULT_QUEUE_PROVIDER,
  type JobQueue,
  type JobType,
  type JobOptions,
  type JobPayload,
  type JobPriorityValue,
  type EnqueueResult,
  type QueueProvider,
} from './types'

export { createWorker } from './worker'
export type {
  JobWorker,
  JobHandler,
  JobContext,
  WorkerOptions,
} from './worker'
