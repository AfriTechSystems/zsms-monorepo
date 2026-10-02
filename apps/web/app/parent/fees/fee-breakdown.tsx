'use client'

/**
 * What the school is actually charging, line by line.
 *
 * Spec: `Official Documentation/09 Fee and Financial Management/FEE_STRUCTURES.md`
 *
 * ## The breakdown was fetched and thrown away
 *
 * `/api/parent/fees` has always returned `records` from `fee_record_status` — one row per
 * charge, each carrying `fee_label`, `amount_due`, `amount_paid` and `outstanding`. The page
 * rendered the running statement and nothing else, and the `Payload` interface did not even
 * declare the field.
 *
 * So a parent saw "you owe K2,500" and a ledger of dated entries, but never **what the
 * K2,500 is for**. That is the first question any parent asks, and the one a school office
 * spends its mornings answering on the phone.
 *
 * ## Grouped by term, because that is how a school charges and how a family pays
 *
 * A term is the unit: fees are set per term, invoiced per term, and paid per term. A flat
 * list sorted by due date interleaves two terms the moment one goes unpaid — which is
 * exactly when a parent is looking at it.
 *
 * ## Paid lines stay visible
 *
 * A term shows every line, settled or not, with the outstanding amount alongside. Hiding
 * what is paid would make the term total stop matching the fees listed under it, and
 * checking whether a payment landed is a frequent reason to open this page at all.
 */

import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import { ChevronRight, ReceiptText } from 'lucide-react'

import { Badge } from '../../../components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card'

export interface FeeRecordRow {
  id: string
  academic_year: string
  term_number: number
  fee_label: string
  amount_due: string | number
  amount_paid: string | number
  discount_amount: string | number | null
  outstanding: string | number
  status: string
  due_date: string | null
  is_overdue: boolean
}

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : 0
  return Number.isFinite(n) ? n : 0
}

const kwacha = (v: unknown): string =>
  `K${num(v).toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function FeeBreakdown({ records }: { records: FeeRecordRow[] }): JSX.Element | null {
  const terms = useMemo(() => {
    const byTerm = new Map<string, FeeRecordRow[]>()
    for (const r of records) {
      const key = `${r.academic_year}-${r.term_number}`
      const list = byTerm.get(key)
      if (list) list.push(r)
      else byTerm.set(key, [r])
    }

    return [...byTerm.entries()]
      .map(([key, lines]) => ({
        key,
        year: lines[0]?.academic_year ?? '',
        term: lines[0]?.term_number ?? 0,
        lines,
        due: lines.reduce((t, l) => t + num(l.amount_due) - num(l.discount_amount), 0),
        outstanding: lines.reduce((t, l) => t + num(l.outstanding), 0),
        overdue: lines.some((l) => l.is_overdue),
      }))
      // Newest first: the term a parent is being asked about is the current one.
      .sort((a, b) => b.year.localeCompare(a.year) || b.term - a.term)
  }, [records])

  // The most recent term starts open — it is the one being asked about. Computed from the
  // grouped list rather than `records[0]`, which is ordered by due date and need not be it.
  const [open, setOpen] = useState<Set<string> | null>(null)
  const expanded = open ?? new Set(terms.length > 0 ? [terms[0]!.key] : [])

  // Nothing billed yet. The balance card above already says the account is clear, and a
  // second panel repeating it is noise.
  if (terms.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ReceiptText aria-hidden="true" className="size-5 text-primary" />
          What you are charged
        </CardTitle>
        <CardDescription>
          Every fee the school has billed, by term. Open a term to see what makes up the total.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <ul className="flex flex-col gap-2">
          {terms.map((t) => {
            const isOpen = expanded.has(t.key)

            return (
              <li key={t.key} className="rounded-lg border border-border">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() =>
                    setOpen(() => {
                      const next = new Set(expanded)
                      if (next.has(t.key)) next.delete(t.key)
                      else next.add(t.key)
                      return next
                    })
                  }
                  className="flex min-h-tap w-full flex-wrap items-center gap-2 rounded-lg px-3 text-left transition-colors hover:bg-muted"
                >
                  <ChevronRight
                    aria-hidden="true"
                    className={
                      'size-4 shrink-0 text-muted-foreground transition-transform '
                      + (isOpen ? 'rotate-90' : '')
                    }
                  />
                  <span className="font-medium">
                    Term {t.term} {t.year}
                  </span>

                  <span className="ml-auto flex flex-wrap items-center gap-2">
                    {t.outstanding > 0 ? (
                      <Badge variant={t.overdue ? 'danger' : 'warning'}>
                        {kwacha(t.outstanding)} {t.overdue ? 'overdue' : 'to pay'}
                      </Badge>
                    ) : (
                      <Badge variant="success">Paid in full</Badge>
                    )}
                    <span data-numeric className="text-sm text-muted-foreground">
                      {kwacha(t.due)}
                    </span>
                  </span>
                </button>

                {isOpen && (
                  <ul className="flex flex-col gap-0.5 border-t border-border px-3 py-2">
                    {t.lines.map((line) => {
                      const discount = num(line.discount_amount)
                      const outstanding = num(line.outstanding)

                      return (
                        <li
                          key={line.id}
                          className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1 text-sm"
                        >
                          <span className="min-w-[8rem] flex-1">{line.fee_label}</span>

                          {discount > 0 && (
                            // Named rather than folded into the amount: a bursary or sibling
                            // discount the school granted should be visible to the family
                            // that received it, not silently reduce a number.
                            <span className="text-success">less {kwacha(discount)}</span>
                          )}

                          <span data-numeric className="w-24 text-right">
                            {kwacha(num(line.amount_due) - discount)}
                          </span>

                          <span
                            data-numeric
                            className={
                              'w-24 text-right '
                              + (outstanding > 0
                                ? line.is_overdue
                                  ? 'text-danger'
                                  : 'text-muted-foreground'
                                : 'text-success')
                            }
                          >
                            {outstanding > 0 ? `${kwacha(outstanding)} left` : 'Paid'}
                          </span>
                        </li>
                      )
                    })}

                    <li className="mt-1 flex flex-wrap items-baseline gap-x-2 border-t border-border pt-1.5 text-sm font-semibold">
                      <span className="min-w-[8rem] flex-1">Term total</span>
                      <span data-numeric className="w-24 text-right">
                        {kwacha(t.due)}
                      </span>
                      <span data-numeric className="w-24 text-right">
                        {t.outstanding > 0 ? `${kwacha(t.outstanding)} left` : 'Paid'}
                      </span>
                    </li>
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
