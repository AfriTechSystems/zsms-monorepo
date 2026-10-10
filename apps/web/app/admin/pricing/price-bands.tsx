'use client'

/**
 * Per-student pricing: the model switch, and the bands underneath it.
 *
 * Spec: `Official Documentation/17 Integration and Pricing/PRICING.md`
 *
 * ## Why this screen did not exist until now
 *
 * `0124` built per-student pricing completely — the model flag, the bands, an overlap-rejection
 * trigger, a charge function that returns NULL and a reason rather than a misleading zero. What it
 * never got was any way to turn on, so every tier has sat on `flat` since, and the pricing model
 * intended for most schools was reachable only by hand-written SQL against the database.
 *
 * ## Two states this screen has to say out loud
 *
 * **Per-student with no bands.** Allowed — you must pick the model before a band form means
 * anything — and safe, because `school_subscription_charge()` reports such a school as unpriced
 * rather than billing it zero. But it is invisible unless said, so it is said.
 *
 * **No open-ended top band.** A tier whose highest band stops at 500 leaves a school of 501 pupils
 * unpriced the day it grows. That is a silent revenue hole, and the only warning anybody would
 * otherwise get is an invoice that failed to generate.
 */

import type { JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Plus, TriangleAlert, Trash2 } from 'lucide-react'

import { Alert } from '../../../components/ui/alert'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card'
import { Field, Input } from '../../../components/ui/field'
import { useToast } from '../../../components/ui/toast'

export interface Band {
  id: string
  tier_name: string
  min_students: number
  max_students: number | null
  price_per_student_zmw: string | number
  price_per_student_usd: string | number
}

const num = (v: string | number): number => (typeof v === 'string' ? Number(v) : v)

export function PriceBands({
  tierName,
  displayName,
  pricingModel,
  bands,
  onChanged,
}: {
  tierName: string
  displayName: string
  pricingModel: string
  bands: Band[]
  onChanged: () => void
}): JSX.Element {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<{ min: string; max: string; zmw: string; usd: string } | null>(
    null,
  )

  const perStudent = pricingModel === 'per_student'
  const sorted = [...bands].sort((a, b) => a.min_students - b.min_students)
  // The open-ended top band. Without one, a school that grows past the highest band stops being
  // priceable — which nobody notices until an invoice does not generate.
  const hasOpenTop = sorted.some((b) => b.max_students === null)

  const send = useCallback(
    async (method: string, body: unknown, successMessage: string): Promise<void> => {
      setBusy(true)
      try {
        const response = await fetch('/api/admin/price-bands', {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const payload = (await response.json()) as { error?: string }
        toast(
          response.ok ? successMessage : (payload.error ?? 'That did not work.'),
          response.ok ? 'success' : 'danger',
        )
        if (response.ok) onChanged()
      } catch {
        toast('Could not reach the server.', 'danger')
      }
      setBusy(false)
    },
    [onChanged, toast],
  )

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Per-student pricing</CardTitle>
          <CardDescription>
            {perStudent
              ? `${displayName} is billed per pupil, at the rate for the band its roll falls in.`
              : `${displayName} is billed at a flat monthly price, whatever its roll.`}
          </CardDescription>
        </div>
        <Button
          size="sm"
          variant={perStudent ? 'outline' : 'default'}
          disabled={busy}
          onClick={() =>
            void send(
              'PATCH',
              { tierName, pricingModel: perStudent ? 'flat' : 'per_student' },
              perStudent ? 'Switched to a flat price.' : 'Switched to per-pupil pricing.',
            )
          }
        >
          {perStudent ? 'Switch to flat pricing' : 'Switch to per-pupil pricing'}
        </Button>
      </CardHeader>

      {perStudent && (
        <CardContent className="space-y-4">
          {bands.length === 0 && (
            <Alert variant="warning" title="No bands yet — schools on this tier cannot be billed">
              A per-pupil tier with no bands has no price. ZSMS will report such a school as
              unpriced rather than billing it nothing, so no money is lost silently — but no
              invoice can be raised either. Add a band below.
            </Alert>
          )}

          {bands.length > 0 && !hasOpenTop && (
            <Alert variant="warning" title="No band covers the largest schools">
              The highest band stops at{' '}
              {Math.max(...sorted.map((b) => b.max_students ?? 0))} pupils. A school that grows past
              that becomes unpriceable the day it does, and the first sign would be an invoice that
              did not generate. Leave one band&apos;s upper limit blank to mean “and above”.
            </Alert>
          )}

          <ul className="divide-y divide-border">
            {sorted.map((band) => (
              <li key={band.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium text-text">
                    {band.min_students}–{band.max_students ?? '∞'} pupils
                    {band.max_students === null && (
                      <Badge variant="info" className="ml-2">
                        and above
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-text">
                    K{num(band.price_per_student_zmw).toFixed(2)} · $
                    {num(band.price_per_student_usd).toFixed(2)} per pupil
                    {' · '}
                    {/* The number a person actually wants: what a school at the bottom of this
                        band pays. A per-pupil rate alone is hard to sanity-check. */}
                    a school of {band.min_students} pays K
                    {(band.min_students * num(band.price_per_student_zmw)).toLocaleString('en-GB')}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void send('DELETE', { bandId: band.id }, 'Band removed.')}
                >
                  <Trash2 className="size-4" aria-hidden />
                  Remove
                </Button>
              </li>
            ))}
          </ul>

          {draft ? (
            <div className="space-y-3 rounded-lg border border-border p-4">
              <div className="grid gap-3 sm:grid-cols-4">
                <Field id={`min-${tierName}`} label="From (pupils)" required>
                  {(props) => (
                    <Input
                      {...props}
                      type="number"
                      min={1}
                      value={draft.min}
                      onChange={(e) => setDraft({ ...draft, min: e.target.value })}
                    />
                  )}
                </Field>
                <Field
                  id={`max-${tierName}`}
                  label="To (pupils)"
                  hint="Blank means “and above”."
                >
                  {(props) => (
                    <Input
                      {...props}
                      type="number"
                      min={1}
                      value={draft.max}
                      onChange={(e) => setDraft({ ...draft, max: e.target.value })}
                    />
                  )}
                </Field>
                <Field id={`zmw-${tierName}`} label="Per pupil (K)" required>
                  {(props) => (
                    <Input
                      {...props}
                      type="number"
                      step="0.01"
                      min={0}
                      value={draft.zmw}
                      onChange={(e) => setDraft({ ...draft, zmw: e.target.value })}
                    />
                  )}
                </Field>
                <Field id={`usd-${tierName}`} label="Per pupil ($)" required>
                  {(props) => (
                    <Input
                      {...props}
                      type="number"
                      step="0.01"
                      min={0}
                      value={draft.usd}
                      onChange={(e) => setDraft({ ...draft, usd: e.target.value })}
                    />
                  )}
                </Field>
              </div>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={busy || !draft.min || !draft.zmw || !draft.usd}
                  onClick={() => {
                    void send(
                      'POST',
                      {
                        tierName,
                        minStudents: Number(draft.min),
                        // Empty means the open-ended top band, not a missing value.
                        maxStudents: draft.max === '' ? null : Number(draft.max),
                        pricePerStudentZmw: Number(draft.zmw),
                        pricePerStudentUsd: Number(draft.usd),
                      },
                      'Band added.',
                    )
                    setDraft(null)
                  }}
                >
                  Add band
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
              </div>

              <p className="text-xs text-muted-text">
                <TriangleAlert className="mr-1 inline size-3" aria-hidden />
                Bands may not overlap. If one does, the database refuses it and names the band it
                collides with.
              </p>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDraft({ min: '', max: '', zmw: '', usd: '' })}
            >
              <Plus className="size-4" aria-hidden />
              Add a band
            </Button>
          )}
        </CardContent>
      )}
    </Card>
  )
}

/** Fetches every band once and hands each tier its own. */
export function usePriceBands(): { byTier: Record<string, Band[]>; reload: () => void } {
  const [byTier, setByTier] = useState<Record<string, Band[]>>({})

  const reload = useCallback(() => {
    void fetch('/api/admin/price-bands')
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { data?: { bands?: Band[] } } | null) => {
        const bands = body?.data?.bands ?? []
        const grouped: Record<string, Band[]> = {}
        for (const band of bands) {
          grouped[band.tier_name] = [...(grouped[band.tier_name] ?? []), band]
        }
        setByTier(grouped)
      })
      // A pricing screen that refuses to render because the band list failed would be worse than
      // one showing no bands. The tier editors above it still work.
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  return { byTier, reload }
}
