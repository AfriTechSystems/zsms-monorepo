/**
 * Dates: one field, one range, one definition of "today".
 *
 * Spec: `.claude/skills/zsms-ui/SKILL.md` → *Reach for the existing primitive first*
 *
 * ## Why this is a wrapper and not a calendar
 *
 * The obvious reading of "there is no date primitive" is that ZSMS should grow a
 * custom calendar popover. It should not, and the reasoning is worth keeping.
 *
 * `<input type="date">` is a native control: keyboard accessible without anybody
 * implementing a roving month grid, announced correctly by screen readers, and on a
 * phone it opens the operating system's own picker. A school clerk entering fifty
 * dates on an Android handset gets a wheel they already know. A hand-rolled grid
 * would be several hundred lines, the largest accessibility risk in the repository,
 * and worse on the device most of this product is used on.
 *
 * So the native control stays. What was missing was never the widget.
 *
 * ## What was actually missing
 *
 * Eighteen raw `<input type="date">` across twelve files, and:
 *
 *  - **`todayIso()` was defined twice**, byte for byte, in `attendance/page.tsx` and
 *    `students/new/page.tsx`, with about eight further inline variants written as
 *    `new Date().toISOString().slice(0, 10)`. Those two copies are correct; the
 *    inline form is **not** — `toISOString()` is UTC, and Zambia is UTC+2, so
 *    between midnight and 02:00 local it returns *yesterday*. On a default it shows
 *    the wrong day; on a `max` it refuses today's date. `settings/integrations`
 *    defaults the Sage 50 export window that way.
 *  - **Five from/to pairs and not one of them checks that from ≤ to.** Inverting
 *    them returns an empty result with no explanation, which reads as "there is no
 *    data" rather than "you asked for a negative range".
 *
 * `DateRangeField` fixes the second **structurally** rather than by validating
 * afterwards: the `from` input's `max` is whatever `to` holds and the `to` input's
 * `min` is whatever `from` holds, so the browser will not offer an inverted range in
 * the first place. The explicit error exists only for a range that arrived already
 * inverted — from a URL parameter or restored state — where there is nothing to
 * prevent, only something to explain.
 */

'use client'

import type { JSX, ReactNode } from 'react'

import { todayIso } from '../../lib/dates'
import { Field, Input } from './field'

export interface DateFieldProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  hint?: string
  error?: string | null
  required?: boolean
  disabled?: boolean
  className?: string
  /** Passed through to `Field` — a subordinate control sharing this grid cell. */
  footer?: ReactNode
  /** Earliest selectable date, `YYYY-MM-DD`. */
  min?: string
  /** Latest selectable date, `YYYY-MM-DD`. */
  max?: string
  /**
   * Caps the control at today. For a date that has already happened — a date of
   * birth, an enrolment, a payment — where a future value is always a typo.
   */
  notFuture?: boolean
}

export function DateField({
  id,
  label,
  value,
  onChange,
  hint,
  error,
  required,
  disabled,
  className,
  footer,
  min,
  max,
  notFuture,
}: DateFieldProps): JSX.Element {
  // An explicit `max` wins over `notFuture`, so a caller can narrow further without
  // having to know which of the two the component prefers.
  const resolvedMax = max ?? (notFuture ? todayIso() : undefined)

  return (
    <Field
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={className}
      footer={footer}
    >
      {(props) => (
        <Input
          {...props}
          type="date"
          value={value}
          min={min}
          max={resolvedMax}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  )
}

export interface DateRangeFieldProps {
  /** Both inputs derive their ids from this, so it must be unique on the screen. */
  idPrefix: string
  fromLabel?: string
  toLabel?: string
  from: string
  to: string
  onFromChange: (value: string) => void
  onToChange: (value: string) => void
  hint?: string
  disabled?: boolean
  className?: string
  /** Earliest selectable date for either end. */
  min?: string
  /** Latest selectable date for either end. */
  max?: string
  /** Caps both ends at today — the usual case for a report window. */
  notFuture?: boolean
}

/**
 * A from/to pair that cannot be put the wrong way round.
 *
 * Renders two fields rather than one control, because that is what every one of the
 * five existing call sites already draws and what a native date input supports. The
 * difference is that the bounds are now linked.
 */
export function DateRangeField({
  idPrefix,
  fromLabel = 'From',
  toLabel = 'To',
  from,
  to,
  onFromChange,
  onToChange,
  hint,
  disabled,
  className,
  min,
  max,
  notFuture,
}: DateRangeFieldProps): JSX.Element {
  const ceiling = max ?? (notFuture ? todayIso() : undefined)

  /*
    Only when BOTH ends are set. A half-filled range is a range being typed, and
    shouting at somebody mid-entry is how a form teaches people to ignore it.
  */
  const inverted = Boolean(from && to && from > to)

  return (
    <>
      <DateField
        id={`${idPrefix}-from`}
        label={fromLabel}
        value={from}
        onChange={onFromChange}
        hint={hint}
        disabled={disabled}
        className={className}
        min={min}
        // The linked bound. `to` wins over the shared ceiling when it is tighter,
        // which is the whole point — the browser stops offering an inverted range.
        max={to || ceiling}
        error={inverted ? 'This is after the end of the range.' : null}
      />
      <DateField
        id={`${idPrefix}-to`}
        label={toLabel}
        value={to}
        onChange={onToChange}
        disabled={disabled}
        className={className}
        min={from || min}
        max={ceiling}
      />
    </>
  )
}
