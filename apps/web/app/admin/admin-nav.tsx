'use client'

/**
 * Admin navigation.
 *
 * A horizontal scroller rather than a sidebar. Five destinations do not justify
 * spending 240px of a 375px screen on chrome, and an operator on a phone chasing
 * a churn alert needs the content, not the map.
 *
 * `aria-current="page"` carries the active state, not the colour. The underline
 * and weight change are the visible signal; the attribute is what a screen
 * reader announces.
 */

import type { JSX } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Building2, Gauge, HeartPulse, ToggleRight, Wallet } from 'lucide-react'

import { cn } from '../../lib/utils'

const LINKS = [
  { href: '/admin', label: 'Overview', icon: Gauge, exact: true },
  { href: '/admin/schools', label: 'Schools', icon: Building2, exact: false },
  { href: '/admin/health', label: 'Health', icon: HeartPulse, exact: false },
  { href: '/admin/features', label: 'Features', icon: ToggleRight, exact: false },
  { href: '/admin/pricing', label: 'Pricing', icon: Wallet, exact: false },
] as const

export function AdminNav(): JSX.Element {
  const pathname = usePathname()

  return (
    <nav aria-label="Admin sections" className="mx-auto max-w-7xl px-gutter">
      {/* Scrolls rather than wraps: a wrapped nav changes the header height
          between screens, which moves the content under a reader's cursor. */}
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {LINKS.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href)

          return (
            <li key={href} className="shrink-0">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  // min-h-tap, not h-tap: the row is already taller than 44px,
                  // and this guarantees the hit area without fixing the height.
                  'inline-flex min-h-tap items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'border-primary text-primary-text'
                    : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
                )}
              >
                <Icon aria-hidden="true" className="size-4 shrink-0" />
                {label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
