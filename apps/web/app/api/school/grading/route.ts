/**
 * GET/PUT /api/school/grading — a school's grading scales and their revision history.
 *
 * Spec: `11 Examinations and Results/GRADING.md`
 *       ADR-041 (grading scale versioning)
 *
 * ## Why this route exists
 *
 * `revise_grading_scale()` has existed since `0141` with the whole versioning
 * apparatus behind it — `school_grading_scale_versions`, `current_grading_scale_version()`,
 * `reject_used_grading_scale_version_change()` to stop a version that has graded a
 * result being edited, and a 20-assertion pgTAP suite. **Nothing called it.** A school
 * could not change its own grade boundaries through any surface.
 *
 * That is the most expensive failure shape in this repository: work that is finished,
 * tested and unreachable. `npm run gaps` listed it.
 *
 * ## Versions, not edits
 *
 * A boundary change does not rewrite history. `reject_used_grading_scale_version_change()`
 * refuses any edit to a version that has already graded a result, so revising creates a
 * new version and the old one stays attached to the marks it produced. That is what makes
 * a grade from last term still explainable after a scale change — the point of ADR-041.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

interface Band {
  letter: string
  min: number
  max: number
  points?: number
  descriptor?: string
}

export async function GET(): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    /*
      RLS scopes both reads to the caller's school, so no filter is written here —
      a second copy of that rule is the one a direct PostgREST call skips.
    */
    const [scales, versions] = await Promise.all([
      client
        .from('school_grading_scales')
        .select(
          'id, scale_name, scale_type, grade_bands, pass_mark, credit_mark, applies_to_levels, is_active',
        )
        .order('scale_name'),
      client
        .from('school_grading_scale_versions')
        .select(
          'id, grading_scale_id, version_number, revision_reason, effective_from, superseded_at, created_by_user_id',
        )
        .order('version_number', { ascending: false }),
    ])

    if (scales.error) return fromPostgrestError(scales.error)

    /*
      The history is secondary: if it fails the page still shows the scales and says
      the history is unavailable, rather than refusing to render anything. A school
      cannot fix its boundaries if the screen will not load.
    */
    const history = versions.error ? [] : (versions.data ?? [])

    return ok({
      scales: (scales.data ?? []).map((s) => ({
        id: s.id,
        name: s.scale_name,
        type: s.scale_type,
        bands: (s.grade_bands ?? []) as Band[],
        passMark: s.pass_mark,
        creditMark: s.credit_mark,
        appliesToLevels: s.applies_to_levels ?? [],
        isActive: s.is_active,
        versions: history
          .filter((v) => v.grading_scale_id === s.id)
          .map((v) => ({
            id: v.id,
            number: v.version_number,
            reason: v.revision_reason,
            effectiveFrom: v.effective_from,
            supersededAt: v.superseded_at,
            // The current version is the one nothing has superseded.
            isCurrent: v.superseded_at === null,
          })),
      })),
      historyLoaded: !versions.error,
    })
  })
}

const bandSchema = z.object({
  letter: z.string().trim().min(1).max(5),
  min: z.number().min(0).max(100),
  max: z.number().min(0).max(100),
  points: z.number().int().min(0).max(100).optional(),
  descriptor: z.string().trim().max(60).optional(),
})

const schema = z.object({
  scaleId: z.string().uuid(),
  bands: z.array(bandSchema).min(2).max(20),
  passMark: z.number().min(0).max(100).optional(),
  creditMark: z.number().min(0).max(100).optional(),
  // Required by `revise_grading_scale()`: a boundary change alters what a grade
  // means, and the version row carries why.
  reason: z.string().trim().min(3).max(500),
})

export async function PUT(request: Request): Promise<Response> {
  return guard(async () => {
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return fail('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.')
    }

    const v = parsed.data

    /*
      Band coherence, checked here because it is a property of the SET rather than of
      any one band, and a per-band CHECK cannot see its neighbours.

      Gaps and overlaps are both real failures with different symptoms: an overlap
      makes a mark ambiguous, a gap makes it ungradeable. Sorted first so the message
      can name the pair at fault.
    */
    const sorted = [...v.bands].sort((a, b) => a.min - b.min)
    for (const b of sorted) {
      if (b.min > b.max) {
        return fail('VALIDATION_ERROR', `Grade ${b.letter} has its minimum above its maximum.`)
      }
    }
    for (let i = 1; i < sorted.length; i += 1) {
      const below = sorted[i - 1]!
      const above = sorted[i]!
      if (above.min <= below.max) {
        return fail(
          'VALIDATION_ERROR',
          `Grades ${below.letter} and ${above.letter} overlap, so a mark in between has two grades.`,
        )
      }
      if (above.min > below.max + 1) {
        return fail(
          'VALIDATION_ERROR',
          `There is a gap between ${below.letter} and ${above.letter}, so some marks would have no grade.`,
        )
      }
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { error } = await client.rpc('revise_grading_scale', {
      p_scale_id: v.scaleId,
      p_grade_bands: sorted,
      p_pass_mark: v.passMark ?? null,
      p_credit_mark: v.creditMark ?? null,
      p_reason: v.reason,
    })

    if (error) {
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      if (error.code === '22023') return fail('VALIDATION_ERROR', error.message)
      return fromPostgrestError(error)
    }

    return ok({
      message:
        'Saved as a new version. Results already graded keep the scale that graded them, so last term’s grades still mean what they meant.',
    })
  })
}
