/**
 * Alert.
 *
 * `role="alert"` only for the danger variant — that role interrupts a screen
 * reader immediately, which is right for a failed payment and wrong for an
 * informational note. Informational alerts render as plain regions.
 */
import * as React from 'react'
import type { JSX } from 'react'
import { AlertTriangle, CheckCircle2, Info, XCircle, type LucideIcon } from 'lucide-react'

import { cn } from '../../lib/utils'

type AlertVariant = 'info' | 'success' | 'warning' | 'danger'

const STYLES: Record<AlertVariant, { box: string; icon: LucideIcon; iconClass: string }> = {
  info: { box: 'bg-accent-tint text-accent-text', icon: Info, iconClass: 'text-accent-text' },
  success: { box: 'bg-success-tint text-success-text', icon: CheckCircle2, iconClass: 'text-success-text' },
  warning: { box: 'bg-warning-tint text-warning-text', icon: AlertTriangle, iconClass: 'text-warning-text' },
  danger: { box: 'bg-danger-tint text-danger-text', icon: XCircle, iconClass: 'text-danger-text' },
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
