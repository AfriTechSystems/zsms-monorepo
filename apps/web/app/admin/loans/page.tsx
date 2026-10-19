'use client'

/**
 * The loan officer's queue.
 *
 * Spec: `Official Documentation/14 Loan and Finance Module/` — LOANS.md Phase 1,
 *       SUBMISSION.md, LENDER_INTEGRATION.md
 *
 * ## Phase 1 is a person, not a pipeline
 *
 * `LOANS.md`: ZSMS packages applications and emails them to partner lenders, who decide
 * manually over three to five business days, and "AfriTech loan officer manually updates
 * application status". So this screen is a worklist — it leads with what is waiting,
 * because that is the only thing on it that needs doing today.
 *
 * ## This audience sees the income and the score
 *
 * The parent sees their own; the school sees neither. AfriTech sees both, because they
 * are the ones packaging the application for the lender and, per `BEHAVIOUR_SCORE.md`,
 * the ones who explain a score to a parent who disputes it.
 *
 * ## A decline needs a reason, and the parent reads it
 *
 * Enforced in the function, surfaced here as a required field. "Declined" with no reason
 * is a dead end for a parent who might have fixed the problem.
 */

import type { JSX } from 'react'
import { useCallback, useState } from 'react'
import { Banknote, LoaderCircle } from 'lucide-react'

import { Alert } from '../../../components/ui/alert'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'
import { Dialog } from '../../../components/ui/dialog'
import { ErrorState, PageHeader, TableSkeleton } from '../../../components/ui/data-states'
import { EmptyState } from '../../../components/ui/empty-state'
import { Field, Input, Select, Textarea } from '../../../components/ui/field'
import { useToast } from '../../../components/ui/toast'
import { apiSend, useApi } from '../../../lib/use-api'

interface Row {
  id: string
  schoolId: string
  amount: number
  status: string
  lenderName: string | null
  score: number | null
  employmentType: string | null
  monthlyIncome: number | null
  createdAt: string
}

const kwacha = (n: number): string =>
  `K${Number(n).toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const STATUSES = [
  { value: '', label: 'Everything' },
  { value: 'submitted', label: 'With the lender' },
  { value: 'under_review', label: 'Being reviewed' },
  { value: 'approved', label: 'Approved' },
  { value: 'declined', label: 'Declined' },
  { value: 'disbursed', label: 'Disbursed' },
  { value: 'cancelled', label: 'Cancelled' },
] as const

const TONE: Record<string, 'neutral' | 'info' | 'success' | 'danger'> = {
  pending: 'neutral',
  submitted: 'info',
  under_review: 'info',
  approved: 'success',
  declined: 'danger',
  disbursed: 'success',
  cancelled: 'neutral',
}

export default function AdminLoansPage(): JSX.Element {
  const { toast } = useToast()
  const [filter, setFilter] = useState('')

  const { data, loading, error, code, reload } = useApi<{
    applications: Row[]
    meta: { awaitingAction: number }
  }>(`/api/admin/loans${filter ? `?status=${filter}` : ''}`)

  /** The application being moved, with the fields that status needs. */
  const [editing, setEditing] = useState<Row | null>(null)
  const [status, setStatus] = useState('under_review')
  const [reference, setReference] = useState('')
  const [reason, setReason] = useState('')
  const [disbursed, setDisbursed] = useState('')
  const [busy, setBusy] = useState(false)

  const save = useCallback(async () => {
    if (!editing) return
    setBusy(true)
    try {
      const result = await apiSend<{ message: string }>('/api/admin/loans', 'PATCH', {
        id: editing.id,
        status,
        lenderReference: reference.trim() || undefined,
        declineReason: status === 'declined' ? reason.trim() : undefined,
        disbursedAmount:
          status === 'disbursed' ? Number(disbursed.replace(/[^0-9.]/g, '')) : undefined,
      })

      if (result.error) {
        toast(result.error, 'danger')
        return
      }

      setEditing(null)
      setReference('')
      setReason('')
      setDisbursed('')
      toast(result.data?.message ?? 'Updated.', 'success')
      reload()
    } finally {
      setBusy(false)
    }
  }, [editing, status, reference, reason, disbursed, toast, reload])

  if (loading && !data) return <TableSkeleton rows={6} columns={5} />
  if (error) return <ErrorState message={error} code={code} onRetry={reload} />

  const rows = data?.applications ?? []

  return (
    <>
      <PageHeader
        title="Loan applications"
        description="Applications from parents, for packaging and sending to partner lenders."
        note="Phase 1 is manual: applications are emailed to the lender, who decides in three to five business days. Commission accrues when a loan is marked disbursed, not when it is approved."
      />

      {/* What needs doing today, before anything else on the page. */}
      {(data?.meta.awaitingAction ?? 0) > 0 && (
        <Alert variant="info" title="Waiting on a lender decision" className="mb-cards">
          {data?.meta.awaitingAction} application
          {data?.meta.awaitingAction === 1 ? '' : 's'} sent and not yet decided. Update them
          here as the lender replies.
        </Alert>
      )}

      <Card className="mb-cards">
        <CardContent className="pt-card">
          <Field id="f-status" label="Status">
            {(props) => (
              <Select {...props} value={filter} onChange={(e) => setFilter(e.target.value)}>
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <EmptyState
          icon={Banknote}
          title={filter ? 'Nothing at that status' : 'No applications yet'}
          description={
            filter
              ? 'Clear the filter to see everything.'
              : 'When a parent applies for a fee loan it appears here for packaging.'
          }
        />
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 p-stack">
              <span className="flex min-w-0 flex-col">
                <span className="flex items-center gap-2 font-medium">
                  <span data-numeric>{kwacha(r.amount)}</span>
                  <Badge variant={TONE[r.status] ?? 'neutral'}>
                    {r.status.replace(/_/g, ' ')}
                  </Badge>
                </span>
                <span className="text-sm text-muted-foreground">
                  {r.lenderName ?? 'no lender'}
                  {r.score !== null && (
                    <>
                      {' · score '}
                      <span data-numeric>{r.score}</span>
                    </>
                  )}
                  {r.monthlyIncome !== null && (
                    <>
                      {' · income '}
                      <span data-numeric>{kwacha(r.monthlyIncome)}</span>
                    </>
                  )}
                  {' · '}
                  {new Date(r.createdAt).toLocaleDateString()}
                </span>
              </span>

              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={() => {
                  setEditing(r)
                  setStatus(r.status === 'submitted' ? 'under_review' : r.status)
                  setDisbursed(String(r.amount))
                }}
              >
                Update
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={editing !== null}
        title="Update this application"
        description="The parent sees the new status, and the reason if you decline."
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button
              disabled={
                busy ||
                (status === 'declined' && reason.trim().length < 5) ||
                (status === 'disbursed' && Number(disbursed.replace(/[^0-9.]/g, '')) <= 0)
              }
              onClick={() => void save()}
            >
              {busy && <LoaderCircle aria-hidden="true" className="animate-spin" />}
              Save
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </>
        }
      >
        {editing && (
          <div className="flex flex-col gap-stack">
            <Field id="u-status" label="Status" required>
              {(props) => (
                <Select {...props} value={status} onChange={(e) => setStatus(e.target.value)}>
                  {STATUSES.filter((s) => s.value).map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field
              id="u-ref"
              label="Lender's reference"
              hint="Shown to the parent so they can quote it to the lender."
            >
              {(props) => (
                <Input
                  {...props}
                  value={reference}
                  maxLength={120}
                  onChange={(e) => setReference(e.target.value)}
                />
              )}
            </Field>

            {/* Required by the function, and the parent reads it. */}
            {status === 'declined' && (
              <Field
                id="u-reason"
                label="Why it was declined"
                required
                hint="The parent sees this. Say what they could change, if anything."
              >
                {(props) => (
                  <Textarea
                    {...props}
                    rows={3}
                    value={reason}
                    maxLength={500}
                    onChange={(e) => setReason(e.target.value)}
                  />
                )}
              </Field>
            )}

            {status === 'disbursed' && (
              <>
                <Field
                  id="u-amount"
                  label="Amount actually paid"
                  required
                  hint="What the lender sent to the school, which may differ from what was asked for."
                >
                  {(props) => (
                    <Input
                      {...props}
                      type="number"
                      min={0}
                      step="0.01"
                      value={disbursed}
                      onChange={(e) => setDisbursed(e.target.value)}
                    />
                  )}
                </Field>

                <Alert variant="info" title="This accrues commission">
                  Marking a loan disbursed records AfriTech&apos;s origination commission
                  against it. Only do this once the lender confirms the money has moved.
                </Alert>
              </>
            )}
          </div>
        )}
      </Dialog>
    </>
  )
}
