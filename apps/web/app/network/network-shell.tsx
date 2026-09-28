'use client'

/**
 * The School Network sidebar.
 *
 * ## One item today, and that is honest rather than lazy
 *
 * The network portal has a single screen. A sidebar with one link is close to pointless, and the
 * tempting alternatives were both worse: keep the old top header and have a network owner meet a
 * different navigation pattern in every school they open, or invent sections for screens that do
 * not exist.
 *
 * So it takes the shared shell — same chrome, same mobile drawer, same collapse — and grows a
 * group at a time. The drill-down into a single school stays in the header as the school switcher,
 * because it is a *context change* rather than a destination: it takes the reader out of the
 * network portal entirely.
 */

import type { JSX, ReactNode } from 'react'
import { Building2 } from 'lucide-react'

import { AppShell } from '../../components/layout/app-shell'
import type { NavGroup } from '../../components/layout/nav-config'

export function NetworkShell({
  children,
  headerActions,
}: {
  children: ReactNode
  headerActions?: ReactNode
}): JSX.Element {
  const groups: NavGroup[] = [
    {
      label: null,
      items: [{ path: '', label: 'All schools', icon: Building2, exact: true }],
    },
  ]

  return (
    <AppShell
      base="/network"
      title="ZSMS Network"
      subtitle="All your schools"
      groups={groups}
      headerActions={headerActions}
    >
      {children}
    </AppShell>
  )
}
