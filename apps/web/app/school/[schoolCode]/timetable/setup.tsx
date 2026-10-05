'use client'

/**
 * Creating a timetable, and defining the school day.
 *
 * Spec: `Official Documentation/08 Staff Management/TIMETABLE.md`
 *
 * ## Why this exists separately from the grid
 *
 * `timetable_periods` belongs to the SCHOOL, not to a timetable. The school day does
 * not change because next term's grid is being drafted, so periods are set once and
 * every timetable uses them. Editing one here changes every grid at once, which is the
 * intent and is said on the screen.
 *
 * ## A period with lessons in it cannot be removed
 *
 * The foreign key cascades, so deleting would silently take every lesson in that period
 * across every timetable — work the person deleting cannot see from here. The function
 * refuses with a count instead, and this shows it.
 */

import type { JSX } from 'react'
import { useCallback, useState } from 'react'
import { Clock, Plus, Trash2 } from 'lucide-react'

import { Badge } from '../../../../components/ui/badge'
import { Button } from '../../../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../../components/ui/card'
import { Field, Input, Select } from '../../../../components/ui/field'
import { useToast } from '../../../../components/ui/toast'
import { apiSend } from '../../../../lib/use-api'

const DAYS = [
  { n: 1, short: 'Mon' },
  { n: 2, short: 'Tue' },
  { n: 3, short: 'Wed' },
  { n: 4, short: 'Thu' },
  { n: 5, short: 'Fri' },
] as const

export interface PeriodRow {
  id: string
  name: string
  startTime: string
  endTime: string
  order: number
  appliesDays: number[]
  teaching: boolean
}

const hhmm = (t: string): string => t.slice(0, 5)

export function TimetableSetup({
  periods,
  hasTimetable,
  onChanged,
}: {
  periods: PeriodRow[]
  hasTimetable: boolean
  onChanged: () => void
}): JSX.Element {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)

  const thisYear = String(new Date().getFullYear())
  const [year, setYear] = useState(thisYear)
  const [term, setTerm] = useState('1')

  const [editing, setEditing] = useState<PeriodRow | null>(null)

  const createTimetable = useCallback(async () => {
    setBusy(true)
    try {
      const result = await apiSend('/api/school/timetable', 'PATCH', {
        action: 'create',
        academicYear: year,
        termNumber: Number(term),
      })
      if (result.error) {
        toast(result.error, 'danger')
        return
      }
      toast('Timetable created. Add the school day below, then fill the grid.', 'success')
      onChanged()
    } finally {
      setBusy(false)
    }
  }, [year, term, toast, onChanged])

  const savePeriod = useCallback(async () => {
    if (!editing) return
    setBusy(true)
    try {
      const result = await apiSend('/api/school/timetable', 'PATCH', {
        action: 'period',
        periodId: editing.id || null,
        name: editing.name,
        startTime: editing.startTime,
        endTime: editing.endTime,
        order: editing.order,
        appliesDays: editing.appliesDays,
        teaching: editing.teaching,
      })
      if (result.error) {
        toast(result.error, 'danger')
        return
      }
      setEditing(null)
      onChanged()
    } finally {
      setBusy(false)
    }
  }, [editing, toast, onChanged])

  const removePeriod = useCallback(
    async (periodId: string) => {
      setBusy(true)
      try {
        const result = await apiSend('/api/school/timetable', 'PATCH', {
          action: 'deletePeriod',
          periodId,
        })
        if (result.error) {
          // Carries the lesson count when it is in use — a real answer, not a failure.
          toast(result.error, 'danger')
          return
        }
        onChanged()
      } finally {
        setBusy(false)
      }
    },
    [toast, onChanged],
  )

  return (
    <Card className="mb-cards">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock aria-hidden="true" className="size-5 text-primary" />
          Set up
        </CardTitle>
        <CardDescription>
          {hasTimetable
            ? 'The shape of your school day. Changing it changes every timetable.'
            : 'Create a timetable for the term, then set the periods that make up your day.'}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-cards">
        {/* ---- create ---- */}
        {!hasTimetable || open ? (
          <div className="flex flex-wrap items-end gap-stack">
            <Field id="tt-year" label="Academic year" required>
              {(props) => (
                <Input {...props} value={year} onChange={(e) => setYear(e.target.value)} maxLength={9} />
              )}
            </Field>
            <Field id="tt-term" label="Term" required>
              {(props) => (
                <Select {...props} value={term} onChange={(e) => setTerm(e.target.value)}>
                  <option value="1">Term 1</option>
                  <option value="2">Term 2</option>
                  <option value="3">Term 3</option>
                </Select>
              )}
            </Field>
            <Button disabled={busy || !year} onClick={() => void createTimetable()}>
              <Plus aria-hidden="true" />
              {busy ? 'Creating…' : 'Create timetable'}
            </Button>
            {hasTimetable && (
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            )}
          </div>
        ) : (
          <Button variant="outline" className="self-start" onClick={() => setOpen(true)}>
            <Plus aria-hidden="true" />
            Another timetable
          </Button>
        )}

        {/* ---- the school day ---- */}
        {hasTimetable && (
          <div className="flex flex-col gap-stack">
            <p className="text-sm font-medium">The school day</p>

            {periods.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No periods yet. A timetable needs these before it can hold a lesson —
                Period 1, break, lunch, and so on.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {periods.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-2 p-stack">
                    <span className="font-medium">{p.name}</span>
                    <span data-numeric className="text-sm text-muted-foreground">
                      {hhmm(p.startTime)}–{hhmm(p.endTime)}
                    </span>
                    {!p.teaching && <Badge variant="neutral">No lessons</Badge>}
                    {p.appliesDays.length < 5 && (
                      <Badge variant="neutral">
                        {p.appliesDays.map((d) => DAYS.find((x) => x.n === d)?.short).join(' ')}
                      </Badge>
                    )}
                    <span className="ml-auto flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(p)}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => void removePeriod(p.id)}
                      >
                        <Trash2 aria-hidden="true" />
                        <span className="sr-only">Remove {p.name}</span>
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <Button
              variant="outline"
              className="self-start"
              onClick={() =>
                setEditing({
                  id: '',
                  name: '',
                  startTime: '07:00',
                  endTime: '08:00',
                  // Next position, so a school adding periods in order never collides.
                  order: (periods.at(-1)?.order ?? 0) + 1,
                  appliesDays: [1, 2, 3, 4, 5],
                  teaching: true,
                })
              }
            >
              <Plus aria-hidden="true" />
              Add a period
            </Button>
          </div>
        )}

        {/* ---- the period editor ---- */}
        {editing && (
          <div className="flex flex-col gap-stack rounded-md border border-border p-card">
            <Field id="p-name" label="Name" required hint="Period 1, Break, Lunch, Assembly…">
              {(props) => (
                <Input
                  {...props}
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  maxLength={60}
                />
              )}
            </Field>

            <div className="flex flex-wrap gap-stack">
              <Field id="p-start" label="Starts" required>
                {(props) => (
                  <Input
                    {...props}
                    type="time"
                    value={editing.startTime}
                    onChange={(e) => setEditing({ ...editing, startTime: e.target.value })}
                  />
                )}
              </Field>
              <Field id="p-end" label="Ends" required>
                {(props) => (
                  <Input
                    {...props}
                    type="time"
                    value={editing.endTime}
                    onChange={(e) => setEditing({ ...editing, endTime: e.target.value })}
                  />
                )}
              </Field>
              <Field id="p-order" label="Position" hint="Where it sits in the day.">
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    min={1}
                    max={99}
                    value={String(editing.order)}
                    onChange={(e) => setEditing({ ...editing, order: Number(e.target.value) })}
                  />
                )}
              </Field>
            </div>

            <Field id="p-days" label="Days it runs">
              {() => (
                <div className="flex flex-wrap gap-2">
                  {DAYS.map((d) => (
                    <label key={d.n} className="flex min-h-tap cursor-pointer items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={editing.appliesDays.includes(d.n)}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            appliesDays: e.target.checked
                              ? [...editing.appliesDays, d.n].sort()
                              : editing.appliesDays.filter((x) => x !== d.n),
                          })
                        }
                      />
                      {d.short}
                    </label>
                  ))}
                </div>
              )}
            </Field>

            <label className="flex min-h-tap cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={!editing.teaching}
                onChange={(e) => setEditing({ ...editing, teaching: !e.target.checked })}
              />
              {/* Phrased as the exception, because most periods are lessons. */}
              This is a break, lunch or assembly — no lessons go in it
            </label>

            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy || !editing.name.trim() || editing.appliesDays.length === 0}
                onClick={() => void savePeriod()}
              >
                {busy ? 'Saving…' : 'Save period'}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
