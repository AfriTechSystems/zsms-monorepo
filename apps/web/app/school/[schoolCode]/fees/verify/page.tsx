'use client'

/**
 * The verification queue — payments recorded but not yet confirmed.
 *
 * Spec: `Official Documentation/09 Fee and Financial Management/PAYMENTS.md`
 *
 * ## This screen is the control, so it says what it is
 *
 * A recorded payment does not move a balance; a verified one does. Everything
 * here is money somebody has *claimed* to have received, waiting for whoever
 * checks the bank. That is the school's separation of duties, and it only works
 * if the person clearing the queue understands they are the check rather than a
 * formality — hence the page note, and hence "Confirm received" rather than
 * "Approve".
 *
 * ## Rejecting requires a reason, in the UI and in the API
 *
 * A rejected payment leaves a parent who believes they have paid and a clerk who
 * recorded it in good faith. Without a reason, nobody can act: not the clerk who
 * mis-keyed an amount, not the parent whose deposit slip belongs to another
 * pupil. The API refuses a reasonless rejection; this screen refuses to send one
 * so the person finds out before the round trip rather than after.
 *
 * ## The queue drains under you, and that is normal
 *
 * Two people can open this at once. When the second confirms a row the first
 * still sees, `verify_payment` raises P0002 and the API returns a sentence
 * saying someone got there first, which is a stale screen rather than a fault —
 * so it reloads instead of presenting an error.
 */

import type { ChangeEvent, JSX } from 'react'
import { use, useCallback, useState } from 'react'
import Link from 'next/link'
import { Check, Loader2, X } from 'lucide-react'

import { apiSend, useApi } from '../../../../../lib/use-api'
import { Alert } from '../../../../../components/ui/alert'
import { Badge } from '../../../../../components/ui/badge'
import { Button } from '../../../../../components/ui/button'
import { Card, CardContent } from '../../../../../components/ui/card'
import { EmptyState } from '../../../../../components/ui/empty-state'
import { ErrorState, PageHeader, TableSkeleton } from '../../../../../components/ui/data-states'
import { Field, Textarea } from '../../../../../components/ui/field'
import { useToast } from '../../../../../components/ui/toast'
import { formatDate, formatKwacha } from '../../school-shared'

interface Pending {
  id: string
  student_id: string
  amount: string | number
  payment_method: string
  receipt_number: string | null
  notes: string | null
  created_at: string
  students: { student_id: string; first_name: string; last_name: string } | null
}

interface Payload {
  pending: Pending[]
  canVerify: boolean
}

const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash',
  bank_deposit: 'Bank deposit',
  cheque: 'Cheque',
  online_gateway: 'Online / mobile money',
  loan_disbursement: 'Loan disbursement',
  waiver: 'Waiver',
}

export default function VerifyPage({
  params,
}: {
  params: Promise<{ schoolCode: string }>
}): JSX.Element {
  const { schoolCode } = use(params)
  const base = `/school/${schoolCode}`
  const { toast } = useToast()

  const { data, loading, error, code, reload } = useApi<Payload>('/api/school/fees/verify')

  const [busy, setBusy] = useState<string | null>(null)
  // Which row is being rejected, and why. Held per-row so opening a second
  // rejection does not inherit the first one's reason.
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [rowError, setRowError] = useState<string | null>(null)

  const decide = useCallback(
    async (paymentId: string, decision: 'verified' | 'rejected', why?: string) => {
      setBusy(paymentId)
      setRowError(null)

      const result = await apiSend(`/api/school/fees/verify`, 'POST', {
        paymentId,
        decision,
        reason: why,
      })

      setBusy(null)

      if (result.error) {
        // Somebody else cleared it first. That is a stale screen, not a fault —
        // say so and refresh rather than presenting it as an error to resolve.
        if (result.code === 'NOT_FOUND') {
          toast(result.error, 'danger')
          reload()
          return
        }
        setRowError(result.error)
        return
      }

      setRejecting(null)
      setReason('')
      toast(
        decision === 'verified'
          ? 'Payment confirmed. The balance has moved.'
          : 'Payment rejected. It does not count against the balance.',
        decision === 'verified' ? 'success' : 'danger',
      )
      reload()
    },
    [reload, toast],
  )

  return (
    <>
      <PageHeader
        backTo={`${base}/fees`}
        backLabel="All balances"
        title="Awaiting verification"
        description="Payments recorded by someone, not yet confirmed against the bank."
        note="Nothing here has moved a balance yet. A recorded payment is a claim; confirming it is what turns it into money the school has received. Check the deposit slip or the bank before confirming — this step is the control, not a formality."
      />

      {error && <ErrorState message={error} code={code} onRetry={reload} />}
      {loading && !data && !error && <TableSkeleton rows={4} columns={3} />}

      {!error && data && (
        <div className="space-y-cards">
          {!data.canVerify && (
            <Alert variant="info" title="Verification is the accountant's to do">
              You can see the queue. The school owner and the accountant confirm payments.
            </Alert>
          )}

          {rowError && (
            <Alert variant="danger" title="Not recorded">
              {rowError}
            </Alert>
          )}

          {data.pending.length === 0 ? (
            <Card>
              <CardContent className="p-0">
                <EmptyState
                  illustration="fees"
                  title="Nothing waiting"
                  description="Every recorded payment has been confirmed or rejected."
                />
              </CardContent>
            </Card>
          ) : (
            <ul className="space-y-cards">
              {data.pending.map((p) => {
                const pupil = p.students
                const isRejecting = rejecting === p.id
                return (
                  <li key={p.id}>
                    <Card>
                      <CardContent className="space-y-stack">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium text-foreground">
                              {pupil ? `${pupil.first_name} ${pupil.last_name}` : 'Pupil'}
                            </p>
                            <p className="font-mono text-xs text-subtle">
                              {pupil?.student_id ?? p.student_id}
                            </p>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {METHOD_LABEL[p.payment_method] ?? p.payment_method} · recorded{' '}
                              {formatDate(p.created_at)}
                              {p.receipt_number ? ` · ${p.receipt_number}` : ''}
                            </p>
                            {p.notes && (
                              <p className="mt-1 text-sm text-muted-foreground">{p.notes}</p>
                            )}
                          </div>
                          <div className="text-right">
                            <p data-numeric className="text-xl font-semibold">
                              {formatKwacha(p.amount)}
                            </p>
                            <Badge variant="warning">Unconfirmed</Badge>
                          </div>
                        </div>

                        {isRejecting && (
                          <Field
                            id={`reason-${p.id}`}
                            label="Why is it being rejected?"
                            required
                            hint="The person who recorded it sees this, so make it actionable — “no deposit slip”, “amount does not match the bank”."
                          >
                            {(props) => (
                              <Textarea
                                {...props}
                                rows={2}
                                maxLength={300}
                                value={reason}
                                onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                                  setReason(e.target.value)
                                }
                              />
                            )}
                          </Field>
                        )}

                        {data.canVerify && (
                          <div className="flex flex-wrap gap-2">
                            {isRejecting ? (
                              <>
                                <Button
                                  variant="destructive"
                                  // A reasonless rejection is refused by the API;
                                  // refusing it here means finding out before the
                                  // round trip rather than after.
                                  disabled={busy === p.id || reason.trim().length === 0}
                                  onClick={() => decide(p.id, 'rejected', reason.trim())}
                                >
                                  {busy === p.id ? (
                                    <Loader2 aria-hidden="true" className="animate-spin" />
                                  ) : (
                                    <X aria-hidden="true" />
                                  )}
                                  Reject this payment
                                </Button>
                                <Button
                                  variant="ghost"
                                  onClick={() => {
                                    setRejecting(null)
                                    setReason('')
                                  }}
                                >
                                  Cancel
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button
                                  disabled={busy === p.id}
                                  onClick={() => decide(p.id, 'verified')}
                                >
                                  {busy === p.id ? (
                                    <Loader2 aria-hidden="true" className="animate-spin" />
                                  ) : (
                                    <Check aria-hidden="true" />
                                  )}
                                  Confirm received
                                </Button>
                                <Button
                                  variant="outline"
                                  onClick={() => {
                                    setRejecting(p.id)
                                    setReason('')
                                  }}
                                >
                                  Reject
                                </Button>
                                <Button variant="ghost" asChild>
                                  <Link href={`${base}/fees/${p.student_id}`}>See statement</Link>
                                </Button>
                              </>
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
        </div>
      )}
    </>
  )
}
