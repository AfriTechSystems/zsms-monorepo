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
  AttendanceRegisterData,
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
/**
 * One class's register for one day, as a sheet somebody can file or sign.
 *
 * Spec: `Official Documentation/10 Attendance/ATTENDANCE.md` → *Attendance Reports*
 *
 * ## What it is for
 *
 * The reference design puts a "Download Attendance Report" button on the register's
 * Summary panel, and the thing a teacher wants from there is the register they have
 * just marked — to hand to the office, to file, or to sign. So this prints one day,
 * not a range.
 *
 * ATTENDANCE.md's two bigger reports are **not** this. The *Class Attendance Report*
 * wants a date range with per-pupil totals and a below-threshold list; the *School
 * Attendance Summary* wants grade rates, top absentees and marking compliance. Both
 * need data a single register does not hold, and both remain unbuilt.
 *
 * ## An unmarked pupil prints as a dash, never as absent
 *
 * The rule this whole module has carried since the register was written. On screen an
 * unmarked pupil is a gap a teacher can still fill; on paper it would become a record
 * of absence that outlives the correction, and this is a document that gets filed.
 * The summary line counts them separately for the same reason.
 *
 * ## A signature line, because paper is what this is
 *
 * A register printed for the office is evidence, and in most Zambian schools it is
 * countersigned. A PDF that omits the line forces somebody to draw one in biro.
 */
export async function renderAttendanceRegister(
  data: AttendanceRegisterData,
): Promise<RenderedDocument> {
  const doc = await newDocument()
  await header(doc, data.school, 'ATTENDANCE REGISTER')

  text(doc, data.className, { size: 11, bold: true })
  move(doc, 14)
  text(doc, longDate(data.date), { size: 9, color: MUTED })
  move(doc, 22)

  /*
    Counted here rather than taken from the caller.

    A summary that disagrees with the rows beneath it is worse than no summary, and
    the only way to guarantee it cannot is to derive it from the same array that gets
    printed.
  */
  const tally = { present: 0, late: 0, absent: 0, excused: 0, unmarked: 0 }
  for (const row of data.rows) {
    if (row.status === 'present') tally.present += 1
    else if (row.status === 'late') tally.late += 1
    else if (row.status === 'absent') tally.absent += 1
    else if (row.status === 'excused') tally.excused += 1
    else tally.unmarked += 1
  }

  const assessed = tally.present + tally.late + tally.absent + tally.excused
  const rate = assessed === 0 ? null : Math.round(((tally.present + tally.late) / assessed) * 100)

  text(
    doc,
    `${data.rows.length} on the roll  ·  ${tally.present} present  ·  ${tally.late} late  ` +
      `·  ${tally.absent} absent  ·  ${tally.excused} excused  ·  ${tally.unmarked} not marked`,
    { size: 9 },
  )
  move(doc, 13)
  text(
    doc,
    rate === null
      ? 'No pupil was marked, so there is no attendance rate for this day.'
      : `${rate}% attending — present and late, out of those marked.`,
    { size: 9, color: MUTED },
  )
  move(doc, 20)

  const COL = { num: MARGIN, name: MARGIN + 40, status: RIGHT - 190, note: RIGHT - 120 }

  const columnHeadings = (): void => {
    text(doc, '#', { x: COL.num, size: 8, bold: true, color: MUTED })
    text(doc, 'PUPIL', { x: COL.name, size: 8, bold: true, color: MUTED })
    text(doc, 'STATUS', { x: COL.status, size: 8, bold: true, color: MUTED })
    text(doc, 'NOTE', { x: COL.note, size: 8, bold: true, color: MUTED })
    rule(doc, 6)
  }
  columnHeadings()

  for (const row of data.rows) {
    if (needsPage(doc, 34)) {
      newPage(doc)
      columnHeadings()
    }

    text(doc, row.studentNumber, { x: COL.num, size: 9, color: MUTED })
    text(doc, row.studentName, { x: COL.name, size: 9, maxWidth: COL.status - COL.name - 10 })
    // The em dash is the unmarked pupil. See the header.
    text(doc, row.status ? STATUS_WORD[row.status] ?? row.status : '—', {
      x: COL.status,
      size: 9,
      bold: row.status === 'absent',
    })
    if (row.note) {
      text(doc, row.note, { x: COL.note, size: 8, color: MUTED, maxWidth: RIGHT - COL.note })
    }
    move(doc, 15)
  }

  move(doc, 18)
  rule(doc, 6)
  move(doc, 16)

  if (data.markedBy) {
    text(doc, `Marked by ${data.markedBy}`, { size: 9 })
    move(doc, 20)
  }

  text(doc, 'Checked by ____________________________     Date ______________', {
    size: 9,
    color: MUTED,
  })

  footer(
    doc,
    'An em dash means no mark was recorded for that pupil. It is not a record of absence.',
  )
  /*
    The class and the date, so a folder of these sorts by class then by day and a
    teacher who downloads two registers does not get two files called the same thing.
    Non-alphanumerics collapse to a hyphen because a class id may legitimately carry a
    slash, which some filesystems will not take.
  */
  const slug = data.className.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return finish(doc, `register-${slug}-${data.date}.pdf`)
}

/** The word, not the database value. A register read by a parent or an inspector
 *  should not expose the schema's vocabulary. */
const STATUS_WORD: Record<string, string> = {
  present: 'Present',
  absent: 'Absent',
  late: 'Late',
  excused: 'Excused',
  holiday: 'Holiday',
}

/** `YYYY-MM-DD` → "Monday, 26 May 2026". Built from the parts rather than
 *  `toLocaleDateString` on a Date, because parsing the string as a Date would read it
 *  as UTC midnight and print the previous day for every user east of Greenwich. */
function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const names = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ]
  return `${d} ${names[m - 1]} ${y}`
}

export type { AttendanceRegisterData, AttendanceRegisterRow, TransferLetterData } from './types'

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
