/**
 * Make sure a signed-in account has an ACTIVE organisation.
 *
 * Spec: `Official Documentation/02 Authentication and Identity/SESSIONS.md`
 *
 * ## The bug this exists for
 *
 * Reported: a teacher linked to a school signs in on the phone, reaches their portal,
 * and sees none of the school's features.
 *
 * Every school-scoped query resolves through `current_school_uuid()`, which reads the
 * `o` claim from the session token. Clerk only puts that claim there when an
 * organisation is ACTIVE. The web app sets one — `/welcome` and the portal switcher
 * both call `setActive({ organization })` — and the phone app never did. It called
 * `setActive({ session })` alone, so the token carried no `o`, so SQL saw a signed-in
 * user belonging to no school and every policy correctly denied.
 *
 * The teacher was a member of the organisation the whole time. Nothing was wrong with
 * their account, their staff record or their permissions.
 *
 * ## One school: choose it. Several: leave it alone.
 *
 * A teacher at one school has nothing to decide, and asking would be a question with a
 * single answer. Somebody at two schools has a real choice, and guessing for them would
 * silently put a register in front of the wrong class — the portal picker already
 * exists for that.
 */

import type { useOrganizationList } from '@clerk/clerk-expo'

type OrganizationList = ReturnType<typeof useOrganizationList>

/**
 * Activate the account's only organisation, if it has exactly one and none is active.
 *
 * Returns what happened, so a caller can route on it rather than guessing. Never
 * throws: a sign-in that completed must not be undone because an optional convenience
 * failed.
 */
export async function activateOnlySchool(
  list: OrganizationList,
  currentOrgId: string | null | undefined,
): Promise<'already-active' | 'activated' | 'several' | 'none' | 'unavailable'> {
  // Already in a school. Nothing to do, and re-setting it would reload the session for
  // no reason.
  if (currentOrgId) return 'already-active'

  if (!list.isLoaded || !list.setActive || !list.userMemberships) return 'unavailable'

  const memberships = list.userMemberships.data ?? []

  if (memberships.length === 0) return 'none'

  /*
    Several memberships is a real choice, and the portal picker makes it.

    Activating the first would be arbitrary, and the cost of getting it wrong is a
    teacher marking the wrong school's register — which looks like their own mistake.
  */
  if (memberships.length > 1) return 'several'

  const only = memberships[0]
  if (!only?.organization?.id) return 'unavailable'

  try {
    await list.setActive({ organization: only.organization.id })
    return 'activated'
  } catch {
    // A failed activation leaves them signed in with no school — the state they were
    // already in. The account screen explains it rather than this throwing into a
    // sign-in flow that has otherwise succeeded.
    return 'unavailable'
  }
}
