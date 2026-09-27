'use client'

/**
 * Your subscription — what this school pays ZSMS, and what it has been billed.
 *
 * Spec: `Official Documentation/17 Integration and Pricing/PRICING.md`
 *
 * ## The current period is an estimate, and says so
 *
 * On a per-student plan the charge moves as pupils enrol. Presenting today's figure
 * as an amount owed would have a bursar reconcile against a number that changes
 * under them, so it is labelled an estimate and the arithmetic is shown — pupils ×
 * rate — so they can see exactly why it moved.
 *
 * ## An invoice shows the basis it was issued on
 *
 * Every invoice carries the pupil count and rate that produced it, and the screen
 * renders them. "312 pupils at K12" answers the only question a school asks about a
 * subscription bill, and it stays answerable after the rate changes.
 *
 * ## A configuration problem is the school's business too
 *
 * If the charge cannot be resolved — a roll outside every band — the school sees
 * that plainly rather than silently receiving no invoice and assuming it owes
 * nothing. The alternative is a surprise arrears conversation months later.
 */

import type { JSX } from 'react'
import { use } from 'react'
import { AlertTriangle, Receipt, Users, Wallet } from 'lucide-react'

import { useApi } from '../../../../../lib/use-api'
import { Alert } from '../../../../../components/ui/alert'
import { Badge } from '../../../../../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../../../../../components/ui/card'
import { DataTable } from '../../../../../components/ui/data-table'
import { EmptyState } from '../../../../../components/ui/empty-state'
import { ErrorState, PageHeader, StatSkeleton } from '../../../../../components/ui/data-states'
import { StatCard } from '../../../../../components/ui/stat-card'
import { formatDate, formatKwacha } from '../../school-shared'

interface Invoice {
  id: string
  number: string
  periodStart: string
  periodEnd: string
  tier: string
  pricingModel: string
  studentCount: number | null
  unitPrice: string | number | null
  total: string | number
  amountPaid: string | number
  status: string
  dueAt: string | null
}

interface Payload {
  invoices: Invoice[]
  outstanding: number
  currentCharge: {
    tier: string
    pricingModel: string
    studentCount: number | null
    unitPrice: string | number | null
    amount: string | number | null
    problem: string | null
  } | null
  capacity: {
    limit: number | null
    isUnlimited: boolean
    source: string
    currentCount: number
  } | null
}

const STATUS_LABEL: Record<string, string> = {
  issued: 'Awaiting payment',
  part_paid: 'Partly paid',
  paid: 'Paid',
  void: 'Cancelled',
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  issued: 'warning',
  part_paid: 'warning',
  paid: 'success',
  void: 'neutral',
}

export default function SubscriptionPage({
  params,
}: {
  params: Promise<{ schoolCode: string }>
}): JSX.Element {
  const { schoolCode } = use(params)
  const base = `/school/${schoolCode}`
  const { data, loading, error, code, reload } = useApi<Payload>('/api/school/subscription')

  if (error) return <ErrorState message={error} code={code} onRetry={reload} />
  if (loading && !data) return <StatSkeleton count={3} />

  const c = data?.currentCharge
  const overdue = (data?.invoices ?? []).filter(
    (i) => ['issued', 'part_paid'].includes(i.status) && i.dueAt && new Date(i.dueAt) < new Date(),
  )

  return (
    <>
      <PageHeader
        backTo={base}
        backLabel="Dashboard"
        title="Your subscription"
        description="What this school pays for ZSMS, and the bills you have received."
        note="This is separate from the fees parents pay you — it is what your school pays AfriTech for ZSMS. On a per-pupil plan the amount moves as pupils enrol, so the current period is shown as an estimate until it is invoiced."
      />

      <div className="space-y-cards">
        {c?.problem && (
          <Alert variant="danger" title="Your subscription cannot be priced">
            <AlertTriangle aria-hidden="true" className="mr-1 inline size-4" />
            {c.problem} Contact AfriTech — until it is resolved no invoice can be issued for
            this period, which is not the same as owing nothing.
          </Alert>
        )}

        {overdue.length > 0 && (
          <Alert variant="warning" title="Payment overdue">
            {overdue.length === 1
              ? `Invoice ${overdue[0]?.number} was due on ${formatDate(overdue[0]?.dueAt ?? null)}.`
              : `${overdue.length} invoices are past their due date.`}
          </Alert>
        )}

        <div className="grid grid-cols-1 gap-cards sm:grid-cols-3">
          <StatCard
            label="Your plan"
            value={c?.tier ?? '—'}
            hint={c?.pricingModel === 'per_student' ? 'Charged per pupil' : 'Flat monthly charge'}
            tone="primary"
            icon={<Receipt />}
          />
          <StatCard
            label="This period, estimated"
            value={c?.amount === null || c?.amount === undefined ? '—' : formatKwacha(c.amount)}
            // The arithmetic, so a change is explainable rather than mysterious.
            hint={
              c?.pricingModel === 'per_student' && c.studentCount !== null
                ? `${c.studentCount} pupils at ${formatKwacha(c.unitPrice)} each`
                : 'Before tax and add-ons'
            }
            tone="neutral"
            icon={<Users />}
          />
          <StatCard
            label="Outstanding"
            value={formatKwacha(data?.outstanding ?? 0)}
            hint={(data?.outstanding ?? 0) > 0 ? 'Across unpaid invoices' : 'Nothing owed'}
            tone={(data?.outstanding ?? 0) > 0 ? 'warning' : 'success'}
            icon={<Wallet />}
          />
        </div>

        {data?.capacity && (
          <p className="text-sm text-muted-foreground">
            {data.capacity.isUnlimited ? (
              <>
                Your plan has <strong className="text-foreground">no pupil limit</strong>
                {data.capacity.source === 'per_student_pricing' &&
                  ' — you pay for the pupils you have, so enrolment is never blocked'}
                . Currently {data.capacity.currentCount} pupils.
              </>
            ) : (
              <>
                {data.capacity.currentCount} of {data.capacity.limit} pupils on your plan.
              </>
            )}
          </p>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Invoices</CardTitle>
            <p className="text-sm text-muted-foreground">
              Each shows the pupil count and rate it was calculated from.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable
              caption="Subscription invoices"
              rows={data?.invoices ?? []}
              rowKey={(i) => i.id}
              columns={[
                {
                  key: 'number',
                  header: 'Invoice',
                  primary: true,
                  cell: (i) => (
                    <>
                      <span className="font-mono text-sm text-foreground">{i.number}</span>
                      <span className="block text-xs text-muted-foreground">
                        {formatDate(i.periodStart)} – {formatDate(i.periodEnd)}
                      </span>
                    </>
                  ),
                },
                {
                  key: 'basis',
                  header: 'Based on',
                  // The whole reason the basis is stored on the invoice.
                  cell: (i) =>
                    i.pricingModel === 'per_student' && i.studentCount !== null
                      ? `${i.studentCount} pupils at ${formatKwacha(i.unitPrice)}`
                      : `${i.tier}, flat`,
                },
                {
                  key: 'total',
                  header: 'Total',
                  numeric: true,
                  cell: (i) => formatKwacha(i.total),
                },
                {
                  key: 'status',
                  header: 'State',
                  cell: (i) => (
                    <Badge variant={STATUS_TONE[i.status] ?? 'neutral'}>
                      {STATUS_LABEL[i.status] ?? i.status}
                    </Badge>
                  ),
                },
              ]}
              empty={
                <EmptyState
                  icon={Receipt}
                  title="No invoices yet"
                  description="Invoices appear here once AfriTech issues them. Nothing to pay in the meantime."
                />
              }
            />
          </CardContent>
        </Card>

        <p className="text-sm text-muted-foreground">
          Pay by bank transfer or mobile money to the AfriTech account on your invoice. Payments
          are recorded against your invoice once received — they are not taken automatically.
        </p>
      </div>
    </>
  )
}
