'use client'

/**
 * "Is your school on ZSMS?" — the card that now does something.
 *
 * Spec: `Official Documentation/13 Teacher Portal/TEACHER_PORTAL.md`
 *
 * ## What this replaces
 *
 * An informational card that said asking the school to invite you was the only path, and
 * explained that a code box "cannot work" because ZSMS invites server-side. That was true
 * of the code at the time and is no longer: `0160` added the request, and approval routes
 * into the same server-side invitation the staff screen uses. The box works now.
 *
 * ## The code, and why there is no search
 *
 * A school is named by its exact code, never searched by name. A name search would confirm
 * to anybody with a free Hub account which schools are ZSMS customers — including the ones
 * that deliberately stayed out of the public directory.
 *
 * The consequence lands here, in the copy: a teacher who mistypes their code gets a pending
 * request that is never answered, because the server cannot tell them the code matched
 * nothing without becoming that oracle. So the card states the format, shows the request as
 * pending, and makes withdrawing obvious — which is the honest version of a trade-off that
 * cannot be designed away.
 *
 * ## Nothing here blocks the Hub
 *
 * A pending request changes nothing about what the teacher can do. The Hub is usable on a
 * personal account whether or not a school ever answers, which is the point of a standalone
 * product — and the copy says so, so nobody waits for permission they do not need.
 */

import type { JSX } from 'react'
import { useCallback, useState } from 'react'
import { Building2, Check, Clock, Loader2, X } from 'lucide-react'

import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card'
import { useApi } from '../../lib/use-api'

interface JoinRequest {
  id: string
  status: 'pending' | 'approved' | 'declined' | 'withdrawn'
  note: string | null
  requested_at: string
  decided_at: string | null
  granted_role: string | null
  schools: { name: string; school_id: string } | null
}

const STATUS: Record<
  JoinRequest['status'],
  { label: string; tone: 'neutral' | 'success' | 'primary'; icon: typeof Clock }
> = {
  pending: { label: 'Waiting for the school', tone: 'primary', icon: Clock },
  approved: { label: 'Approved', tone: 'success', icon: Check },
  declined: { label: 'Not approved', tone: 'neutral', icon: X },
  withdrawn: { label: 'Withdrawn', tone: 'neutral', icon: X },
}

export function SchoolLinkCard({
  defaultName,
  defaultEmail,
}: {
  defaultName: string
  defaultEmail: string
}): JSX.Element {
  const { data, loading, reload } = useApi<{ requests: JoinRequest[] }>(
    '/api/teacher/school-link',
  )

  const [code, setCode] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const requests = data?.requests ?? []
  const pending = requests.filter((r) => r.status === 'pending')

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      setBusy(true)
      setError(null)
      setMessage(null)

      try {
        const response = await fetch('/api/teacher/school-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            schoolCode: code.trim().toUpperCase(),
            fullName: defaultName,
            email: defaultEmail,
            note: note.trim() || undefined,
          }),
        })
        const body = await response.json()

        if (!response.ok) {
          setError(body?.error ?? 'That request could not be sent.')
          return
        }

        setMessage(body?.data?.message ?? 'Your request has been sent to the school.')
        setCode('')
        setNote('')
        reload()
      } finally {
        setBusy(false)
      }
    },
    [code, note, defaultName, defaultEmail, reload],
  )

  const withdraw = useCallback(
    async (requestId: string) => {
      setBusy(true)
      setError(null)
      try {
        const response = await fetch('/api/teacher/school-link', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId }),
        })
        if (!response.ok) {
          const body = await response.json()
          setError(body?.error ?? 'That request could not be withdrawn.')
          return
        }
        reload()
      } finally {
        setBusy(false)
      }
    },
    [reload],
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 aria-hidden="true" className="size-5 text-primary" />
          Is your school on ZSMS?
        </CardTitle>
        <CardDescription>
          Ask to be linked and you will get attendance, marks and timetable alongside these
          tools. Everything in your library stays yours either way — including if you move
          school, and while you wait.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {requests.length > 0 && (
          <ul className="flex flex-col gap-2">
            {requests.map((request) => {
              const status = STATUS[request.status]
              const StatusIcon = status.icon
              return (
                <li
                  key={request.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-3 py-2"
                >
                  <StatusIcon aria-hidden="true" className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {/* The school's name once it is known. A request against a code that
                        matched nothing has no school to name, so the code stands in. */}
                    {request.schools?.name ?? 'Your request'}
                  </span>
                  <Badge variant={status.tone}>{status.label}</Badge>
                  {request.status === 'pending' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => withdraw(request.id)}
                    >
                      Withdraw
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {/* Three at once is the server's cap, so the form goes away rather than offering an
            action that will be refused. */}
        {pending.length >= 3 ? (
          <p className="text-sm text-muted-foreground">
            You have three requests waiting. Withdraw one to ask another school.
          </p>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="school-code" className="text-sm font-medium">
                School code
              </label>
              <input
                id="school-code"
                name="schoolCode"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="ZM-LSK-0001"
                autoComplete="off"
                // `characters` rather than `words`: this is an identifier, and a phone
                // keyboard that capitalises the first letter only would fight every entry.
                autoCapitalize="characters"
                required
                className="min-h-tap rounded-md border border-border bg-background px-3 font-mono uppercase placeholder:font-sans placeholder:normal-case focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <p className="text-xs text-muted-foreground">
                It looks like ZM-LSK-0001 and is printed on school documents. Ask the school
                office if you are not sure — we cannot look it up by name.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="school-note" className="text-sm font-medium">
                A note for the school <span className="text-subtle">(optional)</span>
              </label>
              <input
                id="school-note"
                name="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
                placeholder="I teach Grade 5 mathematics."
                className="min-h-tap rounded-md border border-border bg-background px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <p className="text-xs text-muted-foreground">
                Helps whoever reviews it recognise your name.
              </p>
            </div>

            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            {message && (
              <p role="status" className="text-sm text-success">
                {message}
              </p>
            )}

            <Button type="submit" disabled={busy || loading || code.trim().length === 0}>
              {busy && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
              Ask this school
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
