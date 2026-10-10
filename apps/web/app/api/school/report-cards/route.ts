/**
 * Report cards — asking for a batch, and seeing what came of it.
 *
 *   GET  /api/school/report-cards?year=2026&term=2 — what has been generated
 *   POST /api/school/report-cards                  — generate for a class or a whole term
 *
 * Spec: `Official Documentation/13 Document and PDF System/PDF_GENERATION.md`
 *       `Official Documentation/11 Examinations and Results/BULK_GENERATION.md`
 *       `Official Documentation/11 Examinations and Results/PUBLISHING.md`
 *
 * ## What this closes
 *
 * Everything needed to produce a report card already existed — `generated_documents`, the
 * `generate-report-card` worker, and the renderer in `packages/documents` — and **no route
 * and no screen reached any of it**. A school could publish results and then had no way to
 * give a family the document those results are for, which is the artefact a Zambian term
 * actually ends with.
 *
 * ## Enqueued, never awaited
 *
 * `PDF_GENERATION.md` budgets 400 cards in 90 seconds. That is fast for a batch and far too
 * slow for a request a principal is watching, so the route queues the job and returns. The
 * same reasoning as receipt generation, and the same queue.
 *
 * ## Publication is not required, and that is deliberate
 *
 * `PUBLISHING.md` makes publishing and generating two separate buttons in either order,
 * because a principal may want to read a draft card before parents see the marks. So this
 * does not refuse an unpublished term — it reports how many of the marks are published, and
 * the screen says so, which is the honest version of the same caution.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { getAuthProvider, type Role } from '@zsms/auth-provider'
import { can } from '../../../../lib/roles'
import { resolveSchoolContext } from '../../../../lib/school-context'
import {
  fail,
  fromPostgrestError,
  guard,
  ok,
  validationFailed,
} from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const generateSchema = z.object({
  academicYear: z.string().trim().regex(/^\d{4}(\/\d{4})?$/, 'Academic year looks wrong.'),
  termNumber: z.number().int().min(1).max(4),
  // Omitted means the whole term, every class. `BULK_GENERATION.md` treats that as the
  // normal end-of-term action and a single class as the exception for a late mark sheet.
  classId: z.string().trim().max(50).optional(),
})

export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const caller = await getAuthProvider().getSessionUser()
    if (!caller) return fail('UNAUTHORIZED', 'Authentication required.')

    if (!can(caller.role as Role, 'results:read')) {
      return fail('FORBIDDEN', 'Your role does not include results.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const params = new URL(request.url).searchParams
    const year = params.get('year')
    const term = Number(params.get('term'))

    let query = client
      .from('generated_documents')
      .select(
        'id, doc_type, student_id, academic_year, term_number, status, failure_reason, byte_size, storage_path, created_at',
      )
      .eq('doc_type', 'report_card')
      .order('created_at', { ascending: false })
      .limit(500)

    if (year) query = query.eq('academic_year', year)
    if (Number.isInteger(term) && term >= 1 && term <= 4) query = query.eq('term_number', term)

    const { data, error } = await query
    if (error) return fromPostgrestError(error)

    const rows = data ?? []

    return ok({
      documents: rows,
      // Counted here rather than in the screen so the two cannot disagree about what
      // "ready" means — a card that failed is not one a parent can be given.
      summary: {
        total: rows.length,
        ready: rows.filter((d) => d.status === 'ready').length,
        failed: rows.filter((d) => d.status === 'failed').length,
        pending: rows.filter((d) => d.status !== 'ready' && d.status !== 'failed').length,
      },
    })
  })
}

export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const caller = await getAuthProvider().getSessionUser()
    if (!caller) return fail('UNAUTHORIZED', 'Authentication required.')

    /*
      The same permission as publishing, not merely reading results.

      A report card is the school's formal statement of a child's term, carrying the
      school's name and crest. `PUBLISHING.md` reserves publication to the owner and
      principal for that reason, and generating the document that embodies it is the
      same act of authority.
    */
    if (!can(caller.role as Role, 'results:publish')) {
      return fail('FORBIDDEN', 'Only the owner or principal may generate report cards.')
    }

    const parsed = generateSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return validationFailed(parsed.error)

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const school = await resolveSchoolContext(client)
    if (!school) return fail('FORBIDDEN', 'This session is not associated with a school.')

    const { academicYear, termNumber, classId } = parsed.data

    /*
      How many pupils this will actually produce a card for, and how many of their marks
      are published. Counted BEFORE queueing so the response can tell the principal what
      they just started — a batch that silently covers nobody, because the term is wrong,
      is otherwise indistinguishable from one still running.
    */
    let countQuery = client
      .from('exam_results')
      .select('student_id, results_published', { count: 'exact' })
      .eq('academic_year', academicYear)
      .eq('term_number', termNumber)
    if (classId) countQuery = countQuery.eq('class_id', classId)

    const marks = await countQuery
    if (marks.error) return fromPostgrestError(marks.error)

    const pupils = new Set((marks.data ?? []).map((m) => m.student_id))
    if (pupils.size === 0) {
      return fail(
        'NOT_FOUND',
        classId
          ? 'No marks have been entered for that class in that term.'
          : 'No marks have been entered for that term.',
      )
    }

    const unpublished = (marks.data ?? []).filter((m) => !m.results_published).length

    try {
      const { getQueue } = await import('@zsms/queue')
      await getQueue().enqueue(
        'generate-report-card',
        { schoolId: school.uuid, academicYear, termNumber, classId },
        {
          // Lower than a receipt: a parent is waiting on a receipt in real time, whereas
          // a report card batch is an end-of-term action nobody is watching the clock on.
          priority: 3,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          // The same term requested twice must not render every card twice. Scoped to the
          // class too, so generating 7A and then 7B are two distinct jobs.
          deduplicationId: `report-cards:${school.uuid}:${academicYear}:${termNumber}:${classId ?? 'all'}`,
        },
      )
    } catch (err) {
      // Unlike a receipt, there is nothing already recorded that must survive — so a
      // failure to queue IS the failure, and saying "started" would be a lie the
      // principal only discovers when no cards appear.
      console.error('[api] failed to enqueue report cards', err)
      return fail(
        'SERVER_ERROR',
        'Report cards could not be started. The job queue is not reachable.',
      )
    }

    // `ok`, not a new `accepted` helper: CONVENTIONS.md fixes the success envelope as
    // `{ data, meta }` and a fourth shape in that file would be one more thing to keep
    // in step. `queued: true` already says the work is asynchronous.
    return ok({
      queued: true,
      pupils: pupils.size,
      // Surfaced rather than blocked: publishing and generating are two separate acts in
      // either order, so a draft card before publication is a legitimate thing to want.
      unpublishedMarks: unpublished,
    })
  })
}
