/**
 * My library — everything this teacher has made.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md`
 *         → *4. My Library*
 *
 * These belong to the TEACHER, not to any school. `teaching_resources` is scoped by
 * `created_by` and a school has no policy admitting it — which is why a teacher whose
 * school stops paying keeps their lesson plans, and why this screen works identically
 * for a standalone account.
 */

import type { JSX } from 'react'
import { Link } from 'expo-router'
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { BookOpen, ChevronRight, FileText, FolderOpen, WandSparkles } from 'lucide-react-native'
import type { LucideIcon } from 'lucide-react-native'

import { useApi } from '../../../lib/use-api'
import { IconTile } from '../../../components/shell'
import {
  Badge,
  Caption,
  Card,
  Empty,
  ErrorNote,
  Loading,
  Row,
  Screen,
  usePalette,
} from '../../../components/ui'
import { SPACE, TYPE } from '../../../theme'

interface Resource {
  id: string
  title: string
  resource_type: string
  subject_name: string | null
  grade_id: string | null
  created_at: string
}

/** The glyph per resource kind, matching the action grid so one thing means one
 *  thing wherever a teacher meets it. */
const TYPE_ICON: Record<string, LucideIcon> = {
  lesson_plan: WandSparkles,
  quiz: FileText,
  homework: BookOpen,
}

const LABEL: Record<string, string> = {
  lesson_plan: 'Lesson plan',
  quiz: 'Quiz',
  homework: 'Homework',
}

export default function LibraryScreen(): JSX.Element {
  const c = usePalette()
  const { data, loading, error, reload } = useApi<{ resources: Resource[] }>(
    '/api/teacher/hub/resources',
  )

  const resources = data?.resources ?? []

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ padding: SPACE.gutter, gap: SPACE.sm, paddingBottom: SPACE.xxl }}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={reload} tintColor={c.primary} />
        }
      >
        {error && <ErrorNote message={error} onRetry={reload} />}
        {loading && !data && <Loading label="Opening your library" />}

        {!error && data && resources.length === 0 && (
          <Empty
            icon={FolderOpen}
            title="Nothing here yet"
            body="Lesson plans, quizzes and homework you make will appear here. They are yours and stay with you."
          />
        )}

        {resources.map((r) => (
          <Card key={r.id}>
            <Row gap={SPACE.md}>
              {/*
                The kind of resource, as a tinted tile, in the same hues the action
                grid gives these three. A library of twenty plans and quizzes was
                twenty identical cards distinguished only by a badge halfway down —
                the tile is what the eye finds when scrolling for "the quiz".
              */}
              <IconTile icon={TYPE_ICON[r.resource_type] ?? FileText} tone="accent" />

              <View style={{ flex: 1, gap: 3 }}>
                <Text style={[TYPE.heading, { color: c.text }]} numberOfLines={2}>
                  {r.title}
                </Text>
                <Row gap={SPACE.xs}>
                  <Badge label={LABEL[r.resource_type] ?? r.resource_type} tone="primary" />
                  {r.subject_name && <Caption>{r.subject_name}</Caption>}
                </Row>
              </View>
              <ChevronRight size={18} color={c.textSubtle} />
            </Row>
          </Card>
        ))}
      </ScrollView>
    </Screen>
  )
}
