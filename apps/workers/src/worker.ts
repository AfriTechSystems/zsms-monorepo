/**
 * ZSMS background workers — process entry point.
 *
 * Spec: `Official Documentation/03 Infrastructure Services/BULLMQ.md`
 * Decision: ADR-035 (BullMQ default, QStash fallback), ADR-042 (service role
 *           permitted in a Railway worker).
 *
 * This file imports no provider SDK. Worker creation goes through
 * `createWorker()` in `@zsms/queue`, so the queue provider is a configuration
 * choice on the consuming side exactly as it already was on the producing side.
 *
 * Everything of consequence lives in `./handlers` — plain async functions taking
 * IDs. That is what lets them be exercised without Redis, which is how the gate
 * harness runs.
 */

import { createWorker } from '@zsms/queue'
import { createWorkerDeps, workerDb } from './db'
import { registerRecurringJobs } from './schedule'
import { handlePaymentVerified } from './handlers/payment-verified'
import { handleFeeReminders, type DueReminder } from './handlers/fee-reminders'
import { handleExpireTrials, type ExpiredTrial } from './handlers/expire-trials'
import {
  handleTransferLetter,
  type TransferLetterContext,
} from './handlers/transfer-letter'
import {
  handleScheduledAnnouncements,
  type AnnouncementRecipient,
  type ClaimedAnnouncement,
} from './handlers/scheduled-announcements'
import { handleReportCardBatch, type BatchStudent } from './handlers/report-card-batch'
import type { SchoolBranding } from '@zsms/documents'

// ---------------------------------------------------------------------------
// Cron dependency adapters
//
// Each reads through a `worker_*` function from migration 0090. Those functions
// anchor every join to a single school internally, which is where the tenant
// boundary lives now that the connection bypasses RLS (ADR-042).
//
// Do not replace one of these with a direct table query.
// ---------------------------------------------------------------------------

function feeReminderDeps() {
  const db = workerDb()
  const { dispatch } = createWorkerDeps()

  return {
    async loadDueReminders(input: {
      schoolId?: string
      limit: number
    }): Promise<DueReminder[]> {
      /*
        No thresholds passed. `0252` resolves them per school from
        `school_fee_reminder_settings`, so there is nowhere left for a constant
        to hide — this used to send `?? 3` and `?? 7`, which decided when every
        school in Zambia chased a parent for money.
      */
      const { data, error } = await db.rpc('worker_due_fee_reminders', {
        p_school_id: input.schoolId ?? null,
        p_limit: input.limit,
      })
      if (error) throw new Error(`Loading due reminders failed: ${error.message}`)

      return (data ?? []).map((r: Record<string, unknown>) => ({
        schoolId: r['out_school_id'] as string,
        schoolName: r['out_school_name'] as string,
        studentId: r['out_student_id'] as string,
        studentName: r['out_student_name'] as string,
        feeRecordId: r['out_fee_record_id'] as string,
        parentUserId: (r['out_parent_user_id'] as string) ?? null,
        parentName: r['out_parent_name'] as string,
        parentPhone: (r['out_parent_phone'] as string) ?? null,
        parentEmail: (r['out_parent_email'] as string) ?? null,
        currency: r['out_currency'] as string,
        arrearsAmount: r['out_arrears_amount'] as string,
        daysOverdue: r['out_days_overdue'] as number,
        // Which rung, so the handler can pick the final-notice wording.
        thresholdDays: r['out_threshold_days'] as number,
        isFinal: Boolean(r['out_is_final']),
        viaWhatsapp: Boolean(r['out_via_whatsapp']),
        viaEmail: Boolean(r['out_via_email']),
        viaInApp: Boolean(r['out_via_in_app']),
      }))
    },

    async markReminderSent(feeRecordId: string): Promise<void> {
      const { error } = await db.rpc('worker_mark_reminder_sent', { p_fee_record_id: feeRecordId })
      if (error) throw new Error(`Marking reminder sent failed: ${error.message}`)
    },

    dispatch,
  }
}

function announcementDeps() {
  const db = workerDb()
  const { dispatch } = createWorkerDeps()

  return {
    async claimDue(limit: number): Promise<ClaimedAnnouncement[]> {
      const { data, error } = await db.rpc('worker_claim_scheduled_announcements', {
        p_limit: limit,
      })
      if (error) throw new Error(`Claiming announcements failed: ${error.message}`)

      return (data ?? []).map((r: Record<string, unknown>) => ({
        announcementId: r['out_announcement_id'] as string,
        schoolId: r['out_school_id'] as string,
        title: r['out_title'] as string,
        body: r['out_body'] as string,
        targetType: r['out_target_type'] as string,
      }))
    },

    async loadRecipients(announcementId: string): Promise<AnnouncementRecipient[]> {
      // Note there is no schoolId parameter. Recipients are derived from the
      // announcement's own school, so a caller cannot pair one school's
      // announcement with another's parents.
      const { data, error } = await db.rpc('worker_announcement_recipients', {
        p_announcement_id: announcementId,
        p_limit: 2000,
      })
      if (error) throw new Error(`Loading recipients failed: ${error.message}`)

      return (data ?? []).map((r: Record<string, unknown>) => ({
        userId: (r['out_user_id'] as string) ?? null,
        name: r['out_name'] as string,
        phone: (r['out_phone'] as string) ?? null,
        email: (r['out_email'] as string) ?? null,
        studentId: (r['out_student_id'] as string) ?? null,
      }))
    },

    async schoolName(schoolId: string): Promise<string> {
      const { data } = await db.rpc('worker_school_branding', { p_school_id: schoolId })
      return (data as { name?: string } | null)?.name ?? 'Your school'
    },

    async complete(input: { announcementId: string; status: string; jobsQueued: number }) {
      const { error } = await db.rpc('worker_complete_announcement', {
        p_announcement_id: input.announcementId,
        p_status: input.status,
        p_jobs_queued: input.jobsQueued,
      })
      if (error) throw new Error(`Completing announcement failed: ${error.message}`)
    },

    dispatch,
  }
}

function reportCardDeps() {
  const db = workerDb()
  const base = createWorkerDeps()

  return {
    async loadBranding(schoolId: string): Promise<SchoolBranding> {
      const { data } = await db.rpc('worker_school_branding', { p_school_id: schoolId })
      const b = data as {
        name?: string
        schoolCode?: string
        address?: string | null
        anchorColor?: string | null
        primaryColor?: string | null
      } | null
      return {
        name: b?.name ?? 'School',
        schoolCode: b?.schoolCode ?? 'UNKNOWN',
        address: b?.address ?? undefined,
        // NULL here is a school that has not set a brand, not an error: the
        // renderer falls back to ZSMS navy.
        anchorColor: b?.anchorColor ?? undefined,
        primaryColor: b?.primaryColor ?? undefined,
      }
    },

    async loadBatch(input: {
      schoolId: string
      academicYear: string
      termNumber: number
      classId?: string
    }): Promise<BatchStudent[]> {
      const { data, error } = await db.rpc('worker_report_card_batch', {
        p_school_id: input.schoolId,
        p_academic_year: input.academicYear,
        p_term_number: input.termNumber,
        p_class_id: input.classId ?? null,
      })
      if (error) throw new Error(`Loading report card batch failed: ${error.message}`)

      return (data ?? []).map((r: Record<string, unknown>) => ({
        studentId: r['out_student_id'] as string,
        studentName: r['out_student_name'] as string,
        studentCode: r['out_student_code'] as string,
        classId: r['out_class_id'] as string,
        subjects: (r['out_subjects'] as BatchStudent['subjects']) ?? [],
      }))
    },

    async recordDocument(input: {
      schoolId: string
      studentId: string
      academicYear: string
      termNumber: number
    }) {
      const { data, error } = await db.rpc('record_generated_document', {
        p_school_id: input.schoolId,
        p_doc_type: 'report_card',
        p_student_id: input.studentId,
        p_payment_id: null,
        p_academic_year: input.academicYear,
        p_term_number: input.termNumber,
        p_generated_by: null,
      })
      if (error) throw new Error(`Recording report card failed: ${error.message}`)
      return data as string
    },

    completeDocument: base.completeDocument,
    storeDocument: base.storeDocument,
  }
}

// ---------------------------------------------------------------------------
// Workers
// ---------------------------------------------------------------------------

export async function startWorkers(): Promise<void> {
  // Receipts are user-facing: a parent is waiting on confirmation of money they
  // just handed over. SCALING.md requires this not to queue behind a
  // 400-student report card run, which is why it has its own worker.
  await createWorker<{ paymentId: string }, unknown>(
    'generate-receipt',
    async ({ payload }) => {
      if (!payload?.paymentId) {
        // Malformed jobs are not retryable — straight to the dead letter queue.
        throw new Error('generate-receipt job has no paymentId')
      }
      return handlePaymentVerified(payload.paymentId, createWorkerDeps())
    },
    {
      concurrency: 10,
      // Meta's WhatsApp ceiling, applied at the worker so a burst queues rather
      // than being rejected downstream.
      limiter: { max: 100, duration: 1000 },
    },
  )

  await createWorker<{ schoolId?: string }, unknown>(
    'send-fee-reminders',
    async ({ payload }) =>
      handleFeeReminders(feeReminderDeps(), payload?.schoolId ? { schoolId: payload.schoolId } : {}),
    // BULK. A reminder run touching every school must never starve a receipt.
    { concurrency: 2 },
  )

  /*
    One narrow call, so the handler never holds a Supabase client.

    ADR-042: a worker's connection bypasses RLS, so everything goes through a
    `worker_*` function. The handler cannot reach for `.from()` even by accident
    because its dependency type does not offer one.
  */
  function expireTrialsDeps() {
    return {
      async expireOverdueTrials(): Promise<ExpiredTrial[]> {
        const { data, error } = await workerDb().rpc('worker_expire_overdue_trials', {})
        if (error) {
          throw new Error(`worker_expire_overdue_trials failed: ${error.message}`)
        }
        return ((data ?? []) as Array<Record<string, string>>).map((r) => ({
          schoolId: r['out_school_id']!,
          schoolCode: r['out_school_code']!,
          name: r['out_name']!,
          endedAt: r['out_ended_at']!,
        }))
      },
    }
  }

  /*
    The letter's whole context in one call, through a `worker_*` function.

    The worker bypasses RLS, so every extra table it could reach is another place a
    bug crosses a tenant boundary. One pupil id in, one row out.
  */
  function transferLetterDeps() {
    const base = createWorkerDeps()
    return {
      async loadContext(studentId: string): Promise<TransferLetterContext | null> {
        const { data, error } = await workerDb().rpc('worker_transfer_letter_context', {
          p_student_id: studentId,
        })
        if (error) throw new Error(`worker_transfer_letter_context: ${error.message}`)

        const row = (Array.isArray(data) ? data[0] : data) as
          | Record<string, string | null>
          | undefined
        if (!row) return null

        return {
          school: {
            name: row['out_school_name'] ?? 'School',
            schoolCode: row['out_school_code'] ?? '',
          },
          ministryRegistrationNumber: row['out_ministry_reg'],
          studentName: row['out_student_name'] ?? '',
          studentCode: row['out_student_code'] ?? '',
          enrolledOn: row['out_enrolled_on'] ?? '',
          transferredOn: row['out_transferred_on'] ?? '',
          finalGradeLevel: row['out_final_grade'] ?? '',
          kind: row['out_kind'] === 'withdrawn' ? 'withdrawn' : 'transferred',
          destination: null,
          principalName: row['out_principal_name'],
        }
      },
      /*
        Its own `recordDocument`, because the shared one hardcodes
        `payment_receipt` and demands a payment id, an academic year and a term —
        none of which a transfer letter has.
      */
      async recordDocument(input: { schoolId: string; studentId: string }) {
        const { data, error } = await workerDb().rpc('record_generated_document', {
          p_school_id: input.schoolId,
          p_doc_type: 'transfer_letter',
          p_student_id: input.studentId,
          p_payment_id: null,
          p_academic_year: null,
          p_term_number: null,
          p_generated_by: null,
        })
        if (error) throw new Error(`Recording the transfer letter failed: ${error.message}`)
        return data as string
      },
      storeDocument: base.storeDocument,
      completeDocument: base.completeDocument,
    }
  }

  await createWorker<
    { studentId: string; schoolId: string; transferReference: string },
    unknown
  >(
    'generate-transfer-letter',
    async ({ payload }) => {
      if (!payload?.studentId || !payload.schoolId || !payload.transferReference) {
        throw new Error('generate-transfer-letter job is missing its identifiers')
      }
      return handleTransferLetter(payload, transferLetterDeps())
    },
    // One page per job, and a family may be waiting at the office counter.
    { concurrency: 3 },
  )

  await createWorker<Record<string, never>, unknown>(
    'expire-trials',
    async () => handleExpireTrials(expireTrialsDeps()),
    /*
      Concurrency 1. The UPDATE is atomic and idempotent, so a second runner would be
      harmless — and there is nothing to gain, because the whole job is one statement.
    */
    { concurrency: 1 },
  )

  await createWorker<Record<string, never>, unknown>(
    'check-scheduled-announcements',
    async () => handleScheduledAnnouncements(announcementDeps()),
    // Concurrency 1: the claim is atomic, but a single runner keeps ordering
    // predictable and there is no throughput reason for more.
    { concurrency: 1 },
  )

  await createWorker<
    { schoolId: string; academicYear: string; termNumber: number; classId?: string },
    unknown
  >(
    'generate-report-card',
    async ({ payload }) => {
      if (!payload?.schoolId || !payload.academicYear || !payload.termNumber) {
        throw new Error('generate-report-card job is missing schoolId, academicYear, or termNumber')
      }
      return handleReportCardBatch(payload, reportCardDeps())
    },
    { concurrency: 2 },
  )

  /*
    After the workers are listening, never before.

    Registering a schedule first would queue jobs with nothing to take them — they
    would wait rather than be lost, but the first run after a deploy would be a
    backlog instead of a single job.
  */
  await registerRecurringJobs()

  console.log('ZSMS workers started: generate-receipt, send-fee-reminders, check-scheduled-announcements, generate-report-card, expire-trials, generate-transfer-letter')
}

if (process.env['NODE_ENV'] !== 'test') {
  startWorkers().catch((err: unknown) => {
    console.error('Worker startup failed:', err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
}
