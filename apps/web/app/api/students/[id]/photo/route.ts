/**
 * PUT /api/students/[id]/photo — attach a stored image to a pupil's record.
 *
 * Spec: migration `0265`
 *
 * Separate from `/api/uploads/photo`, which stores bytes and decides nothing about
 * whose picture they become. This is the half that answers "may this person change
 * this pupil's photo", and the answer comes from `set_student_photo()`.
 *
 * ## No role check here
 *
 * `set_student_photo()` admits the owner, principal and administrator, refuses a
 * teacher and a parent, and takes the school from the session rather than from this
 * request. Re-checking here would be a second copy of the rule — and the route is the
 * copy a direct PostgREST call skips.
 *
 * A parent viewing their child never reaches this: the screen does not render the
 * control, and the function would refuse it if they forged the call.
 */

import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { createUserClient } from '../../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok } from '../../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const schema = z.object({
  /*
    Empty string CLEARS the photo, which is how a wrong picture is removed rather than
    only replaced. `0265` treats it the same way.
  */
  photoUrl: z.union([
    z.string().trim().url().startsWith('https://', { message: 'A photo must be an https address.' }),
    z.literal(''),
  ]),
})

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return guard(async () => {
    const { id } = await context.params

    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return fail('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { error } = await client.rpc('set_student_photo', {
      p_student_id: id,
      p_photo_url: parsed.data.photoUrl,
    })

    if (error) {
      // `42501` covers both "not your role" and "not your pupil" — one answer, so this
      // cannot be used to discover that another school holds a particular pupil.
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      if (error.code === '22023') return fail('VALIDATION_ERROR', error.message)
      return fromPostgrestError(error)
    }

    return ok({
      message: parsed.data.photoUrl ? 'Photo updated.' : 'Photo removed.',
    })
  })
}
