/**
 * Proves a job can round-trip through Redis.
 *
 * Spec: `Official Documentation/03 Infrastructure Services/BULLMQ.md`
 * Decision: ADR-035 — BullMQ over Redis is the default, QStash the fallback
 *
 * ## Why this script exists
 *
 * `CLAUDE.md` has carried this caveat since Phase 3: *"the logic is proven, the delivery is not …
 * **no job has round-tripped through Redis**"*. Four workers are registered and tested against their
 * handlers, and until Upstash existed there was no way to find out whether the transport underneath
 * them worked at all.
 *
 * It deliberately goes through `packages/queue` rather than talking to Redis directly. A `PING` over
 * the REST API proves the credentials; it proves nothing about `enqueue()`, the provider selection in
 * `getQueue()`, the job-name mapping, or whether a worker's handler is actually reached. Those are the
 * parts that would fail in production, and they only run through the abstraction.
 *
 * ## What it checks, in order
 *
 *   1. `getQueue()` picks BullMQ rather than QStash from the environment
 *   2. `enqueue()` accepts a job and returns an id — the connection works
 *   3. a worker created by `createWorker()` receives that exact job and its payload
 *   4. the whole thing completes inside a timeout rather than hanging
 *
 * Step 3 is the one that matters. An `enqueue()` that succeeds against a queue nobody is listening to
 * is the failure mode this caveat was really about: it looks like working software and delivers
 * nothing.
 *
 * Run: `npm run queue:smoke` with Redis credentials present.
 *
 * ## It uses a real job type, on purpose
 *
 * `send-whatsapp` rather than an invented `test-job`, because the queue names the BullMQ queue after
 * the job type — a made-up type would exercise a queue no worker will ever read, and prove less. The
 * payload is marked so a handler could ignore it, and nothing downstream is touched: this script
 * registers its own worker and no notification provider is involved.
 */

/**
 * Relative paths, not `@zsms/queue`.
 *
 * `scripts/ai-smoke.ts` does the same and it is not stylistic: a root-level script run through
 * `node --import tsx` does not resolve workspace package names the way a build inside `apps/web` does.
 * The first attempt here imported by package name and hung with no output at all — not even the first
 * `console.log` — which reads as a Redis timeout and is a module-resolution failure.
 */
import { createWorker } from '../packages/queue/src/worker'
import { getQueue } from '../packages/queue/src/index'

const TIMEOUT_MS = 20_000

async function main(): Promise<void> {
  const provider = process.env['JOB_QUEUE_PROVIDER'] ?? '(unset)'
  const hasUrl = Boolean(process.env['BULLMQ_REDIS_URL'])

  console.log(`Provider: ${provider}   BULLMQ_REDIS_URL: ${hasUrl ? 'present' : 'MISSING'}`)
  if (!hasUrl) {
    console.error('\nBULLMQ_REDIS_URL is not set. Nothing to test — see CREDENTIALS_CHECKLIST.md.')
    process.exitCode = 1
    return
  }

  // A marker unique to this run, so a job left behind by an earlier attempt cannot be mistaken for
  // this one's success.
  const marker = `smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  let resolveReceived: (payload: Record<string, unknown>) => void
  const received = new Promise<Record<string, unknown>>((resolve) => {
    resolveReceived = resolve
  })

  // `createWorker` is async — it opens the connection before returning, so awaiting it is what
  // proves the worker is actually listening rather than about to be.
  const worker = await createWorker('send-whatsapp', async (ctx) => {
    const payload = ctx.payload as Record<string, unknown>
    // Only this run's job. A queue may hold others, and completing on the first thing that arrives
    // would make the test pass for the wrong reason.
    if (payload['smokeMarker'] === marker) resolveReceived(payload)
  })

  console.log('Worker listening on "send-whatsapp".')

  const queue = getQueue()
  const result = await queue.enqueue('send-whatsapp', {
    smokeMarker: marker,
    note: 'queue-smoke: registers its own worker, sends nothing',
  })

  console.log(`Enqueued: ${result.jobId ?? '(no id returned)'}`)

  const timeout = new Promise<never>((_, reject) => {
    setTimeout(
      () =>
        reject(
          new Error(
            `No worker received the job within ${TIMEOUT_MS / 1000}s. The enqueue succeeded, so the ` +
              `credentials are right — this is the transport or the worker wiring.`,
          ),
        ),
      TIMEOUT_MS,
    )
  })

  try {
    const payload = await Promise.race([received, timeout])
    console.log('\n✓ Round-tripped through Redis.')
    console.log(`  marker matched: ${payload['smokeMarker'] === marker}`)
    console.log('\nThe Phase 3 caveat in CLAUDE.md can be narrowed: a job now provably reaches a')
    console.log('worker. Live message DELIVERY is still unproven — that needs provider credentials.')
  } finally {
    // Closed explicitly, or the process hangs on an open Redis connection and the script looks like
    // it failed when it passed.
    // `JobWorker.close()` exists; `JobQueue` has no close — the queue holds no long-lived
    // connection of its own, and closing the worker releases the one this script opened.
    await worker.close()
  }
}

main().catch((error: unknown) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
