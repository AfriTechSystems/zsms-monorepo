/**
 * Registers every recurring job.
 *
 * Spec: `03 Infrastructure Services/BULLMQ.md`,
 *       `06 School and Tenant Management/TRIAL.md`
 *
 * ## Why this file had to be written
 *
 * `scheduleRecurring()` has existed in `packages/queue` on both the BullMQ and QStash
 * sides, with a matching entry in the shared type — and **nothing called it, ever.**
 *
 * So `check-scheduled-announcements` had a worker, a handler, and a comment at the top
 * of that handler reading "cron every 15 minutes (BULLMQ.md)". There was no cron. A
 * school scheduling an announcement for Monday morning would have it sit in the table
 * indefinitely, because the only thing that would have picked it up was never asked to
 * run.
 *
 * Found on 2026-10-11 while adding `expire-trials`, which would have had exactly the
 * same problem: a worker nothing wakes.
 *
 * ## Registered on worker startup, not by a separate command
 *
 * A schedule registered by a command somebody has to remember to run is a schedule that
 * is missing after the first redeploy. BullMQ keys repeatable jobs by name and pattern,
 * so re-registering on every boot is idempotent — the same job is not queued twice, and
 * a changed cron expression replaces the old one rather than running alongside it.
 *
 * ## Africa/Lusaka, which the queue sets for us
 *
 * `scheduleRecurring()` passes `tz: 'Africa/Lusaka'`, so "02:00" below means two in the
 * morning in Zambia rather than in UTC. That matters for `expire-trials`: a trial ending
 * "today" should expire at the end of the Zambian day, not two hours before it.
 */

import { getQueue } from '@zsms/queue'

interface Recurring {
  jobType: Parameters<ReturnType<typeof getQueue>['scheduleRecurring']>[0]
  cron: string
  why: string
}

const SCHEDULE: Recurring[] = [
  {
    jobType: 'check-scheduled-announcements',
    /*
      Every 15 minutes, which `BULLMQ.md` and the handler's own header both specify.

      Fifteen is a compromise worth knowing: a school scheduling an announcement for
      07:00 may see it sent at 07:14. Running every minute would make the lag
      imperceptible and multiply the claim query by fifteen for a gain nobody asked
      for.
    */
    cron: '*/15 * * * *',
    why: 'send announcements a school scheduled for a future time',
  },
  {
    jobType: 'expire-trials',
    /*
      02:00 Lusaka, daily.

      Overnight because the status change blocks writes (`0149`), and a school
      discovering that mid-morning — mid-registration, mid-register — is a worse
      experience than finding it when they arrive. It also puts the change before the
      working day rather than during it, so support hears about it at a sensible hour.
    */
    cron: '0 2 * * *',
    why: 'move schools past trial_ends_at to trial_expired (0244)',
  },
]

/**
 * Called once from `worker.ts` after the workers are listening.
 *
 * Order matters slightly: registering a schedule before a worker exists to serve it
 * would queue jobs with nothing to take them. They would wait rather than be lost, but
 * the first run after a deploy would be a backlog instead of one job.
 */
export async function registerRecurringJobs(): Promise<void> {
  const queue = getQueue()

  for (const entry of SCHEDULE) {
    try {
      await queue.scheduleRecurring(entry.jobType, entry.cron)
      console.log(`[schedule] ${entry.jobType} — ${entry.cron} — ${entry.why}`)
    } catch (error) {
      /*
        Logged, not thrown.

        A failed schedule registration must not stop the workers starting: the
        event-driven jobs — receipts, report cards — are the ones a user is waiting on,
        and taking them down because a cron could not be registered trades an urgent
        failure for a patient one.
      */
      console.error(
        `[schedule] FAILED to register ${entry.jobType}:`,
        error instanceof Error ? error.message : error,
      )
    }
  }
}
