/**
 * Document generators — receipts, fee statements, report cards.
 *
 * Spec: `Official Documentation/13 Document and PDF System/PDF_GENERATION.md`
 *
 * Each takes plain data and returns bytes. No database, no R2 — the worker
 * supplies the data and stores the result, so a document can be rendered in a
 * test with neither.
 */

import {
  A4,
  MARGIN,
  MUTED,
  finish,
  footer,
  header,
  move,
  needsPage,
  newDocument,
  // Wrapping body text, which only the transfer letter needs — the other
  // documents are all label/value rows.
  paragraph,
  newPage,
  rule,
  text,
  textRight,
} from './pdf'
import type {
  ReceiptData,
  RenderedDocument,
  ReportCardData,
  StatementData,
  TransferLetterData,
} from './types'

const RIGHT = A4.width - MARGIN

function labelValue(doc: Parameters<typeof text>[0], label: string, value: string): void {
  text(doc, label, { size: 9, color: MUTED })
  textRight(doc, value, RIGHT, { size: 10 })
  move(doc, 15)
}

// ---------------------------------------------------------------------------
// Payment receipt
// ---------------------------------------------------------------------------

export async function renderReceipt(data: ReceiptData): Promise<RenderedDocument> {
  const doc = await newDocument()
  await header(doc, data.school, 'PAYMENT RECEIPT')

  text(doc, data.receiptNumber, { size: 14, bold: true })
  move(doc, 16)
  text(doc, `Issued ${data.paidAt}`, { size: 9, color: MUTED })
  move(doc, 24)

  labelValue(doc, 'Student', `${data.studentName} (${data.studentCode})`)
  labelValue(doc, 'Fee', `${data.feeLabel} — ${data.academicYear} Term ${data.termNumber}`)
  labelValue(doc, 'Method', data.paymentMethod)
  rule(doc)

  text(doc, 'Amount received', { size: 11, bold: true })
  textRight(doc, `${data.currency} ${data.amount}`, RIGHT, { size: 14, bold: true })
  move(doc, 22)

  labelValue(doc, 'Paid to date on this fee', `${data.currency} ${data.amountPaidToDate}`)
  labelValue(doc, 'Outstanding balance', `${data.currency} ${data.outstanding}`)
  rule(doc)

  text(doc, `Recorded by ${data.recordedBy}`, { size: 8.5, color: MUTED })
  if (data.verifiedBy) {
    move(doc, 11)
    // Printed because a receipt is the school's assertion that the money was
    // received AND checked. Verification without an attributed verifier is the
    // state the payments CHECK constraint already forbids in the database.
    text(doc, `Verified by ${data.verifiedBy}`, { size: 8.5, color: MUTED })
  }

  footer(doc, `${data.school.name} · Receipt ${data.receiptNumber}`)
  return finish(doc, `${data.receiptNumber}.pdf`)
}

// ---------------------------------------------------------------------------
// Fee statement — the ledger, with its brought-forward opening
// ---------------------------------------------------------------------------

export async function renderFeeStatement(data: StatementData): Promise<RenderedDocument> {
  const doc = await newDocument()
  await header(doc, data.school, 'FEE STATEMENT')

  text(doc, `${data.studentName} (${data.studentCode})`, { size: 11, bold: true })
  move(doc, 14)
  const period =
    data.periodFrom || data.periodTo
      ? `${data.periodFrom ?? 'opening'} to ${data.periodTo ?? 'today'}`
      : 'All activity'
  text(doc, period, { size: 9, color: MUTED })
  move(doc, 22)

  const COL = { date: MARGIN, desc: MARGIN + 78, debit: RIGHT - 240, credit: RIGHT - 130, balance: RIGHT }

  const columnHeadings = (): void => {
    text(doc, 'DATE', { x: COL.date, size: 8, bold: true, color: MUTED })
    text(doc, 'DESCRIPTION', { x: COL.desc, size: 8, bold: true, color: MUTED })
    textRight(doc, 'DEBIT', COL.debit, { size: 8, bold: true, color: MUTED })
    textRight(doc, 'CREDIT', COL.credit, { size: 8, bold: true, color: MUTED })
    textRight(doc, 'BALANCE', COL.balance, { size: 8, bold: true, color: MUTED })
    rule(doc, 6)
  }
  columnHeadings()

  for (const entry of data.entries) {
    if (needsPage(doc, 40)) {
      newPage(doc)
      columnHeadings()
    }

    // The brought-forward row is the ledger reading a bursar expects. It is
    // computed by fee_statement(), never stored — one truth in the data,
    // ledger-style on the page (ADR-038).
    const isBroughtForward = entry.entryType === 'brought_forward'

    text(doc, isBroughtForward ? '' : entry.entryDate.slice(0, 10), { x: COL.date, size: 9 })
    text(doc, entry.description, {
      x: COL.desc,
      size: 9,
      bold: isBroughtForward,
      maxWidth: COL.debit - COL.desc - 60,
    })
    if (!isBroughtForward) {
      if (entry.debit !== '0.00') textRight(doc, entry.debit, COL.debit, { size: 9 })
      if (entry.credit !== '0.00') textRight(doc, entry.credit, COL.credit, { size: 9 })
    }
    textRight(doc, entry.runningBalance, COL.balance, { size: 9, bold: isBroughtForward })
    move(doc, 15)

    if (entry.reference) {
      text(doc, entry.reference, { x: COL.desc, size: 7.5, color: MUTED })
      move(doc, 12)
    }
  }

  rule(doc)
  text(doc, 'Closing balance', { size: 11, bold: true })
  textRight(doc, `${data.currency} ${data.closingBalance}`, RIGHT, { size: 13, bold: true })
  move(doc, 20)

  if (Number(data.arrearsAmount) > 0) {
    text(doc, `Of which ${data.currency} ${data.arrearsAmount} is overdue by ${data.daysOverdue} days.`, {
      size: 9,
      color: MUTED,
    })
    move(doc, 14)
  }

  // Deliberate. A statement is a request to pay, not a threat: ADR-038 keeps
  // arrears informational, and any consequence is a school's own decision.
  text(doc, 'If you have already paid, please contact the school office so we can reconcile it.', {
    size: 8.5,
    color: MUTED,
  })

  footer(doc, `${data.school.name} · Statement for ${data.studentCode}`)
  return finish(doc, `statement-${data.studentCode}.pdf`)
}

// ---------------------------------------------------------------------------
// Report card
// ---------------------------------------------------------------------------

export async function renderReportCard(data: ReportCardData): Promise<RenderedDocument> {
  const doc = await newDocument()

  /*
    What this school chose to show (`0258`). Every switch defaults to TRUE when
    absent, because absent means "this school has never opened that screen" — which
    is every school until it does. Defaulting to hidden would silently strip
    position, averages and comments from every report card in the system on deploy.
  */
  const o = data.options ?? {}
  const showPosition = o.showPosition !== false
  const showAttendance = o.showAttendance !== false
  const showComments = o.showComments !== false

  await header(doc, data.school, `REPORT CARD — ${data.academicYear} TERM ${data.termNumber}`)

  text(doc, `${data.studentName} (${data.studentCode})`, { size: 11, bold: true })
  move(doc, 14)
  text(doc, `Class ${data.className}`, { size: 9, color: MUTED })
  move(doc, 22)

  const COL = { subject: MARGIN, marks: RIGHT - 210, grade: RIGHT - 120, position: RIGHT }

  text(doc, 'SUBJECT', { x: COL.subject, size: 8, bold: true, color: MUTED })
  textRight(doc, 'MARKS', COL.marks, { size: 8, bold: true, color: MUTED })
  textRight(doc, 'GRADE', COL.grade, { size: 8, bold: true, color: MUTED })
  if (showPosition) {
    textRight(doc, 'POSITION', COL.position, { size: 8, bold: true, color: MUTED })
  }
  rule(doc, 6)

  for (const s of data.subjects) {
    if (needsPage(doc, 40)) newPage(doc)

    text(doc, s.subjectName, { x: COL.subject, size: 10, maxWidth: COL.marks - COL.subject - 40 })
    // An un-entered mark reads as a dash, not as zero. A blank is ambiguous and
    // a zero is a lie.
    textRight(doc, s.marksObtained === null ? '—' : `${s.marksObtained} / ${s.marksTotal}`, COL.marks, { size: 10 })
    textRight(doc, s.gradeLetter ?? '—', COL.grade, { size: 10, bold: true })
    // The column is omitted entirely rather than blanked: a school that turned
    // ranking off does not want an empty POSITION column inviting the question.
    if (showPosition) {
      textRight(doc, s.classPosition === null ? '—' : String(s.classPosition), COL.position, { size: 10 })
    }
    move(doc, 16)

    if (s.comments && showComments) {
      text(doc, s.comments, { x: COL.subject + 8, size: 8, color: MUTED, maxWidth: 380 })
      move(doc, 13)
    }
  }

  rule(doc)

  if (showAttendance && data.attendanceTotal && data.attendanceTotal > 0) {
    labelValue(
      doc,
      'Attendance',
      `${data.attendancePresent ?? 0} of ${data.attendanceTotal} days`,
    )
  }
  if (data.classTeacherName) labelValue(doc, 'Class teacher', data.classTeacherName)

  if (data.gradingScaleName) {
    move(doc, 6)
    // Printed for the reason ADR-041 records: a grade letter without its scale
    // cannot be interpreted once the scale changes. Until exam_results stores
    // the scale version, the printed card is the only durable record of which
    // scale produced these letters.
    text(doc, `Grades awarded under: ${data.gradingScaleName}`, { size: 8, color: MUTED })
  }

  /*
    The principal's words for this term (TEMPLATE_SYSTEM.md). Resolved by the
    caller from the per-term map, so the renderer never has to know that comments
    are stored by year and term — only that it was handed one or was not.
  */
  if (data.principalComment) {
    move(doc, 14)
    if (needsPage(doc, 60)) newPage(doc)
    text(doc, "PRINCIPAL'S COMMENT", { size: 8, bold: true, color: MUTED })
    move(doc, 13)
    text(doc, data.principalComment, { size: 9, maxWidth: RIGHT - MARGIN })
    move(doc, 16)
  }

  /*
    The acknowledgement slip (CUSTOMISATION.md step 6) — a tear-off a parent signs
    and returns. Off unless the school asked, because a school that does not collect
    them does not want a blank signature box on every card.

    Deliberately empty lines rather than pre-filled: the whole point is a physical
    signature, and printing a name beside it would invite the question of who wrote it.
  */
  if (data.options?.acknowledgementRequired) {
    if (needsPage(doc, 90)) newPage(doc)
    move(doc, 10)
    rule(doc, 8)
    text(doc, 'PARENT ACKNOWLEDGEMENT — please sign and return to the school', {
      size: 8,
      bold: true,
      color: MUTED,
    })
    move(doc, 24)
    labelValue(doc, 'Signature', '')
    move(doc, 20)
    labelValue(doc, 'Name', '')
    move(doc, 20)
    labelValue(doc, 'Date', '')
  }

  footer(doc, `${data.school.name} · ${data.studentCode} · ${data.academicYear} Term ${data.termNumber}`)
  return finish(doc, `report-${data.studentCode}-${data.academicYear}-T${data.termNumber}.pdf`)
}

// ---------------------------------------------------------------------------
// Transfer letter — the document a family carries to the next school
// ---------------------------------------------------------------------------

/**
 * Renders a transfer letter to `TRANSFER.md`'s specified contents.
 *
 * ## Why this is formal rather than friendly
 *
 * The audience is not the parent. It is a registrar at the receiving school deciding
 * whether to admit a child, and they are looking for specific facts: who, from where,
 * when, what grade was completed, and who at the origin school stands behind it.
 *
 * So no greeting, no prose paragraph, and a signature block that is deliberately empty
 * — a letter ZSMS signed itself would be worth nothing. The school signs and stamps it.
 *
 * ## Withdrawal is said plainly
 *
 * A withdrawal is not a transfer, and a letter that blurs them misleads the reader
 * about whether a destination school exists. The heading and the body both say which.
 */
export async function renderTransferLetter(
  data: TransferLetterData,
): Promise<RenderedDocument> {
  const doc = await newDocument()

  const leaving = data.kind === 'withdrawn'
  await header(doc, data.school, leaving ? 'WITHDRAWAL LETTER' : 'TRANSFER LETTER')

  text(doc, data.transferReference, { size: 12, bold: true })
  move(doc, 16)
  text(doc, `Issued ${data.transferredOn}`, { size: 9, color: MUTED })
  move(doc, 24)

  /*
    The registration number sits with the school, not the pupil. It is what tells a
    registrar this letter comes from a recognised school rather than anybody with a
    printer, so it is the first thing after the reference.
  */
  if (data.ministryRegistrationNumber) {
    labelValue(doc, 'Ministry registration', data.ministryRegistrationNumber)
  }
  rule(doc)

  labelValue(doc, 'Pupil', data.studentName)
  labelValue(doc, 'Pupil number', data.studentCode)
  labelValue(doc, 'Enrolled', data.enrolledOn)
  labelValue(doc, leaving ? 'Withdrawn' : 'Transferred', data.transferredOn)
  labelValue(doc, 'Final grade completed', data.finalGradeLevel)

  if (!leaving) {
    /*
      "Not specified" rather than omitting the row. A registrar reading a letter with
      no destination line cannot tell whether the school did not know or the letter is
      incomplete, and the two have different consequences.
    */
    labelValue(doc, 'Destination', data.destination || 'Not specified')
  }
  rule(doc)

  paragraph(
    doc,
    leaving
      ? `This is to confirm that ${data.studentName} (${data.studentCode}) was enrolled at ` +
          `${data.school.name} from ${data.enrolledOn} until ${data.transferredOn}, and has ` +
          `been withdrawn from the school.`
      : `This is to confirm that ${data.studentName} (${data.studentCode}) was enrolled at ` +
          `${data.school.name} from ${data.enrolledOn} until ${data.transferredOn}, and has ` +
          `been transferred with the school's knowledge.`,
    { size: 10 },
  )
  move(doc, 8)

  /*
    Said explicitly because a registrar will wonder, and because TRANSFER.md is firm
    that records are never deleted. A pupil's history is available from the origin
    school on request — this letter is a summary, not the file.
  */
  paragraph(
    doc,
    "The pupil's academic and attendance records are retained by this school and may be " +
      'requested through the school office, quoting the reference above.',
    { size: 9, color: MUTED },
  )
  move(doc, 36)

  // An empty signature block. ZSMS states facts; the school vouches for them.
  text(doc, data.principalName ?? 'Principal', { size: 10, bold: true })
  move(doc, 30)
  rule(doc, 2)
  text(doc, 'Signature and date', { size: 8.5, color: MUTED })
  move(doc, 40)
  rule(doc, 2)
  text(doc, 'School stamp', { size: 8.5, color: MUTED })

  footer(doc, `${data.school.name} · ${data.transferReference}`)
  return finish(doc, `${data.transferReference}.pdf`)
}

// Exported so a worker can type the context it assembles for the renderer.
export type { TransferLetterData } from './types'

export type { TeachingResourceDocument } from './teaching-resource'
export {
  renderTeachingResourcePdf,
  renderTeachingResourceDocx,
} from './teaching-resource'

export type {
  DocType,
  ReceiptData,
  StatementData,
  StatementEntry,
  ReportCardData,
  ReportCardSubject,
  SchoolBranding,
  RenderedDocument,
} from './types'
