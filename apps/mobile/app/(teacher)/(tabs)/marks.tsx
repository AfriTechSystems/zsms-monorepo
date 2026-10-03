/**
 * Marks — grade, then class, then subject, then the sheet.
 *
 * Spec: `Official Documentation/11 Examinations and Results/RESULTS.md`
 *
 * ## Grade first, as on the web
 *
 * `RESULTS.md` scopes marks entry by grade then class, which is also how a teacher
 * thinks: they teach Grade 8 mathematics, then one of its streams. The web screen was
 * corrected to this after shipping with every class in one flat dropdown — thirty-six
 * options sorted so `7A` sat beside `Form 1A` beside `9C`. The phone starts from the
 * corrected shape rather than repeating it.
 *
 * Each step shows only what the previous one admits, so nothing offers a combination
 * that resolves to an empty sheet.
 *
 * ## An empty box is not a zero
 *
 * The distinction the whole record turns on: a zero is a pupil who sat the paper and
 * scored nothing, an empty box is a pupil who was not examined, and they mean opposite
 * things on a report card. Unmarked rows are visibly unanswered and the save counts them.
 *
 * ## A published mark cannot be edited here
 *
 * Publication locks a result, and correcting one is a principal's deliberate act with a
 * written reason (`0172`). That belongs on the web, where the reason can be typed
 * properly — so a published sheet is read-only on the phone and says why.
 */

import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Check, ClipboardList, Lock } from 'lucide-react-native'

import { api } from '../../../lib/api'
import { useApi } from '../../../lib/use-api'
import { useSession } from '../../../lib/auth'
import {
  Badge,
  Body,
  Button,
  Caption,
  Empty,
  ErrorNote,
  Loading,
  Row,
  Screen,
  usePalette,
} from '../../../components/ui'
import { NUMERIC, RADIUS, SPACE, TAP, TYPE } from '../../../theme'
import { formatClass } from './attendance'

interface Structure {
  classesByGrade: Record<string, string[]>
  subjects: Array<{ code: string; name: string }>
}

interface MarkRow {
  studentId: string
  studentCode: string
  firstName: string
  lastName: string
  marksObtained: number | null
  gradeLetter: string | null
  published: boolean
}

interface Sheet {
  rows: MarkRow[]
  published: boolean
  canWrite: boolean
}

export default function Marks(): JSX.Element {
  const c = usePalette()
  const insets = useSafeAreaInsets()
  const { getToken } = useSession()

  const [gradeId, setGradeId] = useState('')
  const [classId, setClassId] = useState('')
  const [subject, setSubject] = useState('')
  const [entries, setEntries] = useState<Record<string, string>>({})
  const [total, setTotal] = useState('100')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const { data: structure } = useApi<Structure>('/api/school/structure')

  const year = String(new Date().getFullYear())
  const ready = Boolean(classId && subject)
  const { data, loading, error, reload } = useApi<Sheet>(
    ready
      ? `/api/school/results?classId=${encodeURIComponent(classId)}&subjectCode=${encodeURIComponent(subject)}&academicYear=${year}&termNumber=1`
      : null,
  )

  const grades = useMemo(
    () => Object.keys(structure?.classesByGrade ?? {}).sort(),
    [structure],
  )
  // Nothing until a grade is chosen: an empty second list is a clearer instruction than
  // a list of every class in the school.
  const classes = useMemo(
    () => (gradeId ? [...(structure?.classesByGrade?.[gradeId] ?? [])].sort() : []),
    [structure, gradeId],
  )

  useEffect(() => {
    if (!data?.rows) return
    const seed: Record<string, string> = {}
    for (const r of data.rows) {
      if (r.marksObtained !== null) seed[r.studentId] = String(r.marksObtained)
    }
    setEntries(seed)
  }, [data])

  const rows = data?.rows ?? []
  const unmarked = rows.filter((r) => !entries[r.studentId]?.trim()).length

  const save = useCallback(async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const result = await api.post('/api/school/results', getToken, {
        classId,
        subjectCode: subject,
        academicYear: year,
        termNumber: 1,
        marksTotal: Number(total) || 100,
        marks: rows.map((r) => ({
          studentId: r.studentId,
          // Empty becomes null, not 0 — the whole point.
          marksObtained: entries[r.studentId]?.trim() ? Number(entries[r.studentId]) : null,
        })),
      })
      if (result.error) {
        setSaveError(
          result.code === 'OFFLINE'
            ? 'No connection, so nothing was saved. Your marks are still here — try again when you have signal.'
            : result.error,
        )
        return
      }
      setSaved(true)
      reload()
    } finally {
      setSaving(false)
    }
  }, [classId, subject, year, total, rows, entries, getToken, reload])

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: SPACE.gutter,
          gap: SPACE.md,
          paddingBottom: TAP + insets.bottom + SPACE.xxl,
        }}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={reload} tintColor={c.primary} />
        }
        keyboardShouldPersistTaps="handled"
      >
        <Chooser label="Grade" value={gradeId} options={grades.map((g) => ({ v: g, l: formatClass(g) }))}
          onPick={(v) => {
            setGradeId(v)
            // A class from the previous grade is not in the new one.
            setClassId('')
          }}
        />

        {gradeId !== '' && (
          <Chooser label="Class" value={classId}
            options={classes.map((k) => ({ v: k, l: formatClass(k) }))}
            onPick={setClassId}
          />
        )}

        {classId !== '' && (
          <Chooser label="Subject" value={subject}
            options={(structure?.subjects ?? []).map((s) => ({ v: s.code, l: s.name }))}
            onPick={setSubject}
          />
        )}

        {!ready && (
          <Empty
            icon={ClipboardList}
            title="Choose a class and subject"
            body="Marks are entered one subject at a time, for one class."
          />
        )}

        {error && <ErrorNote message={error} onRetry={reload} />}
        {ready && loading && !data && <Loading label="Opening the mark sheet" />}

        {data?.published && (
          <Row gap={SPACE.sm} style={{ padding: SPACE.md, backgroundColor: c.warningTint, borderRadius: RADIUS.md }}>
            <Lock size={16} color={c.warningText} />
            <Body>
              Published — parents can see these. Corrections are made on the website, where
              the reason can be recorded.
            </Body>
          </Row>
        )}

        {ready && data && rows.length > 0 && (
          <>
            <Row gap={SPACE.sm}>
              <Caption>Out of</Caption>
              <TextInput
                value={total}
                onChangeText={setTotal}
                keyboardType="number-pad"
                editable={!data.published}
                style={[
                  NUMERIC,
                  {
                    color: c.text,
                    width: 70,
                    minHeight: TAP,
                    textAlign: 'center',
                    borderRadius: RADIUS.sm,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: c.border,
                    backgroundColor: c.surface,
                  },
                ]}
              />
              {unmarked > 0 && <Badge label={`${unmarked} not marked`} tone="warning" />}
            </Row>

            {rows.map((r) => (
              <Row
                key={r.studentId}
                gap={SPACE.md}
                style={{
                  padding: SPACE.md,
                  borderRadius: RADIUS.md,
                  backgroundColor: c.surface,
                  borderWidth: StyleSheet.hairlineWidth,
                  // Unanswered is visibly unanswered: null is not zero.
                  borderColor: entries[r.studentId]?.trim() ? c.border : c.warning,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[TYPE.body, { color: c.text }]} numberOfLines={1}>
                    {r.firstName} {r.lastName}
                  </Text>
                  <Caption>{r.studentCode}</Caption>
                </View>

                {r.gradeLetter && <Badge label={r.gradeLetter} tone="neutral" />}

                <TextInput
                  value={entries[r.studentId] ?? ''}
                  onChangeText={(v) => {
                    setSaved(false)
                    setEntries((e) => ({ ...e, [r.studentId]: v }))
                  }}
                  // `decimal`, because half marks are ordinary in Zambian marking and a
                  // numeric keypad with no point makes 7.5 untypeable.
                  keyboardType="decimal-pad"
                  placeholder="—"
                  placeholderTextColor={c.textSubtle}
                  editable={!r.published && data.canWrite}
                  style={[
                    NUMERIC,
                    {
                      color: c.text,
                      width: 64,
                      minHeight: TAP,
                      textAlign: 'center',
                      borderRadius: RADIUS.sm,
                      borderWidth: StyleSheet.hairlineWidth,
                      borderColor: c.border,
                      backgroundColor: r.published ? c.surfaceSunken : c.background,
                    },
                  ]}
                />
              </Row>
            ))}
          </>
        )}

        {ready && data && rows.length === 0 && (
          <Empty icon={ClipboardList} title="No pupils in this class" />
        )}

        {saveError && <ErrorNote message={saveError} onRetry={() => void save()} />}
      </ScrollView>

      {ready && data && rows.length > 0 && data.canWrite && !data.published && (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            padding: SPACE.gutter,
            paddingBottom: insets.bottom + SPACE.md,
            backgroundColor: c.surface,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: c.border,
          }}
        >
          <Button
            label={saved ? 'Saved' : unmarked > 0 ? `Save — ${unmarked} unmarked` : 'Save marks'}
            icon={saved ? Check : undefined}
            onPress={() => void save()}
            busy={saving}
            full
          />
        </View>
      )}
    </Screen>
  )
}

// ---------------------------------------------------------------------------

/**
 * A horizontal row of choices rather than a picker.
 *
 * A native picker costs a tap to open, a scroll and a tap to confirm. With a handful of
 * grades or subjects the options fit on screen, and choosing one is a single tap.
 */
function Chooser({
  label,
  value,
  options,
  onPick,
}: {
  label: string
  value: string
  options: Array<{ v: string; l: string }>
  onPick: (v: string) => void
}): JSX.Element {
  const c = usePalette()
  return (
    <View style={{ gap: SPACE.xs }}>
      <Text style={[TYPE.label, { color: c.textMuted }]}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Row gap={SPACE.xs}>
          {options.map((o) => {
            const active = value === o.v
            return (
              <Pressable
                key={o.v}
                onPress={() => onPick(o.v)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                style={{
                  minHeight: TAP - 8,
                  justifyContent: 'center',
                  paddingHorizontal: SPACE.md,
                  borderRadius: RADIUS.full,
                  backgroundColor: active ? c.primary : c.surface,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: active ? c.primary : c.border,
                }}
              >
                <Text
                  style={[
                    TYPE.label,
                    { color: active ? c.onPrimary : c.text },
                  ]}
                >
                  {o.l}
                </Text>
              </Pressable>
            )
          })}
        </Row>
      </ScrollView>
    </View>
  )
}
