/**
 * Whether this child has been in school.
 *
 * Spec: `Official Documentation/10 Attendance/ATTENDANCE.md`
 *
 * ## The window is stated, always
 *
 * A percentage with no period attached is the kind of number a parent argues with a
 * school about. Every figure here says what it covers.
 *
 * ## Nothing marked is not the same as absent
 *
 * A school that has not taken a register yet, or a pupil enrolled last week, shows a
 * dash rather than 0%. Reporting 0% attendance for a child nobody has marked is a false
 * accusation, and it is the school it would be made against.
 */

import type { JSX } from 'react'
import { RefreshControl, ScrollView, Text, View } from 'react-native'
import { CalendarCheck } from 'lucide-react-native'

import { ChildSwitcher } from '../../../components/child-switcher'
import {
  Badge,
  Body,
  Caption,
  Card,
  Empty,
  ErrorNote,
  Loading,
  Row,
  Screen,
  usePalette,
} from '../../../components/ui'
import { childQuery, useChild, type Child } from '../../../lib/child'
import { useApi } from '../../../lib/use-api'
import { NUMERIC, SPACE, TYPE } from '../../../theme'

interface Mark {
  id?: string
  attendance_date?: string | null
  status?: string | null
  notes?: string | null
}

interface Payload {
  children: Child[]
  attendance: {
    days: number
    present?: number
    late: number
    absent: number
    excused: number
    rate?: number | null
  }
  marks?: Mark[]
}

const TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  present: 'success',
  late: 'warning',
  absent: 'danger',
  excused: 'neutral',
}

const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-ZM', { weekday: 'short', day: 'numeric', month: 'short' })

export default function ParentAttendance(): JSX.Element {
  const c = usePalette()
  const { childId, setChildId } = useChild()
  const { data, loading, error, reload } = useApi<Payload>(
    `/api/parent/attendance${childQuery(childId)}`,
  )

  const a = data?.attendance
  const marks = data?.marks ?? []

  return (
    <Screen>
      <ChildSwitcher children={data?.children ?? []} selectedId={childId} onSelect={setChildId} />

      <ScrollView
        contentContainerStyle={{ padding: SPACE.gutter, gap: SPACE.md, paddingBottom: SPACE.xxl }}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={reload} tintColor={c.primary} />
        }
      >
        {error && <ErrorNote message={error} onRetry={reload} />}
        {loading && !data && <Loading label="Loading attendance" />}

        {data && a && (
          <>
            <Card>
              <Caption>Attendance over the last 30 days</Caption>
              <Text style={[TYPE.display, NUMERIC, { color: c.text }]}>
                {a.rate === null || a.rate === undefined ? '—' : `${a.rate}%`}
              </Text>
              <Body muted>
                {a.days > 0
                  ? `${a.present ?? 0} of ${a.days} school days marked present.`
                  : 'Your school has not marked a register for this period yet.'}
              </Body>
            </Card>

            <Row gap={SPACE.sm}>
              <Card style={{ flex: 1 }}>
                <Caption>Late</Caption>
                <Text style={[TYPE.heading, NUMERIC, { color: c.text }]}>{a.late ?? 0}</Text>
              </Card>
              <Card style={{ flex: 1 }}>
                <Caption>Absent</Caption>
                <Text style={[TYPE.heading, NUMERIC, { color: c.text }]}>{a.absent ?? 0}</Text>
              </Card>
              <Card style={{ flex: 1 }}>
                <Caption>Excused</Caption>
                <Text style={[TYPE.heading, NUMERIC, { color: c.text }]}>{a.excused ?? 0}</Text>
              </Card>
            </Row>

            {marks.length === 0 ? (
              <Empty
                icon={CalendarCheck}
                title="No daily record yet"
                body="Once your school marks the register, each day will be listed here."
              />
            ) : (
              <View style={{ gap: SPACE.sm }}>
                <Caption>Day by day</Caption>
                {marks.map((m, i) => (
                  <Card key={m.id ?? i}>
                    <Row gap={SPACE.sm}>
                      <Text style={[TYPE.body, { flex: 1, color: c.text }]}>
                        {m.attendance_date ? shortDate(m.attendance_date) : '—'}
                      </Text>
                      {m.status && <Badge label={m.status} tone={TONE[m.status] ?? 'neutral'} />}
                    </Row>
                    {m.notes && <Caption>{m.notes}</Caption>}
                  </Card>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  )
}
