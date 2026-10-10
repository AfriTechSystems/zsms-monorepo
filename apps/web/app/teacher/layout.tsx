/**
 * Teacher Hub shell.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md`
 *       `Official Documentation/01 Foundation Layer/DESIGN_SYSTEM.md`
 *
 * ## No school theming, and here it is not a preference
 *
 * The school portal paints itself in the school's colours. This shell cannot: the Hub belongs to
 * the teacher, not to a school, and a standalone teacher has no school whose palette could
 * apply. For a linked teacher it would be worse than impossible — it would suggest their personal
 * lesson plans are the school's property, which is the opposite of what the database enforces.
 *
 * ## `/teacher` versus `/school/[code]/teaching/my`
 *
 * Two different things, easily confused. `/school/[code]/teaching/my` is the in-school teacher's
 * landing page — their classes, registers and mark sheets, all school data. `/teacher` is the
 * standalone product: personal planning tools with no school data in reach. A linked teacher uses
 * both, and the navigation keeps them apart.
 */

import type { JSX, ReactNode } from 'react'

import { SignedIn, SignedOut } from '@zsms/auth-provider/react'

import { NotificationBell } from '../../components/ui/notification-bell'
import { AccountMenu } from '../../components/ui/account-menu'
import { ThemeToggle } from '../../components/ui/theme-toggle'
import { TeacherShell } from './teacher-shell'
import { HubSignIn } from './hub-sign-in'

export const metadata = {
  title: 'Teacher Hub \u00b7 ZSMS',
}

export default function TeacherHubLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      {/*
        THE SIGNED-OUT BRANCH LIVES HERE, not on each page.

        `/teacher` had one. `/teacher/create`, `/teacher/library` and `/teacher/account` did
        not: they mounted, called the Hub API, got 401, and rendered an error state with a
        "Try again" button. A visitor who had never signed in was told the product was
        broken — and retrying is precisely what would not help.

        Put on each page it would be three fixes and a fourth sibling waiting to be written
        without it. In the layout every Hub route is covered by construction.

        `SignedOut`/`SignedIn` rather than a redirect, because the Hub's front door has to
        SELL before it asks: a teacher arriving from the homepage has not decided to create
        an account yet, and bouncing them to a sign-in form answers a question they have not
        asked. `HubSignIn` shows what they get, then offers the account.
      */}
      <SignedOut>
        <main id="main" className="mx-auto w-full max-w-5xl px-gutter py-6 sm:py-10">
          <HubSignIn />
        </main>
      </SignedOut>

      <SignedIn>
        <TeacherShell
          headerActions={
            <>
              <ThemeToggle />
              <NotificationBell endpoint="/api/session/notices" />
            <AccountMenu />
            </>
          }
        >
          {children}
        </TeacherShell>
      </SignedIn>
    </>
  )
}
