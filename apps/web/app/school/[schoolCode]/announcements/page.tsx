'use client'

/**
 * Announcements — tell parents, pupils or staff something.
 *
 * Spec: `Official Documentation/12 Communication System/ANNOUNCEMENTS.md`
 *
 * ## The word is "queued", never "sent"
 *
 * Nothing leaves in this request. Pressing send hands the announcement to a
 * background worker, and on a machine with no Redis and no provider credentials
 * that worker never runs — so the screen says so plainly. The failure this
 * avoids is specific and bad: a head teacher who believes 300 parents were told
 * about a closure, when nothing went out, does not follow up.
 *
 * ## How many people, before pressing send
 *
 * WhatsApp is metered per tier. "All parents" at a 250-pupil school is a real
 * cost and a real intrusion, so the recipient count sits next to the audience
 * control rather than being discovered afterwards. Parents are counted once
 * regardless of how many children they have — counting links would overstate it
 * by exactly the number of siblings.
 *
 * ## Important is a deliberate choice, not a default
 *
 * `importance` drives whether a message escalates to WhatsApp for parents who
 * have not read it. Defaulting to "important" would make every notice urgent and
 * teach parents to ignore all of them, so regular is the default and the control
 * says what important actually does.
 */

import type { FormEvent, JSX } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { Gauge, Loader2, Megaphone, Send, X } from 'lucide-react'

import { apiSend, useApi } from '../../../../lib/use-api'
import { Alert } from '../../../../components/ui/alert'
import { Badge } from '../../../../components/ui/badge'
import { Button } from '../../../../components/ui/button'
import { Card, CardContent } from '../../../../components/ui/card'
import { DataTable } from '../../../../components/ui/data-table'
import { EmptyState } from '../../../../components/ui/empty-state'
import { ErrorState, PageHeader, TableSkeleton } from '../../../../components/ui/data-states'
import { DraftNotice } from '../../../../components/ui/draft-notice'
import { draftAge, useFormDraft } from '../../../../lib/use-form-draft'
import { useAuth } from '@zsms/auth-provider/react'
import { Field, Input, Select, Textarea } from '../../../../components/ui/field'
import { FormActions, FormGrid, FormSection } from '../../../../components/ui/form'
import { InfoHint } from '../../../../components/ui/info-hint'
import { useToast } from '../../../../components/ui/toast'
import { RecipientPicker } from './recipient-picker'
import { formatCount, formatDate } from '../school-shared'

interface Announcement {
  /** How many recipients have opened it. Counted from `announcement_reads`. */
  readCount?: number
  id: string
  title: string
  body: string
  importance: string
  target_audience: string
  target_scope: string
  target_ids: string[]
  status: string
  scheduled_at: string | null
  sent_at: string | null
  whatsapp_jobs_queued: number | null
  created_at: string
}

interface Payload {
  announcements: Announcement[]
  audience: { all_parents: number; all_students: number; all_staff: number }
  tier: string | null
  /**
   * The school's own messaging allowance.
   *
   * Null when no quota row exists yet — a school that has sent nothing. Distinguished
   * from zero remaining, because "you have used none of your allowance" and "we do not
   * know your allowance" are different things to put on a screen.
   */
  quota: { limit: number; used: number; remaining: number; overageCredits: number } | null
  canWrite: boolean
  deliveryConfigured: boolean
}

interface Structure {
  gradeLevels: Array<{ level_id: string; display_name: string }>
  classesByGrade: Record<string, string[]>
}

const AUDIENCE_LABEL: Record<string, string> = {
  parents: 'Parents',
  students: 'Pupils',
  staff: 'Staff',
  individuals: 'Named people',
  everyone: 'Everyone',
}

/**
 * The audience and the scope, read together.
 *
 * Rendering the derived `target_type` alone would show "Chosen grades" for both a
 * pupil notice and a parent notice to the same grade — losing in the list exactly
 * the distinction the two columns exist to make.
 */
function describeTarget(audience: string, scope: string, ids: string[]): string {
  const who = AUDIENCE_LABEL[audience] ?? audience
  if (scope === 'individual') {
    return `${who} — ${ids.length} chosen`
  }
  if (scope === 'school') return `${who} — whole school`
  if (scope === 'grade') return `${who} — ${ids.join(', ')}`
  if (scope === 'class') return `${who} — ${ids.join(', ')}`
  return who
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  draft: 'neutral',
  scheduled: 'warning',
  sending: 'info',
  sent: 'success',
  failed: 'danger',
  cancelled: 'neutral',
}

export default function AnnouncementsPage(): JSX.Element {
  const { toast } = useToast()

  const { data, loading, error, code, reload } = useApi<Payload>('/api/school/announcements')
  const structure = useApi<Structure>('/api/school/structure')

  const [title, setTitle] = useState('')
  const [bodyText, setBodyText] = useState('')
  const [importance, setImportance] = useState('regular')
  const [targetAudience, setTargetAudience] = useState('parents')
  const [targetScope, setTargetScope] = useState('school')
  const [targetIds, setTargetIds] = useState<string[]>([])
  const [scheduledAt, setScheduledAt] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  /**
   * An announcement is the longest thing anybody types in this product and the one most likely to
   * be interrupted — a head teacher drafting a fee-deadline notice gets called away mid-sentence.
   *
   * `targetIds` is deliberately NOT in the allowlist. It holds pupil and staff identifiers, which
   * is a list of who a notice was going to be about; a draft restoring stale recipients silently
   * is worse than retyping them, and it is data with no business sitting in a browser on a shared
   * office machine.
   */
  const { userId } = useAuth()
  const draft = useFormDraft({
    formId: 'announcement',
    userId,
    values: { title, bodyText, importance, targetAudience, targetScope, scheduledAt },
    fields: ['title', 'bodyText', 'importance', 'targetAudience', 'targetScope', 'scheduledAt'],
    enabled: busy === null,
  })

  /**
   * Destructured because `draft` is a fresh object each render, so depending on it would rebuild
   * the submit callback every keystroke. `clear` is useCallback-wrapped inside the hook and is
   * therefore a stable reference — which is what `exhaustive-deps` wants, and it is right to want
   * it: a missing dependency here is a stale closure holding an old storage key.
   */
  const { clear: clearDraft } = draft

  const grades = structure.data?.gradeLevels ?? []

  const isIndividual = targetAudience === 'individuals'
  const needsGradeOrClass = !isIndividual && (targetScope === 'grade' || targetScope === 'class')

  // The cascade: choosing a grade narrows the class list to that grade's classes.
  // Without it a "class" notice offers every class in the school, which at a
  // combined primary-and-secondary school is a list nobody can scan.
  const [narrowGrade, setNarrowGrade] = useState('')
  const classesForScope = useMemo(() => {
    const byGrade = structure.data?.classesByGrade ?? {}
    if (narrowGrade) return (byGrade[narrowGrade] ?? []).slice().sort()
    return Object.values(byGrade).flat().sort()
  }, [structure.data, narrowGrade])

  // How many people this would reach. For a grade or class selection the exact
  // number needs a per-class roll, which this screen does not have — so it says
  // what it knows rather than inventing a figure.
  const reach = useMemo(() => {
    if (!data) return null
    if (isIndividual) return targetIds.length
    // Only for a whole-school send. A grade or class figure needs a per-class roll
    // this screen does not have, and a guess next to a WhatsApp cost is worse than
    // no number at all.
    if (targetScope !== 'school') return null
    if (targetAudience === 'parents') return data.audience.all_parents
    if (targetAudience === 'students') return data.audience.all_students
    if (targetAudience === 'staff') return data.audience.all_staff
    return null
  }, [data, targetAudience, targetScope, isIndividual, targetIds.length])

  const submit = useCallback(
    async (action: 'draft' | 'now' | 'schedule', event?: FormEvent) => {
      event?.preventDefault()
      setBusy(action)
      setFormError(null)

      const result = await apiSend<{ queued: boolean }>('/api/school/announcements', 'POST', {
        title,
        body: bodyText,
        importance,
        targetAudience,
        targetScope: isIndividual ? 'individual' : targetScope,
        targetIds: isIndividual || needsGradeOrClass ? targetIds : undefined,
        action,
        scheduledAt:
          action === 'schedule' && scheduledAt
            ? new Date(scheduledAt).toISOString()
            : undefined,
      })

      setBusy(null)
      if (result.error) {
        setFormError(result.error)
        return
      }

      toast(
        action === 'draft'
          ? 'Saved as a draft. Nothing has gone out.'
          : data?.deliveryConfigured
            ? 'Queued for sending.'
            : // The honest message on a machine that cannot deliver.
              'Queued — but message delivery is not set up here, so it will not go out yet.',
        action !== 'draft' && !data?.deliveryConfigured ? 'danger' : 'success',
      )

      setTitle('')
      setBodyText('')
      setTargetIds([])
      setScheduledAt('')
      // Sent is not unfinished. Without this the form would offer to restore what was just
      // delivered to every parent in the school.
      clearDraft()
      reload()
    },
    [
      clearDraft,
      title,
      bodyText,
      importance,
      targetAudience,
      targetScope,
      isIndividual,
      needsGradeOrClass,
      targetIds,
      scheduledAt,
      data?.deliveryConfigured,
      toast,
      reload,
    ],
  )

  const cancel = useCallback(
    async (a: Announcement) => {
      const result = await apiSend('/api/school/announcements', 'PATCH', {
        id: a.id,
        action: 'cancel',
      })
      if (result.error) {
        setFormError(result.error)
        return
      }
      toast(`"${a.title}" cancelled.`)
      reload()
    },
    [toast, reload],
  )

  return (
    <>
      <PageHeader
        title="Announcements"
        description="Notices to parents, pupils, or staff."
        note="Sending hands the announcement to a background worker — it does not go out while you wait, and the list below shows what has actually happened to each one. Marking a notice important is what allows it to escalate to WhatsApp for parents who have not read it, so keep it for notices that genuinely cannot be missed."
      />

      {error && <ErrorState message={error} code={code} onRetry={reload} />}
      {loading && !data && !error && <TableSkeleton rows={5} columns={4} />}

      {!error && data && (
        <div className="space-y-cards">
          {/*
            What the school has left to send with.

            `school_message_quotas` has always held the limit, the usage and the 80% alert
            timestamp, and NOTHING read it — so a school could see that a notice would
            reach 250 parents without being able to see it had 40 messages left. WhatsApp
            is metered and billed, so that is the difference between a decision and a
            billing surprise.
          */}
          {data.quota && (
            <div
              className={
                'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border p-3 text-sm '
                + (data.quota.remaining === 0
                  ? 'border-danger/40 bg-danger/5'
                  : data.quota.remaining <= data.quota.limit * 0.2
                    ? 'border-warning/40 bg-warning/5'
                    : 'border-border bg-surface')
              }
            >
              <Gauge aria-hidden="true" className="size-4 text-muted-foreground" />
              <span>
                <span data-numeric className="font-semibold">
                  {data.quota.remaining.toLocaleString('en-ZM')}
                </span>{' '}
                of <span data-numeric>{data.quota.limit.toLocaleString('en-ZM')}</span> messages
                left this month
              </span>

              {data.quota.overageCredits > 0 && (
                // Overage is bought, not free — naming it stops a school reading the
                // remaining figure as the whole story.
                <span className="text-muted-foreground">
                  plus <span data-numeric>{data.quota.overageCredits}</span> bought
                </span>
              )}

              {data.quota.remaining === 0 && (
                <span className="font-medium text-danger">
                  Further messages will not be delivered until the allowance resets.
                </span>
              )}
            </div>
          )}

          {/* The single most important thing on this screen when it applies. */}
          {!data.deliveryConfigured && (
            <Alert variant="warning" title="Message delivery is not set up here">
              Announcements can be written, scheduled and queued, and everything below is real —
              but nothing will actually reach a parent from this environment. WhatsApp, SMS and
              email need provider credentials and a running queue, which arrive with the live
              deployment. Treat “queued” as exactly that.
            </Alert>
          )}

          {draft.pending && (
            <DraftNotice
              savedAgo={draftAge(draft.savedAt)}
              onRestore={() => {
                const d = draft.restore()
                if (!d) return
                if (typeof d.title === 'string') setTitle(d.title)
                if (typeof d.bodyText === 'string') setBodyText(d.bodyText)
                if (typeof d.importance === 'string') setImportance(d.importance)
                if (typeof d.targetAudience === 'string') setTargetAudience(d.targetAudience)
                if (typeof d.targetScope === 'string') setTargetScope(d.targetScope)
                if (typeof d.scheduledAt === 'string') setScheduledAt(d.scheduledAt)
              }}
              onDiscard={draft.discard}
            />
          )}

          {formError && (
            <Alert variant="danger" title="Not saved">
              {formError}
            </Alert>
          )}

          {data.canWrite ? (
            <FormSection title="Write an announcement">
              <form onSubmit={(e) => void submit('draft', e)} noValidate>
                <FormGrid columns={2}>
                  <Field id="a-title" label="Title" required hint="What it is about, in a line.">
                    {(props) => (
                      <Input
                        {...props}
                        value={title}
                        required
                        maxLength={160}
                        onChange={(e) => setTitle(e.target.value)}
                      />
                    )}
                  </Field>

                  <Field id="a-audience" label="Who it goes to" required>
                    {(props) => (
                      <Select
                        {...props}
                        value={targetAudience}
                        onChange={(e) => {
                          setTargetAudience(e.target.value)
                          // Audience and scope are independent, but changing the
                          // audience invalidates any chosen ids — grade ids and
                          // user ids are not interchangeable.
                          setTargetIds([])
                          setNarrowGrade('')
                          if (e.target.value === 'individuals') setTargetScope('individual')
                          else if (targetScope === 'individual') setTargetScope('school')
                        }}
                      >
                        <option value="parents">Parents</option>
                        <option value="students">Pupils</option>
                        <option value="staff">Staff</option>
                        <option value="individuals">Named people</option>
                      </Select>
                    )}
                  </Field>
                </FormGrid>

                {!isIndividual && (
                  <div className="mt-stack">
                    <FormGrid columns={3}>
                      <Field id="a-scope" label="How much of the school" required>
                        {(props) => (
                          <Select
                            {...props}
                            value={targetScope}
                            onChange={(e) => {
                              setTargetScope(e.target.value)
                              setTargetIds([])
                              setNarrowGrade('')
                            }}
                          >
                            <option value="school">The whole school</option>
                            <option value="grade">Chosen grades</option>
                            <option value="class">Chosen classes</option>
                          </Select>
                        )}
                      </Field>

                      {/* The cascade. Choosing a grade narrows the class list — at
                          a combined primary-and-secondary school the full list is
                          not scannable. */}
                      {targetScope === 'class' && (
                        <Field
                          id="a-narrow"
                          label="Narrow by grade"
                          hint="Optional. Leave blank to see every class."
                        >
                          {(props) => (
                            <Select
                              {...props}
                              value={narrowGrade}
                              onChange={(e) => {
                                setNarrowGrade(e.target.value)
                                setTargetIds([])
                              }}
                            >
                              <option value="">All grades</option>
                              {grades.map((g) => (
                                <option key={g.level_id} value={g.level_id}>
                                  {g.display_name}
                                </option>
                              ))}
                            </Select>
                          )}
                        </Field>
                      )}
                    </FormGrid>
                  </div>
                )}

                {reach !== null && (
                  <p className="mt-stack text-sm text-muted-foreground">
                    This would reach{' '}
                    <strong className="text-foreground">{formatCount(reach)}</strong>{' '}
                    {isIndividual
                      ? reach === 1
                        ? 'person'
                        : 'people'
                      : targetAudience === 'parents'
                        ? 'parents'
                        : targetAudience === 'students'
                          ? 'pupils'
                          : 'staff'}
                    .{' '}
                    {targetAudience === 'parents' && !isIndividual && (
                      <InfoHint label="how parents are counted">
                        A parent with three children is counted once. WhatsApp is charged per
                        message, so this is the number that matters for your plan rather than the
                        number of pupils.
                      </InfoHint>
                    )}
                  </p>
                )}

                {isIndividual && (
                  <div className="mt-stack">
                    <RecipientPicker selected={targetIds} onChange={setTargetIds} />
                  </div>
                )}

                {needsGradeOrClass && (
                  <fieldset className="mt-stack flex flex-col gap-1.5">
                    <legend className="text-sm font-medium text-foreground">
                      {targetScope === 'grade' ? 'Which grades' : 'Which classes'}
                      <span aria-hidden="true" className="text-danger"> *</span>
                    </legend>
                    <div className="flex flex-wrap gap-3 pt-1">
                      {(targetScope === 'grade'
                        ? grades.map((g) => ({ id: g.level_id, label: g.display_name }))
                        : // Narrowed by the chosen grade when one is set.
                          classesForScope.map((c) => ({ id: c, label: c }))
                      ).map((opt) => {
                        const on = targetIds.includes(opt.id)
                        return (
                          <label key={opt.id} className="flex min-h-tap items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() =>
                                setTargetIds((prev) =>
                                  on ? prev.filter((i) => i !== opt.id) : [...prev, opt.id],
                                )
                              }
                              className="size-4 rounded border-border text-primary focus-visible:ring-2 focus-visible:ring-ring"
                            />
                            {opt.label}
                          </label>
                        )
                      })}
                    </div>
                  </fieldset>
                )}

                <div className="mt-stack">
                  <Field id="a-body" label="Message" required>
                    {(props) => (
                      <Textarea
                        {...props}
                        rows={5}
                        value={bodyText}
                        required
                        maxLength={4000}
                        onChange={(e) => setBodyText(e.target.value)}
                      />
                    )}
                  </Field>
                </div>

                <FormGrid columns={2}>
                  <Field
                    id="a-importance"
                    label="Importance"
                    hint="Important notices can escalate to WhatsApp if unread."
                  >
                    {(props) => (
                      <Select
                        {...props}
                        value={importance}
                        onChange={(e) => setImportance(e.target.value)}
                      >
                        <option value="regular">Regular</option>
                        <option value="important">Important — may escalate to WhatsApp</option>
                      </Select>
                    )}
                  </Field>

                  <Field
                    id="a-when"
                    label="Send later"
                    hint="Leave blank to send now or save a draft."
                  >
                    {(props) => (
                      <Input
                        {...props}
                        type="datetime-local"
                        value={scheduledAt}
                        onChange={(e) => setScheduledAt(e.target.value)}
                      />
                    )}
                  </Field>
                </FormGrid>

                <FormActions>
                  <Button
                    type="button"
                    disabled={busy !== null || !title || !bodyText}
                    onClick={() => void submit('now')}
                  >
                    {busy === 'now' ? (
                      <Loader2 aria-hidden="true" className="animate-spin" />
                    ) : (
                      <Send aria-hidden="true" />
                    )}
                    Send now
                  </Button>

                  {scheduledAt && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy !== null || !title || !bodyText}
                      onClick={() => void submit('schedule')}
                    >
                      {busy === 'schedule' && (
                        <Loader2 aria-hidden="true" className="animate-spin" />
                      )}
                      Schedule
                    </Button>
                  )}

                  <Button
                    type="submit"
                    variant="ghost"
                    disabled={busy !== null || !title || !bodyText}
                  >
                    {busy === 'draft' && <Loader2 aria-hidden="true" className="animate-spin" />}
                    Save as draft
                  </Button>
                </FormActions>
              </form>
            </FormSection>
          ) : (
            <Alert variant="info" title="Announcements are written by the school office">
              You can see what has been sent. The owner, principal and administrator write them.
            </Alert>
          )}

          <Card>
            <CardContent className="p-0">
              <DataTable
                caption="Announcements"
                rows={data.announcements}
                rowKey={(a) => a.id}
                columns={[
                  {
                    key: 'title',
                    header: 'Announcement',
                    primary: true,
                    cell: (a) => (
                      <>
                        <span className="font-medium text-foreground">{a.title}</span>
                        {a.importance === 'important' && (
                          <Badge variant="warning" className="ml-2">
                            Important
                          </Badge>
                        )}
                        <span className="block text-xs text-muted-foreground">
                          {describeTarget(a.target_audience, a.target_scope, a.target_ids)}
                        </span>
                      </>
                    ),
                  },
                  {
                    key: 'status',
                    header: 'State',
                    cell: (a) => (
                      <Badge variant={STATUS_TONE[a.status] ?? 'neutral'}>
                        {/* "Scheduled" rather than "Sent" for anything the worker
                            has not finished — the table must not overstate. */}
                        {a.status === 'scheduled' ? 'Queued' : a.status}
                      </Badge>
                    ),
                  },
                  {
                    key: 'read',
                    header: 'Read',
                    cell: (a) =>
                      // Only for notices that actually went out. A draft with "0 read"
                      // reads as a failure rather than as something not yet sent.
                      a.status === 'sent' ? (
                        <span data-numeric className="text-sm">
                          {a.readCount ?? 0}
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      ),
                  },
                  {
                    key: 'when',
                    header: 'When',
                    cell: (a) =>
                      a.sent_at
                        ? formatDate(a.sent_at)
                        : a.scheduled_at
                          ? formatDate(a.scheduled_at)
                          : formatDate(a.created_at),
                  },
                  {
                    key: 'act',
                    header: '',
                    cell: (a) =>
                      data.canWrite && ['draft', 'scheduled'].includes(a.status) ? (
                        <Button variant="ghost" size="sm" onClick={() => cancel(a)}>
                          <X aria-hidden="true" />
                          Cancel
                        </Button>
                      ) : null,
                  },
                ]}
                empty={
                  <EmptyState
                    icon={Megaphone}
                    title="No announcements yet"
                    description="Notices you send to parents, pupils or staff appear here with what happened to each one."
                  />
                }
              />
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )
}
