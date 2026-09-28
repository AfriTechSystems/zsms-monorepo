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

import { AccountMenu } from '../../components/ui/account-menu'
import { ThemeToggle } from '../../components/ui/theme-toggle'
import { TeacherShell } from './teacher-shell'

export const metadata = {
  title: 'Teacher Hub \u00b7 ZSMS',
}

export default function TeacherHubLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <TeacherShell
        headerActions={
          <>
            <ThemeToggle />
            <AccountMenu />
          </>
        }
      >
        {children}
      </TeacherShell>
    </>
  )
}
