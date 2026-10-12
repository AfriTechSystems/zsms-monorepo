'use client'

/**
 * Recent activity, as sentences.
 *
 * Spec: reference images W1 and W3; migration `0268`.
 *
 * ## What it is not
 *
 * Not the audit trail. The audit screen is precise, complete and queryable, and must
 * stay that way — this is a dashboard panel that answers "has anything happened" at a
 * glance. `recent_activity()` does the translating; this renders it.
 *
 * It deliberately shows **fewer** rows than the audit trail: the reader's own actions
 * are excluded by the function, because a feed telling you what you just did is a
 * receipt rather than news.
 */

import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import {
  CalendarCheck,
  FileText,
  GraduationCap,
  Settings,
  UserRound,
  Wallet,
} from 'lucide-react'

import { cn } from '../../lib/utils'

interface Activity {
  id: string
  at: string
  kind: string
  title: string
  detail: string | null
  actor: string | null
}

const KIND: Record<string, { icon: typeof Wallet; tone: string }> = {
  money: { icon: Wallet, tone: 'bg-success-tint text-success-text' },
  pupil: { icon: GraduationCap, tone: 'bg-primary-tint text-primary-text' },
  staff: { icon: UserRound, tone: 'bg-accent-tint text-accent-text' },
  academic: { icon: CalendarCheck, tone: 'bg-warning-tint text-warning-text' },
  settings: { icon: Settings, tone: 'bg-neutral-tint text-neutral-text' },
  other: { icon: FileText, tone: 'bg-neutral-tint text-neutral-text' },
}

/**
 * "2h ago", "4 days ago".
 *
 * Relative rather than absolute because the panel answers "is this recent", and a
 * timestamp makes the reader do that subtraction themselves. Anything past a week
 * becomes a date, where "63 days ago" stops meaning anything.
 */
function ago(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export function ActivityFeed({ limit = 6 }: { limit?: number }): JSX.Element {
  const [rows, setRows] = useState<Activity[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const response = await fetch(`/api/activity?limit=${limit}`)
        if (!response.ok) {
          if (live) setFailed(true)
          return
        }
        const body = await response.json()
        if (live) setRows(body.data?.activity ?? [])
      } catch {
        if (live) setFailed(true)
      }
    })()
    return () => {
      live = false
    }
  }, [limit])

  if (failed) {
    /*
      Stated, not silent. A panel that vanishes on failure makes a busy school look
      quiet, which is the opposite of what it is for.
    */
    return <p className="text-sm text-muted-foreground">Recent activity is unavailable.</p>
  }

  if (rows === null) {
    return (
      <ul className="space-y-3" aria-busy="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span className="size-8 shrink-0 animate-pulse rounded-lg bg-sunken" />
            <span className="flex-1 space-y-1.5">
              <span className="block h-3 w-3/4 animate-pulse rounded bg-sunken" />
              <span className="block h-2.5 w-1/2 animate-pulse rounded bg-sunken" />
            </span>
          </li>
        ))}
      </ul>
    )
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing yet. Changes other people make will appear here.
      </p>
    )
  }

  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const k = KIND[r.kind] ?? KIND.other!
        const Icon = k.icon
        return (
          <li key={r.id} className="flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className={cn('inline-flex size-8 shrink-0 items-center justify-center rounded-lg', k.tone)}
            >
              <Icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium leading-snug">{r.title}</span>
              {r.detail ? (
                // The changed FIELDS, never the values — a dashboard panel has no
                // business repeating what may be personal data.
                <span className="block truncate text-xs text-muted-foreground">
                  Changed: {r.detail}
                </span>
              ) : null}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground" title={new Date(r.at).toLocaleString()}>
              {ago(r.at)}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
