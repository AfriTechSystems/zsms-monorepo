'use client'

/**
 * Teacher Hub plan prices and allowances.
 *
 * Spec: `Official Documentation/17 Integration and Pricing/PRICING.md`
 *       `Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md`
 *
 * ## Why this did not exist
 *
 * `afritech.teacher_hub_plans` has granted UPDATE to AfriTech since `0130`, so the database
 * always allowed a price change. But `config.toml` sets `schemas = ["public"]`, so PostgREST
 * never saw the table — the grant was real and unusable, and changing the Hub's price meant
 * editing the database by hand. `0178` adds the `public` wrappers.
 *
 * ## The subscriber count is the point of the screen
 *
 * Raising the price of a plan nobody holds and raising one held by four hundred teachers are
 * different acts, and the only thing distinguishing them is a number that was not on screen.
 * It sits next to the price field rather than in a column, because it is context for the
 * decision rather than data about the plan.
 *
 * ## What cannot be edited here, and why that is not an omission
 *
 * `plan_code` identifies the row — `standalone_teacher_accounts.plan_code` references it, so
 * renaming one in place orphans every account on it. `billing_period` and
 * `ai_credits_period` are absent for a sharper reason: `ai_credit_balance()` reads them to
 * decide the window an allowance is summed over, so changing one on a live plan silently
 * re-prices every teacher holding it. A teacher on a monthly allowance switched to `lifetime`
 * would find their credits never reset again. That is a migration with a decision behind it,
 * not a field on a form.
 */

import type { JSX } from 'react'
import { useState } from 'react'
import { LoaderCircle, Tag } from 'lucide-react'

import { Badge } from '../../../components/ui/badge'
import { Input } from '../../../components/ui/field'
import { Button } from '../../../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card'
import { useToast } from '../../../components/ui/toast'

export interface HubPlan {
  out_plan_code: string
  out_display_name: string
  out_billing_period: string
  out_price: number
  out_currency_code: string
  out_included_resources: number
  out_ai_credits_included: number
  out_ai_credits_period: string
  out_is_active: boolean
  out_sort_order: number
  out_subscribers: number
}

export function PlanEditor({
  plans,
  onChanged,
}: {
  plans: HubPlan[]
  onChanged: () => void
}): JSX.Element | null {
  const { toast } = useToast()
  const [edits, setEdits] = useState<Record<string, { price?: string; credits?: string }>>({})
  const [busy, setBusy] = useState<string | null>(null)

  if (plans.length === 0) return null

  const save = async (plan: HubPlan): Promise<void> => {
    const edit = edits[plan.out_plan_code] ?? {}
    const price = edit.price === undefined ? undefined : Number(edit.price)
    const credits = edit.credits === undefined ? undefined : Number(edit.credits)

    if (price !== undefined && (!Number.isFinite(price) || price < 0)) return
    if (credits !== undefined && (!Number.isInteger(credits) || credits < 0)) return

    setBusy(plan.out_plan_code)
    try {
      const response = await fetch('/api/admin/teacher-hub', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planCode: plan.out_plan_code,
          // Only what was touched. Sending the unchanged values back would make every
          // save a write of the whole row, which is how a stale tab reverts a field
          // somebody else just changed.
          ...(price !== undefined ? { price } : {}),
          ...(credits !== undefined ? { aiCreditsIncluded: credits } : {}),
        }),
      })
      const body = await response.json()
      if (!response.ok) {
        toast(body?.error ?? 'That could not be saved.', 'danger')
        return
      }
      toast(
        body?.data?.subscribers > 0
          ? `Saved. ${body.data.subscribers} teacher${body.data.subscribers === 1 ? '' : 's'} on this plan.`
          : 'Saved.',
        'success',
      )
      setEdits((current) => ({ ...current, [plan.out_plan_code]: {} }))
      onChanged()
    } finally {
      setBusy(null)
    }
  }

  const toggleActive = async (plan: HubPlan): Promise<void> => {
    setBusy(plan.out_plan_code)
    try {
      const response = await fetch('/api/admin/teacher-hub', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planCode: plan.out_plan_code, isActive: !plan.out_is_active }),
      })
      if (!response.ok) {
        const body = await response.json()
        toast(body?.error ?? 'That could not be changed.', 'danger')
        return
      }
      toast(plan.out_is_active ? 'Plan withdrawn from sale.' : 'Plan is on sale again.', 'success')
      onChanged()
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Tag aria-hidden="true" className="size-5 text-primary" />
          Hub plans
        </CardTitle>
        <CardDescription>
          Price and monthly credit allowance. Changes apply to future billing — a teacher
          already subscribed keeps what they paid for until their period ends.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <ul className="flex flex-col gap-3">
          {plans.map((plan) => {
            const edit = edits[plan.out_plan_code] ?? {}
            const dirty = edit.price !== undefined || edit.credits !== undefined

            return (
              <li
                key={plan.out_plan_code}
                className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-surface p-3"
              >
                <div className="min-w-[9rem] flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {plan.out_display_name}
                    {!plan.out_is_active && <Badge variant="neutral">Withdrawn</Badge>}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {/* The number that makes this a decision rather than a typo. */}
                    <span data-numeric>{plan.out_subscribers}</span>{' '}
                    {plan.out_subscribers === 1 ? 'teacher' : 'teachers'} · billed{' '}
                    {plan.out_billing_period}
                  </p>
                </div>

                <div className="flex w-28 flex-col gap-1">
                  <label
                    htmlFor={`price-${plan.out_plan_code}`}
                    className="text-xs text-muted-foreground"
                  >
                    Price ({plan.out_currency_code})
                  </label>
                  <Input
                    id={`price-${plan.out_plan_code}`}
                    type="number"
                    min={0}
                    step="0.01"
                    value={edit.price ?? String(plan.out_price)}
                    onChange={(e) =>
                      setEdits((c) => ({
                        ...c,
                        [plan.out_plan_code]: { ...c[plan.out_plan_code], price: e.target.value },
                      }))
                    }
                    
                  />
                </div>

                <div className="flex w-28 flex-col gap-1">
                  <label
                    htmlFor={`credits-${plan.out_plan_code}`}
                    className="text-xs text-muted-foreground"
                  >
                    Credits / {plan.out_ai_credits_period}
                  </label>
                  <Input
                    id={`credits-${plan.out_plan_code}`}
                    type="number"
                    min={0}
                    step="1"
                    value={edit.credits ?? String(plan.out_ai_credits_included)}
                    onChange={(e) =>
                      setEdits((c) => ({
                        ...c,
                        [plan.out_plan_code]: { ...c[plan.out_plan_code], credits: e.target.value },
                      }))
                    }
                    
                  />
                </div>

                <div className="ml-auto flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy === plan.out_plan_code}
                    onClick={() => void toggleActive(plan)}
                  >
                    {plan.out_is_active ? 'Withdraw' : 'Restore'}
                  </Button>
                  <Button
                    size="sm"
                    disabled={!dirty || busy === plan.out_plan_code}
                    onClick={() => void save(plan)}
                  >
                    {busy === plan.out_plan_code && (
                      <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                    )}
                    Save
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>

        <p className="mt-3 text-xs text-muted-foreground">
          Billing period and allowance period are not editable here — both decide the window a
          teacher&rsquo;s credits are counted over, so changing one on a live plan would
          silently re-price everybody on it.
        </p>
      </CardContent>
    </Card>
  )
}
