'use client'

/**
 * Results — enter a class's marks for one subject, and publish them.
 *
 * Spec: `Official Documentation/11 Examinations and Results/`
 *       `Official Documentation/01 Foundation Layer/DECISIONS.md` — ADR-041
 *
 * ## A mark sheet is entered in one sitting, so it saves as one sheet
 *
 * Thirty marks is thirty round trips if each field saves itself, on a
 * connection that is often a phone tether. The sheet saves once, as a unit —
 * which is also how a teacher thinks about it, because a mark sheet is a
 * physical page they are copying from.
 *
 * ## An empty box is not a zero
 *
 * The distinction this screen exists to protect. A zero is a child who sat the
 * paper and scored nothing; an empty box is a child who was not examined. They
 * mean opposite things on a report card, and defaulting one to the other puts a
 * fail against a pupil who was in hospital. So an empty box stays empty, saves
 * as `null`, and is visibly different from a `0` somebody typed.
 *
 * ## The grade is shown, never typed
 *
 * The letter comes back from the database, computed under the subject's current
 * scale version and stored beside it (ADR-041). The screen never computes a
 * grade: a boundary implemented twice is two answers to "is 79.5 a
 * distinction", and the one on screen would be the one nobody could audit.
 *
 * When a subject has no scale, marks still save and the grade column says so
 * rather than showing an empty cell that looks like a bug.
 */

import type { FormEvent, JSX } from 'react'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ClipboardList, Loader2, Lock, Save, Send } from 'lucide-react'

import { apiSend, useApi } from '../../../../lib/use-api'
import { Alert } from '../../../../components/ui/alert'
import { Badge } from '../../../../components/ui/badge'
import { Button } from '../../../../components/ui/button'
import { Card, CardContent } from '../../../../components/ui/card'
import { EmptyState } from '../../../../components/ui/empty-state'
import { ErrorState, PageHeader, TableSkeleton } from '../../../../components/ui/data-states'
import { Field, Input, Select } from '../../../../components/ui/field'
import { FormGrid, FormSection } from '../../../../components/ui/form'
import { InfoHint } from '../../../../components/ui/info-hint'
import { useToast } from '../../../../components/ui/toast'

interface Row {
  studentId: string
  studentCode: string
  firstName: string
  lastName: string
  marksObtained: number | null
  marksTotal: number | null
  gradeLetter: string | null
  gradePoints: number | null
  published: boolean
  hasScaleVersion: boolean
}

interface Payload {
  rows: Row[]
  published: boolean
  scaleVersionId: string | null
  canWrite: boolean
  canPublish: boolean
}

interface Structure {
  // Classes arrive grouped by grade, because that is how the enrolment form
  // needs them. The mark sheet wants one flat list, flattened below rather than
  // asking the API to return the same data twice in two shapes.
  classesByGrade: Record<string, string[]>
  subjects: Array<{ code: string; name: string; hasScale: boolean }>
}

function MarkSheet(): JSX.Element {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const { toast } = useToast()

  const thisYear = String(new Date().getFullYear())
  const classId = params.get('classId') ?? ''
  const subjectCode = params.get('subjectCode') ?? ''
  const academicYear = params.get('year') ?? thisYear
  const termNumber = params.get('term') ?? '1'

  const structure = useApi<Structure>('/api/school/structure')

  const classes = useMemo(
    () =>
      Object.values(structure.data?.classesByGrade ?? {})
        .flat()
        .sort(),
    [structure.data],
  )

  const ready = Boolean(classId && subjectCode)
  const sheetUrl = ready
    ? `/api/school/results?classId=${encodeURIComponent(classId)}&subjectCode=${encodeURIComponent(subjectCode)}&academicYear=${encodeURIComponent(academicYear)}&termNumber=${termNumber}`
    : null
  const { data, loading, error, code, reload } = useApi<Payload>(sheetUrl)

  const [marksTotal, setMarksTotal] = useState('100')
  const [entries, setEntries] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Seeded from what is saved. A blank string is an unmarked pupil and stays
  // blank — never coerced to '0', which would be a different claim entirely.
  useEffect(() => {
    if (!data) return
    const seeded: Record<string, string> = {}
    for (const r of data.rows) {
      seeded[r.studentId] = r.marksObtained === null ? '' : String(r.marksObtained)
    }
    setEntries(seeded)
    const total = data.rows.find((r) => r.marksTotal !== null)?.marksTotal
    if (total) setMarksTotal(String(total))
  }, [data])

  const setParam = useCallback(
    (next: Record<string, string>) => {
      const s = new URLSearchParams(params.toString())
      for (const [k, v] of Object.entries(next)) {
        if (v) s.set(k, v)
        else s.delete(k)
      }
      router.replace(`${pathname}?${s.toString()}`, { scroll: false })
    },
    [params, pathname, router],
  )

  const total = Number(marksTotal)
  const entered = useMemo(
    () => Object.values(entries).filter((v) => v.trim() !== '').length,
    [entries],
  )
  const overMax = useMemo(
    () =>
      Object.values(entries).filter((v) => v.trim() !== '' && Number(v) > total).length,
    [entries, total],
  )

  const save = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      if (!data) return
      setSaving(true)
      setFormError(null)

      const subjectName =
        structure.data?.subjects.find((s) => s.code === subjectCode)?.name ?? subjectCode

      const result = await apiSend<{ saved: number; graded: number }>(
        '/api/school/results',
        'POST',
        {
          classId,
          subjectCode,
          subjectName,
          academicYear,
          termNumber: Number(termNumber),
          marksTotal: total,
          marks: data.rows.map((r) => ({
            studentId: r.studentId,
            // The empty string becomes null, not 0 — the whole point.
            marksObtained: entries[r.studentId]?.trim() ? Number(entries[r.studentId]) : null,
          })),
        },
      )

      setSaving(false)
      if (result.error) {
        setFormError(result.error)
        return
      }

      const { saved = 0, graded = 0 } = result.data ?? {}
      toast(
        graded < saved
          ? `${saved} marks saved. ${graded} graded — the rest have no mark, or this subject has no grading scale.`
          : `${saved} marks saved and graded.`,
      )
      reload()
    },
    [data, entries, classId, subjectCode, academicYear, termNumber, total, structure.data, toast, reload],
  )

  const publish = useCallback(async () => {
    setPublishing(true)
    setFormError(null)
    const result = await apiSend<{ published: number }>('/api/school/results/publish', 'POST', {
      academicYear,
      termNumber: Number(termNumber),
      classId,
    })
    setPublishing(false)
    if (result.error) {
      setFormError(result.error)
      return
    }
    toast(`${result.data?.published ?? 0} results published. Parents can see them now.`)
    reload()
  }, [academicYear, termNumber, classId, toast, reload])

  return (
    <>
      <PageHeader
        title="Results"
        description="Enter marks for a class and subject, then publish the term."
        note="An empty box is not a zero. A zero is a pupil who sat the paper and scored nothing; an empty box is a pupil who was not examined, and the two mean opposite things on a report card. Grades are worked out by the school's grading scale and shown here — you enter marks, never letters. Publishing is one-way: a result a parent has seen can be corrected, but not withdrawn."
      />

      <div className="space-y-cards">
        <FormSection>
          <FormGrid columns={4}>
            <Field id="r-class" label="Class" required>
              {(props) => (
                <Select
                  {...props}
                  value={classId}
                  onChange={(e) => setParam({ classId: e.target.value })}
                >
                  <option value="">Choose a class</option>
                  {classes.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field id="r-subject" label="Subject" required>
              {(props) => (
                <Select
                  {...props}
                  value={subjectCode}
                  onChange={(e) => setParam({ subjectCode: e.target.value })}
                >
                  <option value="">Choose a subject</option>
                  {(structure.data?.subjects ?? []).map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field id="r-year" label="Year">
              {(props) => (
                <Input
                  {...props}
                  value={academicYear}
                  maxLength={9}
                  onChange={(e) => setParam({ year: e.target.value })}
                />
              )}
            </Field>

            <Field id="r-term" label="Term">
              {(props) => (
                <Select
                  {...props}
                  value={termNumber}
                  onChange={(e) => setParam({ term: e.target.value })}
                >
                  <option value="1">Term 1</option>
                  <option value="2">Term 2</option>
                  <option value="3">Term 3</option>
                </Select>
              )}
            </Field>
          </FormGrid>
        </FormSection>

        {!ready && (
          <Card>
            <CardContent className="p-0">
              <EmptyState
                icon={ClipboardList}
                title="Choose a class and subject"
                description="Mark sheets are per class, per subject, per term."
              />
            </CardContent>
          </Card>
        )}

        {error && <ErrorState message={error} code={code} onRetry={reload} />}
        {ready && loading && !data && !error && <TableSkeleton rows={8} columns={3} />}

        {ready && !error && data && (
          <>
            {data.published && (
              <Alert variant="info" title="These results are published">
                Parents can see them, and marks can no longer be edited here. A correction after
                publication has to be made deliberately.
              </Alert>
            )}

            {data.scaleVersionId === null && (
              <Alert variant="warning" title="This subject has no grading scale">
                Marks will save, but no letter grade can be worked out and nothing will appear in
                the grade column. Set a grading scale in school settings to grade them.
              </Alert>
            )}

            {formError && (
              <Alert variant="danger" title="Nothing was saved">
                {formError}
              </Alert>
            )}

            <form onSubmit={save} noValidate>
              <Card>
                <CardContent className="space-y-stack">
                  <div className="flex flex-wrap items-end gap-4">
                    <div className="w-32">
                      <Field id="r-total" label="Paper total" required>
                        {(props) => (
                          <Input
                            {...props}
                            type="number"
                            min={1}
                            step="1"
                            inputMode="numeric"
                            value={marksTotal}
                            disabled={data.published}
                            onChange={(e) => setMarksTotal(e.target.value)}
                          />
                        )}
                      </Field>
                    </div>
                    <p className="pb-2 text-sm text-muted-foreground">
                      {entered} of {data.rows.length} marked
                    </p>
                    <InfoHint label="what an empty box means">
                      Leave a box empty for a pupil who was not examined. It saves as “no mark”,
                      not as a zero, and nothing appears on their report card for this subject.
                    </InfoHint>
                  </div>

                  {overMax > 0 && (
                    <Alert variant="danger" title="Marks above the paper total">
                      {overMax} mark{overMax === 1 ? ' is' : 's are'} higher than {total}. A mark
                      above the maximum is a typing error, not a distinction.
                    </Alert>
                  )}

                  <ul className="divide-y divide-border">
                    {data.rows.map((r) => (
                      <li
                        key={r.studentId}
                        className="flex flex-wrap items-center gap-3 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-foreground">
                            {r.lastName}, {r.firstName}
                          </p>
                          <p className="font-mono text-xs text-subtle">{r.studentCode}</p>
                        </div>

                        <div className="w-24">
                          <label htmlFor={`mark-${r.studentId}`} className="sr-only">
                            Mark for {r.firstName} {r.lastName}
                          </label>
                          <Input
                            id={`mark-${r.studentId}`}
                            type="number"
                            min={0}
                            max={total}
                            step="0.5"
                            // `decimal` rather than `numeric`: half marks are
                            // ordinary in Zambian marking, and a numeric keypad
                            // with no decimal point makes 7.5 untypeable.
                            inputMode="decimal"
                            placeholder="—"
                            disabled={data.published || !data.canWrite}
                            value={entries[r.studentId] ?? ''}
                            onChange={(e) =>
                              setEntries((s) => ({ ...s, [r.studentId]: e.target.value }))
                            }
                            className="text-center"
                          />
                        </div>

                        <div className="w-20 text-center">
                          {r.gradeLetter ? (
                            <Badge variant={r.hasScaleVersion ? 'neutral' : 'warning'}>
                              {r.gradeLetter}
                            </Badge>
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>

                  {data.rows.length === 0 && (
                    <EmptyState
                      icon={ClipboardList}
                      title="No pupils in this class"
                      description="Enrol pupils into the class before entering marks."
                    />
                  )}
                </CardContent>
              </Card>

              {data.canWrite && !data.published && data.rows.length > 0 && (
                // Sticky, for the same reason as the attendance register: the
                // save button must never be a scroll away from the last mark
                // typed.
                <div className="sticky bottom-0 z-10 mt-stack flex flex-wrap gap-2 border-t border-border bg-background/95 p-gutter backdrop-blur">
                  <Button type="submit" disabled={saving || overMax > 0}>
                    {saving ? (
                      <Loader2 aria-hidden="true" className="animate-spin" />
                    ) : (
                      <Save aria-hidden="true" />
                    )}
                    Save marks
                  </Button>

                  {data.canPublish && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={publishing || entered === 0}
                      onClick={publish}
                    >
                      {publishing ? (
                        <Loader2 aria-hidden="true" className="animate-spin" />
                      ) : (
                        <Send aria-hidden="true" />
                      )}
                      Publish this class
                    </Button>
                  )}
                </div>
              )}
            </form>

            {!data.canWrite && (
              <Alert variant="info" title="You can see these marks but not change them">
                Marks are entered by the teacher assigned to this class and subject.
              </Alert>
            )}

            {data.published && data.canPublish && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Lock aria-hidden="true" className="size-4" />
                Published results stay visible to parents and are not withdrawn.
              </p>
            )}
          </>
        )}
      </div>
    </>
  )
}

export default function ResultsPage(): JSX.Element {
  return (
    <Suspense fallback={<TableSkeleton rows={8} columns={3} />}>
      <MarkSheet />
    </Suspense>
  )
}
