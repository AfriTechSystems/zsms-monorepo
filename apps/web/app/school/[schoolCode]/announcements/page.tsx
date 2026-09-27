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
import { Loader2, Megaphone, Send, X } from 'lucide-react'

import { apiSend, useApi } from '../../../../lib/use-api'
import { Alert } from '../../../../components/ui/alert'
import { Badge } from '../../../../components/ui/badge'
import { Button } from '../../../../components/ui/button'
import { Card, CardContent } from '../../../../components/ui/card'
import { DataTable } from '../../../../components/ui/data-table'
import { EmptyState } from '../../../../components/ui/empty-state'
import { ErrorState, PageHeader, TableSkeleton } from '../../../../components/ui/data-states'
import { Field, Input, Select, Textarea } from '../../../../components/ui/field'
import { FormActions, FormGrid, FormSection } from '../../../../components/ui/form'
import { InfoHint } from '../../../../components/ui/info-hint'
import { useToast } from '../../../../components/ui/toast'
import { formatCount, formatDate } from '../school-shared'

interface Announcement {
  id: string
  title: string
  body: string
  importance: string
  target_type: string
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
  canWrite: boolean
  deliveryConfigured: boolean
}

interface Structure {
  gradeLevels: Array<{ level_id: string; display_name: string }>
  classesByGrade: Record<string, string[]>
}

const TARGET_LABEL: Record<string, string> = {
  all_parents: 'All parents',
  all_students: 'All pupils',
  all_staff: 'All staff',
  grade: 'Chosen grades',
  class: 'Chosen classes',
  platform: 'Platform-wide',
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
  const [targetType, setTargetType] = useState('all_parents')
  const [targetIds, setTargetIds] = useState<string[]>([])
  const [scheduledAt, setScheduledAt] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const classes = useMemo(
    () => Object.values(structure.data?.classesByGrade ?? {}).flat().sort(),
    [structure.data],
  )
  const grades = structure.data?.gradeLevels ?? []

  const needsTargets = targetType === 'grade' || targetType === 'class'

  // How many people this would reach. For a grade or class selection the exact
  // number needs a per-class roll, which this screen does not have — so it says
  // what it knows rather than inventing a figure.
  const reach = useMemo(() => {
    if (!data) return null
    if (targetType === 'all_parents') return data.audience.all_parents
    if (targetType === 'all_students') return data.audience.all_students
    if (targetType === 'all_staff') return data.audience.all_staff
    return null
  }, [data, targetType])

  const submit = useCallback(
    async (action: 'draft' | 'now' | 'schedule', event?: FormEvent) => {
      event?.preventDefault()
      setBusy(action)
      setFormError(null)

      const result = await apiSend<{ queued: boolean }>('/api/school/announcements', 'POST', {
        title,
        body: bodyText,
        importance,
        targetType,
        targetIds: needsTargets ? targetIds : undefined,
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
      reload()
    },
    [
      title,
      bodyText,
      importance,
      targetType,
      targetIds,
      needsTargets,
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
          {/* The single most important thing on this screen when it applies. */}
          {!data.deliveryConfigured && (
            <Alert variant="warning" title="Message delivery is not set up here">
              Announcements can be written, scheduled and queued, and everything below is real —
              but nothing will actually reach a parent from this environment. WhatsApp, SMS and
              email need provider credentials and a running queue, which arrive with the live
              deployment. Treat “queued” as exactly that.
            </Alert>
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

                  <Field id="a-target" label="Who it goes to" required>
                    {(props) => (
                      <Select
                        {...props}
                        value={targetType}
                        onChange={(e) => {
                          setTargetType(e.target.value)
                          setTargetIds([])
                        }}
                      >
                        {Object.entries(TARGET_LABEL)
                          .filter(([k]) => k !== 'platform')
                          .map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                      </Select>
                    )}
                  </Field>
                </FormGrid>

                {reach !== null && (
                  <p className="mt-stack text-sm text-muted-foreground">
                    This would reach{' '}
                    <strong className="text-foreground">{formatCount(reach)}</strong>{' '}
                    {targetType === 'all_parents'
                      ? 'parents'
                      : targetType === 'all_students'
                        ? 'pupils'
                        : 'staff'}
                    .{' '}
                    {targetType === 'all_parents' && (
                      <InfoHint label="how parents are counted">
                        A parent with three children is counted once. WhatsApp is charged per
                        message, so this is the number that matters for your plan rather than the
                        number of pupils.
                      </InfoHint>
                    )}
                  </p>
                )}

                {needsTargets && (
                  <fieldset className="mt-stack flex flex-col gap-1.5">
                    <legend className="text-sm font-medium text-foreground">
                      {targetType === 'grade' ? 'Which grades' : 'Which classes'}
                      <span aria-hidden="true" className="text-danger"> *</span>
                    </legend>
                    <div className="flex flex-wrap gap-3 pt-1">
                      {(targetType === 'grade'
                        ? grades.map((g) => ({ id: g.level_id, label: g.display_name }))
                        : classes.map((c) => ({ id: c, label: c }))
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
                          {TARGET_LABEL[a.target_type] ?? a.target_type}
                          {a.target_ids.length > 0 && ` — ${a.target_ids.join(', ')}`}
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
