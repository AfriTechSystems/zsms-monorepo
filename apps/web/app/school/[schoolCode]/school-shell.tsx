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
  Globe,
  GraduationCap,
  LayoutDashboard,
  Megaphone,
  Receipt,
  Cog,
  SlidersHorizontal,
  UserCog,
  Users,
  Wallet,
  Coins,
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
  /**
   * Grouped by the JOB, not by the data type — which is the correction this file is on its second
   * attempt at.
   *
   * The first version had a "Money" group holding both **Fees** and **Subscription**, on the
   * reasoning that both concern money. That is a data-model grouping, and it puts two different
   * people's work in one drawer: the bursar chases a parent's arrears, the owner pays AfriTech.
   * They are different jobs, different permissions, and different frequencies — daily against a
   * few times a year.
   *
   * So **Finance means student money and nothing else**, and the school's own subscription sits in
   * Settings with the rest of the account administration. `SCHOOL_CONFIG.md` draws the same line:
   * its Settings panel holds fee *configuration* while the fees module stays operational.
   *
   * Bulk import moved to Students for the same reason. Importing a roll is a pupil job somebody
   * does at the start of a term; it was under Settings only because it happens rarely.
   */
  const groups: NavGroup[] = [
    {
      label: null,
      items: [{ path: '', label: 'Dashboard', icon: LayoutDashboard, exact: true }],
    },
    {
      label: 'Students',
      items: [
        { path: '/students', label: 'Pupils', icon: Users, needs: 'students:read' },
        { path: '/students/import', label: 'Bulk import', icon: FileSpreadsheet, needs: 'students:write' },
      ],
    },
    {
      label: 'Staff',
      items: [
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
        // A teacher's own scope, first in the group they open every morning.
        { path: '/teaching/my', label: 'My classes', icon: GraduationCap, needs: 'teaching:own' },
        { path: '/attendance', label: 'Attendance', icon: CalendarCheck, needs: 'attendance:read' },
        { path: '/results', label: 'Results', icon: ClipboardList, needs: 'results:read' },
      ],
    },
    {
      // Student money. Nothing else belongs here.
      label: 'Finance',
      items: [
        { path: '/fees', label: 'Fees & payments', icon: Wallet, needs: 'fees:read' },
      ],
    },
    {
      label: 'Communication',
      items: [
        { path: '/announcements', label: 'Announcements', icon: Megaphone },
      ],
    },
    {
      // Account administration. Collapsed by default: set up once, visited rarely.
      label: 'Settings',
      defaultCollapsed: true,
      items: [
        /**
         * First in the group, and ungated: every member of staff can READ the school profile and
         * the term calendar. The page renders what a role cannot change as disabled rather than
         * hiding it — a teacher seeing the term dates is useful, and seeing that leadership sets
         * them is informative rather than a dead end.
         */
        { path: '/settings', label: 'School settings', icon: Cog, exact: true },
        // Defining what is recorded about a pupil is a pupil-write act.
        { path: '/settings/fields', label: 'Pupil fields', icon: SlidersHorizontal, needs: 'students:write' },
        // Outward-facing rather than internal configuration, and the only settings row a
        // parent ever sees the result of. Kept beside the others because that is where a head
        // teacher looks for it, not because it is the same kind of thing.
        { path: '/settings/public-profile', label: 'Public listing', icon: Globe },
        { path: '/settings/subscription', label: 'Subscription & billing', icon: Receipt, needs: 'fees:read' },
        // `fees:read` to see, `fees:write` to buy — gated in the route, not here. Buying
        // credits spends the school's money, so it sits with the bursar's permissions
        // rather than with the ones for editing a timetable.
        { path: '/settings/credits', label: 'AI credits', icon: Coins, needs: 'fees:read' },
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
