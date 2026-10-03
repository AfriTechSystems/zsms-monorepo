/**
 * Notices — what the school has told this teacher.
 *
 * Spec: `Official Documentation/12 Communication System/ANNOUNCEMENTS.md`
 *
 * ## In-app, and honest about what that means
 *
 * No push notification arrives, because no delivery channel has credentials — Meta,
 * Resend and Twilio are all unconfigured, so nothing has ever left the server. What works
 * end to end is this: the school sends a notice on the web, it appears here, and opening
 * it records a receipt the school can see.
 *
 * That is a real loop rather than a placeholder, and it is worth having before push: a
 * teacher who opens the app sees the notice, and the office learns who has.
 *
 * ## Opening marks it read
 *
 * Not a separate button. A teacher who has expanded and read a notice has read it, and
 * asking them to confirm is asking them to do the system's bookkeeping. The receipt
 * matters because an unread important notice is what escalates to WhatsApp later.
 */

import type { JSX } from 'react'
import { useCallback, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
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

export default function Notices(): JSX.Element {
  const c = usePalette()
  const { getToken } = useSession()
  const { data, loading, error, reload } = useApi<{ notices: Notice[]; unread: number }>(
    '/api/session/notices',
  )

  const [open, setOpen] = useState<Set<string>>(new Set())
  // Marked locally the moment a notice is opened, so the badge clears immediately
  // rather than after a round trip on a slow link.
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
      void api.post('/api/session/notices', getToken, { announcementId: id }).catch(() => {})
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
            These are in-app only for now — your school&rsquo;s WhatsApp and email
            delivery is not switched on yet.
          </Body>
        )}
      </ScrollView>
    </Screen>
  )
}
