'use client'

/**
 * The AfriTech admin sidebar.
 *
 * ## Why the groups live in a client component
 *
 * `NavItem.icon` is a component reference, and a React Server Component may only pass
 * serialisable props across the boundary — a function is not one. So the layout stays a server
 * component (it does the session check and the redirect) and hands `children` to this, which
 * owns the group definitions. Defining them in the layout and passing them down looks tidier
 * and fails at runtime.
 *
 * ## Open incidents are fetched here, not in the layout
 *
 * The badge has to update when an incident is raised or resolved while somebody is looking at
 * the panel. A server layout renders once per navigation, so the count would go stale until the
 * next page change — which for an alerting surface is precisely the wrong behaviour.
 */

import type { JSX, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import {
  BookMarked,
  Building2,
  Gauge,
  HeartPulse,
  Network,
  Receipt,
  Siren,
  Sparkles,
  ToggleRight,
  Wallet,
} from 'lucide-react'

import { AppShell } from '../../components/layout/app-shell'
import type { NavGroup } from '../../components/layout/nav-config'

export function AdminShell({
  children,
  headerActions,
}: {
  children: ReactNode
  headerActions?: ReactNode
}): JSX.Element {
  const [openIncidents, setOpenIncidents] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const response = await fetch('/api/admin/incidents?status=open&limit=1')
        if (!response.ok) return
        const body = (await response.json()) as { meta?: { total?: number } }
        if (!cancelled) setOpenIncidents(body.meta?.total ?? 0)
      } catch {
        // A nav that refuses to render because a badge count failed is worse than a nav with
        // no badge. Left null, which renders nothing.
      }
    }
    void load()
    /**
     * Sixty seconds. Frequent enough that a key dying is noticed within a minute, infrequent
     * enough that an admin leaving the panel open all day does not generate a request a second.
     */
    const timer = setInterval(() => void load(), 60_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const groups: NavGroup[] = [
    {
      label: null,
      items: [{ path: '', label: 'Overview', icon: Gauge, exact: true }],
    },
    {
      // What AfriTech sells to, which is the thing most sessions start by looking up.
      label: 'Customers',
      items: [
        { path: '/schools', label: 'Schools', icon: Building2 },
        { path: '/networks', label: 'Networks', icon: Network },
        { path: '/teacher-hub', label: 'Teacher Hub', icon: Sparkles },
      ],
    },
    {
      label: 'Operations',
      items: [
        { path: '/health', label: 'School health', icon: HeartPulse },
        // The badge is why this group is above Commercial: an open incident is the only thing
        // here that is actively going wrong.
        { path: '/incidents', label: 'Incidents', icon: Siren, badge: openIncidents },
      ],
    },
    {
      // The AI's grounding. Under Operations rather than Commercial because an empty curriculum
      // store is an operational problem — generation still runs, ungrounded and uncited.
      label: 'AI',
      items: [
        { path: '/curriculum', label: 'Curriculum', icon: BookMarked },
      ],
    },
    {
      label: 'Commercial',
      items: [
        { path: '/pricing', label: 'Pricing & tiers', icon: Wallet },
        { path: '/features', label: 'Features', icon: ToggleRight },
        { path: '/billing', label: 'Billing', icon: Receipt },
      ],
    },
  ]

  return (
    <AppShell
      base="/admin"
      title="AfriTech Admin"
      subtitle="ZSMS platform"
      groups={groups}
      headerActions={headerActions}
    >
      {children}
    </AppShell>
  )
}
