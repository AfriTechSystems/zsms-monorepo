'use client'

/**
 * How ready this school is, summarised on the dashboard.
 *
 * Spec: `Official Documentation/15 Super Admin and Platform/ONBOARDING.md`
 *
 * ## A summary, not the checklist
 *
 * The full list lives at `/settings/readiness`, with what each gap blocks and a link to
 * the screen that fixes it. This is the nudge: a bar, the count, what is still required,
 * and a way through. It took the whole dashboard before, which is what was reported.
 *
 * ## Collapsed is remembered, and it disappears when done
 *
 * Somebody who has read it once and is working through it does not need it open every
 * morning — but it must still be there, because the work is not finished. Collapsing is
 * per browser, like the sidebar.
 *
 * Once everything derivable is done it stops rendering entirely. The checklist stays
 * reachable from Settings, where the same details are edited later. A permanent banner
 * reading 100% is furniture.
 */

import type { JSX } from 'react'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, ChevronDown, ChevronRight, Lock, Rocket } from 'lucide-react'

import { Badge } from '../../../components/ui/badge'
import { Card, CardContent } from '../../../components/ui/card'
import { useApi } from '../../../lib/use-api'
import { STEP_DESTINATIONS } from '../../../lib/onboarding-steps'

interface Item {
  out_item_key: string
  out_label: string
  out_blocks: string | null
  out_complete: boolean
  out_from_data: boolean
  out_overridden: boolean
  out_derived: boolean
  out_mandatory: boolean
}

interface Progress {
  items: Item[]
  complete: number
  total: number
  percent: number
}

const STORAGE_KEY = 'zsms.setup-progress.collapsed'

export function SetupProgress({ base }: { base: string }): JSX.Element | null {
  const { data } = useApi<Progress>('/api/school/onboarding')
  const [collapsed, setCollapsed] = useState(false)

  /*
    Read after mount, never during render.

    `localStorage` does not exist on the server, so reading it in the initial state
    would make the first client render disagree with the server's. It can also throw in
    a private window, so the read is wrapped and a failure simply leaves it open.
  */
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === '1')
    } catch {
      /* Blocked storage: show it open, which is the safe default. */
    }
  }, [])

  const toggle = (): void => {
    setCollapsed((was) => {
      const next = !was
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
      } catch {
        /* Not worth interrupting anybody over a remembered preference. */
      }
      return next
    })
  }

  const outstanding = useMemo(
    () => (data?.items ?? []).filter((i) => !i.out_complete && i.out_derived),
    [data],
  )
  const required = useMemo(() => outstanding.filter((i) => i.out_mandatory), [outstanding])

  // Nothing left the school can act on. The checklist stays in Settings for later.
  if (!data || outstanding.length === 0) return null

  return (
    <Card>
      <CardContent className="flex flex-col gap-stack pt-card">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          className="flex min-h-tap items-center gap-2 text-left"
        >
          {collapsed ? (
            <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          )}
          <Rocket aria-hidden="true" className="size-5 shrink-0 text-primary" />
          <span className="font-semibold">Finish setting up</span>
          <span className="text-sm text-muted-foreground">
            <span data-numeric>{data.complete}</span> of{' '}
            <span data-numeric>{data.total}</span>
          </span>
          {/* Visible even when collapsed: a school cannot enrol anybody until these are
              done, and that should not be hidden behind a chevron. */}
          {required.length > 0 && (
            <Badge variant="danger" className="ml-auto">
              <Lock aria-hidden="true" className="size-3" />
              {required.length} required
            </Badge>
          )}
        </button>

        {/* The bar stays visible when collapsed — it is the whole summary in one line. */}
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-sunken"
          role="progressbar"
          aria-valuenow={data.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="School setup progress"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500"
            style={{ width: `${data.percent}%` }}
          />
        </div>

        {!collapsed && (
          <>
            <ul className="flex flex-col gap-1">
              {outstanding.slice(0, 5).map((item) => {
                const destination = STEP_DESTINATIONS[item.out_item_key]
                const href = destination
                  ? `${base}${destination.href}${destination.tab ? `?section=${destination.tab}` : ''}`
                  : `${base}/settings/readiness`

                return (
                  <li key={item.out_item_key}>
                    <Link
                      href={href}
                      className="flex min-h-tap flex-wrap items-center gap-2 rounded-md px-1 text-sm transition-colors hover:bg-muted"
                    >
                      <span className="font-medium">{item.out_label}</span>
                      {item.out_mandatory && <Badge variant="danger">Required</Badge>}
                      {item.out_blocks && (
                        <Badge variant="warning">blocks {item.out_blocks.toLowerCase()}</Badge>
                      )}
                      <ArrowRight
                        aria-hidden="true"
                        className="ml-auto size-4 shrink-0 text-primary-text"
                      />
                    </Link>
                  </li>
                )
              })}
            </ul>

            <Link
              href={`${base}/settings/readiness`}
              className="inline-flex min-h-tap items-center gap-1.5 self-start text-sm font-medium text-primary-text hover:underline"
            >
              {outstanding.length > 5
                ? `See all ${outstanding.length} outstanding`
                : 'See the full checklist'}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  )
}
