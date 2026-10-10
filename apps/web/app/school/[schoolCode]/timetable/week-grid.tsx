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
 * ## Dragging
 *
 * Asked for on 2026-10-05. A filled cell can be dragged to another cell; dropping it on
 * an empty one moves the lesson, and dropping it on a full one exchanges the two. The
 * gesture is how a deputy actually rearranges a week — the alternative was opening two
 * editors and retyping both.
 *
 * Native HTML5 drag and drop rather than a pointer-event library: it gives the drag
 * image, the cursor and the keyboard-accessible fallback for free, and the grid is a
 * table of buttons rather than a canvas, so there is nothing a library would add.
 *
 * A drop target is only marked when it can actually accept the thing being dragged, so
 * a break never lights up and a day the period skips never does either. The database
 * refuses those too; marking them would invite a gesture that is going to fail.
 *
 * ## A non-teaching period spans the week
 *
 * Break and lunch are the same for every day, so they are drawn as one band rather
 * than five identical cells. That is how the design shows it and how a reader thinks
 * of it — the day pauses, it does not pause five times.
 */

import type { JSX } from 'react'
import { useRef, useState } from 'react'
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
  onMove,
}: {
  periods: Period[]
  slots: Slot[]
  canEdit: boolean
  onOpen: (periodId: string, day: number, slot: Slot | null) => void
  /** Omitted on a read-only grid, which is what makes a teacher's week undraggable. */
  onMove?: (slotId: string, toPeriodId: string, toDay: number) => void
}): JSX.Element {
  const at = (periodId: string, day: number): Slot | null =>
    slots.find((s) => s.periodId === periodId && s.day === day) ?? null

  const dragging = useRef<string | null>(null)
  const [over, setOver] = useState<string | null>(null)

  const canDrag = canEdit && typeof onMove === 'function'

  /*
    Whether a cell may receive the lesson currently being dragged.

    Checked here as well as in the database so a cell that cannot accept it is never
    marked as a target. `0208`'s probe and `0197`'s indexes remain the enforcement.
  */
  const canDrop = (p: Period, day: number): boolean =>
    canDrag && dragging.current !== null && p.teaching && p.appliesDays.includes(day)

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
                  const cellKey = `${p.id}:${d.n}`
                  const isOver = over === cellKey

                  return (
                    <td
                      key={d.n}
                      onDragOver={(e) => {
                        if (!canDrop(p, d.n)) return
                        // Without preventDefault the browser refuses the drop and shows
                        // the "no entry" cursor, which reads as the app being broken.
                        e.preventDefault()
                        setOver(cellKey)
                      }}
                      onDragLeave={() => setOver((k) => (k === cellKey ? null : k))}
                      onDrop={(e) => {
                        e.preventDefault()
                        const id = dragging.current
                        setOver(null)
                        dragging.current = null
                        // Dropping a lesson on itself is not a move.
                        if (!id || !onMove || id === slot?.id) return
                        onMove(id, p.id, d.n)
                      }}
                    >
                      <button
                        type="button"
                        disabled={!canEdit}
                        draggable={canDrag && slot !== null}
                        onDragStart={(e) => {
                          if (!slot) return
                          dragging.current = slot.id
                          e.dataTransfer.effectAllowed = 'move'
                          // Firefox ignores a drag with no payload set.
                          e.dataTransfer.setData('text/plain', slot.id)
                        }}
                        onDragEnd={() => {
                          dragging.current = null
                          setOver(null)
                        }}
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
                        } ${canEdit ? 'hover:shadow-sm' : 'cursor-default'} ${
                          canDrag && slot ? 'cursor-grab active:cursor-grabbing' : ''
                        } ${isOver ? 'ring-2 ring-primary ring-offset-1' : ''}`}
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
