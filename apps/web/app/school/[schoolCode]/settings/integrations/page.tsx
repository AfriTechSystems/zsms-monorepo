'use client'

/**
 * Connections — accounting and CRM integrations (ADR-023, tier 1).
 *
 * Spec: `01 Foundation Layer/DECISIONS.md` → ADR-023
 *
 * ## The honest notice at the top is the most important thing on this page
 *
 * A school can configure a connection here and nothing is delivered, because the
 * dispatcher is not built. A settings screen that looks complete and silently does
 * nothing is worse than no screen: the bursar finds out at year end, when Sage has
 * nothing in it and the term's reconciliation has to be done by hand.
 *
 * So the state is read from the API (`dispatchReady`) rather than hardcoded, and it says
 * plainly that configuration is being saved for when sending is switched on.
 */

import type { ChangeEvent, JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { TriangleAlert, Download, Plug, PauseCircle } from 'lucide-react'

import { Button } from '../../../../../components/ui/button'
import { Card } from '../../../../../components/ui/card'
import { Badge } from '../../../../../components/ui/badge'
import { Input, Select } from '../../../../../components/ui/field'
import { useToast } from '../../../../../components/ui/toast'
import { DateRangeField } from '../../../../../components/ui/date-field'
import { todayIso } from '../../../../../lib/dates'

interface Integration {
  id: string
  type: string
  name: string
  isActive: boolean
  isPaused: boolean
  pauseReason: string | null
  events: string[]
  lastSyncAt: string | null
  lastSyncStatus: string | null
  lastError: string | null
  hasCredentials: boolean
}

interface Payload {
  integrations: Integration[]
  types: string[]
  events: string[]
  dispatchReady: boolean
}

const TYPE_LABEL: Record<string, string> = {
  sage_50_export: 'Sage 50 (file export)',
  sage_business_cloud: 'Sage Business Cloud',
  quickbooks: 'QuickBooks',
  xero: 'Xero',
  google_sheets: 'Google Sheets',
  hubspot: 'HubSpot',
  custom_webhook: 'Custom webhook',
}

const EVENT_LABEL: Record<string, string> = {
  'payment.verified': 'A payment is verified',
  'payment.recorded': 'A payment is recorded',
  'invoice.generated': 'An invoice is generated',
  'student.enrolled': 'A pupil is enrolled',
  'student.withdrawn': 'A pupil leaves',
  'results.published': 'Results are published',
}

export default function IntegrationsPage(): JSX.Element {
  const { toast } = useToast()

  /*
    Defaults to the current month, which is what an accountant exporting mid-term
    almost always wants. They can widen it; `sage50_export_rows()` caps the window at
    one year so a mis-click cannot produce a file nobody can check.
  */
  const [sageFrom, setSageFrom] = useState(() => {
    /*
      Local, not `toISOString()`. That is UTC, and Zambia is UTC+2 — before 02:00
      this returned the previous month's last day as the start of "this month".
    */
    const d = new Date()
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), '01'].join('-')
  })
  const [sageTo, setSageTo] = useState(todayIso)
  const [sageBusy, setSageBusy] = useState(false)

  /**
   * Downloads the CSV.
   *
   * Fetched rather than linked, so a refusal arrives as a readable message instead of
   * the browser saving a file containing the error envelope — which is what a plain
   * `<a download>` would do with a 403.
   */
  async function downloadSage(): Promise<void> {
    setSageBusy(true)
    try {
      const response = await fetch(
        `/api/school/integrations/sage50?from=${sageFrom}&to=${sageTo}`,
      )

      if (!response.ok) {
        const body = await response.json().catch(() => null)
        toast(body?.error ?? 'The export could not be produced.', 'danger')
        return
      }

      const count = Number(response.headers.get('X-ZSMS-Row-Count') ?? '0')
      if (count === 0) {
        /*
          An empty file is worse than a message: the accountant imports it, Sage
          reports nothing, and they go looking for a Sage problem.
        */
        toast('No verified payments in that date range, so there is nothing to export.', 'danger')
        return
      }

      const blob = await response.blob()
      const href = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = href
      link.download = `sage50-${sageFrom}-to-${sageTo}.csv`
      link.click()
      URL.revokeObjectURL(href)

      toast(`${count} payment${count === 1 ? '' : 's'} exported for Sage 50.`, 'success')
    } finally {
      setSageBusy(false)
    }
  }

  const [payload, setPayload] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ type: string; name: string; events: string[] } | null>(
    null,
  )
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/school/integrations')
      const body = await response.json()
      if (!response.ok) {
        setError(body.error ?? 'Could not load connections.')
        return
      }
      setError(null)
      setPayload(body.data)
    } catch {
      setError('Could not reach ZSMS. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function send(body: unknown): Promise<void> {
    setSaving(true)
    try {
      const response = await fetch('/api/school/integrations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const result = await response.json()
      if (!response.ok) {
        toast(result.error ?? 'That did not save.', 'danger')
        return
      }
      toast(result.data?.message ?? 'Saved.')
      setDraft(null)
      await load()
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-card text-muted-foreground">Loading connections…</div>

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

  const data = payload!

  return (
    <div className="space-y-stack">
      <header>
        <h1 className="text-2xl font-semibold">Connections</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Send ZSMS events to your accounting system so fees and payments do not have to
          be keyed in twice.
        </p>
      </header>

      {!data.dispatchReady ? (
        <Card className="border-warning/40 bg-warning/5 p-card">
          <p className="flex items-start gap-2 text-sm">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>
              <span className="font-medium">Nothing is being sent yet.</span> You can set a
              connection up here and ZSMS will keep the configuration, but delivery is not
              switched on — so do not stop keying entries into your accounting system on
              the strength of this page. We will tell you when it goes live.
            </span>
          </p>
        </Card>
      ) : null}

      <div className="flex justify-end">
        <Button
          onClick={() => setDraft({ type: data.types[0]!, name: '', events: [] })}
          disabled={Boolean(draft)}
        >
          <Plug className="mr-2 h-4 w-4" />
          Add a connection
        </Button>
      </div>

      {draft ? (
        <Card className="border-primary/40 p-card">
          <h2 className="font-medium">New connection</h2>

          <div className="mt-stack grid gap-stack sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium">System</span>
              <Select
                value={draft.type}
                onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                  setDraft({ ...draft, type: e.target.value })
                }
                className="mt-1"
              >
                {data.types.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t] ?? t}
                  </option>
                ))}
              </Select>
            </label>

            <label className="block">
              <span className="text-sm font-medium">Name it</span>
              <Input
                value={draft.name}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setDraft({ ...draft, name: e.target.value })
                }
                placeholder="Main accounts"
                className="mt-1"
              />
            </label>
          </div>

          <p className="mt-stack text-sm font-medium">Send these events</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {data.events.map((event) => (
              <label key={event} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={draft.events.includes(event)}
                  onChange={() =>
                    setDraft({
                      ...draft,
                      events: draft.events.includes(event)
                        ? draft.events.filter((e) => e !== event)
                        : [...draft.events, event],
                    })
                  }
                />
                {EVENT_LABEL[event] ?? event}
              </label>
            ))}
          </div>

          <p className="mt-stack text-xs text-muted-foreground">
            Sign-in details for the other system are not asked for here. ZSMS has no
            encryption key configured yet, and storing a password it cannot encrypt would
            leave it readable in every backup. You will be asked once that is in place.
          </p>

          <div className="mt-stack flex gap-2">
            <Button
              onClick={() => void send({ action: 'save', ...draft })}
              disabled={saving || draft.name.trim() === ''}
            >
              {saving ? 'Saving…' : 'Save connection'}
            </Button>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={saving}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      {data.integrations.length === 0 && !draft ? (
        <Card className="p-card text-center">
          <Plug className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-stack font-medium">No connections yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Connect Sage, QuickBooks, Xero or your own system to stop entering fees and
            payments twice.
          </p>
        </Card>
      ) : null}

      {/*
        The Sage 50 export.

        Shown unconditionally, and ABOVE the dispatch warning's concern, because it is
        the one connector in this folder that needs no credential at all: Sage 50 is a
        desktop application with no cloud API, so the integration is a file the
        accountant downloads. Everything else here waits on OAuth, an API key, or
        `FIELD_ENCRYPTION_KEY`.

        ACCOUNTING_CONNECTORS.md notes Sage 50 Pastel is the most common accounting
        software in Zambian private schools, so this is also the connector most schools
        would actually use.
      */}
      <Card className="mb-cards p-card">
        <h2 className="flex items-center gap-2 font-medium">
          <Download className="h-4 w-4" />
          Sage 50 export
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A batch-import file for Sage 50 Pastel. Download it, then use Sage&rsquo;s batch
          import to bring the term&rsquo;s verified payments in without re-typing them.
        </p>

        <div className="mt-stack flex flex-wrap items-end gap-stack">
          {/* Was two bare <label> wrappers with no Field, so neither carried a
              hint, an error slot or the shared control styling. Verified payments
              cannot be in the future, hence `notFuture`. */}
          <DateRangeField
            idPrefix="sage"
            from={sageFrom}
            to={sageTo}
            onFromChange={setSageFrom}
            onToChange={setSageTo}
            notFuture
          />
          <Button
            type="button"
            variant="outline"
            disabled={!sageFrom || !sageTo || sageBusy}
            onClick={() => void downloadSage()}
          >
            <Download className="mr-2 h-4 w-4" />
            {sageBusy ? 'Preparing...' : 'Download CSV'}
          </Button>
        </div>

        <p className="mt-stack text-xs text-muted-foreground">
          {/*
            Said plainly, because an accountant importing this into real books needs to
            know what is NOT in it. A parent's unverified claim is not evidence money
            arrived, and a Sales Receipt asserts it did.
          */}
          Only <strong>verified</strong> payments are included. Unverified claims,
          reversals and waivers are left out, because each would overstate your income in
          Sage.
        </p>
      </Card>

      {data.integrations.map((row) => (
        <Card key={row.id} className="p-card">
          <div className="flex flex-wrap items-start justify-between gap-stack">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-medium">{row.name}</h2>
                <Badge variant="neutral">{TYPE_LABEL[row.type] ?? row.type}</Badge>
                {row.isPaused ? (
                  <Badge variant="warning">
                    <PauseCircle className="mr-1 h-3 w-3" />
                    Paused
                  </Badge>
                ) : null}
                {row.isActive ? null : <Badge variant="neutral">Switched off</Badge>}
              </div>

              <p className="mt-1 text-sm text-muted-foreground">
                {row.events.length === 0
                  ? 'No events chosen, so nothing would be sent.'
                  : `${row.events.length} event${row.events.length === 1 ? '' : 's'}: ${row.events
                      .map((e) => EVENT_LABEL[e] ?? e)
                      .join(', ')}`}
              </p>

              {/*
                Paused and switched off are different answers to "why has my accounting
                system gone quiet", and only one is the school's own doing.
              */}
              {row.isPaused && row.pauseReason ? (
                <p className="mt-1 text-sm text-warning">{row.pauseReason}</p>
              ) : null}
              {row.lastError ? (
                <p className="mt-1 text-sm text-destructive">{row.lastError}</p>
              ) : null}
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                void send({ action: 'setActive', id: row.id, isActive: !row.isActive })
              }
            >
              {row.isActive ? 'Switch off' : 'Switch on'}
            </Button>
          </div>
        </Card>
      ))}
    </div>
  )
}
