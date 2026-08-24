'use client'

/**
 * School portal navigation.
 *
 * Same horizontal scroller as the admin nav, and for the same reason: a sidebar
 * spends 240px of a 375px screen on chrome, and this portal is genuinely used on
 * phones — a principal checking today's absences between lessons, an accountant
 * confirming a payment at the gate.
 *
 * ## Links are filtered by role, not disabled by it
 *
 * A greyed-out "Fees" tab tells a teacher there is a fees section and they are
 * not trusted with it. Omitting it tells them nothing, which is the correct
 * amount to tell them. `lib/roles.ts` holds the mapping and explains why it is
 * a courtesy rather than a boundary — RLS still refuses the data if someone
 * types the URL.
 */

import type { JSX } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  CalendarCheck,
  GraduationCap,
  LayoutDashboard,
  Megaphone,
  Users,
  UserCog,
  Wallet,
} from 'lucide-react'

import type { Role } from '@zsms/auth-provider'

import { can, type Capability } from '../../../lib/roles'
import { cn } from '../../../lib/utils'

interface NavLink {
  path: string
  label: string
  icon: typeof Users
  exact: boolean
  /** Omitted from the nav unless the role holds this. `null` = always shown. */
  needs: Capability | null
}

const LINKS: readonly NavLink[] = [
  { path: '', label: 'Dashboard', icon: LayoutDashboard, exact: true, needs: null },
  { path: '/students', label: 'Pupils', icon: Users, exact: false, needs: 'students:read' },
  { path: '/staff', label: 'Staff', icon: UserCog, exact: false, needs: 'staff:read' },
  { path: '/fees', label: 'Fees', icon: Wallet, exact: false, needs: 'fees:read' },
  { path: '/attendance', label: 'Attendance', icon: CalendarCheck, exact: false, needs: 'attendance:read' },
  { path: '/results', label: 'Results', icon: GraduationCap, exact: false, needs: 'results:read' },
  { path: '/announcements', label: 'Announcements', icon: Megaphone, exact: false, needs: null },
]

export function SchoolNav({ base, role }: { base: string; role: Role }): JSX.Element {
  const pathname = usePathname()
  const visible = LINKS.filter((l) => l.needs === null || can(role, l.needs))

  return (
    <nav aria-label="School sections" className="mx-auto max-w-7xl px-gutter">
      {/* Scrolls rather than wraps: a wrapped nav changes the header height
          between screens, which moves content under the reader's cursor.

          `snap-x` plus the edge mask are what stop it reading as "cut off". A
          plain overflow scroller ends mid-word at the viewport edge with nothing
          to say it continues, so on a phone the last tabs look missing rather
          than off-screen. The fade makes the truncation legible, and snapping
          means a swipe lands on a tab instead of halfway across one. Removed
          from `sm` up, where everything fits and a fade would be noise. */}
      <ul
        className={cn(
          '-mb-px flex snap-x snap-mandatory gap-1 overflow-x-auto',
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          '[mask-image:linear-gradient(to_right,transparent_0,black_14px,black_calc(100%-14px),transparent_100%)]',
          'sm:[mask-image:none]',
        )}
      >
        {visible.map(({ path, label, icon: Icon, exact }) => {
          const href = `${base}${path}`
          const active = exact ? pathname === href : pathname.startsWith(href)

          return (
            <li key={href} className="shrink-0 snap-start">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
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
