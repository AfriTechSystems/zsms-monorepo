'use client'

/**
 * One pupil's fees — the statement, and recording a payment against it.
 *
 * Spec: `Official Documentation/09 Fee and Financial Management/PAYMENTS.md`
 *       `Official Documentation/09 Fee and Financial Management/PAYMENTS.md`
 *
 * ## The brought-forward line is the point of the statement
 *
 * `fee_statement()` opens with a computed **Balance brought forward** — what was
 * owed before the first entry shown. Without it, a statement lists this term's
 * charges and this term's payments and closes on a figure matching neither,
 * because last term's unpaid balance is invisible and still owed. Zambian school
 * fees carry across terms and years, so a statement that starts at zero each
 * term is a statement that misleads the parent reading it.
 *
 * It is rendered as an ordinary row, distinguished only by weight, because it IS
 * an ordinary part of the ledger — not a caveat.
 *
 * ## The allocation is suggested and overridable, and the override is the feature
 *
 * Oldest-first is right almost always and wrong exactly when it matters: a
 * parent paying this term while last term's amount is under dispute. So the
 * suggestion is shown, every line is editable, and a running total says what is
 * still unallocated. The database refuses an allocation exceeding the payment.
 *
 * ## Nothing here moves a balance
 *
 * A recorded payment is `pending_verification`. The screen says so on the button
 * and again in the confirmation, because a clerk who believes they have cleared
 * a balance will not chase it.
 */

import type { FormEvent, JSX } from 'react'
import { SectionTabs, useSectionTabs } from '../../../../../components/ui/section-tabs'
import { use, useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Receipt } from 'lucide-react'

import { apiSend, useApi } from '../../../../../lib/use-api'
import { Alert } from '../../../../../components/ui/alert'
import { Badge } from '../../../../../components/ui/badge'
import { Button } from '../../../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../../../components/ui/card'
import { DataTable } from '../../../../../components/ui/data-table'
import { ErrorState, PageHeader, TableSkeleton } from '../../../../../components/ui/data-states'
import { Field, PrefixedInput, Select } from '../../../../../components/ui/field'
import { FormActions, FormGrid, FormSection } from '../../../../../components/ui/form'
import { InfoHint } from '../../../../../components/ui/info-hint'
import { useToast } from '../../../../../components/ui/toast'
import { formatDate, formatKwacha } from '../../school-shared'

interface StatementRow {
  entry_date: string
  entry_type: string
  description: string
  reference: string | null
  debit: string | number | null
  credit: string | number | null
  running_balance: string | number
}

interface Suggestion {
  fee_record_id: string
  academic_year: string
  term_number: number
  fee_label: string
  due_date: string | null
  outstanding: string | number
  suggested: string | number
}

interface Payload {
  pupil: { id: string; student_id: string; first_name: string; last_name: string; class_id: string }
  balance: { outstanding: string | number; arrears_amount: string | number; is_overdue: boolean } | null
  statement: StatementRow[]
  records: Array<Record<string, unknown>>
  payments: Array<{
    id: string
    amount: string | number
    payment_method: string
    status: string
    receipt_number: string | null
    created_at: string
  }>
  suggestion: Suggestion[]
  canRecord: boolean
}

const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank_deposit', label: 'Bank deposit' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'online_gateway', label: 'Online / mobile money' },
] as const

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : 0
  return Number.isFinite(n) ? n : 0
}

export default function StudentFeesPage({
  params,
}: {
  params: Promise<{ schoolCode: string; studentId: string }>
}): JSX.Element {
  const { schoolCode, studentId } = use(params)
  const base = `/school/${schoolCode}`
  const { toast } = useToast()

  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<string>('cash')
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const parsedAmount = num(amount)

  // The suggestion is re-asked whenever the amount changes, because oldest-first
  // for K500 and for K5,000 are different answers — one clears a record, the
  // other spans three.
  const url = `/api/school/fees/${studentId}${parsedAmount > 0 ? `?amount=${parsedAmount}` : ''}`
  const { data, loading, error, code, reload } = useApi<Payload>(url)
  const [section, setSection] = useSectionTabs<'statement' | 'payment' | 'history'>('statement')

  // Seeded from the suggestion and then owned by the operator. Reset whenever a
  // fresh suggestion arrives, so changing the amount does not leave stale
  // per-record figures that no longer add up.
  useEffect(() => {
    if (!data?.suggestion) return
    const seeded: Record<string, string> = {}
    for (const s of data.suggestion) seeded[s.fee_record_id] = String(num(s.suggested).toFixed(2))
    setOverrides(seeded)
  }, [data?.suggestion])

  const allocated = useMemo(
    () => Object.values(overrides).reduce((t, v) => t + num(v), 0),
    [overrides],
  )
  const unallocated = Math.round((parsedAmount - allocated) * 100) / 100

  const record = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      setSaving(true)
      setFormError(null)

      const allocations = Object.entries(overrides)
        .map(([feeRecordId, v]) => ({ feeRecordId, amount: num(v) }))
        .filter((a) => a.amount > 0)

      const result = await apiSend<{ receiptNumbers: string[] }>(
        `/api/school/fees/${studentId}`,
        'POST',
        {
          amount: parsedAmount,
          paymentMethod: method,
          allocations: allocations.length > 0 ? allocations : undefined,
        },
      )

      setSaving(false)
      if (result.error) {
        setFormError(result.error)
        return
      }

      const receipts = result.data?.receiptNumbers ?? []
      toast(
        `Payment of ${formatKwacha(parsedAmount)} recorded — awaiting verification.` +
          (receipts.length > 0 ? ` Receipt ${receipts.join(', ')}.` : ''),
      )
      setAmount('')
      setOverrides({})
      reload()
    },
    [overrides, parsedAmount, method, studentId, toast, reload],
  )

  const pupilName = data ? `${data.pupil.first_name} ${data.pupil.last_name}` : 'Pupil'

  return (
    <>
      {error && <ErrorState message={error} code={code} onRetry={reload} />}
      {loading && !data && !error && <TableSkeleton rows={8} columns={4} />}

      {!error && data && (
        <>
          <PageHeader
            backTo={`${base}/fees`}
            backLabel="All balances"
            title={pupilName}
            description={data.pupil.student_id}
            note="The statement below opens with a Balance brought forward — what was owed before the first entry shown. Fees carry across terms, so a statement starting at zero each term would understate what is owed. Recording a payment here does not reduce the balance until it is verified."
            actions={
              data.balance && (
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Outstanding</p>
                  <p data-numeric className="text-2xl font-semibold">
                    {formatKwacha(data.balance.outstanding)}
                  </p>
                  {data.balance.is_overdue && (
                    <Badge variant="danger">
                      {formatKwacha(data.balance.arrears_amount)} overdue
                    </Badge>
                  )}
                </div>
              )
            }
          />

          <div className="space-y-cards">
            {/* Payment history grows for the whole of a pupil's time at the school. */}
            <SectionTabs
              tabs={[
                { key: 'statement', label: 'Statement' },
                { key: 'payment', label: 'Record a payment' },
                { key: 'history', label: 'History' },
              ]}
              active={section}
              onChange={setSection}
            />

            {section === 'statement' && (
              <Card>
                <CardHeader>
                  <CardTitle>Statement</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Every charge and every verified payment, oldest first, with a running balance.
                  </p>
                </CardHeader>
                <CardContent className="p-0">
                  <DataTable
                    caption={`Fee statement for ${pupilName}`}
                    rows={data.statement}
                    rowKey={(r, ) => `${r.entry_date}-${r.entry_type}-${r.reference ?? ''}`}
                    collapsible={false}
                    columns={[
                      {
                        key: 'entry',
                        header: 'Entry',
                        primary: true,
                        cell: (r) => (
                          <span
                            className={
                              // Brought-forward is weighted, not annotated. It is
                              // an ordinary part of the ledger, not a caveat.
                              r.entry_type === 'brought_forward'
                                ? 'font-semibold text-foreground'
                                : 'text-foreground'
                            }
                          >
                            {r.description}
                          </span>
                        ),
                      },
                      { key: 'date', header: 'Date', cell: (r) => formatDate(r.entry_date) },
                      {
                        key: 'debit',
                        header: 'Charged',
                        numeric: true,
                        cell: (r) => (num(r.debit) > 0 ? formatKwacha(r.debit) : '—'),
                      },
                      {
                        key: 'credit',
                        header: 'Paid',
                        numeric: true,
                        cell: (r) => (num(r.credit) > 0 ? formatKwacha(r.credit) : '—'),
                      },
                      {
                        key: 'balance',
                        header: 'Balance',
                        numeric: true,
                        cell: (r) => (
                          <span className="font-medium">{formatKwacha(r.running_balance)}</span>
                        ),
                      },
                    ]}
                    empty={
                      <div className="p-card text-sm text-muted-foreground">
                        Nothing has been billed to this pupil yet.
                      </div>
                    }
                  />
                </CardContent>
              </Card>
            )}

            {section === 'payment' && (data.canRecord ? (
              <FormSection
             
                title="Record a payment"
                description="Recorded now, confirmed by whoever checks the bank. The balance moves on verification, not here."
              >
                <form onSubmit={record} noValidate>
                  <FormGrid columns={2}>
                    <Field
                      id="pay-amount"
                      label="Amount received"
                      required
                      hint="What the parent actually handed over."
                    >
                      {(props) => (
                        <PrefixedInput
                          {...props}
                          prefix="K"
                          type="number"
                          min={0}
                          step="0.01"
                          inputMode="decimal"
                          value={amount}
                          required
                          onChange={(e) => setAmount(e.target.value)}
                        />
                      )}
                    </Field>

                    <Field id="pay-method" label="How it was paid" required>
                      {(props) => (
                        <Select {...props} value={method} onChange={(e) => setMethod(e.target.value)}>
                          {METHODS.map((m) => (
                            <option key={m.value} value={m.value}>
                              {m.label}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                  </FormGrid>

                  {parsedAmount > 0 && data.suggestion.length > 0 && (
                    <div className="mt-stack space-y-stack">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-medium text-foreground">
                          Where the money goes
                        </h4>
                        <InfoHint label="how a payment is allocated">
                          Oldest unpaid first, which is almost always right. Change any line if a
                          parent is paying this term while an older amount is in dispute — the
                          total simply has to match what you received.
                        </InfoHint>
                      </div>

                      <ul className="space-y-2">
                        {data.suggestion.map((s) => (
                          <li
                            key={s.fee_record_id}
                            className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-foreground">
                                {s.fee_label} — {s.academic_year} term {s.term_number}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {formatKwacha(s.outstanding)} outstanding
                                {s.due_date ? ` · due ${formatDate(s.due_date)}` : ''}
                              </p>
                            </div>
                            <div className="w-32">
                              <label htmlFor={`alloc-${s.fee_record_id}`} className="sr-only">
                                Amount for {s.fee_label}
                              </label>
                              <PrefixedInput
                                id={`alloc-${s.fee_record_id}`}
                                prefix="K"
                                type="number"
                                min={0}
                                step="0.01"
                                inputMode="decimal"
                                value={overrides[s.fee_record_id] ?? ''}
                                onChange={(e) =>
                                  setOverrides((o) => ({ ...o, [s.fee_record_id]: e.target.value }))
                                }
                              />
                            </div>
                          </li>
                        ))}
                      </ul>

                      {/* The running total, because "does this add up" is the
                          only question an allocation editor has to answer. */}
                      <p
                        className={
                          unallocated === 0
                            ? 'text-sm text-success-text'
                            : unallocated < 0
                              ? 'text-sm text-danger-text'
                              : 'text-sm text-warning-text'
                        }
                      >
                        {unallocated === 0
                          ? `All ${formatKwacha(parsedAmount)} allocated.`
                          : unallocated > 0
                            ? `${formatKwacha(unallocated)} not yet allocated.`
                            : `${formatKwacha(Math.abs(unallocated))} more allocated than received.`}
                      </p>
                    </div>
                  )}

                  {formError && (
                    <Alert variant="danger" title="Payment not recorded" className="mt-stack">
                      {formError}
                    </Alert>
                  )}

                  <FormActions>
                    <Button type="submit" disabled={saving || parsedAmount <= 0 || unallocated < 0}>
                      {saving ? (
                        <Loader2 aria-hidden="true" className="animate-spin" />
                      ) : (
                        <Receipt aria-hidden="true" />
                      )}
                      Record payment for verification
                    </Button>
                  </FormActions>
                </form>
              </FormSection>
            ) : (
              <Alert variant="info" title="Recording payments is the accountant's to do">
                You can see this statement. The school owner and the accountant record and verify
                payments.
              </Alert>
            ))}

            {section === 'history' && data.payments.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Payment history</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <DataTable
                    caption={`Payments recorded for ${pupilName}`}
                    rows={data.payments}
                    rowKey={(p) => p.id}
                    columns={[
                      {
                        key: 'receipt',
                        header: 'Receipt',
                        primary: true,
                        cell: (p) => (
                          <span className="font-mono text-sm">{p.receipt_number ?? '—'}</span>
                        ),
                      },
                      {
                        key: 'amount',
                        header: 'Amount',
                        numeric: true,
                        cell: (p) => formatKwacha(p.amount),
                      },
                      {
                        key: 'status',
                        header: 'Status',
                        cell: (p) => (
                          <Badge
                            variant={
                              p.status === 'verified'
                                ? 'success'
                                : p.status === 'rejected'
                                  ? 'danger'
                                  : 'warning'
                            }
                          >
                            {p.status === 'pending_verification'
                              ? 'Awaiting verification'
                              : p.status}
                          </Badge>
                        ),
                      },
                      { key: 'when', header: 'Recorded', cell: (p) => formatDate(p.created_at) },
                    ]}
                  />
                </CardContent>
              </Card>
            )}
          </div>
        </>
      )}
    </>
  )
}
