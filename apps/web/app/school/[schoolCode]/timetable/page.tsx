'use client'

/**
 * The timetable: build it, publish it, see it.
 *
 * Spec: `Official Documentation/08 Staff Management/TIMETABLE.md`
 *
 * ## A grid of cells, edited one at a time
 *
 * The spec describes drag-and-drop. This is a grid where a cell opens an editor, which
 * does the same job on a laptop and still works on the tablet a deputy actually carries
 * round a staffroom. Drag-and-drop can be added over the same endpoint later; the
 * saving, the clash detection and the permissions do not change.
 *
 * ## Clashes come from the database, phrased for a person
 *
 * Partial unique indexes make a double-booking impossible, and `set_timetable_slot()`
 * turns the violation into "That teacher is already taking 9B at this time". This
 * screen shows that sentence. It does not check for clashes itself — a check here would
 * race two deputies editing at once and would be the copy that drifts.
 *
 * ## Draft and published are a real distinction
 *
 * Nobody but management sees a draft, which is the point: next term's grid can be built
 * in front of this term's without a teacher reading a version that will change.
 */

import type { JSX } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { CalendarDays, Check, Eye, EyeOff, Trash2, X } from 'lucide-react'

import { Alert } from '../../../../components/ui/alert'
import { Badge } from '../../../../components/ui/badge'
import { Button } from '../../../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../../components/ui/card'
import { ErrorState, PageHeader, TableSkeleton } from '../../../../components/ui/data-states'
import { Field, Input, Select } from '../../../../components/ui/field'
import { useToast } from '../../../../components/ui/toast'
import { apiSend, useApi } from '../../../../lib/use-api'
import { TimetableSetup, type PeriodRow } from './setup'

const DAYS = [
  { n: 1, label: 'Monday', short: 'Mon' },
  { n: 2, label: 'Tuesday', short: 'Tue' },
  { n: 3, label: 'Wednesday', short: 'Wed' },
  { n: 4, label: 'Thursday', short: 'Thu' },
  { n: 5, label: 'Friday', short: 'Fri' },
] as const

interface GridRow {
  out_timetable_id: string
  out_name: string
  out_published: boolean
  out_slot_id: string | null
  out_class_id: string | null
  out_period_id: string
  out_period_name: string
  out_start_time: string
  out_end_time: string
  out_period_order: number
  out_teaching: boolean
  out_applies_days: number[]
  out_day_of_week: number | null
  out_subject_id: string | null
  out_subject_name: string | null
  out_staff_user_id: string | null
  out_slot_type: string | null
  out_room: string | null
}

interface Payload {
  grid: GridRow[]
  timetables: Array<{
    id: string
    name: string
    academic_year: string
    term_number: number
    is_active: boolean
    published: boolean
  }>
  subjects: Array<{ id: string; subject_code: string; subject_name: string }>
  staff: Array<{ clerk_user_id: string; first_name: string; last_name: string }>
  canEdit: boolean
}

interface Editing {
  classId: string
  periodId: string
  periodName: string
  dayOfWeek: number
  slotId: string | null
  subjectId: string
  staffUserId: string
  room: string
  slotType: string
}

const hhmm = (t: string): string => t.slice(0, 5)

export default function TimetablePage(): JSX.Element {
  const { toast } = useToast()
  const [timetableId, setTimetableId] = useState<string | null>(null)
  const [classId, setClassId] = useState<string>('')
  const [editing, setEditing] = useState<Editing | null>(null)
  const [busy, setBusy] = useState(false)

  const { data, loading, error, code, reload } = useApi<Payload>(
    `/api/school/timetable${timetableId ? `?timetableId=${timetableId}` : ''}`,
  )

  // Memoised: `data?.grid ?? []` builds a new array on every render, so the three
  // hooks below would recompute each time and `slotAt` would change identity.
  const grid = useMemo(() => data?.grid ?? [], [data])
  const current = data?.timetables.find((t) => t.id === (timetableId ?? grid[0]?.out_timetable_id))

  // Every period, once. The grid returns a row per period-slot pairing, so the row
  // labels have to be collapsed out of it.
  const periods = useMemo(() => {
    const seen = new Map<string, GridRow>()
    for (const r of grid) if (!seen.has(r.out_period_id)) seen.set(r.out_period_id, r)
    return [...seen.values()].sort((a, b) => a.out_period_order - b.out_period_order)
  }, [grid])

  /*
    Which classes to show as columns.

    Taken from the slots that exist, plus whatever the user types in. A school with no
    timetable yet has no classes to infer, so the field is how the first one is added —
    rather than a separate "create a class" step for something that is only a label.
  */
  const classes = useMemo(() => {
    const set = new Set(grid.map((r) => r.out_class_id).filter((c): c is string => Boolean(c)))
    return [...set].sort()
  }, [grid])

  const periodRows: PeriodRow[] = useMemo(
    () =>
      periods.map((p) => ({
        id: p.out_period_id,
        name: p.out_period_name,
        startTime: p.out_start_time,
        endTime: p.out_end_time,
        order: p.out_period_order,
        appliesDays: p.out_applies_days,
        teaching: p.out_teaching,
      })),
    [periods],
  )

  const slotAt = useCallback(
    (periodId: string, day: number, cls: string): GridRow | undefined =>
      grid.find(
        (r) => r.out_period_id === periodId && r.out_day_of_week === day && r.out_class_id === cls,
      ),
    [grid],
  )

  const save = useCallback(async () => {
    if (!editing || !current) return
    setBusy(true)
    try {
      const result = await apiSend('/api/school/timetable', 'POST', {
        timetableId: current.id,
        classId: editing.classId,
        periodId: editing.periodId,
        dayOfWeek: editing.dayOfWeek,
        subjectId: editing.subjectId || null,
        staffUserId: editing.staffUserId || null,
        slotType: editing.slotType,
        room: editing.room || null,
      })
      if (result.error) {
        // The clash sentence the database composed, shown as-is.
        toast(result.error, 'danger')
        return
      }
      setEditing(null)
      reload()
    } finally {
      setBusy(false)
    }
  }, [editing, current, toast, reload])

  const clear = useCallback(async () => {
    if (!editing?.slotId) return
    setBusy(true)
    try {
      const result = await apiSend('/api/school/timetable', 'PATCH', {
        action: 'clear',
        slotId: editing.slotId,
      })
      if (result.error) {
        toast(result.error, 'danger')
        return
      }
      setEditing(null)
      reload()
    } finally {
      setBusy(false)
    }
  }, [editing, toast, reload])

  const togglePublish = useCallback(async () => {
    if (!current) return
    setBusy(true)
    try {
      const result = await apiSend<{ unstaffed: number; message: string }>(
        '/api/school/timetable',
        'PATCH',
        { action: 'publish', timetableId: current.id, published: !current.published },
      )
      if (result.error) {
        toast(result.error, 'danger')
        return
      }
      const unstaffed = result.data?.unstaffed ?? 0
      toast(
        unstaffed > 0
          ? `${result.data?.message} ${unstaffed} lesson${unstaffed === 1 ? '' : 's'} still has no teacher.`
          : (result.data?.message ?? 'Done.'),
        'success',
      )
      reload()
    } finally {
      setBusy(false)
    }
  }, [current, toast, reload])

  if (loading) return <TableSkeleton rows={8} columns={6} />
  if (error) return <ErrorState message={error} code={code} onRetry={reload} />

  const shownClass = classId || classes[0] || ''

  return (
    <>
      <PageHeader
        title="Timetable"
        description="The weekly lesson grid for each class."
        note="A teacher cannot be in two places at once, and nor can a room — the database refuses a clash and names where the conflict already is. Nobody outside management sees a timetable until you publish it."
      />

      {/* ---- which timetable, and its state ---- */}
      <Card className="mb-cards">
        <CardContent className="flex flex-wrap items-end gap-stack pt-card">
          <Field id="tt-which" label="Timetable">
            {(props) => (
              <Select
                {...props}
                value={current?.id ?? ''}
                onChange={(e) => setTimetableId(e.target.value)}
              >
                {(data?.timetables ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.academic_year} term {t.term_number}
                    {t.published ? '' : ' (draft)'}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field id="tt-class" label="Class" hint="Type a new one to start its grid.">
            {(props) => (
              <Input
                {...props}
                list="tt-classes"
                value={shownClass}
                onChange={(e) => setClassId(e.target.value)}
                placeholder="grade_8a"
              />
            )}
          </Field>
          <datalist id="tt-classes">
            {classes.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>

          {current && (
            <div className="flex items-center gap-2">
              <Badge variant={current.published ? 'success' : 'neutral'}>
                {current.published ? 'Published' : 'Draft'}
              </Badge>
              {data?.canEdit && (
                <Button variant="outline" disabled={busy} onClick={() => void togglePublish()}>
                  {current.published ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                  {current.published ? 'Withdraw' : 'Publish'}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Creating the timetable and the school day. Shown only to somebody who can
          edit — for everybody else it would be a panel of refusals. */}
      {data?.canEdit && (
        <TimetableSetup
          periods={periodRows}
          hasTimetable={(data?.timetables.length ?? 0) > 0}
          onChanged={reload}
        />
      )}

      {(data?.timetables.length ?? 0) === 0 && !data?.canEdit && (
        <Alert variant="info" title="No timetable yet">
          Your school has not set one up. The owner, principal or administrator can
          create it.
        </Alert>
      )}

      {/* ---- the grid ---- */}
      {periods.length > 0 && shownClass && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays aria-hidden="true" className="size-5 text-primary" />
              {shownClass}
            </CardTitle>
            <CardDescription>
              {data?.canEdit
                ? 'Tap a cell to put a lesson in it.'
                : 'Read only — your role does not include editing the timetable.'}
            </CardDescription>
          </CardHeader>

          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[42rem] border-collapse text-sm">
              <caption className="sr-only">Weekly timetable for {shownClass}</caption>
              <thead>
                <tr>
                  <th scope="col" className="p-2 text-left font-medium text-muted-foreground">
                    Period
                  </th>
                  {DAYS.map((d) => (
                    <th
                      key={d.n}
                      scope="col"
                      className="p-2 text-left font-medium text-muted-foreground"
                    >
                      {d.short}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => (
                  <tr key={p.out_period_id} className="border-t border-border">
                    <th scope="row" className="p-2 text-left align-top font-medium">
                      {p.out_period_name}
                      <span className="block text-sm font-normal text-muted-foreground">
                        {hhmm(p.out_start_time)}–{hhmm(p.out_end_time)}
                      </span>
                    </th>

                    {DAYS.map((d) => {
                      // A period that does not run on this day is not an empty cell —
                      // it is not a cell at all, and must not invite a lesson.
                      if (!p.out_applies_days.includes(d.n)) {
                        return (
                          <td key={d.n} className="bg-sunken p-2 align-top text-subtle">
                            —
                          </td>
                        )
                      }

                      const slot = slotAt(p.out_period_id, d.n, shownClass)
                      const editable = data?.canEdit && p.out_teaching

                      return (
                        <td key={d.n} className="p-1 align-top">
                          <button
                            type="button"
                            disabled={!editable}
                            onClick={() =>
                              setEditing({
                                classId: shownClass,
                                periodId: p.out_period_id,
                                periodName: p.out_period_name,
                                dayOfWeek: d.n,
                                slotId: slot?.out_slot_id ?? null,
                                subjectId: slot?.out_subject_id ?? '',
                                staffUserId: slot?.out_staff_user_id ?? '',
                                room: slot?.out_room ?? '',
                                slotType: slot?.out_slot_type ?? 'lesson',
                              })
                            }
                            className={`flex min-h-tap w-full flex-col items-start gap-0.5 rounded-md border p-2 text-left transition-colors ${
                              slot
                                ? 'border-border bg-surface'
                                : 'border-dashed border-border text-muted-foreground'
                            } ${editable ? 'hover:border-primary hover:bg-muted' : 'cursor-default'}`}
                          >
                            {slot ? (
                              <>
                                <span className="font-medium">
                                  {slot.out_subject_name ?? slot.out_slot_type}
                                </span>
                                {slot.out_staff_user_id ? (
                                  <span className="text-sm text-muted-foreground">
                                    {data?.staff.find(
                                      (s) => s.clerk_user_id === slot.out_staff_user_id,
                                    )
                                      ? `${data.staff.find((s) => s.clerk_user_id === slot.out_staff_user_id)?.first_name} ${data.staff.find((s) => s.clerk_user_id === slot.out_staff_user_id)?.last_name}`
                                      : 'Staff member'}
                                  </span>
                                ) : (
                                  /* Named, not left blank: an unstaffed lesson is the
                                     thing a deputy is looking for before term starts. */
                                  <Badge variant="warning">No teacher</Badge>
                                )}
                                {slot.out_room && (
                                  <span className="text-sm text-subtle">{slot.out_room}</span>
                                )}
                              </>
                            ) : p.out_teaching ? (
                              <span className="text-sm">{editable ? 'Add' : '—'}</span>
                            ) : (
                              <span className="text-sm">{p.out_period_name}</span>
                            )}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* ---- the cell editor ---- */}
      {editing && (
        <Card className="mt-cards">
          <CardHeader>
            <CardTitle>
              {editing.classId} · {editing.periodName} ·{' '}
              {DAYS.find((d) => d.n === editing.dayOfWeek)?.label}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-stack">
            <Field id="slot-subject" label="Subject">
              {(props) => (
                <Select
                  {...props}
                  value={editing.subjectId}
                  onChange={(e) => setEditing({ ...editing, subjectId: e.target.value })}
                >
                  <option value="">No subject</option>
                  {(data?.subjects ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.subject_name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field
              id="slot-teacher"
              label="Teacher"
              hint="Leave blank for now if it is not decided — the lesson still appears on the grid."
            >
              {(props) => (
                <Select
                  {...props}
                  value={editing.staffUserId}
                  onChange={(e) => setEditing({ ...editing, staffUserId: e.target.value })}
                >
                  <option value="">Not assigned</option>
                  {(data?.staff ?? []).map((s) => (
                    <option key={s.clerk_user_id} value={s.clerk_user_id}>
                      {s.first_name} {s.last_name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field id="slot-room" label="Room" hint="Optional. Two classes cannot share one.">
              {(props) => (
                <Input
                  {...props}
                  value={editing.room}
                  onChange={(e) => setEditing({ ...editing, room: e.target.value })}
                  maxLength={60}
                  placeholder="Lab 1"
                />
              )}
            </Field>

            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => void save()}>
                <Check aria-hidden="true" />
                {busy ? 'Saving…' : 'Save'}
              </Button>
              {editing.slotId && (
                <Button variant="outline" disabled={busy} onClick={() => void clear()}>
                  <Trash2 aria-hidden="true" />
                  Clear
                </Button>
              )}
              <Button variant="ghost" disabled={busy} onClick={() => setEditing(null)}>
                <X aria-hidden="true" />
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  )
}
