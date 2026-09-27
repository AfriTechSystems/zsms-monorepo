/**
 * GET /api/school/recipients — everyone at this school who can be addressed.
 *
 * Spec: `Official Documentation/12 Communication System/ANNOUNCEMENTS.md`
 *
 * ## One directory, three tables
 *
 * Addressable people live in `staff_members`, `parents` (through a child) and
 * `students`, each with its own `clerk_user_id`. A compose screen that wanted to
 * send to one person would otherwise have to query three endpoints and merge
 * them, and would merge them differently from the worker.
 *
 * ## This is a list of everyone's name at the school, so it is management-only
 *
 * Worth saying plainly: the response is a staff and family directory. It is gated
 * on `announcements:write` — the same capability that can already message all of
 * them at once — rather than on `students:read`, which a teacher holds. A teacher
 * who can see their own pupils has no reason to enumerate every parent.
 *
 * ## A parent is addressable once, and labelled by their children
 *
 * A parent of three children is one recipient. The label carries the children's
 * names because "Mary Mwale" is not identifying at a school with four of them,
 * and the person composing needs to know which family they are writing to.
 */

import type { NextRequest } from 'next/server'

import { createUserClient } from '../../../../lib/supabase'
import { resolveFeeCaller as resolveSchoolCaller } from '../../../../lib/fee-context'
import { can } from '../../../../lib/roles'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

interface Recipient {
  userId: string
  name: string
  kind: 'staff' | 'parent' | 'student'
  detail: string
}

export async function GET(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const caller = await resolveSchoolCaller()
    if (!caller.ok) return caller.response

    if (!can(caller.role, 'announcements:write')) {
      return fail('FORBIDDEN', 'Only the owner, principal and administrator address individuals.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const q = (request.nextUrl.searchParams.get('q') ?? '').trim().toLowerCase()

    const [staff, pupils, links] = await Promise.all([
      client
        .from('staff_members')
        .select('clerk_user_id, first_name, last_name, email')
        .eq('is_active', true),
      client
        .from('students')
        .select('id, clerk_user_id, first_name, last_name, student_id, grade_id, class_id')
        .eq('is_deleted', false)
        .in('status', ['active', 'on_leave']),
      // Parents come through their children, which is also what makes them
      // addressable at this school at all.
      client
        .from('student_parent_links')
        .select('student_id, parent_id, is_active, parents(clerk_user_id, full_name, phone_e164)')
        .eq('is_active', true),
    ])

    if (staff.error) return fromPostgrestError(staff.error)

    const pupilById = new Map(
      ((pupils.data ?? []) as Array<{ id: string; first_name: string; last_name: string }>).map(
        (p) => [p.id, p],
      ),
    )

    const recipients: Recipient[] = []

    for (const s of (staff.data ?? []) as Array<Record<string, string | null>>) {
      if (!s['clerk_user_id']) continue
      recipients.push({
        userId: s['clerk_user_id'],
        name: `${s['first_name'] ?? ''} ${s['last_name'] ?? ''}`.trim(),
        kind: 'staff',
        detail: s['email'] ?? 'Staff',
      })
    }

    for (const p of (pupils.data ?? []) as Array<Record<string, string | null>>) {
      // A pupil with no account cannot be addressed — including them would offer a
      // recipient the worker will silently drop.
      if (!p['clerk_user_id']) continue
      recipients.push({
        userId: p['clerk_user_id'],
        name: `${p['first_name'] ?? ''} ${p['last_name'] ?? ''}`.trim(),
        kind: 'student',
        detail: `${p['student_id'] ?? ''} · ${p['class_id'] ?? ''}`,
      })
    }

    // One entry per parent, with every child they have at this school.
    const parentChildren = new Map<string, { name: string; children: string[] }>()
    // PostgREST types an embedded relation as an array even where the foreign key
    // makes it at most one row, so it is read as one and narrowed here rather
     // than cast past.
    type LinkRow = {
      student_id: string
      parents: Array<{ clerk_user_id: string | null; full_name: string | null }> | null
    }

    for (const l of (links.data ?? []) as unknown as LinkRow[]) {
      const parent = l.parents?.[0] ?? null
      if (!parent?.clerk_user_id) continue
      const child = pupilById.get(l.student_id)
      if (!child) continue // a link to a pupil outside the readable set
      const entry = parentChildren.get(parent.clerk_user_id) ?? {
        name: parent.full_name ?? 'Parent or guardian',
        children: [],
      }
      entry.children.push(`${child.first_name} ${child.last_name}`)
      parentChildren.set(parent.clerk_user_id, entry)
    }

    for (const [userId, entry] of parentChildren) {
      recipients.push({
        userId,
        name: entry.name,
        kind: 'parent',
        // Which family, not just which name. See the header.
        detail: `Parent of ${entry.children.sort().join(', ')}`,
      })
    }

    const filtered = q
      ? recipients.filter(
          (r) => r.name.toLowerCase().includes(q) || r.detail.toLowerCase().includes(q),
        )
      : recipients

    return ok({
      // Capped: a 2,000-pupil school produces thousands of rows, and a picker is
      // for finding a person by name, not for scrolling a roll. The search
      // parameter is the intended way through a large school.
      recipients: filtered
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 200),
      total: filtered.length,
      truncated: filtered.length > 200,
    })
  })
}
