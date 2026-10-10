'use client'

/**
 * Parent attendance — was my child at school.
 *
 * Spec: `Official Documentation/10 Attendance/ATTENDANCE.md`
 *
 * ## A day with no record is not an absence
 *
 * The register is marked by a teacher, and on a day nobody marked it there is no
 * row. Rendering that as absent would accuse a child of missing school because a
 * teacher was busy. Days with no record simply do not appear, and the count says
 * how many days *were* marked so the parent can see the difference.
 *
 * ## Late is present, and said separately
 *
 * A child who arrived at 08:20 was at school. Folding lateness into absence
 * overstates absence and hides a real and different problem — so the rate counts
 * late as present and lateness is reported on its own line.
 *
 * ## A holiday is not a school day
 *
 * Excluded from the denominator entirely. Including it would report a child as
 * having missed school on a day the school was shut.
 */

import type { JSX } from 'react'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { CalendarCheck } from 'lucide-react'

import { useApi } from '../../../lib/use-api'
import { Badge } from '../../../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { DataTable } from '../../../components/ui/data-table'
import { EmptyState } from '../../../components/ui/empty-state'
import { ErrorState, StatSkeleton } from '../../../components/ui/data-states'
import { StatCard } from '../../../components/ui/stat-card'
import { ParentPageHeader, shortDate, type ChildOption } from '../parent-shared'

interface Payload {
  children: ChildOption[]
  selected: { id: string; firstName: string; lastName: string } | null
  attendance: {
    days: number
    present: number
    late: number
    absent: number
    excused: number
    rate: number | null
  }
  records: Array<{ attendance_date: string; status: string; excuse_reason: string | null }>
}

const STATUS_LABEL: Record<string, string> = {
  present: 'At school',
  late: 'Arrived late',
  absent: 'Absent',
  excused: 'Absent, explained',
  holiday: 'School closed',
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  present: 'success',
  late: 'warning',
  absent: 'danger',
  excused: 'neutral',
  holiday: 'neutral',
}

function ParentAttendance(): JSX.Element {
  const params = useSearchParams()
  const childId = params.get('childId')

  const url = childId
    ? `/api/parent/attendance?childId=${childId}`
    : '/api/parent/attendance'
  const { data, loading, error, code, reload } = useApi<Payload>(url)

  if (error) return <ErrorState message={error} code={code} onRetry={reload} />
  if (loading && !data) return <StatSkeleton count={3} />
  if (!data?.selected) {
    return (
      <Card>
        <CardContent className="p-0">
          <EmptyState
            icon={CalendarCheck}
            title="No children linked to this account"
            description="Contact the school office to have your account linked to your child."
          />
        </CardContent>
      </Card>
    )
  }

  const a = data.attendance

  return (
    <div className="space-y-cards">
      <ParentPageHeader
        title="Attendance"
        childName={`${data.selected.firstName} ${data.selected.lastName}`}
        note="Only days a teacher marked the register appear here. A day that is missing was not marked — it does not mean your child was away. Arriving late counts as being at school."
      >
      </ParentPageHeader>

      <div className="grid grid-cols-2 gap-cards sm:grid-cols-4">
        <StatCard
          label="At school"
          value={a.rate === null ? '—' : `${a.rate}%`}
          hint={a.days === 0 ? 'Nothing marked yet' : `${a.present} of ${a.days} marked days`}
          tone={a.rate === null ? 'neutral' : a.rate >= 90 ? 'success' : a.rate >= 75 ? 'warning' : 'danger'}
          icon={<CalendarCheck />}
        />
        <StatCard label="Arrived late" value={String(a.late)} hint="Counted as at school" tone="neutral" />
        <StatCard label="Absent" value={String(a.absent)} hint="No explanation recorded" tone={a.absent > 0 ? 'warning' : 'neutral'} />
        <StatCard label="Explained" value={String(a.excused)} hint="Absence the school accepted" tone="neutral" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Day by day</CardTitle>
          <p className="text-sm text-muted-foreground">The last 30 days, most recent first.</p>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable
            caption="Attendance records"
            rows={data.records}
            rowKey={(r) => r.attendance_date}
            columns={[
              {
                key: 'date',
                header: 'Day',
                primary: true,
                cell: (r) => shortDate(r.attendance_date),
              },
              {
                key: 'status',
                header: 'Marked',
                cell: (r) => (
                  <Badge variant={STATUS_TONE[r.status] ?? 'neutral'}>
                    {STATUS_LABEL[r.status] ?? r.status}
                  </Badge>
                ),
              },
              {
                key: 'why',
                header: 'Reason',
                cell: (r) => r.excuse_reason ?? '—',
              },
            ]}
            empty={
              <EmptyState
                icon={CalendarCheck}
                title="No register marked yet"
                description="Once teachers start marking the register, the days appear here."
              />
            }
          />
        </CardContent>
      </Card>
    </div>
  )
}

export default function ParentAttendancePage(): JSX.Element {
  return (
    <Suspense fallback={<StatSkeleton count={4} />}>
      <ParentAttendance />
    </Suspense>
  )
}
