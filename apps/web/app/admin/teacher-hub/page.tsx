'use client'

/**
 * Teacher Hub accounts, from AfriTech's side.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md`
 *
 * ## This screen is the only way a teacher's payment becomes a subscription
 *
 * Payment is recorded by hand — mobile money or a transfer into the AfriTech account — so
 * activation cannot be a teacher-facing action, or the paid product would be free to anyone who
 * found the endpoint. `teacher_hub_activate_subscription()` refuses everybody who is not
 * AfriTech, and `/api/admin/teacher-hub` is the only route that calls it.
 *
 * The route existed before this page did, which meant the activation path was **unreachable**:
 * a teacher could pay and nothing in the product could act on it. Found when the sidebar linked
 * to a page that was never built.
 *
 * ## "Lapsed" is computed from the date, not read from the status
 *
 * Because billing is manual, a row can easily still say `active` with an end date months past.
 * `teacher_hub_entitlement()` decides on the date, so this list shows the same truth rather than
 * the stale label — otherwise support would be looking at a green badge while the teacher is
 * locked out.
 */

import type { JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'

import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card'
import { Field, Input, Select } from '../../../components/ui/field'
import { EmptyState } from '../../../components/ui/empty-state'
import { ErrorState, PageHeader, TableSkeleton } from '../../../components/ui/data-states'
import { StatCard } from '../../../components/ui/stat-card'
import { useToast } from '../../../components/ui/toast'
import { PlanEditor, type HubPlan } from './plan-editor'

interface HubAccount {
  clerk_user_id: string
  full_name: string
  email: string
  plan_code: string
  subscription_status: string
  trial_resources_used: number
  resources_created: number
  subscription_ends_at: string | null
  created_at: string
  lapsed: boolean
}

interface Plan {
  plan_code: string
  display_name: string
  billing_period: string
  price: number | string
  currency_code: string
}

interface Payload {
  accounts: HubAccount[]
  /** The editable catalogue (0178), distinct from `plans` which drives the activation form. */
  planCatalogue?: HubPlan[]
  plans: Plan[]
  summary: { total: number; trial: number; active: number; cancelled: number; suspended: number }
}

const shortDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

const money = (value: number | string, currency: string): string => {
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return '—'
  return `${currency === 'ZMW' ? 'K' : `${currency} `}${n.toLocaleString('en-GB')}`
}

export default function AdminTeacherHubPage(): JSX.Element {
  const { toast } = useToast()
  const [payload, setPayload] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [selected, setSelected] = useState('')
  const [planCode, setPlanCode] = useState('')
  const [paidUntil, setPaidUntil] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/admin/teacher-hub')
      const body = (await response.json()) as { data?: Payload; error?: string }
      if (!response.ok) {
        setError(body.error ?? 'Could not load Teacher Hub accounts.')
        setLoading(false)
        return
      }
      setError(null)
      setPayload(body.data ?? null)
    } catch {
      setError('Could not reach the server.')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const activate = async (): Promise<void> => {
    setSaving(true)
    try {
      const response = await fetch('/api/admin/teacher-hub', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clerkUserId: selected,
          planCode,
          // Sent only when given. Absent, the plan's own period applies from now — which is the
          // common case and avoids an off-by-one from a date picker's local midnight.
          ...(paidUntil ? { paidUntil: new Date(paidUntil).toISOString() } : {}),
        }),
      })
      const body = (await response.json()) as { error?: string }
      toast(
        response.ok ? 'Subscription activated.' : (body.error ?? 'That did not work.'),
        response.ok ? 'success' : 'danger',
      )
      if (response.ok) {
        setSelected('')
        setPaidUntil('')
        void load()
      }
    } catch {
      toast('Could not reach the server.', 'danger')
    }
    setSaving(false)
  }

  const accounts = payload?.accounts ?? []
  // The trial is a plan row, so it must never appear as something to activate.
  const purchasable = (payload?.plans ?? []).filter((p) => p.billing_period !== 'none')

  return (
    <>
      <PageHeader
        title="Teacher Hub"
        description="Standalone teacher accounts, and the payments AfriTech has recorded against them."
        note={
          <>
            A teacher pays by mobile money or transfer using their email as the reference. Once it
            arrives, activate their plan here — <strong>this is the only place that can</strong>,
            because an endpoint a teacher could call would make the paid product free.
          </>
        }
      />

      <div className="space-y-cards">
        {/*
          Prices first. `afritech.teacher_hub_plans` has granted UPDATE to AfriTech since 0130,
          but the table lives in a schema PostgREST cannot see — so the grant was real and
          unusable, and changing the Hub's price meant editing the database by hand (0178).
        */}
        <PlanEditor plans={payload?.planCatalogue ?? []} onChanged={load} />

        {payload?.summary && (
          <div className="grid gap-4 sm:grid-cols-4">
            <StatCard label="Accounts" value={String(payload.summary.total)} />
            <StatCard label="On trial" value={String(payload.summary.trial)} tone="info" />
            <StatCard label="Subscribed" value={String(payload.summary.active)} tone="success" />
            <StatCard
              label="Cancelled"
              value={String(payload.summary.cancelled)}
              tone={payload.summary.cancelled > 0 ? 'warning' : 'neutral'}
            />
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Record a payment</CardTitle>
            <CardDescription>
              Activates the teacher&apos;s plan. Their trial counter is deliberately not reset —
              five free resources is a lifetime allowance.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field id="account" label="Teacher" required>
                {(props) => (
                  <Select {...props} value={selected} onChange={(e) => setSelected(e.target.value)}>
                    <option value="">Choose an account</option>
                    {accounts.map((a) => (
                      <option key={a.clerk_user_id} value={a.clerk_user_id}>
                        {a.full_name} — {a.email}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field id="plan" label="Plan" required>
                {(props) => (
                  <Select {...props} value={planCode} onChange={(e) => setPlanCode(e.target.value)}>
                    <option value="">Choose a plan</option>
                    {purchasable.map((p) => (
                      <option key={p.plan_code} value={p.plan_code}>
                        {p.display_name} — {money(p.price, p.currency_code)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field
                id="paid-until"
                label="Paid until"
                hint="Optional. Leave blank to run one full period from today."
              >
                {(props) => (
                  <Input
                    {...props}
                    type="date"
                    value={paidUntil}
                    onChange={(e) => setPaidUntil(e.target.value)}
                  />
                )}
              </Field>
            </div>

            <Button onClick={() => void activate()} disabled={saving || !selected || !planCode}>
              {saving ? 'Activating…' : 'Activate subscription'}
            </Button>
          </CardContent>
        </Card>

        {loading ? (
          <TableSkeleton rows={5} columns={4} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : accounts.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="No Teacher Hub accounts yet"
            description="A teacher appears here once they complete the Hub profile step."
          />
        ) : (
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y divide-border">
                {accounts.map((a) => (
                  <li key={a.clerk_user_id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-text">{a.full_name}</p>
                      <p className="truncate text-xs text-muted-text">
                        {a.email} · {a.resources_created} made · joined {shortDate(a.created_at)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {a.subscription_ends_at && (
                        <span className="text-xs text-muted-text">
                          until {shortDate(a.subscription_ends_at)}
                        </span>
                      )}
                      {/* The date, not the label — see the header. */}
                      {a.lapsed ? (
                        <Badge variant="danger">Lapsed</Badge>
                      ) : a.subscription_status === 'active' ? (
                        <Badge variant="success">Subscribed</Badge>
                      ) : a.subscription_status === 'trial' ? (
                        <Badge variant="info">Trial</Badge>
                      ) : (
                        <Badge variant="warning">{a.subscription_status}</Badge>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  )
}
