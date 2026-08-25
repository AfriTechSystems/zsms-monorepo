/**
 * Sign-up — where an invited colleague lands.
 *
 * Spec: `Official Documentation/02 Authentication and Identity/AUTH.md`
 *       `Official Documentation/03 Infrastructure Services/CLERK.md`
 *       `Official Documentation/15 Super Admin and Platform/ONBOARDING.md`
 *
 * ## Why its absence sent invited staff to a Clerk page
 *
 * An organisation invitation email links to a Clerk *ticket* URL. Clerk consumes
 * the ticket and then redirects — to `redirect_url` if the invitation carried
 * one, and otherwise to the instance's **Account Portal**, which is Clerk's own
 * hosted page on `*.accounts.dev`.
 *
 * ZSMS had no `/sign-up` route at all, and its invitations named no redirect. So
 * every invited teacher accepted their invitation, saw the school appear, and
 * landed on a Clerk-branded page with no way into the product. The account was
 * created correctly; there was simply nowhere to send them.
 *
 * This route is that destination. The catch-all segment matters for the same
 * reason it does on sign-in: the flow navigates to sub-paths of its own
 * (`/sign-up/verify-email-address`, `/sign-up/continue`) and each must render
 * this component rather than 404.
 *
 * ## The ticket is read from the URL, not passed in
 *
 * Clerk's `<SignUp>` picks up `__clerk_ticket` from the query string itself and
 * switches into "accept invitation" mode — pre-filling the address, skipping the
 * parts already settled, and joining the organisation on completion. Nothing has
 * to be threaded through, which is why this file is short and why the fix was in
 * the invitation's `redirectUrl` rather than here.
 */

import type { JSX } from 'react'
import Image from 'next/image'

import { SignUp } from '@zsms/auth-provider/react'

export const metadata = { title: 'Create your account · ZSMS' }

export default function SignUpPage(): JSX.Element {
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center gap-section p-gutter">
      <div className="flex flex-col items-center gap-stack text-center">
        <Image
          src="/brand/zsms-lockup.png"
          alt="ZSMS — school management by AfriTech Systems"
          width={200}
          height={64}
          priority
          className="h-auto w-[180px]"
        />
        <p className="max-w-sm text-muted-foreground">
          Set a password and you will be taken straight into your school.
        </p>
      </div>

      {/* `signInUrl` so the "already have an account?" link stays inside ZSMS.
          Without it Clerk points at its own hosted portal, which is the same
          class of problem this page exists to fix. */}
      <SignUp signInUrl="/sign-in" fallbackRedirectUrl="/school" />
    </main>
  )
}
