/**
 * GET /api/school/structure — the school's own grade levels and classes.
 *
 * Spec: `Official Documentation/04 Country and Configuration/ZM.md`
 *       `Official Documentation/06 School and Tenant Module/ACADEMIC_STRUCTURE.md`
 *       `Official Documentation/01 Foundation Layer/DYNAMIC_CONFIG.md`
 *
 * ## Why this route exists rather than a constant
 *
 * Every enrolment form needs a grade list and a class list. The tempting version
 * is an array in the source — `['grade_1', …, 'grade_12']` — and it would be
 * wrong for most Zambian private schools on the day it shipped.
 *
 * Zambia runs two education systems simultaneously: traditional ECZ Grades 1–12,
 * and the 2023 reform's Grades 1–6 then Forms 1–6. Most private schools are
 * mid-transition, so grade levels are **school-configurable** — a secondary
 * school in Kitwe offers Form 1 to Form 6 and no grades at all, and a hardcoded
 * list would offer its registrar twelve options none of which are right.
 *
 * `school_grade_levels` is where each school's answer lives. This reads it.
 *
 * ## Classes are derived, not stored
 *
 * There is no classes table. `students.class_id` is TEXT, and a class exists
 * because pupils are in it. So the class list is the distinct set in use at this
 * school, which has one useful property — it can never offer a class that does
 * not exist — and one limitation: a newly created class with no pupils yet
 * cannot be picked from the list. The enrolment form therefore lets a class be
 * typed as well as chosen. When `ACADEMIC_STRUCTURE.md`'s classes table is
 * built, this section reads it instead and the form stops accepting free text.
 */

import { getAuthProvider } from '@zsms/auth-provider'

import { createUserClient } from '../../../../lib/supabase'
import { AFRITECH_ORG_SLUG } from '../../../../lib/admin-context'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  return guard(async () => {
    const session = await getAuthProvider().getSessionUser()
    if (!session) return fail('UNAUTHORIZED', 'Authentication required.')

    // An operator's policies match every school, so this would return the union
    // of every school's grades as though they belonged to one. Refused rather
    // than answered wrongly.
    if (session.organisationSlug === AFRITECH_ORG_SLUG) {
      return fail('FORBIDDEN', 'This is a school endpoint.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    // `school_staff_read_grade_levels` admits any member of the school, so no
    // role check is needed or wanted — a teacher filling a register needs the
    // same list a registrar does.
    const [levels, classes] = await Promise.all([
      client
        .from('school_grade_levels')
        .select('level_id, display_name, level_order, level_type, examination_type')
        .eq('is_active', true)
        .order('level_order', { ascending: true }),
      client.from('students').select('grade_id, class_id').eq('is_deleted', false),
    ])

    if (levels.error) return fromPostgrestError(levels.error)

    // Distinct classes, kept with the grade they belong to so the enrolment
    // form can narrow the class list once a grade is chosen.
    const byGrade = new Map<string, Set<string>>()
    for (const row of (classes.data ?? []) as Array<{ grade_id: string; class_id: string }>) {
      if (!row.class_id) continue
      const set = byGrade.get(row.grade_id) ?? new Set<string>()
      set.add(row.class_id)
      byGrade.set(row.grade_id, set)
    }

    return ok({
      // The caller's role rides along, because every screen that fetches the
      // structure also has to decide whether to offer a write. Fetching it
      // separately would mean a second round trip to answer a question this
      // response already knows the answer to.
      role: session.role,
      gradeLevels: levels.data ?? [],
      classesByGrade: Object.fromEntries(
        [...byGrade.entries()].map(([grade, set]) => [grade, [...set].sort()]),
      ),
    })
  })
}
