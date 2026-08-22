/**
 * Form layout primitives — the shared grid every form in ZSMS is built on.
 *
 * Spec: `Official Documentation/01 Foundation Layer/DESIGN_SYSTEM.md` → Form Layout
 *
 * ## The rule these components exist to enforce
 *
 * **Nothing of variable height sits above the control.**
 *
 * That single rule is what keeps a multi-column form aligned, and breaking it is
 * what misaligned the pricing screen. The original `Field` rendered
 * label → hint → input. A hint is one line for one field and two for its
 * neighbour, so two controls in the same grid row started at different heights
 * and the row visibly stair-stepped. No amount of per-field padding fixes that;
 * the padding was never the problem.
 *
 * So the order is **label → control → hint / error**. Everything above the
 * control is fixed height, which makes labels align and controls align without
 * subgrid, without measuring, and without a single breakpoint override. The
 * variable-height content hangs below the control where it disturbs nothing.
 *
 * The hint stays programmatically attached through `aria-describedby`, so a
 * screen reader still announces it with the field. Sighted users read it before
 * they commit rather than before they focus, which is the real moment guidance
 * is wanted.
 *
 * **The one constraint this places on callers:** labels must be short enough to
 * sit on one line. A wrapped label reintroduces exactly the problem above. If a
 * field needs a sentence of explanation, that sentence is a `hint`, not a label.
 *
 * ## Spacing comes from tokens, never from the call site
 *
 * Every gutter, gap, and padding here resolves to a `--zsms-*` variable that
 * already tightens below 480px on its own. A screen that reaches for
 * `mt-4` or `gap-6` on a form has stepped outside the system, and the sizes it
 * picks will not move with the breakpoint.
 */

import * as React from 'react'
import type { JSX, ReactNode } from 'react'

import { cn } from '../../lib/utils'

/**
 * The responsive column container.
 *
 * Always one column on a phone, so any form stacks cleanly rather than
 * squeezing two number inputs into 375px. Column counts above two step up at
 * `sm` and again at `lg`, which keeps tablet from rendering three cramped
 * money fields side by side.
 *
 * Row and column gutters are the *same* token deliberately — an even gutter in
 * both axes is what makes a grid read as a grid rather than as rows that
 * happen to line up.
 */
const COLUMNS: Record<1 | 2 | 3 | 4, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
}

export function FormGrid({
  columns = 2,
  className,
  children,
}: {
  columns?: 1 | 2 | 3 | 4
  className?: string
  children: ReactNode
}): JSX.Element {
  return <div className={cn('grid gap-stack', COLUMNS[columns], className)}>{children}</div>
}

/**
 * A titled block of a form, as a card.
 *
 * Exists so that "a section of a form" has exactly one padding value across the
 * product. `CardHeader`/`CardContent` on their own let each screen choose, and
 * the pricing screen had already drifted to `pt-card` in one place and default
 * padding in another.
 */
export function FormSection({
  title,
  description,
  actions,
  className,
  children,
}: {
  title?: string
  description?: ReactNode
  /** Rendered on the title row — badges, counts, a secondary action. */
  actions?: ReactNode
  className?: string
  children: ReactNode
}): JSX.Element {
  return (
    <section className={cn('rounded-lg border border-border bg-card text-card-foreground', className)}>
      {(title || description || actions) && (
        <div className="flex flex-col gap-1.5 p-card pb-0">
          {(title || actions) && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              {title && <h3 className="text-lg font-semibold leading-tight tracking-tight">{title}</h3>}
              {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
            </div>
          )}
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
      )}
      <div className="p-card">{children}</div>
    </section>
  )
}

/**
 * The submit row.
 *
 * Separated by a rule and consistent spacing so "where do I confirm this" is
 * answered identically on every form. `items-center` rather than `items-end`
 * because the row holds a button and a status message, and baseline-aligning a
 * 44px button against one line of text drops the text to the button's floor.
 */
export function FormActions({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className={cn('mt-stack flex flex-wrap items-center gap-3 border-t border-border pt-stack', className)}>
      {children}
    </div>
  )
}

/**
 * A checkbox as a full field, so it occupies a grid cell like any other.
 *
 * `min-h-tap` on the label, not on the box: the whole label is the hit target,
 * which is both the accessible behaviour and the one that survives a thumb.
 * The box itself stays 16px because a 44px checkbox looks like a button.
 */
export function CheckboxField({
  id,
  label,
  hint,
  checked,
  onChange,
  disabled,
  className,
}: {
  id: string
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
}): JSX.Element {
  const hintId = hint ? `${id}-hint` : undefined

  return (
    <div className={cn('space-y-1', className)}>
      <label htmlFor={id} className="flex min-h-tap cursor-pointer items-center gap-2.5 text-sm">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-describedby={hintId}
          onChange={(e) => onChange(e.target.checked)}
          className="size-4 shrink-0 rounded border-input accent-primary disabled:cursor-not-allowed disabled:opacity-70"
        />
        <span className="font-medium text-foreground">{label}</span>
      </label>
      {hint && (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  )
}
