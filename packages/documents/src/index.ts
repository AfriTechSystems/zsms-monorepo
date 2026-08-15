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
  newPage,
  rule,
  text,
  textRight,
} from './pdf'
import type { ReceiptData, RenderedDocument, ReportCardData, StatementData } from './types'

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
  await header(doc, data.school, `REPORT CARD — ${data.academicYear} TERM ${data.termNumber}`)

  text(doc, `${data.studentName} (${data.studentCode})`, { size: 11, bold: true })
  move(doc, 14)
  text(doc, `Class ${data.className}`, { size: 9, color: MUTED })
  move(doc, 22)

  const COL = { subject: MARGIN, marks: RIGHT - 210, grade: RIGHT - 120, position: RIGHT }

  text(doc, 'SUBJECT', { x: COL.subject, size: 8, bold: true, color: MUTED })
  textRight(doc, 'MARKS', COL.marks, { size: 8, bold: true, color: MUTED })
  textRight(doc, 'GRADE', COL.grade, { size: 8, bold: true, color: MUTED })
  textRight(doc, 'POSITION', COL.position, { size: 8, bold: true, color: MUTED })
  rule(doc, 6)

  for (const s of data.subjects) {
    if (needsPage(doc, 40)) newPage(doc)

    text(doc, s.subjectName, { x: COL.subject, size: 10, maxWidth: COL.marks - COL.subject - 40 })
    // An un-entered mark reads as a dash, not as zero. A blank is ambiguous and
    // a zero is a lie.
    textRight(doc, s.marksObtained === null ? '—' : `${s.marksObtained} / ${s.marksTotal}`, COL.marks, { size: 10 })
    textRight(doc, s.gradeLetter ?? '—', COL.grade, { size: 10, bold: true })
    textRight(doc, s.classPosition === null ? '—' : String(s.classPosition), COL.position, { size: 10 })
    move(doc, 16)

    if (s.comments) {
      text(doc, s.comments, { x: COL.subject + 8, size: 8, color: MUTED, maxWidth: 380 })
      move(doc, 13)
    }
  }

  rule(doc)

  if (data.attendanceTotal && data.attendanceTotal > 0) {
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

  footer(doc, `${data.school.name} · ${data.studentCode} · ${data.academicYear} Term ${data.termNumber}`)
  return finish(doc, `report-${data.studentCode}-${data.academicYear}-T${data.termNumber}.pdf`)
}

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
