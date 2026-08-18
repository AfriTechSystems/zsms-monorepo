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
 * ## The unlimited sentinel
 *
 * `student_limit` and `whatsapp_quota` use NULL for *unlimited* in the column.
 * NULL therefore cannot also mean "leave unchanged" in a partial update, so the
 * RPC takes `-1` for unlimited and NULL for unchanged. This screen renders that
 * as an explicit checkbox rather than asking anyone to type `-1`: a numeric
 * field where a negative number has a special meaning is a field someone will
 * eventually put `0` in, and a tier capped at zero pupils sells nothing.
 *
 * Editing is per-tier and explicit — a form with a save button, not
 * save-on-blur. Prices are the one thing on this dashboard where an accidental
 * keystroke has an invoice at the end of it.
 */

import type { FormEvent, JSX } from 'react'
import { useCallback, useState } from 'react'
import { Loader2, Wallet } from 'lucide-react'

import { apiSend, useApi } from '../../../lib/use-api'
import { Alert } from '../../../components/ui/alert'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { EmptyState } from '../../../components/ui/empty-state'
import { ErrorState, PageHeader, TableSkeleton } from '../../../components/ui/data-states'
import { Field, Input } from '../../../components/ui/field'
import { formatKwacha } from '../health-shared'

interface Tier {
  tier_name: string
  display_name: string
  monthly_price_zmw: string | number | null
  monthly_price_usd: string | number | null
  annual_price_zmw: string | number | null
  student_limit: number | null
  whatsapp_quota: number | null
  is_publicly_listed: boolean
  display_order: number
  updated_at: string | null
  updated_by: string | null
}

interface PricingPayload {
  tiers: Tier[]
  billingPerTier: Record<string, number>
}

const num = (v: string | number | null): string => (v === null ? '' : String(Number(v)))

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
        // -1 is the RPC's unlimited sentinel; the checkbox is the only way to
        // reach it, so nobody types a magic number.
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
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{tier.display_name}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {!tier.is_publicly_listed && <Badge variant="neutral">Unlisted</Badge>}
            <Badge variant={billing > 0 ? 'primary' : 'neutral'}>
              {billing} billing school{billing === 1 ? '' : 's'}
            </Badge>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Currently {formatKwacha(tier.monthly_price_zmw)}/month.{' '}
          {billing > 0
            ? `A change here re-prices ${billing} active school${billing === 1 ? '' : 's'} on the next invoice.`
            : 'No active school is on this tier, so a change affects nothing today.'}
        </p>
      </CardHeader>

      <CardContent>
        <form onSubmit={save} className="space-y-stack">
          <div className="grid gap-stack sm:grid-cols-3">
            <Field id={`${id}-monthly-zmw`} label="Monthly (ZMW)">
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={monthlyZmw}
                  onChange={(e) => setMonthlyZmw(e.target.value)}
                />
              )}
            </Field>

            <Field id={`${id}-monthly-usd`} label="Monthly (USD)" hint="For cross-border schools">
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={monthlyUsd}
                  onChange={(e) => setMonthlyUsd(e.target.value)}
                />
              )}
            </Field>

            <Field id={`${id}-annual-zmw`} label="Annual (ZMW)" hint="Leave blank for no annual plan">
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={annualZmw}
                  onChange={(e) => setAnnualZmw(e.target.value)}
                />
              )}
            </Field>
          </div>

          <div className="grid gap-stack sm:grid-cols-2">
            <div className="space-y-1.5">
              <Field id={`${id}-students`} label="Student limit">
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
              <label className="flex min-h-tap items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={unlimitedStudents}
                  onChange={(e) => setUnlimitedStudents(e.target.checked)}
                />
                No student limit
              </label>
            </div>

            <div className="space-y-1.5">
              <Field id={`${id}-quota`} label="WhatsApp quota" hint="Messages included per month">
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
              <label className="flex min-h-tap items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={unlimitedQuota}
                  onChange={(e) => setUnlimitedQuota(e.target.checked)}
                />
                No message quota
              </label>
            </div>
          </div>

          <label className="flex min-h-tap items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={listed}
              onChange={(e) => setListed(e.target.checked)}
            />
            Show this tier on the public pricing page
          </label>

          {error && (
            <Alert variant="danger" title="Not saved">
              {error}
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 aria-hidden="true" className="animate-spin" />}
              Save {tier.display_name}
            </Button>
            {/* Announced, not just shown — the button does not change shape on
                success, so a sighted user and a screen-reader user get the
                same confirmation. */}
            <p role="status" aria-live="polite" className="text-sm text-success-text">
              {saved ? 'Saved.' : ''}
            </p>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

export default function AdminPricingPage(): JSX.Element {
  const { data, loading, error, code, reload } = useApi<PricingPayload>('/api/admin/tiers')

  return (
    <>
      <PageHeader
        title="Pricing"
        description="Subscription tiers, their prices, and their limits. Nothing here is compiled into the application — these rows are the price list."
      />

      {error && <ErrorState message={error} code={code} onRetry={reload} />}
      {loading && !error && <TableSkeleton rows={4} columns={3} />}

      {!loading && !error && data && (
        <div className="space-y-cards">
          {data.tiers.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="No tiers configured"
              description="The subscription tier table is empty. Tiers are seeded by the pricing migrations."
            />
          ) : (
            data.tiers.map((tier) => (
              <TierEditor
                key={tier.tier_name}
                tier={tier}
                billing={data.billingPerTier[tier.tier_name] ?? 0}
                onSaved={reload}
              />
            ))
          )}
        </div>
      )}
    </>
  )
}
