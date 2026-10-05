'use client'

/**
 * The week, as a grid.
 *
 * Spec: `Official Documentation/08 Staff Management/TIMETABLE.md` → *Grid Layout*,
 *       and the agreed design.
 *
 * Rows are periods, columns are Monday to Friday, each cell is one slot for the
 * selected class — exactly as the spec draws it.
 *
 * ## Colour carries the subject
 *
 * Each subject keeps its own colour across the whole grid, so "all the Mathematics" is
 * found by colour before a word is read. Derived from the subject's name rather than
 * stored, so every school gets a full palette without configuring one.
 *
 * ## A non-teaching period spans the week
 *
 * Break and lunch are the same for every day, so they are drawn as one band rather
 * than five identical cells. That is how the design shows it and how a reader thinks
 * of it — the day pauses, it does not pause five times.
 */

import type { JSX } from 'react'
import { UtensilsCrossed } from 'lucide-react'

import { subjectColour, NON_TEACHING } from '../../../../components/ui/subject-colour'

export const DAYS = [
  { n: 1, label: 'Monday', short: 'Mon' },
  { n: 2, label: 'Tuesday', short: 'Tue' },
  { n: 3, label: 'Wednesday', short: 'Wed' },
  { n: 4, label: 'Thursday', short: 'Thu' },
  { n: 5, label: 'Friday', short: 'Fri' },
] as const

export interface Period {
  id: string
  name: string
  startTime: string
  endTime: string
  order: number
  teaching: boolean
  appliesDays: number[]
  /** Grades this period belongs to. Empty means every grade. */
  levels: string[]
}

export interface Slot {
  id: string
  periodId: string
  day: number
  subjectName: string | null
  teacherName: string | null
  room: string | null
  slotType: string
}

export const hhmm = (t: string): string => t.slice(0, 5)

export function WeekGrid({
  periods,
  slots,
  canEdit,
  onOpen,
}: {
  periods: Period[]
  slots: Slot[]
  canEdit: boolean
  onOpen: (periodId: string, day: number, slot: Slot | null) => void
}): JSX.Element {
  const at = (periodId: string, day: number): Slot | null =>
    slots.find((s) => s.periodId === periodId && s.day === day) ?? null

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[52rem] border-separate border-spacing-1">
        <caption className="sr-only">Weekly timetable</caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="w-28 rounded-md bg-sunken p-2 text-sm font-semibold text-muted-foreground"
            >
              Time
            </th>
            {DAYS.map((d) => (
              <th
                key={d.n}
                scope="col"
                className="rounded-md bg-sunken p-2 text-sm font-semibold text-foreground"
              >
                {d.label}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {periods.map((p) => {
            /*
              One band across the week for a break.

              `colSpan` rather than five identical cells: the day pauses once, and five
              copies of "Lunch Break" is noise a reader has to filter out.
            */
            if (!p.teaching) {
              return (
                <tr key={p.id}>
                  <th
                    scope="row"
                    className="rounded-md bg-sunken p-2 text-left text-sm font-medium text-muted-foreground"
                  >
                    {hhmm(p.startTime)} – {hhmm(p.endTime)}
                  </th>
                  <td colSpan={5}>
                    <div
                      className={`flex min-h-tap items-center justify-center gap-2 rounded-md border ${NON_TEACHING.cell}`}
                    >
                      <UtensilsCrossed aria-hidden="true" className="size-4 text-muted-foreground" />
                      <span className="font-medium text-muted-foreground">{p.name}</span>
                    </div>
                  </td>
                </tr>
              )
            }

            return (
              <tr key={p.id}>
                <th
                  scope="row"
                  className="rounded-md bg-sunken p-2 text-left text-sm font-medium text-muted-foreground"
                >
                  {hhmm(p.startTime)} – {hhmm(p.endTime)}
                </th>

                {DAYS.map((d) => {
                  // A period that does not run on this day is not an empty cell; it is
                  // not a cell at all, and must not invite a lesson.
                  if (!p.appliesDays.includes(d.n)) {
                    return (
                      <td key={d.n}>
                        <div className="min-h-tap rounded-md bg-sunken/50" />
                      </td>
                    )
                  }

                  const slot = at(p.id, d.n)
                  const colour = subjectColour(slot?.subjectName)

                  return (
                    <td key={d.n}>
                      <button
                        type="button"
                        disabled={!canEdit}
                        onClick={() => onOpen(p.id, d.n, slot)}
                        aria-label={
                          slot
                            ? `${slot.subjectName ?? slot.slotType}, ${d.label}, ${hhmm(p.startTime)}`
                            : `Empty, ${d.label}, ${hhmm(p.startTime)}`
                        }
                        className={`flex min-h-tap w-full flex-col items-start gap-0.5 rounded-md border p-2 text-left transition-shadow ${
                          slot
                            ? colour.cell
                            : 'border-dashed border-border bg-transparent'
                        } ${canEdit ? 'hover:shadow-sm' : 'cursor-default'}`}
                      >
                        {slot ? (
                          <>
                            <span className="flex w-full items-start justify-between gap-1">
                              <span className={`text-sm font-semibold ${colour.title}`}>
                                {slot.subjectName ?? slot.slotType}
                              </span>
                              {slot.room && (
                                <span
                                  className={`shrink-0 rounded px-1 text-[11px] font-medium ${colour.badge}`}
                                >
                                  {slot.room}
                                </span>
                              )}
                            </span>
                            <span className={`text-sm ${colour.title} opacity-80`}>
                              {/* Named, not left blank: an unstaffed lesson is exactly
                                  what a deputy is hunting for before term starts. */}
                              {slot.teacherName ?? 'No teacher yet'}
                            </span>
                          </>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            {canEdit ? '+' : ''}
                          </span>
                        )}
                      </button>
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
