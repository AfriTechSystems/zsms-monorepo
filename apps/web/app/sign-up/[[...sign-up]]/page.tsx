/**
 * Create an account — for an invited colleague, a head teacher, or a teacher joining the Hub.
 *
 * Spec: `Official Documentation/02 Authentication and Identity/AUTH.md`
 *       `Official Documentation/03 Infrastructure Services/CLERK.md`
 *       `Official Documentation/15 Super Admin and Platform/ONBOARDING.md`
 *
 * ## Why its absence once sent invited staff to a Clerk page
 *
 * An organisation invitation links to a Clerk *ticket* URL. Clerk consumes the ticket and redirects —
 * to `redirect_url` if the invitation carried one, and otherwise to the instance's Account Portal,
 * which is Clerk's own hosted page on `*.accounts.dev`. ZSMS had no `/sign-up` route at all and its
 * invitations named no redirect, so every invited teacher accepted, saw the school appear, and landed
 * on a Clerk-branded page with no way into the product.
 *
 * The ticket is read from the URL rather than passed in: Clerk's `<SignUp>` picks up `__clerk_ticket`
 * from the query string itself and switches into accept-invitation mode, pre-filling the address and
 * joining the organisation on completion.
 *
 * ## It is no longer only for invited staff
 *
 * This page's copy used to tell every visitor their school administrator had invited them. It is now
 * also where a head teacher registering their own school arrives, and where a standalone teacher
 * creating a Hub account arrives — so it no longer promises a school, and `/welcome` works out where
 * the account belongs once it exists.
 *
 * ## The phone field
 *
 * Clerk's sign-up form can ask for a phone number and should not here: ZSMS is **email OTP only, SMS
 * OTP deliberately disabled** (`CLAUDE.md`, `AUTH.md`), so a number collected at this point is one
 * Clerk will never use — while our own forms collect `+260…` with our own validation and store it
 * where the fee reminders actually read it. Asking twice for one thing, and using the wrong copy for
 * it.
 *
 * That switch is Clerk instance configuration and cannot be set from this repository —
 * **Dashboard → Configure → Email, Phone, Username → Phone number → off**. It belongs with the other
 * undocumented instance settings `CLERK.md` tracks.
 */

import type { JSX } from 'react'

import { SignUp } from '@zsms/auth-provider/react'

import { AuthShell, loadAuthBranding } from '../../../components/ui/auth-shell'
import { authAppearance } from '../../../components/ui/auth-appearance'

export const metadata = { title: 'Create your account · ZSMS' }

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ school_id?: string }>
}): Promise<JSX.Element> {
  const { school_id: schoolId } = await searchParams
  const branding = await loadAuthBranding(schoolId)

  return (
    <AuthShell
      title="Create your ZSMS account"
      subtitle={branding ? undefined : 'One account for your school, the Teacher Hub, or both.'}
      branding={branding}
      footnote="ZSMS is a product of AfriTech Systems Limited."
    >
      <SignUp signInUrl="/sign-in" fallbackRedirectUrl="/welcome" appearance={authAppearance} />
    </AuthShell>
  )
}
