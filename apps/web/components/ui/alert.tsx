/**
 * Alert.
 *
 * `role="alert"` only for the danger variant — that role interrupts a screen
 * reader immediately, which is right for a failed payment and wrong for an
 * informational note. Informational alerts render as plain regions.
 */
import * as React from 'react'
import type { JSX } from 'react'
import type { LucideIcon } from 'lucide-react'

import { ICONS } from './icon'

import { cn } from '../../lib/utils'

type AlertVariant = 'info' | 'success' | 'warning' | 'danger'

/*
  The glyphs come from the canonical registry rather than being named here.

  They were already the right four — this is a zero-visual-change substitution — but
  naming them locally meant the Alert had its own opinion about what "success" looks
  like. Four components each holding that opinion is how the same concept ends up drawn
  four ways, which is what the 2026-10-19 icon audit found across 22 of 24 concepts.
  Change `success` in `./icon` now and the alert, the toast and the state panels follow.
*/
const STYLES: Record<AlertVariant, { box: string; icon: LucideIcon; iconClass: string }> = {
  info: { box: 'bg-accent-tint text-accent-text', icon: ICONS.info, iconClass: 'text-accent-text' },
  success: { box: 'bg-success-tint text-success-text', icon: ICONS.success, iconClass: 'text-success-text' },
  warning: { box: 'bg-warning-tint text-warning-text', icon: ICONS.warning, iconClass: 'text-warning-text' },
  danger: { box: 'bg-danger-tint text-danger-text', icon: ICONS.error, iconClass: 'text-danger-text' },
}

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant
  title?: string
}

export function Alert({ variant = 'info', title, className, children, ...props }: AlertProps): JSX.Element {
  const { box, icon: Icon, iconClass } = STYLES[variant]

  return (
    <div
      role={variant === 'danger' ? 'alert' : undefined}
      className={cn('flex gap-3 rounded-md p-4 text-sm', box, className)}
      {...props}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', iconClass)} aria-hidden="true" />
      <div className="space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="[&_p]:leading-relaxed">{children}</div>}
      </div>
    </div>
  )
}
