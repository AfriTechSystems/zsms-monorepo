/**
 * GET  /api/admin/networks — every network, with its schools and members.
 * POST /api/admin/networks — create one, attach a school, grant access, or add a
 *                            member. One route, an `action` discriminator.
 *
 * Spec: migrations `0119`–`0123`
 *       `Official Documentation/15 Super Admin and Platform/SUPERADMIN.md`
 *
 * ## One POST with an action, rather than six routes
 *
 * These operations share a caller check, a Supabase client and an audit shape, and
 * they are used by one screen. Six route files would repeat all of that and let the
 * checks drift apart — which is the failure the fee routes avoided by sharing
 * `resolveFeeCaller`. The discriminated union keeps each action's payload validated
 * separately, so this is not a loosely-typed grab bag.
 *
 * ## Granting access is deliberate, and it is two systems
 *
 * `attach_school` puts a school in a network for REPORTING. `grant_access` invites a
 * network member into that school's Clerk organisation so they can open it. They are
 * separate actions because they are separate decisions: aggregating a school's
 * numbers and being able to read a named child's medical notes are not the same
 * thing, and collapsing them would mean attaching a school silently handed somebody
 * entry to it.
 *
 * The Clerk invitation happens first, then the database records it. That order is
 * deliberate: an invitation that succeeded and went unrecorded is corrected by
 * granting again, while a record written before a failed invitation would claim an
 * access nobody has.
 */

import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { inviteToOrganisation } from '@zsms/auth-provider/organisations'

import { createUserClient } from '../../../../lib/supabase'
import { resolveAdminContext } from '../../../../lib/admin-context'
import {
  created,
  fail,
  fromPostgrestError,
  guard,
  ok,
  validationFailed,
} from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create_network'),
    name: z.string().trim().min(2).max(120),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-]{1,48}$/, 'Lower-case letters, numbers and hyphens'),
    dataScope: z.enum(['aggregates_only', 'financial_detail', 'full']).optional(),
    billingMode: z.enum(['per_school', 'consolidated']).optional(),
    notes: z.string().trim().max(1000).optional(),
  }),
  z.object({
    action: z.literal('attach_school'),
    networkId: z.string().uuid(),
    schoolId: z.string().uuid(),
  }),
  z.object({
    action: z.literal('detach_school'),
    schoolId: z.string().uuid(),
  }),
  z.object({
    action: z.literal('add_member'),
    networkId: z.string().uuid(),
    clerkUserId: z.string().trim().min(3).max(120),
    networkRole: z.string().trim().min(2).max(32),
    fullName: z.string().trim().max(120).optional(),
    email: z.string().trim().email().optional(),
  }),
  z.object({
    action: z.literal('set_member_active'),
    memberId: z.string().uuid(),
    isActive: z.boolean(),
  }),
  z.object({
    action: z.literal('grant_access'),
    schoolId: z.string().uuid(),
    /** The Clerk organisation of that school, so the invitation lands correctly. */
    organisationId: z.string().trim().min(3).max(120),
    email: z.string().trim().email(),
    /** Which school role the network member gets. Owner, by default and by intent. */
    schoolRole: z.enum(['org:owner', 'org:principal', 'org:admin']).optional(),
  }),
  z.object({
    action: z.literal('update_network'),
    networkId: z.string().uuid(),
    dataScope: z.enum(['aggregates_only', 'financial_detail', 'full']).optional(),
    billingMode: z.enum(['per_school', 'consolidated']).optional(),
    status: z.enum(['active', 'suspended']).optional(),
  }),
])

export async function GET(): Promise<Response> {
  return guard(async () => {
    // Same gate every other admin route uses, reading the same organisation slug
    // `is_afritech_admin()` reads in the database — so application and policy
    // cannot disagree about who an operator is.
    const admin = await resolveAdminContext()
    if (!admin) {
      return fail('FORBIDDEN', 'This area is restricted to AfriTech platform administrators.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const [networks, links, members, roles, schools, suggestions] = await Promise.all([
      client
        .from('school_networks')
        .select('id, name, slug, data_scope, billing_mode, status, notes, created_at')
        .order('name', { ascending: true }),
      client
        .from('school_network_schools')
        .select(
          'id, network_id, school_id, is_active, attached_at, ' +
            'owner_access_granted_at, owner_access_invited_email, ' +
            'schools(id, school_id, name, clerk_org_id, subscription_tier, status)',
        )
        .eq('is_active', true),
      client
        .from('school_network_members')
        .select('id, network_id, clerk_user_id, network_role, full_name, email, is_active')
        .order('created_at', { ascending: true }),
      client
        .from('school_network_roles')
        .select('role_key, label, description, can_manage_members, can_view_financial')
        .order('display_order', { ascending: true }),
      // Schools not yet in any network, so the attach control offers only what can
      // actually be attached rather than the whole estate.
      client
        .from('schools')
        .select('id, school_id, name, subscription_tier, status')
        .order('name', { ascending: true }),
      /*
        Networks that should probably exist (0175).

        `ONBOARDING.md` has AfriTech building the group; nothing told them a group
        was there to build. An owner registering a second school is the clearest
        signal in the system and it was going unread.

        A SUGGESTION, never an automatic merge: registering a second school is not
        the same as declaring a group, and silently joining two schools' dashboards
        is hard to undo and alarming to see.
      */
      client.rpc('admin_network_suggestions'),
    ])

    if (networks.error) return fromPostgrestError(networks.error)

    const linkRows = (links.data ?? []) as unknown as Array<Record<string, unknown>>
    const attachedIds = new Set(linkRows.map((l) => l['school_id'] as string))

    return ok({
      // Empty rather than fatal: a failed suggestion query must not stop an
      // administrator managing the networks that already exist.
      suggestions: suggestions.data ?? [],
      networks: networks.data ?? [],
      links: linkRows,
      members: members.data ?? [],
      roles: roles.data ?? [],
      unattachedSchools: ((schools.data ?? []) as Array<{ id: string }>).filter(
        (s) => !attachedIds.has(s.id),
      ),
    })
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  return guard(async () => {
    // Same gate every other admin route uses, reading the same organisation slug
    // `is_afritech_admin()` reads in the database — so application and policy
    // cannot disagree about who an operator is.
    const admin = await resolveAdminContext()
    if (!admin) {
      return fail('FORBIDDEN', 'This area is restricted to AfriTech platform administrators.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    let raw: unknown
    try {
      raw = await request.json()
    } catch {
      return fail('VALIDATION_ERROR', 'Request body must be valid JSON.')
    }

    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) return validationFailed(parsed.error)
    const body = parsed.data

    switch (body.action) {
      case 'create_network': {
        const { data, error } = await client
          .from('school_networks')
          .insert({
            name: body.name,
            slug: body.slug,
            // Aggregates-only unless explicitly widened. The safe value is the
            // default, per the agreed decision.
            data_scope: body.dataScope ?? 'aggregates_only',
            billing_mode: body.billingMode ?? 'per_school',
            notes: body.notes ?? null,
          })
          .select('id, name, slug, data_scope, billing_mode')
          .maybeSingle()

        if (error) {
          if (error.code === '23505') {
            return fail('CONFLICT', `A network with the handle "${body.slug}" already exists.`)
          }
          return fromPostgrestError(error)
        }
        return created(data)
      }

      case 'update_network': {
        const patch: Record<string, unknown> = {}
        if (body.dataScope) patch['data_scope'] = body.dataScope
        if (body.billingMode) patch['billing_mode'] = body.billingMode
        if (body.status) patch['status'] = body.status
        if (Object.keys(patch).length === 0) return fail('VALIDATION_ERROR', 'Nothing to change.')

        const { data, error } = await client
          .from('school_networks')
          .update(patch)
          .eq('id', body.networkId)
          .select('id, name, data_scope, billing_mode, status')
          .maybeSingle()
        if (error) return fromPostgrestError(error)
        if (!data) return fail('NOT_FOUND', 'Network not found.')
        return ok(data)
      }

      case 'attach_school': {
        const { data, error } = await client.rpc('attach_school_to_network', {
          p_network_id: body.networkId,
          p_school_id: body.schoolId,
        })
        if (error) {
          if (error.code === '42501') return fail('FORBIDDEN', error.message)
          if (error.code === 'P0002') return fail('NOT_FOUND', error.message)
          return fromPostgrestError(error)
        }
        return ok({ attached: data })
      }

      case 'detach_school': {
        const { error } = await client.rpc('detach_school_from_network', {
          p_school_id: body.schoolId,
        })
        if (error) {
          if (error.code === '42501') return fail('FORBIDDEN', error.message)
          return fromPostgrestError(error)
        }
        // Detaching removes the school from the network's reporting. It does NOT
        // revoke the Clerk membership, because that is a separate grant and
        // silently removing somebody's access to a school they may still run would
        // be worse than leaving it to be revoked deliberately.
        return ok({
          detached: true,
          note: 'Removed from the network. Any school access already granted stays until it is revoked in the school itself.',
        })
      }

      case 'add_member': {
        const { data, error } = await client
          .from('school_network_members')
          .insert({
            network_id: body.networkId,
            clerk_user_id: body.clerkUserId,
            network_role: body.networkRole,
            full_name: body.fullName ?? null,
            email: body.email ?? null,
            added_by: admin.userId,
          })
          .select('id, clerk_user_id, network_role, full_name')
          .maybeSingle()

        if (error) {
          if (error.code === '23505') {
            return fail('CONFLICT', 'That person is already a member of this network.')
          }
          if (error.code === '23503') {
            return fail('VALIDATION_ERROR', `"${body.networkRole}" is not a network role.`)
          }
          return fromPostgrestError(error)
        }
        return created(data)
      }

      case 'set_member_active': {
        const { data, error } = await client
          .from('school_network_members')
          .update({ is_active: body.isActive })
          .eq('id', body.memberId)
          .select('id, clerk_user_id, is_active')
          .maybeSingle()
        if (error) return fromPostgrestError(error)
        if (!data) return fail('NOT_FOUND', 'Member not found.')
        return ok(data)
      }

      case 'grant_access': {
        /**
         * Clerk first, then the record. See the header for why that order.
         *
         * `org:owner` by default: a network owner entering one of their own schools
         * is its owner. Narrower roles are offered because a network finance person
         * has no business holding owner rights in a school.
         */
        try {
          await inviteToOrganisation({
            organisationId: body.organisationId,
            email: body.email,
            role: body.schoolRole ?? 'org:owner',
            inviterUserId: admin.userId,
          })
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Unknown error'
          // A duplicate invitation is not a failure — the person already has one
          // pending, which is the desired state. Anything else is reported as-is,
          // because a Clerk error a human can read beats a generic one.
          if (!/already|duplicate/i.test(message)) {
            return fail('SERVER_ERROR', `Clerk refused the invitation: ${message}`)
          }
        }

        const { data, error } = await client.rpc('record_network_school_access', {
          p_school_id: body.schoolId,
          p_email: body.email,
        })
        if (error) {
          if (error.code === '42501') return fail('FORBIDDEN', error.message)
          if (error.code === 'P0002') return fail('NOT_FOUND', error.message)
          return fromPostgrestError(error)
        }

        return ok({
          granted: data,
          // Said plainly: the invitation has to be accepted. Until then the
          // switcher shows the school as unavailable, which is accurate.
          note: `Invitation sent to ${body.email}. They can open the school once they accept it.`,
        })
      }
    }
  })
}
