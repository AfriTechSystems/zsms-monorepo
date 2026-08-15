/**
 * Worker abstraction — the consuming half of the queue contract.
 *
 * Spec: `Official Documentation/03 Infrastructure Services/BULLMQ.md`
 * Decision: ADR-035.
 *
 * WHY THIS EXISTS
 * ---------------
 * `getQueue()` abstracted *producing* jobs, but BULLMQ.md's own worker example
 * imports `bullmq` directly in the Railway app — so consuming was never behind
 * the abstraction at all. That leaves a direct provider import outside the
 * wrapper, which is precisely what ADR-035 says must not happen: switching
 * providers would be a configuration change for producers and a refactor for
 * consumers.
 *
 * The two halves are genuinely asymmetric, and the abstraction has to admit it:
 *
 *   BullMQ  — workers PULL from Redis. A long-lived process.
 *   QStash  — pushes over HTTP to an endpoint. There is no worker process to
 *             start; the "worker" is a route handler verifying a signature.
 *
 * So `createWorker()` is meaningful under BullMQ and impossible under QStash,
 * and it says so rather than pretending otherwise. That is the honest shape of
 * the fallback: ADR-035 already records that switching to QStash loses job
 * priorities and per-worker concurrency, and this is the same trade seen from
 * the consuming side.
 */

import type { JobType } from './types'
import { DEFAULT_QUEUE_PROVIDER, type QueueProvider } from './types'

export interface WorkerOptions {
  /** Jobs processed simultaneously by this worker. */
  concurrency?: number
  /** Provider rate limit, e.g. Meta's API ceiling. */
  limiter?: { max: number; duration: number }
}

export interface JobContext<TPayload> {
  id: string
  payload: TPayload
  attemptsMade: number
}

export type JobHandler<TPayload, TResult> = (ctx: JobContext<TPayload>) => Promise<TResult>

export interface JobWorker {
  readonly jobType: JobType
  readonly provider: QueueProvider
  close(): Promise<void>
}

function resolveProvider(): QueueProvider {
  const configured = process.env['JOB_QUEUE_PROVIDER']?.trim().toLowerCase()
  if (!configured) return DEFAULT_QUEUE_PROVIDER
  if (configured === 'bullmq' || configured === 'qstash') return configured
  throw new Error(`Invalid JOB_QUEUE_PROVIDER: "${configured}". Expected "bullmq" or "qstash".`)
}

/**
 * Starts a worker for one job type.
 *
 * The `bullmq` import is dynamic so that importing this module does not require
 * the dependency to be installed or Redis to be reachable — a handler test must
 * not need either.
 */
export async function createWorker<TPayload, TResult>(
  jobType: JobType,
  handler: JobHandler<TPayload, TResult>,
  options: WorkerOptions = {},
): Promise<JobWorker> {
  const provider = resolveProvider()

  if (provider === 'qstash') {
    throw new Error(
      'QStash does not support pull workers. It delivers jobs by HTTP POST, so under ' +
        'JOB_QUEUE_PROVIDER=qstash a job is handled by a route that verifies the QStash ' +
        'signature and calls the same handler. See ADR-035 and BULLMQ.md.',
    )
  }

  const redisUrl = process.env['BULLMQ_REDIS_URL']
  if (!redisUrl) {
    throw new Error('BULLMQ_REDIS_URL is not set. A BullMQ worker cannot start without Redis.')
  }

  const { Worker } = await import('bullmq')
  const { default: IORedis } = await import('ioredis')

  const connection = new IORedis(redisUrl, {
    // Required by BullMQ; without it a blocking command throws on reconnect.
    maxRetriesPerRequest: null,
  })

  const worker = new Worker(
    jobType,
    async (job) =>
      handler({
        id: String(job.id ?? ''),
        payload: job.data as TPayload,
        attemptsMade: job.attemptsMade,
      }),
    {
      connection,
      concurrency: options.concurrency ?? 5,
      ...(options.limiter ? { limiter: options.limiter } : {}),
    },
  )

  worker.on('failed', (job, error) => {
    console.error(`[${jobType}] job ${job?.id} failed:`, error.message)
  })
  worker.on('completed', (job) => {
    console.log(`[${jobType}] job ${job.id} completed`)
  })

  return {
    jobType,
    provider,
    async close() {
      await worker.close()
      await connection.quit()
    },
  }
}
