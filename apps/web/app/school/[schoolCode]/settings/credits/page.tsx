'use client'

/**
 * AI credits — buy them, give them to teachers, see who used them.
 *
 * Spec: `Official Documentation/17 Integration and Pricing/PRICING.md`
 *       `Official Documentation/18 AI Module/AI_OVERVIEW.md`
 *
 * ## Three things on one screen, in the order they happen
 *
 * Buy, assign, review. They are one screen because they are one job — a bursar who has just
 * bought sixty seats needs to hand them out in the same sitting, and a separate "assignment"
 * page would be a place people forget to visit, leaving paid-for credits sitting unassigned.
 *
 * ## The quote is asked of the server, not computed here
 *
 * `seats × price` is two lines of TypeScript and it would be wrong. The period a termly plan
 * covers depends on the school's own term dates, which only the database knows, and a price
 * computed in the browser is a price that can disagree with the one charged. So every change
 * asks `school_credit_quote()` and shows what came back.
 *
 * ## Why "assign to all" is a button and not a checkbox-by-default
 *
 * Assigning is spending: every seat handed out is a seat that cannot go to somebody else.
 * The screen shows how many seats remain unassigned at all times, and the action says how
 * many it is about to use, because the alternative — a list that quietly consumes the
 * remainder — is how a school discovers in week three that it has nothing left.
 */

import type { JSX } from 'react'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Coins,
  Loader2,
  Users,
} from 'lucide-react'

import { Button } from '../../../../../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../../../components/ui/card'
import { Badge } from '../../../../../components/ui/badge'
import { ErrorState, PageHeader, StatSkeleton } from '../../../../../components/ui/data-states'
import { useApi } from '../../../../../lib/use-api'
import { UsagePanel } from './usage-panel'
import { useToast } from '../../../../../components/ui/toast'

interface Plan {
  out_plan_code: string
  out_display_name: string
  out_period_kind: string
  out_credits_per_seat: number
  out_price_per_seat: number
  out_currency_code: string
}

interface Purchase {
  id: string
  plan_code: string
  period_kind: string
  seats: number
  credits_per_seat: number
  total_credits: number
  total_amount: number
  currency_code: string
  period_start: string
  period_end: string
}

interface Assignment {
  id: string
  purchase_id: string
  clerk_user_id: string
  credits_allocated: number
  period_end: string
}

interface Quote {
  out_total_credits: number
  out_total_amount: number
  out_currency_code: string
  out_period_start: string
  out_period_end: string
  out_credits_per_seat: number
}

interface CreditsPayload {
  plans: Plan[]
  purchases: Purchase[]
  assignments: Assignment[]
  settings: { reserve_enabled: boolean; reserve_per_teacher_cap: number | null }
  canBuy: boolean
}

interface StaffMember {
  clerk_user_id: string | null
  first_name: string
  last_name: string
  role: string | null
}

const money = (amount: number, currency: string): string =>
  `${currency === 'ZMW' ? 'K' : currency + ' '}${Number(amount).toLocaleString('en-ZM', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

function CreditsScreen(): JSX.Element {
  const { data, loading, error, code, reload } = useApi<CreditsPayload>('/api/school/credits')
  const staff = useApi<{ staff: StaffMember[] }>('/api/school/staff')
  const { toast } = useToast()

  const [planCode, setPlanCode] = useState<string>('')
  const [seats, setSeats] = useState(10)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  /*
    Memoised rather than `data?.plans ?? []` inline. A fresh [] on every render makes every
    dependency array below it change every render — so the quote would be re-fetched on each
    paint and the derived maps rebuilt constantly. Caught by react-hooks/exhaustive-deps.
  */
  const plans = useMemo(() => data?.plans ?? [], [data])
  const purchases = useMemo(() => data?.purchases ?? [], [data])
  const assignments = useMemo(() => data?.assignments ?? [], [data])
  const staffList = useMemo(() => staff.data?.staff ?? [], [staff.data])

  useEffect(() => {
    if (!planCode && plans.length > 0) setPlanCode(plans[0]?.out_plan_code ?? '')
  }, [plans, planCode])

  // Ask the server for the price on every change — see the header.
  useEffect(() => {
    if (!planCode || seats < 1) {
      setQuote(null)
      return
    }
    let cancelled = false
    void (async () => {
      const response = await fetch('/api/school/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'quote', planCode, seats }),
      })
      const body = await response.json()
      if (!cancelled) setQuote(response.ok ? (body?.data?.quote ?? null) : null)
    })()
    return () => {
      cancelled = true
    }
  }, [planCode, seats])

  /** Seats still unassigned, per purchase. The number that governs every decision here. */
  const unassigned = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of purchases) {
      const given = assignments
        .filter((a) => a.purchase_id === p.id)
        .reduce((total, a) => total + a.credits_allocated, 0)
      map.set(p.id, Math.max(0, p.total_credits - given))
    }
    return map
  }, [purchases, assignments])

  /** The purchase still in force, if any. Credits expire at period end. */
  const live = useMemo(
    () => purchases.find((p) => new Date(p.period_end) >= new Date()),
    [purchases],
  )

  const assignedIds = useMemo(
    () => new Set(assignments.map((a) => a.clerk_user_id)),
    [assignments],
  )

  /** Staff who could be given a seat: have a Clerk account, and do not already hold one. */
  const assignable = useMemo(
    () =>
      staffList.filter((member) => member.clerk_user_id && !assignedIds.has(member.clerk_user_id)),
    [staffList, assignedIds],
  )

  const post = useCallback(
    async (body: Record<string, unknown>, success: string) => {
      setBusy(true)
      try {
        const response = await fetch('/api/school/credits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const payload = await response.json()
        if (!response.ok) {
          toast(payload?.error ?? 'That could not be saved.', 'danger')
          return false
        }
        toast(success, 'success')
        setSelected(new Set())
        reload()
        return true
      } finally {
        setBusy(false)
      }
    },
    [reload, toast],
  )

  if (error) return <ErrorState message={error} code={code} onRetry={reload} />
  if (loading || !data) return <StatSkeleton count={3} />

  const seatsLeft = live ? Math.floor((unassigned.get(live.id) ?? 0) / live.credits_per_seat) : 0

  return (
    <>
      <PageHeader
        title="AI credits"
        description="Buy credits for your teachers and choose who gets them. Each teacher's credits are their own — one teacher cannot spend another's."
      />

      {/* ---- What is in force right now ---- */}
      {live ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Coins aria-hidden="true" className="size-5 text-primary" />
              Current credits
            </CardTitle>
            <CardDescription>
              {live.seats} seat{live.seats === 1 ? '' : 's'} of {live.credits_per_seat} credits,
              until {new Date(live.period_end).toLocaleDateString('en-ZM')}. Unused credits
              expire on that date.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Credits bought" value={live.total_credits} />
            <Stat label="Given to teachers" value={live.total_credits - (unassigned.get(live.id) ?? 0)} />
            <Stat label="Not yet given out" value={unassigned.get(live.id) ?? 0} />
            <Stat label="Teachers covered" value={assignments.filter((a) => a.purchase_id === live.id).length} />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex items-start gap-3 pt-card">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-warning" />
            <div>
              <p className="font-medium">No credits in force</p>
              <p className="text-sm text-muted-foreground">
                Your teachers can still use the Teacher Hub on their own personal credits.
                Buying here gives each of them a separate allowance your school pays for.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---- Buy ---- */}
      {data.canBuy && (
        <Card>
          <CardHeader>
            <CardTitle>Buy credits</CardTitle>
            <CardDescription>
              A term runs to the end of your own term dates, not a fixed ninety days.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-3">
              <div className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
                <label htmlFor="plan" className="text-sm font-medium">
                  Plan
                </label>
                <select
                  id="plan"
                  value={planCode}
                  onChange={(e) => setPlanCode(e.target.value)}
                  className="min-h-tap rounded-md border border-border bg-background px-3"
                >
                  {plans.map((p) => (
                    <option key={p.out_plan_code} value={p.out_plan_code}>
                      {p.out_display_name} — {p.out_credits_per_seat} credits per teacher
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex w-32 flex-col gap-1.5">
                <label htmlFor="seats" className="text-sm font-medium">
                  Teachers
                </label>
                <input
                  id="seats"
                  type="number"
                  min={1}
                  max={2000}
                  value={seats}
                  onChange={(e) => setSeats(Math.max(1, Number(e.target.value) || 1))}
                  className="min-h-tap rounded-md border border-border bg-background px-3"
                />
              </div>
            </div>

            {quote && (
              <div className="rounded-md border border-border bg-muted/40 p-card">
                <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <Stat label="Credits" value={quote.out_total_credits} />
                  <Stat label="Each teacher gets" value={quote.out_credits_per_seat} />
                  <div>
                    <dt className="text-muted-foreground">Covers until</dt>
                    <dd className="font-semibold">
                      {new Date(quote.out_period_end).toLocaleDateString('en-ZM')}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Total</dt>
                    <dd data-numeric className="text-lg font-semibold">
                      {money(quote.out_total_amount, quote.out_currency_code)}
                    </dd>
                  </div>
                </dl>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={busy || !quote}
                onClick={() =>
                  post({ action: 'buy', planCode, seats }, 'Credits bought. An invoice has been raised.')
                }
              >
                {busy && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
                Buy {quote ? money(quote.out_total_amount, quote.out_currency_code) : ''}
              </Button>
              <p className="text-sm text-muted-foreground">
                {/* Stated plainly: the credits work immediately, the bill follows. */}
                Credits are usable straight away. AfriTech will send the invoice.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---- Assign ---- */}
      {live && data.canBuy && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users aria-hidden="true" className="size-5 text-primary" />
              Give credits to teachers
            </CardTitle>
            <CardDescription>
              {seatsLeft > 0
                ? `${seatsLeft} teacher${seatsLeft === 1 ? '' : 's'} can still be covered from this purchase.`
                : 'Every credit from this purchase has been given out. Buy more seats to cover another teacher.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {assignable.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Every member of staff with an account already has credits.
              </p>
            ) : (
              <>
                <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
                  {assignable.map((member) => {
                    const id = member.clerk_user_id as string
                    const checked = selected.has(id)
                    return (
                      <li key={id}>
                        <label className="flex min-h-tap cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-muted">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              setSelected((current) => {
                                const next = new Set(current)
                                if (e.target.checked) next.add(id)
                                else next.delete(id)
                                return next
                              })
                            }
                            className="size-4"
                          />
                          <span className="flex-1 text-sm">
                            {member.first_name} {member.last_name}
                          </span>
                          <span className="text-xs text-muted-foreground">{member.role ?? ''}</span>
                        </label>
                      </li>
                    )
                  })}
                </ul>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    disabled={busy || selected.size === 0 || selected.size > seatsLeft}
                    onClick={() =>
                      post(
                        { action: 'assign', purchaseId: live.id, userIds: [...selected] },
                        `Credits given to ${selected.size} teacher${selected.size === 1 ? '' : 's'}.`,
                      )
                    }
                  >
                    <Check aria-hidden="true" />
                    Give credits to {selected.size || 'selected'}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy || assignable.length === 0 || assignable.length > seatsLeft}
                    onClick={() =>
                      post(
                        {
                          action: 'assign',
                          purchaseId: live.id,
                          userIds: assignable.map((m) => m.clerk_user_id as string),
                        },
                        'Credits given to every teacher without them.',
                      )
                    }
                  >
                    Give to all {assignable.length}
                  </Button>

                  {/* The refusal is stated before it happens, rather than as a server error. */}
                  {selected.size > seatsLeft && (
                    <p className="text-sm text-danger">
                      That is {selected.size} teachers but only {seatsLeft} seats are left.
                    </p>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---- How it has been used ---- */}
      <UsagePanel />

      {/* ---- Who holds credits now ---- */}
      {assignments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Teachers with credits</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1">
              {assignments.map((a) => {
                const member = staffList.find(
                  (m) => m.clerk_user_id === a.clerk_user_id,
                )
                return (
                  <li
                    key={a.id}
                    className="flex min-h-tap flex-wrap items-center gap-2 rounded-md px-2 hover:bg-muted/50"
                  >
                    <span className="flex-1 text-sm">
                      {member ? `${member.first_name} ${member.last_name}` : a.clerk_user_id}
                    </span>
                    <Badge variant="neutral">
                      <span data-numeric>{a.credits_allocated}</span> credits
                    </Badge>
                    {data.canBuy && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          post(
                            { action: 'revoke', assignmentId: a.id },
                            'Unspent credits returned to the pool.',
                          )
                        }
                      >
                        Take back
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              Taking credits back returns only what the teacher has not spent. What they have
              already used stays recorded against them.
            </p>
          </CardContent>
        </Card>
      )}
    </>
  )
}

function Stat({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd data-numeric className="text-lg font-semibold">
        {value.toLocaleString('en-ZM')}
      </dd>
    </div>
  )
}

export default function CreditsPage(): JSX.Element {
  return (
    <Suspense fallback={<StatSkeleton count={3} />}>
      <CreditsScreen />
    </Suspense>
  )
}
