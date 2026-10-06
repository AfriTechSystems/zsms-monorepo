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
import { Suspense, useCallback, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Landmark, Loader2, Send, Wallet } from 'lucide-react'

import { apiSend, useApi } from '../../../lib/use-api'
import { Alert } from '../../../components/ui/alert'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { DataTable } from '../../../components/ui/data-table'
import { DocumentDownload } from '../../../components/ui/document-download'
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
  accounts: Array<{
    id: string
    method_kind: string
    label: string
    bank_name: string | null
    account_name: string | null
    account_number: string | null
    branch: string | null
    provider: string | null
    phone_number: string | null
    instructions: string | null
  }>
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

  /*
    The receipts for this child, in ONE request.

    A fetch per payment row would be an N+1 over the network for a table a parent
    scrolls past. Fetched as a list and matched by payment id instead; a payment with
    no row simply has no button, which is the normal state while the worker renders.
  */
  const { data: docs } = useApi<{
    documents: Array<{ id: string; paymentId: string | null; status: string; failureReason: string | null }>
  }>(
    data?.selected
      ? `/api/documents?docType=payment_receipt&studentId=${data.selected.id}`
      : null,
  )

  const receiptFor = useMemo(() => {
    const map = new Map<string, { id: string; status: string; failureReason: string | null }>()
    for (const d of docs?.documents ?? []) {
      if (d.paymentId) map.set(d.paymentId, d)
    }
    return map
  }, [docs])

  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<string>('bank_deposit')
  const [reference, setReference] = useState('')

  /*
    The confirmation box, and the moment it was ticked.

    The timestamp is captured when the box is TICKED, not when the form is submitted,
    because that is what it records — `allocate_payment()` refuses one older than ten
    minutes, so a form left open on a shared machine cannot be submitted on somebody
    else's tick.
  */
  const [confirmed, setConfirmed] = useState(false)
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null)

  /** Which terms this payment is for. Empty means oldest-first, i.e. arrears first. */
  const [chosenTerms, setChosenTerms] = useState<string[]>([])

  /*
    A duplicate reference the parent has been shown and may proceed past.

    `PAYMENTS.md` is explicit that this is a warning, not a refusal: a parent who
    genuinely paid twice with one mistyped reference must still be able to record the
    second payment.
  */
  const [duplicateSeen, setDuplicateSeen] = useState(false)

  /** Proof: the stored path, and the name to show back. */
  const [proof, setProof] = useState<{ path: string; fileName: string } | null>(null)
  const [uploading, setUploading] = useState(false)

  /*
    Terms with something still owing, newest last.

    `fee_record_status` already arrives from the GET ordered by due date, so this is a
    filter rather than a second request.
  */
  const outstanding = useMemo(
    () =>
      (data?.records ?? []).filter((r) => Number(r.outstanding) > 0),
    [data],
  )

  /** Current term first, which is what a parent paying on time wants. */
  const currentTermId = outstanding.at(-1)?.id ?? null
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
        proofPath: proof?.path,
        acknowledgeDuplicate: duplicateSeen || undefined,
        // Never `new Date()` here: the declaration was made when the box was ticked.
        confirmedAt: confirmedAt ?? new Date().toISOString(),
        /*
          Only when the parent actually chose. Sending an allocation for every
          outstanding term would override the oldest-first default with the same
          thing spelled out, and would then be wrong the moment a balance changed
          between loading the page and submitting.
        */
        allocations:
          chosenTerms.length > 0
            ? chosenTerms.map((id, i) => {
                const rec = outstanding.find((r) => r.id === id)
                const owed = Number(rec?.outstanding ?? 0)
                // The last chosen term takes whatever is left, so the amounts always
                // total the payment even when it does not divide evenly.
                const spentBefore = chosenTerms
                  .slice(0, i)
                  .reduce(
                    (t, prev) =>
                      t + Math.min(Number(outstanding.find((r) => r.id === prev)?.outstanding ?? 0), num(amount) - t),
                    0,
                  )
                const left = num(amount) - spentBefore
                return { feeRecordId: id, amount: Math.min(owed, left) }
              }).filter((a) => a.amount > 0)
            : undefined,
      })

      setSaving(false)
      if (result.error) {
        setFormError(result.error)
        /*
          A CONFLICT here is the duplicate-reference warning. Remembering that it was
          shown is what lets the next submit through — the message names what was found,
          so pressing the button again is a deliberate acknowledgement.
        */
        if (result.code === 'CONFLICT') setDuplicateSeen(true)
        return
      }

      toast(result.data?.message ?? 'The school has been told about your payment.')
      setAmount('')
      setReference('')
      setProof(null)
      setDuplicateSeen(false)
      setConfirmed(false)
      setConfirmedAt(null)
      setChosenTerms([])
      reload()
    },
    [
      data?.selected,
      amount,
      method,
      reference,
      proof,
      duplicateSeen,
      confirmedAt,
      chosenTerms,
      outstanding,
      toast,
      reload,
    ],
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

      {/*
        Where to pay, before the form that records having paid.

        In this order deliberately: a parent arriving to pay needs the account number
        first, and a parent arriving to record a payment already has it. Putting the
        claim form first would make the common case scroll past the thing it needs.
      */}
      {(data.accounts?.length ?? 0) > 0 && (
        <Card className="mb-cards">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Landmark aria-hidden="true" className="size-5 text-primary" />
              How to pay {data.selected.firstName}&apos;s fees
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-stack">
            <p className="text-sm text-muted-foreground">
              Pay the school directly using one of these, then record it below so they can
              confirm it. ZSMS does not take the money.
            </p>

            <ul className="flex flex-col gap-stack">
              {data.accounts.map((a) => (
                <li key={a.id} className="rounded-md border border-border p-card">
                  <p className="font-medium">{a.label}</p>

                  <dl className="mt-1 grid gap-x-cards gap-y-1 text-sm sm:grid-cols-2">
                    {a.bank_name && (
                      <div>
                        <dt className="text-muted-foreground">Bank</dt>
                        <dd>{a.bank_name}</dd>
                      </div>
                    )}
                    {a.account_name && (
                      <div>
                        <dt className="text-muted-foreground">Account name</dt>
                        <dd>{a.account_name}</dd>
                      </div>
                    )}
                    {a.account_number && (
                      <div>
                        <dt className="text-muted-foreground">Account number</dt>
                        {/* Monospaced and spaced out: this gets copied by hand into a
                            banking app, and a transposed digit sends the fees to a
                            stranger. */}
                        <dd data-numeric className="font-mono tracking-wide">
                          {a.account_number}
                        </dd>
                      </div>
                    )}
                    {a.branch && (
                      <div>
                        <dt className="text-muted-foreground">Branch</dt>
                        <dd>{a.branch}</dd>
                      </div>
                    )}
                    {a.provider && (
                      <div>
                        <dt className="text-muted-foreground">Provider</dt>
                        <dd>{a.provider}</dd>
                      </div>
                    )}
                    {a.phone_number && (
                      <div>
                        <dt className="text-muted-foreground">Number</dt>
                        <dd data-numeric className="font-mono tracking-wide">
                          {a.phone_number}
                        </dd>
                      </div>
                    )}
                  </dl>

                  {a.instructions && (
                    <p className="mt-stack text-sm text-muted-foreground">{a.instructions}</p>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <FormSection
        title="Pay school fees"
        /*
          The heading says "Pay"; the checkbox says "claim".

          A parent looking for how to pay their child's fees looks for the word pay, so
          hiding the feature behind "tell the school you have paid" made it hard to
          find. But ZSMS takes no money here, so the thing actually being recorded is a
          DECLARATION — and the confirmation box below says so in the parent's own
          words before they can submit.
        */
        description="Pay the school directly using the details below, then record it here so they can confirm it."
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
              hint="Helps the school find your payment on their statement, and warns you if you have already recorded this one."
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

          {/* ---- which term this payment is for ---- */}
          {outstanding.length > 1 && (
            <fieldset className="mt-cards">
              <legend className="text-sm font-medium">What is this payment for?</legend>
              <p className="mb-stack text-sm text-muted-foreground">
                Leave these unticked and the school will put it against your oldest
                balance first, which clears arrears before the current term. Tick one or
                more to say otherwise.
              </p>

              <div className="flex flex-col gap-2">
                {outstanding.map((r) => (
                  <label
                    key={r.id}
                    className="flex min-h-tap cursor-pointer items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={chosenTerms.includes(r.id)}
                      onChange={(e) =>
                        setChosenTerms((prev) =>
                          e.target.checked
                            ? [...prev, r.id]
                            : prev.filter((x) => x !== r.id),
                        )
                      }
                    />
                    <span>
                      {r.fee_label ?? 'Fees'} — Term {r.term_number}, {r.academic_year}
                      {r.id === currentTermId && (
                        <span className="ml-1.5 align-middle">
                          <Badge variant="info">This term</Badge>
                        </span>
                      )}
                    </span>
                    <span data-numeric className="ml-auto text-muted-foreground">
                      {kwacha(r.outstanding)} owing
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {/* ---- proof of payment ---- */}
          <div className="mt-cards flex flex-col gap-stack">
            <Field
              id="p-proof"
              label="Proof of payment"
              hint="A photo or screenshot of your mobile money message, or the bank slip. Not needed if you paid cash at the school office."
            >
              {(props) => (
                <Input
                  {...props}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                  disabled={uploading || !data?.selected}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (!file || !data?.selected) return
                    setUploading(true)
                    setFormError(null)

                    /*
                      Uploaded as soon as it is chosen, not at submit.

                      A parent on a slow connection should spend the upload time while
                      they are still filling the form, and a validation error must not
                      make them photograph the receipt again.
                    */
                    const body = new FormData()
                    body.append('file', file)
                    body.append('childId', data.selected.id)

                    void fetch('/api/parent/fees/proof', { method: 'POST', body })
                      .then(async (res) => {
                        const parsed = (await res.json().catch(() => null)) as
                          | { data?: { path: string; fileName: string }; error?: string }
                          | null
                        if (res.ok && parsed?.data) {
                          setProof(parsed.data)
                        } else {
                          setFormError(parsed?.error ?? 'That file could not be uploaded.')
                        }
                      })
                      .catch(() =>
                        setFormError('Could not upload the file. Check your connection.'),
                      )
                      .finally(() => setUploading(false))
                  }}
                />
              )}
            </Field>

            {uploading && (
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                Uploading…
              </p>
            )}

            {proof && !uploading && (
              <p className="text-sm text-success">{proof.fileName} uploaded</p>
            )}
          </div>

          {/* ---- the declaration ---- */}
          <label className="mt-cards flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0"
              checked={confirmed}
              onChange={(e) => {
                setConfirmed(e.target.checked)
                // Stamped when TICKED. `allocate_payment()` refuses one older than ten
                // minutes, so a form left open cannot be submitted on this tick.
                setConfirmedAt(e.target.checked ? new Date().toISOString() : null)
              }}
            />
            <span>
              {/*
                The exact words from PAYMENTS.md, plus the one thing the heading does not
                say: this is a CLAIM. The school decides whether it is true, and a parent
                should know that before they tick rather than after a rejection.
              */}
              I confirm that this payment has been made and the information provided is
              accurate. I understand this is a claim the school will check against their
              records, and that false submissions may result in account suspension.
            </span>
          </label>

          {formError && (
            <Alert
              variant={duplicateSeen ? 'warning' : 'danger'}
              title={duplicateSeen ? 'Already recorded?' : 'Not recorded'}
              className="mt-stack"
            >
              {formError}
              {duplicateSeen && (
                <span className="mt-1 block">
                  If this really is a separate payment, press the button again and it will
                  be recorded.
                </span>
              )}
            </Alert>
          )}

          <FormActions>
            <Button
              type="submit"
              disabled={saving || uploading || !confirmed || num(amount) <= 0}
            >
              {saving ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : (
                <Send aria-hidden="true" />
              )}
              Record this payment
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
                  cell: (p) => {
                    const doc = receiptFor.get(p.id)
                    return (
                      <span className="flex flex-col items-start gap-1">
                        <span className="font-mono text-xs">{p.receipt_number ?? '—'}</span>
                        {/*
                          Only when a document actually exists. A receipt is rendered by a
                          worker AFTER the school verifies the payment, so the normal state
                          for a fresh payment is a number and no file yet — and a button
                          that could only fail would be worse than no button.
                        */}
                        {doc && doc.status !== 'failed' && (
                          <DocumentDownload documentId={doc.id} label="PDF" variant="ghost" />
                        )}
                      </span>
                    )
                  },
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
