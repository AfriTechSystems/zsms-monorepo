/**
 * Renders and stores a transfer letter.
 *
 * Spec: `07 Student and Parent Modules/TRANSFER.md` → *Transfer Letter Contents*
 *
 * ## Why this is queued rather than rendered in the route
 *
 * `renderTransferLetter()` could run in the request — it is one page. It does not,
 * because the letter must be **stored permanently in R2** and recorded in
 * `generated_documents`, and that is the same shape receipts and report cards already
 * have. Two ways of producing a stored document would be two ways for one to drift.
 *
 * It also means a transfer still completes when R2 is briefly unavailable. The pupil's
 * status is the thing that must not fail; the letter can be retried.
 *
 * ## Record first, render second
 *
 * `recordDocument()` writes a `pending` row before anything is rendered, so a letter
 * that fails to generate leaves a `failed` row somebody can see — rather than no trace
 * at all, which is indistinguishable from never having been asked for.
 */

import { renderTransferLetter } from '@zsms/documents'
import type { TransferLetterData } from '@zsms/documents'

export interface TransferLetterJob {
  studentId: string
  schoolId: string
  transferReference: string
}

export interface TransferLetterContext {
  school: TransferLetterData['school']
  ministryRegistrationNumber?: string | null
  studentName: string
  studentCode: string
  enrolledOn: string
  transferredOn: string
  finalGradeLevel: string
  kind: 'transferred' | 'withdrawn'
  destination?: string | null
  principalName?: string | null
}

export interface TransferLetterDeps {
  /** Everything the letter needs, resolved through a `worker_*` function. */
  loadContext: (studentId: string) => Promise<TransferLetterContext | null>
  recordDocument: (input: {
    schoolId: string
    docType: 'transfer_letter'
    studentId: string
  }) => Promise<string>
  /** Named `storeDocument` to match the receipt handler rather than inventing a second verb. */
  storeDocument: (input: {
    schoolId: string
    path: string
    bytes: Uint8Array
  }) => Promise<string>
  completeDocument: (input: {
    documentId: string
    status: 'ready' | 'failed'
    storagePath?: string
    byteSize?: number
    error?: string
  }) => Promise<void>
}

export interface TransferLetterResult {
  documentId: string
  storagePath: string
}

export async function handleTransferLetter(
  job: TransferLetterJob,
  deps: TransferLetterDeps,
): Promise<TransferLetterResult> {
  const context = await deps.loadContext(job.studentId)

  if (!context) {
    /*
      Thrown rather than returned quietly. A transfer letter asked for and not produced
      is a family turning up at the next school without one, which is the failure this
      whole feature exists to prevent — so it should retry and then surface.
    */
    throw new Error(`No transfer context for student ${job.studentId}`)
  }

  // Recorded BEFORE rendering, so a failure leaves a visible `failed` row.
  const documentId = await deps.recordDocument({
    schoolId: job.schoolId,
    docType: 'transfer_letter',
    studentId: job.studentId,
  })

  try {
    const rendered = await renderTransferLetter({
      school: context.school,
      ministryRegistrationNumber: context.ministryRegistrationNumber,
      studentName: context.studentName,
      studentCode: context.studentCode,
      enrolledOn: context.enrolledOn,
      transferredOn: context.transferredOn,
      finalGradeLevel: context.finalGradeLevel,
      kind: context.kind,
      destination: context.destination,
      principalName: context.principalName,
      transferReference: job.transferReference,
    })

    /*
      The path TRANSFER.md specifies, to the letter. A registrar may be handed a signed
      URL years later, and a path that moved between releases is a link that stopped
      working for the one document people keep longest.
    */
    const storagePath = await deps.storeDocument({
      schoolId: job.schoolId,
      path: `${job.schoolId}/documents/transfers/${job.transferReference}.pdf`,
      bytes: rendered.bytes,
    })

    await deps.completeDocument({
      documentId,
      status: 'ready',
      storagePath,
      byteSize: rendered.bytes.byteLength,
    })

    console.log(
      `[transfer-letter] ${context.studentName} (${context.studentCode}) — ${job.transferReference}`,
    )

    return { documentId, storagePath }
  } catch (error) {
    await deps.completeDocument({
      documentId,
      status: 'failed',
      error: error instanceof Error ? error.message : 'unknown',
    })
    // Rethrown so BullMQ retries; the `failed` row records the attempt either way.
    throw error
  }
}
