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
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { CircleAlert, Megaphone } from 'lucide-react-native'

import { api } from '../../../lib/api'
import { useApi } from '../../../lib/use-api'
import { IconTile, Segmented } from '../../../components/shell'
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
  /*
    All | Unread | Important.

    The reference design's three tabs are All / Notices / Messages. There is no
    message category in this data — `/api/parent/notices` returns announcements and
    nothing else — so a "Messages" tab would be a tab that is always empty, or worse,
    one that implies a channel a parent might wait on. These three filter what is
    actually here, and the middle one is the question a parent opening this screen is
    usually asking.
  */
  const [filter, setFilter] = useState<'all' | 'unread' | 'important'>('all')

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

  /*
    Unread counted from the server flag OR this session's taps, so the count in the
    tab drops as the parent reads rather than only after a refetch.
  */
  const unreadCount = notices.filter((n) => !n.read && !locallyRead.has(n.id)).length

  const visible = notices.filter((n) => {
    if (filter === 'unread') return !n.read && !locallyRead.has(n.id)
    if (filter === 'important') return n.importance === 'important' || n.importance === 'urgent'
    return true
  })

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

        {!error && data && notices.length > 0 && (
          <Segmented
            options={[
              { value: 'all', label: 'All' },
              { value: 'unread', label: `Unread${unreadCount > 0 ? ` (${unreadCount})` : ''}` },
              { value: 'important', label: 'Important' },
            ]}
            value={filter}
            onChange={setFilter}
          />
        )}

        {/* A filter that matches nothing is not the same as having no notices, and
            saying "nothing from your school" here would be false. */}
        {!error && data && notices.length > 0 && visible.length === 0 && (
          <Body muted>
            {filter === 'unread'
              ? 'You have read everything. Switch to All to see them again.'
              : 'Nothing marked important. Switch to All to see everything.'}
          </Body>
        )}

        {!error && data && notices.length === 0 && (
          <Empty
            icon={Megaphone}
            title="Nothing from your school"
            body="Notices your school sends will appear here."
          />
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
                An icon per notice, as the mockup has it — but keyed to IMPORTANCE,
                which is what the data carries. The mockup draws a different picture
                per subject (a chart for results, a wallet for fees), and inferring
                those from a title string would put a wallet beside a notice about
                sports day often enough to be worse than one honest symbol.
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
                  {/* A dot, not a "New" badge. The mockup uses one, and at this size a
                      word competes with the title it is meant to annotate. */}
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
