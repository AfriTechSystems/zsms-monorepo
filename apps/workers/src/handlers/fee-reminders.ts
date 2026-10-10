/**
 * send-fee-reminders — daily cron, 08:00 CAT (BULLMQ.md).
 *
 * Reads the arrears fields the Phase 2.5 work built: `arrears_amount`,
 * `days_overdue`, `is_overdue` from `student_fee_balance`, and the per-record
 * `last_reminder_at` / `reminder_count` cooldown.
 *
 * ---------------------------------------------------------------------------
 * A REMINDER IS A MESSAGE, NOT A CONSEQUENCE.
 * ---------------------------------------------------------------------------
 * ADR-038 is explicit that the arrears model computes and never enforces. This
 * job sends a message and records that it did. It does not withhold a result,
 * flag an account, or change any status — and it must not be extended to.
 */

import { sendWithFallback, type DispatchContext } from '@zsms/notifications'

export interface DueReminder {
  schoolId: string
  schoolName: string
  studentId: string
  studentName: string
  feeRecordId: string
  parentUserId: string | null
  parentName: string
  parentPhone: string | null
  parentEmail: string | null
  currency: string
  arrearsAmount: string
  daysOverdue: number
}

export interface FeeReminderDeps {
  /** Families due a reminder. Scoped per school when schoolId is supplied. */
  loadDueReminders(input: {
    schoolId?: string
    minDaysOverdue: number
    cooldownDays: number
    limit: number
  }): Promise<DueReminder[]>
  markReminderSent(feeRecordId: string): Promise<void>
  dispatch: DispatchContext
}

export interface FeeReminderResult {
  considered: number
  sent: number
  failed: number
  perSchool: Record<string, number>
}

export interface FeeReminderOptions {
  /** Restricts the run to one school. Omitted for the platform-wide cron. */
  schoolId?: string
  minDaysOverdue?: number
  cooldownDays?: number
  limit?: number
}

export async function handleFeeReminders(
  deps: FeeReminderDeps,
  options: FeeReminderOptions = {},
): Promise<FeeReminderResult> {
  const due = await deps.loadDueReminders({
    ...(options.schoolId ? { schoolId: options.schoolId } : {}),
    // Defaults are conservative. A family one day late does not need a message
    // at 08:00; the values are overridable per run and belong in configuration
    // once the reminder schedule is school-editable.
    minDaysOverdue: options.minDaysOverdue ?? 3,
    cooldownDays: options.cooldownDays ?? 7,
    limit: options.limit ?? 500,
  })

  const result: FeeReminderResult = {
    considered: due.length,
    sent: 0,
    failed: 0,
    perSchool: {},
  }

  for (const r of due) {
    const outcome = await sendWithFallback(
      {
        schoolId: r.schoolId,
        templateKey: 'fee_reminder',
        recipient: {
          phoneE164: r.parentPhone ?? undefined,
          email: r.parentEmail ?? undefined,
          userId: r.parentUserId ?? undefined,
        },
        studentId: r.studentId,
        variables: {
          parent_name: r.parentName,
          student_name: r.studentName,
          currency: r.currency,
          arrears_amount: r.arrearsAmount,
          days_overdue: String(r.daysOverdue),
          school_name: r.schoolName,
        },
      },
      deps.dispatch,
    )

    if (outcome.deliveredVia) {
      // Only a delivered reminder starts the cooldown. Marking it sent after a
      // failure would silence the next run too, and the family would hear
      // nothing at all.
      await deps.markReminderSent(r.feeRecordId)
      result.sent += 1
      result.perSchool[r.schoolId] = (result.perSchool[r.schoolId] ?? 0) + 1
    } else {
      result.failed += 1
    }
  }

  return result
}
