'use client'

/**
 * Onboarding state for one school — provisioning, checklist, verification.
 *
 * Spec: `Official Documentation/15 Super Admin and Platform/ONBOARDING.md`
 *       `Official Documentation/06 School and Tenant Management/SCHOOL_SETUP.md`
 *
 * Split out of `page.tsx`, which was already 723 lines before this existed — the same reason
 * `/admin/curriculum` keeps its extract panel in its own file.
 *
 * ## The unprovisioned banner comes first, and loudly
 *
 * A school whose Clerk organisation was never created looks completely normal on this screen: it
 * has a name, a tier, a pupil ceiling and an onboarding checklist. What it does not have is a
 * tenant key anybody can hold — `clerk_org_id` is still `pending_…`, so no school user can sign
 * into it and no invitation can be sent. Rendering that as an ordinary school page would leave an
 * operator wondering for a week why the owner never got their email.
 */

import type { JSX } from 'react'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Check, CircleDashed, Mail, ShieldCheck, Trash2 } from 'lucide-react'

import { apiSend } from '../../../../lib/use-api'
import { Badge } from '../../../../components/ui/badge'
import { Button } from '../../../../components/ui/button'
import { Field, Textarea } from '../../../../components/ui/field'
import { FormActions, FormSection } from '../../../../components/ui/form'

export interface OnboardingRecord {
  source: string
  owner_first_name: string
  owner_last_name: string
  owner_email: string
  owner_phone_e164: string | null
  owner_invited_at: string | null
  owner_accepted_at: string | null
  internal_notes: string | null
  verified_at: string | null
  verified_by: string | null
  verification_note: string | null
  activated_at: string | null
}

export interface ChecklistItem {
  item_key: string
  label: string
  description: string
  category: string
  weight: number
  blocks: string | null
  isComplete: boolean
  completedAt: string | null
  hasRow: boolean
}

export interface Progress {
  completion_pct: number
  critical_pct: number
  items_complete: number
  items_total: number
}

const CATEGORY_LABEL: Record<string, string> = {
  critical: 'Critical',
  important: 'Important',
  optional: 'Optional',
}

export function OnboardingPanel({
  schoolId,
  schoolCode,
  status,
  isProvisioned,
  onboarding,
  checklist,
  progress,
  onChanged,
}: {
  schoolId: string
  schoolCode: string
  status: string
  isProvisioned: boolean
  onboarding: OnboardingRecord | null
  checklist: ChecklistItem[]
  progress: Progress | null
  onChanged: () => void
}): JSX.Element {
  const router = useRouter()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (
    label: string,
    fn: () => Promise<{ error: string | null }>,
    after?: () => void,
  ): Promise<void> => {
    setBusy(label)
    setError(null)
    const result = await fn()
    setBusy(null)
    if (result.error) {
      setError(result.error)
      return
    }
    if (after) after()
    else onChanged()
  }

  const byCategory = (category: string): ChecklistItem[] =>
    checklist.filter((i) => i.category === category)

  return (
    <div className="space-y-cards">
      {!isProvisioned && (
        <div
          role="alert"
          className="rounded-lg border border-danger/30 bg-danger/5 p-card text-sm"
        >
          <p className="flex items-start gap-2 font-medium text-danger">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            This school has no Clerk organisation
          </p>
          <p className="mt-2 text-muted-foreground">
            The identifier <span className="font-mono">{schoolCode}</span> is reserved and the
            record exists, but provisioning did not finish. Nobody can sign in to it, no invitation
            can be sent, and it cannot be activated. Retry, or discard it and start again — the
            identifier is spent either way, so the next school will take the following number.
          </p>
          <div className="mt-stack flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={() =>
                void run('retry', () =>
                  apiSend(`/api/admin/schools/${schoolId}/provisioning`, 'POST', {}),
                )
              }
            >
              {busy === 'retry' ? 'Retrying…' : 'Retry provisioning'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => {
                const confirmed = window.confirm(
                  `Discard ${schoolCode}?\n\n` +
                    'The school record and its checklist are removed. This is only possible ' +
                    'because nobody has ever been able to write to it. The identifier is not reused.',
                )
                if (!confirmed) return
                void run(
                  'discard',
                  () => apiSend(`/api/admin/schools/${schoolId}/provisioning`, 'DELETE', {}),
                  () => router.push('/admin/schools'),
                )
              }}
            >
              <Trash2 aria-hidden="true" />
              {busy === 'discard' ? 'Discarding…' : 'Discard'}
            </Button>
          </div>
        </div>
      )}

      <FormSection
        title="Onboarding"
        description={
          onboarding
            ? `${onboarding.source === 'self_registration' ? 'Self-registered' : 'Created by AfriTech'}. Setup progress drives the health indicator.`
            : 'This school predates the onboarding record, so there is no owner contact or verification history for it.'
        }
        actions={
          progress && (
            <div className="flex items-center gap-2">
              <Badge variant={progress.completion_pct >= 80 ? 'success' : 'warning'}>
                {progress.completion_pct}% complete
              </Badge>
              {/* Critical progress separately, because they are different situations: a school
                  at 45% with every critical item done is ready to use, and one at 45% that has
                  only uploaded a logo cannot take a register. */}
              <Badge variant="neutral">{progress.critical_pct}% of critical</Badge>
            </div>
          )
        }
      >
        {progress && (
          <div className="mb-stack">
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={progress.completion_pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Onboarding completion"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${progress.completion_pct}%` }}
              />
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              <span data-numeric>{progress.items_complete}</span> of{' '}
              <span data-numeric>{progress.items_total}</span> steps done.
            </p>
          </div>
        )}

        <div className="space-y-stack">
          {(['critical', 'important', 'optional'] as const).map((category) => {
            const items = byCategory(category)
            if (items.length === 0) return null
            return (
              <div key={category}>
                <h3 className="mb-2 text-sm font-medium text-muted-foreground">
                  {CATEGORY_LABEL[category]}
                </h3>
                <ul className="divide-y divide-border rounded-md border border-border">
                  {items.map((item) => (
                    <li key={item.item_key} className="flex items-start gap-3 p-3">
                      {item.isComplete ? (
                        <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
                      ) : (
                        <CircleDashed
                          aria-hidden="true"
                          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">
                          {item.label}
                          <span className="sr-only">
                            {item.isComplete ? ' — done' : ' — outstanding'}
                          </span>
                        </p>
                        <p className="text-sm text-muted-foreground">{item.description}</p>
                        {!item.isComplete && item.blocks && (
                          <p className="mt-1 text-sm text-warning">Blocks: {item.blocks}</p>
                        )}
                        {/* A school created before this item entered the catalogue has no row
                            for it. Worth distinguishing from "not done yet" — the fix is a
                            backfill, not a phone call. */}
                        {!item.hasRow && (
                          <p className="mt-1 text-sm text-muted-foreground">
                            No record — this school predates the step.
                          </p>
                        )}
                      </div>
                      <Badge variant="neutral">{item.weight}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      </FormSection>

      {onboarding && (
        <FormSection
          title="The owner"
          description="Recorded when the school was created. Held here until they accept — a staff record needs a signed-in account."
        >
          <dl className="grid grid-cols-1 gap-stack sm:grid-cols-2">
            <div>
              <dt className="text-sm text-muted-foreground">Name</dt>
              <dd className="text-sm">
                {onboarding.owner_first_name} {onboarding.owner_last_name}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Email</dt>
              <dd className="text-sm">{onboarding.owner_email}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Phone</dt>
              <dd className="text-sm">{onboarding.owner_phone_e164 ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Invitation</dt>
              <dd className="flex items-center gap-2 text-sm">
                {onboarding.owner_accepted_at ? (
                  <Badge variant="success">Accepted</Badge>
                ) : onboarding.owner_invited_at ? (
                  <>
                    <Mail aria-hidden="true" className="size-4 text-muted-foreground" />
                    <Badge variant="warning">Awaiting acceptance</Badge>
                  </>
                ) : (
                  <Badge variant="danger">Never sent</Badge>
                )}
              </dd>
            </div>
          </dl>

          {onboarding.internal_notes && (
            <div className="mt-stack rounded-md border border-border bg-muted/40 p-3">
              <p className="text-sm font-medium">Internal notes</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                {onboarding.internal_notes}
              </p>
            </div>
          )}
        </FormSection>
      )}

      {/* Activation, or the record of it. Only `pending_verification` can be activated this way —
          a trial converting to paid is a subscription event, not a verification one. */}
      {status === 'pending_verification' ? (
        <FormSection
          title="Verify and activate"
          description="Call the school, confirm the details are real, and write down what you were told. The note is the record — an activation without one proves nothing."
        >
          <Field
            id="verification-note"
            label="What the call established"
            required
            hint="Who you spoke to, what they confirmed. A couple of sentences."
          >
            {(props) => (
              <Textarea
                {...props}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="Spoke to Grace Mwale on +260977123456. Confirmed the school operates at Plot 1234 Great East Road, roughly 340 pupils, registered with the Ministry as MOE/2019/4471."
              />
            )}
          </Field>

          <FormActions>
            <Button
              disabled={note.trim().length < 10 || busy !== null || !isProvisioned}
              onClick={() =>
                void run('activate', () =>
                  apiSend(`/api/admin/schools/${schoolId}/activate`, 'POST', {
                    verificationNote: note.trim(),
                  }),
                )
              }
            >
              <ShieldCheck aria-hidden="true" />
              {busy === 'activate' ? 'Activating…' : 'Activate school'}
            </Button>
            {!isProvisioned && (
              <span className="text-sm text-muted-foreground">
                Finish provisioning first — an active school nobody can sign into is worse than a
                pending one.
              </span>
            )}
          </FormActions>
        </FormSection>
      ) : (
        onboarding?.verification_note && (
          <FormSection title="Verification">
            <p className="whitespace-pre-wrap text-sm">{onboarding.verification_note}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Recorded by {onboarding.verified_by ?? 'unknown'}
              {onboarding.verified_at
                ? ` on ${new Date(onboarding.verified_at).toLocaleDateString()}`
                : ''}
              .
            </p>
          </FormSection>
        )
      )}

      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
    </div>
  )
}
