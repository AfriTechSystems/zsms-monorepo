'use client'

/**
 * Correcting an amount on bills already issued.
 *
 * Spec: `Official Documentation/09 Fee and Financial Management/FEE_STRUCTURES.md`
 *         → *Business Rules* 3
 *
 * ## Why this exists beside the structure editor rather than inside it
 *
 * Business rule 3 says a structure change never re-prices records already generated, and
 * that is the right default — a bursar setting next year's tuition must not silently re-bill
 * this term's families. It leaves a real gap: a school that issued a whole term at the wrong
 * amount had no way to fix it, because the edit above deliberately does nothing to existing
 * bills.
 *
 * So the two sit on one screen and say plainly which is which. The editor changes what
 * FUTURE issuing will charge. This changes what families owe right now.
 *
 * ## It refuses rather than partly applying
 *
 * `revise_fee_records()` raises when any record already carries verified payments above the
 * new amount, naming the count — it does not quietly skip them. A partial revision would
 * leave a term priced two ways with nothing on screen saying so, and reducing a bill below
 * what a family has paid would manufacture a credit the school never agreed. The refusal
 * tells the bursar to issue a refund or reversal, which is the correct instrument.
 */

import type { JSX } from 'react'
import { useCallback, useState } from 'react'
import { LoaderCircle, PencilLine } from 'lucide-react'

import { Alert } from '../../../../../components/ui/alert'
import { Input, Select } from '../../../../../components/ui/field'
import { Button } from '../../../../../components/ui/button'
import { apiSend } from '../../../../../lib/use-api'
import { useToast } from '../../../../../components/ui/toast'

export function ReviseIssued({
  /** Labels already in use this year, so the bursar picks rather than retypes one. */
  labels,
  year,
}: {
  labels: string[]
  year: string
}): JSX.Element | null {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [term, setTerm] = useState('1')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)

  const revise = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      setRefusal(null)
      setBusy(true)
      try {
        const result = await apiSend<{ revised: number; skipped: number }>(
          '/api/school/fees/revise',
          'POST',
          {
            academicYear: year,
            termNumber: Number(term),
            feeLabel: label,
            newAmount: Number(amount),
            reason,
          },
        )

        if (result.error) {
          // A refusal is kept on screen rather than shown as a toast: it names how many
          // records already have payments, and the bursar needs it while deciding what
          // to do instead.
          if (result.code === 'CONFLICT') setRefusal(result.error)
          else toast(result.error, 'danger')
          return
        }

        const revised = result.data?.revised ?? 0
        const skipped = result.data?.skipped ?? 0
        toast(
          skipped > 0
            ? `${revised} bills updated, ${skipped} left alone.`
            : `${revised} bills updated.`,
          'success',
        )
        setOpen(false)
        setAmount('')
        setReason('')
      } finally {
        setBusy(false)
      }
    },
    [year, term, label, amount, reason, toast],
  )

  if (labels.length === 0) return null

  return (
    <div className="border-t border-border pt-cards">
      {!open ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <PencilLine aria-hidden="true" />
            Correct an amount already billed
          </Button>
          <p className="text-sm text-muted-foreground">
            Changing a line above only affects future issuing.
          </p>
        </div>
      ) : (
        <form onSubmit={revise} className="flex flex-col gap-3">
          <div>
            <h3 className="text-sm font-semibold">Correct an amount already billed</h3>
            <p className="text-sm text-muted-foreground">
              Changes what families owe <em>now</em>, for one fee in one term. Bills that are
              already paid above the new amount are refused rather than reduced.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="flex min-w-[11rem] flex-1 flex-col gap-1.5">
              <label htmlFor="rev-label" className="text-sm font-medium">
                Which fee
              </label>
              <Select
                id="rev-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                required
                
              >
                <option value="">Choose a fee</option>
                {labels.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex w-28 flex-col gap-1.5">
              <label htmlFor="rev-term" className="text-sm font-medium">
                Term
              </label>
              <Select
                id="rev-term"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                
              >
                {[1, 2, 3].map((t) => (
                  <option key={t} value={String(t)}>
                    Term {t}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex w-36 flex-col gap-1.5">
              <label htmlFor="rev-amount" className="text-sm font-medium">
                Correct amount (K)
              </label>
              <Input
                id="rev-amount"
                type="number"
                min={0}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="rev-reason" className="text-sm font-medium">
              Why is it changing?
            </label>
            <Input
              id="rev-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Tuition was issued at K2,500 — the board approved K2,650"
              required
              minLength={4}
              
            />
            <p className="text-xs text-muted-foreground">
              Recorded against every bill this changes. Families have already been told the
              old figure.
            </p>
          </div>

          {refusal && (
            <Alert variant="warning" title="Nothing was changed">
              {refusal}
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={busy || !label || reason.trim().length < 4}>
              {busy && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
              Correct these bills
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
