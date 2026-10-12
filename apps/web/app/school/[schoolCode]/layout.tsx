/**
 * School portal shell.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/SCHOOL_SETUP.md`
 *       `Official Documentation/01 Foundation Layer/DESIGN_SYSTEM.md`
 *
 * ## A server layout wrapping a client shell
 *
 * The session resolution, the redirect and the 404 happen here on the server, so no screen below
 * has to remember to check. The sidebar is a client component: it holds collapse state, remembers
 * which groups are closed, and carries icon references that cannot cross the RSC boundary as
 * props. `session.role` is a string and crosses fine, which is what lets the permission filter
 * stay in the shell.
 *
 * ## The school's brand is an accent, not the chrome
 *
 * `ThemeStyle` still writes the school's palette, and the sidebar still uses it — but only on the
 * active item and the logo. Painting the whole sidebar in a school's colour looks appealing until
 * a school whose brand is near-black submits their logo, at which point the surface the reader
 * uses most becomes the one that fails `/design`'s contrast audit.
 */

import type { JSX, ReactNode } from 'react'
import { StaffRecordSync } from '../../../components/ui/staff-record-sync'
import { ShieldAlert } from 'lucide-react'

import { ThemeStyle } from '../../../lib/theme'
import { requireSchoolSession } from '../../../lib/school-session'
import { ROLE_LABEL } from '../../../lib/roles'
import { NotificationBell } from '../../../components/ui/notification-bell'
import { AccountMenu } from '../../../components/ui/account-menu'
import { ThemeToggle } from '../../../components/ui/theme-toggle'
import { SchoolSwitcher } from '../../../components/ui/school-switcher'
import { GlobalSearch } from '../../../components/ui/global-search'
import { SchoolShell } from './school-shell'

export const metadata = {
  title: 'School portal · ZSMS',
}

export default async function SchoolLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ schoolCode: string }>
}): Promise<JSX.Element> {
  const { schoolCode } = await params

  // Redirects when signed out, 404s when the URL names a school this session is not in. Both
  // exits happen here so no screen below has to remember to check. One resolution for the whole
  // tree — `requireSchoolSession` is memoised per request, and returns the theme alongside the
  // school so the shell does not make a second round trip for branding.
  const session = await requireSchoolSession(schoolCode)
  const theme = session.theme
  const base = `/school/${session.slug}`

  return (
    <>
      {/* Accepting a Clerk invitation creates an organisation membership and nothing
          else — until 0184 nothing wrote the `staff_members` row, so an accepted teacher
          was invisible on the Staff screen and unassignable to a class. Renders nothing;
          see the component. */}
      <StaffRecordSync />

      <ThemeStyle theme={theme} />
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      {/*
        Above the shell rather than inside it, and deliberately so: an impersonation warning that
        scrolled away with the content, or sat inside a collapsible sidebar, would be a warning
        somebody could miss while acting as another person.
      */}
      {session.isImpersonating && (
        <div
          role="status"
          className="flex items-center justify-center gap-2 bg-warning-fill px-gutter py-2 text-center text-sm font-medium text-white"
        >
          <ShieldAlert aria-hidden="true" className="size-4 shrink-0" />
          <span>
            You are signed in as a user at {session.school.name}. Everything you do is recorded
            against them.
          </span>
        </div>
      )}

      <SchoolShell
        base={base}
        schoolName={session.school.name}
        roleLabel={`${session.school.schoolCode} · ${ROLE_LABEL[session.role] ?? session.role}`}
        role={session.role}
        headerActions={
          <>
            {/*
              Global search (`0266`).

              Mounted per portal rather than in the shell, because not every audience
              benefits: a parent has one or two children, so a box that searches them is
              furniture. The function itself is safe for anyone — it is SECURITY INVOKER
              and RLS scopes every result — so this is a usefulness decision, not a
              security one.
            */}
            <GlobalSearch placeholder="Search pupils, staff…" />
            {/* Renders nothing for the common case of one school, so a single-school head
                teacher never sees a control implying there is somewhere else to be. */}
            <SchoolSwitcher />
            <ThemeToggle />
            <NotificationBell endpoint="/api/session/notices" />
            <AccountMenu />
          </>
        }
      >
        {children}
      </SchoolShell>
    </>
  )
}
