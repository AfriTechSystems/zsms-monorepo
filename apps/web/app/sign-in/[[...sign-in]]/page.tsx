/**
 * Sign-in.
 *
 * Spec: `Official Documentation/02 Authentication and Identity/AUTH.md`
 *       `Official Documentation/01 Foundation Layer/DESIGN_SYSTEM.md`
 *
 * A catch-all segment because the hosted flow navigates to sub-paths of its own
 * (`/sign-in/factor-one`, `/sign-in/sso-callback`) and each must render this
 * component rather than a 404.
 *
 * Email OTP only — SMS OTP is disabled platform-wide per AUTH.md. That is a
 * Clerk dashboard setting, not something this file can enforce, so a second
 * factor appearing here means the dashboard drifted.
 *
 * ## The page is ZSMS, not a provider's page with a logo on it
 *
 * This is the first screen anyone sees, and until now it was a Clerk-branded
 * card floating on a blank background. The layout below is ours: the lockup, a
 * line saying what this is, the form, and a footer naming AfriTech. The form
 * itself is skinned through `authAppearance`, whose every rule resolves to a
 * `--zsms-*` variable — so it inherits light and dark, the type scale, and the
 * 44px tap floor rather than restating them.
 *
 * `min-h-dvh` rather than `min-h-screen`: on mobile Safari `100vh` is the height
 * of the viewport *without* the address bar, so a centred form sits a browser
 * chrome's worth too low and the submit button lands under it.
 */

import type { JSX } from 'react'
import Image from 'next/image'

import { SignIn } from '@zsms/auth-provider/react'

import { authAppearance } from '../../../components/ui/auth-appearance'

export const metadata = { title: 'Sign in · ZSMS' }

export default function SignInPage(): JSX.Element {
  return (
    <main
      id="main"
      className="flex min-h-dvh flex-col items-center justify-center gap-cards bg-background px-gutter py-10"
    >
      <div className="flex w-full max-w-md flex-col items-center gap-3 text-center">
        <Image
          src="/brand/zsms-lockup.png"
          alt="ZSMS — school management by AfriTech Systems"
          width={200}
          height={64}
          priority
          className="h-auto w-[150px] sm:w-[180px]"
        />
        <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          Sign in to your school
        </h1>
        <p className="text-sm text-muted-foreground">
          School management for Zambian schools.
        </p>
      </div>

      {/* `signUpUrl` keeps the "create an account" link inside ZSMS. Left to
          itself Clerk links to its hosted portal on `*.accounts.dev`, which is
          how invited staff ended up outside the product. */}
      {/*
        `/welcome` rather than `/school`. Landing every sign-in on the staff portal presumed everybody
        is school staff, and there was no branch for anybody else — see the comment in
        `app/welcome/page.tsx` for the lockout that produced. `/welcome` reads the session and routes
        by what the account IS, which is the only thing that can decide it.
      */}
      <SignIn signUpUrl="/sign-up" fallbackRedirectUrl="/welcome" appearance={authAppearance} />

      <p className="max-w-md text-center text-xs text-subtle">
        ZSMS is a product of AfriTech Systems Limited. Trouble signing in? Ask your school
        administrator, who can re-send your invitation.
      </p>
    </main>
  )
}
