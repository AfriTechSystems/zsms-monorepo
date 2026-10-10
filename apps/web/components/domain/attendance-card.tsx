/**
 * Attendance summary card.
 *
 * Same semantic mapping as fees, applied to a different meaning: green is
 * present, amber is late, coral is absent. Consistency across domains is what
 * lets a user learn the colour language once.
 *
 * The percentage bar is not the only representation — the counts are written
 * out beside it. A bar alone is unreadable to a screen reader and imprecise for
 * anyone deciding whether a child has crossed an attendance threshold.
 */

import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Badge } from '../ui/badge'
import { cn } from '../../lib/utils'
import type { JSX } from 'react'

export interface AttendanceCardProps {
  title: string
  subtitle?: string
  present: number
  late: number
  absent: number
  /** Below this, attendance is flagged. Comes from config, never hardcoded. */
  concernThreshold?: number
}

export function AttendanceCard({
  title,
  subtitle,
  present,
  late,
  absent,
  concernThreshold = 80,
}: AttendanceCardProps): JSX.Element {
  const total = present + late + absent
  // Late still counts as attending — a child who arrived is not absent.
  const attended = present + late
  const rate = total === 0 ? 0 : Math.round((attended / total) * 1000) / 10
  const belowThreshold = total > 0 && rate < concernThreshold

  const segments = [
    { key: 'present', value: present, className: 'bg-success', label: 'Present' },
    { key: 'late', value: late, className: 'bg-warning', label: 'Late' },
    { key: 'absent', value: absent, className: 'bg-danger', label: 'Absent' },
  ].filter((s) => s.value > 0)

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle className="truncate">{title}</CardTitle>
          {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        <Badge variant={belowThreshold ? 'danger' : 'success'}>
          <span data-numeric>{rate}%</span>
        </Badge>
      </CardHeader>

      <CardContent className="space-y-3">
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">No attendance recorded yet for this period.</p>
        ) : (
          <>
            <div
              className="flex h-2 w-full overflow-hidden rounded-full bg-sunken"
              role="img"
              aria-label={`${present} present, ${late} late, ${absent} absent out of ${total} days`}
            >
              {segments.map((s) => (
                <div
                  key={s.key}
                  className={cn('h-full', s.className)}
                  style={{ width: `${(s.value / total) * 100}%` }}
                />
              ))}
            </div>

            <dl className="grid grid-cols-3 gap-2 text-sm">
              <div>
                <dt className="text-muted-foreground">Present</dt>
                <dd data-numeric className="font-medium text-success-text">
                  {present}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Late</dt>
                <dd data-numeric className="font-medium text-warning-text">
                  {late}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Absent</dt>
                <dd data-numeric className="font-medium text-danger-text">
                  {absent}
                </dd>
              </div>
            </dl>

            {belowThreshold && (
              <p className="text-sm text-danger-text">Below the {concernThreshold}% attendance threshold.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
