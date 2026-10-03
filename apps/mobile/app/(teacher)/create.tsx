/**
 * Create — the Hub generator, on a phone.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md`
 *         → *1. Lesson Planner*, *2. Quiz Generator*, *3. Homework Creator*
 *
 * ## One screen, three tools
 *
 * The three differ by `resource_type` and by almost nothing else — the same subject,
 * grade and topic produce the same shape of request. Three screens would be three copies
 * of one form, and the kind arrives as a parameter so the Home grid can open any of them
 * directly.
 *
 * ## It belongs to the teacher
 *
 * No school is required and none is sent. `teaching_resources` is scoped by `created_by`,
 * which is what makes a standalone account a complete product rather than a trial, and
 * why a teacher whose school stops paying keeps everything they made.
 *
 * ## The generator has no model behind it yet
 *
 * `AI_GENERATOR` is `template`, so this produces a structured draft rather than written
 * content. Said on the screen rather than discovered: a teacher expecting AI who gets a
 * template should know which they got.
 */

import type { JSX } from 'react'
import { useCallback, useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Sparkles } from 'lucide-react-native'

import { api } from '../../lib/api'
import { useApi } from '../../lib/use-api'
import { useSession } from '../../lib/auth'
import {
  Body,
  Button,
  Caption,
  ErrorNote,
  Row,
  Screen,
  Title,
  usePalette,
} from '../../components/ui'
import { RADIUS, SPACE, TAP, TYPE } from '../../theme'

type Kind = 'lesson_plan' | 'quiz' | 'homework'

const KINDS: Array<{ value: Kind; label: string }> = [
  { value: 'lesson_plan', label: 'Lesson' },
  { value: 'quiz', label: 'Quiz' },
  { value: 'homework', label: 'Homework' },
]

export default function Create(): JSX.Element {
  const router = useRouter()
  const { getToken } = useSession()
  const params = useLocalSearchParams<{ kind?: string }>()

  const [kind, setKind] = useState<Kind>(
    KINDS.some((k) => k.value === params.kind) ? (params.kind as Kind) : 'lesson_plan',
  )
  const [subject, setSubject] = useState('')
  const [grade, setGrade] = useState('')
  const [topic, setTopic] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: hub } = useApi<{ credits?: { remaining?: number } }>('/api/teacher/hub')

  const generate = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await api.post<{ id: string }>('/api/teacher/hub/resources', getToken, {
        resourceType: kind,
        subjectName: subject.trim(),
        gradeId: grade.trim(),
        topic: topic.trim(),
      })
      if (result.error) {
        setError(result.error)
        return
      }
      setTopic('')
      router.push('/(teacher)/library')
    } finally {
      setBusy(false)
    }
  }, [kind, subject, grade, topic, getToken, router])

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ padding: SPACE.gutter, gap: SPACE.cards }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ gap: 4 }}>
            <Title>Create</Title>
            <Body muted>Give it a subject, a grade and a topic.</Body>
          </View>

          {/* Segmented rather than a picker: three options is below the threshold where
              a dropdown earns its extra tap. */}
          <Row gap={SPACE.xs}>
            {KINDS.map((k) => (
              <Button
                key={k.value}
                label={k.label}
                tone={kind === k.value ? 'primary' : 'outline'}
                onPress={() => setKind(k.value)}
              />
            ))}
          </Row>

          {error && <ErrorNote message={error} />}

          <Labelled label="Subject">
            <Field value={subject} onChange={setSubject} placeholder="Mathematics" />
          </Labelled>
          <Labelled label="Grade">
            <Field value={grade} onChange={setGrade} placeholder="Grade 8" />
          </Labelled>
          <Labelled label="Topic">
            <Field value={topic} onChange={setTopic} placeholder="Fractions and decimals" />
          </Labelled>

          <Button
            label="Create it"
            icon={Sparkles}
            onPress={() => void generate()}
            busy={busy}
            disabled={!subject.trim() || !grade.trim() || !topic.trim()}
            full
          />

          <Caption>
            {typeof hub?.credits?.remaining === 'number'
              ? `${hub.credits.remaining} AI credits left. `
              : ''}
            The generator runs on templates for now, so this produces a structured draft
            rather than written content.
          </Caption>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}

// ---------------------------------------------------------------------------

function Labelled({ label, children }: { label: string; children: JSX.Element }): JSX.Element {
  const c = usePalette()
  return (
    <View style={{ gap: SPACE.xs }}>
      <Text style={[TYPE.label, { color: c.textMuted }]}>{label}</Text>
      {children}
    </View>
  )
}

function Field({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}): JSX.Element {
  const c = usePalette()
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={c.textSubtle}
      style={[
        TYPE.body,
        {
          color: c.text,
          minHeight: TAP,
          paddingHorizontal: SPACE.md,
          borderRadius: RADIUS.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: c.border,
          backgroundColor: c.surface,
        },
      ]}
    />
  )
}
