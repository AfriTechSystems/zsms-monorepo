'use client'

/**
 * API keys — letting another system read this school's data.
 *
 * Spec: `03 Infrastructure Services/API_INTEGRATION.md`
 *
 * ## The one screen in ZSMS that shows a secret
 *
 * A key is displayed once, on creation, and never again. Everything about this page is
 * arranged around not letting somebody click away before copying it: the value appears
 * in a panel that does not disappear on its own, with a copy button and a sentence
 * saying plainly that it cannot be retrieved.
 *
 * ## Why only the owner
 *
 * A key acts as the school within its scopes, with nobody's name attached. That is an
 * ownership decision, narrower than the rest of settings — narrower even than permission
 * grants, which at least name the person who received them. The database refuses anyone
 * else regardless.
 */

import type { ChangeEvent, JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Copy, KeyRound, Plug, ShieldOff } from 'lucide-react'

import { Button } from '../../../../../components/ui/button'
import { Card } from '../../../../../components/ui/card'
import { Badge } from '../../../../../components/ui/badge'
import { Input, Select } from '../../../../../components/ui/field'
import { useToast } from '../../../../../components/ui/toast'

interface ApiKey {
  id: string
  name: string
  prefix: string
  scopes: string[]
  isActive: boolean
  lastUsedAt: string | null
  expiresAt: string | null
  createdAt: string
  recentCalls: number
  recentRefusals: number
}

interface Payload {
  keys: ApiKey[]
  scopes: string[]
  implementedScopes: string[]
  usageLoaded: boolean
}

const SCOPE_LABEL: Record<string, string> = {
  'students:read': 'Read pupil records',
  'students:write': 'Create and update pupils',
  'fees:read': 'Read fees and payments',
  'fees:write': 'Record payments',
  'attendance:read': 'Read attendance',
  'attendance:write': 'Record attendance',
  'results:read': 'Read published results',
  'communication:send': 'Send messages',
  'loans:read': 'Read loan applications',
  'loans:write': 'Submit loan applications',
  'webhooks:receive': 'Register webhooks',
}

export default function ApiKeysPage(): JSX.Element {
  const { toast } = useToast()
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)
  /** The key just created. Held in memory only, and never fetched again. */
  const [issued, setIssued] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', scopes: [] as string[], expiresInDays: '365' })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/school/api-keys')
      const body = await response.json()
      if (!response.ok) {
        setError(body.error ?? 'Could not load API keys.')
        return
      }
      setError(null)
      setData(body.data)
    } catch {
      setError('Could not reach ZSMS. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function create(): Promise<void> {
    setSaving(true)
    try {
      const response = await fetch('/api/school/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          scopes: form.scopes,
          expiresInDays: form.expiresInDays === '' ? null : Number(form.expiresInDays),
        }),
      })
      const body = await response.json()
      if (!response.ok) {
        toast(body.error ?? 'That did not work.', 'danger')
        return
      }
      setIssued(body.data.plaintext)
      setOpen(false)
      setForm({ name: '', scopes: [], expiresInDays: '365' })
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function revoke(id: string): Promise<void> {
    const response = await fetch('/api/school/api-keys', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    const body = await response.json()
    toast(body.data?.message ?? body.error ?? 'Done', response.ok ? 'success' : 'danger')
    if (response.ok) await load()
  }

  if (loading) return <div className="p-card text-muted-foreground">Loading API keys…</div>

  if (error) {
    return (
      <Card className="p-card">
        <p className="text-destructive">{error}</p>
        <Button variant="outline" className="mt-stack" onClick={() => void load()}>
          Try again
        </Button>
      </Card>
    )
  }

  const d = data!

  return (
    <div className="space-y-stack">
      <header className="flex flex-wrap items-start justify-between gap-stack">
        <div>
          <h1 className="text-2xl font-semibold">API keys</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Let another system — your accounting package, your own app — read this
            school&rsquo;s data directly. Each key carries only what you tick.
          </p>
        </div>
        <Button onClick={() => setOpen(!open)}>
          <Plug className="mr-2 h-4 w-4" />
          New key
        </Button>
      </header>

      {issued ? (
        <Card className="border-warning bg-warning/5 p-card">
          <p className="flex items-start gap-2 font-medium">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            Copy this now — it will not be shown again
          </p>
          <div className="mt-stack flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-md bg-surface p-3 text-sm">
              {issued}
            </code>
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(issued)
                toast('Copied.')
              }}
            >
              <Copy className="mr-2 h-4 w-4" />
              Copy
            </Button>
          </div>
          <p className="mt-stack text-sm text-muted-foreground">
            ZSMS stores only a fingerprint of this key, so nobody — not your school, not
            AfriTech — can retrieve it later. If it is lost, issue a new one and revoke
            this.
          </p>
          {/*
            Dismissal is deliberate and manual. Auto-hiding the one value that cannot be
            recovered would be the worst possible moment for a convenience.
          */}
          <Button variant="ghost" className="mt-stack" onClick={() => setIssued(null)}>
            I have copied it
          </Button>
        </Card>
      ) : null}

      {open ? (
        <Card className="border-primary/40 p-card">
          <h2 className="font-medium">New API key</h2>

          <div className="mt-stack grid gap-stack sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium">What is it for</span>
              <Input
                value={form.name}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setForm({ ...form, name: e.target.value })
                }
                placeholder="Sage accounting import"
                className="mt-1"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium">Expires</span>
              <Select
                value={form.expiresInDays}
                onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                  setForm({ ...form, expiresInDays: e.target.value })
                }
                className="mt-1"
              >
                <option value="90">90 days</option>
                <option value="365">1 year</option>
                <option value="730">2 years</option>
                <option value="">Never</option>
              </Select>
            </label>
          </div>

          <p className="mt-stack text-sm font-medium">What may it do</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {d.scopes.map((scope) => {
              const live = d.implementedScopes.includes(scope)
              return (
                <label key={scope} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-primary"
                    checked={form.scopes.includes(scope)}
                    onChange={() =>
                      setForm({
                        ...form,
                        scopes: form.scopes.includes(scope)
                          ? form.scopes.filter((s) => s !== scope)
                          : [...form.scopes, scope],
                      })
                    }
                  />
                  <span>
                    {SCOPE_LABEL[scope] ?? scope}
                    {/*
                      Said rather than hidden. A school granting `loans:write` and
                      finding nothing happens would reasonably think the key is broken.
                    */}
                    {!live ? (
                      <span className="block text-xs text-muted-foreground">
                        No endpoint yet — the scope is reserved
                      </span>
                    ) : null}
                  </span>
                </label>
              )
            })}
          </div>

          <div className="mt-stack flex gap-2">
            <Button
              onClick={() => void create()}
              disabled={saving || form.name.trim() === '' || form.scopes.length === 0}
            >
              {saving ? 'Creating…' : 'Create key'}
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      {d.keys.length === 0 && !open ? (
        <Card className="p-card text-center">
          <KeyRound className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-stack font-medium">No API keys</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            You only need one if another system reads ZSMS directly. Most schools never
            do.
          </p>
        </Card>
      ) : null}

      {d.keys.map((k) => (
        <Card key={k.id} className={`p-card ${k.isActive ? '' : 'opacity-60'}`}>
          <div className="flex flex-wrap items-start justify-between gap-stack">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="font-medium">{k.name}</h2>
                {k.isActive ? null : <Badge variant="neutral">Revoked</Badge>}
                {k.recentRefusals > 0 ? (
                  <Badge variant="danger">
                    <span data-numeric>{k.recentRefusals}</span> refused
                  </Badge>
                ) : null}
              </div>
              <code className="mt-1 block text-xs text-muted-foreground">
                {k.prefix}…
              </code>
              <div className="mt-2 flex flex-wrap gap-1">
                {k.scopes.map((s) => (
                  <Badge key={s} variant="neutral">
                    {SCOPE_LABEL[s] ?? s}
                  </Badge>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {k.lastUsedAt
                  ? `Last used ${new Date(k.lastUsedAt).toLocaleDateString()}`
                  : 'Never used'}
                {' · '}
                <span data-numeric>{k.recentCalls}</span> recent calls
              </p>
            </div>

            {k.isActive ? (
              <Button variant="ghost" size="sm" onClick={() => void revoke(k.id)}>
                <ShieldOff className="mr-1 h-3 w-3" />
                Revoke
              </Button>
            ) : null}
          </div>

          {k.recentRefusals > 0 ? (
            <p className="mt-stack text-sm text-destructive">
              {/*
                The signal worth raising on its own. A key being refused repeatedly is
                either a misconfigured integration or a stolen credential being probed,
                and both want looking at today rather than at the end of term.
              */}
              This key has been refused <span data-numeric>{k.recentRefusals}</span> times
              recently. Either the integration is asking for something it was not granted,
              or somebody else has the key. Revoke it if you are not sure.
            </p>
          ) : null}
        </Card>
      ))}

      <Card className="p-card">
        <h2 className="font-medium">Using a key</h2>
        <pre className="mt-stack overflow-x-auto rounded-md bg-muted p-3 text-xs">
{`curl https://zsms.co.zm/api/v1/students \\
  -H "Authorization: Bearer zsms_live_…"`}
        </pre>
        <p className="mt-stack text-sm text-muted-foreground">
          Available today: <code>students</code>, <code>fees</code>,{' '}
          <code>payments</code>, <code>attendance</code>, <code>results</code>. Each
          returns only this school&rsquo;s records, paged with{' '}
          <code>?limit=</code> and <code>?offset=</code>.
        </p>
      </Card>
    </div>
  )
}
