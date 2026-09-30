'use client'

/**
 * Sign out, from outside any portal shell.
 *
 * Spec: `Official Documentation/02 Authentication and Identity/SESSIONS.md`
 *
 * ## Why this small file exists at all
 *
 * Sign-out lived only in `components/ui/account-menu.tsx`, which renders inside the portal shells. A
 * session that could not reach a shell — an account with no organisation — therefore had no way to
 * sign out, and that is what turned a wrong redirect in `/school/page.tsx` into a lockout: no
 * destination, and no way to try a different account either.
 *
 * `AccountMenu` is not reusable here. It reads the organisation list to render a school switcher and
 * shows a role label, neither of which a user with no organisation has. So this is the sign-out on its
 * own, as the smallest possible client island in an otherwise server-rendered page.
 *
 * ## Where it sends them
 *
 * `/` rather than `/sign-in`. Somebody signing out of an account they did not mean to use is usually
 * heading for a different door entirely — the school dashboard, the directory — and the homepage offers
 * all four. Dropping them back on a sign-in form invites them to re-enter the same credentials.
 */

import type { JSX } from 'react'

import { SignOutButton } from '@zsms/auth-provider/react'

export function SignOutLink(): JSX.Element {
  return (
    <SignOutButton redirectUrl="/">
      {/* A button rather than a link: it performs an action. Styled as a link because it sits inline
          in a sentence, and sized to the tap target so it is reachable with a thumb. */}
      <button
        type="button"
        className="inline-flex min-h-tap items-center font-medium text-foreground underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Sign out
      </button>
    </SignOutButton>
  )
}
