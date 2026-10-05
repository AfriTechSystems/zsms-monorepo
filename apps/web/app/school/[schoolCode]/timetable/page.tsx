'use client'

/**
 * The timetable: build it, publish it, see it.
 *
 * Spec: `Official Documentation/08 Staff Management/TIMETABLE.md`
 *
 * ## What the first version got wrong
 *
 * Reported from use: "dropdowns are not working, required fields are not showing."
 * Three faults, all mine:
 *
 *   * The CLASS list was derived from existing timetable slots. A new timetable has
 *     none, so the list was empty, so no cell could be opened and no slot could ever
 *     be created. Classes come from the school's PUPILS, which exist first.
 *   * The SUBJECT list offered every subject the school has. The spec says "subjects
 *     for this grade level", and a Grade 2 class was being offered A-Level Biology.
 *   * The TEACHER list offered every active member of staff, including the bursar.
 *     The spec is explicit: only teachers with a matching `teacher_assignments` row.
 *
 * All three now come from `school_class_list()` and `timetable_slot_options()`.
 * `notes`, which the spec's panel includes and I had omitted, is here too.
 *
 * ## Clashes are the database's answer
 *
 * Partial unique indexes make a double-booking impossible and `set_timetable_slot()`
 * phrases the violation — "That teacher is already taking 9B at this time". This
 * screen shows that sentence and checks nothing itself: a check here would race two
 * deputies editing at once and would be the copy that drifts.
 */

import type { JSX } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { CalendarDays, Check, Eye, EyeOff, Trash2, X } from 'lucide-react'

import { Alert } from '../../../../components/ui/alert'
import { Badge } from '../../../../components/ui/badge'
import { Button } from '../../../../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../../components/ui/card'
import { ErrorState, PageHeader, TableSkeleton } from '../../../../components/ui/data-states'
import { Dialog } from '../../../../components/ui/dialog'
import { Field, Input, Select, Textarea } from '../../../../components/ui/field'
import { useToast } from '../../../../components/ui/toast'
import { apiSend, useApi } from '../../../../lib/use-api'
import { TimetableSetup, type PeriodRow } from './setup'
import { DAYS, WeekGrid, hhmm, type Period, type Slot } from './week-grid'

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
  out_applies_to_levels: string[] | null
  out_day_of_week: number | null
  out_subject_id: string | null
  out_subject_name: string | null
  out_staff_user_id: string | null
  out_slot_type: string | null
  out_room: string | null
  out_notes: string | null
}

interface Option {
  id: string
  name: string | null
  detail: string | null
  subjectId?: string | null
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
  classes: Array<{
    out_class_id: string
    out_pupils: number
    out_level_name: string | null
    out_level_order: number | null
    out_stream: string | null
  }>
  levels: Array<{ level_id: string; display_name: string; level_order: number }>
  subjects: Option[]
  staff: Option[]
  canEdit: boolean
}

interface Editing {
  periodId: string
  periodName: string
  dayOfWeek: number
  slotId: string | null
  subjectId: string
  staffUserId: string
  room: string
  notes: string
}

export default function TimetablePage(): JSX.Element {
  const { toast } = useToast()
  const [timetableId, setTimetableId] = useState<string | null>(null)
  const [classId, setClassId] = useState<string>('')
  const [editing, setEditing] = useState<Editing | null>(null)
  const [busy, setBusy] = useState(false)

  /*
    `classId` is part of the request, not just a filter.

    Subjects are scoped to the class's grade level and teachers to its assignments, so
    changing the class has to re-ask the server rather than filter what is already here.
  */
  const query = new URLSearchParams()
  if (timetableId) query.set('timetableId', timetableId)
  if (classId) query.set('classId', classId)

  const { data, loading, error, code, reload } = useApi<Payload>(
    `/api/school/timetable${query.toString() ? `?${query.toString()}` : ''}`,
  )

  const grid = useMemo(() => data?.grid ?? [], [data])
  const current = data?.timetables.find((t) => t.id === (timetableId ?? grid[0]?.out_timetable_id))

  // Default to the first class once the list arrives, so the grid is never blank for
  // want of a selection nobody was asked to make.
  const shownClass = classId || data?.classes[0]?.out_class_id || ''

  const periods: Period[] = useMemo(() => {
    const seen = new Map<string, Period>()
    for (const r of grid) {
      if (seen.has(r.out_period_id)) continue
      seen.set(r.out_period_id, {
        id: r.out_period_id,
        name: r.out_period_name,
        startTime: r.out_start_time,
        endTime: r.out_end_time,
        order: r.out_period_order,
        teaching: r.out_teaching,
        appliesDays: r.out_applies_days,
        levels: r.out_applies_to_levels ?? [],
      })
    }
    return [...seen.values()].sort((a, b) => a.order - b.order)
  }, [grid])

  const periodRows: PeriodRow[] = useMemo(
    () =>
      periods.map((p) => ({
        id: p.id,
        name: p.name,
        startTime: p.startTime,
        endTime: p.endTime,
        order: p.order,
        appliesDays: p.appliesDays,
        teaching: p.teaching,
        levels: p.levels,
      })),
    [periods],
  )

  const slots: Slot[] = useMemo(
    () =>
      grid
        .filter((r) => r.out_slot_id && r.out_class_id === shownClass && r.out_day_of_week)
        .map((r) => ({
          id: r.out_slot_id as string,
          periodId: r.out_period_id,
          day: r.out_day_of_week as number,
          subjectName: r.out_subject_name,
          teacherName: data?.staff.find((s) => s.id === r.out_staff_user_id)?.name ?? null,
          room: r.out_room,
          slotType: r.out_slot_type ?? 'lesson',
        })),
    [grid, shownClass, data],
  )

  /*
    Teachers this subject's assignment covers.

    A form teacher (`subjectId: null`) covers any subject; a subject teacher covers
    one. Narrowed in the browser because the server already sent both facts — a round
    trip on every dropdown change would be slower and no more correct.
  */
  const eligibleStaff = useMemo(() => {
    const all = data?.staff ?? []
    if (!editing?.subjectId) return all
    return all.filter((s) => !s.subjectId || s.subjectId === editing.subjectId)
  }, [data, editing])

  const save = useCallback(async () => {
    if (!editing || !current || !shownClass) return
    setBusy(true)
    try {
      const result = await apiSend('/api/school/timetable', 'POST', {
        timetableId: current.id,
        classId: shownClass,
        periodId: editing.periodId,
        dayOfWeek: editing.dayOfWeek,
        subjectId: editing.subjectId || null,
        staffUserId: editing.staffUserId || null,
        slotType: 'lesson',
        room: editing.room || null,
        notes: editing.notes || null,
      })
      if (result.error) {
        // The clash sentence the database composed, shown unchanged.
        toast(result.error, 'danger')
        return
      }
      setEditing(null)
      reload()
    } finally {
      setBusy(false)
    }
  }, [editing, current, shownClass, toast, reload])

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

  if (loading && !data) return <TableSkeleton rows={8} columns={6} />
  if (error) return <ErrorState message={error} code={code} onRetry={reload} />

  return (
    <>
      <PageHeader
        title="Weekly timetable"
        description="The lesson grid for each class."
        note="A teacher cannot be in two places at once, and nor can a room — the database refuses a clash and names where the conflict already is. Only teachers assigned to a class can be put in front of it. Nobody outside management sees a timetable until you publish it."
      />

      {data?.canEdit && (
        <TimetableSetup
          periods={periodRows}
          levels={data?.levels ?? []}
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

      {(data?.classes.length ?? 0) === 0 && (data?.timetables.length ?? 0) > 0 && (
        <Alert variant="warning" title="No classes yet">
          Classes come from your pupils. Enrol a pupil and their class appears here — a
          timetable is laid out per class, so there is nothing to build until then.
        </Alert>
      )}

      {periods.length > 0 && shownClass && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-stack">
            <div>
              <CardTitle className="flex items-center gap-2">
                <CalendarDays aria-hidden="true" className="size-5 text-primary" />
                {shownClass}
              </CardTitle>
              <CardDescription>
                {data?.canEdit
                  ? 'Tap a cell to put a lesson in it.'
                  : 'Read only — your role does not include editing the timetable.'}
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* A real dropdown of the school's classes. The first version was a
                  free-text box backed by a list derived from slots that did not exist,
                  so it was always empty. */}
              <Select
                id="tt-class"
                aria-label="Class"
                value={shownClass}
                onChange={(e) => setClassId(e.target.value)}
                className="w-auto"
              >
                {(data?.classes ?? []).map((c) => (
                  <option key={c.out_class_id} value={c.out_class_id}>
                    {c.out_class_id}
                    {c.out_pupils ? ` · ${c.out_pupils} pupils` : ''}
                  </option>
                ))}
              </Select>

              {(data?.timetables.length ?? 0) > 1 && (
                <Select
                  id="tt-which"
                  aria-label="Timetable"
                  value={current?.id ?? ''}
                  onChange={(e) => setTimetableId(e.target.value)}
                  className="w-auto"
                >
                  {(data?.timetables ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} · {t.academic_year} T{t.term_number}
                      {t.published ? '' : ' (draft)'}
                    </option>
                  ))}
                </Select>
              )}

              {current && (
                <>
                  <Badge variant={current.published ? 'success' : 'neutral'}>
                    {current.published ? 'Published' : 'Draft'}
                  </Badge>
                  {data?.canEdit && (
                    <Button variant="outline" disabled={busy} onClick={() => void togglePublish()}>
                      {current.published ? (
                        <EyeOff aria-hidden="true" />
                      ) : (
                        <Eye aria-hidden="true" />
                      )}
                      {current.published ? 'Withdraw' : 'Publish'}
                    </Button>
                  )}
                </>
              )}
            </div>
          </CardHeader>

          <CardContent>
            <WeekGrid
              periods={periods}
              slots={slots}
              canEdit={Boolean(data?.canEdit)}
              onOpen={(periodId, day, slot) => {
                const p = periods.find((x) => x.id === periodId)
                const row = grid.find(
                  (r) =>
                    r.out_period_id === periodId &&
                    r.out_day_of_week === day &&
                    r.out_class_id === shownClass,
                )
                setEditing({
                  periodId,
                  periodName: p?.name ?? '',
                  dayOfWeek: day,
                  slotId: slot?.id ?? null,
                  subjectId: row?.out_subject_id ?? '',
                  staffUserId: row?.out_staff_user_id ?? '',
                  room: row?.out_room ?? '',
                  notes: row?.out_notes ?? '',
                })
              }}
            />
          </CardContent>
        </Card>
      )}

      {/*
        A modal, not a panel below the grid.

        Asked for on 2026-10-05: the editor appeared under the table, so choosing a
        subject meant losing sight of the cell being edited and scrolling back to check
        which one it was. `<dialog>` keeps the question and its context together, and
        brings focus trapping and Escape with it rather than reimplementing them.
      */}
      <Dialog
        open={editing !== null}
        title={editing?.slotId ? 'Edit lesson' : 'Add lesson'}
        description={
          editing
            ? `${shownClass} · ${DAYS.find((d) => d.n === editing.dayOfWeek)?.label} · ${editing.periodName}`
            : undefined
        }
        onClose={() => setEditing(null)}
        footer={
          editing && (
            <>
              <Button disabled={busy || !editing.subjectId} onClick={() => void save()}>
                <Check aria-hidden="true" />
                {busy ? 'Saving…' : editing.slotId ? 'Save lesson' : 'Add lesson'}
              </Button>
              {editing.slotId && (
                <Button variant="outline" disabled={busy} onClick={() => void clear()}>
                  <Trash2 aria-hidden="true" />
                  Clear slot
                </Button>
              )}
              <Button variant="ghost" disabled={busy} onClick={() => setEditing(null)}>
                <X aria-hidden="true" />
                Cancel
              </Button>
            </>
          )
        }
      >
        {editing && (
          <div className="flex flex-col gap-stack">
            <Field
              id="slot-subject"
              label="Subject"
              required
              hint="Only subjects your school offers at this grade level."
            >
              {(props) => (
                <Select
                  {...props}
                  value={editing.subjectId}
                  onChange={(e) =>
                    setEditing({ ...editing, subjectId: e.target.value, staffUserId: '' })
                  }
                >
                  <option value="">Choose a subject</option>
                  {(data?.subjects ?? []).map((sb) => (
                    <option key={sb.id} value={sb.id}>
                      {sb.name}
                      {sb.detail ? ` · ${sb.detail}` : ''}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field
              id="slot-teacher"
              label="Teacher"
              hint="Only teachers assigned to this class. Leave blank if it is not decided — the lesson still appears on the grid."
            >
              {(props) => (
                <Select
                  {...props}
                  value={editing.staffUserId}
                  onChange={(e) => setEditing({ ...editing, staffUserId: e.target.value })}
                >
                  <option value="">Not assigned</option>
                  {eligibleStaff.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.name ?? st.id}
                      {st.detail ? ` · ${st.detail}` : ''}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            {(data?.staff.length ?? 0) === 0 && (
              /* The likeliest reason the dropdown is empty, and what to do about it —
                 rather than a control that silently offers nothing. */
              <Alert variant="info" title="No teachers assigned to this class">
                A teacher appears here once they have a teaching assignment for{' '}
                {shownClass}. Those are set on the Teaching assignments screen.
              </Alert>
            )}

            <Field id="slot-room" label="Room" hint="Optional. Two classes cannot share one.">
              {(props) => (
                <Input
                  {...props}
                  value={editing.room}
                  onChange={(e) => setEditing({ ...editing, room: e.target.value })}
                  maxLength={60}
                  placeholder="R101"
                />
              )}
            </Field>

            <Field id="slot-notes" label="Notes" hint="Optional. Seen by staff, not by parents.">
              {(props) => (
                <Textarea
                  {...props}
                  value={editing.notes}
                  onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                  rows={2}
                  maxLength={500}
                />
              )}
            </Field>
          </div>
        )}
      </Dialog>

      {periods.length > 0 && (
        <p className="mt-stack text-sm text-muted-foreground">
          {periods.filter((p) => p.teaching).length} teaching periods,{' '}
          {hhmm(periods[0]?.startTime ?? '00:00')} to {hhmm(periods.at(-1)?.endTime ?? '00:00')}.
        </p>
      )}
    </>
  )
}
