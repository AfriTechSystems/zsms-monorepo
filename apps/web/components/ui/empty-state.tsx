/**
 * Empty state.
 *
 * Distinguishes "nothing here yet" from "nothing matched your filter" — they
 * need different actions, and collapsing them into one "No results" is how a
 * user concludes the system is broken when they have simply filtered too far.
 */
import type { LucideIcon } from 'lucide-react'

import { cn } from '../../lib/utils'
import type { JSX } from 'react'

export interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps): JSX.Element {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      {Icon && (
        <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-sunken">
          <Icon className="size-6 text-subtle" aria-hidden="true" />
        </div>
      )}
      <p className="text-base font-medium text-foreground">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
