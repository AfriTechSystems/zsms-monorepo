/**
 * POST /api/school/students/import — bulk pupil import, standard and custom
 *                                    fields together.
 *
 * Spec: `Official Documentation/07 Student and Parent Modules/STUDENTS.md`
 *       `Official Documentation/16 Testing and Launch/TEST_DATA.md`
 *       migrations `0101`–`0103` (the student ceiling), `0110`/`0111`
 *
 * ## Dry run is the default, and the whole point
 *
 * `mode: 'validate'` parses, coerces and reports every problem **without
 * writing anything**. A school's first import is always partly wrong — a
 * misspelled house, a date as `03/04/2026`, a duplicated pupil number — and the
 * difference between a product people trust and one they abandon is whether they
 * find that out before or after 300 rows land in the roll.
 *
 * `mode: 'commit'` is a separate, explicit request. It re-validates from scratch
 * rather than trusting a token from the dry run, because the roll can change in
 * between and a stale "it was fine a minute ago" is not a guarantee.
 *
 * ## All or nothing, per import
 *
 * A commit that hits a problem mid-way would leave a half-imported roll nobody
 * can reason about — and the natural fix, "just run it again", would duplicate
 * the rows that did land. So the commit is one RPC inside one transaction:
 * either every row is created or none is.
 *
 * ## The ceiling still applies, and says so early
 *
 * `school_student_capacity()` is checked before writing, so an import of 400
 * pupils into a 250-pupil tier is refused with the arithmetic rather than
 * failing on row 251 with `ZS001`. The trigger remains the guarantee; this is
 * the better sentence.
 */

import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { createUserClient } from '../../../../../lib/supabase'
import { resolveFeeCaller as resolveSchoolCaller } from '../../../../../lib/fee-context'
import { resolveSchoolContext } from '../../../../../lib/school-context'
import { can } from '../../../../../lib/roles'
import { fail, fromPostgrestError, guard, ok, validationFailed } from '../../../../../lib/api-response'
import { coerceCustomValue, type CustomFieldDef } from '../../../../../lib/custom-fields'

export const dynamic = 'force-dynamic'

/** The standard columns an import may set. Everything else is a custom field. */
const STANDARD_KEYS = [
  'first_name',
  'last_name',
  'date_of_birth',
  'gender',
  'grade_id',
  'class_id',
  'nrc_or_birth_cert',
  'enrolment_date',
  'is_boarding',
] as const

const importSchema = z.object({
  mode: z.enum(['validate', 'commit']),
  // Rows as parsed from the CSV on the client: header key -> cell.
  // 500 is a deliberate ceiling — a bigger import is a job for the worker queue,
  // not a request that holds a connection open.
  rows: z.array(z.record(z.string(), z.string())).min(1).max(500),
})

interface RowProblem {
  row: number
  field: string
  message: string
}

export async function POST(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const caller = await resolveSchoolCaller()
    if (!caller.ok) return caller.response

    if (!can(caller.role, 'students:write')) {
      return fail('FORBIDDEN', 'Only the owner, principal and administrator import pupils.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return fail('VALIDATION_ERROR', 'Request body must be valid JSON.')
    }

    const parsed = importSchema.safeParse(body)
    if (!parsed.success) return validationFailed(parsed.error)
    const { mode, rows } = parsed.data

    const school = await resolveSchoolContext(client)
    if (!school) return fail('FORBIDDEN', 'This session is not associated with a school.')

    const [defsRes, capacityRes, levelsRes] = await Promise.all([
      client
        .from('school_custom_fields')
        .select('id, field_key, label, field_type, options, is_required, sensitivity')
        .eq('entity_type', 'student')
        .eq('is_active', true),
      client.rpc('school_student_capacity', { p_school_id: school.uuid }),
      client
        .from('school_grade_levels')
        .select('level_id')
        .eq('is_active', true),
    ])

    if (defsRes.error) return fromPostgrestError(defsRes.error)

    const defs = (defsRes.data ?? []) as unknown as CustomFieldDef[]
    const defByKey = new Map(defs.map((d) => [d.field_key, d]))
    const validLevels = new Set(
      ((levelsRes.data ?? []) as Array<{ level_id: string }>).map((l) => l.level_id),
    )

    // A sensitive field in a spreadsheet is a medical note in a shared download
    // folder. Import is refused for them rather than quietly writing: the
    // narrower write policy would reject it anyway, and saying so here is the
    // difference between a clear refusal and a confusing 403 on row 12.
    const sensitiveKeys = new Set(defs.filter((d) => d.sensitivity === 'sensitive').map((d) => d.field_key))

    const problems: RowProblem[] = []
    const prepared: Array<{ student: Record<string, unknown>; custom: Array<Record<string, unknown>> }> = []
    const seenCodes = new Set<string>()

    rows.forEach((raw, index) => {
      const rowNumber = index + 2 // +1 for zero-index, +1 for the header line.
      const student: Record<string, unknown> = { school_id: school.uuid }
      const custom: Array<Record<string, unknown>> = []

      const get = (k: string): string => (raw[k] ?? '').trim()

      // --- required standard fields -------------------------------------
      const first = get('first_name')
      const last = get('last_name')
      if (!first) problems.push({ row: rowNumber, field: 'first_name', message: 'Missing.' })
      if (!last) problems.push({ row: rowNumber, field: 'last_name', message: 'Missing.' })
      student['first_name'] = first
      student['last_name'] = last

      const grade = get('grade_id')
      if (!grade) {
        problems.push({ row: rowNumber, field: 'grade_id', message: 'Missing.' })
      } else if (validLevels.size > 0 && !validLevels.has(grade)) {
        // Checked against the school's own configured levels, not a hardcoded
        // list — a school running the 2023 reform has different level ids from
        // one on traditional ECZ.
        problems.push({
          row: rowNumber,
          field: 'grade_id',
          message: `"${grade}" is not a grade level at this school.`,
        })
      }
      student['grade_id'] = grade

      // Required, not optional: `students.class_id` is NOT NULL. Treating it as
      // optional meant an import missing the column failed at the database with
      // a raw 23502 naming a constraint, on a row the operator could not
      // identify — instead of a per-row message they can act on. Found by the
      // import suite.
      const cls = get('class_id')
      if (!cls) {
        problems.push({
          row: rowNumber,
          field: 'class_id',
          message: 'Missing. Every pupil must be in a class.',
        })
      }
      student['class_id'] = cls

      // --- optional standard fields --------------------------------------
      const dob = get('date_of_birth')
      if (dob) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
          problems.push({
            row: rowNumber,
            field: 'date_of_birth',
            message: `"${dob}" is not a date. Use YYYY-MM-DD.`,
          })
        } else {
          student['date_of_birth'] = dob
        }
      }

      const gender = get('gender').toLowerCase()
      if (gender) {
        if (!['male', 'female'].includes(gender)) {
          problems.push({
            row: rowNumber,
            field: 'gender',
            message: `"${gender}" is not recognised. Use male or female.`,
          })
        } else {
          student['gender'] = gender
        }
      }

      const nrc = get('nrc_or_birth_cert')
      if (nrc) {
        // Duplicate detection within the file itself. A repeated identifier in
        // one spreadsheet is nearly always a copy-paste error, and finding it
        // after the import means two records for one child.
        if (seenCodes.has(nrc)) {
          problems.push({
            row: rowNumber,
            field: 'nrc_or_birth_cert',
            message: `"${nrc}" appears more than once in this file.`,
          })
        }
        seenCodes.add(nrc)
        student['nrc_or_birth_cert'] = nrc
      }

      const enrolled = get('enrolment_date')
      if (enrolled) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(enrolled)) {
          problems.push({
            row: rowNumber,
            field: 'enrolment_date',
            message: `"${enrolled}" is not a date. Use YYYY-MM-DD.`,
          })
        } else {
          student['enrolment_date'] = enrolled
        }
      }

      const boarding = get('is_boarding').toLowerCase()
      if (boarding) {
        if (['true', 'yes', 'y', '1', 'boarding', 'boarder'].includes(boarding)) {
          student['is_boarding'] = true
        } else if (['false', 'no', 'n', '0', 'day'].includes(boarding)) {
          student['is_boarding'] = false
        } else {
          problems.push({
            row: rowNumber,
            field: 'is_boarding',
            message: `"${boarding}" is not yes or no.`,
          })
        }
      }

      // --- custom fields --------------------------------------------------
      for (const [key, cell] of Object.entries(raw)) {
        if ((STANDARD_KEYS as readonly string[]).includes(key)) continue

        const def = defByKey.get(key)
        if (!def) {
          // An unknown column is reported once per row rather than ignored. A
          // silently dropped column is how a school discovers in March that
          // nothing it typed under "Religion" was ever saved.
          problems.push({
            row: rowNumber,
            field: key,
            message: 'Not a field at this school. Add it in settings first, or remove the column.',
          })
          continue
        }

        if (sensitiveKeys.has(key)) {
          problems.push({
            row: rowNumber,
            field: key,
            message: `"${def.label}" is a sensitive field and cannot be imported from a spreadsheet. Enter it on the pupil's record.`,
          })
          continue
        }

        const coerced = coerceCustomValue(def, cell)
        if (!coerced.ok) {
          problems.push({ row: rowNumber, field: key, message: coerced.message })
          continue
        }
        if (coerced.empty) {
          if (def.is_required) {
            problems.push({ row: rowNumber, field: key, message: `${def.label} is required.` })
          }
          continue
        }

        custom.push({ field_id: def.id, ...coerced.columns })
      }

      // A required custom field absent from the file entirely, not merely blank.
      for (const def of defs) {
        if (def.sensitivity === 'sensitive') continue
        if (!def.is_required) continue
        if (!(def.field_key in raw)) {
          problems.push({
            row: rowNumber,
            field: def.field_key,
            message: `${def.label} is required and this file has no column for it.`,
          })
        }
      }

      prepared.push({ student, custom })
    })

    // --- the ceiling, before any write ------------------------------------
    const capacity = (capacityRes.data as Array<{ student_limit: number | null; current_roll: number }> | null)?.[0]
    if (capacity && capacity.student_limit !== null) {
      const after = capacity.current_roll + prepared.length
      if (after > capacity.student_limit) {
        return fail(
          'CONFLICT',
          `This import would put the roll at ${after}, above the plan's limit of ${capacity.student_limit}. ` +
            `There are ${capacity.current_roll} pupils now, so at most ${Math.max(0, capacity.student_limit - capacity.current_roll)} more can be added.`,
        )
      }
    }

    if (mode === 'validate' || problems.length > 0) {
      return ok({
        mode,
        rows: rows.length,
        // Capped in the response: a 500-row file with a wrong header produces
        // 500 identical problems, and a wall of them buries the one that matters.
        problems: problems.slice(0, 100),
        problemCount: problems.length,
        // `false` on a dry run with no problems still means "nothing was
        // written" — the caller must ask again with commit.
        committed: false,
        willCreate: problems.length === 0 ? prepared.length : 0,
      })
    }

    // --- commit -----------------------------------------------------------
    const { data, error } = await client.rpc('import_students', {
      p_rows: prepared.map((p) => ({ student: p.student, custom: p.custom })),
    })

    if (error) {
      if (error.code === 'ZS001') return fail('CONFLICT', error.message)
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      return fromPostgrestError(error)
    }

    const result = (data as Array<{ created_count: number }> | null)?.[0]

    return ok({
      mode,
      rows: rows.length,
      problems: [],
      problemCount: 0,
      committed: true,
      created: result?.created_count ?? 0,
    })
  })
}
