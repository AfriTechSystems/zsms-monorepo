/**
 * The schools a parent has children at.
 *
 *   GET /api/parent/schools
 *
 * Spec: `Official Documentation/07 Students and Parents/PARENTS.md`
 *
 * ## No organisation is involved
 *
 * This is a `SELECT` over children the parent can already read. `is_linked_parent_of()`
 * scopes on `parent_user_id` alone — no `current_school_uuid()`, no org claim — so a parent
 * reads every child at every school in one query, and grouping them by school is arithmetic
 * rather than a context switch.
 *
 * That is worth stating because `parent/layout.tsx` records the opposite as a known
 * limitation: "a parent with children at two ZSMS schools is in two Clerk organisations,
 * and a session acts in one at a time". The premise was never true of the schema.
 *
 * The school name is read through the FK. PostgREST resolves the embed under the caller's
 * own policies, so a school the parent has no child at produces no row.
 */

import { createUserClient } from '../../../../lib/supabase'
import { getAuthProvider } from '@zsms/auth-provider'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  return guard(async () => {
    const session = await getAuthProvider().getSessionUser()
    if (!session) return fail('UNAUTHORIZED', 'Authentication required.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client
      .from('students')
      .select('id, first_name, last_name, school_id, schools(name)')
      .eq('is_deleted', false)
      .order('first_name', { ascending: true })

    if (error) return fromPostgrestError(error)

    const children = (data ?? []).map((row) => {
      const r = row as unknown as {
        id: string
        first_name: string
        last_name: string
        school_id: string
        schools: { name: string } | null
      }
      return {
        id: r.id,
        first_name: r.first_name,
        last_name: r.last_name,
        school_id: r.school_id,
        school_name: r.schools?.name ?? null,
      }
    })

    return ok({ children })
  })
}
