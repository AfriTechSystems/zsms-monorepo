'use client'

/**
 * Parent home — one child, four answers.
 *
 * Spec: `Official Documentation/07 Student and Parent Modules/PARENTS.md`
 *
 * ## Written for a parent, not for a school
 *
 * Every label is the question a parent actually has. Not "Outstanding balance"
 * but "You owe"; not "Attendance rate 94%" but "Present 17 of 18 school days".
 * A percentage with no denominator is the kind of number that starts an argument
 * at a parents' meeting, so the denominator is always shown and the window it
 * covers is stated.
 *
 * ## Awaiting confirmation is never subtracted
 *
 * A payment the parent has submitted shows as awaiting confirmation and is NOT
 * deducted from what they owe. That is the honest presentation: the school has
 * not yet agreed it received the money. Deducting it would have a parent believe
 * they were square and a school believe they were not — the worst possible
 * version of this screen.
 *
 * ## No arrears shaming
 *
 * A balance is a figure and a link to a statement. Nothing here is coloured red
 * for being owed money, nothing says "overdue" in alarm colours unless a due date
 * has genuinely passed, and no result or report is withheld over it. Fee pressure
 * applied through a child's portal is the thing this product must not become.
 */

import type { JSX } from 'react'
import { Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { CalendarCheck, ClipboardList, Megaphone, Wallet } from 'lucide-react'

import { useApi } from '../../lib/use-api'
import { Alert } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/empty-state'
import { ErrorState, StatSkeleton } from '../../components/ui/data-states'
import { StatCard } from '../../components/ui/stat-card'

interface Child {
  id: string
  studentId: string
  firstName: string
  lastName: string
  schoolId: string
  schoolName: string | null
}

interface Payload {
  children: Child[]
  selected: {
    id: string
    studentId: string
    firstName: string
    lastName: string
    gradeId: string
    classId: string
    status: string
  } | null
  school: { school_id: string; name: string } | null
  balance: {
    outstanding: string | number
    arrears_amount: string | number
    is_overdue: boolean
    days_overdue: number | null
  } | null
  attendance: {
    days: number
    present: number
    late: number
    absent: number
    excused: number
    rate: number | null
  }
  results: Array<{
    id: string
    subject_name: string
    marks_obtained: string | number | null
    marks_total: string | number
    grade_letter: string | null
    term_number: number
    academic_year: string
  }>
  announcements: Array<{
    id: string
    title: string
    body: string
    importance: string
    sent_at: string | null
  }>
  payments: Array<{
    id: string
    amount: string | number
    status: string
    receipt_number: string | null
    created_at: string
  }>
}

const kwacha = (v: string | number | null | undefined): string => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : 0
  return `K${(Number.isFinite(n) ? n : 0).toLocaleString('en-ZM', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

const shortDate = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleDateString('en-ZM', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—'

function ParentHome(): JSX.Element {
  const params = useSearchParams()
  const childId = params.get('childId')

  const url = childId ? `/api/parent/overview?childId=${childId}` : '/api/parent/overview'
  const { data, loading, error, code, reload } = useApi<Payload>(url)

  if (error) return <ErrorState message={error} code={code} onRetry={reload} />
  if (loading && !data) return <StatSkeleton count={3} />
  if (!data) return <StatSkeleton count={3} />

  // A working session with no linked children. Not an error, and not a broken
  // dashboard — a specific situation with a specific thing to do about it.
  if (data.children.length === 0 || !data.selected) {
    return (
      <Card>
        <CardContent className="p-0">
          <EmptyState
            icon={Megaphone}
            title="No children linked to this account yet"
            description="Your school links your account to your children. If you were expecting to see a child here, contact the school office and ask them to check the parent link on your child's record."
          />
        </CardContent>
      </Card>
    )
  }

  const child = data.selected
  const unconfirmed = data.payments.filter((p) => p.status === 'pending_verification')

  return (
    <div className="space-y-cards">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            {child.firstName} {child.lastName}
          </h1>
          <p className="text-sm text-muted-foreground">
            {data.school?.name}
            {' · '}
            <span className="font-mono">{child.studentId}</span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-cards sm:grid-cols-3">
        <StatCard
          label="Attendance"
          value={data.attendance.rate === null ? '—' : `${data.attendance.rate}%`}
          // The denominator, always. See the header.
          hint={
            data.attendance.days === 0
              ? 'No school days recorded yet'
              : `Present ${data.attendance.present} of ${data.attendance.days} school days, last 30 days`
          }
          tone={
            data.attendance.rate === null
              ? 'neutral'
              : data.attendance.rate >= 90
                ? 'success'
                : data.attendance.rate >= 75
                  ? 'warning'
                  : 'danger'
          }
          icon={<CalendarCheck />}
        />

        <StatCard
          label="You owe"
          value={kwacha(data.balance?.outstanding)}
          hint={
            data.balance?.is_overdue && data.balance.days_overdue
              ? `${kwacha(data.balance.arrears_amount)} past its due date`
              : 'Nothing overdue'
          }
          // Only tonal when a due date has genuinely passed. A balance that is
          // simply owed is not an alarm.
          tone={data.balance?.is_overdue ? 'warning' : 'neutral'}
          icon={<Wallet />}
        />

        <StatCard
          label="Results published"
          value={String(data.results.length)}
          hint={data.results.length === 0 ? 'Nothing published yet' : 'Marks you can see'}
          tone="neutral"
          icon={<ClipboardList />}
        />
      </div>

      {unconfirmed.length > 0 && (
        <Alert variant="info" title="Payment awaiting confirmation">
          {unconfirmed.length === 1
            ? `A payment of ${kwacha(unconfirmed[0]?.amount)} is with the school for checking.`
            : `${unconfirmed.length} payments are with the school for checking.`}{' '}
          It has not been taken off what you owe yet — the school subtracts it once it has
          confirmed the money arrived.
        </Alert>
      )}

      {data.announcements.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>From the school</CardTitle>
          </CardHeader>
          <CardContent className="space-y-stack">
            {data.announcements.slice(0, 3).map((a) => (
              <div key={a.id} className="border-b border-border pb-stack last:border-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium text-foreground">{a.title}</h3>
                  {a.importance === 'important' && <Badge variant="warning">Important</Badge>}
                  <span className="text-xs text-muted-foreground">{shortDate(a.sent_at)}</span>
                </div>
                {/* Clamped rather than truncated with an ellipsis in the string:
                    the full text is in the DOM for a screen reader and for anyone
                    who opens the notices page. */}
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{a.body}</p>
              </div>
            ))}
            <Button variant="ghost" asChild>
              <Link href={`/parent/notices${childId ? `?childId=${childId}` : ''}`}>
                All notices
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {data.results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Latest results</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.results.slice(0, 4).map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 flex-1 truncate text-foreground">{r.subject_name}</span>
                <span className="text-muted-foreground">
                  {r.marks_obtained ?? '—'} / {r.marks_total}
                </span>
                {r.grade_letter && <Badge variant="neutral">{r.grade_letter}</Badge>}
              </div>
            ))}
            <Button variant="ghost" asChild>
              <Link href={`/parent/results${childId ? `?childId=${childId}` : ''}`}>
                All results
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export default function ParentHomePage(): JSX.Element {
  return (
    <Suspense fallback={<StatSkeleton count={3} />}>
      <ParentHome />
    </Suspense>
  )
}
