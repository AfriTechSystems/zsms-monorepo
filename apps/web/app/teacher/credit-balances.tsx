'use client'

/**
 * School credits and personal credits, side by side.
 *
 * Spec: `Official Documentation/18 AI Module/AI_OVERVIEW.md`
 *       `Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md`
 *
 * ## Why two balances rather than one number
 *
 * They are funded by different people, bought on different dates, and — crucially — expire
 * on different terms. School credits lapse at the end of the period the school paid for;
 * personal ones do not. Adding them into one "credits remaining" figure would hide the only
 * fact a teacher needs in order to plan: that some of what they are holding is perishable.
 *
 * ## It renders nothing when there is nothing to say
 *
 * A standalone teacher with no school has one balance, and the plan badge in the header
 * already states it. This card appears when a school has actually given the teacher credits
 * — which is the moment the distinction starts to matter.
 *
 * ## Reserve credits are shown as the school's, not as a third figure
 *
 * When a teacher has exhausted their assignment and the school has the reserve switched on,
 * what they can still spend comes from the unassigned remainder. To the teacher that is
 * simply "my school's credits"; the distinction between assigned and reserve is the
 * school's bookkeeping, and surfacing it here would be explaining our data model to
 * somebody trying to write a lesson plan.
 */

import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { Building2, CalendarClock, Wallet } from 'lucide-react'

import { Card, CardContent } from '../../components/ui/card'

interface Balances {
  school: {
    schoolName: string | null
    allocated: number
    spent: number
    available: number
    expiresOn: string | null
    reserveAvailable: number
  } | null
  personal: { available: number }
}

export function CreditBalances(): JSX.Element | null {
  const [balances, setBalances] = useState<Balances | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch('/api/teacher/credits')
        if (!response.ok) return
        const payload = await response.json()
        if (!cancelled) setBalances(payload?.data ?? null)
      } catch {
        // Swallowed deliberately: a balance that will not load must not break the dashboard.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const school = balances?.school
  const schoolTotal = (school?.available ?? 0) + (school?.reserveAvailable ?? 0)

  // Nothing from a school means nothing to distinguish — see the header.
  if (!school || (schoolTotal === 0 && school.spent === 0)) return null

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card>
        <CardContent className="flex items-start gap-3 pt-card">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Building2 aria-hidden="true" className="size-5 text-primary" />
          </span>
          <div className="min-w-0">
            <p className="text-sm text-muted-text">
              {school.schoolName ?? 'Your school'}
            </p>
            <p data-numeric className="text-2xl font-semibold">
              {schoolTotal}
            </p>
            <p className="text-xs text-muted-text">
              credits
              {school.spent > 0 && (
                <>
                  {' · '}
                  <span data-numeric>{school.spent}</span> used
                </>
              )}
            </p>
            {school.expiresOn && (
              <p className="mt-1 flex items-center gap-1 text-xs text-warning">
                <CalendarClock aria-hidden="true" className="size-3" />
                Expire {new Date(school.expiresOn).toLocaleDateString('en-ZM')}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-start gap-3 pt-card">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Wallet aria-hidden="true" className="size-5 text-muted-text" />
          </span>
          <div className="min-w-0">
            <p className="text-sm text-muted-text">Your own credits</p>
            <p data-numeric className="text-2xl font-semibold">
              {balances?.personal.available ?? 0}
            </p>
            <p className="text-xs text-muted-text">credits · no expiry</p>
            <p className="mt-1 text-xs text-muted-text">
              {/* The rule, stated where the two numbers are visible together. */}
              Your school&rsquo;s are used first because they expire.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
