/**
 * Parent portal shell.
 *
 * Spec: `Official Documentation/07 Student and Parent Modules/PARENTS.md`
 *       `Official Documentation/01 Foundation Layer/DESIGN_SYSTEM.md`
 *
 * ## Not school-scoped in the URL, deliberately
 *
 * The school portal lives at `/school/[schoolCode]/…` because a staff member
 * belongs to one school and the code in the URL is useful. A parent does not
 * think in school codes — they think about their children — so the portal is
 * `/parent/…` and the child is a query parameter the screens carry.
 *
 * The consequence, stated rather than discovered: a parent with children at two
 * ZSMS schools is in two Clerk organisations, and a session acts in one at a
 * time. Today they see the children of whichever org is active. That is a real
 * limitation and it is recorded in `CLAUDE.md` rather than papered over with a
 * screen that silently shows half a family.
 *
 * ## No school theming here
 *
 * The school layout applies the school's colours. This one does not, because a
 * parent with two children at one school still has one portal, and switching
 * palettes as they move between children would read as a different product. The
 * platform theme is the neutral ground.
 */

import type { JSX, ReactNode } from 'react'

import { ParentNav } from './parent-nav'

export default function ParentLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="min-h-dvh bg-background">
      <ParentNav />
      {/* `id="main"` is the skip-link target from the root layout. Without it the
          link in every page announces a destination that does not exist. */}
      <main id="main" className="mx-auto max-w-5xl px-gutter py-cards">
        {children}
      </main>
    </div>
  )
}
