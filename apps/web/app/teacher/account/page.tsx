'use client'

/**
 * Account — profile, plan, and subscription.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md`
 *
 * ## There is no Subscribe button, and that is deliberate rather than unfinished
 *
 * Payment is recorded by hand: mobile money and an AfriTech bank account exist, an
 * integrated gateway does not. A "Subscribe" button that a teacher could press would either
 * lie about taking a payment or grant a paid subscription for nothing —
 * `teacher_hub_activate_subscription()` refuses anybody who is not AfriTech, and the pgTAP
 * suite asserts it. So this screen shows what to pay and where, and AfriTech confirms the
 * money arrived.
 *
 * When a gateway is wired, the payment-instruction card becomes a checkout and nothing else
 * here changes.
 *
 * ## Cancelling says the one thing a teacher actually worries about
 *
 * Not "are you sure" — whether the work disappears. It does not, ever. That sentence is more
 * important than the confirmation.
 */

import type { JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'

import { Alert } from '../../../components/ui/alert'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card'
import { Field, Input } from '../../../components/ui/field'
import { ErrorState, PageHeader, StatSkeleton } from '../../../components/ui/data-states'
import { useToast } from '../../../components/ui/toast'
import {
  CURRICULUM_LABELS,
  PlanBadge,
  hubFetch,
  money,
  shortDate,
  type HubPayload,
  type HubPlan,
} from '../hub-shared'

/**
 * The plan line under the heading. A function rather than a nested ternary in the JSX: the
 * trial has no price to render and no period to render it per, so the two cases genuinely
 * differ rather than differing by one word.
 */
function planSummary(plan: HubPlan | undefined, fallbackCode: string): string {
  if (!plan) return fallbackCode
  if (plan.billing_period === 'none') {
    return plan.included_resources === null
      ? plan.display_name
      : `${plan.display_name} — ${plan.included_resources} resources, free`
  }
  const period = plan.billing_period === 'monthly' ? 'month' : 'year'
  return `${plan.display_name} — ${money(plan.price, plan.currency_code)} per ${period}`
}

export default function AccountPage(): JSX.Element {
  const { toast } = useToast()
  const [hub, setHub] = useState<HubPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: loadError } = await hubFetch<HubPayload>('/api/teacher/hub')
    if (loadError) {
      setError(loadError)
      setLoading(false)
      return
    }
    setError(null)
    setHub(data)
    setFullName(data?.account?.full_name ?? '')
    setPhone(data?.account?.phone_e164 ?? '')
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const saveProfile = async (): Promise<void> => {
    setSaving(true)
    const { error: saveError } = await hubFetch('/api/teacher/hub', {
      method: 'PATCH',
      body: JSON.stringify({
        fullName,
        ...(phone.trim() ? { phoneE164: phone.trim() } : {}),
      }),
    })
    setSaving(false)
    if (saveError) {
      toast(saveError, 'danger')
      return
    }
    toast('Profile updated.', 'success')
    void load()
  }

  const cancel = async (): Promise<void> => {
    setCancelling(true)
    const { data, error: cancelError } = await hubFetch<{ accessUntil: string | null }>(
      '/api/teacher/hub/subscription',
      { method: 'DELETE' },
    )
    setCancelling(false)
    setConfirmCancel(false)
    if (cancelError) {
      toast(cancelError, 'danger')
      return
    }
    toast(
      data?.accessUntil
        ? `Cancelled. You can keep creating until ${shortDate(data.accessUntil)}.`
        : 'Cancelled.',
      'success',
    )
    void load()
  }

  if (loading) return <StatSkeleton count={3} />
  if (error) return <ErrorState message={error} onRetry={() => void load()} />

  const account = hub?.account
  const entitlement = hub?.entitlement
  const currentPlan = hub?.plans.find((p) => p.plan_code === account?.plan_code)
  // The trial is a plan row, so it must not appear as something to buy.
  const purchasable = (hub?.plans ?? []).filter((p) => p.billing_period !== 'none')

  if (!account) {
    return (
      <>
        <PageHeader title="Account" backTo="/teacher" backLabel="Teacher Hub" />
        <ErrorState
          message="Set up your Teacher Hub profile first."
          onRetry={() => void load()}
        />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Account"
        description={account.email}
        backTo="/teacher"
        backLabel="Teacher Hub"
        actions={<PlanBadge entitlement={entitlement ?? null} />}
      />

      <div className="space-y-cards">
        <Card>
          <CardHeader>
            <CardTitle>Your plan</CardTitle>
            <CardDescription>{planSummary(currentPlan, account.plan_code)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-text">Status</dt>
                <dd className="mt-1 text-sm font-medium text-text">
                  {account.subscription_status === 'trial'
                    ? 'Free trial'
                    : account.subscription_status.charAt(0).toUpperCase() +
                      account.subscription_status.slice(1)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-text">
                  {account.subscription_status === 'trial' ? 'Free resources left' : 'Runs until'}
                </dt>
                <dd className="mt-1 text-sm font-medium text-text">
                  {account.subscription_status === 'trial'
                    ? `${entitlement?.remaining ?? 0} of ${entitlement?.allowance ?? 0}`
                    : shortDate(account.subscription_ends_at)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-text">Resources made</dt>
                <dd className="mt-1 text-sm font-medium text-text">{account.resources_created}</dd>
              </div>
            </dl>

            {/*
              The promise, stated on the screen where it matters rather than only in a
              cancellation dialogue. This is the single most reassuring true fact about the
              product and it costs one sentence.
            */}
            <Alert variant="info" title="Your library is permanent">
              Whatever happens to your subscription, everything you have made stays readable.
              Only creating new resources depends on your plan.
            </Alert>
          </CardContent>
        </Card>

        {purchasable.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>
                {account.subscription_status === 'active' ? 'Other plans' : 'Subscribe'}
              </CardTitle>
              <CardDescription>
                Unlimited lesson plans, quizzes and homework.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                {purchasable.map((p) => (
                  <div
                    key={p.plan_code}
                    className={
                      p.plan_code === account.plan_code && account.subscription_status === 'active'
                        ? 'rounded-lg border-2 border-primary bg-primary-tint/30 p-4'
                        : 'rounded-lg border border-border p-4'
                    }
                  >
                    <div className="flex items-baseline justify-between">
                      <h3 className="font-semibold text-text">{p.display_name}</h3>
                      {p.plan_code === account.plan_code &&
                        account.subscription_status === 'active' && (
                          <Badge variant="success">Current</Badge>
                        )}
                    </div>
                    <p className="mt-1 text-2xl font-semibold text-text">
                      {money(p.price, p.currency_code)}
                      <span className="text-sm font-normal text-muted-text">
                        {p.billing_period === 'monthly' ? ' / month' : ' / year'}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-muted-text">
                      {p.included_resources === null
                        ? 'Unlimited resources'
                        : `${p.included_resources} resources`}
                    </p>
                  </div>
                ))}
              </div>

              <Alert variant="info" title="How to pay">
                <p>
                  Send your payment to AfriTech Systems by mobile money or bank transfer, using
                  your email address <strong>{account.email}</strong> as the reference. We
                  activate your subscription as soon as it arrives, usually the same working
                  day.
                </p>
                <p className="mt-2 text-xs">
                  Card and in-app mobile money checkout are coming; until then this is the
                  honest path rather than a button that cannot take your money.
                </p>
              </Alert>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Your details</CardTitle>
            <CardDescription>
              {account.subjects.length > 0 ? account.subjects.join(', ') : 'No subjects set'} ·{' '}
              {account.grade_levels.length > 0
                ? account.grade_levels.join(', ')
                : 'No grades set'}{' '}
              ·{' '}
              {account.curriculum_types.map((c) => CURRICULUM_LABELS[c] ?? c).join(', ')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="account-name" label="Your name" required>
                {(props) => (
                  <Input {...props} value={fullName} onChange={(e) => setFullName(e.target.value)} />
                )}
              </Field>
              <Field id="account-phone" label="Phone" hint="International format, e.g. +260971234567.">
                {(props) => (
                  <Input {...props} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
                )}
              </Field>
            </div>
            {/*
              Email is absent on purpose: Clerk owns it, it is how the teacher signs in, and a
              second editable copy here would drift from the real one.
            */}
            <Button onClick={() => void saveProfile()} disabled={saving || fullName.trim().length < 2} size="sm">
              {saving ? 'Saving…' : 'Save details'}
            </Button>
          </CardContent>
        </Card>

        {account.subscription_status === 'active' && (
          <Card>
            <CardHeader>
              <CardTitle>Cancel subscription</CardTitle>
              <CardDescription>
                You keep creating until{' '}
                {shortDate(account.subscription_ends_at)}, and your library stays readable for
                good.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {confirmCancel ? (
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="outline" size="sm" onClick={() => void cancel()} disabled={cancelling}>
                    {cancelling ? 'Cancelling…' : 'Yes, cancel it'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmCancel(false)}>
                    Keep my subscription
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setConfirmCancel(true)}>
                  Cancel subscription
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  )
}
