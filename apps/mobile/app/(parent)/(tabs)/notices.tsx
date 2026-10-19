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
 *
 * ## The list itself lives in `components/notice-list`
 *
 * This screen and its counterpart in the other portal were about a hundred and sixty
 * lines each doing the same thing against the same shape. Extracted 2026-10-18, so a
 * change to how a notice reads lands on both portals at once rather than one.
 */

import type { JSX } from 'react'
import { RefreshControl, ScrollView } from 'react-native'

import { useApi } from '../../../lib/use-api'
import { useSession } from '../../../lib/auth'
import { NoticeList, type Notice } from '../../../components/notice-list'
import { Body, ErrorNote, Loading, Screen, usePalette } from '../../../components/ui'
import { SPACE } from '../../../theme'

export default function ParentNotices(): JSX.Element {
  const c = usePalette()
  const { getToken } = useSession()
  const { data, loading, error, reload } = useApi<{ notices: Notice[]; unread: number }>(
    '/api/parent/notices',
  )

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: SPACE.gutter,
          gap: SPACE.md,
          paddingBottom: SPACE.xxl,
        }}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={reload} tintColor={c.primary} />
        }
      >
        {error && <ErrorNote message={error} onRetry={reload} />}
        {loading && !data && <Loading label="Checking for notices" />}

        {!error && data && (
          <NoticeList
            notices={data.notices ?? []}
            endpoint="/api/parent/notices"
            getToken={getToken}
            emptyTitle="Nothing from your school"
            emptyBody="Notices your school sends will appear here."
          />
        )}

        {data && (data.notices ?? []).length > 0 && (
          <Body muted>These appear in the app as soon as your school sends them. WhatsApp and SMS delivery are not switched on yet.</Body>
        )}
      </ScrollView>
    </Screen>
  )
}
