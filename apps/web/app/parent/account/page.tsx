'use client'

/**
 * Parent account — how you are contacted (ADR-015).
 *
 * Spec: `01 Foundation Layer/DECISIONS.md` → ADR-015
 *
 * ## The two consents are deliberately two switches
 *
 * ADR-015 is explicit that `marketing_opt_in` and `whatsapp_opted_in` are independent.
 * The difference is not obvious from the field names, so the screen says it in words: one
 * is the school telling you about your child, the other is AfriTech selling you something.
 *
 * Collapsing them into "notifications" would make turning off advertising also turn off
 * "your child was absent today", which no parent wants and which would quietly damage the
 * product's actual purpose.
 */

import type { JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { BellRing, Mail, MessageSquare, Phone } from 'lucide-react'

import { Card } from '../../../components/ui/card'
import { useToast } from '../../../components/ui/toast'

interface Prefs {
  linked: boolean
  fullName?: string | null
  email?: string | null
  phone?: string | null
  preferredContact?: string
  serviceMessages?: boolean
  marketing?: boolean
  message?: string
}

export default function ParentAccountPage(): JSX.Element {
  const { toast } = useToast()
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/parent/preferences')
      const body = await response.json()
      setPrefs(response.ok ? body.data : { linked: false, message: body.error })
    } catch {
      setPrefs({ linked: false, message: 'Could not reach ZSMS. Check your connection.' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function save(patch: Record<string, unknown>): Promise<void> {
    setSaving(true)
    // Optimistic, because a switch that waits a second feels broken on a slow phone.
    setPrefs((p) => (p ? { ...p, ...patch } : p))
    try {
      const response = await fetch('/api/parent/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const body = await response.json()
      if (!response.ok) {
        toast(body.error ?? 'That did not save.', 'danger')
        await load()
        return
      }
      toast(body.data?.message ?? 'Saved.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="p-card text-muted-foreground">Loading your preferences…</div>
  }

  if (!prefs?.linked) {
    return (
      <Card className="p-card">
        <p className="font-medium">Account not linked yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {prefs?.message ??
            'Your account is not linked to a school yet, so there are no contact preferences to set.'}
        </p>
      </Card>
    )
  }

  return (
    <div className="space-y-stack pb-24">
      <header>
        <h1 className="text-xl font-semibold">Your account</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          How your child&rsquo;s school and AfriTech get in touch with you.
        </p>
      </header>

      <Card className="p-card">
        <h2 className="font-medium">Your details</h2>
        <dl className="mt-stack space-y-2 text-sm">
          <Row label="Name" value={prefs.fullName} />
          <Row label="Email" value={prefs.email} />
          <Row label="Phone" value={prefs.phone} />
        </dl>
        <p className="mt-stack text-xs text-muted-foreground">
          These come from what your school recorded. Ask the school office to change them —
          they are also what links you to your child, so ZSMS does not let them be edited
          here.
        </p>
      </Card>

      <Card className="p-card">
        <h2 className="font-medium">How to reach you</h2>
        <div className="mt-stack grid gap-2 sm:grid-cols-3">
          {[
            { key: 'phone', label: 'Phone call', icon: Phone },
            { key: 'whatsapp', label: 'WhatsApp', icon: MessageSquare },
            { key: 'email', label: 'Email', icon: Mail },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              disabled={saving}
              onClick={() => void save({ preferredContact: key })}
              className={`flex min-h-tap items-center gap-2 rounded-md border p-3 text-sm ${
                prefs.preferredContact === key
                  ? 'border-primary bg-primary/5 font-medium'
                  : 'border-border'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      </Card>

      <Card className="p-card">
        <h2 className="font-medium">Messages</h2>

        <Toggle
          title="News about your child"
          detail="Fees due, absences, results, and announcements from the school. This is what ZSMS is for."
          checked={prefs.serviceMessages ?? true}
          disabled={saving}
          onChange={(v) => void save({ serviceMessages: v })}
        />

        <div className="my-stack border-t border-border" />

        <Toggle
          title="Occasional news from AfriTech"
          detail="Offers and product news from AfriTech Systems, who make ZSMS. Nothing to do with your child's school, and off unless you turn it on."
          checked={prefs.marketing ?? false}
          disabled={saving}
          onChange={(v) => void save({ marketing: v })}
        />

        <p className="mt-stack flex items-start gap-2 text-xs text-muted-foreground">
          <BellRing className="mt-0.5 h-3 w-3 shrink-0" />
          These two are separate on purpose. Turning off AfriTech&rsquo;s news never stops
          your school telling you about your child.
        </p>
      </Card>
    </div>
  )
}

function Row({ label, value }: { label: string; value?: string | null }): JSX.Element {
  return (
    <div className="flex justify-between gap-stack">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{value ?? 'Not recorded'}</dd>
    </div>
  )
}

function Toggle({
  title,
  detail,
  checked,
  disabled,
  onChange,
}: {
  title: string
  detail: string
  checked: boolean
  disabled: boolean
  onChange: (value: boolean) => void
}): JSX.Element {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-stack">
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{detail}</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        className="mt-1 h-5 w-5 shrink-0 accent-primary"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  )
}
