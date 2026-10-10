'use client'

/**
 * Who used the school's AI credits.
 *
 * Spec: `Official Documentation/18 AI Module/AI_OVERVIEW.md`
 *       `Official Documentation/01 Foundation Layer/COMPLIANCE.md`
 *
 * ## What is deliberately absent
 *
 * There is no column here for a teacher's personal credit usage, and no filter that would
 * reveal it. `school_credit_usage()` (0166) only ever reads the school's own wallet, so
 * this panel could not show it even if somebody added a column for it.
 *
 * That is the point. A school paid for its own credits and is entitled to see how they were
 * spent. It paid nothing toward a teacher's personal professional development, and a
 * principal who could see that a teacher spent their own money generating interview
 * practice has learned something the school has no business knowing. The boundary lives in
 * SQL rather than in this file, because a screen is one well-meant feature request away
 * from crossing it.
 *
 * ## The bar is relative to the teacher's own allocation, not to the school total
 *
 * A teacher who has used 50 of their 60 is nearly out; a teacher who has used 50 of the
 * school's 600 has used a twelfth of it. The first is the fact that matters — it is the one
 * that predicts somebody arriving at the bursar's door — so the bar measures spend against
 * that teacher's allocation and says so.
 */

import type { JSX } from 'react'
import { useMemo } from 'react'
import { BarChart3 } from 'lucide-react'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../../../components/ui/card'
import { Badge } from '../../../../../components/ui/badge'
import { useApi } from '../../../../../lib/use-api'

interface UsageRow {
  out_clerk_user_id: string
  out_teacher_name: string
  out_credits_spent: number
  out_actions: number
  out_allocated: number
  out_from_reserve: number
  out_last_used_at: string | null
}

export function UsagePanel(): JSX.Element | null {
  const { data } = useApi<{ usage: UsageRow[] }>('/api/school/credits/usage')

  const usage = useMemo(() => data?.usage ?? [], [data])
  const total = useMemo(
    () => usage.reduce((sum, row) => sum + row.out_credits_spent, 0),
    [usage],
  )

  // Nothing spent yet is not a panel worth rendering — it is an empty table explaining a
  // feature the school has not used.
  if (usage.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 aria-hidden="true" className="size-5 text-primary" />
          How credits have been used
        </CardTitle>
        <CardDescription>
          <span data-numeric>{total}</span> credits spent by{' '}
          <span data-numeric>{usage.length}</span>{' '}
          {usage.length === 1 ? 'teacher' : 'teachers'}. This shows credits your school
          bought — anything a teacher buys for themselves is their own and is not shown here.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <ul className="flex flex-col gap-3">
          {usage.map((row) => {
            // Against their OWN allocation — see the header.
            const ceiling = row.out_allocated > 0 ? row.out_allocated : row.out_credits_spent
            const pct = ceiling > 0 ? Math.min(100, (row.out_credits_spent / ceiling) * 100) : 0
            const nearlyOut = row.out_allocated > 0 && pct >= 80

            return (
              <li key={row.out_clerk_user_id} className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="flex-1 truncate text-sm font-medium">
                    {row.out_teacher_name}
                  </span>
                  {row.out_from_reserve > 0 && (
                    <Badge variant="neutral">
                      <span data-numeric>{row.out_from_reserve}</span> from reserve
                    </Badge>
                  )}
                  <span className="text-sm text-muted-foreground">
                    <span data-numeric className="font-semibold text-foreground">
                      {row.out_credits_spent}
                    </span>
                    {row.out_allocated > 0 && (
                      <>
                        {' of '}
                        <span data-numeric>{row.out_allocated}</span>
                      </>
                    )}
                    {' · '}
                    <span data-numeric>{row.out_actions}</span>{' '}
                    {row.out_actions === 1 ? 'item' : 'items'}
                  </span>
                </div>

                <div
                  className="h-1.5 overflow-hidden rounded-full bg-muted"
                  role="img"
                  aria-label={
                    row.out_allocated > 0
                      ? `${row.out_teacher_name} has used ${row.out_credits_spent} of ${row.out_allocated} credits`
                      : `${row.out_teacher_name} has used ${row.out_credits_spent} credits`
                  }
                >
                  <div
                    className={
                      'h-full rounded-full transition-all '
                      + (nearlyOut ? 'bg-warning' : 'bg-primary')
                    }
                    style={{ width: `${pct}%` }}
                  />
                </div>

                {nearlyOut && (
                  <p className="text-xs text-warning">
                    Nearly out of their allocation.
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
