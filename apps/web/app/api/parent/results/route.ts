/**
 * GET /api/parent/results — a child's published marks.
 *
 * Spec: `Official Documentation/11 Examinations and Results/`
 *       `Official Documentation/01 Foundation Layer/DECISIONS.md` — ADR-041
 *
 * No `results_published` filter appears below. `parent_read_published_results`
 * already carries it, so an unpublished mark is invisible to the database rather
 * than filtered out by this code — the only version of that guarantee that
 * survives someone editing this file.
 */

import type { NextRequest } from 'next/server'

import { createUserClient } from '../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'
import { listParentChildren, pickChild, resolveParentCaller } from '../../../../lib/parent-context'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const caller = await resolveParentCaller()
    if (!caller.ok) return caller.response

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const children = await listParentChildren(client)
    if (children.length === 0) return ok({ children: [], selected: null, results: [] })

    const child = pickChild(children, request.nextUrl.searchParams.get('childId'))
    if (!child) return fail('NOT_FOUND', 'That pupil is not one of your children.')

    const { data, error } = await client
      .from('exam_results')
      .select(
        'id, subject_name, subject_code, academic_year, term_number, marks_obtained, ' +
          'marks_total, grade_letter, grade_points, class_position, class_size, ' +
          'comments, published_at, grading_scale_version_id',
      )
      .eq('student_id', child.id)
      .order('academic_year', { ascending: false })
      .order('term_number', { ascending: false })
      .order('subject_name', { ascending: true })

    if (error) return fromPostgrestError(error)

    // PostgREST's inferred row type widens to a union including its error shape;
    // the runtime error is handled above, so the rows are narrowed once here.
    const rows = (data ?? []) as unknown as Array<Record<string, unknown>>

    return ok({
      children: children.map((c) => ({
        id: c.id,
        firstName: c.first_name,
        lastName: c.last_name,
      })),
      selected: { id: child.id, firstName: child.first_name, lastName: child.last_name },
      results: rows.map((r) => ({
        ...r,
        // ADR-041: whether the grade can be explained by a recorded scale
        // version. Surfaced so the screen can mark a legacy grade rather than
        // presenting it with the same confidence as one that is traceable.
        has_scale: Boolean(r.grading_scale_version_id),
      })),
    })
  })
}
