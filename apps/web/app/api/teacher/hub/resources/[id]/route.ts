/**
 * One saved resource.
 *
 *   GET   /api/teacher/hub/resources/[id] — the full document
 *   PATCH /api/teacher/hub/resources/[id] — rename, annotate, share, or remove
 *
 * Spec: `Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md`
 *
 * ## What PATCH cannot touch, and why that is a feature
 *
 * `content`, `generator_name` and `generator_version` are absent from the column-level
 * UPDATE grant in `0130`. A generated document is not editable in place: if the text could
 * be rewritten while the row still claimed a generator produced it, the provenance would
 * be a lie, and provenance is the only thing that will distinguish today's scaffolds from
 * tomorrow's model output. The teacher annotates with `teacher_notes` instead.
 *
 * ## Removal is a flag
 *
 * There is no DELETE grant on this table — the repository-wide invariant that `0129` had to
 * restore twice. `isDeleted: true` is how a resource leaves the library, and it stays
 * readable to a support query afterwards.
 */

import { createUserClient } from '../../../../../../lib/supabase'
import { getAuthProvider } from '@zsms/auth-provider'
import {
  fail,
  fromPostgrestError,
  guard,
  ok,
  validationFailed,
} from '../../../../../../lib/api-response'
import { resourcePatchSchema } from '../../../../../../lib/teacher-hub'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return guard(async () => {
    const session = await getAuthProvider().getSessionUser()
    if (!session) return fail('UNAUTHORIZED', 'Authentication required.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { id } = await params

    const { data, error } = await client
      .from('teaching_resources')
      .select('*')
      .eq('id', id)
      .eq('is_deleted', false)
      .maybeSingle()

    if (error) return fromPostgrestError(error)

    /**
     * Somebody else's resource and a resource that does not exist produce the same answer,
     * because the policy filters the row out before this code sees it. That is the correct
     * outcome: distinguishing them would confirm the existence of another teacher's work.
     */
    if (!data) return fail('NOT_FOUND', 'No such resource.')

    return ok(data)
  })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return guard(async () => {
    const session = await getAuthProvider().getSessionUser()
    if (!session) return fail('UNAUTHORIZED', 'Authentication required.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { id } = await params
    const parsed = resourcePatchSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return validationFailed(parsed.error)
    const body = parsed.data

    const patch: Record<string, unknown> = {}
    if (body.title !== undefined) patch['title'] = body.title
    if (body.teacherNotes !== undefined) patch['teacher_notes'] = body.teacherNotes
    if (body.isShared !== undefined) patch['is_shared'] = body.isShared
    if (body.isDeleted !== undefined) patch['is_deleted'] = body.isDeleted

    const { data, error } = await client
      .from('teaching_resources')
      .update(patch)
      .eq('id', id)
      .select('id, title, teacher_notes, is_shared, is_deleted, updated_at')

    if (error) {
      /**
       * `42501` here means the request named a column the teacher holds no privilege on —
       * so either the schema and `resourcePatchSchema` have drifted apart, or somebody
       * called the endpoint directly. Either way the honest answer is that the field is not
       * theirs to change.
       */
      if (error.code === '42501') {
        return fail('FORBIDDEN', 'That field cannot be changed once the resource is generated.')
      }
      return fromPostgrestError(error)
    }

    // Zero rows: a policy declined, or there is no such resource. Indistinguishable, and
    // deliberately so — see GET.
    if (!data || data.length === 0) return fail('NOT_FOUND', 'No such resource.')

    return ok(data[0])
  })
}
