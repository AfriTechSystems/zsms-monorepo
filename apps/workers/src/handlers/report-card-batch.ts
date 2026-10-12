/**
 * generate-report-card — bulk generation for a class or a whole term.
 *
 * Spec: `Official Documentation/13 Document and PDF System/PDF_GENERATION.md`
 *       — 400 report cards in under 90 seconds, with per-batch failure
 *       isolation and realtime progress.
 *
 * Two requirements shape this handler:
 *
 *  - **Fonts and the logo load once per batch, not once per student.** That is
 *    the specific reason `PDF_GENERATION.md` rules out a browser renderer, and
 *    re-embedding a logo 400 times would give away the same budget in a
 *    different place. The branding object is resolved once and passed down.
 *  - **One student's failure must not lose the batch.** A missing mark or a
 *    corrupt logo fails that card and the run continues; the batch reports
 *    partial success rather than throwing away 399 completed documents.
 */

import { renderReportCard, type ReportCardSubject, type SchoolBranding } from '@zsms/documents'

export interface BatchStudent {
  studentId: string
  studentName: string
  studentCode: string
  classId: string
  subjects: ReportCardSubject[]
}

export interface ReportCardBatchDeps {
  loadBranding(schoolId: string): Promise<SchoolBranding>
  /**
   * What this school chose to show, and the principal's words for this term.
   *
   * Optional so existing callers and tests keep working: when absent the renderer
   * applies its own defaults, which are "show everything" — the card every school
   * got before `0258` existed.
   */
  loadTemplate?(
    schoolId: string,
  ): Promise<{ options: Record<string, boolean>; principalComments: Record<string, string> }>
  loadBatch(input: {
    schoolId: string
    academicYear: string
    termNumber: number
    classId?: string
  }): Promise<BatchStudent[]>
  recordDocument(input: {
    schoolId: string
    studentId: string
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
  storeDocument(input: { schoolId: string; path: string; bytes: Uint8Array }): Promise<string>
  /** Progress callback — drives the realtime UI. */
  onProgress?(done: number, total: number): Promise<void> | void
  gradingScaleName?(schoolId: string): Promise<string | undefined>
}

export interface ReportCardBatchResult {
  total: number
  generated: number
  failed: number
  skippedNoMarks: number
  failures: Array<{ studentCode: string; reason: string }>
}

export async function handleReportCardBatch(
  input: { schoolId: string; academicYear: string; termNumber: number; classId?: string },
  deps: ReportCardBatchDeps,
): Promise<ReportCardBatchResult> {
  // Resolved once for the whole batch — see the note above.
  const branding = await deps.loadBranding(input.schoolId)
  const gradingScaleName = await deps.gradingScaleName?.(input.schoolId)

  /*
    Resolved once for the whole batch, like the branding above — a four-hundred
    pupil run must not ask the database the same configuration question four
    hundred times.
  */
  const template = await deps.loadTemplate?.(input.schoolId)

  /*
    The principal's comment for THIS term, picked out here rather than in the
    renderer. The renderer is handed a comment or nothing, and never has to know
    that comments are stored per term — which is also what stops last term's words
    appearing on this term's cards.
  */
  const principalComment =
    template?.principalComments?.[`${input.academicYear}-${input.termNumber}`] ?? null

  const students = await deps.loadBatch(input)

  const result: ReportCardBatchResult = {
    total: students.length,
    generated: 0,
    failed: 0,
    skippedNoMarks: 0,
    failures: [],
  }

  let done = 0

  for (const s of students) {
    done += 1

    // A student with no published marks gets no card. Producing an empty report
    // card would put a document in a parent's hands implying their child sat
    // nothing, which is worse than producing none.
    if (s.subjects.length === 0) {
      result.skippedNoMarks += 1
      await deps.onProgress?.(done, students.length)
      continue
    }

    const documentId = await deps.recordDocument({
      schoolId: input.schoolId,
      studentId: s.studentId,
      academicYear: input.academicYear,
      termNumber: input.termNumber,
    })

    try {
      const pdf = await renderReportCard({
        school: branding,
        options: template?.options,
        principalComment,
        studentName: s.studentName,
        studentCode: s.studentCode,
        className: s.classId,
        academicYear: input.academicYear,
        termNumber: input.termNumber,
        subjects: s.subjects,
        // Printed on the card because exam_results does not record which scale
        // produced a grade letter — the gap ADR-041 tracks. Until that is
        // fixed, the card is the only durable record of the scale in force.
        gradingScaleName,
      })

      const path = await deps.storeDocument({
        schoolId: input.schoolId,
        path: `${branding.schoolCode}/report-cards/${input.academicYear}/T${input.termNumber}/${s.studentCode}.pdf`,
        bytes: pdf.bytes,
      })

      await deps.completeDocument({
        documentId,
        status: 'ready',
        storagePath: path,
        byteSize: pdf.bytes.length,
      })
      result.generated += 1
    } catch (err) {
      // Isolated failure. The run continues.
      const reason = err instanceof Error ? err.message : 'Report card generation failed'
      await deps.completeDocument({ documentId, status: 'failed', error: reason })
      result.failed += 1
      result.failures.push({ studentCode: s.studentCode, reason })
    }

    await deps.onProgress?.(done, students.length)
  }

  return result
}
