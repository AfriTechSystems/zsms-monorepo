/**
 * GET/PATCH /api/school/custom-roles — school-defined staff roles (ADR-012).
 *
 * Spec: `01 Foundation Layer/DECISIONS.md` → ADR-012,
 *       `02 Authentication and Identity/PERMISSIONS.md`
 *
 * ## Why there is no role check in this file
 *
 * `leadership_write_custom_roles` admits `org:owner` and `org:principal` and nobody
 * else — not even `org:admin`, because writing here is the ability to GRANT
 * capabilities, so anyone who can write can write themselves a role that does anything.
 *
 * A second copy of that rule in this route would drift, and it is the copy a direct
 * PostgREST call skips. The database refuses and this maps the error.
 *
 * ## The tier limit is the database's answer, not this route's
 *
 * ADR-012 caps Starter at 3 and Growth at 10. An AFTER trigger raises `ZS002` when a
 * school exceeds its plan, and `fromPostgrestError` renders that as CONFLICT carrying
 * the limit — so the message a user reads names their actual plan rather than a number
 * hardcoded here.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

/**
 * The capabilities a custom role may grant.
 *
 * Mirrors `Capability` in `lib/roles.ts`. Kept as a literal union so a typo is a
 * validation error rather than a grant that silently does nothing — a permission bug
 * that fails open is bad, and one that fails closed and silent is nearly as hard to find.
 *
 * `staff:write` and `settings:write` are deliberately absent: granting the ability to
 * manage staff or settings through a custom role would let a school route around the
 * owner/principal restriction this whole table is gated by.
 */
const RESOURCES = [
  'students',
  'fees',
  'attendance',
  'results',
  'staff',
  'announcements',
  'assignments',
] as const

const ACTIONS = ['read', 'write'] as const

export async function GET(): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    /*
      The school comes from the SESSION, never from the caller.

      `school_custom_role_limit()` takes a school id, and passing null would make it
      fall through to its most-restrictive default — so the screen would show "of 3"
      to an Enterprise school. Resolve first, then ask.
    */
    const school = await client.rpc('current_school_uuid')
    const schoolId = (school.data as string | null) ?? null

    const [roles, assignments, limit] = await Promise.all([
      client
        .from('school_custom_roles')
        .select('id, role_name, description, permissions, is_active, created_by, created_at')
        .order('role_name'),
      client
        .from('staff_custom_role_assignments')
        .select('id, custom_role_id, staff_user_id, assigned_at'),
      /*
        The ceiling, resolved by the same function the trigger enforces. Read here so
        the screen can say "2 of 3" before somebody hits the refusal, rather than only
        after.
      */
      schoolId
        ? client.rpc('school_custom_role_limit', { p_school_id: schoolId })
        : Promise.resolve({ data: null, error: null }),
    ])

    if (roles.error) return fromPostgrestError(roles.error)

    const rows = roles.data ?? []
    const byRole = new Map<string, string[]>()
    for (const a of assignments.data ?? []) {
      const list = byRole.get(a.custom_role_id) ?? []
      list.push(a.staff_user_id)
      byRole.set(a.custom_role_id, list)
    }

    return ok({
      roles: rows.map((r) => ({
        id: r.id,
        name: r.role_name,
        description: r.description,
        permissions: r.permissions,
        isActive: r.is_active,
        createdBy: r.created_by,
        createdAt: r.created_at,
        holders: byRole.get(r.id) ?? [],
      })),
      resources: RESOURCES,
      actions: ACTIONS,
      meta: {
        used: rows.filter((r) => r.is_active).length,
        // NULL means unlimited, matching `school_student_limit()`'s convention.
        limit: limit.error ? null : (limit.data as number | null),
      },
    })
  })
}

const patchSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('save'),
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(300).nullable().optional(),
    /*
      `{ students: { read: true } }`, validated shape-first.

      A free-form object would accept `{ everything: true }`, which the database would
      store happily and `can()` would never read — a grant that looks made and is not.
    */
    permissions: z.record(
      z.enum(RESOURCES),
      z.record(z.enum(ACTIONS), z.boolean()),
    ),
  }),
  z.object({
    action: z.literal('setActive'),
    id: z.string().uuid(),
    isActive: z.boolean(),
  }),
  z.object({
    action: z.literal('assign'),
    id: z.string().uuid(),
    staffUserId: z.string().trim().min(1).max(80),
  }),
  z.object({
    action: z.literal('unassign'),
    id: z.string().uuid(),
    staffUserId: z.string().trim().min(1).max(80),
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

    const v = parsed.data

    if (v.action === 'setActive') {
      const { error } = await client
        .from('school_custom_roles')
        .update({ is_active: v.isActive, updated_at: new Date().toISOString() })
        .eq('id', v.id)

      if (error) return mapError(error)
      return ok({
        message: v.isActive
          ? 'Role active again. Its holders have their permissions back.'
          : 'Role switched off. Its holders keep the account and lose these permissions.',
      })
    }

    if (v.action === 'assign' || v.action === 'unassign') {
      const school = await client.rpc('current_school_uuid')
      const schoolId = (school.data as string | null) ?? null
      if (!schoolId) return fail('FORBIDDEN', 'No school is available to this session.')

      if (v.action === 'unassign') {
        const { error } = await client
          .from('staff_custom_role_assignments')
          .delete()
          .eq('custom_role_id', v.id)
          .eq('staff_user_id', v.staffUserId)

        if (error) return mapError(error)
        return ok({ message: 'Removed from that role.' })
      }

      const who = await client.rpc('get_user_id')
      const { error } = await client.from('staff_custom_role_assignments').insert({
        school_id: schoolId,
        custom_role_id: v.id,
        staff_user_id: v.staffUserId,
        assigned_by: (who.data as string | null) ?? 'unknown',
      })

      if (error) return mapError(error)
      return ok({ message: 'Added to that role.' })
    }

    const who = await client.rpc('get_user_id')
    const userId = (who.data as string | null) ?? null
    if (!userId) return fail('UNAUTHORIZED', 'Could not identify you.')

    const row = {
      role_name: v.name,
      description: v.description ?? null,
      permissions: v.permissions,
      updated_at: new Date().toISOString(),
    }

    if (v.id) {
      const { error } = await client.from('school_custom_roles').update(row).eq('id', v.id)
      if (error) return mapError(error)
      return ok({ message: 'Role updated. Its holders see the change immediately.' })
    }

    /*
      `school_id` is NOT taken from the body — it comes from the session, and the
      policy's WITH CHECK enforces that independently. A caller supplying one could
      otherwise define a role inside another school.
    */
    const school = await client.rpc('current_school_uuid')
    const schoolId = (school.data as string | null) ?? null
    if (!schoolId) return fail('FORBIDDEN', 'No school is available to this session.')

    const { data, error } = await client
      .from('school_custom_roles')
      .insert({ ...row, school_id: schoolId, created_by: userId })
      .select('id')
      .maybeSingle()

    if (error) return mapError(error)
    if (!data) {
      return fail(
        'FORBIDDEN',
        'Only the owner or the principal can define a staff role.',
      )
    }

    return ok({ id: data.id, message: 'Role created.' })
  })
}

/** Turns the database's refusals into something a head teacher can act on. */
function mapError(error: { code?: string; message: string }): Response {
  // `ZS002` is the tier ceiling, raised by the AFTER trigger with the real limit.
  if (error.code === 'ZS002') return fail('CONFLICT', error.message)
  if (error.code === '23505') {
    return fail('CONFLICT', 'A role with that name already exists at this school.')
  }
  if (error.code === '23514') {
    return fail('VALIDATION_ERROR', 'Those permissions are not in a shape ZSMS can read.')
  }
  if (error.code === '42501') {
    return fail('FORBIDDEN', 'Only the owner or the principal can change staff roles.')
  }
  return fromPostgrestError(error)
}
