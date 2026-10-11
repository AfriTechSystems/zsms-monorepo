'use client'

/**
 * Settings → Fee reminders.
 *
 * Spec: `09 Fee and Financial Management/REMINDERS.md` → *Reminder Settings*
 *
 * ## Why this screen exists
 *
 * Until `0251` the schedule was two constants in a worker — `?? 3` and `?? 7` — which
 * decided when every school in Zambia chased a parent for money, and which did not match
 * the 7/14/30 this document specifies. There was no way for a school to change it, see
 * it, or switch it off.
 *
 * ## The rungs are a set, not a number
 *
 * REMINDERS.md presents them as tick boxes: 7, 14 and 30 on by default, 3 and 60 offered.
 * That is the shape here. The custom field exists because a school wanting to chase at 45
 * days is making an ordinary decision about its own parents, and a closed list would mean
 * a deployment to honour it.
 *
 * ## WhatsApp is the one that costs money
 *
 * Email and in-app are free; WhatsApp draws on the school's monthly quota. They are
 * separate switches for that reason — a school watching its quota needs to turn one off
 * without turning reminders off, which is why "off entirely" is also its own switch
 * rather than the result of unticking everything.
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

/** The rungs REMINDERS.md names. Anything else goes in the custom field. */
const OFFERED = [3, 7, 14, 30, 60]

interface Settings {
  reminderDays: number[]
  viaWhatsapp: boolean
  viaEmail: boolean
  viaInApp: boolean
  cooldownDays: number
  isEnabled: boolean
  isConfigured: boolean
}

export default function FeeRemindersPage(): JSX.Element {
  const { toast } = useToast()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [custom, setCustom] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/school/fees/reminders')
      const body = await response.json()
      if (!response.ok) {
        setError(body.error ?? 'Could not load reminder settings.')
        return
      }
      setSettings(body.data)
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

  if (loading) return <TableSkeleton rows={6} columns={2} />
  if (error || !settings) return <ErrorState message={error ?? 'Not available.'} onRetry={() => void load()} />

  const s = settings
  function update(patch: Partial<Settings>): void {
    setSettings((p) => (p ? { ...p, ...patch } : p))
  }

  function toggleDay(day: number): void {
    update({
      reminderDays: s.reminderDays.includes(day)
        ? s.reminderDays.filter((d) => d !== day)
        : [...s.reminderDays, day].sort((a, b) => a - b),
    })
  }

  function addCustom(): void {
    const n = Number(custom)
    if (!Number.isInteger(n) || n < 1 || n > 730) {
      toast('Enter a whole number of days between 1 and 730.', 'danger')
      return
    }
    if (s.reminderDays.includes(n)) {
      toast(`${n} days is already on the schedule.`, 'success')
      setCustom('')
      return
    }
    if (s.reminderDays.length >= 10) {
      toast('Ten reminder points is the maximum.', 'danger')
      return
    }
    update({ reminderDays: [...s.reminderDays, n].sort((a, b) => a - b) })
    setCustom('')
  }

  async function save(): Promise<void> {
    setSaving(true)
    try {
      const response = await fetch('/api/school/fees/reminders', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reminderDays: s.reminderDays,
          viaWhatsapp: s.viaWhatsapp,
          viaEmail: s.viaEmail,
          viaInApp: s.viaInApp,
          cooldownDays: s.cooldownDays,
          isEnabled: s.isEnabled,
        }),
      })
      const body = await response.json()
      toast(body.data?.message ?? body.error ?? 'Saved.', response.ok ? 'success' : 'danger')
      if (response.ok) update({ isConfigured: true })
    } finally {
      setSaving(false)
    }
  }

  const noChannel = !s.viaWhatsapp && !s.viaEmail && !s.viaInApp

  return (
    <div>
      <PageHeader
        title="Fee reminders"
        description="When overdue fees are chased, and how the message reaches a parent."
      />

      {!s.isConfigured && (
        <Alert className="mb-cards">
          {/*
            Said plainly, because a schedule nobody chose still sends messages — and a
            head teacher should know these are defaults rather than their decision.
          */}
          You have not changed these yet, so your school is using the standard schedule
          below. Reminders are already going out on it.
        </Alert>
      )}

      <Card className="mb-cards">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BellRing className="h-4 w-4" />
            Send reminders
          </CardTitle>
          <CardDescription>
            Switching this off keeps your schedule for when you turn it back on.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CheckboxField
            id="is-enabled"
            label="Send fee reminders to parents"
            checked={s.isEnabled}
            onChange={(v) => update({ isEnabled: v })}
          />
        </CardContent>
      </Card>

      <Card className="mb-cards">
        <CardHeader>
          <CardTitle>When</CardTitle>
          <CardDescription>
            Days after the due date. A parent is chased once per point, not once per
            unpaid line.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-stack sm:grid-cols-2">
            {OFFERED.map((day) => (
              <CheckboxField
                key={day}
                id={`day-${day}`}
                label={`${day} days overdue`}
                hint={day === 30 ? 'Sent as a final reminder, which reads differently' : undefined}
                checked={s.reminderDays.includes(day)}
                onChange={() => toggleDay(day)}
                disabled={!s.isEnabled}
              />
            ))}
          </div>

          {/* Anything the school has added beyond the offered rungs. */}
          {s.reminderDays.filter((d) => !OFFERED.includes(d)).length > 0 && (
            <div className="mt-stack flex flex-wrap items-center gap-2">
              {s.reminderDays
                .filter((d) => !OFFERED.includes(d))
                .map((d) => (
                  <Button
                    key={d}
                    variant="outline"
                    onClick={() => toggleDay(d)}
                    disabled={!s.isEnabled}
                  >
                    <span data-numeric>{d}</span> days — remove
                  </Button>
                ))}
            </div>
          )}

          <div className="mt-stack flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="text-sm font-medium">Another point</span>
              <Input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="45"
                inputMode="numeric"
                className="mt-1 w-28"
                disabled={!s.isEnabled}
              />
            </label>
            <Button variant="outline" onClick={addCustom} disabled={!s.isEnabled || !custom}>
              Add
            </Button>
          </div>

          {s.isEnabled && s.reminderDays.length === 0 && (
            <Alert variant="warning" className="mt-stack">
              Choose at least one point, or switch reminders off above.
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card className="mb-cards">
        <CardHeader>
          <CardTitle>How</CardTitle>
          <CardDescription>
            A parent is reached on the first channel that works, in the order below.
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
              disabled={!s.isEnabled}
            />
            <CheckboxField
              id="via-email"
              label="Email"
              hint="Free, where the school recorded an address"
              checked={s.viaEmail}
              onChange={(v) => update({ viaEmail: v })}
              disabled={!s.isEnabled}
            />
            <CheckboxField
              id="via-in-app"
              label="In the parent portal"
              hint="Free, and always visible when the parent signs in"
              checked={s.viaInApp}
              onChange={(v) => update({ viaInApp: v })}
              disabled={!s.isEnabled}
            />
          </div>

          {s.isEnabled && noChannel && (
            <Alert variant="warning" className="mt-stack">
              {/*
                Named rather than silently sending nothing, which is what the worker
                would otherwise do — correctly, and invisibly.
              */}
              With every channel off, no reminder can reach anybody. Switch one on, or
              switch reminders off above.
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card className="mb-cards">
        <CardHeader>
          <CardTitle>Not more often than</CardTitle>
          <CardDescription>
            A safety net. However the points above are set, one family is never messaged
            twice inside this many days.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <label className="block">
            <span className="text-sm font-medium">Days between messages</span>
            <Input
              value={String(s.cooldownDays)}
              onChange={(e) => update({ cooldownDays: Number(e.target.value) || 1 })}
              inputMode="numeric"
              className="mt-1 w-28"
              disabled={!s.isEnabled}
            />
          </label>
        </CardContent>
      </Card>

      <Button onClick={() => void save()} disabled={saving}>
        <Save className="mr-2 h-4 w-4" />
        {saving ? 'Saving…' : 'Save reminder settings'}
      </Button>
    </div>
  )
}
