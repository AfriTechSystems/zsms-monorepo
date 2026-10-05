'use client'

/**
 * Setting a timetable up: the term, the shape of the school day, and what to do next.
 *
 * Spec: `Official Documentation/08 Staff Management/TIMETABLE.md`
 *
 * ## Three things were wrong with the first version, all reported on 2026-10-05
 *
 * **Both forms appeared inline.** Creating a timetable pushed the grid down the page;
 * adding a period opened a tall form below a list that was already tall. A popup keeps
 * the question on top of the thing it is about and leaves the page where it was.
 *
 * **Every period took a full row.** Twelve periods meant twelve rows of mostly
 * whitespace and a grid scrolled off the bottom of the screen. A school day is a
 * SEQUENCE, so it is now one horizontal strip of chips in time order — the same
 * information in one row instead of twelve, and the shape of the day readable at a
 * glance rather than reconstructed by reading times down a column.
 *
 * **Nothing said where to start.** The three actions have a strict order — a period
 * cannot exist without a timetable, a lesson cannot exist without a period — and the
 * screen presented them as three equal buttons. It now presents them as steps, with the
 * next one marked and the ones that cannot work yet disabled and explaining why.
 *
 * ## Why the steps are derived, not stored
 *
 * Each step's state is computed from the data every time: a timetable exists or it does
 * not, periods exist or they do not. There is no "setup progress" column to get out of
 * step with reality, and a school that deletes every period correctly goes back to step
 * two rather than being told it has finished.
 */

import type { ChangeEvent, JSX } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { Check, Clock, Pencil, Plus, Trash2 } from 'lucide-react'

import { Alert } from '../../../../components/ui/alert'
import { Badge } from '../../../../components/ui/badge'
import { Button } from '../../../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../../components/ui/card'
import { Dialog } from '../../../../components/ui/dialog'
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
  levels: string[]
}

export interface GradeLevel {
  level_id: string
  display_name: string
}

const hhmm = (t: string): string => t.slice(0, 5)

/** A blank period, positioned after the last one so additions never collide. */
function blankPeriod(periods: PeriodRow[]): PeriodRow {
  const last = periods.at(-1)
  return {
    id: '',
    name: '',
    // Starting where the previous period ended is right far more often than 07:00 is,
    // and a school adding a day in sequence then never retypes a time.
    startTime: last ? hhmm(last.endTime) : '07:00',
    endTime: last ? hhmm(last.endTime) : '08:00',
    order: (last?.order ?? 0) + 1,
    appliesDays: [1, 2, 3, 4, 5],
    teaching: true,
    // Every grade by default: what most schools want, and what every period created
    // before `0206` means.
    levels: [],
  }
}

/**
 * One step of the setup sequence.
 *
 * `done` and `blocked` are separate: a step that cannot be attempted yet looks different
 * from one already finished, and collapsing them would tell a school with no timetable
 * that adding periods was complete.
 */
function Step({
  n,
  title,
  description,
  done,
  blocked,
  blockedReason,
  action,
}: {
  n: number
  title: string
  description: string
  done: boolean
  blocked: boolean
  blockedReason?: string
  action?: JSX.Element
}): JSX.Element {
  return (
    <li className="flex gap-stack">
      {/* The number doubles as the state: a tick when done, grey when unreachable. */}
      <span
        aria-hidden="true"
        data-numeric
        className={`flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
          done
            ? 'bg-success text-success-foreground'
            : blocked
              ? 'bg-muted text-muted-foreground'
              : 'bg-primary text-primary-foreground'
        }`}
      >
        {done ? <Check aria-hidden="true" className="size-4" /> : n}
      </span>

      <div className="flex min-w-0 flex-col gap-1">
        <p className={`text-sm font-medium ${blocked ? 'text-muted-foreground' : ''}`}>
          {title}
          {done && (
            <span className="ml-2 align-middle">
              <Badge variant="success">Done</Badge>
            </span>
          )}
        </p>

        <p className="text-sm text-muted-foreground">
          {blocked ? (blockedReason ?? description) : description}
        </p>

        {/* Hidden rather than disabled when blocked: there is nothing to press yet, and
            a disabled button invites clicking to find out why. */}
        {!blocked && action}
      </div>
    </li>
  )
}

export function TimetableSetup({
  periods,
  levels,
  hasTimetable,
  hasClasses,
  lessonCount,
  published,
  onChanged,
}: {
  periods: PeriodRow[]
  levels: GradeLevel[]
  hasTimetable: boolean
  /** Without a class there is no column to put a lesson in, so step 3 cannot start. */
  hasClasses: boolean
  /** Lessons already placed, which is what makes step 3 done. */
  lessonCount: number
  published: boolean
  onChanged: () => void
}): JSX.Element {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)

  const thisYear = String(new Date().getFullYear())
  const [year, setYear] = useState(thisYear)
  const [term, setTerm] = useState('1')

  /** Null when closed. The create form and the period form are separate dialogs. */
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<PeriodRow | null>(null)

  const teachingCount = useMemo(() => periods.filter((p) => p.teaching).length, [periods])

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
      setCreating(false)
      toast('Timetable created. Now set the periods that make up your day.', 'success')
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
        levels: editing.levels,
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
        setEditing(null)
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
          {published
            ? 'This timetable is published. Changing the school day changes every timetable that uses it.'
            : 'Four steps, in order. Each one opens when the one before it is done.'}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-cards">
        {/* ---------------- the guided sequence ---------------- */}
        <ol className="flex flex-col gap-cards">
          <Step
            n={1}
            title="Create a timetable for the term"
            description="One timetable per term. Every class shares it."
            done={hasTimetable}
            blocked={false}
            action={
              <Button
                variant={hasTimetable ? 'outline' : 'default'}
                size="sm"
                className="self-start"
                onClick={() => setCreating(true)}
              >
                <Plus aria-hidden="true" />
                {hasTimetable ? 'Another timetable' : 'Start here'}
              </Button>
            }
          />

          <Step
            n={2}
            title="Set the shape of your school day"
            description="Period 1, break, lunch, and so on. These are the rows of every grid."
            done={hasTimetable && teachingCount > 0}
            blocked={!hasTimetable}
            blockedReason="Create a timetable first — periods belong to one."
            action={
              <div className="flex flex-col gap-stack">
                {/* The day as a strip, in time order. One row for the whole day. */}
                {periods.length > 0 && (
                  <ul className="flex flex-wrap gap-2">
                    {periods.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => setEditing(p)}
                          title={`${p.name} · ${hhmm(p.startTime)}–${hhmm(p.endTime)}${
                            p.teaching ? '' : ' · no lessons'
                          }`}
                          className={`group flex min-h-tap flex-col items-start rounded-md border px-2.5 py-1.5 text-left transition-colors ${
                            p.teaching
                              ? 'border-primary/30 bg-primary/5 hover:bg-primary/10'
                              : 'border-border bg-muted hover:bg-muted/70'
                          }`}
                        >
                          <span className="flex items-center gap-1 text-sm font-medium leading-tight">
                            {p.name}
                            <Pencil
                              aria-hidden="true"
                              className="size-3 opacity-0 transition-opacity group-hover:opacity-60"
                            />
                          </span>
                          <span data-numeric className="text-xs text-muted-foreground">
                            {hhmm(p.startTime)}–{hhmm(p.endTime)}
                          </span>

                          {/* Only the exceptions are labelled. "All grades, every day"
                              on every chip is noise a reader learns to skip. */}
                          {(p.appliesDays.length < 5 || p.levels.length > 0) && (
                            <span className="mt-0.5 text-[0.6875rem] leading-tight text-muted-foreground">
                              {p.appliesDays.length < 5 &&
                                p.appliesDays
                                  .map((d) => DAYS.find((x) => x.n === d)?.short)
                                  .join(' ')}
                              {p.appliesDays.length < 5 && p.levels.length > 0 && ' · '}
                              {p.levels.length > 0 &&
                                `${p.levels.length} grade${p.levels.length === 1 ? '' : 's'}`}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <Button
                  variant={teachingCount > 0 ? 'outline' : 'default'}
                  size="sm"
                  className="self-start"
                  onClick={() => setEditing(blankPeriod(periods))}
                >
                  <Plus aria-hidden="true" />
                  Add a period
                </Button>

                {periods.length > 0 && teachingCount === 0 && (
                  <Alert variant="warning" title="No teaching periods yet">
                    Every period so far is a break or assembly, so there is nowhere for a
                    lesson to go. Add at least one that holds lessons.
                  </Alert>
                )}
              </div>
            }
          />

          <Step
            n={3}
            title="Put lessons in the grid"
            description="Pick a class, then tap any empty cell. Drag a lesson to move it."
            done={lessonCount > 0}
            blocked={!hasTimetable || teachingCount === 0 || !hasClasses}
            blockedReason={
              !hasTimetable
                ? 'Create a timetable first.'
                : teachingCount === 0
                  ? 'Add a period that holds lessons first — a lesson needs a row to sit in.'
                  : 'This school has no classes yet. Add them under Pupils, then come back.'
            }
            action={
              <p className="text-sm text-muted-foreground">
                {lessonCount > 0
                  ? `${lessonCount} lesson${lessonCount === 1 ? '' : 's'} placed. The grid is below.`
                  : 'The grid is below.'}
              </p>
            }
          />

          <Step
            n={4}
            title="Publish it"
            description="Until you publish, only management sees it. Teachers and parents see nothing."
            done={published}
            blocked={lessonCount === 0}
            blockedReason="Place at least one lesson first — publishing an empty timetable tells a parent their child has no lessons."
            action={
              <p className="text-sm text-muted-foreground">
                The Publish button is beside the timetable name below.
              </p>
            }
          />
        </ol>
      </CardContent>

      {/* ---------------- create a timetable ---------------- */}
      <Dialog
        open={creating}
        title="Create a timetable"
        description="One per term. Every class in the school shares it."
        onClose={() => setCreating(false)}
        footer={
          <>
            <Button disabled={busy || !year.trim()} onClick={() => void createTimetable()}>
              {busy ? 'Creating…' : 'Create timetable'}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setCreating(false)}>
              Cancel
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-stack">
          <Field id="tt-year" label="Academic year" required>
            {(props) => (
              <Input
                {...props}
                value={year}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setYear(e.target.value)}
                maxLength={9}
              />
            )}
          </Field>

          <Field id="tt-term" label="Term" required>
            {(props) => (
              <Select
                {...props}
                value={term}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => setTerm(e.target.value)}
              >
                <option value="1">Term 1</option>
                <option value="2">Term 2</option>
                <option value="3">Term 3</option>
              </Select>
            )}
          </Field>

          {hasTimetable && (
            <Alert variant="info" title="You already have one">
              A second timetable for the same year and term is refused. Use this for a
              different term, or to draft next term&apos;s while this one runs.
            </Alert>
          )}
        </div>
      </Dialog>

      {/* ---------------- add or edit a period ---------------- */}
      <Dialog
        open={editing !== null}
        title={editing?.id ? 'Edit period' : 'Add a period'}
        description="Periods are the rows of every class's grid."
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button
              disabled={
                busy ||
                !editing?.name.trim() ||
                (editing?.appliesDays.length ?? 0) === 0
              }
              onClick={() => void savePeriod()}
            >
              {busy ? 'Saving…' : 'Save period'}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setEditing(null)}>
              Cancel
            </Button>

            {/* Removal lives with the thing being removed rather than on the strip, so
                the strip stays a strip and a mis-tap cannot delete a period. */}
            {editing?.id && (
              <Button
                variant="ghost"
                className="ml-auto text-danger"
                disabled={busy}
                onClick={() => void removePeriod(editing.id)}
              >
                <Trash2 aria-hidden="true" />
                Remove
              </Button>
            )}
          </>
        }
      >
        {editing && (
          <div className="flex flex-col gap-stack">
            <Field id="p-name" label="Name" required hint="Period 1, Break, Lunch, Assembly…">
              {(props) => (
                <Input
                  {...props}
                  value={editing.name}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setEditing({ ...editing, name: e.target.value })}
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
                    value={hhmm(editing.startTime)}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setEditing({ ...editing, startTime: e.target.value })}
                  />
                )}
              </Field>
              <Field id="p-end" label="Ends" required>
                {(props) => (
                  <Input
                    {...props}
                    type="time"
                    value={hhmm(editing.endTime)}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setEditing({ ...editing, endTime: e.target.value })}
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
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setEditing({ ...editing, order: Number(e.target.value) })}
                  />
                )}
              </Field>
            </div>

            <Field id="p-days" label="Days it runs">
              {() => (
                <div className="flex flex-wrap gap-2">
                  {DAYS.map((d) => (
                    <label
                      key={d.n}
                      className="flex min-h-tap cursor-pointer items-center gap-1.5 text-sm"
                    >
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={editing.appliesDays.includes(d.n)}
                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
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

            {levels.length > 0 && (
              <Field
                id="p-levels"
                label="Which grades use this period"
                hint="Leave all unticked for every grade — most schools run one school day. Tick some when a grade differs, such as primary finishing earlier."
              >
                {() => (
                  <div className="flex flex-wrap gap-2">
                    {levels.map((l) => (
                      <label
                        key={l.level_id}
                        className="flex min-h-tap cursor-pointer items-center gap-1.5 text-sm"
                      >
                        <input
                          type="checkbox"
                          className="size-4"
                          checked={editing.levels.includes(l.level_id)}
                          onChange={(e: ChangeEvent<HTMLInputElement>) =>
                            setEditing({
                              ...editing,
                              levels: e.target.checked
                                ? [...editing.levels, l.level_id]
                                : editing.levels.filter((x) => x !== l.level_id),
                            })
                          }
                        />
                        {l.display_name}
                      </label>
                    ))}
                  </div>
                )}
              </Field>
            )}

            <label className="flex min-h-tap cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={!editing.teaching}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setEditing({ ...editing, teaching: !e.target.checked })}
              />
              {/* Phrased as the exception, because most periods are lessons. */}
              This is a break, lunch or assembly — no lessons go in it
            </label>
          </div>
        )}
      </Dialog>
    </Card>
  )
}
