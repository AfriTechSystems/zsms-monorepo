/**
 * `/school` — sends a school user to their own portal.
 *
 * The portal's URLs carry the school code so a link can be shared between
 * colleagues and read at a glance, but nobody should have to know their own
 * school's code to reach their own dashboard. This resolves it from the session
 * and redirects.
 *
 * A signed-in user with no school organisation (an AfriTech operator, a
 * standalone Teacher Hub account, a parent) is handed to `/welcome`, which owns
 * the routing table for every audience. This page resolves the one case it is
 * named for and delegates the rest rather than keeping a second copy of that
 * decision.
 */

import { redirect } from 'next/navigation'

import { getAuthProvider } from '@zsms/auth-provider'

import { AFRITECH_ORG_SLUG } from '../../lib/admin-context'
import { isPortalRole } from '../../lib/roles'

export const dynamic = 'force-dynamic'

export default async function SchoolIndexPage(): Promise<never> {
  const session = await getAuthProvider().getSessionUser()
  if (!session) redirect('/sign-in?redirect_url=/school')

  if (session.organisationSlug === AFRITECH_ORG_SLUG) redirect('/admin')

  // The slug IS the school code, lowercased — one identifier shared with Clerk
  // and with `school_branding_by_slug()`.
  if (session.organisationSlug && isPortalRole(session.role)) {
    redirect(`/school/${session.organisationSlug.toLowerCase()}`)
  }

  /**
   * Anything else — a parent or pupil in a school org, or an account with no organisation — goes to
   * `/welcome`, which is the one place that decides.
   *
   * This used to `redirect('/sign-in?redirect_url=/school')`, and that was the lockout. Sending an
   * already-authenticated user to a sign-in page is a loop: Clerk sees a live session and returns
   * them here, which returns them there. Sign-out lives inside the portal shells, so somebody caught
   * in it could not even switch accounts — one missing branch made the whole product unreachable.
   */
  redirect('/welcome')
}
