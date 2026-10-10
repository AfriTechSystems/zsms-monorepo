'use client'

/**
 * Parent notices — what the school has told you.
 *
 * Spec: `Official Documentation/12 Communication System/ANNOUNCEMENTS.md`
 *
 * ## Opening a notice marks it read
 *
 * Not a separate "mark as read" button. A parent who has expanded and read a
 * notice has read it, and asking them to confirm that is asking them to do the
 * system's bookkeeping. The receipt matters because an unread important notice can
 * escalate to WhatsApp — so a false unread is a WhatsApp message a parent did not
 * need, and a false read is a closure notice nobody chased.
 *
 * ## Unread first, and full text on the page
 *
 * A parent opens this having been told there is something to see. Unread notices
 * sort to the top, and the body is a `<details>` rather than a link to another
 * page — one tap, no navigation, works on a slow connection.
 */

import type { JSX } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { Megaphone } from 'lucide-react'

import { apiSend, useApi } from '../../../lib/use-api'
import { Badge } from '../../../components/ui/badge'
import { Card, CardContent } from '../../../components/ui/card'
import { EmptyState } from '../../../components/ui/empty-state'
import { ErrorState, TableSkeleton } from '../../../components/ui/data-states'
import { ParentPageHeader, shortDate } from '../parent-shared'

interface Notice {
  id: string
  title: string
  body: string
  importance: string
  target_type: string
  sent_at: string | null
  read: boolean
}

export default function ParentNoticesPage(): JSX.Element {
  const { data, loading, error, code, reload } = useApi<{ notices: Notice[]; unread: number }>(
    '/api/parent/notices',
  )

  // Read state is held locally as well as reloaded, so the badge disappears the
  // moment a notice is opened rather than after a round trip on a slow link.
  const [locallyRead, setLocallyRead] = useState<Set<string>>(new Set())

  const markRead = useCallback(
    async (id: string) => {
      if (locallyRead.has(id)) return
      setLocallyRead((prev) => new Set(prev).add(id))
      // Fire and forget, deliberately. A failed receipt is not worth interrupting
      // a parent who is reading a notice — the worst case is one unnecessary
      // WhatsApp reminder, which is far better than an error dialog over a notice
      // they have already read.
      await apiSend('/api/parent/notices', 'POST', { announcementId: id })
      reload()
    },
    [locallyRead, reload],
  )

  const sorted = useMemo(() => {
    const notices = data?.notices ?? []
    return [...notices].sort((a, b) => {
      const aRead = a.read || locallyRead.has(a.id)
      const bRead = b.read || locallyRead.has(b.id)
      if (aRead !== bRead) return aRead ? 1 : -1
      return (b.sent_at ?? '').localeCompare(a.sent_at ?? '')
    })
  }, [data?.notices, locallyRead])

  if (error) return <ErrorState message={error} code={code} onRetry={reload} />
  if (loading && !data) return <TableSkeleton rows={5} columns={2} />

  return (
    <div className="space-y-cards">
      <ParentPageHeader
        title="Notices"
        note="Notices the school has sent to parents, and to your child's grade or class. Notices sent only to staff do not appear here."
      />

      {sorted.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Megaphone}
              title="Nothing from the school yet"
              description="When the school sends a notice to parents, it appears here."
            />
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-cards">
          {sorted.map((n) => {
            const read = n.read || locallyRead.has(n.id)
            return (
              <li key={n.id}>
                <Card>
                  <CardContent>
                    <details onToggle={() => void markRead(n.id)}>
                      <summary
                        // A summary is focusable and keyboard-operable by default;
                        // `cursor-pointer` and the tap height make it usable on a
                        // phone. `list-none` removes the default marker so the
                        // layout is ours.
                        className="flex min-h-tap cursor-pointer list-none flex-wrap items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {!read && (
                          <span
                            aria-hidden="true"
                            className="size-2 shrink-0 rounded-full bg-primary"
                          />
                        )}
                        <span
                          className={
                            read ? 'font-medium text-foreground' : 'font-semibold text-foreground'
                          }
                        >
                          {n.title}
                        </span>
                        {n.importance === 'important' && <Badge variant="warning">Important</Badge>}
                        {!read && <span className="sr-only">Unread</span>}
                        <span className="ml-auto text-xs text-muted-foreground">
                          {shortDate(n.sent_at)}
                        </span>
                      </summary>
                      {/* `whitespace-pre-line` so the paragraphs a head teacher
                          typed survive. Rendering this as one block would turn a
                          structured notice into a wall. */}
                      <p className="mt-stack whitespace-pre-line text-sm text-foreground">
                        {n.body}
                      </p>
                    </details>
                  </CardContent>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
