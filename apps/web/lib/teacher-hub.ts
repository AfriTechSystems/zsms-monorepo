/**
 * Shared shapes and helpers for the Teacher Hub routes.
 *
 * This is a `lib` module rather than an export from a route file for a reason worth
 * repeating: **`route.ts` may only export request handlers and a small set of config
 * names.** An extra export there compiles and builds perfectly — `next build` succeeded
 * with an illegal `resolveFeeCaller` export for an entire session — and only `tsc`
 * against the generated `.next/types` ever complains. Anything shared lives here.
 */

import { z } from 'zod'

/** Mirrors the `resource_kind` CHECK on `public.teaching_resources`. */
export const resourceKindSchema = z.enum(['lesson_plan', 'quiz', 'homework'])

export const curriculumSchema = z.enum([
  'ecz',
  'cambridge_igcse',
  'cambridge_alevel',
  'custom',
])

export const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200),
  phoneE164: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{6,14}$/, 'Use international format, e.g. +260971234567')
    .optional(),
  countryCode: z.string().trim().length(2).toUpperCase().default('ZM'),
  curriculumTypes: z.array(curriculumSchema).min(1).default(['ecz']),
  subjects: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  gradeLevels: z.array(z.string().trim().min(1).max(30)).max(20).default([]),
})

/**
 * Deliberately a subset of the register schema: there is no `email` here and no
 * `clerkUserId`. Identity is not a profile field — it comes from the session, and an email
 * change belongs to Clerk, which owns it.
 */
export const profileSchema = registerSchema
  .omit({ email: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update.' })

export const generateSchema = z.object({
  kind: resourceKindSchema,
  subject: z.string().trim().min(1).max(60),
  gradeLevel: z.string().trim().min(1).max(30),
  topic: z.string().trim().min(2).max(200),
  curriculumType: curriculumSchema.default('ecz'),
  durationMinutes: z.number().int().min(5).max(240).optional(),
  lessonType: z.enum(['introduction', 'core', 'revision', 'assessment_prep']).optional(),
  questionCount: z.number().int().min(1).max(50).optional(),
  questionStyle: z
    .enum(['multiple_choice', 'mixed', 'short_answer', 'extended_response'])
    .optional(),
  difficulty: z.enum(['standard', 'exam_style']).optional(),
  context: z.string().trim().max(2000).optional(),
  /**
   * Optional provenance. The database refuses a school the caller is not a member of, so
   * this cannot be used to stamp a resource with somewhere the teacher never taught.
   */
  schoolId: z.string().uuid().optional(),
  /**
   * Which wallet pays. `auto` is school-first, which is both the default and the right
   * default: school credits expire at the end of the period the school paid for and
   * personal ones do not, so spending the perishable balance first is also what is best
   * for the teacher.
   *
   * The database refuses `school` for a teacher with no assignment, so this cannot be
   * used to charge a school that never gave them credits.
   */
  creditSource: z.enum(['auto', 'school', 'personal']).default('auto'),
})

/** What a teacher may change about a saved resource. Matches the column-level grant. */
export const resourcePatchSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    teacherNotes: z.string().trim().max(5000).nullable().optional(),
    isShared: z.boolean().optional(),
    // Removal is a flag. There is no DELETE grant on this table.
    isDeleted: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update.' })

/**
 * The entitlement reasons the database can return, mapped to something a teacher can act
 * on. Kept here rather than in a component so every surface says the same thing.
 */
export const ENTITLEMENT_MESSAGES: Record<string, string> = {
  not_signed_in: 'Sign in to use the Teacher Hub.',
  no_account: 'Set up your Teacher Hub profile to get started.',
  trial_exhausted:
    'Your free trial is used up. Subscribe to keep creating — everything you have made stays readable.',
  subscription_lapsed:
    'Your subscription has ended. Your saved resources stay readable; renew to create new ones.',
  subscription_cancelled:
    'Your subscription is cancelled and the period has ended. Your saved resources stay readable.',
  account_suspended: 'This account is suspended. Contact AfriTech Systems.',
}

export interface HubEntitlement {
  may_generate: boolean
  reason: string | null
  plan_code: string | null
  subscription_status: string | null
  allowance: number | null
  used: number | null
  remaining: number | null
  subscription_ends_at: string | null
}

export interface HubPlan {
  plan_code: string
  display_name: string
  billing_period: string
  price: number
  currency_code: string
  included_resources: number | null
  sort_order: number
}

export interface HubAccount {
  clerk_user_id: string
  full_name: string
  email: string
  phone_e164: string | null
  country_code: string
  curriculum_types: string[]
  subjects: string[]
  grade_levels: string[]
  plan_code: string
  subscription_status: string
  trial_resources_used: number
  resources_created: number
  subscription_ends_at: string | null
}

export interface HubPayload {
  account: HubAccount | null
  entitlement: HubEntitlement | null
  plans: HubPlan[]
}
