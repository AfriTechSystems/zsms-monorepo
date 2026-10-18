/**
 * The notices list, for both portals.
 *
 * Spec: `Official Documentation/19 Design System/ZSMS Parent Dashboard Showcase.png`
 *         — the "Notifications & Messages" panel
 *       `Official Documentation/12 Communication System/ANNOUNCEMENTS.md`
 *
 * ## Why one component and not two screens
 *
 * `(parent)/notices` and `(teacher)/notices` were about a hundred and sixty lines
 * each doing the same thing against the same shape — the only real difference was
 * the endpoint the read receipt is posted to. Two copies meant the redesign had to be
 * applied twice and, more to the point, that the next change to how a notice reads
 * would land on one portal and not the other.
 *
 * What differs stays a prop: the endpoint, and the empty-state wording, because "your
 * school" and "your school's office" are not the same sentence to a teacher.
 *
 * ## The filter is All / Unread / Important
 *
 * The reference design's three tabs are All / Notices / Messages. There is no message
 * category in this data — both endpoints return announcements and nothing else — so a
 * Messages tab would either always be empty or, worse, imply a channel somebody might
 * sit waiting on. These three filter what is actually here, and Unread is the question
 * most people open this screen to answer.
 *
 * ## Read receipts are fire-and-forget
 *
 * A failed receipt is not worth interrupting somebody mid-sentence; the worst case is
 * one unnecessary reminder later. The unread state is held locally the moment a notice
 * is opened, so the count drops as they read rather than only after a refetch.
 */

import type { JSX } from 'react'
import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { CircleAlert, Megaphone } from 'lucide-react-native'

import { api } from '../lib/api'
import { RADIUS, SPACE, TYPE } from '../theme'
import { Badge, Caption, Empty, Row, usePalette } from './ui'
import { IconTile, Segmented } from './shell'

export interface Notice {
  id: string
  title: string
  body: string
  importance: string
  sent_at: string | null
  read: boolean
}

export function NoticeList({
  notices,
  endpoint,
  getToken,
  emptyTitle,
  emptyBody,
}: {
  notices: Notice[]
  /** Where the read receipt is posted. The one thing the two portals differ on. */
  endpoint: string
  getToken: () => Promise<string | null>
  emptyTitle: string
  emptyBody: string
}): JSX.Element {
  const c = usePalette()
  const [filter, setFilter] = useState<'all' | 'unread' | 'important'>('all')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [locallyRead, setLocallyRead] = useState<Set<string>>(new Set())

  const openNotice = useCallback(
    (id: string, alreadyRead: boolean) => {
      setOpen((s) => {
        const next = new Set(s)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })

      if (alreadyRead || locallyRead.has(id)) return
      setLocallyRead((s) => new Set(s).add(id))
      void api.post(endpoint, getToken, { announcementId: id }).catch(() => {})
    },
    [endpoint, getToken, locallyRead],
  )

  if (notices.length === 0) {
    return <Empty icon={Megaphone} title={emptyTitle} body={emptyBody} />
  }

  const unreadCount = notices.filter((n) => !n.read && !locallyRead.has(n.id)).length

  const visible = notices.filter((n) => {
    if (filter === 'unread') return !n.read && !locallyRead.has(n.id)
    if (filter === 'important') return n.importance === 'important' || n.importance === 'urgent'
    return true
  })

  return (
    <View style={{ gap: SPACE.md }}>
      <Segmented
        options={[
          { value: 'all', label: 'All' },
          { value: 'unread', label: `Unread${unreadCount > 0 ? ` (${unreadCount})` : ''}` },
          { value: 'important', label: 'Important' },
        ]}
        value={filter}
        onChange={setFilter}
      />

      {/* A filter matching nothing is not the same as having no notices, and the empty
          state above would be a lie here. */}
      {visible.length === 0 && (
        <Text style={[TYPE.body, { color: c.textMuted }]}>
          {filter === 'unread'
            ? 'You have read everything. Switch to All to see them again.'
            : 'Nothing marked important. Switch to All to see everything.'}
        </Text>
      )}

      {visible.map((n) => {
        const isRead = n.read || locallyRead.has(n.id)
        const expanded = open.has(n.id)
        const urgent = n.importance === 'urgent'
        const important = n.importance === 'important'

        return (
          <Pressable
            key={n.id}
            accessibilityRole="button"
            accessibilityLabel={`${n.title}${isRead ? '' : ', unread'}`}
            onPress={() => openNotice(n.id, n.read)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              gap: SPACE.md,
              padding: SPACE.card,
              borderRadius: RADIUS.lg,
              backgroundColor: c.surface,
              borderWidth: StyleSheet.hairlineWidth,
              // Unread carries weight, so a glance down the list finds it.
              borderColor: isRead ? c.border : c.primary,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            {/*
              An icon per notice, as the mockup has it — keyed to IMPORTANCE, which is
              what the data carries. The mockup draws a different picture per subject
              (a chart for results, a wallet for fees); inferring those from a title
              string would put a wallet beside a notice about sports day often enough
              to be worse than one honest symbol.
            */}
            <IconTile
              icon={urgent ? CircleAlert : Megaphone}
              tone={urgent ? 'danger' : important ? 'warning' : 'primary'}
            />

            <View style={{ flex: 1, gap: 2 }}>
              <Row gap={SPACE.sm}>
                <Text
                  style={[
                    TYPE.heading,
                    { flex: 1, color: c.text, fontWeight: isRead ? '500' : '700' },
                  ]}
                  numberOfLines={expanded ? undefined : 1}
                >
                  {n.title}
                </Text>
                {/* A dot, not a "New" badge. At this size a word competes with the
                    title it is meant to annotate. */}
                {!isRead && (
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: RADIUS.full,
                      backgroundColor: c.danger,
                    }}
                  />
                )}
              </Row>

              {n.sent_at && (
                <Caption>
                  {new Date(n.sent_at).toLocaleDateString('en-ZM', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </Caption>
              )}

              <Text
                numberOfLines={expanded ? undefined : 2}
                style={[TYPE.body, { color: c.textMuted }]}
              >
                {n.body}
              </Text>

              {important && !urgent && (
                <View style={{ alignSelf: 'flex-start', marginTop: 2 }}>
                  <Badge label="Important" tone="warning" />
                </View>
              )}
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}
