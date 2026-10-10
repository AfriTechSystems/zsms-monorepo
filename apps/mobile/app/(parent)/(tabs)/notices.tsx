/**
 * What the school has told this parent.
 *
 * Spec: `Official Documentation/12 Communication System/ANNOUNCEMENTS.md`
 *
 * ## In-app works; the rest does not, and the screen says which
 *
 * A notice is in the portal and the phone app the moment a school sends it. WhatsApp,
 * SMS and email have no credentials, so nothing has ever left the server — a parent who
 * assumed they would be texted would miss things and blame the school.
 *
 * ## Opening marks it read
 *
 * Not a separate button. Somebody who has opened and read a notice has read it, and the
 * receipt matters: an unread important notice is what escalates to another channel once
 * one exists.
 *
 * ## Not scoped to the selected child
 *
 * A notice is addressed to a parent, not to a pupil, so the child switcher is absent
 * here on purpose. Showing one would imply notices differ per child, and a parent who
 * believed that would stop checking after switching.
 */

import type { JSX } from 'react'
import { useCallback, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text } from 'react-native'
import { Megaphone } from 'lucide-react-native'

import { api } from '../../../lib/api'
import { useApi } from '../../../lib/use-api'
import { useSession } from '../../../lib/auth'
import {
  Badge,
  Body,
  Caption,
  Empty,
  ErrorNote,
  Loading,
  Row,
  Screen,
  usePalette,
} from '../../../components/ui'
import { RADIUS, SPACE, TYPE } from '../../../theme'

interface Notice {
  id: string
  title: string
  body: string
  importance: string
  sent_at: string | null
  read: boolean
}

export default function ParentNotices(): JSX.Element {
  const c = usePalette()
  const { getToken } = useSession()
  const { data, loading, error, reload } = useApi<{ notices: Notice[]; unread: number }>(
    '/api/parent/notices',
  )

  const [open, setOpen] = useState<Set<string>>(new Set())
  // Marked locally the moment one is opened, so the badge clears immediately rather
  // than after a round trip on a slow link.
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

      // Fire and forget. A failed receipt is not worth interrupting somebody reading a
      // notice — the worst case is one unnecessary reminder later.
      void api.post('/api/parent/notices', getToken, { announcementId: id }).catch(() => {})
    },
    [getToken, locallyRead],
  )

  const notices = data?.notices ?? []

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ padding: SPACE.gutter, gap: SPACE.sm, paddingBottom: SPACE.xxl }}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={reload} tintColor={c.primary} />
        }
      >
        {error && <ErrorNote message={error} onRetry={reload} />}
        {loading && !data && <Loading label="Checking for notices" />}

        {!error && data && notices.length === 0 && (
          <Empty
            icon={Megaphone}
            title="Nothing from your school"
            body="Notices your school sends will appear here."
          />
        )}

        {notices.map((n) => {
          const isRead = n.read || locallyRead.has(n.id)
          const expanded = open.has(n.id)

          return (
            <Pressable
              key={n.id}
              accessibilityRole="button"
              onPress={() => openNotice(n.id, n.read)}
              style={({ pressed }) => ({
                padding: SPACE.card,
                borderRadius: RADIUS.lg,
                backgroundColor: c.surface,
                borderWidth: StyleSheet.hairlineWidth,
                // Unread carries weight, so a glance down the list finds it.
                borderColor: isRead ? c.border : c.primary,
                opacity: pressed ? 0.8 : 1,
              })}
            >
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
                {n.importance === 'important' && <Badge label="Important" tone="warning" />}
                {!isRead && <Badge label="New" tone="primary" />}
              </Row>

              <Text
                numberOfLines={expanded ? undefined : 2}
                style={[TYPE.body, { color: c.textMuted, marginTop: 4 }]}
              >
                {n.body}
              </Text>

              {n.sent_at && (
                <Caption>{new Date(n.sent_at).toLocaleDateString('en-ZM')}</Caption>
              )}
            </Pressable>
          )
        })}

        {data && notices.length > 0 && (
          <Body muted>
            These appear in the app as soon as your school sends them. WhatsApp and SMS
            delivery are not switched on yet.
          </Body>
        )}
      </ScrollView>
    </Screen>
  )
}
