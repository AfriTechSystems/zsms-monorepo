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
import { ArrowRight, ChevronDown, ChevronRight, Lock, Rocket, X } from 'lucide-react'

import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
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
    Dismissed, not merely collapsed.

    Collapsing still left a full card sitting above the figures, and a head teacher who
    has read the checklist once does not need it occupying the top of the dashboard
    every morning. Dismissal is remembered per browser and per school.

    It is keyed by HOW MANY required steps remain, so the banner returns by itself when
    a new blocking item appears — dismissing it can never hide something that newly
    stops the school working.
  */
  const [dismissedAt, setDismissedAt] = useState<string | null>(null)

  /*
    Read after mount, never during render.

    `localStorage` does not exist on the server, so reading it in the initial state
    would make the first client render disagree with the server's. It can also throw in
    a private window, so the read is wrapped and a failure simply leaves it open.
  */
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === '1')
      setDismissedAt(window.localStorage.getItem(`${STORAGE_KEY}.dismissed`))
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

  const dismiss = (): void => {
    const stamp = `${required.length}:${outstanding.length}`
    setDismissedAt(stamp)
    try {
      window.localStorage.setItem(`${STORAGE_KEY}.dismissed`, stamp)
    } catch {
      /* Not worth interrupting anybody over a remembered preference. */
    }
  }

  // Nothing left the school can act on. The checklist stays in Settings for later.
  if (!data || outstanding.length === 0) return null

  /*
    Still dismissed only while the work is unchanged. A new required step changes the
    stamp, the comparison fails, and the banner comes back.
  */
  if (dismissedAt === `${required.length}:${outstanding.length}`) return null

  return (
    /*
      A banner, not a card.

      This used to be a full `Card` with card padding, a heading row, a progress bar and
      a five-item list — taller than the stat row beneath it, on a dashboard whose job is
      the figures. It is now one line at rest: icon, sentence, count, progress, actions.

      Everything it did still works. The list is behind the chevron, the required count
      is still visible when collapsed, and the progress bar is still the one-line summary
      — it has just stopped being the largest thing on the page.
    */
    <div className="rounded-lg border border-border bg-primary-tint px-card py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Rocket aria-hidden="true" className="size-4 shrink-0 text-primary-text" />

        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          className="flex min-h-tap items-center gap-2 text-left"
        >
          <span className="text-sm font-medium text-primary-text">Finish setting up</span>
          <span className="text-sm text-primary-text/80">
            <span data-numeric>{data.complete}</span> of{' '}
            <span data-numeric>{data.total}</span>
          </span>
          {collapsed ? (
            <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-primary-text/70" />
          ) : (
            <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-primary-text/70" />
          )}
        </button>

        {/* Visible even when collapsed: a school cannot enrol anybody until these are
            done, and that should not be hidden behind a chevron. */}
        {required.length > 0 && (
          <Badge variant="danger">
            <Lock aria-hidden="true" className="size-3" />
            {required.length} required
          </Badge>
        )}

        {/* The bar is the whole summary in one line, so it sits inline rather than
            taking a row of its own. */}
        <div
          className="h-1.5 min-w-[80px] flex-1 overflow-hidden rounded-full bg-surface/60"
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

        <Button asChild size="sm" variant="outline">
          <Link href={`${base}/settings/readiness`}>
            Open checklist
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </Button>

        {/*
          Dismiss is offered only when nothing is REQUIRED.

          A school can put off optional setup; it cannot be allowed to hide the steps
          that stop a register being marked. Hiding those would turn a visible blocker
          into a mystery.
        */}
        {required.length === 0 && (
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss the setup reminder"
            className="flex size-8 min-h-tap items-center justify-center rounded-md text-primary-text/70 transition-colors hover:bg-surface/60 hover:text-primary-text"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        )}
      </div>

      {!collapsed && (
        <ul className="mt-2 flex flex-col gap-0.5 border-t border-border/60 pt-2">
          {outstanding.slice(0, 5).map((item) => {
            const destination = STEP_DESTINATIONS[item.out_item_key]
            const href = destination
              ? `${base}${destination.href}${destination.tab ? `?section=${destination.tab}` : ''}`
              : `${base}/settings/readiness`

            return (
              <li key={item.out_item_key}>
                <Link
                  href={href}
                  className="flex min-h-tap flex-wrap items-center gap-2 rounded-md px-1 text-sm transition-colors hover:bg-surface/60"
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
      )}
    </div>
  )
}
