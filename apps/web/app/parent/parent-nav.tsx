'use client'

/**
 * Parent portal navigation.
 *
 * ## Four sections, because a parent has four questions
 *
 * Is my child at school, how are they doing, what do I owe, what has the school
 * told me. Nothing else earns a tab. A parent opens this a few times a term, not
 * daily, so every additional destination is something they have to re-learn each
 * visit.
 *
 * ## The selected child rides along
 *
 * Navigating between sections must not lose which child is being looked at —
 * having to re-pick a child on every tab is the single most irritating thing a
 * multi-child portal can do. The `childId` search param is carried on every link.
 */

import type { JSX } from 'react'
import { Suspense } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { CalendarCheck, ClipboardList, LayoutDashboard, Megaphone, Wallet } from 'lucide-react'

import { cn } from '../../lib/utils'

const LINKS = [
  { path: '', label: 'Home', icon: LayoutDashboard, exact: true },
  { path: '/attendance', label: 'Attendance', icon: CalendarCheck, exact: false },
  { path: '/results', label: 'Results', icon: ClipboardList, exact: false },
  { path: '/fees', label: 'Fees', icon: Wallet, exact: false },
  { path: '/notices', label: 'Notices', icon: Megaphone, exact: false },
] as const

function NavLinks(): JSX.Element {
  const pathname = usePathname()
  const params = useSearchParams()
  const childId = params.get('childId')

  return (
    <ul
      // Horizontal scroller rather than a sidebar: this portal is read on a phone
      // almost exclusively, and 240px of chrome on a 375px screen is most of it.
      className="flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {LINKS.map(({ path, label, icon: Icon, exact }) => {
        const href = `/parent${path}${childId ? `?childId=${childId}` : ''}`
        const target = `/parent${path}`
        const active = exact ? pathname === target : pathname.startsWith(target)

        return (
          <li key={target} className="shrink-0">
            <Link
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-tap items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon aria-hidden="true" className="size-4" />
              {label}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

export function ParentNav(): JSX.Element {
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto max-w-5xl px-gutter py-3">
        <p className="mb-2 text-sm font-semibold text-foreground">ZSMS — Parent</p>
        {/* Suspense because `useSearchParams` suspends during prerender; without
            it the whole layout would be forced dynamic. */}
        <Suspense fallback={<div className="h-tap" />}>
          <NavLinks />
        </Suspense>
      </div>
    </header>
  )
}
