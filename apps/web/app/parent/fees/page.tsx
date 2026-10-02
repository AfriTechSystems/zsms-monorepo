'use client'

/**
 * Parent fees — what you owe, and telling the school you have paid.
 *
 * Spec: `Official Documentation/09 Fee and Financial Management/PAYMENTS.md`
 *
 * ## "Tell the school you have paid" — not "Pay"
 *
 * There is no gateway here. This form records that a parent has paid at a bank or
 * at the office, and the school confirms it. Labelling the button "Pay" would
 * promise a transaction this screen cannot perform, and a parent who believed they
 * had paid would stop chasing a deposit that never cleared.
 *
 * ## The same statement the school reads
 *
 * `fee_statement()` with its brought-forward line — the identical document the
 * bursar sees. A parent disputing a figure and a school defending it should not be
 * comparing two different renderings of the same money.
 *
 * ## A rejected payment says why
 *
 * When the school rejects a claim it must give a reason, and that reason is shown
 * here. Otherwise the parent knows only that something went wrong, which is how a
 * mistyped amount turns into a fortnight of phone calls.
 */

import type { FormEvent, JSX } from 'react'
import { Suspense, useCallback, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Loader2, Send, Wallet } from 'lucide-react'

import { apiSend, useApi } from '../../../lib/use-api'
import { Alert } from '../../../components/ui/alert'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { DataTable } from '../../../components/ui/data-table'
import { EmptyState } from '../../../components/ui/empty-state'
import { ErrorState, TableSkeleton } from '../../../components/ui/data-states'
import { Field, Input, PrefixedInput, Select } from '../../../components/ui/field'
import { FormActions, FormGrid, FormSection } from '../../../components/ui/form'
import { useToast } from '../../../components/ui/toast'

import { FeeBreakdown, type FeeRecordRow } from './fee-breakdown'

interface StatementRow {
  entry_date: string
  entry_type: string
  description: string
  debit: string | number | null
  credit: string | number | null
  running_balance: string | number
}

interface Payment {
  id: string
  amount: string | number
  payment_method: string
  status: string
  receipt_number: string | null
  created_at: string
  rejection_reason: string | null
}

interface Payload {
  children: Array<{ id: string; firstName: string; lastName: string }>
  selected: { id: string; firstName: string; lastName: string } | null
  balance: { outstanding: string | number; arrears_amount: string | number; is_overdue: boolean } | null
  statement: StatementRow[]
  /**
   * One row per charge, from `fee_record_status`.
   *
   * The API has always returned these and the page rendered none of them — so a parent saw
   * a total and a ledger, but never what the total was FOR.
   */
  records: FeeRecordRow[]
  payments: Payment[]
}

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : 0
  return Number.isFinite(n) ? n : 0
}
const kwacha = (v: string | number | null | undefined): string =>
  `K${num(v).toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const shortDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString('en-ZM', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

const METHODS = [
  { value: 'bank_deposit', label: 'Bank deposit' },
  { value: 'cash', label: 'Cash at the school office' },
  { value: 'cheque', label: 'Cheque' },
] as const

function ParentFees(): JSX.Element {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const childId = params.get('childId')
  const { toast } = useToast()

  const url = childId ? `/api/parent/fees?childId=${childId}` : '/api/parent/fees'
  const { data, loading, error, code, reload } = useApi<Payload>(url)

  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<string>('bank_deposit')
  const [reference, setReference] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      if (!data?.selected) return
      setSaving(true)
      setFormError(null)

      const result = await apiSend<{ message: string }>('/api/parent/fees', 'POST', {
        childId: data.selected.id,
        amount: num(amount),
        paymentMethod: method,
        reference: reference.trim() || undefined,
      })

      setSaving(false)
      if (result.error) {
        setFormError(result.error)
        return
      }

      toast(result.data?.message ?? 'The school has been told about your payment.')
      setAmount('')
      setReference('')
      reload()
    },
    [data?.selected, amount, method, reference, toast, reload],
  )

  const switchChild = useCallback(
    (id: string) => {
      const s = new URLSearchParams(params.toString())
      s.set('childId', id)
      router.replace(`${pathname}?${s.toString()}`, { scroll: false })
    },
    [params, pathname, router],
  )

  if (error) return <ErrorState message={error} code={code} onRetry={reload} />
  if (loading && !data) return <TableSkeleton rows={6} columns={4} />
  if (!data?.selected) {
    return (
      <Card>
        <CardContent className="p-0">
          <EmptyState
            icon={Wallet}
            title="No children linked to this account"
            description="Contact the school office to have your account linked to your child."
          />
        </CardContent>
      </Card>
    )
  }

  const rejected = data.payments.filter((p) => p.status === 'rejected' && p.rejection_reason)

  return (
    <div className="space-y-cards">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Fees</h1>
          <p className="text-sm text-muted-foreground">
            {data.selected.firstName} {data.selected.lastName}
          </p>
        </div>

        {data.children.length > 1 && (
          <div className="w-full sm:w-56">
            <Field id="child" label="Child">
              {(props) => (
                <Select
                  {...props}
                  value={data.selected?.id ?? ''}
                  onChange={(e) => switchChild(e.target.value)}
                >
                  {data.children.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.firstName} {c.lastName}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        )}
      </div>

      <Card>
        <CardContent className="pt-card">
          <p className="text-sm text-muted-foreground">You owe</p>
          <p data-numeric className="text-3xl font-semibold text-foreground">
            {kwacha(data.balance?.outstanding)}
          </p>
          {data.balance?.is_overdue && (
            <p className="mt-1 text-sm text-warning-text">
              {kwacha(data.balance.arrears_amount)} of this is past its due date.
            </p>
          )}
        </CardContent>
      </Card>

      {rejected.map((p) => (
        <Alert key={p.id} variant="danger" title="A payment could not be confirmed">
          Your payment of {kwacha(p.amount)} from {shortDate(p.created_at)} was not accepted:{' '}
          {p.rejection_reason} — contact the school office if you think this is wrong.
        </Alert>
      ))}

      <FormSection
        title="Tell the school you have paid"
        description="Use this after paying at the bank or at the school office. It is not a card payment."
      >
        <form onSubmit={submit} noValidate>
          <FormGrid columns={2}>
            <Field id="p-amount" label="How much you paid" required>
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

            <Field id="p-method" label="How you paid" required>
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

            <Field
              id="p-ref"
              label="Deposit slip or reference number"
              hint="Helps the school find your payment on their statement."
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
          </FormGrid>

          {formError && (
            <Alert variant="danger" title="Not recorded" className="mt-stack">
              {formError}
            </Alert>
          )}

          <FormActions>
            <Button type="submit" disabled={saving || num(amount) <= 0}>
              {saving ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : (
                <Send aria-hidden="true" />
              )}
              Tell the school
            </Button>
          </FormActions>
        </form>
      </FormSection>

      {/*
        Above the statement, deliberately.

        The statement is a LEDGER — every entry in date order, which answers "what has
        happened on this account". The breakdown answers "what am I being charged for",
        which is the question a parent actually arrives with, and the one a school office
        spends its mornings answering on the phone.
      */}
      <FeeBreakdown records={data.records ?? []} />

      <Card>
        <CardHeader>
          <CardTitle>Statement</CardTitle>
          <p className="text-sm text-muted-foreground">
            Every charge and every confirmed payment, oldest first.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable
            caption="Fee statement"
            rows={data.statement}
            rowKey={(r) => `${r.entry_date}-${r.entry_type}-${r.description}`}
            columns={[
              {
                key: 'desc',
                header: 'Entry',
                primary: true,
                cell: (r) => (
                  <span
                    className={
                      r.entry_type === 'brought_forward'
                        ? 'font-semibold text-foreground'
                        : 'text-foreground'
                    }
                  >
                    {r.description}
                  </span>
                ),
              },
              { key: 'date', header: 'Date', cell: (r) => shortDate(r.entry_date) },
              {
                key: 'debit',
                header: 'Charged',
                numeric: true,
                cell: (r) => (num(r.debit) > 0 ? kwacha(r.debit) : '—'),
              },
              {
                key: 'credit',
                header: 'Paid',
                numeric: true,
                cell: (r) => (num(r.credit) > 0 ? kwacha(r.credit) : '—'),
              },
              {
                key: 'bal',
                header: 'Balance',
                numeric: true,
                cell: (r) => <span className="font-medium">{kwacha(r.running_balance)}</span>,
              },
            ]}
            empty={
              <div className="p-card text-sm text-muted-foreground">
                Nothing has been charged yet.
              </div>
            }
          />
        </CardContent>
      </Card>

      {data.payments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Payments you have told the school about</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable
              caption="Payment history"
              rows={data.payments}
              rowKey={(p) => p.id}
              columns={[
                {
                  key: 'amount',
                  header: 'Amount',
                  primary: true,
                  numeric: true,
                  cell: (p) => kwacha(p.amount),
                },
                { key: 'when', header: 'Told', cell: (p) => shortDate(p.created_at) },
                {
                  key: 'status',
                  header: 'State',
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
                      {/* Plain words. "pending_verification" is a database state,
                          not something to show a parent. */}
                      {p.status === 'verified'
                        ? 'Confirmed'
                        : p.status === 'rejected'
                          ? 'Not accepted'
                          : 'Waiting for the school'}
                    </Badge>
                  ),
                },
                {
                  key: 'receipt',
                  header: 'Receipt',
                  cell: (p) => (
                    <span className="font-mono text-xs">{p.receipt_number ?? '—'}</span>
                  ),
                },
              ]}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export default function ParentFeesPage(): JSX.Element {
  return (
    <Suspense fallback={<TableSkeleton rows={6} columns={4} />}>
      <ParentFees />
    </Suspense>
  )
}
