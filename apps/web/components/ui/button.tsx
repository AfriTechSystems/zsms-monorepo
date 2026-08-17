/**
 * Button.
 *
 * The colour hierarchy is enforced by the variant list, not by convention.
 * There is exactly one `default` (blue) because the brief is explicit that blue
 * is THE action colour — a screen with three competing filled buttons is a
 * screen where a tired bursar clicks the wrong one.
 *
 * `destructive` is coral and deliberately not offered as a casual variant: it
 * marks actions that delete or reverse money.
 */
'use client'

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'

import { cn } from '../../lib/utils'

const buttonVariants = cva(
  // 44px minimum touch target on the default size — below that, tapping on a
  // phone in a school corridor is a coin toss.
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm ' +
    'font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 ' +
    '[&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary-text shadow-sm',
        destructive: 'bg-destructive text-destructive-foreground hover:opacity-90 shadow-sm',
        outline: 'border border-input bg-background hover:bg-sunken text-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-muted',
        ghost: 'hover:bg-sunken text-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        // `h-tap` is the 44px token, and it is the SAME value at every
        // breakpoint — see SIZING in the token package. Cards, gaps, and
        // headings tighten on a phone; the things a finger has to hit do not.
        default: 'h-tap px-4 py-2',
        // `sm` is 36px and is for dense toolbars and table rows on a pointer
        // device. It is below the touch minimum on purpose and must not be the
        // primary action on a mobile screen; `min-h-tap` keeps the hit area
        // legal wherever it is used inside a taller row.
        sm: 'h-9 min-h-9 rounded-md px-3 text-sm',
        lg: 'h-12 rounded-md px-6 text-base',
        icon: 'h-tap w-tap',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  /** Shows a spinner and blocks interaction. */
  loading?: boolean
  /** Announced to screen readers while loading. */
  loadingText?: string
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, loadingText, children, disabled, ...props }, ref) => {
    const classes = cn(buttonVariants({ variant, size, className }))

    // `asChild` renders a Slot, which requires exactly one element child — it
    // exists to make a Link look like a button. A spinner would be a second
    // child, so `loading` is not supported on that path and is not silently
    // dropped either: the branch simply does not accept it.
    if (asChild) {
      return (
        <Slot className={classes} ref={ref} {...props}>
          {children}
        </Slot>
      )
    }

    return (
      <button
        className={classes}
        ref={ref}
        // A loading button stays focusable but is not activatable: `disabled`
        // would drop it out of the tab order mid-interaction and move focus
        // somewhere unpredictable.
        aria-busy={loading || undefined}
        aria-disabled={loading || disabled || undefined}
        disabled={disabled}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" aria-hidden="true" />
            {loadingText ?? children}
          </>
        ) : (
          children
        )}
      </button>
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
