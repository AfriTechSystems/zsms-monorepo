'use client'

/**
 * The school portal sidebar.
 *
 * ## Grouped by job, which is the whole reason for the change
 *
 * The previous nav was nine links in a horizontally scrolling row. Nine is past the point where
 * a flat list helps: the reader scans all of them every time because nothing signals which
 * three concern money and which three concern academics. The groups below are named for the
 * work, so an administrator chasing arrears looks in one place.
 *
 * ## The permission filter is unchanged, deliberately
 *
 * `can(role, capability)` from `lib/roles` still decides what appears, item by item. This is a
 * courtesy rather than a control — every route and every policy enforces access independently —
 * but showing a teacher a Fees link that 403s is a worse product than not showing it.
 *
 * A group whose every item is filtered out renders nothing at all, heading included. Otherwise
 * a teacher would see an empty "Money" heading, which is a worse signal than absence: it says
 * something is here that you cannot have.
 */

import type { JSX, ReactNode } from 'react'
import {
  CalendarCheck,
  ClipboardList,
  FileSpreadsheet,
  GraduationCap,
  LayoutDashboard,
  Megaphone,
  Receipt,
  SlidersHorizontal,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react'

import type { Role } from '@zsms/auth-provider'

import { AppShell } from '../../../components/layout/app-shell'
import type { NavGroup } from '../../../components/layout/nav-config'
import { can } from '../../../lib/roles'

export function SchoolShell({
  base,
  schoolName,
  roleLabel,
  role,
  children,
  headerActions,
}: {
  base: string
  schoolName: string
  roleLabel: string
  role: Role
  children: ReactNode
  headerActions?: ReactNode
}): JSX.Element {
  const groups: NavGroup[] = [
    {
      label: null,
      items: [{ path: '', label: 'Dashboard', icon: LayoutDashboard, exact: true }],
    },
    {
      label: 'People',
      items: [
        { path: '/students', label: 'Pupils', icon: Users, needs: 'students:read' },
        { path: '/staff', label: 'Staff', icon: UserCog, needs: 'staff:read' },
        {
          path: '/teaching',
          label: 'Teaching assignments',
          icon: GraduationCap,
          exact: true,
          needs: 'assignments:read',
        },
      ],
    },
    {
      label: 'Teaching',
      items: [
        // A teacher's own scope, first in the group they will use daily.
        { path: '/teaching/my', label: 'My teaching', icon: GraduationCap, needs: 'teaching:own' },
        { path: '/attendance', label: 'Attendance', icon: CalendarCheck, needs: 'attendance:read' },
        { path: '/results', label: 'Results', icon: ClipboardList, needs: 'results:read' },
      ],
    },
    {
      // Named for what it is, not for the tables under it. "Fees & Payments & Invoices" is
      // three words for one job.
      label: 'Money',
      items: [
        { path: '/fees', label: 'Fees', icon: Wallet, needs: 'fees:read' },
        /**
         * Gated on `fees:read` rather than an administrative capability, because there is no
         * `school:manage` in `lib/roles` — an earlier draft of this file invented one and did
         * not compile. The school's own subscription is money, so the money capability is the
         * honest gate rather than the nearest-sounding one.
         */
        { path: '/settings/subscription', label: 'Subscription', icon: Receipt, needs: 'fees:read' },
      ],
    },
    {
      label: 'Communicate',
      items: [
        { path: '/announcements', label: 'Announcements', icon: Megaphone },
      ],
    },
    {
      label: 'Settings',
      // Collapsed by default: configuration is set up once and visited rarely, so it should not
      // occupy the reader's attention every day.
      defaultCollapsed: true,
      items: [
        // Defining what is recorded about a pupil is a pupil-write act.
        { path: '/settings/fields', label: 'Pupil fields', icon: SlidersHorizontal, needs: 'students:write' },
        { path: '/students/import', label: 'Bulk import', icon: FileSpreadsheet, needs: 'students:write' },
      ],
    },
  ]

  // Drop items the role cannot reach, then drop any group left empty.
  const visible = groups
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.needs || can(role, i.needs)) }))
    .filter((g) => g.items.length > 0)

  return (
    <AppShell
      base={base}
      title={schoolName}
      subtitle={roleLabel}
      groups={visible}
      headerActions={headerActions}
    >
      {children}
    </AppShell>
  )
}
