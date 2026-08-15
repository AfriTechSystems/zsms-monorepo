/**
 * Request validation schemas.
 *
 * Spec: `Official Documentation/01 Foundation Layer/CONVENTIONS.md`
 *       `Official Documentation/07 Student and Parent Modules/STUDENTS.md`
 *       `Official Documentation/08 Staff Management/STAFF.md`
 *
 * Enum members mirror the CHECK constraints in migrations 0011 and 0015. They
 * are duplicated deliberately: the database constraint is the guarantee, and
 * this layer exists to turn a violation into a 400 with a field path instead of
 * a 500 from the driver.
 */

import { z } from 'zod'

/** E.164, as stored in phone_e164 columns. */
const phoneE164 = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, 'Must be E.164 format, e.g. +260977123456')

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

export const createStudentSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  gradeId: z.string().trim().min(1).max(50),
  classId: z.string().trim().min(1).max(50),
  dateOfBirth: isoDate.optional(),
  gender: z.enum(['male', 'female', 'not_stated']).optional(),
  isBoarding: z.boolean().optional(),
  enrolmentDate: isoDate.optional(),
  photoUrl: z.string().url().optional(),
  // school_id is deliberately NOT accepted. It is derived from the caller's JWT
  // so that a client cannot nominate the tenant a record belongs to.
})

export const updateStudentSchema = createStudentSchema
  .partial()
  .extend({
    status: z.enum(['active', 'on_leave', 'transferred', 'graduated', 'withdrawn']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update.' })

export const listStudentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(['active', 'on_leave', 'transferred', 'graduated', 'withdrawn']).optional(),
  gradeId: z.string().trim().max(50).optional(),
  classId: z.string().trim().max(50).optional(),
  search: z.string().trim().max(100).optional(),
})

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export const createStaffSchema = z.object({
  clerkUserId: z.string().trim().min(1),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().email().optional(),
  phoneE164: phoneE164.optional(),
  department: z.string().trim().max(100).optional(),
  staffNumber: z.string().trim().max(50).optional(),
  employmentType: z.enum(['full_time', 'part_time', 'contract', 'volunteer']).optional(),
  joinDate: isoDate.optional(),
})

export const updateStaffSchema = createStaffSchema
  .omit({ clerkUserId: true })
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update.' })

export const listStaffQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  department: z.string().trim().max(100).optional(),
})

// ---------------------------------------------------------------------------
// Schools
// ---------------------------------------------------------------------------

export const updateSchoolSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    address: z.string().trim().max(500).optional(),
    phone: phoneE164.optional(),
    email: z.string().email().optional(),
    logoUrl: z.string().url().optional(),
    type: z.enum(['day', 'boarding', 'both']).optional(),
    level: z.enum(['pre', 'primary', 'secondary', 'combined']).optional(),
    whatsappEnabled: z.boolean().optional(),
    // subscription_tier, subscription_ends_at, status, and max_students are
    // absent on purpose. RLS lets an owner UPDATE their school row, so the
    // billing fields are restricted here — the application layer is where that
    // restriction lives (RLS.md, schools table note).
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update.' })

export type CreateStudentInput = z.infer<typeof createStudentSchema>
export type UpdateStudentInput = z.infer<typeof updateStudentSchema>
export type CreateStaffInput = z.infer<typeof createStaffSchema>
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>
export type UpdateSchoolInput = z.infer<typeof updateSchoolSchema>

// ---------------------------------------------------------------------------
// Phase 2 — fees, attendance, results
//
// Money is validated as a number with at most two decimal places and is stored
// in NUMERIC(12,2) columns (prohibition 5). Note the API accepts a JSON number
// here but never performs arithmetic on it — all balance derivation happens in
// the database, where the type is exact.
// ---------------------------------------------------------------------------

const money = z
  .number()
  .nonnegative()
  .max(9_999_999_999.99)
  .refine((v) => Number.isFinite(v) && Math.round(v * 100) === v * 100, {
    message: 'At most two decimal places',
  })

const academicYear = z.string().regex(/^\d{4}$/, 'Must be a four-digit year')
const termNumber = z.coerce.number().int().min(1).max(4)

export const createFeeStructureSchema = z.object({
  academicYear,
  termNumber,
  gradeId: z.string().trim().min(1).max(50),
  studentType: z.enum(['all', 'day', 'boarding']).optional(),
  feeLabel: z.string().trim().min(1).max(100),
  amount: money,
  currencyCode: z.string().trim().length(3).optional(),
  isMandatory: z.boolean().optional(),
})

export const generateFeeRecordsSchema = z.object({
  academicYear,
  termNumber,
  dueDate: z.string().datetime().optional(),
})

export const listFeeRecordsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
  studentId: z.string().uuid().optional(),
  academicYear: academicYear.optional(),
  termNumber: termNumber.optional(),
  status: z
    .enum(['unpaid', 'partial', 'paid', 'waived', 'loan_pending', 'loan_paid', 'overpaid'])
    .optional(),
})

export const submitPaymentSchema = z.object({
  feeRecordId: z.string().uuid(),
  amount: money.refine((v) => v > 0, { message: 'Must be greater than zero' }),
  paymentMethod: z.enum(['cash', 'bank_deposit', 'cheque', 'online_gateway']),
  // 'reversal', 'waiver', and 'loan_disbursement' are deliberately absent: they
  // are finance-role operations, not something a submission endpoint accepts.
  bankName: z.string().trim().max(100).optional(),
  chequeNumber: z.string().trim().max(50).optional(),
  gatewayName: z.string().trim().max(50).optional(),
  gatewayReference: z.string().trim().max(200).optional(),
  proofOfPaymentUrl: z.string().url().optional(),
  notes: z.string().trim().max(1000).optional(),
  paidAt: z.string().datetime().optional(),
  // status is NOT accepted. Every submission lands as pending_verification;
  // letting a client name its own status would make verification decorative.
})

export const verifyPaymentSchema = z.object({
  decision: z.enum(['verified', 'rejected', 'queried']),
  reason: z.string().trim().max(1000).optional(),
})

export const markAttendanceSchema = z.object({
  records: z
    .array(
      z.object({
        studentId: z.string().uuid(),
        classId: z.string().trim().min(1).max(50),
        status: z.enum(['present', 'absent', 'late', 'excused', 'holiday']),
        arrivalTime: z
          .string()
          .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Must be HH:MM or HH:MM:SS')
          .optional(),
        excuseReason: z.string().trim().max(500).optional(),
      }),
    )
    .min(1)
    .max(200),
  attendanceDate: isoDate,
  academicYear,
  termNumber,
  syncSource: z.enum(['web', 'mobile_online', 'mobile_offline']).optional(),
  localCreatedAt: z.string().datetime().optional(),
})
  // Mirrors the database CHECK. Catching it here turns a 500 from the driver
  // into a 400 naming the offending record.
  .refine(
    (v) => v.records.every((r) => r.status !== 'excused' || Boolean(r.excuseReason)),
    { message: 'An excused absence requires excuseReason' },
  )

export const listAttendanceQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
  classId: z.string().trim().max(50).optional(),
  studentId: z.string().uuid().optional(),
  attendanceDate: isoDate.optional(),
  status: z.enum(['present', 'absent', 'late', 'excused', 'holiday']).optional(),
})

export const enterMarksSchema = z.object({
  classId: z.string().trim().min(1).max(50),
  academicYear,
  termNumber,
  subjectCode: z.string().trim().min(1).max(20),
  subjectName: z.string().trim().min(1).max(100),
  marksTotal: z.number().positive().max(1000).optional(),
  marks: z
    .array(
      z.object({
        studentId: z.string().uuid(),
        marksObtained: z.number().nonnegative().max(1000).nullable(),
        comments: z.string().trim().max(500).optional(),
      }),
    )
    .min(1)
    .max(200),
  syncSource: z.enum(['web', 'mobile_online', 'mobile_offline']).optional(),
})

export const publishResultsSchema = z.object({
  academicYear,
  termNumber,
  classId: z.string().trim().max(50).optional(),
})

export const listResultsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
  classId: z.string().trim().max(50).optional(),
  studentId: z.string().uuid().optional(),
  academicYear: academicYear.optional(),
  termNumber: termNumber.optional(),
  subjectCode: z.string().trim().max(20).optional(),
})

export type CreateFeeStructureInput = z.infer<typeof createFeeStructureSchema>
export type SubmitPaymentInput = z.infer<typeof submitPaymentSchema>
export type MarkAttendanceInput = z.infer<typeof markAttendanceSchema>
export type EnterMarksInput = z.infer<typeof enterMarksSchema>
