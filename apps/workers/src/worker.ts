/**
 * ZSMS background workers — process entry point.
 *
 * Spec: `Official Documentation/03 Infrastructure Services/BULLMQ.md`
 * Decision: ADR-035 — BullMQ default, QStash swappable fallback.
 *
 * This file does not import `bullmq`. Worker creation goes through
 * `createWorker()` in `@zsms/queue`, so the provider is a configuration choice
 * on the consuming side exactly as it already was on the producing side.
 *
 * Everything of consequence lives in `./handlers`, which are plain async
 * functions taking IDs. That is what lets them be exercised without Redis.
 *
 * ---------------------------------------------------------------------------
 * OPEN QUESTION — DATABASE ACCESS FROM WORKERS. Flagged, not decided.
 * ---------------------------------------------------------------------------
 * CONVENTIONS.md prohibition 1: "The Supabase service role key is never used
 * outside an Edge Function." A worker is not an Edge Function, yet it must read
 * a payment, its student, and the guardian to send a receipt — and it holds no
 * end-user JWT, because nobody has a session when a cron fires at 08:00.
 *
 * Three ways out, none chosen here:
 *   (a) Workers call Edge Functions for all database work. Honours the rule
 *       literally; adds a hop and a second home for every query.
 *   (b) Amend prohibition 1 to name Railway workers as an equally trusted
 *       server-side context. Probably the intent — the rule exists to keep the
 *       key out of client-reachable code — but a documented rule should be
 *       amended deliberately, not reinterpreted by whoever writes the worker.
 *   (c) A dedicated Postgres role for workers with narrow grants. Most precise,
 *       most work.
 *
 * `createWorkerDeps()` therefore throws. The handlers are complete and tested;
 * only the credential path is deliberately absent.
 */

import { createWorker } from '@zsms/queue'
import { handlePaymentVerified, type PaymentVerifiedDeps } from './handlers/payment-verified'

/**
 * Not implemented. See the note above — guessing here would either violate
 * prohibition 1 or bake in an architecture nobody agreed to.
 */
function createWorkerDeps(): PaymentVerifiedDeps {
  throw new Error(
    'Worker database access is undecided — see the note in worker.ts. Resolve prohibition 1 ' +
      'for workers before running this against an environment holding data.',
  )
}

export async function startWorkers(): Promise<void> {
  // Receipts are user-facing: a parent is waiting on the confirmation of money
  // they just handed over. SCALING.md requires this not to queue behind a
  // 400-student report card run, which is why it has its own worker and its
  // own concurrency rather than sharing a general one.
  await createWorker<{ paymentId: string }, unknown>(
    'generate-receipt',
    async ({ payload }) => {
      if (!payload?.paymentId) {
        // Malformed jobs are not retryable. Failing immediately sends this to
        // the dead letter queue for inspection instead of looping.
        throw new Error('generate-receipt job has no paymentId')
      }
      return handlePaymentVerified(payload.paymentId, createWorkerDeps())
    },
    {
      concurrency: 10,
      // Meta's WhatsApp API ceiling. Applied at the worker rather than in the
      // provider so a burst queues instead of being rejected downstream.
      limiter: { max: 100, duration: 1000 },
    },
  )

  console.log('ZSMS workers started.')
}

if (process.env['NODE_ENV'] !== 'test') {
  startWorkers().catch((err: unknown) => {
    console.error('Worker startup failed:', err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
}
