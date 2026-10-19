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

export default function Notices(): JSX.Element {
  const c = usePalette()
  const { getToken } = useSession()
  const { data, loading, error, reload } = useApi<{ notices: Notice[]; unread: number }>(
    '/api/session/notices',
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
            endpoint="/api/session/notices"
            getToken={getToken}
            emptyTitle="Nothing from your school"
            emptyBody="Notices your school sends to staff will appear here."
          />
        )}

        {data && (data.notices ?? []).length > 0 && (
          <Body muted>These appear as soon as your school sends them. WhatsApp and SMS delivery are not switched on yet.</Body>
        )}
      </ScrollView>
    </Screen>
  )
}
