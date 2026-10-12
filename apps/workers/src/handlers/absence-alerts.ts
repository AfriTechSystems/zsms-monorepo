/**
 * Tell a parent their child was marked absent.
 *
 * Spec: `10 Attendance/NOTIFICATIONS.md` → *Channel 3 — Per-Absence Alert*
 *       `10 Attendance/TRIGGERS.md` → *Trigger 1*, and ADR-047 for why this is a
 *       polled worker rather than the trigger that document specifies.
 *
 * ## Polled, not triggered
 *
 * TRIGGERS.md puts an HTTP call inside the register's own transaction. A teacher
 * marking a class of forty with eight absences would block the INSERT on eight
 * sequential round-trips, and a failure would either roll back the teacher's attendance
 * — losing the wrong thing — or silently drop the alert.
 *
 * So `worker_due_absence_alerts()` is polled, and `attendance_records.parent_notified`
 * is the idempotency key those columns were shaped for in `0074` and never used. A crash
 * mid-batch re-reads the same rows and sends only the unmarked ones: the failure mode is
 * a late alert, never a lost or duplicated one.
 *
 * ## Off unless a school asked
 *
 * `0255` defaults `per_absence_alert_enabled` to FALSE and the SQL filters on it, so
 * this handler cannot message anybody at a school that has not opted in. That is
 * deliberate rather than defensive: NOTIFICATIONS.md's own arithmetic is that 400 pupils
 * at 5% daily absence spends about 80% of the Starter tier's monthly quota on these
 * alerts alone.
 */

import { sendWithFallback, type DispatchContext } from '@zsms/notifications'

export interface DueAbsenceAlert {
  recordId: string
  schoolId: string
  schoolName: string
  studentId: string
  studentName: string
  classId: string
  attendanceDate: string
  status: string
  parentUserId: string | null
  parentName: string
  parentPhone: string | null
  parentEmail: string | null
  /** The school's channel choices, resolved in SQL by `0255`. */
  viaWhatsapp: boolean
  viaEmail: boolean
  viaPush: boolean
}

export interface AbsenceAlertDeps {
  loadDueAlerts(input: { schoolId?: string; limit: number }): Promise<DueAbsenceAlert[]>
  markAlerted(recordId: string): Promise<void>
  dispatch: DispatchContext
}

export interface AbsenceAlertResult {
  considered: number
  sent: number
  failed: number
  perSchool: Record<string, number>
}

export async function runAbsenceAlerts(
  deps: AbsenceAlertDeps,
  options: { schoolId?: string; limit?: number } = {},
): Promise<AbsenceAlertResult> {
  const due = await deps.loadDueAlerts({
    schoolId: options.schoolId,
    limit: options.limit ?? 500,
  })

  const result: AbsenceAlertResult = {
    considered: due.length,
    sent: 0,
    failed: 0,
    perSchool: {},
  }

  for (const a of due) {
    const outcome = await sendWithFallback(
      {
        schoolId: a.schoolId,
        templateKey: 'absence_alert',
        /*
          The school's channel choices gate what the dispatcher is even offered.

          Withholding the address is the enforcement — passing a phone number and
          trusting the fallback chain to skip WhatsApp would make the setting
          decoration, and WhatsApp is the channel that costs the school quota.
        */
        recipient: {
          phoneE164: a.viaWhatsapp ? (a.parentPhone ?? undefined) : undefined,
          email: a.viaEmail ? (a.parentEmail ?? undefined) : undefined,
          userId: a.viaPush ? (a.parentUserId ?? undefined) : undefined,
        },
        studentId: a.studentId,
        variables: {
          parent_name: a.parentName,
          student_name: a.studentName,
          status: a.status,
          attendance_date: a.attendanceDate,
          class_id: a.classId,
          school_name: a.schoolName,
        },
      },
      deps.dispatch,
    )

    if (outcome.deliveredVia) {
      /*
        Only a delivered alert is marked. Stamping on attempt would turn one
        provider outage into a notification that never arrives and that nothing
        will retry — the same rule the fee reminder worker follows.
      */
      await deps.markAlerted(a.recordId)
      result.sent += 1
      result.perSchool[a.schoolId] = (result.perSchool[a.schoolId] ?? 0) + 1
    } else {
      result.failed += 1
    }
  }

  return result
}
