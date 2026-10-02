'use client'

/**
 * The parent portal navigation — bottom tabs on a phone, a sidebar on a desktop.
 *
 * ## Why this one is not `AppShell`
 *
 * Two reasons, and the first was already argued in the nav this replaces: **this portal is read
 * on a phone almost exclusively**, and 240px of sidebar on a 375px screen is most of the screen.
 * A drawer behind a hamburger would technically fit, but five destinations do not deserve a
 * hidden menu — bottom tabs put all five one thumb-reach away with nothing to open first.
 *
 * The second is `childId`. Every parent screen carries the selected child as a query parameter,
 * and a nav that dropped it would silently switch which child the reader is looking at while
 * they move between attendance and fees. `AppShell` builds plain hrefs; this one preserves the
 * parameter, which is why it stays a separate component rather than a prop on the shared shell.
 *
 * ## Five items, no groups
 *
 * Grouping exists to stop a reader scanning nine things. Five fit in one glance, and headings
 * over a list of five would be more chrome than content.
 */

import type { JSX, ReactNode } from 'react'
import { ChildSwitcher } from './child-switcher'
import { Suspense } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { CalendarCheck, ClipboardList, LayoutDashboard, Megaphone, Wallet } from 'lucide-react'

import { cn } from '../../lib/utils'

const LINKS = [
  /*
    Home is THIRD of five, not first.

    Asked for on 2026-10-02. At the left edge it is the hardest tab to reach with the thumb
    of the hand holding the phone, and it is the one a parent returns to between every other
    screen. The centre of a five-tab bar is the easiest point to hit, so the most-used
    destination goes there and is drawn slightly larger.
  */
  { path: '/attendance', label: 'Attendance', icon: CalendarCheck, exact: false },
  { path: '/results', label: 'Results', icon: ClipboardList, exact: false },
  { path: '', label: 'Home', icon: LayoutDashboard, exact: true },
  { path: '/fees', label: 'Fees', icon: Wallet, exact: false },
  { path: '/notices', label: 'Notices', icon: Megaphone, exact: false },
] as const

function useLinks(): Array<{
  href: string
  label: string
  icon: typeof LayoutDashboard
  active: boolean
}> {
  const pathname = usePathname()
  const childId = useSearchParams().get('childId')

  return LINKS.map(({ path, label, icon, exact }) => {
    const target = `/parent${path}`
    return {
      // The child survives the move. Without this a parent checking fees after attendance
      // would silently be looking at a different child.
      href: `${target}${childId ? `?childId=${childId}` : ''}`,
      label,
      icon,
      active: exact ? pathname === target : pathname.startsWith(target),
    }
  })
}

function DesktopSidebar(): JSX.Element {
  const links = useLinks()

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-surface lg:flex">
      <div className="border-b border-border px-4 py-3">
        <Link href="/parent" className="block">
          <span className="block font-semibold text-text">ZSMS</span>
          <span className="block text-xs text-muted-text">Parent portal</span>
        </Link>
      </div>
      <nav aria-label="Parent sections" className="flex-1 px-2 py-3">
        <ul className="space-y-0.5">
          {links.map(({ href, label, icon: Icon, active }) => (
            <li key={label}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-primary-tint text-primary-text'
                    : 'text-muted-text hover:bg-neutral-tint hover:text-text',
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                <span className="truncate">{label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  )
}

function BottomTabs(): JSX.Element {
  const links = useLinks()

  return (
    <nav
      aria-label="Parent sections"
      /**
       * `pb-[env(safe-area-inset-bottom)]` keeps the tabs above the home indicator on an
       * iPhone. Without it the last few pixels of the row sit under the system gesture area and
       * the tap lands on the wrong thing.
       */
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="flex">
        {links.map(({ href, label, icon: Icon, active }) => {
          // The centre tab, drawn larger. Identified by its label rather than its index so
          // reordering the array cannot silently enlarge the wrong one.
          const isHome = label === 'Home'

          return (
            <li key={label} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-tap flex-col items-center justify-center gap-1 text-xs font-medium transition-colors',
                  isHome ? 'py-1.5' : 'py-2',
                  active ? 'text-primary-text' : 'text-muted-text',
                )}
              >
                <span
                  className={cn(
                    'flex items-center justify-center transition-colors',
                    // A filled circle only on Home, so the thumb has a target rather than a
                    // glyph. It stays tinted when inactive: the point is that it is always
                    // findable, not that it is always selected.
                    isHome && 'size-9 rounded-full',
                    isHome && (active ? 'bg-primary text-primary-foreground' : 'bg-muted'),
                  )}
                >
                  <Icon
                    className={cn(
                      isHome ? 'size-5' : 'size-5',
                      active && !isHome && 'text-primary',
                    )}
                    aria-hidden
                  />
                </span>
                <span className={cn(isHome && 'font-semibold')}>{label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export function ParentShell({
  children,
  headerActions,
}: {
  children: ReactNode
  headerActions?: ReactNode
}): JSX.Element {
  return (
    <div className="min-h-dvh bg-background">
      {/* `useSearchParams` needs a Suspense boundary or the whole route opts out of static
          rendering with a build-time warning. */}
      <Suspense fallback={null}>
        <DesktopSidebar />
      </Suspense>

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur">
          <div className="flex items-center gap-3 px-gutter py-3">
            <Link href="/parent" className="font-semibold text-text lg:hidden">
              ZSMS
            </Link>

            {/*
              In the SHELL, not on each page.

              The child picker was on three screens out of five — fees and notices had
              none — and `/parent/schools` was unreachable because nothing linked to it. A
              parent reading one child's fees had to return to the dashboard to change
              child, and could not get back to the school list at all. Here it is on every
              parent screen, including any added later.
            */}
            <ChildSwitcher />

            <div className="ml-auto flex items-center gap-2">{headerActions}</div>
          </div>
        </header>

        {/* `pb-20` on small screens so the last row of content is not hidden behind the tabs. */}
        <main id="main" className="mx-auto max-w-5xl px-gutter py-cards pb-20 lg:pb-cards">
          {children}
        </main>
      </div>

      <Suspense fallback={null}>
        <BottomTabs />
      </Suspense>
    </div>
  )
}
