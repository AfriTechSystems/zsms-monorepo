'use client'

/**
 * Settings → Attendance alerts.
 *
 * Spec: `10 Attendance/TRIGGERS.md` → *Per-Absence Alert Toggle*
 *       `10 Attendance/NOTIFICATIONS.md` → *Channel 3*
 *
 * ## The point of this screen is the number, not the switch
 *
 * NOTIFICATIONS.md's own arithmetic: 400 pupils at 5% daily absence is about 400
 * messages a month, roughly 80% of the Starter tier's entire quota spent on absence
 * alerts alone. A school that turns this on without seeing that finds out when the quota
 * runs dry mid-term and a fee reminder cannot go out.
 *
 * So the projection is computed from the school's actual roll and shown before the
 * switch, not after.
 *
 * ## What stays on regardless
 *
 * The in-app badge is Channel 1 and always active — a parent who signs in always sees
 * the absence. This screen is only about *pushing* it to them, which is the part that
 * costs money. The copy says so, because "alerts off" otherwise reads as "parents are
 * not told", which is not true.
 */

import type { JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { BellRing, Save } from 'lucide-react'

import { Alert } from '../../../../../components/ui/alert'
import { Button } from '../../../../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../../../components/ui/card'
import { CheckboxField } from '../../../../../components/ui/form'
import { ErrorState, PageHeader, TableSkeleton } from '../../../../../components/ui/data-states'
import { Input } from '../../../../../components/ui/field'
import { useToast } from '../../../../../components/ui/toast'

type Mark = 'absent' | 'late' | 'excused'

const MARKS: { key: Mark; label: string; hint?: string }[] = [
  { key: 'absent', label: 'Absent' },
  { key: 'late', label: 'Late', hint: 'Sends a message every time a child misses a bus' },
  { key: 'excused', label: 'Excused', hint: 'The school already knows — rarely worth a message' },
]

interface Settings {
  enabled: boolean
  statuses: Mark[]
  viaWhatsapp: boolean
  viaEmail: boolean
  viaPush: boolean
  maxAgeDays: number
  isConfigured: boolean
  projection: { students: number; perMonth: number } | null
}

export default function AttendanceAlertsPage(): JSX.Element {
  const { toast } = useToast()
  const [s, setS] = useState<Settings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/school/attendance/alerts')
      const body = await response.json()
      if (!response.ok) {
        setError(body.error ?? 'Could not load attendance alert settings.')
        return
      }
      setS(body.data)
      setError(null)
    } catch {
      setError('Could not reach the server.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) return <TableSkeleton rows={5} columns={2} />
  if (error || !s) return <ErrorState message={error ?? 'Not available.'} onRetry={() => void load()} />

  function update(patch: Partial<Settings>): void {
    setS((p) => (p ? { ...p, ...patch } : p))
  }

  function toggleMark(mark: Mark): void {
    update({
      statuses: s!.statuses.includes(mark)
        ? s!.statuses.filter((m) => m !== mark)
        : [...s!.statuses, mark],
    })
  }

  async function save(): Promise<void> {
    setSaving(true)
    try {
      const response = await fetch('/api/school/attendance/alerts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: s!.enabled,
          statuses: s!.statuses.length > 0 ? s!.statuses : ['absent'],
          viaWhatsapp: s!.viaWhatsapp,
          viaEmail: s!.viaEmail,
          viaPush: s!.viaPush,
          maxAgeDays: s!.maxAgeDays,
        }),
      })
      const body = await response.json()
      toast(body.data?.message ?? body.error ?? 'Saved.', response.ok ? 'success' : 'danger')
      if (response.ok) update({ isConfigured: true })
    } finally {
      setSaving(false)
    }
  }

  const noChannel = !s.viaWhatsapp && !s.viaEmail && !s.viaPush

  return (
    <div>
      <PageHeader
        title="Attendance alerts"
        description="Whether marking a child absent sends their parent a message."
      />

      {/*
        Said first, because "alerts off" otherwise reads as "parents are not told" —
        and that is not true. The portal badge is always on and costs nothing.
      */}
      <Alert className="mb-cards">
        Parents always see attendance in the portal, whatever you choose here. This page
        is about whether ZSMS also sends them a message.
      </Alert>

      <Card className="mb-cards">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BellRing className="h-4 w-4" />
            Send a message for each absence
          </CardTitle>
          <CardDescription>
            Off by default. Turning it on uses your monthly message quota every time a
            child is marked.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CheckboxField
            id="enabled"
            label="Message parents about individual absences"
            checked={s.enabled}
            onChange={(v) => update({ enabled: v })}
          />

          {/*
            The projection, which is the whole reason this screen exists rather than a
            bare switch. Shown whether or not alerts are on, because the number is what
            somebody needs in order to decide.
          */}
          {s.projection && (
            <Alert variant={s.enabled ? 'warning' : undefined} className="mt-stack">
              With <span data-numeric>{s.projection.students}</span> pupils on the roll,
              a typical 5% daily absence rate would send about{' '}
              <strong>
                <span data-numeric>{s.projection.perMonth}</span> messages a month
              </strong>
              . The Starter tier includes <span data-numeric>500</span>. Check your
              quota on Subscription &amp; billing before turning this on.
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card className="mb-cards">
        <CardHeader>
          <CardTitle>Which marks</CardTitle>
          <CardDescription>
            A message goes out for the marks you choose here, and no others.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-stack">
            {MARKS.map((m) => (
              <CheckboxField
                key={m.key}
                id={`mark-${m.key}`}
                label={m.label}
                hint={m.hint}
                checked={s.statuses.includes(m.key)}
                onChange={() => toggleMark(m.key)}
                disabled={!s.enabled}
              />
            ))}
          </div>

          {s.enabled && s.statuses.length === 0 && (
            <Alert variant="warning" className="mt-stack">
              Choose at least one mark, or switch alerts off above.
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card className="mb-cards">
        <CardHeader>
          <CardTitle>How</CardTitle>
          <CardDescription>
            A parent is reached on the first channel that works.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-stack">
            <CheckboxField
              id="via-whatsapp"
              label="WhatsApp"
              hint="Uses your monthly message quota"
              checked={s.viaWhatsapp}
              onChange={(v) => update({ viaWhatsapp: v })}
              disabled={!s.enabled}
            />
            <CheckboxField
              id="via-email"
              label="Email"
              hint="Free, where the school recorded an address"
              checked={s.viaEmail}
              onChange={(v) => update({ viaEmail: v })}
              disabled={!s.enabled}
            />
            <CheckboxField
              id="via-push"
              label="Phone notification"
              hint="Free, for parents who have the app installed"
              checked={s.viaPush}
              onChange={(v) => update({ viaPush: v })}
              disabled={!s.enabled}
            />
          </div>

          {s.enabled && noChannel && (
            <Alert variant="warning" className="mt-stack">
              With every channel off, no alert can reach anybody. Switch one on, or
              switch alerts off above.
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card className="mb-cards">
        <CardHeader>
          <CardTitle>Give up after</CardTitle>
          <CardDescription>
            If ZSMS cannot send for a while, alerts older than this are dropped rather
            than delivered late as a backlog.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <label className="block">
            <span className="text-sm font-medium">Days</span>
            <Input
              value={String(s.maxAgeDays)}
              onChange={(e) => update({ maxAgeDays: Number(e.target.value) || 1 })}
              inputMode="numeric"
              className="mt-1 w-28"
              disabled={!s.enabled}
            />
          </label>
        </CardContent>
      </Card>

      <Button onClick={() => void save()} disabled={saving}>
        <Save className="mr-2 h-4 w-4" />
        {saving ? 'Saving…' : 'Save alert settings'}
      </Button>
    </div>
  )
}
