/**
 * Who is asking, when the caller is a parent.
 *
 * Spec: `Official Documentation/07 Student and Parent Modules/PARENTS.md`
 *       `Official Documentation/02 Authentication and Identity/ROLES.md`
 *
 * ## Why the staff resolver will not do
 *
 * `resolveFeeCaller` refuses anyone whose role is not a staff role and turns away
 * the AfriTech org. A parent IS in the school's Clerk organisation — `org:parent`
 * — so `current_school_uuid()` resolves for them and the school-scoped policies
 * work. What differs is the *capability* model: `lib/roles.ts` grants a parent
 * nothing, correctly, because every parent permission is row-level (this child,
 * my own record) rather than table-level.
 *
 * So a parent route checks the role and then leans entirely on RLS. There is no
 * capability to consult, and inventing one would be a second access model over
 * the same rows.
 *
 * ## A parent's children are the unit of everything
 *
 * Every parent screen is "for which child". Resolving that list once, here,
 * keeps each route from re-deriving it and from disagreeing about whether a
 * lapsed link still counts. `is_linked_parent_of()` admits a link inside its
 * grace period, and this deliberately matches — a parent whose link lapsed last
 * week should still see the term they paid for, which is the whole reason the
 * grace period exists.
 */

import type { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

import { getAuthProvider } from '@zsms/auth-provider'

import { fail } from './api-response'

export interface ParentCaller {
  userId: string
  /** The Clerk org the session is currently acting in, if any. */
  organisationId: string | null
}

export type ParentCallerResult =
  | { ok: true; caller: ParentCaller }
  | { ok: false; response: NextResponse }

/**
 * Resolves a parent caller.
 *
 * ## It does not look at the Clerk role, and that is the fix
 *
 * This refused anybody whose active role was not `org:parent`. Two things were wrong with
 * that, and the second is the reason the first happened:
 *
 *   * **a teacher can be a parent at the same school.** Reported from the running
 *     application: a staff member with two children enrolled signed in, reached the parent
 *     portal, and was told "staff accounts use the school portal instead" — about their own
 *     children. Being employed somewhere does not stop you being a parent there, and in a
 *     small Zambian private school it is common.
 *   * **parent access was never a Clerk role to begin with.** `is_linked_parent_of()` (0016)
 *     reads `parent_user_id = get_user_id()` and nothing else — no `current_school_uuid()`,
 *     no role claim. A parent needs no organisation at all, which is why `/welcome` links
 *     them by verified email rather than inviting them to one. The role gate was asserting
 *     a model the schema has never had.
 *
 * So there is no role check. Anybody signed in may reach these routes, and **the policies
 * decide what they see** — which for somebody with no linked children is nothing. That is
 * the honest answer rather than a refusal: the screens then say "we could not find your
 * children" and show the address to give the school, which is actionable, where "you do not
 * have access" is not.
 *
 * This is the same correction `/welcome` already received. Both had assumed a parent is a
 * kind of organisation member.
 */
export async function resolveParentCaller(): Promise<ParentCallerResult> {
  const session = await getAuthProvider().getSessionUser()

  if (!session) {
    return { ok: false, response: fail('UNAUTHORIZED', 'Authentication required.') }
  }

  return {
    ok: true,
    caller: { userId: session.userId, organisationId: session.organisationId ?? null },
  }
}

export interface ParentChild {
  id: string
  student_id: string
  first_name: string
  /** Set by the SCHOOL. A parent sees it and cannot change it (`0265`). */
  photo_url?: string | null
  last_name: string
  grade_id: string
  class_id: string
  status: string
  school_id: string
}

/**
 * The children this parent may see.
 *
 * No `parent_user_id` filter: `parent_read_own_children` on `students` already
 * resolves through `is_linked_parent_of()`, so the policy IS the filter. Adding
 * one here would put the rule in two places that can drift — and the version
 * here would be the one that forgets the grace period.
 */
export async function listParentChildren(client: SupabaseClient): Promise<ParentChild[]> {
  const { data, error } = await client
    .from('students')
    .select('id, student_id, first_name, last_name, grade_id, class_id, status, school_id, photo_url')
    .eq('is_deleted', false)
    .order('first_name', { ascending: true })

  if (error) throw new Error(`Could not read children: ${error.message}`)
  return (data ?? []) as unknown as ParentChild[]
}

/**
 * Narrows a requested child id to one this parent actually has.
 *
 * Returns null when the id is not theirs — and the caller turns that into a
 * NOT_FOUND rather than a FORBIDDEN, because answering "forbidden" would confirm
 * that the id belongs to a real child at some school. Same reasoning as the fee
 * routes.
 */
export function pickChild(children: ParentChild[], requested: string | null): ParentChild | null {
  if (children.length === 0) return null
  if (!requested) return children[0] ?? null
  return children.find((c) => c.id === requested) ?? null
}
