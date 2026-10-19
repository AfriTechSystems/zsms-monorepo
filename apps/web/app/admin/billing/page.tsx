'use client'

/**
 * AfriTech → Billing.
 *
 * Spec: `Official Documentation/17 Integration and Pricing/PRICING.md`
 *       migrations `0124`–`0128`
 *
 * ## Failures from a billing run are the most important thing on this screen
 *
 * `run_billing()` continues past a school it cannot price, so one configuration gap
 * does not abort the month — but it returns those schools by name, and they are
 * rendered first and in alarm colours. A run that quietly skipped four schools is
 * four months of revenue nobody notices is missing, and the whole reason the
 * function reports rather than swallows is so this screen can say so.
 *
 * ## Draft, issued, paid — and the screen respects the difference
 *
 * A draft is AfriTech's working state and the school cannot see it. Issuing is the
 * act of sending a bill. Only then can a payment be recorded, because nobody pays a
 * bill they were not sent. The controls appear in that order and not before.
 *
 * ## Recording a payment is not taking one
 *
 * There is no gateway here. The operator records money that has already arrived by
 * bank transfer or mobile money, with the reference from the statement so a
 * reconciliation is possible later. The method list deliberately excludes `gateway`:
 * a gateway payment is confirmed by a webhook, never typed in by a person.
 */

import type { JSX } from 'react'
import { SectionTabs, useSectionTabs } from '../../../components/ui/section-tabs'
import { useCallback, useMemo, useState } from 'react'
import { TriangleAlert, LoaderCircle, Play, Receipt, Send, Wallet, X } from 'lucide-react'

import { apiSend, useApi } from '../../../lib/use-api'
import { Alert } from '../../../components/ui/alert'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { DataTable } from '../../../components/ui/data-table'
import { EmptyState } from '../../../components/ui/empty-state'
import { ErrorState, PageHeader, TableSkeleton } from '../../../components/ui/data-states'
import { Field, Input, PrefixedInput, Select } from '../../../components/ui/field'
import { FormActions, FormGrid, FormSection } from '../../../components/ui/form'
import { useToast } from '../../../components/ui/toast'
import { DateRangeField } from '../../../components/ui/date-field'

interface Invoice {
  id: string
  invoice_number: string
  school_code: string
  school_name: string
  period_start: string
  period_end: string
  currency: string
  tier_name: string
  pricing_model: string
  student_count: number | null
  unit_price: string | number | null
  total: string | number
  amount_paid: string | number
  tax_amount: string | number
  status: string
  due_at: string | null
}

interface Payload {
  invoices: Invoice[]
  schools: Array<{ id: string; school_id: string; name: string; subscription_tier: string | null }>
  totals: {
    billed: number
    collected: number
    outstanding: number
    drafts: number
    overdue: number
  }
}

interface RunProblem {
  school: string
  name: string
  error: string
}

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : 0
  return Number.isFinite(n) ? n : 0
}
const money = (v: unknown): string =>
  `K${num(v).toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const shortDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString('en-ZM', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  draft: 'neutral',
  issued: 'warning',
  part_paid: 'warning',
  paid: 'success',
  void: 'neutral',
}
const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  issued: 'Issued',
  part_paid: 'Part paid',
  paid: 'Paid',
  void: 'Void',
}

/** First and last day of the previous whole month — what a run usually bills. */
function lastMonth(): { start: string; end: string } {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

export default function AdminBillingPage(): JSX.Element {
  const { data, loading, error, code, reload } = useApi<Payload>('/api/admin/billing')
  const { toast } = useToast()
  const [section, setSection] = useSectionTabs<'run' | 'payment' | 'invoices'>('run', ['run', 'payment', 'invoices'])

  const defaults = useMemo(lastMonth, [])
  const [periodStart, setPeriodStart] = useState(defaults.start)
  const [periodEnd, setPeriodEnd] = useState(defaults.end)
  const [taxRate, setTaxRate] = useState('16')
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [problems, setProblems] = useState<RunProblem[]>([])

  const [payInvoice, setPayInvoice] = useState('')
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('bank_transfer')
  const [payReference, setPayReference] = useState('')

  const act = useCallback(
    async (label: string, payload: Record<string, unknown>) => {
      setBusy(label)
      setActionError(null)
      const result = await apiSend<Record<string, unknown>>('/api/admin/billing', 'POST', payload)
      setBusy(null)
      if (result.error) {
        setActionError(result.error)
        return null
      }
      reload()
      return result.data ?? {}
    },
    [reload],
  )

  const runBilling = useCallback(async () => {
    const res = await act('run', {
      action: 'run_billing',
      periodStart,
      periodEnd,
      taxRate: Number(taxRate) || 0,
    })
    if (!res) return
    const created = Number(res['created'] ?? 0)
    const skipped = Number(res['skipped'] ?? 0)
    const failed = Number(res['failed'] ?? 0)
    setProblems((res['problems'] as RunProblem[] | undefined) ?? [])
    toast(
      `${created} invoice${created === 1 ? '' : 's'} created` +
        (skipped > 0 ? `, ${skipped} already existed` : '') +
        (failed > 0 ? `, ${failed} could not be priced` : '') +
        '.',
      failed > 0 ? 'danger' : 'success',
    )
  }, [act, periodStart, periodEnd, taxRate, toast])

  const unpaid = useMemo(
    () => (data?.invoices ?? []).filter((i) => ['issued', 'part_paid'].includes(i.status)),
    [data?.invoices],
  )

  if (error) return <ErrorState message={error} code={code} onRetry={reload} />
  if (loading && !data) return <TableSkeleton rows={8} columns={5} />

  const t = data?.totals

  return (
    <>
      <PageHeader
        title="Billing"
        description="What schools are charged for ZSMS, and what they have paid."
        note="This is AfriTech's revenue, not a school's fee income — separate money in separate tables. A run creates drafts; issuing is what sends a bill, and only an issued invoice can take a payment. Payments are money that has already arrived, recorded here with its bank or mobile-money reference."
      />

      {/* Recording a payment meant scrolling past the billing run every time, and the
          invoice table is the part that grows without limit. */}
      <SectionTabs
        tabs={[
          { key: 'run', label: 'Run billing' },
          { key: 'payment', label: 'Record a payment' },
          { key: 'invoices', label: 'Invoices' },
        ]}
        active={section}
        onChange={setSection}
      />

      <div className="space-y-cards">
        {/* First, loudest. A silently skipped school is lost revenue. */}
        {problems.length > 0 && (
          <Alert
            variant="danger"
            title={`${problems.length} school${problems.length === 1 ? '' : 's'} could not be invoiced`}
          >
            <ul className="mt-1 space-y-1">
              {problems.map((p) => (
                <li key={p.school} className="text-sm">
                  <strong>{p.name}</strong> ({p.school}) — {p.error}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-sm">
              These schools have no invoice for this period. Fix the pricing and run again — the
              run is safe to repeat.
            </p>
          </Alert>
        )}

        {actionError && (
          <Alert variant="danger" title="That did not work">
            {actionError}
          </Alert>
        )}

        <div className="grid grid-cols-2 gap-cards lg:grid-cols-4">
          <Card>
            <CardContent className="pt-card">
              <p className="text-sm text-muted-foreground">Billed</p>
              <p data-numeric className="text-2xl font-semibold">{money(t?.billed)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-card">
              <p className="text-sm text-muted-foreground">Collected</p>
              <p data-numeric className="text-2xl font-semibold text-success-text">
                {money(t?.collected)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-card">
              <p className="text-sm text-muted-foreground">Outstanding</p>
              <p data-numeric className="text-2xl font-semibold text-warning-text">
                {money(t?.outstanding)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-card">
              <p className="text-sm text-muted-foreground">Overdue invoices</p>
              <p data-numeric className="text-2xl font-semibold">
                {t?.overdue ?? 0}
                {(t?.drafts ?? 0) > 0 && (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    · {t?.drafts} draft
                  </span>
                )}
              </p>
            </CardContent>
          </Card>
        </div>

        {section === 'run' && (
          <FormSection
         
            title="Run billing"
            description="Creates one draft invoice per active school for the period. Safe to repeat — schools already invoiced are skipped."
          >
            <FormGrid columns={3}>
              {/* Linked bounds: the browser will not offer a period that ends
                  before it starts, which used to produce an empty run that read
                  as "no schools to invoice". */}
              <DateRangeField
                idPrefix="b-period"
                fromLabel="Period from"
                toLabel="Period to"
                from={periodStart}
                to={periodEnd}
                onFromChange={setPeriodStart}
                onToChange={setPeriodEnd}
              />
              <Field id="b-tax" label="VAT %" hint="Stored on each invoice, so a later change never rewrites it.">
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    inputMode="decimal"
                    value={taxRate}
                    onChange={(e) => setTaxRate(e.target.value)}
                  />
                )}
              </Field>
            </FormGrid>
            <FormActions>
              <Button disabled={busy !== null} onClick={() => void runBilling()}>
                {busy === 'run' ? (
                  <LoaderCircle aria-hidden="true" className="animate-spin" />
                ) : (
                  <Play aria-hidden="true" />
                )}
                Run billing for this period
              </Button>
            </FormActions>
          </FormSection>
        )}

        {section === 'payment' && (
          <FormSection
         
            title="Record a payment"
            description="Money that has already arrived. This does not take a payment — there is no gateway here yet."
          >
            <FormGrid columns={4}>
              <Field id="p-invoice" label="Invoice" required>
                {(props) => (
                  <Select {...props} value={payInvoice} onChange={(e) => setPayInvoice(e.target.value)}>
                    <option value="">Choose an unpaid invoice</option>
                    {unpaid.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.invoice_number} — {i.school_name} — {money(num(i.total) - num(i.amount_paid))} due
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field id="p-amount" label="Amount received" required>
                {(props) => (
                  <PrefixedInput
                    {...props}
                    prefix="K"
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                  />
                )}
              </Field>
              <Field id="p-method" label="How it arrived" required>
                {(props) => (
                  <Select {...props} value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                    <option value="bank_transfer">Bank transfer</option>
                    <option value="mobile_money">Mobile money</option>
                    <option value="cash">Cash</option>
                    <option value="cheque">Cheque</option>
                  </Select>
                )}
              </Field>
              <Field
                id="p-ref"
                label="Reference"
                hint="From the statement, so this can be reconciled."
              >
                {(props) => (
                  <Input
                    {...props}
                    value={payReference}
                    maxLength={120}
                    onChange={(e) => setPayReference(e.target.value)}
                  />
                )}
              </Field>
            </FormGrid>
            <FormActions>
              <Button
                variant="outline"
                disabled={busy !== null || !payInvoice || num(payAmount) <= 0}
                onClick={async () => {
                  const res = await act('pay', {
                    action: 'record_payment',
                    invoiceId: payInvoice,
                    amount: num(payAmount),
                    method: payMethod,
                    reference: payReference || undefined,
                  })
                  if (res) {
                    toast(`${money(payAmount)} recorded.`)
                    setPayAmount('')
                    setPayReference('')
                    setPayInvoice('')
                  }
                }}
              >
                {busy === 'pay' ? (
                  <LoaderCircle aria-hidden="true" className="animate-spin" />
                ) : (
                  <Wallet aria-hidden="true" />
                )}
                Record payment
              </Button>
            </FormActions>
          </FormSection>
        )}

        {section === 'invoices' && (
          <Card>
            <CardHeader>
              <CardTitle>Invoices</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <DataTable
                caption="Subscription invoices"
                rows={data?.invoices ?? []}
                rowKey={(i) => i.id}
                columns={[
                  {
                    key: 'school',
                    header: 'School',
                    primary: true,
                    cell: (i) => (
                      <>
                        <span className="font-medium text-foreground">{i.school_name}</span>
                        <span className="block font-mono text-xs text-subtle">
                          {i.invoice_number} · {shortDate(i.period_start)}
                        </span>
                      </>
                    ),
                  },
                  {
                    key: 'basis',
                    header: 'Based on',
                    cell: (i) =>
                      i.pricing_model === 'per_student' && i.student_count !== null
                        ? `${i.student_count} × ${money(i.unit_price)}`
                        : `${i.tier_name}, flat`,
                  },
                  { key: 'total', header: 'Total', numeric: true, cell: (i) => money(i.total) },
                  {
                    key: 'due',
                    header: 'Outstanding',
                    numeric: true,
                    cell: (i) => {
                      const owed = num(i.total) - num(i.amount_paid)
                      return i.status === 'void' ? (
                        <span className="text-muted-foreground">—</span>
                      ) : owed > 0 ? (
                        <span className="text-warning-text">{money(owed)}</span>
                      ) : (
                        <span className="text-success-text">—</span>
                      )
                    },
                  },
                  {
                    key: 'status',
                    header: 'State',
                    cell: (i) => (
                      <>
                        <Badge variant={STATUS_TONE[i.status] ?? 'neutral'}>
                          {STATUS_LABEL[i.status] ?? i.status}
                        </Badge>
                        {['issued', 'part_paid'].includes(i.status) &&
                          i.due_at &&
                          new Date(i.due_at) < new Date() && (
                            <span className="ml-1 inline-flex items-center text-xs text-danger-text">
                              <TriangleAlert aria-hidden="true" className="mr-0.5 size-3" />
                              overdue
                            </span>
                          )}
                      </>
                    ),
                  },
                  {
                    key: 'act',
                    header: '',
                    cell: (i) => (
                      <div className="flex flex-wrap gap-1">
                        {i.status === 'draft' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy !== null}
                            onClick={async () => {
                              const res = await act('issue', { action: 'issue', invoiceId: i.id })
                              if (res) toast(`${i.invoice_number} issued.`)
                            }}
                          >
                            <Send aria-hidden="true" />
                            Issue
                          </Button>
                        )}
                        {i.status !== 'paid' && i.status !== 'void' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy !== null}
                            onClick={async () => {
                              // A reason is required by the function, and a school will
                              // ask why a bill vanished.
                              const reason = window.prompt(
                                `Why is ${i.invoice_number} being voided? The school may ask.`,
                              )
                              if (!reason) return
                              const res = await act('void', {
                                action: 'void',
                                invoiceId: i.id,
                                reason,
                              })
                              if (res) toast(`${i.invoice_number} voided.`)
                            }}
                          >
                            <X aria-hidden="true" />
                            Void
                          </Button>
                        )}
                      </div>
                    ),
                  },
                ]}
                empty={
                  <EmptyState
                    icon={Receipt}
                    title="No invoices yet"
                    description="Run billing for a period above to create drafts, then issue them."
                  />
                }
              />
            </CardContent>
          </Card>
        )}
      </div>
    </>
  )
}
