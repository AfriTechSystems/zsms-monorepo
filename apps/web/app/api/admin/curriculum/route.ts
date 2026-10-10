/**
 * The curriculum store, from AfriTech's side.
 *
 *   GET  /api/admin/curriculum — coverage: what is grounded and what is not
 *   POST /api/admin/curriculum — import syllabus topics
 *
 * Spec: `Official Documentation/18 AI Module/LESSON_PLANNER.md`
 *
 * ## The import is not atomic, deliberately
 *
 * `import_curriculum_topics()` skips a bad row and reports it rather than aborting the file. A
 * syllabus is hundreds of rows transcribed by hand from a PDF; failing the whole import on row 214
 * and reporting one message means the operator fixes one typo per round trip.
 *
 * That is the opposite of `import_students()`, which IS atomic — and the difference is the point.
 * A partial pupil roll is a real problem with real consequences. A partially imported syllabus is
 * visible in `curriculum_coverage()` and simply gets re-imported.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { resolveAdminContext } from '../../../../lib/admin-context'
import {
  fail,
  fromPostgrestError,
  guard,
  ok,
  validationFailed,
} from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const topicSchema = z.object({
  country_code: z.string().trim().length(2).optional(),
  curriculum_type: z.string().trim().min(1).max(40).optional(),
  subject: z.string().trim().min(1).max(80),
  grade_level: z.string().trim().min(1).max(40),
  topic_code: z.string().trim().min(1).max(40),
  topic_name: z.string().trim().min(1).max(300),
  sub_topics: z.array(z.string().trim().min(1)).optional(),
  learning_outcomes: z.array(z.string().trim().min(1)).optional(),
  suggested_periods: z.union([z.number().int().positive(), z.string()]).optional(),
  source: z.string().trim().min(1).max(200),
  source_url: z.string().trim().url().max(500).optional().or(z.literal('')),
  syllabus_year: z.union([z.number().int(), z.string()]).optional(),
  display_order: z.union([z.number().int(), z.string()]).optional(),
})

const importSchema = z.object({
  // A syllabus subject-and-grade is tens of rows; a whole subject across every grade is hundreds.
  // Capped so a paste of the wrong file is refused rather than becoming a very slow request.
  rows: z.array(topicSchema).min(1).max(2000),
})

interface CoverageRow {
  country_code: string
  curriculum_type: string
  subject: string
  grade_level: string
  topic_count: number
  outcome_count: number
  sources: string[]
  last_updated: string
}

export async function GET(): Promise<Response> {
  return guard(async () => {
    const admin = await resolveAdminContext()
    if (!admin) {
      return fail('FORBIDDEN', 'This area is restricted to AfriTech platform administrators.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client.rpc('curriculum_coverage')
    if (error) return fromPostgrestError(error)

    const rows = (data ?? []) as unknown as CoverageRow[]

    return ok(
      {
        coverage: rows,
        totals: {
          combinations: rows.length,
          topics: rows.reduce((sum, r) => sum + Number(r.topic_count), 0),
          /**
           * Outcomes, not just topics. A slice of topic names with no learning outcomes is
           * technically ingested and substantively useless — it grounds nothing, because a topic
           * name alone tells a model little it did not already know. Surfacing both is what makes
           * that distinction visible instead of hiding behind a row count.
           */
          outcomes: rows.reduce((sum, r) => sum + Number(r.outcome_count), 0),
          subjects: [...new Set(rows.map((r) => r.subject))].length,
        },
      },
      { total: rows.length },
    )
  })
}

export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const admin = await resolveAdminContext()
    if (!admin) {
      return fail('FORBIDDEN', 'This area is restricted to AfriTech platform administrators.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const parsed = importSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return validationFailed(parsed.error)

    const { data, error } = await client
      .rpc('import_curriculum_topics', {
        p_rows: parsed.data.rows as unknown as Record<string, unknown>[],
      })
      .maybeSingle()

    if (error) {
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      if (error.code === '22023') return fail('VALIDATION_ERROR', error.message)
      return fromPostgrestError(error)
    }

    return ok(data)
  })
}
