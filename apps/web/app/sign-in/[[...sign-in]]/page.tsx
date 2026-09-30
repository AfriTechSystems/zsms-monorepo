/**
 * Sign in — one door for every audience.
 *
 * Spec: `Official Documentation/02 Authentication and Identity/AUTH.md`
 *       `Official Documentation/06 School and Tenant Management/PUBLIC_DIRECTORY.md`
 *
 * ## One page, not four
 *
 * `AUTH.md` lists an entry point per audience — `/login`, `/portal/login`, `/teacher/login`,
 * `/admin/login`. ZSMS has a single Clerk instance and one session shape, so four URLs would be four
 * doors onto the same lock: whichever you arrive at, the email and the OTP are identical and so is the
 * session that comes out. What differs is where you belong afterwards, and that is decided by the
 * account rather than by the door — so routing happens once, at `/welcome`.
 *
 * ## `?school_id=` finally does something
 *
 * The directory links a parent through as `/sign-in?school_id=ZM-LSK-0001`, per `PUBLIC_DIRECTORY.md`,
 * and until now nothing read it. The shell resolves it to the school's name and crest, so a parent who
 * has never heard of ZSMS sees their own school on the page. That reassurance is most of the reason the
 * parameter exists.
 */

import type { JSX } from 'react'

import { SignIn } from '@zsms/auth-provider/react'

import { AuthShell, loadAuthBranding } from '../../../components/ui/auth-shell'
import { authAppearance } from '../../../components/ui/auth-appearance'

export const metadata = { title: 'Sign in · ZSMS' }

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ school_id?: string }>
}): Promise<JSX.Element> {
  const { school_id: schoolId } = await searchParams
  const branding = await loadAuthBranding(schoolId)

  return (
    <AuthShell
      title="Sign in to ZSMS"
      subtitle={branding ? undefined : 'School management for Zambian schools.'}
      branding={branding}
      footnote={
        branding
          ? `Use the email ${branding.schoolName} has on file for you. If it does not work, ask the school to check it.`
          : 'Trouble signing in? Ask your school administrator, who can re-send your invitation.'
      }
    >
      {/*
        `signUpUrl` keeps "create an account" inside ZSMS — left alone, Clerk links to its hosted
        portal on `*.accounts.dev`, which is how invited staff ended up outside the product.

        `fallbackRedirectUrl` is `/welcome`, not `/school`. Landing every sign-in on the staff portal
        presumed everybody is school staff and had no branch for anybody else, which locked out every
        account with no organisation — see the header of `app/welcome/page.tsx`.
      */}
      <SignIn signUpUrl="/sign-up" fallbackRedirectUrl="/welcome" appearance={authAppearance} />
    </AuthShell>
  )
}
