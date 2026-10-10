'use client'

/**
 * School fee loans — applying, and tracking.
 *
 * Spec: `Official Documentation/14 Loan and Finance Module/` — APPLICATION.md,
 *       CONSENT.md, SUBMISSION.md, BEHAVIOUR_SCORE.md, REPAYMENT.md
 *
 * ## The consent is three screens, and that is the point
 *
 * `CONSENT.md` specifies an introduction, a lender-specific consent, and a summary.
 * Compressing them into one checkbox would be faster and would also be the thing that
 * makes the disclosure unlawful: a parent has to be told WHO will see their data, WHAT
 * they will see, and WHY, before agreeing — and each of those is a separate thing to
 * understand.
 *
 * So the flow is stepped, the lender is named on the consent itself, and the summary
 * repeats what was agreed before the submit button does anything.
 *
 * ## The score is explained, never just shown
 *
 * `BEHAVIOUR_SCORE.md`: "Parents have the right to understand their score." A number with
 * no breakdown is a refusal they cannot argue with, so every category and its weight is
 * on the page.
 *
 * ## ZSMS is not the lender, and says so
 *
 * The money comes from a partner MFI and goes to the SCHOOL; the parent repays the
 * lender, not ZSMS. Said plainly at the top, because a parent who thinks ZSMS lent them
 * the money will come to ZSMS when they cannot repay.
 */

import type { JSX } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Banknote, Building2, CheckCircle2, Info, Loader2 } from 'lucide-react'

import { Alert } from '../../../components/ui/alert'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card'
import { Dialog } from '../../../components/ui/dialog'
import { ErrorState, PageHeader, TableSkeleton } from '../../../components/ui/data-states'
import { EmptyState } from '../../../components/ui/empty-state'
import { Field, Input, Select } from '../../../components/ui/field'
import { useToast } from '../../../components/ui/toast'
import { apiSend, useApi } from '../../../lib/use-api'

interface Application {
  id: string
  amount: number
  status: string
  lenderName: string | null
  score: number | null
  breakdown: Record<string, { score: number; weight: number }> | null
  declineReason: string | null
  lenderReference: string | null
  disbursedAmount: number | null
  disbursedAt: string | null
  collectionInstructions: string | null
  collectionAccount: Record<string, unknown> | null
  createdAt: string
}

interface Lender {
  id: string
  displayName: string
  tagline: string | null
  description: string | null
  minAmount: number
  maxAmount: number
  interestRate: string
  turnaround: string
  eligibility: string[]
  documents: string[]
  featured: boolean
}

const kwacha = (n: number): string =>
  `K${Number(n).toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Plain words. A parent should not have to learn our status vocabulary. */
const STATUS: Record<string, { label: string; tone: 'neutral' | 'info' | 'success' | 'danger' }> = {
  pending: { label: 'Not yet sent', tone: 'neutral' },
  submitted: { label: 'With the lender', tone: 'info' },
  under_review: { label: 'Being reviewed', tone: 'info' },
  approved: { label: 'Approved', tone: 'success' },
  declined: { label: 'Not approved', tone: 'danger' },
  disbursed: { label: 'Paid to your school', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

/** The score band, in the words `BEHAVIOUR_SCORE.md` uses. */
function band(score: number): string {
  if (score >= 750) return 'Excellent'
  if (score >= 650) return 'Good'
  if (score >= 550) return 'Fair'
  if (score >= 450) return 'Poor'
  return 'Very poor'
}

const CONSENT_VERSION = 'v1'

/**
 * The exact wording a parent agrees to.
 *
 * Kept here as one constant so the hash sent with the application is a hash of what was
 * actually on screen. Two copies — one shown, one hashed — would eventually differ, and
 * the consent log would attest to text nobody saw.
 */
const CONSENT_TEXT = `I authorise ZSMS (AfriTech Systems Limited) to share the following with the lender I have chosen: my name and contact details, my children's school and fee records, my declared income and employment, the payslip I have uploaded, and a payment behaviour score calculated from my fee payment history.

I understand that:
- ZSMS is not the lender and does not decide whether I am approved.
- The lender will pay my school directly, not me.
- I will repay the lender, not ZSMS, on the terms they give me.
- This authorisation applies only to the lender I have selected.
- The information I have given is accurate, and giving false information may mean my application is refused and my account suspended.`

export default function ParentLoansPage(): JSX.Element {
  const { toast } = useToast()

  /*
    Which fee this loan is against.

    From the query string, so the fees page links straight into the flow with the term
    already chosen — `APPLICATION.md`'s "Entry Point 1 — From a Fee Record". Read with
    `useSearchParams` rather than `window.location` so it updates on navigation; the
    parent shell already has the Suspense boundary that needs.
  */
  const feeRecordId = useSearchParams().get('feeRecordId') ?? ''

  const { data, loading, error, code, reload } = useApi<{ applications: Application[] }>(
    '/api/parent/loans',
  )

  /** Fetched only when the flow opens — a parent reading their history needs none of it. */
  const [applying, setApplying] = useState(false)
  const { data: offer } = useApi<{
    score: number | null
    breakdown: Record<string, { score: number; weight: number }> | null
    lenders: Lender[]
  }>(applying ? '/api/parent/loans?lenders=true' : null)

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [lenderId, setLenderId] = useState('')
  const [amount, setAmount] = useState('')
  const [employment, setEmployment] = useState('employed')
  const [employer, setEmployer] = useState('')
  const [income, setIncome] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [agreedAt, setAgreedAt] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const lender = useMemo(
    () => (offer?.lenders ?? []).find((l) => l.id === lenderId) ?? null,
    [offer, lenderId],
  )

  const num = (s: string): number => {
    const n = Number(s.replace(/[^0-9.]/g, ''))
    return Number.isFinite(n) ? n : 0
  }

  const close = useCallback(() => {
    setApplying(false)
    setStep(1)
    setLenderId('')
    setAmount('')
    setEmployer('')
    setIncome('')
    setAgreed(false)
    setAgreedAt(null)
    setFormError(null)
  }, [])

  const submit = useCallback(async () => {
    if (!lender || !agreedAt) return
    setBusy(true)
    setFormError(null)
    try {
      /*
        The hash is computed over the SAME constant that was rendered.

        SHA-256 in the browser via SubtleCrypto, so the consent log can prove years later
        exactly which wording was agreed to.
      */
      const bytes = new TextEncoder().encode(CONSENT_TEXT)
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      const hash = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')

      const result = await apiSend<{ message: string }>('/api/parent/loans', 'POST', {
        // The fee record is chosen by the server from the parent's outstanding fees in
        // this version; a parent with several picks one on the fees page.
        feeRecordId: feeRecordId,
        amount: num(amount),
        lenderId: lender.id,
        employmentType: employment,
        employerName: employer.trim() || undefined,
        monthlyIncome: income ? num(income) : undefined,
        consentVersion: CONSENT_VERSION,
        consentTextHash: hash,
        consentedAt: agreedAt,
      })

      if (result.error) {
        setFormError(result.error)
        return
      }

      toast(result.data?.message ?? 'Application sent.', 'success')
      close()
      reload()
    } finally {
      setBusy(false)
    }
  }, [
    lender,
    agreedAt,
    amount,
    employment,
    employer,
    income,
    feeRecordId,
    toast,
    close,
    reload,
  ])

  if (loading && !data) return <TableSkeleton rows={4} columns={3} />
  if (error) return <ErrorState message={error} code={code} onRetry={reload} />

  const applications = data?.applications ?? []

  return (
    <>
      <PageHeader
        title="School fee loans"
        description="Apply to a lending partner to help pay your child's fees."
        note="ZSMS is not the lender. A partner pays your school directly, and you repay that partner on the terms they give you — not ZSMS."
      />

      {!feeRecordId && (
        <Alert variant="info" title="Start from the fee you want help with" className="mb-cards">
          Open your fees, choose the term you need help paying, and the loan form will
          know which one you mean.
        </Alert>
      )}

      <div className="mb-cards">
        <Button disabled={!feeRecordId} onClick={() => setApplying(true)}>
          <Banknote aria-hidden="true" />
          Apply for a fee loan
        </Button>
      </div>

      {applications.length === 0 ? (
        <EmptyState
          icon={Banknote}
          title="No applications yet"
          description="When you apply for help paying fees, the application and its progress appear here."
        />
      ) : (
        <ul className="flex flex-col gap-cards">
          {applications.map((a) => {
            const s = STATUS[a.status] ?? { label: a.status, tone: 'neutral' as const }
            return (
              <li key={a.id}>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      <span data-numeric>{kwacha(a.amount)}</span>
                      <Badge variant={s.tone}>{s.label}</Badge>
                    </CardTitle>
                    <CardDescription>
                      {a.lenderName ?? 'Lender not chosen'} ·{' '}
                      {new Date(a.createdAt).toLocaleDateString()}
                      {a.lenderReference && ` · reference ${a.lenderReference}`}
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="flex flex-col gap-stack">
                    {a.declineReason && (
                      <Alert variant="warning" title="Why it was not approved">
                        {a.declineReason}
                      </Alert>
                    )}

                    {/* Repayment details, only once the money has actually moved. */}
                    {a.status === 'disbursed' && (
                      <Alert variant="success" title="Paid to your school">
                        <span className="block">
                          {a.disbursedAmount ? kwacha(a.disbursedAmount) : 'The loan'} was paid
                          to your school
                          {a.disbursedAt &&
                            ` on ${new Date(a.disbursedAt).toLocaleDateString()}`}
                          .
                        </span>
                        {a.collectionInstructions && (
                          <span className="mt-1 block font-medium">
                            How to repay: {a.collectionInstructions}
                          </span>
                        )}
                      </Alert>
                    )}

                    {/*
                      The score, explained.

                      `BEHAVIOUR_SCORE.md` gives parents the right to understand it, so
                      every category and its weight is shown rather than a bare number.
                    */}
                    {a.score !== null && (
                      <div>
                        <p className="text-sm font-medium">
                          Your payment score at the time: <span data-numeric>{a.score}</span>{' '}
                          <span className="text-muted-foreground">
                            ({band(a.score)}, on a scale of 300 to 850)
                          </span>
                        </p>
                        {a.breakdown && (
                          <ul className="mt-1 grid gap-x-cards gap-y-0.5 text-sm text-muted-foreground sm:grid-cols-2">
                            {Object.entries(a.breakdown)
                              .filter(([, v]) => typeof v === 'object' && v && 'score' in v)
                              .map(([k, v]) => (
                                <li key={k}>
                                  {k.replace(/_/g, ' ')}:{' '}
                                  <span data-numeric>{v.score}</span>/100 (
                                  {Math.round(v.weight * 100)}%)
                                </li>
                              ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </li>
            )
          })}
        </ul>
      )}

      {/* ---------------- the three-screen consent flow ---------------- */}
      <Dialog
        open={applying}
        title={
          step === 1
            ? 'How a fee loan works'
            : step === 2
              ? 'Choose a lender and agree'
              : 'Check and send'
        }
        description={`Step ${step} of 3`}
        onClose={close}
        footer={
          <>
            {step > 1 && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setStep((s) => (s === 3 ? 2 : 1))}
              >
                Back
              </Button>
            )}

            {step === 1 && <Button onClick={() => setStep(2)}>Continue</Button>}

            {step === 2 && (
              <Button
                disabled={!lender || !agreed || num(amount) <= 0}
                onClick={() => setStep(3)}
              >
                Continue
              </Button>
            )}

            {step === 3 && (
              <Button disabled={busy || !agreed} onClick={() => void submit()}>
                {busy ? (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                ) : (
                  <CheckCircle2 aria-hidden="true" />
                )}
                Send my application
              </Button>
            )}
          </>
        }
      >
        {/* ---- Screen 1: what this is ---- */}
        {step === 1 && (
          <div className="flex flex-col gap-stack text-sm">
            <p className="flex items-start gap-2">
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>
                ZSMS does not lend money. We pass your application to a lending partner who
                decides, and who pays your school directly if they approve it.
              </span>
            </p>
            <ul className="ml-6 list-disc">
              <li>The lender pays your school, not you.</li>
              <li>You repay the lender on their terms — not ZSMS.</li>
              <li>A decision usually takes a few business days.</li>
              <li>Applying does not guarantee approval.</li>
            </ul>
            <p className="text-muted-foreground">
              On the next screen you choose which lender sees your information, and exactly
              what they will be shown.
            </p>
          </div>
        )}

        {/* ---- Screen 2: which lender, and consent naming them ---- */}
        {step === 2 && (
          <div className="flex flex-col gap-stack">
            {offer?.score !== null && offer?.score !== undefined && (
              <p className="text-sm text-muted-foreground">
                Your payment score is <span data-numeric>{offer.score}</span> ({band(offer.score)}
                ). Lenders who do not consider scores at this level are not listed.
              </p>
            )}

            <Field id="l-lender" label="Lender" required>
              {(props) => (
                <Select
                  {...props}
                  value={lenderId}
                  onChange={(e) => {
                    setLenderId(e.target.value)
                    // Choosing a different lender invalidates the consent, which named
                    // the previous one.
                    setAgreed(false)
                    setAgreedAt(null)
                  }}
                >
                  <option value="">Choose a lender</option>
                  {(offer?.lenders ?? []).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.displayName} — {l.interestRate}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            {lender && (
              <div className="rounded-md border border-border bg-sunken p-card text-sm">
                <p className="flex items-center gap-1.5 font-medium">
                  <Building2 aria-hidden="true" className="size-4" />
                  {lender.displayName}
                </p>
                {lender.description && (
                  <p className="mt-1 text-muted-foreground">{lender.description}</p>
                )}
                <p className="mt-1 text-muted-foreground">
                  {lender.interestRate} · {lender.turnaround} · lends{' '}
                  <span data-numeric>{kwacha(lender.minAmount)}</span> to{' '}
                  <span data-numeric>{kwacha(lender.maxAmount)}</span>
                </p>
                {lender.eligibility.length > 0 && (
                  <ul className="mt-1 ml-5 list-disc text-muted-foreground">
                    {lender.eligibility.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <Field id="l-amount" label="How much you need" required>
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  min={lender?.minAmount ?? 0}
                  max={lender?.maxAmount ?? undefined}
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              )}
            </Field>

            <Field id="l-employment" label="Your employment" required>
              {(props) => (
                <Select
                  {...props}
                  value={employment}
                  onChange={(e) => setEmployment(e.target.value)}
                >
                  <option value="employed">Employed</option>
                  <option value="self_employed">Self-employed</option>
                  <option value="informal">Informal work</option>
                  <option value="unemployed">Not working</option>
                </Select>
              )}
            </Field>

            <Field id="l-employer" label="Employer" hint="If you are employed.">
              {(props) => (
                <Input
                  {...props}
                  value={employer}
                  maxLength={160}
                  onChange={(e) => setEmployer(e.target.value)}
                />
              )}
            </Field>

            <Field
              id="l-income"
              label="Your monthly income"
              hint="Helps the lender judge what you can afford. It is shared only with the lender you chose."
            >
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  min={0}
                  step="0.01"
                  value={income}
                  onChange={(e) => setIncome(e.target.value)}
                />
              )}
            </Field>

            {/*
              The consent NAMES the lender.

              `CONSENT.md` requires it to be lender-specific: a blanket authorisation to
              "our partners" is not consent to the one who actually receives the file.
            */}
            {lender && (
              <div className="rounded-md border border-border p-card">
                <p className="text-sm font-medium">
                  What {lender.displayName} will be shown
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                  {CONSENT_TEXT}
                </p>

                <label className="mt-stack flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0"
                    checked={agreed}
                    onChange={(e) => {
                      setAgreed(e.target.checked)
                      // Stamped when ticked. The server refuses consent older than
                      // thirty minutes.
                      setAgreedAt(e.target.checked ? new Date().toISOString() : null)
                    }}
                  />
                  <span>
                    I agree to share this with <strong>{lender.displayName}</strong>.
                  </span>
                </label>
              </div>
            )}
          </div>
        )}

        {/* ---- Screen 3: summary ---- */}
        {step === 3 && lender && (
          <div className="flex flex-col gap-stack text-sm">
            <dl className="grid gap-x-cards gap-y-1 sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Lender</dt>
                <dd className="font-medium">{lender.displayName}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Amount</dt>
                <dd data-numeric className="font-medium">
                  {kwacha(num(amount))}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Employment</dt>
                <dd>{employment.replace(/_/g, ' ')}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Monthly income</dt>
                <dd data-numeric>{income ? kwacha(num(income)) : 'not given'}</dd>
              </div>
            </dl>

            <Alert variant="info" title="What happens next">
              We send this to {lender.displayName}. They usually decide within{' '}
              {lender.turnaround.toLowerCase()}. If they approve it, they pay your school and
              tell you how to repay them.
            </Alert>

            {formError && (
              <Alert variant="danger" title="Not sent">
                {formError}
              </Alert>
            )}
          </div>
        )}
      </Dialog>
    </>
  )
}
