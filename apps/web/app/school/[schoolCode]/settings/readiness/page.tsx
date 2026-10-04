'use client'

/**
 * Setup checklist — what is done, what is left, and what each gap costs.
 *
 * Spec: `Official Documentation/15 Super Admin and Platform/ONBOARDING.md`
 *       `Official Documentation/06 School and Tenant Management/SCHOOL_SETUP.md`
 *
 * ## Two ways an item becomes done
 *
 * Most of the list is **worked out from the school's own records** — are there grade
 * levels, a fee structure, a first pupil — and ticks itself as the school works. Nobody
 * maintains it, and it cannot drift away from the truth.
 *
 * The rest is **signed off by a person, with a reason**. That exists because the data
 * cannot see everything: AfriTech is sometimes paid to do a school's setup, a school may
 * run fees in an accounting package so a ZSMS fee structure is never coming, and some
 * work — training, migration, telling parents — leaves no row in any table.
 *
 * **Both answers are shown.** A signed-off item still reports what the data found, so
 * the screen reads "your records still show this as not done · signed off by the school
 * on 4 Oct — they use Sage". That is the difference between a judgement and a lie.
 *
 * ## It will not reach 100% yet, and says so
 *
 * Several items depend on features still being built. Rather than hide them, the page
 * states it — a checklist that silently omitted the unfinished parts of the product
 * would tell a school it was ready when it was not.
 */

import type { JSX } from 'react'
import { useCallback, useState } from 'react'
import { Circle, CircleCheck, Info, PenLine, Undo2 } from 'lucide-react'

import { Alert } from '../../../../../components/ui/alert'
import { Badge } from '../../../../../components/ui/badge'
import { Button } from '../../../../../components/ui/button'
import { Card, CardContent } from '../../../../../components/ui/card'
import { ErrorState, PageHeader, TableSkeleton } from '../../../../../components/ui/data-states'
import { Field, Input } from '../../../../../components/ui/field'
import { useToast } from '../../../../../components/ui/toast'
import { apiSend, useApi } from '../../../../../lib/use-api'

interface Item {
  out_item_key: string
  out_label: string
  out_description: string | null
  out_category: string
  out_blocks: string | null
  out_complete: boolean
  out_from_data: boolean
  out_overridden: boolean
  out_reason: string | null
  out_by_role: string | null
  out_at: string | null
  out_derived: boolean
}

interface Payload {
  items: Item[]
  complete: number
  total: number
  percent: number
}

const CATEGORY_LABEL: Record<string, string> = {
  critical: 'Needed to use ZSMS',
  important: 'Worth doing soon',
  optional: 'When you get to it',
}

const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export default function ReadinessPage(): JSX.Element {
  const { data, loading, error, code, reload } = useApi<Payload>('/api/school/onboarding')
  const { toast } = useToast()

  const [signingOff, setSigningOff] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = useCallback(
    async (itemKey: string, override: boolean, why?: string) => {
      setBusy(true)
      try {
        const result = await apiSend('/api/school/onboarding', 'POST', {
          itemKey,
          override,
          reason: why,
        })
        if (result.error) {
          toast(result.error, 'danger')
          return
        }
        setSigningOff(null)
        setReason('')
        reload()
      } finally {
        setBusy(false)
      }
    },
    [toast, reload],
  )

  if (loading) return <TableSkeleton rows={8} columns={2} />
  if (error) return <ErrorState message={error} code={code} onRetry={reload} />
  if (!data) return <ErrorState message="No checklist to show." onRetry={reload} />

  return (
    <>
      <PageHeader
        title="Setup checklist"
        description="What is in place, what is outstanding, and what each gap stops you doing."
        note="Most of this is worked out from your own records and ticks itself as you go. Anything we cannot see — or that you handle outside ZSMS — can be signed off with a reason, by you or by AfriTech."
      />

      <Card className="mb-cards">
        <CardContent className="flex flex-col gap-stack pt-card">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-lg font-semibold">
              <span data-numeric>{data.complete}</span> of{' '}
              <span data-numeric>{data.total}</span> done
            </p>
            <p data-numeric className="text-2xl font-semibold text-primary-text">
              {data.percent}%
            </p>
          </div>

          <div
            className="h-2 w-full overflow-hidden rounded-full bg-sunken"
            role="progressbar"
            aria-valuenow={data.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Setup progress"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500"
              style={{ width: `${data.percent}%` }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Said plainly rather than left for a school to wonder about. Some of these
          depend on parts of ZSMS still being built, and a checklist that quietly
          omitted them would tell a school it was ready when it was not. */}
      <Alert variant="info" title="This list will grow" className="mb-cards">
        Some items cover features we are still building — WhatsApp delivery and online
        payments among them. They stay on the list so you can see what is coming, and we
        add to it as each one ships.
      </Alert>

      {(['critical', 'important', 'optional'] as const).map((category) => {
        const items = data.items.filter((i) => i.out_category === category)
        if (items.length === 0) return null

        return (
          <section key={category} className="mb-cards">
            <h2 className="mb-2 text-sm font-medium text-muted-foreground">
              {CATEGORY_LABEL[category] ?? category}
            </h2>

            <ul className="divide-y divide-border rounded-md border border-border">
              {items.map((item) => (
                <li key={item.out_item_key} className="flex flex-col gap-2 p-card">
                  <div className="flex items-start gap-3">
                    {item.out_complete ? (
                      <CircleCheck
                        aria-hidden="true"
                        className="mt-0.5 size-5 shrink-0 text-success"
                      />
                    ) : (
                      <Circle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-subtle" />
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {item.out_label}
                        <span className="sr-only">
                          {item.out_complete ? ' — done' : ' — outstanding'}
                        </span>
                      </p>
                      {item.out_description && (
                        <p className="text-sm text-muted-foreground">{item.out_description}</p>
                      )}

                      {/* What it costs, which is what makes somebody act today rather
                          than nod at a chore. */}
                      {!item.out_complete && item.out_blocks && (
                        <Badge variant="warning" className="mt-1">
                          Blocks {item.out_blocks.toLowerCase()}
                        </Badge>
                      )}

                      {/* Both answers, always. A sign-off adds a human judgement; it
                          does not replace what the records show. */}
                      {item.out_overridden && (
                        <div className="mt-2 rounded-md border border-border bg-sunken p-stack">
                          <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                            <PenLine aria-hidden="true" className="size-4 text-primary-text" />
                            Signed off by{' '}
                            {item.out_by_role === 'afritech' ? 'AfriTech' : 'the school'}
                            {item.out_at && (
                              <span className="font-normal text-muted-foreground">
                                on {shortDate(item.out_at)}
                              </span>
                            )}
                          </p>
                          {item.out_reason && (
                            <p className="mt-0.5 text-sm text-muted-foreground">
                              &ldquo;{item.out_reason}&rdquo;
                            </p>
                          )}
                          {item.out_derived && !item.out_from_data && (
                            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                              <Info aria-hidden="true" className="size-3.5 shrink-0" />
                              Your records still show this as not done.
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {item.out_overridden ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => void submit(item.out_item_key, false)}
                      >
                        <Undo2 aria-hidden="true" />
                        Undo
                      </Button>
                    ) : (
                      /* Offered only where the data has not already answered. Signing
                         off something the records show as done is noise. */
                      !item.out_from_data && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            setSigningOff(item.out_item_key)
                            setReason('')
                          }}
                        >
                          Sign off
                        </Button>
                      )
                    )}
                  </div>

                  {signingOff === item.out_item_key && (
                    <div className="flex flex-col gap-2 rounded-md border border-border p-stack">
                      <Field
                        id={`reason-${item.out_item_key}`}
                        label="Why is this done?"
                        required
                        hint="Kept against the item, so whoever reads it later knows. For example: handled in our accounting package."
                      >
                        {(props) => (
                          <Input
                            {...props}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            maxLength={500}
                          />
                        )}
                      </Field>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          disabled={busy || reason.trim().length === 0}
                          onClick={() => void submit(item.out_item_key, true, reason.trim())}
                        >
                          {busy ? 'Saving…' : 'Sign off'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => setSigningOff(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </>
  )
}
