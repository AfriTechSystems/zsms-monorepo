'use client'

/**
 * The settings hub — every settings area as a tile.
 *
 * Spec: reference image W4, which puts a row of tinted icon tiles across the top of
 *       the settings screen as its section navigation.
 *
 * ## Why a hub and not a tab row
 *
 * The image shows ten tiles acting as tabs. ZSMS has **fourteen** settings areas and
 * they are already real routes with their own screens, permissions and URLs — turning
 * them into tabs on one page would mean collapsing fourteen screens into one, losing
 * every deep link and every per-screen permission gate in the process.
 *
 * So the tiles are a **hub**: the same visual idea, pointing at the screens that exist.
 * That also solves the problem the image is really solving — finding a setting without
 * reading a sidebar of fourteen similar-sounding entries.
 *
 * ## Permission-gated to match the sidebar exactly
 *
 * Each tile carries the same `needs` key as its sidebar row, so a tile never offers
 * somebody a screen their sidebar is hiding. The keys are checked with `can()`, which
 * returns false for an **unknown** key — so a typo here hides a tile for everybody
 * rather than exposing one.
 */

import type { JSX } from 'react'
import Link from 'next/link'
import {
  BellRing,
  CalendarCheck,
  Coins,
  FileText,
  Globe,
  GraduationCap,
  KeyRound,
  ListChecks,
  Plug,
  Receipt,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react'

import { can, type Capability } from '../../../../lib/roles'
import type { Role } from '@zsms/auth-provider'

interface Tile {
  href: string
  label: string
  /** One line. What the screen is for, not what it contains. */
  blurb: string
  icon: LucideIcon
  /** A soft tint, grouped by what kind of setting it is. */
  tone: string
  needs?: Capability
}

/*
  Grouped by colour rather than ordered by name: academic settings are blue,
  money is green, access is amber, and the platform's own is neutral. A reader
  scanning for "the fees one" finds the green block before reading a word.
*/
const TILES: Tile[] = [
  { href: '/settings/readiness', label: 'Setup checklist', blurb: 'What is left before the school can run', icon: ListChecks, tone: 'bg-primary-tint text-primary-text', needs: 'settings:write' },
  { href: '/settings/grading', label: 'Grading scales', blurb: 'The boundaries marks are graded against', icon: GraduationCap, tone: 'bg-primary-tint text-primary-text', needs: 'settings:write' },
  { href: '/settings/documents', label: 'Report cards', blurb: 'What a report card shows, and its colours', icon: FileText, tone: 'bg-primary-tint text-primary-text', needs: 'settings:write' },
  { href: '/settings/fields', label: 'Pupil fields', blurb: 'Extra information you record at enrolment', icon: SlidersHorizontal, tone: 'bg-primary-tint text-primary-text', needs: 'students:write' },

  { href: '/settings/reminders', label: 'Fee reminders', blurb: 'When overdue fees are chased, and how', icon: BellRing, tone: 'bg-success-tint text-success-text', needs: 'fees:write' },
  { href: '/settings/subscription', label: 'Subscription', blurb: 'Your plan, invoices and payments', icon: Receipt, tone: 'bg-success-tint text-success-text', needs: 'fees:read' },
  { href: '/settings/credits', label: 'AI credits', blurb: 'Buy credits and assign them to teachers', icon: Coins, tone: 'bg-success-tint text-success-text', needs: 'fees:read' },
  { href: '/settings/integrations', label: 'Connections', blurb: 'Accounting exports and webhooks', icon: Plug, tone: 'bg-success-tint text-success-text', needs: 'fees:write' },

  { href: '/settings/roles', label: 'Staff roles', blurb: 'What each role may do', icon: ShieldCheck, tone: 'bg-warning-tint text-warning-text', needs: 'settings:write' },
  { href: '/settings/permissions', label: 'Permission grants', blurb: 'Temporary access while somebody is away', icon: KeyRound, tone: 'bg-warning-tint text-warning-text', needs: 'settings:write' },
  { href: '/settings/api-keys', label: 'API keys', blurb: 'Let another system read your data', icon: KeyRound, tone: 'bg-warning-tint text-warning-text', needs: 'settings:write' },
  { href: '/settings/attendance-alerts', label: 'Attendance alerts', blurb: 'Whether an absence messages a parent', icon: CalendarCheck, tone: 'bg-warning-tint text-warning-text', needs: 'settings:write' },

  { href: '/settings/public-profile', label: 'Public listing', blurb: 'How your school appears to parents', icon: Globe, tone: 'bg-neutral-tint text-neutral-text' },
  { href: '/settings/audit', label: 'Audit trail', blurb: 'Who changed what, and when', icon: ScrollText, tone: 'bg-neutral-tint text-neutral-text', needs: 'settings:write' },
]

export function SettingsHub({ base, role }: { base: string; role: string | undefined }): JSX.Element | null {
  const visible = TILES.filter((t) => !t.needs || can(role as Role | undefined, t.needs))

  // Everything filtered out. A heading over nothing is worse than no section.
  if (visible.length === 0) return null

  return (
    <section aria-labelledby="settings-areas" className="mb-cards">
      <h2 id="settings-areas" className="sr-only">
        Settings areas
      </h2>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {visible.map((t) => {
          const Icon = t.icon
          return (
            <Link
              key={t.href}
              href={`${base}${t.href}`}
              className="group flex min-h-tap flex-col gap-2 rounded-lg border border-border bg-surface p-card transition-all hover:-translate-y-0.5 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                aria-hidden="true"
                className={`inline-flex size-9 items-center justify-center rounded-lg ${t.tone}`}
              >
                <Icon className="size-4.5" />
              </span>
              <span className="text-sm font-medium leading-snug">{t.label}</span>
              {/* Hidden on the narrowest screens: at two tiles per row the blurb
                  doubles each tile's height and the grid stops being scannable. */}
              <span className="hidden text-xs leading-snug text-muted-foreground sm:block">
                {t.blurb}
              </span>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
