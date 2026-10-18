'use client'

/**
 * Attendance — mark the register.
 *
 * Spec: `Official Documentation/11 Attendance/ATTENDANCE.md`
 *       `Official Documentation/01 Foundation Layer/DECISIONS.md` — ADR-037
 *
 * ## Designed for a phone held in one hand at 07:40
 *
 * This is the screen most likely to be used standing up, in a hurry, on a small
 * screen, by someone who is also managing thirty children. Everything below
 * follows from that:
 *
 *   - **Present is one tap, not a default.** "Mark all present, then correct"
 *     is how the whole class gets recorded present on a morning nobody opened
 *     the register — so there IS a "mark all present" button, but the register
 *     opens unmarked and the button is an explicit act.
 *   - **The three common statuses are always visible**, side by side, sized to a
 *     thumb. Excused and holiday sit behind a change of status because they are
 *     rare and one of them needs typing.
 *   - **Nothing saves per pupil.** Thirty taps is thirty round trips on a
 *     school's connection; the register saves once, as a unit, which is also how
 *     a teacher thinks about it.
 *
 * ## An unmarked pupil is not a present pupil
 *
 * `status: null` renders as unmarked and is never sent as `present`. The
 * difference between "nobody marked this register" and "everyone was here" is
 * the entire value of the record, and it is very easy to erase by choosing a
 * convenient default.
 */

import type { FormEvent, JSX } from 'react'
import { Suspense, use, useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { CalendarCheck, CheckCheck, Loader2, Save } from 'lucide-react'

import { apiSend, useApi } from '../../../../lib/use-api'
import { Alert } from '../../../../components/ui/alert'
import { Button } from '../../../../components/ui/button'
import { Card, CardContent } from '../../../../components/ui/card'
import { EmptyState } from '../../../../components/ui/empty-state'
import { ErrorState, PageHeader, TableSkeleton } from '../../../../components/ui/data-states'
import { PrintButton, PrintHeading } from '../../../../components/ui/print-button'
import { Field, Input, Select } from '../../../../components/ui/field'
import { FormGrid, FormSection } from '../../../../components/ui/form'
import { cn } from '../../../../lib/utils'
import { formatLevel } from '../school-shared'
import { DateField } from '../../../../components/ui/date-field'
import { todayIso } from '../../../../lib/dates'

type Status = 'present' | 'absent' | 'late' | 'excused' | 'holiday'

interface RegisterRow {
  studentId: string
  studentNumber: string
  firstName: string
  lastName: string
  onLeave: boolean
  status: Status | null
  excuseReason: string | null
  recordedBy: string | null
}

interface RegisterPayload {
  classId: string
  date: string
  register: RegisterRow[]
  alreadyMarked: boolean
  canMark: boolean
}

interface Structure {
  role: string
  gradeLevels: Array<{ level_id: string; display_name: string }>
  classesByGrade: Record<string, string[]>
}

/** The three a teacher uses every morning. Excused and holiday are behind the select. */
const QUICK: Array<{ value: Status; label: string; tone: string }> = [
  { value: 'present', label: 'Present', tone: 'data-[on=true]:bg-success-fill data-[on=true]:text-white' },
  { value: 'absent', label: 'Absent', tone: 'data-[on=true]:bg-danger-fill data-[on=true]:text-white' },
  { value: 'late', label: 'Late', tone: 'data-[on=true]:bg-warning-fill data-[on=true]:text-white' },
]

function Register(): JSX.Element {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const classId = params.get('classId') ?? ''
  const date = params.get('date') ?? todayIso()
  const [term, setTerm] = useState('1')

  const { data: structure } = useApi<Structure>('/api/school/structure')
  const query = classId ? `/api/school/attendance/register?classId=${encodeURIComponent(classId)}&date=${date}` : null
  const { data, loading, error, code, reload } = useApi<RegisterPayload>(query)

  // The working copy. Seeded from the server and owned by the screen until it
  // saves — a register half-marked must not be discarded by a background reload.
  const [draft, setDraft] = useState<Record<string, { status: Status; excuseReason?: string }>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!data) return
    const seeded: Record<string, { status: Status; excuseReason?: string }> = {}
    for (const row of data.register) {
      if (row.status) seeded[row.studentId] = { status: row.status, excuseReason: row.excuseReason ?? undefined }
    }
    setDraft(seeded)
    setSaved(false)
  }, [data])

  const allClasses = useMemo(() => {
    const out: string[] = []
    for (const list of Object.values(structure?.classesByGrade ?? {})) out.push(...list)
    return [...new Set(out)].sort()
  }, [structure])

  const setParam = useCallback(
    (next: Record<string, string>) => {
      const q = new URLSearchParams(params.toString())
      for (const [k, v] of Object.entries(next)) {
        if (v) q.set(k, v)
        else q.delete(k)
      }
      router.replace(`${pathname}?${q.toString()}`, { scroll: false })
    },
    [params, pathname, router],
  )

  const mark = (studentId: string, status: Status): void => {
    setDraft((d) => ({ ...d, [studentId]: { ...d[studentId], status } }))
    setSaved(false)
  }

  const markAllPresent = (): void => {
    if (!data) return
    setDraft((d) => {
      const next = { ...d }
      for (const row of data.register) {
        // Only fills the gaps. Overwriting an absence somebody already recorded
        // would turn a convenience into a way to erase a colleague's work.
        if (!next[row.studentId]) next[row.studentId] = { status: 'present' }
      }
      return next
    })
    setSaved(false)
  }

  const marked = Object.keys(draft).length
  const total = data?.register.length ?? 0
  const unmarked = total - marked

  const save = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      if (!data) return
      setSaving(true)
      setSaveError(null)
      setSaved(false)

      const result = await apiSend('/api/school/attendance/register', 'POST', {
        classId: data.classId,
        date: data.date,
        termNumber: Number(term),
        marks: Object.entries(draft).map(([studentId, v]) => ({
          studentId,
          status: v.status,
          excuseReason: v.excuseReason,
        })),
      })

      setSaving(false)
      if (result.error) {
        setSaveError(result.error)
        return
      }
      setSaved(true)
      reload()
    },
    [data, draft, term, reload],
  )

  return (
    <>
      <PageHeader
        title="Attendance"
        description="Mark today's register, or open a past date to correct one."
        note="A teacher can only mark registers for the classes they are assigned to on the Teaching screen. A pupil left unmarked is recorded as nothing at all — not as present — so an unopened register never reads as a full attendance."
        actions={classId ? <PrintButton label="Print register" /> : undefined}
      />

      {/*
        The printed sheet's own heading.

        Invisible on screen; on paper it is the only thing identifying what the sheet
        is, because the print rules have removed the header that says so. A register
        with no class and no date is not a record of anything.
      */}
      {classId && (
        <PrintHeading
          title={`Attendance register — ${classId}`}
          subtitle={`For ${new Date(date).toLocaleDateString('en-GB', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}`}
        />
      )}

      <FormSection className="mb-cards">
        <FormGrid columns={3}>
          <Field id="reg-class" label="Class" required hint="Only classes you can mark are listed.">
            {(props) => (
              <Select {...props} value={classId} onChange={(e) => setParam({ classId: e.target.value })}>
                <option value="">Choose a class</option>
                {allClasses.map((c) => (
                  <option key={c} value={c}>
                    {formatLevel(c)}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {/* A register cannot be marked for a day that has not happened. */}
          <DateField
            id="reg-date"
            label="Date"
            required
            hint="Defaults to today."
            value={date}
            onChange={(v) => setParam({ date: v })}
            notFuture
          />

          <Field
            id="reg-term"
            label="Term"
            required
            hint="Which term this register belongs to."
          >
            {(props) => (
              <Select {...props} value={term} onChange={(e) => setTerm(e.target.value)}>
                <option value="1">Term 1</option>
                <option value="2">Term 2</option>
                <option value="3">Term 3</option>
              </Select>
            )}
          </Field>
        </FormGrid>
      </FormSection>

      {!classId && (
        <EmptyState
          icon={CalendarCheck}
          title="Choose a class"
          description="Pick a class above to open its register."
        />
      )}

      {classId && error && <ErrorState message={error} code={code} onRetry={reload} />}
      {classId && loading && !data && !error && <TableSkeleton rows={8} columns={2} />}

      {classId && !error && data && (
        <form onSubmit={save}>
          {data.register.length === 0 ? (
            <EmptyState
              illustration="attendance"
              title="No pupils to mark"
              description="Either this class has nobody on the roll, or it is not one you are assigned to teach."
            />
          ) : (
            <>
              {saveError && (
                <Alert variant="danger" title="Register not saved" className="mb-cards">
                  {saveError}
                </Alert>
              )}

              <Card>
                <CardContent className="p-0">
                  <ul className="divide-y divide-border">
                    {data.register.map((row) => {
                      const current = draft[row.studentId]?.status ?? null
                      return (
                        <li key={row.studentId} className="p-card">
                          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                            <span className="font-medium text-foreground">
                              {row.lastName}, {row.firstName}
                            </span>
                            <span className="font-mono text-xs text-subtle">{row.studentNumber}</span>
                          </div>

                          {/* A radio group, not buttons: one choice per pupil,
                              announced as such, and arrow-key navigable. */}
                          <div
                            role="radiogroup"
                            aria-label={`Attendance for ${row.firstName} ${row.lastName}`}
                            className="flex flex-wrap gap-2"
                          >
                            {QUICK.map((opt) => (
                              <button
                                key={opt.value}
                                type="button"
                                role="radio"
                                aria-checked={current === opt.value}
                                data-on={current === opt.value}
                                disabled={!data.canMark}
                                onClick={() => mark(row.studentId, opt.value)}
                                className={cn(
                                  'min-h-tap flex-1 rounded-md border border-border px-3 py-2',
                                  'text-sm font-medium transition-colors',
                                  'hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-60',
                                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                  opt.tone,
                                )}
                              >
                                {opt.label}
                              </button>
                            ))}

                            <label htmlFor={`other-${row.studentId}`} className="sr-only">
                              Other status for {row.firstName} {row.lastName}
                            </label>
                            <Select
                              id={`other-${row.studentId}`}
                              value={current === 'excused' || current === 'holiday' ? current : ''}
                              disabled={!data.canMark}
                              className="h-auto min-h-tap w-auto py-2 text-sm"
                              onChange={(e) => {
                                if (e.target.value) mark(row.studentId, e.target.value as Status)
                              }}
                            >
                              <option value="">Other…</option>
                              <option value="excused">Excused</option>
                              <option value="holiday">Holiday</option>
                            </Select>
                          </div>

                          {/* Required by `attendance_excused_needs_reason`, and
                              required for a reason: without it an excused
                              absence is indistinguishable from an unexplained
                              one when somebody asks in April. */}
                          {current === 'excused' && (
                            <Input
                              className="mt-2"
                              placeholder="Reason for the excused absence"
                              maxLength={300}
                              value={draft[row.studentId]?.excuseReason ?? ''}
                              onChange={(e) =>
                                setDraft((d) => ({
                                  ...d,
                                  [row.studentId]: { status: 'excused', excuseReason: e.target.value },
                                }))
                              }
                            />
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </CardContent>
              </Card>

              {/* Sticky, because a register is thirty rows long and the save
                  button must not be a scroll away from the last pupil marked. */}
              {data.canMark && (
                <div className="sticky bottom-0 z-20 mt-cards border-t border-border bg-background/95 py-3 backdrop-blur">
                  <div className="flex flex-wrap items-center gap-3">
                    <Button type="submit" disabled={saving || marked === 0}>
                      {saving ? (
                        <Loader2 aria-hidden="true" className="animate-spin" />
                      ) : (
                        <Save aria-hidden="true" />
                      )}
                      Save register
                    </Button>
                    <Button type="button" variant="outline" onClick={markAllPresent}>
                      <CheckCheck aria-hidden="true" />
                      Fill the rest present
                    </Button>
                    <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
                      {saved
                        ? 'Register saved.'
                        : unmarked > 0
                          ? `${marked} of ${total} marked — ${unmarked} still unmarked`
                          : `All ${total} marked`}
                    </p>
                  </div>
                </div>
              )}

              {!data.canMark && (
                <Alert variant="info" title="You can see this register but not change it" className="mt-cards">
                  Marking is done by the class or subject teacher assigned to this class, or by the
                  principal or school owner.
                </Alert>
              )}
            </>
          )}
        </form>
      )}
    </>
  )
}

export default function AttendancePage({
  params,
}: {
  params: Promise<{ schoolCode: string }>
}): JSX.Element {
  use(params)
  return (
    <Suspense fallback={<TableSkeleton rows={8} columns={2} />}>
      <Register />
    </Suspense>
  )
}
