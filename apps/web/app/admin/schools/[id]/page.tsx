'use client'

/**
 * School detail — the support screen.
 *
 * Spec: `Official Documentation/15 Super Admin and Platform/SUPERADMIN.md`
 *       `Official Documentation/17 Integration and Pricing/PRICING.md`
 *       `Official Documentation/15 Super Admin and Platform/IMPERSONATION_FLOW.md`
 *
 * ## Resolved access, not the tier matrix
 *
 * The feature list here is the output of `school_has_feature()` — one call per
 * feature, run through the same fixed order the product enforces at runtime
 * (revoke override → grant override → tier override → tier matrix). Rendering
 * the tier's matrix row instead would be cheaper and wrong for exactly the
 * schools an operator opens this page for: the ones carrying an exception.
 *
 * ## An override is a decision, and this is where it gets recorded
 *
 * The grant form demands a reason of real length, because in six months the row
 * is the only surviving explanation of why one school has something its tier
 * excludes. Revoking never deletes: the row is flagged inactive with the actor
 * and time, which is what an audit can rely on.
 */

import type { FormEvent, JSX } from 'react'
import { useCallback, useState } from 'react'
import { use } from 'react'
import {
  Check,
  KeyRound,
  Loader2,
  Minus,
  ShieldAlert,
  Ticket,
  Undo2,
} from 'lucide-react'

import { apiSend, useApi } from '../../../../lib/use-api'
import { Alert } from '../../../../components/ui/alert'
import { Badge } from '../../../../components/ui/badge'
import { Button } from '../../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui/card'
import { EmptyState } from '../../../../components/ui/empty-state'
import { ErrorState, PageHeader, TableSkeleton } from '../../../../components/ui/data-states'
import { Field, Input, Select } from '../../../../components/ui/field'
import { FormActions, FormGrid, FormSection } from '../../../../components/ui/form'
import { StatusBadge, TIER_LABEL, formatKwacha } from '../../health-shared'
import { AiUsagePanel } from './ai-usage-panel'
import { SettingsHistory } from '../../../../components/ui/settings-history'
import {
  OnboardingPanel,
  type ChecklistItem,
  type OnboardingRecord,
  type Progress,
} from './onboarding-panel'

interface School {
  id: string
  school_id: string
  name: string
  type: string
  level: string
  city_code: string
  status: string
  subscription_tier: string
  max_students: number | null
  finance_module_enabled: boolean
  whatsapp_enabled: boolean
  clerk_org_id: string | null
  created_at: string
}

interface ResolvedFeature {
  feature_key: string
  display_name: string
  category: string
  monthly_addon_price_zmw: string | number | null
  is_available_as_addon: boolean
  enabled: boolean
}

interface Override {
  id: string
  override_type: string
  feature_key: string | null
  override_value: string | null
  expires_at: string | null
  reason: string
  ticket_ref: string | null
  granted_by: string
  is_active: boolean
  created_at: string
  revoked_at: string | null
}

/** The resolver's row, as `school_student_capacity()` returns it. */
interface CapacityRow {
  student_limit: number | null
  is_unlimited: boolean
  source: string
  current_count: number
  remaining: number | null
  at_capacity: boolean
}

interface Detail {
  school: School
  features: ResolvedFeature[]
  overrides: Override[]
  capacity: CapacityRow | null
  studentCount: number
  onboarding: OnboardingRecord | null
  checklist: ChecklistItem[]
  progress: Progress | null
  isProvisioned: boolean
}

/**
 * The capacity row in the shape the screen renders.
 *
 * `limitLabel` exists because the unlimited case must never render as a number.
 * `student_limit` is NULL for an uncapped school, and a template that prints it
 * straight shows "of " followed by nothing — which reads as a missing value
 * rather than as the deliberate absence of a ceiling.
 */
interface Capacity {
  limitLabel: string
  currentCount: number
  remaining: number | null
  source: string
  atCapacity: boolean
}

function toCapacity(row: CapacityRow | null | undefined): Capacity | null {
  if (!row) return null
  return {
    limitLabel: row.is_unlimited ? 'no limit' : String(row.student_limit ?? 0),
    currentCount: row.current_count,
    remaining: row.remaining,
    source: row.source,
    atCapacity: row.at_capacity,
  }
}

const STATUSES = ['pending_verification', 'trial', 'active', 'suspended', 'terminated'] as const
const TIERS = ['starter', 'growth', 'professional', 'enterprise'] as const

const formatDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString('en-ZM', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'

/** Status and tier, saved together so one confirmation covers one decision. */
function SubscriptionPanel({ school, onSaved }: { school: School; onSaved: () => void }): JSX.Element {
  const [status, setStatus] = useState(school.status)
  const [tier, setTier] = useState(school.subscription_tier)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const dirty = status !== school.status || tier !== school.subscription_tier

  const save = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()

      // Suspension cuts off every user at the school, not just the account
      // that stopped paying. Naming that before the click is the difference
      // between a deliberate act and a mis-click on a select.
      if (status === 'suspended' && school.status !== 'suspended') {
        const ok = window.confirm(
          `Suspend ${school.name}?\n\n` +
            'Every teacher, parent, and administrator at this school loses access immediately. ' +
            'Their data is retained.',
        )
        if (!ok) return
      }

      setSaving(true)
      setError(null)
      setSaved(false)

      const result = await apiSend(`/api/admin/schools/${school.id}`, 'PATCH', {
        status: status !== school.status ? status : undefined,
        subscriptionTier: tier !== school.subscription_tier ? tier : undefined,
      })

      setSaving(false)
      if (result.error) {
        setError(result.error)
        return
      }
      setSaved(true)
      onSaved()
    },
    [status, tier, school, onSaved],
  )

  return (
    <FormSection title="Subscription and standing">
      <form onSubmit={save} noValidate>
        <FormGrid columns={2}>
          <Field id="school-status-edit" label="Status">
            {(props) => (
              <Select {...props} value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            id="school-tier-edit"
            label="Subscription tier"
            hint="Changes which features resolve by default"
          >
            {(props) => (
              <Select {...props} value={tier} onChange={(e) => setTier(e.target.value)}>
                {TIERS.map((t) => (
                  <option key={t} value={t}>
                    {TIER_LABEL[t] ?? t}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </FormGrid>

        {error && (
          <Alert variant="danger" title="Not saved" className="mt-stack">
            {error}
          </Alert>
        )}

        <FormActions>
          <Button type="submit" disabled={saving || !dirty}>
            {saving && <Loader2 aria-hidden="true" className="animate-spin" />}
            Save changes
          </Button>
          <p role="status" aria-live="polite" className="text-sm text-success-text">
            {saved && !dirty ? 'Saved.' : ''}
          </p>
        </FormActions>
      </form>
    </FormSection>
  )
}

type OverrideKind = 'grant_feature' | 'revoke_feature' | 'student_limit_override'

/** Grant or revoke a feature, or vary the student ceiling, for this school alone. */
function OverrideForm({ schoolId, features, capacity, onSaved }: {
  schoolId: string
  features: ResolvedFeature[]
  capacity: Capacity | null
  onSaved: () => void
}): JSX.Element {
  const [featureKey, setFeatureKey] = useState(features[0]?.feature_key ?? '')
  const [type, setType] = useState<OverrideKind>('grant_feature')
  const [limit, setLimit] = useState('')
  const [unlimited, setUnlimited] = useState(false)
  const [reason, setReason] = useState('')
  const [ticket, setTicket] = useState('')
  const [expires, setExpires] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isLimit = type === 'student_limit_override'
  // A ceiling below the school's current roll is not refused — a school may
  // legitimately be capped at what it already has, and the trigger blocks only
  // the NEXT enrolment. But it changes what the operator is agreeing to, so it
  // is said out loud rather than discovered by the school.
  const belowRoll =
    isLimit && !unlimited && limit !== '' && capacity !== null && Number(limit) < capacity.currentCount

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      setSaving(true)
      setError(null)

      const result = await apiSend('/api/admin/overrides', 'POST', {
        schoolId,
        overrideType: type,
        featureKey: type === 'student_limit_override' ? undefined : featureKey,
        overrideValue:
          type === 'student_limit_override' ? (unlimited ? 'unlimited' : limit) : undefined,
        reason: reason.trim(),
        ticketRef: ticket.trim() || undefined,
        // A date input gives a bare date; the column is TIMESTAMPTZ and the
        // route demands a full datetime. Expiry lands at end of day UTC.
        expiresAt: expires ? new Date(`${expires}T23:59:59Z`).toISOString() : undefined,
      })

      setSaving(false)
      if (result.error) {
        setError(result.error)
        return
      }

      setReason('')
      setTicket('')
      setExpires('')
      setLimit('')
      setUnlimited(false)
      onSaved()
    },
    [schoolId, type, featureKey, limit, unlimited, reason, ticket, expires, onSaved],
  )

  return (
    <form onSubmit={submit} noValidate>
      {/* One grid for the whole form. The reason spans both columns rather than
          sitting in a grid of its own, so it shares the tracks above and below
          it instead of merely appearing to. */}
      <FormGrid columns={2}>
        <Field id="override-type" label="Decision" required>
          {(props) => (
            <Select
              {...props}
              value={type}
              onChange={(e) => setType(e.target.value as OverrideKind)}
            >
              <option value="grant_feature">Grant a feature this tier excludes</option>
              <option value="revoke_feature">Revoke a feature this tier includes</option>
              <option value="student_limit_override">Vary the student ceiling</option>
            </Select>
          )}
        </Field>

        {isLimit ? (
          <Field
            id="override-limit"
            label="Student ceiling"
            required={!unlimited}
            hint={
              capacity
                ? `Currently ${capacity.limitLabel} from the ${capacity.source === 'tier' ? 'tier' : 'existing override'}; ${capacity.currentCount} enrolled.`
                : 'Pupils this school may have on the roll.'
            }
            footer={
              <label className="flex min-h-tap items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={unlimited}
                  onChange={(e) => setUnlimited(e.target.checked)}
                />
                No limit
              </label>
            }
          >
            {(props) => (
              <Input
                {...props}
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={unlimited ? '' : limit}
                disabled={unlimited}
                required={!unlimited}
                placeholder={unlimited ? 'Unlimited' : '250'}
                onChange={(e) => setLimit(e.target.value)}
              />
            )}
          </Field>
        ) : (
          <Field id="override-feature" label="Feature" required>
            {(props) => (
              <Select {...props} value={featureKey} onChange={(e) => setFeatureKey(e.target.value)}>
                {features.map((f) => (
                  <option key={f.feature_key} value={f.feature_key}>
                    {f.display_name} {f.enabled ? '(currently on)' : '(currently off)'}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        <Field
          id="override-reason"
          label="Reason"
          required
          className="sm:col-span-2"
          hint="At least 10 characters. This is the only record of why, long after the conversation."
        >
          {(props) => (
            <Input
              {...props}
              value={reason}
              minLength={10}
              maxLength={500}
              required
              placeholder="Pilot school — WhatsApp enabled for the term while they evaluate"
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>

        <Field id="override-ticket" label="Ticket reference" hint="Optional">
          {(props) => (
            <Input {...props} value={ticket} maxLength={64} placeholder="SUP-1042" onChange={(e) => setTicket(e.target.value)} />
          )}
        </Field>

        <Field id="override-expires" label="Expires" hint="Optional — blank means indefinite">
          {(props) => <Input {...props} type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />}
        </Field>
      </FormGrid>

      {belowRoll && capacity && (
        <Alert variant="warning" title="Below the current roll" className="mt-stack">
          {capacity.currentCount} pupils are already enrolled. Setting the ceiling to {limit} does not
          remove anyone — it stops the school enrolling anybody else until the roll falls below it.
        </Alert>
      )}

      {error && (
        <Alert variant="danger" title="Override not created" className="mt-stack">
          {error}
        </Alert>
      )}

      <FormActions>
        <Button
          type="submit"
          disabled={saving || reason.trim().length < 10 || (isLimit && !unlimited && limit === '')}
        >
          {saving && <Loader2 aria-hidden="true" className="animate-spin" />}
          Record override
        </Button>
      </FormActions>
    </form>
  )
}

export default function AdminSchoolDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}): JSX.Element {
  // Next 15 passes params as a promise; `use()` unwraps it in a client component.
  const { id } = use(params)

  const { data, loading, error, code, reload } = useApi<Detail>(`/api/admin/schools/${id}`)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [revokeError, setRevokeError] = useState<string | null>(null)
  const capacity = toCapacity(data?.capacity)

  const revoke = useCallback(
    async (override: Override) => {
      const ok = window.confirm(
        `Revoke this override?\n\n${override.reason}\n\n` +
          'The record is kept and flagged inactive. Access reverts to what the tier allows.',
      )
      if (!ok) return

      setRevoking(override.id)
      setRevokeError(null)

      const result = await apiSend('/api/admin/overrides', 'DELETE', { id: override.id })

      setRevoking(null)
      if (result.error) {
        setRevokeError(result.error)
        return
      }
      reload()
    },
    [reload],
  )

  return (
    <>
      {error && <ErrorState message={error} code={code} onRetry={reload} />}
      {loading && !data && !error && <TableSkeleton rows={8} columns={3} />}

      {!error && data && (
        <>
          <PageHeader
            backTo="/admin/schools"
            backLabel="All schools"
            title={data.school.name}
            description={`${data.school.type} · ${data.school.level} · ${data.school.city_code}`}
            note="Everything on this screen affects one school only. Changing the tier changes which features resolve for it and what its pupil limit is; suspending it cuts off every user there immediately."
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={data.school.status} />
                <Badge variant="primary">
                  {TIER_LABEL[data.school.subscription_tier] ?? data.school.subscription_tier}
                </Badge>
              </div>
            }
          />

          <div className="space-y-cards">
            <Card>
              <CardContent className="pt-card">
                <dl className="grid grid-cols-2 gap-stack lg:grid-cols-4">
                  <div>
                    <dt className="text-sm text-muted-foreground">School code</dt>
                    <dd className="font-mono text-sm">{data.school.school_id}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted-foreground">Pupils enrolled</dt>
                    {/* The ceiling shown is the RESOLVED one — the same value
                        the enrolment trigger reads — with where it came from
                        named. `schools.max_students` was shown here before; it
                        is a per-school copy nothing enforces, so it could and
                        eventually would disagree with what a school actually
                        hits. */}
                    <dd data-numeric className="text-lg font-semibold">
                      {capacity ? capacity.currentCount : data.studentCount}
                      {capacity && (
                        <span className="text-sm font-normal text-muted-foreground">
                          {' '}
                          of {capacity.limitLabel}
                        </span>
                      )}
                    </dd>
                    {capacity && (
                      <p className="text-xs text-subtle">
                        {capacity.source === 'school_override'
                          ? 'Per-school override'
                          : capacity.source === 'tier_override'
                            ? 'Tier override'
                            : capacity.source === 'tier'
                              ? `${TIER_LABEL[data.school.subscription_tier] ?? data.school.subscription_tier} tier`
                              : 'No ceiling configured'}
                        {capacity.atCapacity ? ' · at capacity' : ''}
                      </p>
                    )}
                  </div>
                  <div>
                    <dt className="text-sm text-muted-foreground">Joined</dt>
                    <dd className="text-sm">{formatDate(data.school.created_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted-foreground">Clerk organisation</dt>
                    <dd className="truncate font-mono text-xs">{data.school.clerk_org_id ?? '—'}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            <OnboardingPanel
              schoolId={data.school.id}
              schoolCode={data.school.school_id}
              status={data.school.status}
              isProvisioned={data.isProvisioned}
              onboarding={data.onboarding}
              checklist={data.checklist}
              progress={data.progress}
              onChanged={reload}
            />

            <SubscriptionPanel school={data.school} onSaved={reload} />

            {/* Renders nothing for a school that has never used AI — see the component.
                Aggregates only: no teacher is named, by decision. */}
            <AiUsagePanel schoolId={data.school.id} />

            {/* What this school has changed about itself, by whom. Named explicitly
                because AfriTech has no organisation of its own to resolve from. */}
            <SettingsHistory schoolId={data.school.id} />

            <Card>
              <CardHeader>
                <CardTitle>Resolved feature access</CardTitle>
                <p className="text-sm text-muted-foreground">
                  What this school can actually use right now, resolved through overrides and tier —
                  not simply what {TIER_LABEL[data.school.subscription_tier] ?? data.school.subscription_tier}{' '}
                  includes.
                </p>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Resolved feature access for {data.school.name}</caption>
                    <thead className="border-y border-border bg-sunken text-left">
                      <tr>
                        <th scope="col" className="px-4 py-2.5 font-medium">Feature</th>
                        <th scope="col" className="px-4 py-2.5 font-medium">Category</th>
                        <th scope="col" className="px-4 py-2.5 text-right font-medium">Add-on price</th>
                        <th scope="col" className="px-4 py-2.5 font-medium">Access</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.features.map((f) => (
                        <tr key={f.feature_key} className="border-b border-border last:border-0">
                          <th scope="row" className="px-4 py-3 text-left font-normal">
                            <span className="font-medium text-foreground">{f.display_name}</span>
                            <span className="block font-mono text-xs text-subtle">{f.feature_key}</span>
                          </th>
                          <td className="px-4 py-3 capitalize text-muted-foreground">
                            {f.category.replace(/_/g, ' ')}
                          </td>
                          <td data-numeric className="px-4 py-3 text-right text-muted-foreground">
                            {f.is_available_as_addon && f.monthly_addon_price_zmw
                              ? `${formatKwacha(f.monthly_addon_price_zmw)}/mo`
                              : '—'}
                          </td>
                          <td className="px-4 py-3">
                            {f.enabled ? (
                              <Badge variant="success">
                                <Check aria-hidden="true" />
                                Available
                              </Badge>
                            ) : (
                              <Badge variant="neutral">
                                <Minus aria-hidden="true" />
                                Not included
                              </Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Overrides</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Exceptions that apply to this school alone. A revoke override beats a grant, and
                  both beat the tier.
                </p>
              </CardHeader>
              <CardContent className="space-y-cards">
                {revokeError && (
                  <Alert variant="danger" title="Could not revoke">
                    {revokeError}
                  </Alert>
                )}

                {data.overrides.length === 0 ? (
                  <EmptyState
                    icon={Ticket}
                    title="No overrides"
                    description="This school gets exactly what its tier includes."
                  />
                ) : (
                  <ul className="space-y-stack">
                    {data.overrides.map((o) => (
                      <li
                        key={o.id}
                        className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border p-3"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {/* Only a revoke is danger and only a grant is
                                success. The rest change a value rather than
                                turn something on or off, and colouring a
                                lowered ceiling green would read as a favour. */}
                            <Badge
                              variant={
                                o.override_type === 'revoke_feature'
                                  ? 'danger'
                                  : o.override_type === 'grant_feature'
                                    ? 'success'
                                    : 'primary'
                              }
                            >
                              {o.override_type.replace(/_/g, ' ')}
                            </Badge>
                            {o.feature_key && (
                              <span className="font-mono text-xs text-subtle">{o.feature_key}</span>
                            )}
                            {o.override_value && (
                              <span className="font-mono text-xs text-subtle">{o.override_value}</span>
                            )}
                            {!o.is_active && <Badge variant="neutral">Revoked {formatDate(o.revoked_at)}</Badge>}
                          </div>
                          <p className="text-sm">{o.reason}</p>
                          <p className="text-xs text-muted-foreground">
                            {o.ticket_ref ? `${o.ticket_ref} · ` : ''}
                            granted {formatDate(o.created_at)}
                            {o.expires_at ? ` · expires ${formatDate(o.expires_at)}` : ' · no expiry'}
                          </p>
                        </div>

                        {o.is_active && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={revoking === o.id}
                            onClick={() => void revoke(o)}
                          >
                            {revoking === o.id ? (
                              <Loader2 aria-hidden="true" className="animate-spin" />
                            ) : (
                              <Undo2 aria-hidden="true" />
                            )}
                            Revoke
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="border-t border-border pt-cards">
                  <h3 className="mb-stack font-semibold">Record a new override</h3>
                  <OverrideForm
                    schoolId={data.school.id}
                    features={data.features}
                    capacity={capacity}
                    onSaved={reload}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Impersonation</CardTitle>
              </CardHeader>
              <CardContent className="space-y-stack">
                <Alert variant="warning" title="Not available yet">
                  <p>
                    Impersonation needs Clerk actor tokens, which the auth provider cannot mint
                    today. <code className="font-mono text-xs">/api/admin/impersonate</code> answers{' '}
                    <code className="font-mono text-xs">501</code> and says so, rather than
                    returning a session that looks real.
                  </p>
                </Alert>
                <p className="flex items-start gap-2 text-sm text-muted-foreground">
                  <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  <span>
                    When it lands, every impersonated session carries an{' '}
                    <code className="font-mono text-xs">act</code> claim, so the database can tell
                    who really acted — <code className="font-mono text-xs">is_impersonation_session()</code>{' '}
                    and <code className="font-mono text-xs">get_actor_id()</code> already exist for it.
                  </span>
                </p>
                <Button variant="outline" disabled>
                  <KeyRound aria-hidden="true" />
                  Sign in as a user at this school
                </Button>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </>
  )
}
