/**
 * `/school` — sends a school user to their own portal.
 *
 * The portal's URLs carry the school code so a link can be shared between
 * colleagues and read at a glance, but nobody should have to know their own
 * school's code to reach their own dashboard. This resolves it from the session
 * and redirects.
 *
 * A signed-in user with no school organisation (an AfriTech operator, a
 * standalone Teacher Hub account, a parent) is sent where they belong rather
 * than into a shell built for staff.
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

  // A parent or pupil signed into a school org. Their portals are separate
  // surfaces; until those exist, the honest answer is the sign-in screen rather
  // than a staff shell they cannot use.
  redirect('/sign-in?redirect_url=/school')
}
