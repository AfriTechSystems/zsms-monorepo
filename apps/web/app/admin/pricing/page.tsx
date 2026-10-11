'use client'

/**
 * Subscription pricing.
 *
 * Spec: `Official Documentation/17 Integration and Pricing/PRICING.md`
 *       `Official Documentation/01 Foundation Layer/DYNAMIC_CONFIG.md` — ADR-031
 *
 * ADR-031's test is "would a business person reasonably want to change this
 * without a deployment?" A price is the canonical yes, which is why this screen
 * exists and why nothing in the codebase contains the string K600.
 *
 * ## Layout
 *
 * Every control sits in **one** `FormGrid`. The first version used three
 * separate grids — `sm:grid-cols-3` for the money fields above `sm:grid-cols-2`
 * for the limits — which cannot align by construction, because they do not
 * share column tracks. One grid, one set of tracks, and the row below the money
 * fields lands on the same columns for free.
 *
 * The "unlimited" checkboxes live *inside* their number field's cell via the
 * field `footer` slot, rather than claiming grid cells of their own and pushing
 * everything after them one position out.
 *
 * ## The unlimited sentinel
 *
 * `student_limit` and `whatsapp_quota` use NULL for *unlimited* in the column.
 * NULL therefore cannot also mean "leave unchanged" in a partial update, so the
 * RPC takes `-1` for unlimited and NULL for unchanged. The checkbox is the only
 * route to that sentinel: a numeric field where a negative number has a special
 * meaning is a field someone will eventually type `0` into, and a tier capped at
 * zero pupils sells nothing.
 *
 * Editing is per-tier and explicit — a form with a save button, not
 * save-on-blur. Prices are the one thing on this dashboard where an accidental
 * keystroke has an invoice at the end of it.
 */

import type { FormEvent, JSX } from 'react'
import { useCallback, useState } from 'react'
import { Loader2, Wallet } from 'lucide-react'

import { apiSend, useApi } from '../../../lib/use-api'
import { PriceBands, usePriceBands } from './price-bands'
import { Alert } from '../../../components/ui/alert'
import { Badge } from '../../../components/ui/badge'
import { Card } from '../../../components/ui/card'
import { Button } from '../../../components/ui/button'
import { EmptyState } from '../../../components/ui/empty-state'
import { ErrorState, PageHeader, TableSkeleton } from '../../../components/ui/data-states'
import { Field, Input, PrefixedInput } from '../../../components/ui/field'
import { CheckboxField, FormActions, FormGrid, FormSection } from '../../../components/ui/form'
import { useToast } from '../../../components/ui/toast'
import { formatPrice } from '../health-shared'

interface Tier {
  tier_name: string
  display_name: string
  monthly_price_zmw: string | number | null
  monthly_price_usd: string | number | null
  annual_price_zmw: string | number | null
  student_limit: number | null
  whatsapp_quota: number | null
  /**
   * Both come from `subscription_tier_catalogue` and were being fetched and ignored — which is
   * why per-student pricing was invisible here despite existing in the database since `0124`.
   */
  pricing_model: string | null
  is_publicly_listed: boolean
  display_order: number
  updated_at: string | null
  updated_by: string | null
}

interface PricingPayload {
  tiers: Tier[]
  billingPerTier: Record<string, number>
  /**
   * Included monthly AI credits per tier (`0264`).
   *
   * `isSet` distinguishes a decided zero from an undecided tier. The table was empty
   * with nothing able to write it, so every school resolved to zero included credits
   * and the only way to change that was a migration.
   */
  aiAllowances: Record<string, { credits: number; isSet: boolean }>
}

const num = (v: string | number | null): string => (v === null ? '' : String(Number(v)))

/**
 * Included monthly AI credits for one tier.
 *
 * Its own component and its own save, because an allowance is decided at a different
 * time from a price: making somebody resubmit the whole tier to change it is how a
 * ceiling gets clobbered.
 */
function AiAllowance({
  tierName,
  current,
  isSet,
  onSaved,
}: {
  tierName: string
  current: number
  isSet: boolean
  onSaved: () => void
}): JSX.Element {
  const { toast } = useToast()
  const [value, setValue] = useState(String(current))
  const [saving, setSaving] = useState(false)

  async function save(): Promise<void> {
    const n = Number(value)
    if (!Number.isInteger(n) || n < 0) {
      toast('Enter a whole number of credits, or 0 for none.', 'danger')
      return
    }
    setSaving(true)
    try {
      const result = await apiSend<{ message?: string }>('/api/admin/tiers', 'PUT', {
        tierName,
        monthlyCredits: n,
      })
      toast(result.data?.message ?? result.error ?? 'Saved.', result.data ? 'success' : 'danger')
      if (result.data) onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="p-card">
      <h3 className="text-sm font-medium">Included AI credits</h3>

      {!isSet && (
        <Alert variant="warning" className="mt-2">
          {/*
            Named explicitly, because the symptom a school reports is "the AI does not
            work" and the cause is that nobody has decided what this tier includes.
            A bare 0 would look like a deliberate choice.
          */}
          No allowance has been decided for this tier, so schools on it include{' '}
          <strong>no</strong> AI credits and can only use credits they buy. Set a
          number below &mdash; or set 0 to record that none are included.
        </Alert>
      )}

      <div className="mt-stack flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="text-xs font-medium">Credits per month</span>
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode="numeric"
            className="mt-1 w-28 text-center"
          />
        </label>
        <Button type="button" variant="outline" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving...' : 'Save allowance'}
        </Button>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        A lesson plan or quiz costs 1 credit, a photographed page 2. Teachers can also
        buy their own packs, and a school can buy seats to assign.
      </p>
    </Card>
  )
}

function TierEditor({
  tier,
  billing,
  onSaved,
}: {
  tier: Tier
  billing: number
  onSaved: () => void
}): JSX.Element {
  const [monthlyZmw, setMonthlyZmw] = useState(num(tier.monthly_price_zmw))
  const [monthlyUsd, setMonthlyUsd] = useState(num(tier.monthly_price_usd))
  const [annualZmw, setAnnualZmw] = useState(num(tier.annual_price_zmw))
  const [studentLimit, setStudentLimit] = useState(tier.student_limit === null ? '' : String(tier.student_limit))
  const [unlimitedStudents, setUnlimitedStudents] = useState(tier.student_limit === null)
  const [quota, setQuota] = useState(tier.whatsapp_quota === null ? '' : String(tier.whatsapp_quota))
  const [unlimitedQuota, setUnlimitedQuota] = useState(tier.whatsapp_quota === null)
  const [listed, setListed] = useState(tier.is_publicly_listed)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const save = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      setSaving(true)
      setError(null)
      setSaved(false)

      const result = await apiSend('/api/admin/tiers', 'PATCH', {
        tierName: tier.tier_name,
        monthlyPriceZmw: monthlyZmw === '' ? undefined : Number(monthlyZmw),
        monthlyPriceUsd: monthlyUsd === '' ? undefined : Number(monthlyUsd),
        annualPriceZmw: annualZmw === '' ? undefined : Number(annualZmw),
        studentLimit: unlimitedStudents ? -1 : studentLimit === '' ? undefined : Number(studentLimit),
        whatsappQuota: unlimitedQuota ? -1 : quota === '' ? undefined : Number(quota),
        isPubliclyListed: listed,
      })

      setSaving(false)

      if (result.error) {
        setError(result.error)
        return
      }

      setSaved(true)
      onSaved()
    },
    [
      tier.tier_name,
      monthlyZmw,
      monthlyUsd,
      annualZmw,
      studentLimit,
      unlimitedStudents,
      quota,
      unlimitedQuota,
      listed,
      onSaved,
    ],
  )

  const id = `tier-${tier.tier_name}`

  return (
    <FormSection
      title={tier.display_name}
      actions={
        <>
          {!tier.is_publicly_listed && <Badge variant="neutral">Unlisted</Badge>}
          <Badge variant={billing > 0 ? 'primary' : 'neutral'}>
            {billing} billing school{billing === 1 ? '' : 's'}
          </Badge>
        </>
      }
      description={
        <>
          Currently {formatPrice(tier.monthly_price_zmw)}
          {tier.monthly_price_zmw !== null && '/month'}.{' '}
          {billing > 0
            ? `A change here re-prices ${billing} active school${billing === 1 ? '' : 's'} on the next invoice.`
            : 'No active school is on this tier, so a change affects nothing today.'}
        </>
      }
    >
      <form onSubmit={save} noValidate>
        <FormGrid columns={3}>
          <Field id={`${id}-monthly-zmw`} label="Monthly price (ZMW)">
            {(props) => (
              <PrefixedInput
                {...props}
                prefix="K"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={monthlyZmw}
                onChange={(e) => setMonthlyZmw(e.target.value)}
              />
            )}
          </Field>

          <Field id={`${id}-monthly-usd`} label="Monthly price (USD)" hint="For cross-border schools">
            {(props) => (
              <PrefixedInput
                {...props}
                prefix="$"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={monthlyUsd}
                onChange={(e) => setMonthlyUsd(e.target.value)}
              />
            )}
          </Field>

          <Field id={`${id}-annual-zmw`} label="Annual price (ZMW)" hint="Blank if no annual plan is offered">
            {(props) => (
              <PrefixedInput
                {...props}
                prefix="K"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={annualZmw}
                onChange={(e) => setAnnualZmw(e.target.value)}
              />
            )}
          </Field>

          <Field
            id={`${id}-students`}
            label="Student limit"
            hint="Pupils this tier admits"
            footer={
              <CheckboxField
                id={`${id}-students-unlimited`}
                label="No limit"
                checked={unlimitedStudents}
                onChange={setUnlimitedStudents}
              />
            }
          >
            {(props) => (
              <Input
                {...props}
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                disabled={unlimitedStudents}
                value={unlimitedStudents ? '' : studentLimit}
                placeholder={unlimitedStudents ? 'Unlimited' : undefined}
                onChange={(e) => setStudentLimit(e.target.value)}
              />
            )}
          </Field>

          <Field
            id={`${id}-quota`}
            label="WhatsApp quota"
            hint="Messages included per month"
            footer={
              <CheckboxField
                id={`${id}-quota-unlimited`}
                label="No quota"
                checked={unlimitedQuota}
                onChange={setUnlimitedQuota}
              />
            }
          >
            {(props) => (
              <Input
                {...props}
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                disabled={unlimitedQuota}
                value={unlimitedQuota ? '' : quota}
                placeholder={unlimitedQuota ? 'Unlimited' : undefined}
                onChange={(e) => setQuota(e.target.value)}
              />
            )}
          </Field>

        </FormGrid>

        {/*
          Outside the grid deliberately. A bare checkbox sharing a row with
          fields that carry an input, a hint, and a checkbox of their own has
          nothing to align to — it floated a couple of dozen pixels above its
          neighbours whichever way the row was aligned. It is also a different
          kind of setting: the fields above are what the tier *is*, this is
          whether anyone is shown it.
        */}
        <div className="mt-stack border-t border-border pt-stack">
          <CheckboxField
            id={`${id}-listed`}
            label="List publicly"
            hint="Show this tier on the public pricing page at zsms.co.zm/pricing"
            checked={listed}
            onChange={setListed}
          />
        </div>

        {error && (
          <Alert variant="danger" title="Not saved" className="mt-stack">
            {error}
          </Alert>
        )}

        <FormActions>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 aria-hidden="true" className="animate-spin" />}
            Save {tier.display_name}
          </Button>
          {/* Announced, not just shown — the button does not change shape on
              success, so a sighted user and a screen-reader user get the same
              confirmation. */}
          <p role="status" aria-live="polite" className="text-sm text-success-text">
            {saved ? 'Saved.' : ''}
          </p>
        </FormActions>
      </form>
    </FormSection>
  )
}

export default function AdminPricingPage(): JSX.Element {
  const { data, loading, error, code, reload } = useApi<PricingPayload>('/api/admin/tiers')
  const { byTier, reload: reloadBands } = usePriceBands()

  return (
    <>
      <PageHeader
        title="Pricing"
        description="Subscription tiers, their prices, and their limits. Nothing here is compiled into the application — these rows are the price list."
        note="A tier is billed EITHER at a flat monthly price OR per pupil, never both. Switching a tier to per-pupil needs at least one band before a school on it can be invoiced — until then ZSMS reports such a school as unpriced rather than billing it nothing."
      />

      {error && <ErrorState message={error} code={code} onRetry={reload} />}
      {loading && !data && !error && <TableSkeleton rows={4} columns={3} />}

      {!error && data && (
        <div className="space-y-cards">
          {data.tiers.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="No tiers configured"
              description="The subscription tier table is empty. Tiers are seeded by the pricing migrations."
            />
          ) : (
            data.tiers.map((tier) => (
              <div key={tier.tier_name} className="space-y-3">
                <TierEditor
                  tier={tier}
                  billing={data.billingPerTier[tier.tier_name] ?? 0}
                  onSaved={reload}
                />
                {/*
                  Beneath the tier rather than inside it: the flat price and the per-pupil bands
                  are alternatives, and nesting one in the other would suggest they combine.
                */}
                <AiAllowance
                  tierName={tier.tier_name}
                  current={data.aiAllowances?.[tier.tier_name]?.credits ?? 0}
                  isSet={data.aiAllowances?.[tier.tier_name]?.isSet ?? false}
                  onSaved={reload}
                />
                <PriceBands
                  tierName={tier.tier_name}
                  displayName={tier.display_name}
                  pricingModel={tier.pricing_model ?? 'flat'}
                  bands={byTier[tier.tier_name] ?? []}
                  onChanged={() => {
                    reloadBands()
                    reload()
                  }}
                />
              </div>
            ))
          )}
        </div>
      )}
    </>
  )
}
