/**
 * Expires trials that have run out.
 *
 * Spec: `06 School and Tenant Management/TRIAL.md`
 *
 * ## Why this job exists at all
 *
 * `schools.status` has admitted `trial_expired` since `0003` and nothing ever set it.
 * On 2026-10-11 one school on `zsms-dev` was past its end date with full access — a
 * school using ZSMS for free with no mechanism that would ever notice.
 *
 * A trial expires because time passed, not because anybody did anything. There is no
 * write to hang a trigger on, so it needs something that runs on a clock.
 *
 * ## No `.from()`, by rule
 *
 * ADR-042: a worker's connection uses the service role and bypasses RLS, so all of its
 * data access goes through `worker_*` functions. `.from(` anywhere in `apps/workers` is
 * a defect, and `worker_boundary_test` asserts it.
 *
 * ## It does not notify, and that is honest rather than lazy
 *
 * TRIAL.md specifies ten touchpoints — days 1, 3, 7, 14, 25, 28, 30, expiry, 33, 37.
 * None is sent, because every delivery channel still runs through the mock provider and
 * no message has left this machine. Expiring the trial without warning anybody is the
 * wrong half to ship on its own, so the log line below names each school expired: until
 * email works, that log is the notification, and somebody reading it can telephone.
 */

export interface ExpiredTrial {
  schoolId: string
  schoolCode: string
  name: string
  endedAt: string
}

export interface ExpireTrialsResult {
  expired: ExpiredTrial[]
  count: number
}

/**
 * One narrow dependency, matching how every other handler here is built.
 *
 * The handler never sees a Supabase client, so it cannot reach for `.from()` even by
 * accident — the worker boundary is enforced by what this type does not offer, not only
 * by a grep.
 */
export interface ExpireTrialsDeps {
  expireOverdueTrials: () => Promise<ExpiredTrial[]>
}

export async function handleExpireTrials(
  deps: ExpireTrialsDeps,
): Promise<ExpireTrialsResult> {
  // Throws on failure so BullMQ retries. A trial live one extra hour is a small cost;
  // one live because a failure was swallowed is not.
  const expired = await deps.expireOverdueTrials()

  /*
    Each school named, not just a count.

    With no email channel this log IS the notification. A count of 3 tells somebody
    that something happened; three school names and codes tell them who to ring.
  */
  for (const school of expired) {
    console.log(
      `[expire-trials] ${school.name} (${school.schoolCode}) — trial ended ${school.endedAt}`,
    )
  }

  if (expired.length === 0) {
    // Logged too. A scheduled job that is silent when it finds nothing is
    // indistinguishable from one that is not running.
    console.log('[expire-trials] no overdue trials')
  }

  return { expired, count: expired.length }
}
