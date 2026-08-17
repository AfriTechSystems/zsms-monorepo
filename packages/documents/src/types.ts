/**
 * Document generation — type contract.
 *
 * Spec: `Official Documentation/13 Document and PDF System/PDF_GENERATION.md`
 *
 * Every generator takes plain data and returns bytes. Nothing here reads the
 * database or writes to R2 — the worker does both, so a document can be
 * rendered in a test without a connection to either.
 */

export type DocType =
  | 'payment_receipt'
  | 'fee_statement'
  | 'report_card'
  | 'attendance_certificate'
  | 'transfer_letter'

export interface SchoolBranding {
  name: string
  schoolCode: string
  address?: string
  phone?: string
  email?: string
  /** R2 path, resolved to bytes by the caller. */
  logoBytes?: Uint8Array

  /**
   * The school's brand colours, from `public.school_branding` (0092).
   *
   * A document is the artefact a parent keeps. If the portal is maroon and the
   * receipt for the same money is ZSMS blue, the receipt reads as coming from
   * somewhere else — which is precisely the wrong signal on proof of payment.
   *
   * Both are `#RRGGBB` or absent, and both are safe to print on white: the
   * database constrains the anchor to 4.5:1 and the primary to 3:1 against
   * white (ADR-043), and paper is white. Absent means the ZSMS default.
   */
  anchorColor?: string
  primaryColor?: string
}

export interface ReceiptData {
  school: SchoolBranding
  receiptNumber: string
  paidAt: string
  studentName: string
  studentCode: string
  feeLabel: string
  academicYear: string
  termNumber: number
  currency: string
  amount: string
  amountPaidToDate: string
  outstanding: string
  paymentMethod: string
  recordedBy: string
  verifiedBy?: string
}

/** One ledger row from `public.fee_statement()`. */
export interface StatementEntry {
  entryDate: string
  entryType: string
  description: string
  reference?: string | null
  debit: string
  credit: string
  runningBalance: string
}

export interface StatementData {
  school: SchoolBranding
  studentName: string
  studentCode: string
  currency: string
  periodFrom?: string
  periodTo?: string
  entries: StatementEntry[]
  closingBalance: string
  arrearsAmount: string
  daysOverdue: number
}

export interface ReportCardSubject {
  subjectName: string
  marksObtained: string | null
  marksTotal: string
  gradeLetter: string | null
  classPosition: number | null
  comments?: string | null
}

export interface ReportCardData {
  school: SchoolBranding
  studentName: string
  studentCode: string
  className: string
  academicYear: string
  termNumber: number
  subjects: ReportCardSubject[]
  /**
   * The grading scale in force. Printed on the card because a grade letter
   * without its scale cannot be interpreted later — the gap ADR-041 records
   * for exam_results applies just as much to the printed artefact.
   */
  gradingScaleName?: string
  attendancePresent?: number
  attendanceTotal?: number
  classTeacherName?: string
}

export interface RenderedDocument {
  bytes: Uint8Array
  contentType: 'application/pdf'
  suggestedFilename: string
}
