'use client'

/**
 * Fee loans against this school's pupils.
 *
 * Spec: `Official Documentation/14 Loan and Finance Module/LOANS.md`
 *
 * ## What is deliberately absent
 *
 * No income, no employer, no payslip, no behaviour score. `CONSENT.md` scopes the
 * parent's consent to the LENDER, not to their school — a bursar who could read a
 * parent's salary would have learned it from an application made in confidence to
 * somebody else. `school_loan_applications()` returns only the permitted columns, so
 * there is nothing on this page to leak.
 *
 * ## The one thing this screen asks the school to DO
 *
 * A disbursed loan means money has reached their account and the fee should be settled.
 * That is the action; everything else is for information.
 */

import type { JSX } from 'react'
import { use } from 'react'
import { Banknote } from 'lucide-react'

import { Alert } from '../../../../../components/ui/alert'
import { Badge } from '../../../../../components/ui/badge'
import { Card, CardContent } from '../../../../../components/ui/card'
import { DataTable } from '../../../../../components/ui/data-table'
import { ErrorState, PageHeader, TableSkeleton } from '../../../../../components/ui/data-states'
import { EmptyState } from '../../../../../components/ui/empty-state'
import { useApi } from '../../../../../lib/use-api'

interface Row {
  id: string
  studentId: string
  amount: number
  status: string
  lenderName: string | null
  disbursedAmount: number | null
  disbursedAt: string | null
  createdAt: string
}

const kwacha = (n: number): string =>
  `K${Number(n).toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const STATUS: Record<string, { label: string; tone: 'neutral' | 'info' | 'success' | 'danger' }> = {
  pending: { label: 'Not sent', tone: 'neutral' },
  submitted: { label: 'With the lender', tone: 'info' },
  under_review: { label: 'Being reviewed', tone: 'info' },
  approved: { label: 'Approved', tone: 'success' },
  declined: { label: 'Not approved', tone: 'danger' },
  disbursed: { label: 'Paid to you', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

export default function SchoolLoansPage({
  params,
}: {
  params: Promise<{ schoolCode: string }>
}): JSX.Element {
  use(params)

  const { data, loading, error, code, reload } = useApi<{
    applications: Row[]
    meta: { awaitingDecision: number; disbursed: number }
  }>('/api/school/loans')

  if (loading && !data) return <TableSkeleton rows={5} columns={4} />
  if (error) return <ErrorState message={error} code={code} onRetry={reload} />

  const rows = data?.applications ?? []

  return (
    <>
      <PageHeader
        title="Fee loans"
        description="Parents financing fees through a ZSMS lending partner."
        note="The lender pays you directly. You will not see a parent's income or credit score — they shared those with the lender, not with you."
      />

      {(data?.meta.disbursed ?? 0) > 0 && (
        <Alert variant="success" title="Money has been paid to you" className="mb-cards">
          {data?.meta.disbursed} loan{data?.meta.disbursed === 1 ? ' has' : 's have'} been
          disbursed. Check your account, then mark the fee paid so the pupil&apos;s balance
          is right.
        </Alert>
      )}

      <Card>
        <CardContent className="pt-card">
          {rows.length === 0 ? (
            <EmptyState
              icon={Banknote}
              title="No fee loans yet"
              description="When a parent applies for help paying fees, the application appears here."
            />
          ) : (
            <DataTable
              // Required, and read by screen readers in place of the visual heading.
              caption="Fee loans against this school's pupils"
              rows={rows}
              rowKey={(r) => r.id}
              columns={[
                {
                  key: 'amount',
                  header: 'Amount',
                  numeric: true,
                  primary: true,
                  cell: (r) => kwacha(r.amount),
                },
                {
                  key: 'lender',
                  header: 'Lender',
                  cell: (r) => r.lenderName ?? '—',
                },
                {
                  key: 'status',
                  header: 'Status',
                  cell: (r) => {
                    const s = STATUS[r.status] ?? { label: r.status, tone: 'neutral' as const }
                    return <Badge variant={s.tone}>{s.label}</Badge>
                  },
                },
                {
                  key: 'paid',
                  header: 'Paid to you',
                  numeric: true,
                  cell: (r) => (r.disbursedAmount ? kwacha(r.disbursedAmount) : '—'),
                },
                {
                  key: 'when',
                  header: 'Applied',
                  cell: (r) => new Date(r.createdAt).toLocaleDateString(),
                },
              ]}
            />
          )}
        </CardContent>
      </Card>
    </>
  )
}
