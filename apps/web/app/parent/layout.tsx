/**
 * Parent portal shell.
 *
 * Spec: `Official Documentation/07 Student and Parent Modules/PARENTS.md`
 *       `Official Documentation/01 Foundation Layer/DESIGN_SYSTEM.md`
 *
 * ## Not school-scoped in the URL, deliberately
 *
 * The school portal lives at `/school/[schoolCode]/...` because a staff member belongs to one
 * school and the code in the URL is useful. A parent does not think in school codes — they think
 * about their children — so the portal is `/parent/...` and the child is a query parameter the
 * screens carry.
 *
 * The consequence, stated rather than discovered: a parent with children at two ZSMS schools is
 * in two Clerk organisations, and a session acts in one at a time. Today they see the children of
 * whichever org is active. That is a real limitation and it is recorded in `CLAUDE.md` rather
 * than papered over with a screen that silently shows half a family.
 *
 * ## Bottom tabs on a phone, a sidebar on a desktop
 *
 * This portal is read on a phone almost exclusively, so `ParentShell` gives it thumb-reachable
 * bottom tabs rather than the drawer the staff portals use — five destinations do not deserve a
 * hidden menu. See that file for why it is not the shared `AppShell`.
 *
 * ## No school theming here
 *
 * The school layout applies the school's colours. This one does not, because a parent with two
 * children at one school still has one portal, and switching palettes as they move between
 * children would read as a different product. The platform theme is the neutral ground.
 */

import type { JSX, ReactNode } from 'react'

import { AccountMenu } from '../../components/ui/account-menu'
import { ThemeToggle } from '../../components/ui/theme-toggle'
import { ParentShell } from './parent-shell'

export default function ParentLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <ParentShell
        headerActions={
          <>
            <ThemeToggle />
            <AccountMenu />
          </>
        }
      >
        {children}
      </ParentShell>
    </>
  )
}
