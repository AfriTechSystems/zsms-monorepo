/**
 * POST /api/admin/schools/[id]/activate — verification call recorded, school switched on.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/SCHOOL_SETUP.md`
 *       → *Verification and Activation*
 *
 * ## The note is the control
 *
 * Verification here is a phone call, not a document check — decided 2026-09-29. A regional manager
 * rings the school, confirms the details are real, and writes down what they were told.
 *
 * That makes the note the entire evidentiary record, which is why `admin_activate_school()`
 * refuses an empty one. An activation button that ticks a status with nothing written beside it
 * would be a control in name only, and in an audit the difference between "verified" and
 * "somebody clicked verified" is the note.
 *
 * The check lives in the function rather than in this file, so a direct RPC call cannot skip it.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../../../lib/supabase'
import { resolveAdminContext } from '../../../../../../lib/admin-context'
import { fail, fromPostgrestError, guard, ok, validationFailed } from '../../../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const schema = z.object({
  verificationNote: z
    .string()
    .trim()
    .min(10, 'Say what the call established — a few words is enough, but not none.')
    .max(2000),
})

interface ActivatedSchool {
  id: string
  school_id: string
  name: string
  status: string
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return guard(async () => {
    const admin = await resolveAdminContext()
    if (!admin) {
      return fail('FORBIDDEN', 'This area is restricted to AfriTech platform administrators.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { id } = await params
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return validationFailed(parsed.error)

    const { data, error } = await client.rpc('admin_activate_school', {
      p_school_id: id,
      p_verification_note: parsed.data.verificationNote,
    })

    if (error) return fromPostgrestError(error)

    const school = (data as unknown as ActivatedSchool[])[0]
    if (!school) return fail('NOT_FOUND', 'No such school.')

    return ok({
      id: school.id,
      schoolCode: school.school_id,
      name: school.name,
      status: school.status,
    })
  })
}
