/**
 * payment-verified — the Phase 3 gate handler.
 *
 * A verified payment produces a receipt PDF, then notifies the parent down the
 * fallback chain with the receipt attached.
 *
 * Spec: `Official Documentation/13 Document and PDF System/PDF_GENERATION.md`
 *       `Official Documentation/12 Communication System/WHATSAPP.md`
 *
 * THE HANDLER IS SEPARATE FROM THE WORKER ON PURPOSE.
 * A BullMQ Worker is transport: it pulls a job off Redis and calls this. Keeping
 * the work in a plain async function means it can be exercised without Redis,
 * and it is the same code path either way. `worker.ts` is a thin adapter.
 *
 * THE JOB CARRIES AN ID AND NOTHING ELSE. Everything below is fetched at
 * processing time. A queue is not access-controlled storage — a payload naming
 * an amount or a phone number leaks it to anyone who can read the queue.
 */

import { renderReceipt } from '@zsms/documents'
import { sendWithFallback, type DispatchContext } from '@zsms/notifications'

/** Everything the handler needs, fetched by ID. */
export interface PaymentVerifiedDeps {
  /** Loads the payment and its surrounding context. Returns null if not found. */
  loadPayment(paymentId: string): Promise<PaymentContext | null>
  /** Persists the PDF and returns its storage path. */
  storeDocument(input: {
    schoolId: string
    path: string
    bytes: Uint8Array
  }): Promise<string>
  /** Creates the generated_documents row; returns its id. */
  recordDocument(input: {
    schoolId: string
    studentId: string
    paymentId: string
    academicYear: string
    termNumber: number
  }): Promise<string>
  completeDocument(input: {
    documentId: string
    status: 'ready' | 'failed'
    storagePath?: string
    byteSize?: number
    error?: string
  }): Promise<void>
  dispatch: DispatchContext
}

export interface PaymentContext {
  paymentId: string
  schoolId: string
  school: {
    name: string
    schoolCode: string
    address?: string
    logoBytes?: Uint8Array
    /** Brand colours from `school_branding` (0092/0093). Absent = ZSMS default. */
    anchorColor?: string
    primaryColor?: string
  }
  receiptNumber: string
  paidAt: string
  amount: string
  currency: string
  paymentMethod: string
  recordedBy: string
  verifiedBy?: string
  student: {
    id: string
    name: string
    code: string
  }
  fee: {
    label: string
    academicYear: string
    termNumber: number
    amountPaidToDate: string
    outstanding: string
  }
  /** Primary guardian. Null when the student has no active link. */
  parent: {
    userId?: string
    name: string
    phoneE164?: string
    email?: string
  } | null
}

export interface PaymentVerifiedResult {
  documentId: string
  storagePath: string
  deliveredVia: string | null
  messageLogIds: string[]
  skippedNotification?: string
}

export async function handlePaymentVerified(
  paymentId: string,
  deps: PaymentVerifiedDeps,
): Promise<PaymentVerifiedResult> {
  const ctx = await deps.loadPayment(paymentId)
  if (!ctx) {
    throw new Error(`Payment ${paymentId} not found or not visible`)
  }

  // --- 1. Receipt ----------------------------------------------------------
  const documentId = await deps.recordDocument({
    schoolId: ctx.schoolId,
    studentId: ctx.student.id,
    paymentId: ctx.paymentId,
    academicYear: ctx.fee.academicYear,
    termNumber: ctx.fee.termNumber,
  })

  let storagePath: string
  try {
    const pdf = await renderReceipt({
      school: ctx.school,
      receiptNumber: ctx.receiptNumber,
      paidAt: ctx.paidAt,
      studentName: ctx.student.name,
      studentCode: ctx.student.code,
      feeLabel: ctx.fee.label,
      academicYear: ctx.fee.academicYear,
      termNumber: ctx.fee.termNumber,
      currency: ctx.currency,
      amount: ctx.amount,
      amountPaidToDate: ctx.fee.amountPaidToDate,
      outstanding: ctx.fee.outstanding,
      paymentMethod: ctx.paymentMethod,
      recordedBy: ctx.recordedBy,
      verifiedBy: ctx.verifiedBy,
    })

    // Private bucket, per-school prefix. A receipt names a child and an amount.
    storagePath = await deps.storeDocument({
      schoolId: ctx.schoolId,
      path: `${ctx.school.schoolCode}/receipts/${ctx.fee.academicYear}/${ctx.receiptNumber}.pdf`,
      bytes: pdf.bytes,
    })

    await deps.completeDocument({
      documentId,
      status: 'ready',
      storagePath,
      byteSize: pdf.bytes.length,
    })
  } catch (err) {
    await deps.completeDocument({
      documentId,
      status: 'failed',
      error: err instanceof Error ? err.message : 'Receipt generation failed',
    })
    // Rethrow: the receipt is the point of the job, and a silent failure would
    // leave a parent notified about a receipt that does not exist.
    throw err
  }

  // --- 2. Notify -----------------------------------------------------------
  if (!ctx.parent) {
    // Not an error. A student with no linked guardian is a normal state during
    // enrolment, and the receipt is still filed against the school.
    return {
      documentId,
      storagePath,
      deliveredVia: null,
      messageLogIds: [],
      skippedNotification: 'no_linked_parent',
    }
  }

  const outcome = await sendWithFallback(
    {
      schoolId: ctx.schoolId,
      templateKey: 'fee_payment_confirmed',
      recipient: {
        phoneE164: ctx.parent.phoneE164,
        email: ctx.parent.email,
        userId: ctx.parent.userId,
      },
      studentId: ctx.student.id,
      variables: {
        parent_name: ctx.parent.name,
        student_name: ctx.student.name,
        currency: ctx.currency,
        amount: ctx.amount,
        receipt_number: ctx.receiptNumber,
        outstanding: ctx.fee.outstanding,
        school_name: ctx.school.name,
      },
      attachmentPaths: [storagePath],
    },
    deps.dispatch,
  )

  return {
    documentId,
    storagePath,
    deliveredVia: outcome.deliveredVia,
    messageLogIds: outcome.messageLogIds,
  }
}
