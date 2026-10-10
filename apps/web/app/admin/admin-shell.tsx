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
  Banknote,
  BookMarked,
  Building2,
  Gauge,
  HeartPulse,
  Network,
  PhoneCall,
  Receipt,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  Siren,
  SlidersHorizontal,
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
  const [overdueOutreach, setOverdueOutreach] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const response = await fetch('/api/admin/incidents?status=open&limit=1')
        if (!response.ok) return
        const body = (await response.json()) as { meta?: { total?: number } }
        if (!cancelled) setOpenIncidents(body.meta?.total ?? 0)

        /**
         * The overdue-outreach count, on the same timer. Fetched here rather than on the screen
         * itself because the point of the badge is to be seen from anywhere in the panel — a
         * school going past its window while somebody is reading an invoice is exactly the case
         * the rule exists for.
         *
         * Null when the request fails, which renders nothing. A nav that breaks because a count
         * did is worse than a nav with no count.
         */
        const outreach = await fetch('/api/admin/onboarding?view=overdue')
        if (outreach.ok) {
          const rows = (await outreach.json()) as { data?: unknown[] }
          if (!cancelled) setOverdueOutreach(rows.data?.length ?? 0)
        }
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

  /**
   * Grouped by what AfriTech is DOING, not by which table a screen reads.
   *
   * "Commercial" became "Revenue" because it said what the group was about rather than what it
   * was for, and per-student pricing now has a home a person would look in — it had none at all,
   * so the pricing model intended for most schools was configurable only by SQL.
   */
  const groups: NavGroup[] = [
    {
      label: null,
      items: [{ path: '', label: 'Overview', icon: Gauge, exact: true }],
    },
    {
      // Who AfriTech sells to. The thing most sessions start by looking up.
      label: 'Customers',
      items: [
        { path: '/schools', label: 'Schools', icon: Building2 },
        // Above networks and the Hub because it is the only row here with a clock on it: the
        // 24-hour outreach rule is the difference between a school that converts and one that
        // lets its trial lapse.
        { path: '/onboarding', label: 'Onboarding', icon: PhoneCall, badge: overdueOutreach },
        { path: '/networks', label: 'School networks', icon: Network },
        { path: '/teacher-hub', label: 'Teacher Hub', icon: Sparkles },
      ],
    },
    {
      // What is actively going wrong. Above Revenue because an open incident is urgent and an
      // invoice is not.
      label: 'Operations',
      items: [
        { path: '/health', label: 'School health', icon: HeartPulse },
        { path: '/incidents', label: 'Incidents', icon: Siren, badge: openIncidents },
        // ZDPA requests are AfriTech's obligation, not a school's, and carry a
        // 30-day clock — which is why they sit beside incidents rather than in
        // settings somewhere.
        { path: '/data-requests', label: 'Data requests', icon: ShieldAlert },
        // The trail has been written since `0131` and nothing has ever read it.
        { path: '/audit', label: 'Audit trail', icon: ScrollText },
        /*
          The AfriTech team and what each platform role may do (ROLES.md).

          Under Operations rather than its own group: it is read-mostly reference, and
          only the scope form at the bottom is a super admin's to use — which the page
          itself hides for everybody else.
        */
        { path: '/team', label: 'Team & roles', icon: ShieldCheck },
      ],
    },
    {
      label: 'Revenue',
      items: [
        { path: '/billing', label: 'Invoices & billing', icon: Receipt },
        { path: '/pricing', label: 'Plans & pricing', icon: Wallet },
        /*
          The loan queue and its partners, under Revenue because that is what they are
          to AfriTech: origination commission, not a school feature.
        */
        { path: '/loans', label: 'Loan applications', icon: Banknote },
        { path: '/lenders', label: 'Lending partners', icon: Building2 },
        { path: '/features', label: 'Feature matrix', icon: ToggleRight },
        /*
          Every platform-wide switch, in one place.

          The AI toggle lived on its own page for a day. Toggles were going to keep
          arriving — payment gateways, the loan module — and one place to look is worth
          more than each being perfectly sited.
        */
        { path: '/settings', label: 'Platform settings', icon: SlidersHorizontal },
      ],
    },
    {
      // The AI's grounding and its running cost. Operational rather than commercial: an empty
      // curriculum store does not stop generation, it makes it ungrounded and uncited.
      label: 'AI',
      items: [
        { path: '/curriculum', label: 'Curriculum', icon: BookMarked },
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
