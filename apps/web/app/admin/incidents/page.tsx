'use client'

/**
 * Incidents — what is currently broken, and what AfriTech has done about it.
 *
 * Spec: `Official Documentation/15 Super Admin and Platform/SUPERADMIN.md`
 *
 * ## The screen a dead API key is discovered on
 *
 * Before `0134` nothing in ZSMS recorded a failure anywhere — no Sentry, no capture, no funnel.
 * This is the surface that changes that, so it is built for one question: *is anything wrong right
 * now, and is it my problem?*
 *
 * Which is why the count is the first thing on the page and the list is sorted worst-first rather
 * than newest-first. Newest-first is what a log wants; an operator wants the worst thing.
 *
 * ## Acknowledged is not resolved, and the difference is the point
 *
 * "Acknowledged" says a human has seen it. "Resolved" says a human has fixed it. Keeping them
 * apart is what stops an incident being clicked away before the key is topped up — and a resolved
 * incident that recurs re-opens itself, so a premature resolve corrects itself rather than hiding
 * the problem.
 */

import type { JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, ShieldAlert, Siren } from 'lucide-react'

import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'
import { Field, Select } from '../../../components/ui/field'
import { EmptyState } from '../../../components/ui/empty-state'
import { ErrorState, PageHeader, TableSkeleton } from '../../../components/ui/data-states'
import { StatCard } from '../../../components/ui/stat-card'
import { useToast } from '../../../components/ui/toast'

interface Incident {
  id: string
  source: string
  kind: string
  severity: string
  title: string
  detail: string | null
  occurrence_count: number
  first_seen_at: string
  last_seen_at: string
  status: string
  acknowledged_by: string | null
  resolved_by: string | null
  resolution_note: string | null
  metadata: Record<string, unknown>
}

interface Payload {
  incidents: Incident[]
  counts: { critical: number; error: number; warning: number; open: number }
}

const SEVERITY_ICON = {
  critical: Siren,
  error: ShieldAlert,
  warning: AlertTriangle,
  info: Info,
} as const

const SEVERITY_VARIANT = {
  critical: 'danger',
  error: 'danger',
  warning: 'warning',
  info: 'info',
} as const

const when = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diff / 60_000)
  // Relative, because "is this happening NOW" is the only question being asked of these
  // timestamps. An absolute time would need mental arithmetic to answer it.
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export default function IncidentsPage(): JSX.Element {
  const { toast } = useToast()
  const [payload, setPayload] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('open')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/admin/incidents?status=${filter}`)
      const body = (await response.json()) as { data?: Payload; error?: string }
      if (!response.ok) {
        setError(body.error ?? 'Could not load incidents.')
        setLoading(false)
        return
      }
      setError(null)
      setPayload(body.data ?? null)
    } catch {
      setError('Could not reach the server.')
    }
    setLoading(false)
  }, [filter])

  useEffect(() => {
    void load()
  }, [load])

  const setStatus = async (id: string, status: string): Promise<void> => {
    setBusy(id)
    try {
      const response = await fetch('/api/admin/incidents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incidentId: id, status }),
      })
      const body = (await response.json()) as { error?: string }
      toast(
        response.ok ? `Marked ${status}.` : (body.error ?? 'That did not work.'),
        response.ok ? 'success' : 'danger',
      )
      if (response.ok) void load()
    } catch {
      toast('Could not reach the server.', 'danger')
    }
    setBusy(null)
  }

  const incidents = payload?.incidents ?? []
  const counts = payload?.counts

  return (
    <>
      <PageHeader
        title="Incidents"
        description="Failures ZSMS has recorded across the platform — AI providers, messaging, payments, workers."
        note={
          <>
            An incident is one <strong>problem</strong>, not one occurrence: a dead API key that
            fails two hundred times is a single row with a count of two hundred. Resolving an
            incident that happens again re-opens it, so marking something fixed prematurely
            corrects itself.
          </>
        }
      />

      <div className="space-y-cards">
        {counts && (
          <div className="grid gap-4 sm:grid-cols-4">
            <StatCard label="Open" value={String(counts.open)} tone={counts.open > 0 ? 'warning' : 'success'} />
            <StatCard label="Critical" value={String(counts.critical)} tone={counts.critical > 0 ? 'danger' : 'neutral'} />
            <StatCard label="Errors" value={String(counts.error)} tone={counts.error > 0 ? 'danger' : 'neutral'} />
            <StatCard label="Warnings" value={String(counts.warning)} tone={counts.warning > 0 ? 'warning' : 'neutral'} />
          </div>
        )}

        <Card>
          <CardContent className="pt-6">
            <Field id="filter-status" label="Show" className="sm:max-w-xs">
              {(props) => (
                <Select {...props} value={filter} onChange={(e) => setFilter(e.target.value)}>
                  <option value="open">Open and acknowledged</option>
                  <option value="acknowledged">Acknowledged only</option>
                  <option value="resolved">Resolved</option>
                  <option value="">Everything</option>
                </Select>
              )}
            </Field>
          </CardContent>
        </Card>

        {loading ? (
          <TableSkeleton rows={5} columns={3} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : incidents.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title={filter === 'open' ? 'Nothing is broken' : 'Nothing to show'}
            description={
              filter === 'open'
                ? 'No open incidents. Every provider, worker and integration that has reported in is behaving.'
                : 'No incidents match that filter.'
            }
          />
        ) : (
          <ul className="space-y-3">
            {incidents.map((incident) => {
              const Icon = SEVERITY_ICON[incident.severity as keyof typeof SEVERITY_ICON] ?? Info
              const variant =
                SEVERITY_VARIANT[incident.severity as keyof typeof SEVERITY_VARIANT] ?? 'neutral'

              return (
                <li key={incident.id}>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-start gap-4">
                        <Icon
                          className={
                            incident.severity === 'critical' || incident.severity === 'error'
                              ? 'size-5 shrink-0 text-danger'
                              : incident.severity === 'warning'
                                ? 'size-5 shrink-0 text-warning'
                                : 'size-5 shrink-0 text-muted-text'
                          }
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="font-semibold text-text">{incident.title}</h2>
                            <Badge variant={variant}>{incident.severity}</Badge>
                            {incident.status === 'acknowledged' && (
                              <Badge variant="info">Acknowledged</Badge>
                            )}
                            {incident.status === 'resolved' && (
                              <Badge variant="success">Resolved</Badge>
                            )}
                          </div>

                          {incident.detail && (
                            <p className="mt-1 text-sm text-muted-text">{incident.detail}</p>
                          )}

                          <p className="mt-2 text-xs text-muted-text">
                            {incident.source} · {incident.kind} ·{' '}
                            {/* The count is the severity signal a timestamp cannot give: once is
                                a blip, two hundred times is an outage. */}
                            <strong>
                              {incident.occurrence_count}{' '}
                              {incident.occurrence_count === 1 ? 'time' : 'times'}
                            </strong>{' '}
                            · last {when(incident.last_seen_at)} · first{' '}
                            {when(incident.first_seen_at)}
                          </p>

                          {incident.resolution_note && (
                            <p className="mt-2 text-xs text-muted-text">
                              Note: {incident.resolution_note}
                            </p>
                          )}

                          {incident.status !== 'resolved' && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {incident.status === 'open' && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={busy === incident.id}
                                  onClick={() => void setStatus(incident.id, 'acknowledged')}
                                >
                                  I am on it
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={busy === incident.id}
                                onClick={() => void setStatus(incident.id, 'resolved')}
                              >
                                Mark fixed
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </>
  )
}
