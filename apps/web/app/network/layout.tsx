/**
 * School Network shell.
 *
 * Spec: migrations `0119`–`0122`
 *
 * ## Not themed with any school's colours
 *
 * The school portal wears the school's brand; this surface deliberately does not,
 * for the same reason the AfriTech admin shell does not: a screen showing 100
 * schools cannot be one school's colour without implying it belongs to that one.
 * The platform theme is the neutral ground.
 *
 * ## The school switcher rides in the header
 *
 * It is the drill-down. A network member who is also a member of a school's Clerk
 * organisation can move straight into it from here, and the switcher already
 * disables any school whose invitation has not been accepted — which is the honest
 * state for a network whose schools were attached before its owner was invited into
 * each one.
 */

import type { JSX, ReactNode } from 'react'
import Link from 'next/link'
import { Building2 } from 'lucide-react'

import { AccountMenu } from '../../components/ui/account-menu'
import { ThemeToggle } from '../../components/ui/theme-toggle'
import { SchoolSwitcher } from '../../components/ui/school-switcher'

export const metadata = {
  title: 'School network · ZSMS',
}

export default function NetworkLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-gutter py-3">
          <Link href="/network" className="flex min-w-0 items-center gap-2">
            <Building2 aria-hidden="true" className="size-5 shrink-0 text-primary" />
            <span className="truncate text-base font-semibold text-foreground">
              ZSMS — Network
            </span>
          </Link>

          <div className="flex shrink-0 items-center gap-2">
            {/* The drill-down into any one school. */}
            <SchoolSwitcher />
            <ThemeToggle />
            <AccountMenu />
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-7xl px-gutter py-cards">
        {children}
      </main>
    </div>
  )
}
