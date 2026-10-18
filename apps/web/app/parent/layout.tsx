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
 * ## A parent is not in a Clerk organisation, and this block used to say otherwise
 *
 * Until 2026-10-18 the paragraph here described a limitation: that a parent with children at two
 * ZSMS schools is in two Clerk organisations, a session acts in one at a time, and so they see
 * only half a family. **The premise was never true of this schema.** `is_linked_parent_of()`
 * reads `parent_user_id = public.get_user_id()` and nothing else — no `current_school_uuid()`,
 * no organisation claim — so **a parent's access is scoped by the link row, not by an
 * organisation**, and parent policies already span every school a child of theirs attends.
 * `claim_parent_links()` links across all of them at once, on the verified email address.
 *
 * Choosing a school is therefore a screen (`/parent/schools`) and not an organisation switch, and
 * nothing in that path calls Clerk. That page has carried a note saying this premise is false for
 * some time; the limitation it contradicted is the one that was written here, which is why both
 * `CLAUDE.md` and this file have now been corrected.
 *
 * The lesson is the repository's standing one: a limitation recorded from a documented claim
 * rather than from the schema outlives the claim. Verify against the applied schema.
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

import { NotificationBell } from '../../components/ui/notification-bell'
import { AccountMenu } from '../../components/ui/account-menu'
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
            <NotificationBell endpoint="/api/parent/notices" allHref="/parent/notices" />
            <AccountMenu />
          </>
        }
      >
        {children}
      </ParentShell>
    </>
  )
}
