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
