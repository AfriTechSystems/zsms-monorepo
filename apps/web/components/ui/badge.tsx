/**
 * Status badge.
 *
 * Colour is never the only signal. Each status carries a label, and the
 * semantic variants pair a tint background with its own darker text — measured
 * at roughly 9-10:1, rather than coloured text on white at 3.4:1, which is what
 * a naive "green text for paid" would give.
 *
 * This matters beyond compliance: around 1 in 12 men has a colour vision
 * deficiency, and red/green is the common axis. A parent must be able to tell
 * paid from overdue without relying on hue.
 */
import * as React from 'react'
import type { JSX } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '../../lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ' +
    '[&_svg]:size-3 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        neutral: 'bg-neutral-tint text-neutral-text',
        /** Paid, present, active. */
        success: 'bg-success-tint text-success-text',
        /** Due soon, partial, pending. */
        warning: 'bg-warning-tint text-warning-text',
        /** Overdue, arrears, absent, failed. */
        danger: 'bg-danger-tint text-danger-text',
        info: 'bg-accent-tint text-accent-text',
        primary: 'bg-primary-tint text-primary-text',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps): JSX.Element {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
