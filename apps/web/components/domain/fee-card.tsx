/**
 * Fee summary card.
 *
 * This is where the semantic palette earns its keep, so the rules are stated
 * here rather than left to whoever builds the next screen:
 *
 *  - **green = paid**, **amber = due soon**, **coral = overdue/arrears**
 *  - the status is always written in words as well as coloured
 *  - money is `tabular-nums` and right-aligned so a column of figures scans
 *  - **arrears never gates anything.** Per ADR-038 this card reports a balance
 *    and offers a payment. It does not withhold results, and it must never grow
 *    a "blocked" state — any gating is a school-controlled setting elsewhere,
 *    off by default.
 *
 * The brought-forward line appears only when there is one, and is labelled with
 * the term it came from. A parent seeing a balance larger than this term's fees
 * needs to know immediately that the difference is old debt, not a billing
 * error — that is the single most common support call a bursar fields.
 */

import { CalendarClock, CheckCircle2, TriangleAlert } from 'lucide-react'

import { Badge } from '../ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { cn } from '../../lib/utils'
import type { JSX } from 'react'

export type FeeStatus = 'paid' | 'partial' | 'due_soon' | 'overdue' | 'unpaid'

export interface FeeCardProps {
  studentName: string
  termLabel: string
  currency: string
  /** This term's charge. */
  termCharge: string
  /** Unpaid balance carried in from earlier terms. Omit when zero. */
  broughtForward?: string | null
  broughtForwardFrom?: string | null
  amountPaid: string
  balance: string
  status: FeeStatus
  dueDate?: string
  daysOverdue?: number
  action?: React.ReactNode
}

const STATUS: Record<FeeStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'neutral'; Icon: typeof CheckCircle2 }> = {
  paid: { label: 'Paid in full', variant: 'success', Icon: CheckCircle2 },
  partial: { label: 'Part paid', variant: 'warning', Icon: CalendarClock },
  due_soon: { label: 'Due soon', variant: 'warning', Icon: CalendarClock },
  overdue: { label: 'Overdue', variant: 'danger', Icon: TriangleAlert },
  unpaid: { label: 'Not yet paid', variant: 'neutral', Icon: CalendarClock },
}

function Money({ value, currency, className }: { value: string; currency: string; className?: string }): JSX.Element {
  return (
    <span data-numeric className={cn('font-medium', className)}>
      <span className="text-subtle">{currency}</span> {value}
    </span>
  )
}

export function FeeCard({
  studentName,
  termLabel,
  currency,
  termCharge,
  broughtForward,
  broughtForwardFrom,
  amountPaid,
  balance,
  status,
  dueDate,
  daysOverdue,
  action,
}: FeeCardProps): JSX.Element {
  const { label, variant, Icon } = STATUS[status]
  const settled = status === 'paid'

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle className="truncate">{studentName}</CardTitle>
          <p className="mt-0.5 text-sm text-muted-foreground">{termLabel}</p>
        </div>
        <Badge variant={variant}>
          <Icon aria-hidden="true" />
          {label}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-3">
        <dl className="space-y-2 text-sm">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">This term</dt>
            <dd>
              <Money value={termCharge} currency={currency} />
            </dd>
          </div>

          {broughtForward && (
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-danger-text">
                Brought forward
                {broughtForwardFrom && (
                  <span className="ml-1 font-normal text-muted-foreground">from {broughtForwardFrom}</span>
                )}
              </dt>
              <dd>
                <Money value={broughtForward} currency={currency} className="text-danger-text" />
              </dd>
            </div>
          )}

          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">Paid</dt>
            <dd>
              <Money value={amountPaid} currency={currency} className="text-success-text" />
            </dd>
          </div>
        </dl>

        <div className="flex items-baseline justify-between gap-4 border-t border-border pt-3">
          <span className="text-sm font-medium">Balance</span>
          <span
            data-numeric
            className={cn(
              'text-xl font-semibold',
              settled ? 'text-success-text' : status === 'overdue' ? 'text-danger-text' : 'text-foreground',
            )}
          >
            <span className="text-sm font-normal text-subtle">{currency}</span> {balance}
          </span>
        </div>

        {status === 'overdue' && daysOverdue !== undefined && (
          <p className="text-sm text-danger-text">
            {daysOverdue} {daysOverdue === 1 ? 'day' : 'days'} past due
          </p>
        )}
        {status !== 'overdue' && !settled && dueDate && (
          <p className="text-sm text-muted-foreground">Due {dueDate}</p>
        )}

        {action && <div className="pt-1">{action}</div>}
      </CardContent>
    </Card>
  )
}
