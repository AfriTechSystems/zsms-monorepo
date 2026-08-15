/**
 * check-scheduled-announcements — cron every 15 minutes (BULLMQ.md).
 *
 * Claims announcements whose scheduled time has passed and dispatches them to
 * the school's parents down the fallback chain.
 *
 * ---------------------------------------------------------------------------
 * RECIPIENTS COME FROM THE ANNOUNCEMENT, NEVER FROM THE CALLER.
 * ---------------------------------------------------------------------------
 * `worker_announcement_recipients()` joins students to the announcement's OWN
 * school_id. A cron cannot be pointed at school A's announcement and school B's
 * parents, because the recipient list is derived rather than passed — which is
 * the single most damaging mistake this job could make.
 */

import { sendWithFallback, type DispatchContext } from '@zsms/notifications'

export interface ClaimedAnnouncement {
  announcementId: string
  schoolId: string
  title: string
  body: string
  targetType: string
}

export interface AnnouncementRecipient {
  userId: string | null
  name: string
  phone: string | null
  email: string | null
  studentId: string | null
}

export interface ScheduledAnnouncementDeps {
  /** Atomically claims due announcements, flipping them to 'sending'. */
  claimDue(limit: number): Promise<ClaimedAnnouncement[]>
  /** Recipients for one announcement, derived from its own school. */
  loadRecipients(announcementId: string): Promise<AnnouncementRecipient[]>
  schoolName(schoolId: string): Promise<string>
  complete(input: { announcementId: string; status: string; jobsQueued: number }): Promise<void>
  dispatch: DispatchContext
}

export interface ScheduledAnnouncementResult {
  claimed: number
  dispatched: number
  quotaBlocked: number
  failed: number
}

export async function handleScheduledAnnouncements(
  deps: ScheduledAnnouncementDeps,
  limit = 50,
): Promise<ScheduledAnnouncementResult> {
  const claimed = await deps.claimDue(limit)
  const result: ScheduledAnnouncementResult = {
    claimed: claimed.length,
    dispatched: 0,
    quotaBlocked: 0,
    failed: 0,
  }

  for (const a of claimed) {
    const recipients = await deps.loadRecipients(a.announcementId)
    const schoolName = await deps.schoolName(a.schoolId)
    let queued = 0
    let failedHere = 0

    for (const r of recipients) {
      const outcome = await sendWithFallback(
        {
          schoolId: a.schoolId,
          templateKey: 'school_announcement',
          recipient: {
            phoneE164: r.phone ?? undefined,
            email: r.email ?? undefined,
            userId: r.userId ?? undefined,
          },
          studentId: r.studentId,
          variables: { school_name: schoolName, title: a.title, body: a.body },
        },
        deps.dispatch,
      )

      if (outcome.deliveredVia) {
        queued += 1
      } else {
        failedHere += 1
        // A quota refusal on WhatsApp is logged as its own message_log row by
        // the chain. Counted separately here because "the school ran out of
        // allowance" and "the provider failed" need different responses.
        if (outcome.attempts.some((x) => x.error === 'quota_exceeded')) {
          result.quotaBlocked += 1
        }
      }
    }

    result.dispatched += queued
    result.failed += failedHere

    // 'sent' even when some recipients failed: the announcement was issued, and
    // per-recipient outcomes live in message_log. Marking it 'failed' because
    // one parent had no phone number would hide it from every other parent.
    await deps.complete({
      announcementId: a.announcementId,
      status: queued > 0 || recipients.length === 0 ? 'sent' : 'failed',
      jobsQueued: queued,
    })
  }

  return result
}
