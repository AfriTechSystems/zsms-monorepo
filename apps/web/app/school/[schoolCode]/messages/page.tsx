'use client'

/**
 * Communication → Message log.
 *
 * Spec: `12 Communication System/MESSAGE_LOG.md` → *Admin Communication Log View*
 *
 * ## The banner is the most important thing on this screen
 *
 * Every channel runs through the mock provider today — no Meta, Twilio or Resend
 * credentials exist, so **nothing has left the machine**. A log that listed rows as
 * "sent" without saying so would read as proof of delivery, which is the single most
 * misleading thing this product could show a school chasing unpaid fees.
 *
 * The route reports `providerIsMock` from the environment rather than the screen
 * hardcoding it, so the banner disappears when credentials are configured and not a
 * deployment later.
 *
 * ## Read-only on purpose
 *
 * A delivery record is the provider's word about what happened. `authenticated` holds
 * SELECT and nothing else, and the pgTAP suite asserts no end-user role can INSERT or
 * UPDATE — so there is nothing to edit here and no control that pretends otherwise.
 */

import type { JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { TriangleAlert, CornerDownRight, Mail, MessageSquare, Smartphone } from 'lucide-react'

import { Alert } from '../../../../components/ui/alert'
import { Badge } from '../../../../components/ui/badge'
import { Card, CardContent } from '../../../../components/ui/card'
import { ErrorState, PageHeader, TableSkeleton } from '../../../../components/ui/data-states'
// `EmptyState` lives in its own module, not in data-states.
import { EmptyState } from '../../../../components/ui/empty-state'
import { Input, Select } from '../../../../components/ui/field'

interface Message {
  id: string
  channel: string
  templateKey: string
  recipient: string
  studentName: string | null
  status: string
  sentAt: string | null
  deliveredAt: string | null
  readAt: string | null
  failedAt: string | null
  failureReason: string | null
  retryCount: number
  isFallback: boolean
  fallbackOfId: string | null
  consumedQuota: boolean
  createdAt: string
}

const CHANNEL_ICON: Record<string, typeof Mail> = {
  whatsapp: MessageSquare,
  sms: Smartphone,
  email: Mail,
  push: Smartphone,
  in_app: MessageSquare,
}

/** `delivered` and `read` are successes; `failed` is not; `queued` is neither. */
function statusTone(status: string): 'neutral' | 'warning' | 'danger' {
  if (status === 'failed') return 'danger'
  if (status === 'queued' || status === 'sent') return 'warning'
  return 'neutral'
}

export default function MessageLogPage(): JSX.Element {
  const [messages, setMessages] = useState<Message[]>([])
  const [providerIsMock, setProviderIsMock] = useState(false)
  const [channel, setChannel] = useState('')
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (channel) params.set('channel', channel)
      if (status) params.set('status', status)
      if (search.trim()) params.set('search', search.trim())

      const response = await fetch(`/api/school/messages/log?${params.toString()}`)
      const body = await response.json()
      if (!response.ok) {
        setError(body.error ?? 'Could not load the message log.')
        return
      }
      setMessages(body.data?.messages ?? [])
      setProviderIsMock(Boolean(body.data?.providerIsMock))
      setError(null)
    } catch {
      setError('Could not reach the server.')
    } finally {
      setLoading(false)
    }
  }, [channel, status, search])

  useEffect(() => {
    void load()
  }, [load])

  if (error) return <ErrorState message={error} onRetry={() => void load()} />

  return (
    <div>
      <PageHeader
        title="Message log"
        description="Every message ZSMS has prepared on your behalf, and what became of it."
      />

      {providerIsMock && (
        <Alert variant="warning" className="mb-cards">
          <span className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong>No messages are actually being delivered yet.</strong> ZSMS has no
              WhatsApp, SMS or email account connected, so the rows below record what
              <em> would</em> be sent. Nothing has reached a parent. Connecting a provider
              is an AfriTech setup step — ask before relying on any of this to chase a
              fee.
            </span>
          </span>
        </Alert>
      )}

      <Card className="mb-cards">
        <CardContent className="p-card">
          <div className="flex flex-wrap items-end gap-stack">
            <label className="block">
              <span className="text-sm font-medium">Channel</span>
              <Select
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                className="mt-1"
              >
                <option value="">All channels</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="sms">SMS</option>
                <option value="email">Email</option>
                <option value="push">Phone notification</option>
                <option value="in_app">In the portal</option>
              </Select>
            </label>

            <label className="block">
              <span className="text-sm font-medium">Status</span>
              <Select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="mt-1"
              >
                <option value="">Any status</option>
                <option value="queued">Queued</option>
                <option value="sent">Sent</option>
                <option value="delivered">Delivered</option>
                <option value="read">Read</option>
                <option value="failed">Failed</option>
              </Select>
            </label>

            <label className="block flex-1 min-w-[12rem]">
              <span className="text-sm font-medium">Recipient</span>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Phone or email"
                className="mt-1"
              />
            </label>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <TableSkeleton rows={8} columns={5} />
      ) : messages.length === 0 ? (
        <EmptyState
          title="Nothing sent yet"
          description={
            channel || status || search
              ? 'No messages match these filters. Clear them to see everything.'
              : 'Once announcements, fee reminders or absence alerts go out, they appear here with what became of each one.'
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {messages.map((m) => {
                const Icon = CHANNEL_ICON[m.channel] ?? Mail
                return (
                  <li key={m.id} className="flex flex-wrap items-start gap-3 p-card">
                    <Icon className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />

                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {m.templateKey}
                        {/*
                          A fallback row is marked, because a school seeing
                          "email · delivered" deserves to know the WhatsApp attempt
                          before it did not arrive — that is the difference between a
                          working fallback chain and a channel quietly never working.
                        */}
                        {m.isFallback && (
                          <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
                            <CornerDownRight className="h-3 w-3" />
                            fallback
                          </span>
                        )}
                        {m.consumedQuota && (
                          <Badge variant="neutral">used quota</Badge>
                        )}
                      </p>

                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {m.studentName ? `${m.studentName} · ` : ''}
                        <span data-numeric>{m.recipient}</span>
                        {' · '}
                        <span data-numeric>
                          {new Date(m.createdAt).toLocaleString('en-GB', {
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </p>

                      {/*
                        The reason, always, when there is one. "Failed" alone is not
                        something a school office can act on; "invalid number" is.
                      */}
                      {m.failureReason && (
                        <p className="mt-1 text-xs text-destructive">
                          {m.failureReason}
                          {m.retryCount > 0 && (
                            <span className="text-muted-foreground">
                              {' '}
                              · tried <span data-numeric>{m.retryCount + 1}</span> times
                            </span>
                          )}
                        </p>
                      )}
                    </div>

                    <Badge variant={statusTone(m.status)}>{m.status}</Badge>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
