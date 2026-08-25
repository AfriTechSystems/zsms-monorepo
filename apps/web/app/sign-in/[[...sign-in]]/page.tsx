/**
 * Sign-in.
 *
 * Spec: `Official Documentation/02 Authentication and Identity/AUTH.md`
 *
 * A catch-all segment because the hosted flow navigates to sub-paths of its own
 * (`/sign-in/factor-one`, `/sign-in/sso-callback`) and each must render this
 * component rather than a 404.
 *
 * Email OTP only — SMS OTP is disabled platform-wide per AUTH.md. That is a
 * Clerk dashboard setting, not something this file can enforce, so it is worth
 * knowing that a second factor appearing here means the dashboard drifted.
 */

import type { JSX } from 'react'
import Image from 'next/image'

import { SignIn } from '@zsms/auth-provider/react'

export const metadata = { title: 'Sign in · ZSMS' }

export default function SignInPage(): JSX.Element {
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
          School management for Zambian schools.
        </p>
      </div>

      {/* Clerk's component renders its own markup; the surrounding page carries
          the ZSMS theme so the transition into it is not a visual cliff. */}
      {/* `signUpUrl` keeps the "create an account" link inside ZSMS. Left
          to itself Clerk links to its hosted portal on `*.accounts.dev`,
          which is how invited staff ended up outside the product. */}
      <SignIn signUpUrl="/sign-up" fallbackRedirectUrl="/school" />
    </main>
  )
}
