'use client'

/**
 * AI settings — the platform switch for live generation.
 *
 * Spec: `Official Documentation/18 AI Module/AI_OVERVIEW.md`
 *
 * ## What this screen is for
 *
 * Until 2026-10-05 whether AI was on lived in `AI_GENERATOR` in an environment file.
 * Turning it off meant a redeployment, and nothing in the product said which state it
 * was in — so the only way to answer "is AI on?" was to ask the one person who could
 * read the file.
 *
 * ## It leads with what the system will actually DO
 *
 * Three things decide that: the toggle, the deployment's veto (`AI_GENERATOR=off`), and
 * whether any provider key exists. A screen that showed only the toggle would let
 * somebody switch it on, see nothing change, and have no way to find out why — which is
 * the same silent no-op the environment variable caused.
 *
 * So `effective` is the headline and the toggle is one input to it.
 *
 * ## The reason field is not optional
 *
 * The database refuses a blank one. This switch governs platform-wide spending, and the
 * question asked three months later is never "was it on" but "why was it turned on".
 */

import type { JSX } from 'react'
import { useCallback, useState } from 'react'
import { Sparkles, ShieldAlert, KeyRound } from 'lucide-react'

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
import { Field, Textarea } from '../../../components/ui/field'
import { useToast } from '../../../components/ui/toast'
import { apiSend, useApi } from '../../../lib/use-api'

interface Payload {
  enabled: boolean
  updatedBy: string | null
  updatedAt: string | null
  description: string | null
  environmentForbids: boolean
  providerKeys: { openai: boolean; anthropic: boolean }
  effective: boolean
}

export default function AiSettingsPage(): JSX.Element {
  const { toast } = useToast()
  const { data, loading, error, code, reload } = useApi<Payload>('/api/admin/ai')

  /** Null when closed; otherwise the direction being confirmed. */
  const [pending, setPending] = useState<boolean | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = useCallback(async () => {
    if (pending === null) return
    setBusy(true)
    try {
      const result = await apiSend<{ enabled: boolean; warning: string | null }>(
        '/api/admin/ai',
        'PATCH',
        { enabled: pending, reason },
      )
      if (result.error) {
        toast(result.error, 'danger')
        return
      }
      setPending(null)
      setReason('')
      // The warning matters more than the success, so it is what gets said.
      toast(
        result.data?.warning ??
          (result.data?.enabled ? 'Live AI generation is on.' : 'Live AI generation is off.'),
        result.data?.warning ? 'danger' : 'success',
      )
      reload()
    } finally {
      setBusy(false)
    }
  }, [pending, reason, toast, reload])

  if (loading && !data) return <TableSkeleton rows={4} columns={2} />
  if (error) return <ErrorState message={error} code={code} onRetry={reload} />

  const noKeys = !data?.providerKeys.openai && !data?.providerKeys.anthropic

  return (
    <>
      <PageHeader
        title="AI settings"
        description="Whether lesson plans, quizzes and curriculum extraction call a real model."
        note="Off is not broken — it serves the template scaffold, which is a working structured plan. On spends AI credits on every generation."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles aria-hidden="true" className="size-5 text-primary" />
            Live generation
            {/* What the system will DO, not what the toggle says. */}
            <Badge variant={data?.effective ? 'success' : 'neutral'}>
              {data?.effective ? 'On' : 'Off'}
            </Badge>
          </CardTitle>
          <CardDescription>
            {data?.effective
              ? 'Generations are being answered by a model.'
              : 'Generations are being answered by the template scaffold.'}
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-cards">
          {/*
            The deployment's veto, stated as its own thing.

            Somebody switching the toggle on here and seeing "Off" above needs to be told
            why in the same glance, or they will assume the toggle is broken.
          */}
          {data?.environmentForbids && (
            <Alert variant="warning" title="This deployment forbids live generation">
              <span className="flex items-start gap-2">
                <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <span>
                  <code>AI_GENERATOR=off</code> is set here, which overrides the toggle. That
                  exists so an environment sharing production keys cannot be switched on from
                  a web page. Changing it needs a deployment.
                </span>
              </span>
            </Alert>
          )}

          {noKeys && (
            <Alert variant="warning" title="No provider key is configured">
              <span className="flex items-start gap-2">
                <KeyRound aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <span>
                  Neither OpenAI nor Anthropic has a key here, so every generation falls back
                  to the template whatever this toggle says.
                </span>
              </span>
            </Alert>
          )}

          <dl className="grid gap-stack sm:grid-cols-2">
            <div>
              <dt className="text-sm text-muted-foreground">Toggle</dt>
              <dd className="font-medium">{data?.enabled ? 'On' : 'Off'}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Providers with a key</dt>
              <dd className="flex flex-wrap gap-1.5">
                {/* Named rather than counted: failover direction depends on WHICH one,
                    and Anthropic is the only provider that reads a PDF natively. */}
                <Badge variant={data?.providerKeys.openai ? 'success' : 'neutral'}>
                  OpenAI {data?.providerKeys.openai ? '✓' : '—'}
                </Badge>
                <Badge variant={data?.providerKeys.anthropic ? 'success' : 'neutral'}>
                  Anthropic {data?.providerKeys.anthropic ? '✓' : '—'}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Last changed by</dt>
              <dd className="font-mono text-sm">{data?.updatedBy ?? 'never changed'}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">When</dt>
              <dd data-numeric className="text-sm">
                {data?.updatedAt ? new Date(data.updatedAt).toLocaleString() : '—'}
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap gap-2">
            <Button
              variant={data?.enabled ? 'outline' : 'default'}
              onClick={() => {
                setPending(!data?.enabled)
                setReason('')
              }}
            >
              {data?.enabled ? 'Switch it off' : 'Switch it on'}
            </Button>
          </div>

          {data?.description && (
            <p className="text-sm text-muted-foreground">{data.description}</p>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={pending !== null}
        title={pending ? 'Switch live AI generation on' : 'Switch live AI generation off'}
        description={
          pending
            ? 'Every generation will call a model and spend credits.'
            : 'Generations will be answered by the template scaffold, which is a working product.'
        }
        onClose={() => setPending(null)}
        footer={
          <>
            <Button disabled={busy || reason.trim().length < 8} onClick={() => void submit()}>
              {busy ? 'Saving…' : pending ? 'Switch it on' : 'Switch it off'}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setPending(null)}>
              Cancel
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-stack">
          <Field
            id="ai-reason"
            label="Why"
            required
            hint="Recorded in the audit trail. The question later is never whether it was on, but why."
          >
            {(props) => (
              <Textarea
                {...props}
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                placeholder={
                  pending
                    ? 'Importing the ECZ Mathematics syllabus for Grades 8 to 9.'
                    : 'Pausing spend until the credit top-up clears.'
                }
              />
            )}
          </Field>

          {pending && noKeys && (
            <Alert variant="warning" title="This will not do anything yet">
              No provider key is configured, so generations will still fall back to the
              template.
            </Alert>
          )}
        </div>
      </Dialog>
    </>
  )
}
