'use client'

/**
 * Platform settings — every switch that applies to the whole of ZSMS.
 *
 * Spec: `Official Documentation/15 Super Admin and Platform/SUPERADMIN.md`,
 *       `Official Documentation/01 Foundation Layer/DYNAMIC_CONFIG.md`, ADR-031
 *
 * ## Why one screen
 *
 * Asked for on 2026-10-06: the toggles were turning up in several places — an AI page of
 * its own, a feature matrix, and more to come for payment gateways and the loan module.
 * One place to look is worth more than each one being perfectly sited.
 *
 * Grouped rather than listed, because "days before an erasure request is actioned" and
 * "assistant interactions per person per day" are not the same kind of decision and a
 * flat list of five invites changing the wrong one.
 *
 * ## Every change states a reason
 *
 * The database refuses a blank one. `afritech` tables carry no row-change trigger, so the
 * audit call is the only record a setting moved — and the question months later is never
 * what a value is but why it was changed.
 *
 * ## What is NOT here
 *
 * Per-school feature access, which is the Feature matrix — a different question
 * (what does this school get) from this one (how does the platform behave). Linked
 * rather than merged, because merging them would put a 18×5 grid inside a settings form.
 */

import type { JSX } from 'react'
import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { KeyRound, ShieldAlert, SlidersHorizontal, ToggleRight } from 'lucide-react'

import { Alert } from '../../../components/ui/alert'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card'
import { Dialog } from '../../../components/ui/dialog'
import { ErrorState, PageHeader, TableSkeleton } from '../../../components/ui/data-states'
import { Field, Input, Select, Textarea } from '../../../components/ui/field'
import { useToast } from '../../../components/ui/toast'
import { apiSend, useApi } from '../../../lib/use-api'

interface Setting {
  key: string
  value: string
  description: string
  updatedBy: string | null
  updatedAt: string | null
  kind: 'boolean' | 'integer' | 'text'
  label: string
  group: string
  min: number | null
  max: number | null
}

interface Payload {
  settings: Setting[]
  aiEnvironmentForbids: boolean
  providerKeys: { openai: boolean; anthropic: boolean }
}

export default function PlatformSettingsPage(): JSX.Element {
  const { toast } = useToast()
  const { data, loading, error, code, reload } = useApi<Payload>('/api/admin/settings')

  /** The setting being changed, with its pending value. Null when closed. */
  const [editing, setEditing] = useState<{ setting: Setting; value: string } | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  /** Grouped, in a stable order — AI first, because it is the one that spends money. */
  const groups = useMemo(() => {
    const byGroup = new Map<string, Setting[]>()
    for (const s of data?.settings ?? []) {
      const list = byGroup.get(s.group) ?? []
      list.push(s)
      byGroup.set(s.group, list)
    }
    const order = ['AI', 'Data protection', 'Other']
    return [...byGroup.entries()].sort(
      (a, b) =>
        (order.indexOf(a[0]) === -1 ? 99 : order.indexOf(a[0])) -
        (order.indexOf(b[0]) === -1 ? 99 : order.indexOf(b[0])),
    )
  }, [data])

  const aiLive = data?.settings.find((s) => s.key === 'ai_live_generation')?.value === 'true'
  const noKeys = !data?.providerKeys.openai && !data?.providerKeys.anthropic

  const save = useCallback(async () => {
    if (!editing) return
    setBusy(true)
    try {
      const result = await apiSend<{ warning: string | null }>('/api/admin/settings', 'PATCH', {
        key: editing.setting.key,
        value: editing.value,
        reason,
      })
      if (result.error) {
        toast(result.error, 'danger')
        return
      }
      setEditing(null)
      setReason('')
      // The warning matters more than the success, so it is what gets said.
      toast(result.data?.warning ?? 'Saved.', result.data?.warning ? 'danger' : 'success')
      reload()
    } finally {
      setBusy(false)
    }
  }, [editing, reason, toast, reload])

  if (loading && !data) return <TableSkeleton rows={5} columns={2} />
  if (error) return <ErrorState message={error} code={code} onRetry={reload} />

  return (
    <>
      <PageHeader
        title="Platform settings"
        description="Switches that apply to every school on ZSMS."
        note="Each change is recorded with the reason you give. These are platform-wide — what an individual school gets is the Feature matrix."
      />

      {/*
        The deployment's veto, stated as its own thing.

        Somebody switching live generation on and seeing nothing change needs to be told
        why in the same glance, or they will assume the toggle is broken.
      */}
      {data?.aiEnvironmentForbids && (
        <Alert variant="warning" title="This deployment forbids live AI generation" className="mb-cards">
          <span className="flex items-start gap-2">
            <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              <code>AI_GENERATOR=off</code> is set here and overrides the toggle below. That
              exists so an environment sharing production keys cannot be switched on from a
              web page. Changing it needs a deployment.
            </span>
          </span>
        </Alert>
      )}

      {aiLive && noKeys && (
        <Alert variant="warning" title="AI is on but no provider key is configured" className="mb-cards">
          <span className="flex items-start gap-2">
            <KeyRound aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              Neither OpenAI nor Anthropic has a key here, so every generation falls back to
              the template whatever the toggle says.
            </span>
          </span>
        </Alert>
      )}

      {groups.map(([group, settings]) => (
        <Card key={group} className="mb-cards">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SlidersHorizontal aria-hidden="true" className="size-5 text-primary" />
              {group}
            </CardTitle>
            {group === 'AI' && (
              <CardDescription>
                Off is not broken — generation falls back to the template scaffold, which is
                a working structured plan. On spends AI credits per call.
              </CardDescription>
            )}
          </CardHeader>

          <CardContent>
            <ul className="divide-y divide-border">
              {settings.map((s) => (
                <li key={s.key} className="flex flex-wrap items-start gap-stack py-stack">
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex items-center gap-2 font-medium">
                      {s.label}
                      {s.kind === 'boolean' && (
                        <Badge variant={s.value === 'true' ? 'success' : 'neutral'}>
                          {s.value === 'true' ? 'On' : 'Off'}
                        </Badge>
                      )}
                      {s.kind !== 'boolean' && (
                        <Badge variant="neutral">
                          <span data-numeric>{s.value}</span>
                        </Badge>
                      )}
                    </span>
                    <span className="text-sm text-muted-foreground">{s.description}</span>
                    {s.updatedBy && (
                      <span className="text-xs text-muted-foreground">
                        {/* Who moved it, because a platform-wide switch needs an owner
                            and the audit log is a screen nobody checks first. */}
                        Last changed by <span className="font-mono">{s.updatedBy}</span>
                        {s.updatedAt && ` on ${new Date(s.updatedAt).toLocaleDateString()}`}
                      </span>
                    )}
                  </span>

                  <Button
                    variant="outline"
                    size="sm"
                    className="ml-auto"
                    onClick={() => {
                      setEditing({
                        setting: s,
                        // A boolean opens pre-flipped: the only thing anybody wants to
                        // do with it is change it.
                        value: s.kind === 'boolean' ? (s.value === 'true' ? 'false' : 'true') : s.value,
                      })
                      setReason('')
                    }}
                  >
                    {s.kind === 'boolean' ? (s.value === 'true' ? 'Switch off' : 'Switch on') : 'Change'}
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ToggleRight aria-hidden="true" className="size-5 text-primary" />
            Per-school features
          </CardTitle>
          <CardDescription>
            What an individual school gets is a different question from how the platform
            behaves.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" asChild>
            <Link href="/admin/features">Open the feature matrix</Link>
          </Button>
        </CardContent>
      </Card>

      <Dialog
        open={editing !== null}
        title={editing ? `Change ${editing.setting.label}` : ''}
        description="Every school is affected. The reason is recorded."
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button disabled={busy || reason.trim().length < 8} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </>
        }
      >
        {editing && (
          <div className="flex flex-col gap-stack">
            <Field id="s-value" label={editing.setting.label} required>
              {(props) =>
                editing.setting.kind === 'boolean' ? (
                  <Select
                    {...props}
                    value={editing.value}
                    onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                  >
                    <option value="true">On</option>
                    <option value="false">Off</option>
                  </Select>
                ) : (
                  <Input
                    {...props}
                    type={editing.setting.kind === 'integer' ? 'number' : 'text'}
                    min={editing.setting.min ?? undefined}
                    max={editing.setting.max ?? undefined}
                    value={editing.value}
                    onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                  />
                )
              }
            </Field>

            <p className="text-sm text-muted-foreground">{editing.setting.description}</p>

            <Field
              id="s-reason"
              label="Why"
              required
              hint="Recorded in the audit trail. The question later is never what the value is, but why it changed."
            >
              {(props) => (
                <Textarea
                  {...props}
                  rows={3}
                  value={reason}
                  maxLength={500}
                  onChange={(e) => setReason(e.target.value)}
                />
              )}
            </Field>

            {editing.setting.key === 'ai_live_generation' &&
              editing.value === 'true' &&
              noKeys && (
                <Alert variant="warning" title="This will not do anything yet">
                  No provider key is configured, so generations will still fall back to the
                  template.
                </Alert>
              )}
          </div>
        )}
      </Dialog>
    </>
  )
}
