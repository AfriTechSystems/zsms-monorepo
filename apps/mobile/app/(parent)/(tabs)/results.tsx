/**
 * Marks and grades, once the school has published them.
 *
 * Spec: `Official Documentation/11 Examinations and Results/RESULTS.md`
 *
 * ## Only published results appear
 *
 * A mark a teacher has entered but not published is a draft, and a parent who sees one
 * and asks about it puts the teacher in an impossible position. The endpoint filters on
 * publication; this screen says so when the list is empty, so nothing reads as "your
 * child sat nothing" when it means "not yet".
 *
 * ## Grouped by term, newest first
 *
 * A parent looking for last term should not have to read a date on every row.
 */

import type { JSX } from 'react'
import { RefreshControl, ScrollView, Text, View } from 'react-native'
import { GraduationCap } from 'lucide-react-native'

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

interface Result {
  id: string
  subject_name: string | null
  subject_code: string | null
  academic_year: string | null
  term_number: number | null
  marks_obtained: number | null
  marks_total: number | null
  grade_letter: string | null
  class_position: number | null
  class_size: number | null
  comments: string | null
  published_at: string | null
}

interface Payload {
  children: Child[]
  results: Result[]
}

export default function ParentResults(): JSX.Element {
  const c = usePalette()
  const { childId, setChildId } = useChild()
  const { data, loading, error, reload } = useApi<Payload>(
    `/api/parent/results${childQuery(childId)}`,
  )

  const results = data?.results ?? []

  // Grouped so a parent reads "2026 · Term 2" once rather than on every row. The
  // endpoint already returns newest first, so insertion order is the right order.
  const terms: Array<[string, Result[]]> = []
  for (const r of results) {
    const key = `${r.academic_year ?? '—'} · Term ${r.term_number ?? '—'}`
    const found = terms.find(([k]) => k === key)
    if (found) found[1].push(r)
    else terms.push([key, [r]])
  }

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
        {loading && !data && <Loading label="Loading results" />}

        {data && results.length === 0 && (
          <Empty
            icon={GraduationCap}
            title="Nothing published yet"
            body="Results appear here once your school publishes them. Marks a teacher is still entering are not shown."
          />
        )}

        {terms.map(([term, rows]) => (
          <View key={term} style={{ gap: SPACE.sm }}>
            <Caption>{term}</Caption>
            {rows.map((r) => (
              <Card key={r.id}>
                <Row gap={SPACE.sm}>
                  <Text style={[TYPE.body, { flex: 1, color: c.text, fontWeight: '600' }]}>
                    {r.subject_name ?? r.subject_code ?? 'Subject'}
                  </Text>
                  {r.grade_letter && <Badge label={r.grade_letter} tone="primary" />}
                </Row>

                <Row gap={SPACE.md}>
                  {r.marks_obtained !== null && (
                    <Text style={[TYPE.body, NUMERIC, { color: c.textMuted }]}>
                      {r.marks_obtained}
                      {r.marks_total !== null ? ` / ${r.marks_total}` : ''}
                    </Text>
                  )}
                  {r.class_position !== null && (
                    <Caption>
                      Position {r.class_position}
                      {r.class_size ? ` of ${r.class_size}` : ''}
                    </Caption>
                  )}
                </Row>

                {r.comments && <Body muted>{r.comments}</Body>}
              </Card>
            ))}
          </View>
        ))}
      </ScrollView>
    </Screen>
  )
}
