/**
 * Where a staff invitation lands.
 *
 * Spec: `Official Documentation/08 Staff Management/INVITATIONS.md`
 *       `Official Documentation/02 Authentication and Identity/AUTH.md`
 *
 * ## The bug this fixes
 *
 * Reported from the running application on 2026-10-02: accepting an invitation showed a
 * **"Create your account"** form to somebody who already had one, with no way to sign in
 * instead.
 *
 * Invitations redirected to `/sign-up` unconditionally. But Clerk decides which flow a
 * ticket needs and says so in the URL it sends back:
 *
 *   * `__clerk_status=sign_up` — no account with that address. Create one.
 *   * `__clerk_status=sign_in` — the account exists. Just prove it is you.
 *   * `__clerk_status=complete` — already accepted; the membership is live.
 *
 * `<SignUp>` consumes a `sign_up` ticket and is the wrong component for the other two. An
 * existing user reached a registration form that could not help them and offered no link
 * out, because Clerk's prebuilt sign-up only shows a "sign in instead" link when it is
 * mounted knowing the sign-in route — which a ticket flow does not do for it.
 *
 * ## One page, branching on the status Clerk already told us
 *
 * Rather than a second redirect: the ticket is single-use and bouncing it between routes
 * risks consuming it on a page that then discards it. Both components read
 * `__clerk_ticket` from the URL themselves, so the only decision here is which to mount.
 */

import type { JSX } from 'react'
import Link from 'next/link'

import { SignIn, SignUp } from '@zsms/auth-provider/react'

import { AuthShell, loadAuthBranding } from '../../components/ui/auth-shell'
import { authAppearance } from '../../components/ui/auth-appearance'

export const metadata = { title: 'Accept your invitation · ZSMS' }

export default async function AcceptInvitation({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}): Promise<JSX.Element> {
  const params = await searchParams
  const raw = params['__clerk_status']
  const status = Array.isArray(raw) ? raw[0] : raw

  // No school code in an invitation URL, so the product's own branding applies. The
  // school's colours appear once they are inside it.
  const branding = await loadAuthBranding(undefined)

  /*
    Already a member.

    Clerk marks the ticket complete once the membership exists, which happens when
    somebody opens the same link twice — a common thing to do with an email. Showing
    either form here would be wrong: there is nothing left to accept.
  */
  if (status === 'complete') {
    return (
      <AuthShell branding={branding} title="You are already in">
        <div className="flex flex-col items-center gap-stack text-center">
          <p className="text-sm text-muted-foreground">
            This invitation has already been accepted. Sign in and ZSMS will take you to
            your school.
          </p>
          <Link
            href="/sign-in"
            className="inline-flex min-h-tap items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Sign in
          </Link>
        </div>
      </AuthShell>
    )
  }

  /*
    The account exists — this is a sign-in with a ticket attached, and accepting the
    invitation is what Clerk does once the identity is proven.

    `signUpUrl` is still passed so the component can offer the other route if Clerk
    changes its mind about the status mid-flow, which it does when an address is added
    to an existing account during the attempt.
  */
  if (status === 'sign_in') {
    return (
      <AuthShell branding={branding} title="Sign in to accept">
        <SignIn
          appearance={authAppearance}
          routing="hash"
          signUpUrl="/sign-up"
          fallbackRedirectUrl="/welcome"
        />
      </AuthShell>
    )
  }

  // No account yet, or Clerk said nothing. Creating one is the safe default: the ticket
  // carries the organisation, so a new account joins the right school.
  return (
    <AuthShell branding={branding} title="Create your account">
      <SignUp
        appearance={authAppearance}
        routing="hash"
        // The link that was missing. Somebody who turns out to have an account already
        // can get to the right place without editing a URL.
        signInUrl="/sign-in"
        fallbackRedirectUrl="/welcome"
      />
    </AuthShell>
  )
}
