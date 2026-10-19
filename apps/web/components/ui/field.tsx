/**
 * Form field — label, control, hint, and error as one unit.
 *
 * Built as a single component rather than loose Label/Input parts because the
 * wiring between them is exactly what gets forgotten: `htmlFor`,
 * `aria-describedby`, `aria-invalid`, and an error that is actually announced.
 * Making the correct version the easy one is the only reliable way to get it on
 * every screen.
 *
 * ## Order: label → control → hint → error
 *
 * The hint sits **below** the control, and that placement is load-bearing rather
 * than aesthetic. See `./form.tsx` for the full reasoning; the short version is
 * that a hint is one line for one field and two for the field beside it, so a
 * hint above the control makes two controls in the same grid row start at
 * different heights. Everything above the control is now fixed height, which is
 * what lets a multi-column form align without subgrid or per-field padding.
 *
 * The hint stays attached through `aria-describedby`, so a screen reader still
 * announces it as part of the field regardless of DOM order.
 *
 * **Labels must fit one line.** A wrapped label reintroduces the misalignment
 * this ordering exists to prevent. A sentence of guidance is a `hint`.
 *
 * The error is `role="alert"` so a screen reader announces it when it appears
 * after a failed submit, rather than leaving the user to hunt for what went
 * wrong.
 *
 * **Deliberately not marked `'use client'`.** It holds no state and binds no
 * handlers, so it renders in either context — and it has to, because `children`
 * is a render prop. A function cannot cross the server-to-client boundary, so
 * marking this file client-only would make it unusable from a server component
 * (which is how the build caught it). Real forms are client components and
 * import it perfectly well from there.
 */

import * as React from 'react'
import type { JSX, ReactNode } from 'react'
import { CircleAlert } from 'lucide-react'

import { cn } from '../../lib/utils'

export interface FieldProps {
  id: string
  label: string
  /** Guidance, rendered under the control and announced with it. */
  hint?: string
  error?: string | null
  required?: boolean
  className?: string
  /**
   * A subordinate control belonging to this field, rendered directly under it —
   * an "unlimited" checkbox beside a numeric limit, say. Keeps the pair inside
   * one grid cell instead of letting the second control claim a cell of its own
   * and push the whole row out of alignment.
   */
  footer?: ReactNode
  children: (props: {
    id: string
    'aria-describedby': string | undefined
    'aria-invalid': boolean | undefined
    'aria-required': boolean | undefined
  }) => React.ReactNode
}

export function Field({
  id,
  label,
  hint,
  error,
  required,
  className,
  footer,
  children,
}: FieldProps): JSX.Element {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {/* `truncate` enforces the one-line rule visually rather than letting a
          long label silently break the grid. The full text stays in the DOM for
          assistive technology and as a tooltip. */}
      <label htmlFor={id} title={label} className="block truncate text-sm font-medium text-foreground">
        {label}
        {required && (
          <>
            {' '}
            <span className="text-danger-text" aria-hidden="true">
              *
            </span>
            <span className="sr-only">(required)</span>
          </>
        )}
      </label>

      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        'aria-required': required || undefined,
      })}

      {/* Hint before footer: the hint explains the control directly above it,
          and putting a subordinate checkbox between the two separated a caption
          from what it captions — "Student limit / 150 / No limit / Pupils this
          tier admits" reads as though the last line describes the checkbox. */}
      {hint && (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}

      {footer}

      {error && (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-sm text-danger-text">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  )
}

/**
 * The one definition of how a form control looks.
 *
 * Height, padding, radius, border, and both interaction states live here and
 * nowhere else, so an input and a select cannot drift apart — which they had,
 * with the select carrying a different focus treatment. `h-tap` is the 44px
 * accessibility floor from the tokens; it is not a design choice a screen may
 * override.
 */
const controlClasses = cn(
  'flex h-tap min-h-tap w-full rounded-md border border-input bg-background px-3 py-2 text-base',
  'transition-colors',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
  'disabled:cursor-not-allowed disabled:bg-sunken disabled:opacity-70',
  // The invalid state is driven by aria-invalid, so the visual and the
  // announced state cannot disagree.
  'aria-[invalid=true]:border-danger aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-danger',
)

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        controlClasses,
        'placeholder:text-subtle',
        // Number inputs get their spinners removed and their digits aligned
        // left like every other field. A spinner on a price is a way to change
        // a price by one kwacha with an accidental scroll.
        type === 'number' && '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select ref={ref} className={cn(controlClasses, 'cursor-pointer pr-8', className)} {...props} />
  ),
)
Select.displayName = 'Select'

/**
 * Free text over more than one line — a rejection reason, a note on a payment.
 *
 * `min-h` rather than a fixed height, and resize left on, because the writer
 * knows how much they need to say better than the layout does. `field-sizing`
 * grows it with the content where the browser supports it, and is ignored
 * harmlessly where it does not.
 */
export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      controlClasses,
      'min-h-20 resize-y py-2 leading-normal placeholder:text-subtle [field-sizing:content]',
      className,
    )}
    {...props}
  />
))
Textarea.displayName = 'Textarea'

/**
 * A numeric input with a currency or unit marker.
 *
 * The prefix is `aria-hidden` and the unit repeated in the label, because
 * "K" announced before every price is noise once and confusion by the tenth
 * field.
 */
export const PrefixedInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { prefix: string }
>(({ className, prefix, ...props }, ref) => (
  <div className="relative">
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-sm text-muted-foreground"
    >
      {prefix}
    </span>
    <Input ref={ref} className={cn('pl-9', className)} {...props} />
  </div>
))
PrefixedInput.displayName = 'PrefixedInput'
