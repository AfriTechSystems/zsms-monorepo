'use client'

/**
 * Unread notices, in the top bar of every portal.
 *
 * Spec: `Official Documentation/12 Communication System/ANNOUNCEMENTS.md`
 *
 * ## Why it exists
 *
 * Announcements were reachable only by navigating to a page and looking. A notice
 * nobody goes looking for is one nobody reads, and "important" notices are exactly the
 * ones a school needs read today — a closure tomorrow, fees due on Friday.
 *
 * ## One component, two endpoints
 *
 * A parent's notices resolve through their children; everybody else's resolve through
 * their school and role. Those are genuinely different questions and already have
 * separate routes, so the endpoint is a prop. The payload shape is identical, which is
 * what makes one component honest rather than a pair of branches pretending to be one.
 *
 * ## Opening marks read
 *
 * Not a separate button. Somebody who has opened and read a notice has read it, and
 * asking them to confirm is asking them to do the system's bookkeeping. The receipt
 * matters because an unread important notice is what escalates to WhatsApp later.
 */

import type { JSX } from 'react'
import { useCallback, useState } from 'react'
import Link from 'next/link'
import { Bell } from 'lucide-react'

import { Badge } from './badge'
import { apiSend, useApi } from '../../lib/use-api'
import { usePopover } from '../../lib/use-popover'

interface Notice {
  id: string
  title: string
  body: string
  importance: string
  sent_at: string | null
  read: boolean
}

export function NotificationBell({
  endpoint,
  allHref,
}: {
  /** `/api/session/notices` for staff, `/api/parent/notices` for a parent. */
  endpoint: string
  /** Where "See all" goes. Omitted when the portal has no notices screen. */
  allHref?: string
}): JSX.Element {
  const { data, reload } = useApi<{ notices: Notice[]; unread: number }>(endpoint)
  // Marked locally the moment one is opened, so the badge clears immediately rather
  // than after a round trip on a slow link.
  const [locallyRead, setLocallyRead] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<string | null>(null)
  /*
    `role="dialog"` here rather than `menu` — it holds prose and links, not commands —
    but it is NOT modal: the page behind it stays live and Tab walks out of it. See
    `use-popover.ts` for why that is the correct behaviour and not a missing trap.
  */
  const { open, setOpen, wrapRef, triggerProps, panelProps } = usePopover('dialog')

  const openNotice = useCallback(
    (notice: Notice) => {
      setExpanded((cur) => (cur === notice.id ? null : notice.id))
      if (notice.read || locallyRead.has(notice.id)) return
      setLocallyRead((s) => new Set(s).add(notice.id))
      // Fire and forget. A failed receipt is not worth interrupting somebody reading a
      // notice — the worst case is one unnecessary reminder later.
      void apiSend(endpoint, 'POST', { announcementId: notice.id }).catch(() => {})
    },
    [endpoint, locallyRead],
  )

  const notices = data?.notices ?? []
  const unread = notices.filter((n) => !n.read && !locallyRead.has(n.id)).length

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        {...triggerProps}
        onClick={() => {
          triggerProps.onClick()
          if (!open) reload()
        }}
        aria-label={unread > 0 ? `Notices, ${unread} unread` : 'Notices'}
        className="relative inline-flex min-h-tap min-w-tap items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Bell aria-hidden="true" className="size-5" />
        {unread > 0 && (
          <span
            data-numeric
            aria-hidden="true"
            className="absolute right-1 top-1 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] font-semibold leading-4 text-white"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notices"
          {...panelProps}
          className="absolute right-0 top-full z-popover mt-1 max-h-[70vh] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-border bg-card shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-border p-stack">
            <p className="font-medium">Notices</p>
            {allHref && (
              <Link
                href={allHref}
                onClick={() => setOpen(false)}
                className="text-sm font-medium text-primary-text hover:underline"
              >
                See all
              </Link>
            )}
          </div>

          {notices.length === 0 ? (
            <p className="p-card text-sm text-muted-foreground">
              Nothing yet. Notices from your school appear here.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {notices.slice(0, 8).map((n) => {
                const isRead = n.read || locallyRead.has(n.id)
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openNotice(n)}
                      className="flex w-full flex-col gap-0.5 p-stack text-left transition-colors hover:bg-muted"
                    >
                      <span className="flex items-start gap-1.5">
                        {/* Unread carries weight, so a glance down the list finds it. */}
                        {!isRead && (
                          <span
                            aria-hidden="true"
                            className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
                          />
                        )}
                        <span className={`text-sm ${isRead ? '' : 'font-semibold'}`}>
                          {n.title}
                        </span>
                        {n.importance === 'important' && (
                          <Badge variant="warning" className="ml-auto shrink-0">
                            Important
                          </Badge>
                        )}
                      </span>

                      <span
                        className={`text-sm text-muted-foreground ${
                          expanded === n.id ? '' : 'line-clamp-2'
                        }`}
                      >
                        {n.body}
                      </span>

                      {n.sent_at && (
                        <span className="text-sm text-subtle">
                          {new Date(n.sent_at).toLocaleDateString('en-GB', {
                            day: 'numeric',
                            month: 'short',
                          })}
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
