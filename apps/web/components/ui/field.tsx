/**
 * Form field — label, control, hint, and error as one unit.
 *
 * Built as a single component rather than loose Label/Input parts because the
 * wiring between them is exactly what gets forgotten: `htmlFor`,
 * `aria-describedby`, `aria-invalid`, and an error that is actually announced.
 * Making the correct version the easy one is the only reliable way to get it on
 * every screen.
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
import type { JSX } from 'react'
import { AlertCircle } from 'lucide-react'

import { cn } from '../../lib/utils'

export interface FieldProps {
  id: string
  label: string
  /** Guidance shown before the user makes a mistake. */
  hint?: string
  error?: string | null
  required?: boolean
  className?: string
  children: (props: {
    id: string
    'aria-describedby': string | undefined
    'aria-invalid': boolean | undefined
    'aria-required': boolean | undefined
  }) => React.ReactNode
}

export function Field({ id, label, hint, error, required, className, children }: FieldProps): JSX.Element {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
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

      {hint && (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}

      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        'aria-required': required || undefined,
      })}

      {error && (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-sm text-danger-text">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  )
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base',
        'placeholder:text-subtle',
        'disabled:cursor-not-allowed disabled:bg-sunken disabled:opacity-70',
        // The invalid state is driven by aria-invalid, so the visual and the
        // announced state cannot disagree.
        'aria-[invalid=true]:border-danger aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-danger',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base',
        'disabled:cursor-not-allowed disabled:bg-sunken disabled:opacity-70',
        'aria-[invalid=true]:border-danger',
        className,
      )}
      {...props}
    />
  ),
)
Select.displayName = 'Select'
