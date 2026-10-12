/**
 * GET  /api/school/saved-views?surface=students — the school's named filter sets.
 * POST /api/school/saved-views                  — save the filters in hand.
 * DELETE /api/school/saved-views?id=…           — remove one.
 *
 * Spec: migration `0269`
 *
 * ## The route validates the filter keys; the database cannot
 *
 * `saved_views.filters` is JSONB because each list screen has different filters and
 * adding one should not need a migration. That flexibility has to be bounded
 * somewhere, and it is here: each surface declares the keys it understands, and
 * anything else is dropped rather than stored.
 *
 * Dropped, not refused. An unknown key is almost always a filter that has since been
 * removed from a screen, and refusing the whole view would make an old saved view
 * unopenable rather than merely narrower.
 *
 * ## No authorisation in this file
 *
 * `0269`'s policies decide all three: anybody at the school may read and create, only
 * the creator or the owner/principal may delete. Re-checking here would be a second
 * copy of a rule that already exists, and it is the copy a direct PostgREST call
 * skips.
 */

import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { resolveSchoolContext } from '../../../../lib/school-context'
import { getAuthProvider } from '@zsms/auth-provider'
import { created, fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

/**
 * The filter keys each screen understands, as its query string spells them.
 *
 * Kept here rather than imported from the screens so that a screen renaming a filter
 * cannot silently invalidate every view somebody saved — the rename shows up as a
 * change to this list, which is a place to think about migrating them.
 */
const SURFACE_KEYS = {
  // Read off the screen, not guessed. The first draft of this list said `grade` and
  // the pupil list spells it `gradeId` — so every saved view would have dropped its
  // year-group filter silently and resolved to the whole roll. Check the screen.
  students: ['status', 'gradeId', 'q'],
  staff: ['role', 'status', 'q'],
  fees: ['status', 'gradeId', 'term', 'q'],
  results: ['classId', 'subjectCode', 'termNumber', 'academicYear'],
} as const

type Surface = keyof typeof SURFACE_KEYS

const SURFACES = Object.keys(SURFACE_KEYS) as [Surface, ...Surface[]]

const createSchema = z.object({
  surface: z.enum(SURFACES),
  name: z.string().trim().min(1).max(60),
  filters: z.record(z.string(), z.string()).default({}),
})

export async function GET(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const surface = request.nextUrl.searchParams.get('surface')
    if (!surface || !(surface in SURFACE_KEYS)) {
      return fail('VALIDATION_ERROR', 'Choose a screen to list views for.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client
      .from('saved_views')
      // One literal, never concatenated: splitting it kills PostgREST's row-type
      // inference and the result stops being spreadable.
      .select('id, name, filters, created_by, created_at')
      .eq('surface', surface)
      .order('name')

    if (error) return fromPostgrestError(error)

    return ok({ views: data ?? [] })
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const parsed = createSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return fail('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    /*
      Both halves of the INSERT policy, resolved from the SESSION and never from the
      request body: the policy requires `school_id = current_school_uuid()` and
      `created_by = get_user_id()`, so a body-supplied value would be refused anyway —
      but sending one at all invites somebody to try.
    */
    const session = await getAuthProvider().getSessionUser()
    if (!session) return fail('UNAUTHORIZED', 'Authentication required.')

    const school = await resolveSchoolContext(client)
    if (!school) return fail('FORBIDDEN', 'This account is not attached to a school.')

    /*
      Keep only the keys this screen understands, and only non-empty values.

      An empty value is how a screen spells "no filter", so storing it would make a
      view that reads as narrower than it is — and `filters` is what a chip's tooltip
      is built from.
    */
    const allowed = new Set<string>(SURFACE_KEYS[parsed.data.surface])
    const filters = Object.fromEntries(
      Object.entries(parsed.data.filters).filter(
        ([k, v]) => allowed.has(k) && v.trim().length > 0,
      ),
    )

    if (Object.keys(filters).length === 0) {
      return fail(
        'VALIDATION_ERROR',
        'Choose at least one filter before saving this as a view.',
      )
    }

    const { data, error } = await client
      .from('saved_views')
      .insert({
        school_id: school.uuid,
        surface: parsed.data.surface,
        name: parsed.data.name,
        filters,
        created_by: session.userId,
      })
      .select('id, name, filters, created_by, created_at')
      .single()

    if (error) {
      // The unique constraint. Named, because "already exists" is something the
      // writer can act on and a constraint name is not.
      if (error.code === '23505') {
        return fail('CONFLICT', 'A view with that name already exists on this screen.')
      }
      return fromPostgrestError(error)
    }

    return created({ view: data })
  })
}

export async function DELETE(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const id = request.nextUrl.searchParams.get('id')
    if (!id) return fail('VALIDATION_ERROR', 'Which view should be removed?')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client
      .from('saved_views')
      .delete()
      .eq('id', id)
      .select('id')

    if (error) return fromPostgrestError(error)

    /*
      Zero rows means the policy refused OR it was already gone, and those are
      deliberately one answer. Distinguishing them would confirm that somebody else's
      view exists, which is the same rule the rest of this API follows.
    */
    if (!data || data.length === 0) {
      return fail('NOT_FOUND', 'That view is not available to remove.')
    }

    return ok({ removed: id })
  })
}
