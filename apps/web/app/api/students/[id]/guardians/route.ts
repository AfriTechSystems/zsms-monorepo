/**
 * Linking a guardian to a pupil.
 *
 *   POST   /api/students/[id]/guardians — link, creating the parent if the phone is new
 *   DELETE /api/students/[id]/guardians — unlink, with the 30-day grace period
 *
 * Spec: `Official Documentation/07 Student and Parent Modules/PARENT_LINKING.md`
 *         → *Method 2 — Manual Linking by Admin*
 *
 * ## Method 2 had no implementation at all
 *
 * `student_parent_links` has existed since `0013`, and the two routes into it were bulk
 * import and the self-registration path `0170` added. A school office linking a parent to a
 * pupil in front of them — which is how most links are actually made — could not be done.
 *
 * ## The pupil id comes from the path, and is checked in SQL
 *
 * `link_parent_to_student()` is SECURITY DEFINER and verifies the pupil belongs to the
 * caller's school before writing anything. This route does not re-check: one rule, in the
 * half that a direct PostgREST call cannot bypass.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../../lib/supabase'
import { getAuthProvider, type Role } from '@zsms/auth-provider'
import { can } from '../../../../../lib/roles'
import {
  created,
  fail,
  fromPostgrestError,
  guard,
  ok,
  validationFailed,
} from '../../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Mirrors the relationship CHECK on `student_parent_links`. */
const RELATIONSHIPS = [
  'mother', 'father', 'guardian', 'grandparent', 'sibling', 'uncle', 'aunt', 'other',
] as const

const linkSchema = z.object({
  fullName: z.string().trim().min(1, 'A guardian needs a name.').max(120),
  // Required, not optional: the phone is how a guardian is identified, so one parent with
  // four children at the school is one account rather than four.
  phone: z.string().trim().min(6, 'A phone number is required.').max(25),
  relationship: z.enum(RELATIONSHIPS).default('guardian'),
  email: z.string().trim().email().optional().or(z.literal('')),
  isPrimary: z.boolean().default(false),
})

const unlinkSchema = z.object({ linkId: z.string().uuid() })

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return guard(async () => {
    const caller = await getAuthProvider().getSessionUser()
    if (!caller) return fail('UNAUTHORIZED', 'Authentication required.')

    // Same gate as editing the pupil: a guardian's contact details are part of the record.
    if (!can(caller.role as Role, 'students:write')) {
      return fail('FORBIDDEN', 'Your role does not include pupil records.')
    }

    const { id } = await params
    if (!UUID_RE.test(id)) return fail('VALIDATION_ERROR', 'Pupil id must be a UUID.')

    const parsed = linkSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return validationFailed(parsed.error)

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client
      .rpc('link_parent_to_student', {
        p_student_id: id,
        p_full_name: parsed.data.fullName,
        p_phone: parsed.data.phone,
        p_relationship: parsed.data.relationship,
        p_email: parsed.data.email ? parsed.data.email : null,
        p_is_primary: parsed.data.isPrimary,
      })
      .maybeSingle()

    if (error) {
      // 22023 is the function's own validation — a bad relationship or an unusable
      // phone — and reads better to the office than a generic server error.
      if (error.code === '22023') return fail('VALIDATION_ERROR', error.message)
      return fromPostgrestError(error)
    }

    const row = (data ?? {}) as {
      out_link_id?: string
      out_parent_id?: string
      out_created?: boolean
      out_message?: string
    }

    return created({
      linkId: row.out_link_id,
      parentId: row.out_parent_id,
      parentCreated: row.out_created ?? false,
      message: row.out_message ?? 'Guardian linked.',
    })
  })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return guard(async () => {
    const caller = await getAuthProvider().getSessionUser()
    if (!caller) return fail('UNAUTHORIZED', 'Authentication required.')

    if (!can(caller.role as Role, 'students:write')) {
      return fail('FORBIDDEN', 'Your role does not include pupil records.')
    }

    const { id } = await params
    if (!UUID_RE.test(id)) return fail('VALIDATION_ERROR', 'Pupil id must be a UUID.')

    const parsed = unlinkSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return validationFailed(parsed.error)

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client
      .rpc('unlink_parent_from_student', { p_link_id: parsed.data.linkId })
      .maybeSingle()

    if (error) return fromPostgrestError(error)

    const row = (data ?? {}) as { out_unlinked?: boolean; out_access_until?: string }
    if (!row.out_unlinked) return fail('NOT_FOUND', 'That guardian is not linked to this pupil.')

    return ok({
      unlinked: true,
      // Surfaced so the screen can say so: removing a guardian is not instant, and a
      // school expecting it to be would otherwise think it had failed.
      accessUntil: row.out_access_until ?? null,
    })
  })
}
