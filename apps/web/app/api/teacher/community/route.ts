/**
 * GET/PATCH /api/teacher/community — the Community Library.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md`
 *       → *5. Community Library (Phase 3)*
 *
 * ## Everything goes through the functions, nothing through the table
 *
 * There is deliberately no broad SELECT policy on `teaching_resources`, because a policy
 * cannot return a subset of columns and the row carries `created_by` (a Clerk id) and
 * `school_id`. `DATABASE.md` is explicit that the library "must show a first name and a
 * subject, never an identity".
 *
 * So this route calls `community_library()`, `community_resource()`,
 * `rate_teaching_resource()` and `use_community_resource()` (`0217`) and never touches
 * the table. A `.from('teaching_resources')` in this file would be a defect.
 *
 * ## "Use this plan" copies
 *
 * The spec has it opening in the planner pre-filled. So using a plan creates a NEW
 * resource owned by the caller — two teachers must never edit one row, or the original
 * author watches their plan change under them. The copy is not shared: republishing
 * somebody else's work should be a deliberate second act.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const SORTS = ['popular', 'recent', 'rating'] as const

export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const url = new URL(request.url)

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const id = url.searchParams.get('id')

    /*
      One resource, for the preview before copying.

      `community_resource()` checks `is_shared` itself, so an id that names somebody's
      PRIVATE plan returns nothing rather than its content.
    */
    if (id) {
      const { data, error } = await client.rpc('community_resource', { p_id: id })
      if (error) return fromPostgrestError(error)

      const row = ((data ?? []) as Array<Record<string, unknown>>)[0]
      if (!row) {
        // Not found and not shared are one answer: confirming it exists would tell a
        // caller about a plan they may not see.
        return fail('NOT_FOUND', 'That resource is not available.')
      }

      return ok({
        resource: {
          id: row['out_id'],
          title: row['out_title'],
          resourceKind: row['out_resource_kind'],
          subject: row['out_subject'],
          gradeLevel: row['out_grade_level'],
          topic: row['out_topic'],
          curriculumType: row['out_curriculum_type'],
          durationMinutes: row['out_duration'],
          content: row['out_content'],
          authorFirstName: row['out_author_first'],
          ratingAverage: Number(row['out_rating_avg'] ?? 0),
          ratingCount: Number(row['out_rating_count'] ?? 0),
        },
      })
    }

    const sortParam = url.searchParams.get('sort')
    const sort = (SORTS as readonly string[]).includes(sortParam ?? '')
      ? (sortParam as string)
      : 'popular'

    const minRating = url.searchParams.get('minRating')

    const { data, error } = await client.rpc('community_library', {
      p_subject: url.searchParams.get('subject') || null,
      p_grade_level: url.searchParams.get('gradeLevel') || null,
      p_curriculum_type: url.searchParams.get('curriculumType') || null,
      p_resource_kind: url.searchParams.get('kind') || null,
      p_min_rating: minRating ? Number(minRating) : null,
      p_sort: sort,
      p_limit: 40,
    })

    if (error) return fromPostgrestError(error)

    const rows = (data ?? []) as Array<Record<string, unknown>>

    return ok({
      resources: rows.map((x) => ({
        id: x['out_id'],
        title: x['out_title'],
        resourceKind: x['out_resource_kind'],
        subject: x['out_subject'],
        gradeLevel: x['out_grade_level'],
        topic: x['out_topic'],
        curriculumType: x['out_curriculum_type'],
        durationMinutes: x['out_duration'],
        sharedAt: x['out_shared_at'],
        /* A first name and nothing else. See the header. */
        authorFirstName: x['out_author_first'],
        authorSubject: x['out_author_subject'],
        ratingAverage: Number(x['out_rating_avg'] ?? 0),
        ratingCount: Number(x['out_rating_count'] ?? 0),
        useCount: Number(x['out_use_count'] ?? 0),
        /* So the stars render filled without a second request. */
        myRating: x['out_my_rating'] === null ? null : Number(x['out_my_rating']),
      })),
      sort,
      /*
        Said explicitly, because an empty library and a too-narrow filter look identical
        on screen and have different remedies.
      */
      filtered: Boolean(
        url.searchParams.get('subject') ||
          url.searchParams.get('gradeLevel') ||
          url.searchParams.get('curriculumType') ||
          url.searchParams.get('kind') ||
          minRating,
      ),
    })
  })
}

const patchSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('rate'),
    id: z.string().uuid(),
    rating: z.number().int().min(1).max(5),
  }),
  z.object({ action: z.literal('use'), id: z.string().uuid() }),
  /** The author's own decision to publish or withdraw. */
  z.object({
    action: z.literal('share'),
    id: z.string().uuid(),
    shared: z.boolean(),
  }),
])

export async function PATCH(request: Request): Promise<Response> {
  return guard(async () => {
    const parsed = patchSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return fail('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    if (parsed.data.action === 'rate') {
      const { data, error } = await client.rpc('rate_teaching_resource', {
        p_id: parsed.data.id,
        p_rating: parsed.data.rating,
      })
      if (error) {
        /*
          `42501` here is "you cannot rate your own resource", not a session problem.
          Passed through, because the function's message says exactly that and a
          generic FORBIDDEN would read as a permissions bug.
        */
        if (error.code === '42501') return fail('FORBIDDEN', error.message)
        return fromPostgrestError(error)
      }
      return ok({ ratingAverage: Number(data ?? 0) })
    }

    if (parsed.data.action === 'use') {
      const { data, error } = await client.rpc('use_community_resource', {
        p_id: parsed.data.id,
      })
      if (error) return fromPostgrestError(error)

      return ok({
        copyId: data as string,
        message: 'Copied to your library. Edit it there — the original is untouched.',
      })
    }

    const { data, error } = await client.rpc('share_teaching_resource', {
      p_id: parsed.data.id,
      p_shared: parsed.data.shared,
    })
    if (error) return fromPostgrestError(error)

    return ok({
      shared: data === true,
      message: parsed.data.shared
        ? 'Shared. Other teachers see your first name and the subject, never your full name or school.'
        : 'Withdrawn from the Community Library. Copies other teachers already made are theirs to keep.',
    })
  })
}
