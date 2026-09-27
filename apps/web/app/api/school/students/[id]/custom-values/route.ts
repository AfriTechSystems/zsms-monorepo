/**
 * GET /api/school/students/[id]/custom-values — one pupil's extra fields.
 * PUT /api/school/students/[id]/custom-values — save them.
 *
 * Spec: migrations `0110` / `0111`
 *
 * ## Every active field comes back, whether it has a value or not
 *
 * The form needs a row per field to render, so an unanswered field arrives with
 * a null value rather than being absent. Absent and empty would be
 * indistinguishable to the client, and it would render a shorter form for a
 * pupil whose record is simply incomplete.
 *
 * ## A field the caller cannot read comes back as `readable: false`
 *
 * RLS hides sensitive values from a teacher, so the value is genuinely not
 * there. Reported explicitly rather than as an empty string, because "you are
 * not allowed to see this" and "nobody has filled this in" must not look
 * identical — a teacher who reads a blank medical field as "no conditions"
 * has been actively misled.
 *
 * ## PUT saves only what it was given
 *
 * A sensitive field omitted by a form that could not display it is left
 * untouched, never cleared. Sending the whole form back would let a teacher's
 * save silently erase a medical note they never saw.
 */

import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { createUserClient } from '../../../../../../lib/supabase'
import { resolveFeeCaller as resolveSchoolCaller } from '../../../../../../lib/fee-context'
import { resolveSchoolContext } from '../../../../../../lib/school-context'
import { can } from '../../../../../../lib/roles'
import {
  fail,
  fromPostgrestError,
  guard,
  ok,
  validationFailed,
} from '../../../../../../lib/api-response'
import { coerceCustomValue, type CustomFieldDef } from '../../../../../../lib/custom-fields'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const putSchema = z.object({
  // `fieldKey -> raw value`. Raw, because coercion lives in one place and the
  // client should not be the thing deciding what column a date belongs in.
  values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())])),
})

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, context: Ctx): Promise<Response> {
  return guard(async () => {
    const caller = await resolveSchoolCaller()
    if (!caller.ok) return caller.response
    if (!can(caller.role, 'students:read')) {
      return fail('FORBIDDEN', 'Your role does not include pupil records.')
    }

    const { id } = await context.params
    if (!UUID_RE.test(id)) return fail('VALIDATION_ERROR', 'Pupil id must be a UUID.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const [fields, values, pupil] = await Promise.all([
      client
        .from('school_custom_fields')
        .select('id, field_key, label, help_text, field_type, options, is_required, sensitivity')
        .eq('entity_type', 'student')
        .eq('is_active', true)
        .order('display_order', { ascending: true }),
      client
        .from('student_custom_values')
        .select('field_id, value_text, value_number, value_date, value_boolean, value_json')
        .eq('student_id', id),
      client.from('students').select('id').eq('id', id).maybeSingle(),
    ])

    if (!pupil.data) return fail('NOT_FOUND', 'Pupil not found.')
    if (fields.error) return fromPostgrestError(fields.error)

    const byField = new Map(
      (values.data ?? []).map((v) => [v.field_id as string, v] as const),
    )

    const canReadSensitive = caller.role === 'org:owner' || caller.role === 'org:principal'

    return ok({
      fields: (fields.data ?? []).map((f) => {
        const row = byField.get(f.id as string)
        const readable = f.sensitivity === 'standard' || canReadSensitive
        return {
          ...f,
          // Never an empty string standing in for a hidden value. See header.
          value: readable ? (row ?? null) : null,
          readable,
        }
      }),
      canWriteStandard: can(caller.role, 'students:write'),
      canWriteSensitive: canReadSensitive,
    })
  })
}

export async function PUT(request: NextRequest, context: Ctx): Promise<Response> {
  return guard(async () => {
    const caller = await resolveSchoolCaller()
    if (!caller.ok) return caller.response
    if (!can(caller.role, 'students:write')) {
      return fail('FORBIDDEN', 'Only the owner, principal and administrator edit pupil records.')
    }

    const { id } = await context.params
    if (!UUID_RE.test(id)) return fail('VALIDATION_ERROR', 'Pupil id must be a UUID.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return fail('VALIDATION_ERROR', 'Request body must be valid JSON.')
    }

    const parsed = putSchema.safeParse(body)
    if (!parsed.success) return validationFailed(parsed.error)

    const school = await resolveSchoolContext(client)
    if (!school) return fail('FORBIDDEN', 'This session is not associated with a school.')

    const defs = await client
      .from('school_custom_fields')
      .select('id, field_key, label, field_type, options, is_required, sensitivity')
      .eq('entity_type', 'student')
      .eq('is_active', true)
    if (defs.error) return fromPostgrestError(defs.error)

    const byKey = new Map(
      ((defs.data ?? []) as unknown as CustomFieldDef[]).map((f) => [f.field_key, f]),
    )

    const upserts: Array<Record<string, unknown>> = []
    const clears: string[] = []
    const problems: string[] = []

    for (const [key, raw] of Object.entries(parsed.data.values)) {
      const field = byKey.get(key)
      if (!field) {
        problems.push(`"${key}" is not a field at this school.`)
        continue
      }

      const coerced = coerceCustomValue(field, raw)
      if (!coerced.ok) {
        problems.push(`${field.label}: ${coerced.message}`)
        continue
      }

      if (coerced.empty) {
        if (field.is_required) {
          problems.push(`${field.label} is required.`)
          continue
        }
        // An emptied answer is a deletion, not a row of nulls — a row whose
        // every column is null asserts "asked and answered with nothing", which
        // is not what clearing a box means.
        clears.push(field.id)
        continue
      }

      upserts.push({
        school_id: school.uuid,
        student_id: id,
        field_id: field.id,
        ...coerced.columns,
      })
    }

    if (problems.length > 0) {
      return fail('VALIDATION_ERROR', problems.join(' '))
    }

    if (clears.length > 0) {
      /**
       * Through a named function, not `.delete()`.
       *
       * `authenticated` holds no DELETE on this table: a repository-wide invariant —
       * asserted by `tenant_isolation_test.sql` — is that no end-user role has DELETE
       * anywhere in `public`. Migration 0110 granted it anyway and CI caught that;
       * 0129 revoked it and added `clear_student_custom_values()`, which enforces the
       * same role and sensitivity rules the write policy does.
       *
       * A sensitive field the caller may not write is simply not cleared, and the
       * function reports how many rows it removed rather than failing — the value
       * they could not see is still there, which is the correct outcome.
       */
      const del = await client.rpc('clear_student_custom_values', {
        p_student_id: id,
        p_field_ids: clears,
      })
      if (del.error) {
        if (del.error.code === '42501') return fail('FORBIDDEN', del.error.message)
        return fromPostgrestError(del.error)
      }
    }

    if (upserts.length > 0) {
      const { error } = await client
        .from('student_custom_values')
        .upsert(upserts, { onConflict: 'student_id,field_id' })
      if (error) {
        if (error.code === '42501') {
          return fail(
            'FORBIDDEN',
            'One of those fields is marked sensitive, and only the owner and principal can change it.',
          )
        }
        if (error.code === '23514') return fail('VALIDATION_ERROR', error.message)
        return fromPostgrestError(error)
      }
    }

    return ok({ saved: upserts.length, cleared: clears.length })
  })
}
