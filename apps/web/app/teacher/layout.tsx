/**
 * Teacher Hub shell.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md`
 *       `Official Documentation/01 Foundation Layer/DESIGN_SYSTEM.md`
 *
 * ## No school theming, and here it is not a preference
 *
 * The school portal paints itself in the school's colours. This shell cannot: the Hub
 * belongs to the teacher, not to a school, and a standalone teacher has no school whose
 * palette could be applied. For a linked teacher it would be worse than impossible — it
 * would suggest their personal lesson plans are the school's property, which is the exact
 * opposite of what the database enforces.
 *
 * ## `/teacher` versus `/school/[code]/teaching/my`
 *
 * Two different things, easily confused. `/school/[code]/teaching/my` is the in-school
 * teacher's landing page — their classes, registers and mark sheets, all school data.
 * `/teacher` is the standalone product: personal planning tools with no school data in
 * reach. A linked teacher uses both, and the nav keeps them apart.
 */

import type { JSX, ReactNode } from 'react'

import { TeacherHubNav } from './teacher-hub-nav'

export default function TeacherHubLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="min-h-dvh bg-background">
      <TeacherHubNav />
      {/* `id="main"` is the skip-link target from the root layout. Without it the link in
          every page announces a destination that does not exist. */}
      <main id="main" className="mx-auto max-w-5xl px-gutter py-cards">
        {children}
      </main>
    </div>
  )
}
