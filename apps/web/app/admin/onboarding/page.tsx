'use client'

/**
 * The onboarding task queue — who needs calling, and who has been waiting too long.
 *
 * Spec: `Official Documentation/15 Super Admin and Platform/ONBOARDING.md`
 *
 * ## The red rows are the whole point
 *
 * That document calls the 24-hour outreach rule "the most important operational rule at AfriTech",
 * and its argument is commercial rather than procedural: a school that registers and is helped
 * converts, and one that registers and hears nothing lets the trial lapse and never comes back.
 *
 * So the list is sorted by how long is left to make the first call, most urgent first, and the
 * countdown is on every row rather than behind a filter. A queue that has to be interrogated to find
 * the urgent items is a queue nobody works.
 *
 * ## Nothing here says "overdue" that the database did not compute
 *
 * `outreach_overdue` and `hours_to_contact` come from `public.onboarding_queue`, derived from the
 * first recorded contact against registration time. There is no scheduled job and no stored flag —
 * see `0152`. That means the badge cannot be stale, and it also means this screen was correct the
 * day it shipped rather than the day Redis arrives.
 */

import type { JSX } from 'react'
import { Suspense, useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, Phone, PhoneOff } from 'lucide-react'

import { apiSend, useApi } from '../../../lib/use-api'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'
import { DataTable } from '../../../components/ui/data-table'
import { EmptyState } from '../../../components/ui/empty-state'
import { ErrorState, PageHeader, TableSkeleton } from '../../../components/ui/data-states'
import { Field, Select, Textarea } from '../../../components/ui/field'
import { FormActions, FormGrid, FormSection } from '../../../components/ui/form'
import { useToast } from '../../../components/ui/toast'

interface QueueRow {
  school_id: string
  school_code: string
  school_name: string
  school_status: string
  source: string
  owner_first_name: string
  owner_last_name: string
  owner_email: string
  owner_phone_e164: string | null
  task_status: string
  assigned_to: string | null
  registered_at: string
  contact_attempts: number
  last_contact_at: string | null
  completion_pct: number | null
  outreach_overdue: boolean
  outreach_escalated: boolean
  hours_to_contact: number | null
  trial_days_left: number | null
}

const TASK_LABEL: Record<string, string> = {
  new: 'New',
  assigned: 'Assigned',
  in_progress: 'In progress',
  not_interested: 'Not interested',
  complete: 'Complete',
}

/**
 * The countdown, in the words a person would use.
 *
 * Negative hours mean the window has passed, and that case gets the blunt phrasing: "9h late" is
 * actionable in a way "-9 hours remaining" is not.
 */
function contactWindow(hours: number | null, overdue: boolean): JSX.Element {
  if (hours === null) return <span className="text-muted-foreground">—</span>
  if (overdue) {
    const late = Math.abs(Math.round(hours))
    return (
      <Badge variant="danger">
        {late < 24 ? `${late}h late` : `${Math.round(late / 24)}d late`}
      </Badge>
    )
  }
  const left = Math.round(hours)
  if (left <= 0) return <Badge variant="warning">due now</Badge>
  return <Badge variant={left < 6 ? 'warning' : 'neutral'}>{left}h left</Badge>
}

function Queue(): JSX.Element {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const { toast } = useToast()

  const view = params.get('view') ?? 'open'
  const { data, meta, loading, error, code, reload } = useApi<QueueRow[]>(
    `/api/admin/onboarding?view=${view}`,
  )

  const [logging, setLogging] = useState<QueueRow | null>(null)
  const [outcome, setOutcome] = useState('spoke')
  const [channel, setChannel] = useState('phone')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const setView = useCallback(
    (next: string) => {
      const p = new URLSearchParams(params.toString())
      if (next === 'open') p.delete('view')
      else p.set('view', next)
      router.replace(`${pathname}?${p.toString()}`, { scroll: false })
    },
    [params, pathname, router],
  )

  const overdueCount = useMemo(
    () => (data ?? []).filter((r) => r.outreach_overdue).length,
    [data],
  )

  const noteRequired = outcome !== 'no_answer' && outcome !== 'wrong_number'

  const record = async (): Promise<void> => {
    if (!logging) return
    setSaving(true)
    setSaveError(null)

    const result = await apiSend('/api/admin/onboarding', 'POST', {
      action: 'contact',
      schoolId: logging.school_id,
      outcome,
      channel,
      note: note.trim() || null,
    })

    setSaving(false)
    if (result.error) {
      setSaveError(result.error)
      return
    }

    toast(`Contact recorded for ${logging.school_code}.`)
    setLogging(null)
    setNote('')
    setOutcome('spoke')
    reload()
  }

  return (
    <>
      <PageHeader
        title="Onboarding"
        description="Every school that has registered, ordered by how long is left to make the first call."
        note="The 24-hour window applies to self-registered schools only. A school AfriTech created was created by somebody who was already talking to it."
        actions={
          overdueCount > 0 ? (
            <Badge variant="danger">
              {overdueCount} overdue
            </Badge>
          ) : null
        }
      />

      <div className="mb-cards flex flex-wrap gap-2">
        {(
          [
            ['open', 'Needs attention'],
            ['overdue', 'Overdue'],
            ['mine', 'Assigned to me'],
            ['all', 'Everything'],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            size="sm"
            variant={view === key ? 'default' : 'outline'}
            onClick={() => setView(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {error && <ErrorState message={error} code={code} onRetry={reload} />}
      {loading && !data && !error && <TableSkeleton rows={6} columns={5} />}

      {!error && data && data.length === 0 && (
        <EmptyState
          icon={Phone}
          title="Nothing waiting"
          description={
            view === 'overdue'
              ? 'No school has gone past its 24-hour window. That is the target.'
              : 'No school is waiting to be picked up.'
          }
        />
      )}

      {!error && data && data.length > 0 && (
        <Card>
          <CardContent className="pt-card">
            <DataTable
              rows={data}
              rowKey={(r) => r.school_id}
              caption="Schools awaiting onboarding, most urgent first"
              columns={[
                {
                  key: 'school',
                  header: 'School',
                  cell: (r) => (
                    <>
                      <Link href={`/admin/schools/${r.school_id}`} className="font-medium underline">
                        {r.school_name}
                      </Link>
                      <span className="block font-mono text-sm text-muted-foreground">
                        {r.school_code}
                      </span>
                    </>
                  ),
                },
                {
                  key: 'owner',
                  header: 'Owner',
                  cell: (r) => (
                    <>
                      {r.owner_first_name} {r.owner_last_name}
                      <span className="block text-sm text-muted-foreground">
                        {r.owner_phone_e164 ?? r.owner_email}
                      </span>
                    </>
                  ),
                },
                {
                  key: 'window',
                  header: 'First call',
                  // Only meaningful for a self-registered school; an AfriTech-created one has no
                  // window, and showing a dash is more honest than showing a clock that means
                  // nothing.
                  cell: (r) =>
                    r.source === 'self_registration'
                      ? contactWindow(r.hours_to_contact, r.outreach_overdue)
                      : <span className="text-muted-foreground">n/a</span>,
                },
                {
                  key: 'contacts',
                  header: 'Contacts',
                  cell: (r) =>
                    r.contact_attempts === 0 ? (
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <PhoneOff aria-hidden="true" className="size-3.5" />
                        none
                      </span>
                    ) : (
                      <>
                        <span data-numeric>{r.contact_attempts}</span>
                        <span className="block text-sm text-muted-foreground">
                          last {r.last_contact_at ? new Date(r.last_contact_at).toLocaleDateString() : '—'}
                        </span>
                      </>
                    ),
                },
                {
                  key: 'setup',
                  header: 'Setup',
                  cell: (r) => (
                    <Badge variant={(r.completion_pct ?? 0) >= 80 ? 'success' : 'neutral'}>
                      {r.completion_pct ?? 0}%
                    </Badge>
                  ),
                },
                {
                  key: 'task',
                  header: 'Task',
                  cell: (r) => (
                    <>
                      <Badge variant={r.task_status === 'new' ? 'warning' : 'neutral'}>
                        {TASK_LABEL[r.task_status] ?? r.task_status}
                      </Badge>
                      {r.trial_days_left !== null && r.trial_days_left <= 10 && (
                        <span className="block text-sm text-warning">
                          trial ends in {r.trial_days_left}d
                        </span>
                      )}
                    </>
                  ),
                },
                {
                  key: 'actions',
                  header: '',
                  cell: (r) => (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setLogging(r)
                        setSaveError(null)
                      }}
                    >
                      <Phone aria-hidden="true" />
                      Log call
                    </Button>
                  ),
                },
              ]}
            />
          </CardContent>
        </Card>
      )}

      {logging && (
        <FormSection
          className="mt-cards"
          title={`Record a contact — ${logging.school_name}`}
          description={`${logging.owner_first_name} ${logging.owner_last_name} · ${logging.owner_phone_e164 ?? logging.owner_email}`}
        >
          <FormGrid>
            <Field id="outcome" label="What happened" required>
              {(props) => (
                <Select {...props} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                  <option value="spoke">Spoke to them</option>
                  <option value="call_scheduled">Onboarding call booked</option>
                  <option value="no_answer">No answer</option>
                  <option value="wrong_number">Wrong number</option>
                  <option value="not_interested">Not interested</option>
                </Select>
              )}
            </Field>

            <Field id="channel" label="How">
              {(props) => (
                <Select {...props} value={channel} onChange={(e) => setChannel(e.target.value)}>
                  <option value="phone">Phone</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="email">Email</option>
                  <option value="in_person">In person</option>
                </Select>
              )}
            </Field>

            <Field
              id="note"
              label="Notes"
              required={noteRequired}
              className="sm:col-span-2"
              hint={
                noteRequired
                  ? 'What they said, and what happens next. The next person to ring has only this.'
                  : 'Optional — there was nobody to quote.'
              }
            >
              {(props) => (
                <Textarea
                  {...props}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  maxLength={2000}
                />
              )}
            </Field>
          </FormGrid>

          {saveError && (
            <p
              role="alert"
              className="mt-stack flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger"
            >
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {saveError}
            </p>
          )}

          <FormActions>
            <Button
              disabled={saving || (noteRequired && note.trim() === '')}
              onClick={() => void record()}
            >
              {saving ? 'Recording…' : 'Record contact'}
            </Button>
            <Button variant="outline" disabled={saving} onClick={() => setLogging(null)}>
              Cancel
            </Button>
            <span className="text-sm text-muted-foreground">
              Contacts cannot be edited afterwards — correct one by adding another.
            </span>
          </FormActions>
        </FormSection>
      )}

      {meta?.total !== undefined && data && (
        <p className="mt-cards text-sm text-muted-foreground">
          Showing <span data-numeric>{data.length}</span> of{' '}
          <span data-numeric>{meta.total}</span>.
        </p>
      )}
    </>
  )
}

export default function AdminOnboardingPage(): JSX.Element {
  return (
    <Suspense fallback={<TableSkeleton rows={6} columns={5} />}>
      <Queue />
    </Suspense>
  )
}
