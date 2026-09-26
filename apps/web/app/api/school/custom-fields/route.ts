/**
 * GET   /api/school/custom-fields — the school's extra pupil fields.
 * POST  /api/school/custom-fields — define one.
 * PATCH /api/school/custom-fields — edit a label, options, order, or retire it.
 *
 * Spec: `Official Documentation/07 Student and Parent Modules/STUDENTS.md`
 *       migrations `0110` / `0111`
 *
 * ## Definitions are readable by all staff; values are not
 *
 * A form has to render a field's label even when the reader cannot see any
 * values in it — otherwise the form silently loses a section and looks broken.
 * So definitions are staff-readable and the sensitivity split lives on the
 * values (RLS, `0111`), which is where it belongs.
 *
 * ## A key is chosen once
 *
 * `field_key` is what the CSV importer matches on and what an integration would
 * reference, so the database refuses to change it. The label is the editable
 * name. PATCH therefore never accepts a key — not as a validation nicety, but
 * because accepting one and having the database reject it would produce a
 * confusing error for a request that should not have been made.
 *
 * ## Retiring, never deleting
 *
 * A definition is retired with `is_active = false`. Deleting it would cascade
 * every recorded value away, and "we no longer collect this" is not the same
 * claim as "this was never true of these children".
 */

import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { can } from '../../../../lib/roles'
import { resolveFeeCaller as resolveSchoolCaller } from '../../../../lib/fee-context'
import { resolveSchoolContext } from '../../../../lib/school-context'
import {
  created,
  fail,
  fromPostgrestError,
  guard,
  ok,
  validationFailed,
} from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const FIELD_TYPES = ['text', 'number', 'date', 'boolean', 'select', 'multi_select'] as const

const createSchema = z
  .object({
    fieldKey: z
      .string()
      .trim()
      .regex(
        /^[a-z][a-z0-9_]{1,38}$/,
        'Use lower-case letters, numbers and underscores, starting with a letter',
      ),
    label: z.string().trim().min(1).max(80),
    helpText: z.string().trim().max(300).optional(),
    fieldType: z.enum(FIELD_TYPES),
    options: z.array(z.string().trim().min(1).max(80)).max(100).optional(),
    isRequired: z.boolean().optional(),
    sensitivity: z.enum(['standard', 'sensitive']),
    displayOrder: z.number().int().min(0).max(999).optional(),
  })
  // Mirrors the table's CHECK. Caught here so the message names the field rather
  // than quoting a constraint.
  .refine((v) => !['select', 'multi_select'].includes(v.fieldType) || (v.options?.length ?? 0) > 0, {
    message: 'A choice field needs at least one option, or nobody can fill it in.',
    path: ['options'],
  })

const patchSchema = z.object({
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(80).optional(),
  helpText: z.string().trim().max(300).nullable().optional(),
  options: z.array(z.string().trim().min(1).max(80)).max(100).optional(),
  isRequired: z.boolean().optional(),
  displayOrder: z.number().int().min(0).max(999).optional(),
  isActive: z.boolean().optional(),
  // No fieldKey and no fieldType: both are immutable once values exist, and the
  // key is immutable always. See the header.
})

export async function GET(): Promise<Response> {
  return guard(async () => {
    const caller = await resolveSchoolCaller()
    if (!caller.ok) return caller.response

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client
      .from('school_custom_fields')
      .select(
        'id, field_key, label, help_text, field_type, options, is_required, ' +
          'sensitivity, display_order, is_active',
      )
      .eq('entity_type', 'student')
      .order('display_order', { ascending: true })
      .order('label', { ascending: true })

    if (error) return fromPostgrestError(error)

    return ok({
      fields: data ?? [],
      // Defining a field changes what the school records about children,
      // including whether something counts as sensitive — a settings act.
      canManage: can(caller.role, 'settings:write'),
      // Whether this caller could see a sensitive VALUE if one existed. The form
      // uses it to explain a blank rather than render an empty box that looks
      // like missing data.
      canReadSensitive: caller.role === 'org:owner' || caller.role === 'org:principal',
    })
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const caller = await resolveSchoolCaller()
    if (!caller.ok) return caller.response

    if (!can(caller.role, 'settings:write')) {
      return fail('FORBIDDEN', 'Only the owner, principal and administrator define pupil fields.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return fail('VALIDATION_ERROR', 'Request body must be valid JSON.')
    }

    const parsed = createSchema.safeParse(body)
    if (!parsed.success) return validationFailed(parsed.error)
    const v = parsed.data

    // `school_id` comes from the session, never the request. `resolveSchoolContext`
    // reads it through RLS on `schools`, which is the same source the policies
    // use — rather than an RPC that would need its own PostgREST exposure.
    const school = await resolveSchoolContext(client)
    if (!school) return fail('FORBIDDEN', 'This session is not associated with a school.')

    const { data, error } = await client
      .from('school_custom_fields')
      .insert({
        school_id: school.uuid,
        entity_type: 'student',
        field_key: v.fieldKey,
        label: v.label,
        help_text: v.helpText ?? null,
        field_type: v.fieldType,
        options: v.options ?? [],
        is_required: v.isRequired ?? false,
        sensitivity: v.sensitivity,
        display_order: v.displayOrder ?? 0,
      })
      .select('id, field_key, label, field_type, sensitivity')
      .maybeSingle()

    if (error) {
      // 23505 — the key already exists for this school.
      if (error.code === '23505') {
        return fail('CONFLICT', `A field called "${v.fieldKey}" already exists.`)
      }
      // 23514 — the reserved-key trigger, or the select-needs-options CHECK.
      // The database's sentence names the reserved column, which is more useful
      // than anything this route could reconstruct.
      if (error.code === '23514') return fail('VALIDATION_ERROR', error.message)
      return fromPostgrestError(error)
    }

    if (!data) return fail('FORBIDDEN', 'Not permitted to define fields for this school.')
    return created(data)
  })
}

export async function PATCH(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const caller = await resolveSchoolCaller()
    if (!caller.ok) return caller.response

    if (!can(caller.role, 'settings:write')) {
      return fail('FORBIDDEN', 'Only the owner, principal and administrator change pupil fields.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return fail('VALIDATION_ERROR', 'Request body must be valid JSON.')
    }

    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) return validationFailed(parsed.error)
    const { id, ...rest } = parsed.data

    // Only what was sent. Sending every column would let a stale form revert a
    // value somebody else changed — the concurrency problem already tracked
    // against the tier form.
    const patch: Record<string, unknown> = {}
    if (rest.label !== undefined) patch['label'] = rest.label
    if (rest.helpText !== undefined) patch['help_text'] = rest.helpText
    if (rest.options !== undefined) patch['options'] = rest.options
    if (rest.isRequired !== undefined) patch['is_required'] = rest.isRequired
    if (rest.displayOrder !== undefined) patch['display_order'] = rest.displayOrder
    if (rest.isActive !== undefined) patch['is_active'] = rest.isActive

    if (Object.keys(patch).length === 0) {
      return fail('VALIDATION_ERROR', 'Nothing to change.')
    }

    const { data, error } = await client
      .from('school_custom_fields')
      .update(patch)
      .eq('id', id)
      .select('id, field_key, label, is_active')
      .maybeSingle()

    if (error) {
      if (error.code === '23001' || error.code === '23514') {
        return fail('VALIDATION_ERROR', error.message)
      }
      return fromPostgrestError(error)
    }

    if (!data) return fail('NOT_FOUND', 'That field does not exist at this school.')
    return ok(data)
  })
}
