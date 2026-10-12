'use client'

/**
 * Actioning a data subject request.
 *
 * Spec: `Official Documentation/01 Foundation Layer/COMPLIANCE.md`
 *         → *Data Subject Rights Procedures*
 *
 * ## Why this screen exists
 *
 * The ZDPA gives a data subject rights with clocks — access and erasure in 30 days,
 * portability in 14 — and AfriTech is the **controller**, so the obligation is AfriTech's
 * rather than the school's. `COMPLIANCE.md` documents all five rights and the procedure
 * for each, and until `0187` nothing implemented any of them. The honest answer to a real
 * request would have been a developer running SQL by hand against production, which is
 * itself a processing activity nobody logged.
 *
 * ## Erasure is deliberately slow to perform
 *
 * It cannot be undone, and it removes the evidence of why it happened. So the subject must
 * be found first, the reason typed, and the confirmation given against the name on screen
 * — three deliberate acts rather than a button beside a row, where it would sit next to
 * everything else somebody clicks on a busy afternoon.
 *
 * ## It reports what SURVIVES
 *
 * Erasure anonymises rather than deletes, because Zambian financial regulation requires
 * seven years of payment records. Whoever answers the subject has to be able to say
 * exactly what is retained and why, so the function returns it and this shows it.
 */

import type { JSX } from 'react'
import { useCallback, useState } from 'react'
import {
  AlertTriangle,
  Download,
  Inbox,
  Loader2,
  Search,
  ShieldAlert,
} from 'lucide-react'

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
import { ErrorState, PageHeader, TableSkeleton } from '../../../components/ui/data-states'
import { Field, Input, Select, Textarea } from '../../../components/ui/field'
import { FormGrid } from '../../../components/ui/form'
import { apiSend, useApi } from '../../../lib/use-api'
import { useToast } from '../../../components/ui/toast'

type Kind = 'student' | 'parent' | 'staff'

interface ErasureRequest {
  id: string
  user_id: string
  email: string | null
  subject_kind: string
  reason: string | null
  status: string
  requested_at: string
  action_after: string
  resolved_at: string | null
}

const KIND_LABEL: Record<string, string> = {
  parent: 'Parent',
  staff: 'School staff',
  teacher_hub: 'Teacher Hub',
  unknown: 'Not matched to a record',
}

export default function DataRequests(): JSX.Element {
  /*
    What people have asked for themselves.

    `0192` gave data subjects a way to ask without telephoning AfriTech, which is what
    the Act actually requires. Those requests landed in a table nothing displayed — a
    right exercised into a table nobody reads is not a right exercised.
  */
  const inbox = useApi<{
    requests: ErasureRequest[]
    pending: number
    retentionYears: number
  }>('/api/admin/data-subjects')
  const { toast } = useToast()

  const [kind, setKind] = useState<Kind>('student')
  const [id, setId] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState<'export' | 'erase' | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [retained, setRetained] = useState<string | null>(null)

  const exportSubject = useCallback(async () => {
    setBusy('export')
    setRetained(null)
    try {
      const result = await apiSend<{ export: unknown }>('/api/admin/data-subjects', 'POST', {
        action: 'export',
        kind,
        id: id.trim(),
      })

      if (result.error) {
        toast(result.error, 'danger')
        return
      }

      /*
        Downloaded, never rendered.

        An export is the subject's whole record — results, fees, medical notes in custom
        fields. Putting it on screen would leave it in a browser cache and over the
        shoulder of whoever walks past an AfriTech desk. A file hands it straight to the
        person answering the request.
      */
      const blob = new Blob([JSON.stringify(result.data?.export ?? {}, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `zsms-${kind}-${id.trim().slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)

      toast('Exported. The file has downloaded.', 'success')
    } finally {
      setBusy(null)
    }
  }, [kind, id, toast])

  const erase = useCallback(async () => {
    setBusy('erase')
    try {
      const result = await apiSend<{ retained: string; message: string }>(
        '/api/admin/data-subjects',
        'POST',
        { action: 'anonymise', kind, id: id.trim(), reason },
      )

      if (result.error) {
        toast(result.error, 'danger')
        return
      }

      setRetained(result.data?.retained ?? null)
      setConfirming(false)
      setReason('')
      toast(result.data?.message ?? 'Erased.', 'success')
    } finally {
      setBusy(null)
    }
  }, [kind, id, reason, toast])

  const ready = /^[0-9a-f-]{36}$/i.test(id.trim())

  return (
    <>
      <PageHeader
        title="Data subject requests"
        description="Access, portability and erasure under the Zambia Data Protection Act."
        note={`AfriTech is the data controller, so these are AfriTech's obligations and not the school's — access and erasure within 30 days, portability within 14. Erasure anonymises rather than deletes: payment records are kept for ${inbox.data?.retentionYears ?? 6} years, so amounts and dates are retained while the identifying columns are replaced. Every action here is recorded in an audit log nobody can edit, including AfriTech.`}
      />

      <div className="space-y-cards">
        {/*
          The queue's own loading and failure states, which this screen never had.

          It matters more here than on most screens. The list is a statutory clock —
          access and erasure within 30 days — and the old code rendered the queue only
          when it had rows. **A failed request and an empty queue looked identical**:
          both showed the manual lookup form and nothing else, so an operator whose
          request had failed would conclude nobody had asked.
        */}
        {inbox.loading && !inbox.data && !inbox.error && <TableSkeleton rows={3} columns={3} />}

        {inbox.error && (
          <ErrorState
            message={inbox.error}
            code={inbox.code}
            onRetry={inbox.reload}
          />
        )}

        {/*
          And an empty queue said explicitly. "Nobody has asked" is a fact an operator
          can act on; a missing section is not distinguishable from a broken one.
        */}
        {!inbox.loading && !inbox.error && (inbox.data?.requests.length ?? 0) === 0 && (
          <p className="text-sm text-muted-foreground">
            No access or erasure requests are waiting.
          </p>
        )}

        {/* People who have asked, before the manual tools. An operator opening this
            screen should see the queue, not a blank lookup form — the clock started
            when they asked, not when somebody noticed. */}
        {!inbox.error && (inbox.data?.requests.length ?? 0) > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Inbox aria-hidden="true" className="size-5 text-primary" />
                Asked for by the person
              </CardTitle>
              <CardDescription>
                {inbox.data?.pending
                  ? `${inbox.data.pending} waiting. Each can be withdrawn by the person until the date shown.`
                  : 'Nothing waiting.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border">
                {inbox.data?.requests.map((r: ErasureRequest) => (
                  <li key={r.id} className="flex flex-wrap items-start gap-2 py-stack">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {r.email ?? r.user_id}{' '}
                        <Badge variant="neutral">
                          {KIND_LABEL[r.subject_kind] ?? r.subject_kind}
                        </Badge>
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Asked {new Date(r.requested_at).toLocaleDateString('en-GB')}
                        {r.status === 'pending' && (
                          <>
                            {' · '}actionable from{' '}
                            {new Date(r.action_after).toLocaleDateString('en-GB')}
                          </>
                        )}
                      </p>
                      {r.reason && (
                        <p className="text-sm text-muted-foreground">
                          &ldquo;{r.reason}&rdquo;
                        </p>
                      )}
                      {/* The id the erasure tool below needs, so an operator does not
                          have to go and find it. */}
                      <p className="font-mono text-sm text-subtle">{r.user_id}</p>
                    </div>
                    <Badge
                      variant={
                        r.status === 'pending'
                          ? 'warning'
                          : r.status === 'completed'
                            ? 'success'
                            : 'neutral'
                      }
                    >
                      {r.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search aria-hidden="true" className="size-5 text-primary" />
              Which subject
            </CardTitle>
            <CardDescription>
              The internal id, from the pupil, parent or staff record. Not the pupil number.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <FormGrid columns={2}>
              <Field id="ds-kind" label="Kind" required>
                {(props) => (
                  <Select
                    {...props}
                    value={kind}
                    onChange={(e) => {
                      setKind(e.target.value as Kind)
                      setRetained(null)
                      setConfirming(false)
                    }}
                  >
                    <option value="student">Pupil</option>
                    <option value="parent">Parent or guardian</option>
                    <option value="staff">Member of staff</option>
                  </Select>
                )}
              </Field>

              <Field id="ds-id" label="Record id" required>
                {(props) => (
                  <Input
                    {...props}
                    value={id}
                    onChange={(e) => {
                      setId(e.target.value)
                      setRetained(null)
                      setConfirming(false)
                    }}
                    placeholder="00000000-0000-0000-0000-000000000000"
                    className="font-mono"
                  />
                )}
              </Field>
            </FormGrid>
          </CardContent>
        </Card>

        {/* ---- access and portability ---- */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download aria-hidden="true" className="size-5 text-primary" />
              Export everything held
            </CardTitle>
            <CardDescription>
              Answers both the right of access and the right to portability. Downloads as a
              file rather than appearing on screen — an export is the subject&rsquo;s whole
              record and should not sit in a browser cache.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button disabled={!ready || busy !== null} onClick={() => void exportSubject()}>
              {busy === 'export' && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
              Export this subject
            </Button>
          </CardContent>
        </Card>

        {/* ---- erasure ---- */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert aria-hidden="true" className="size-5 text-danger" />
              Erase
            </CardTitle>
            <CardDescription>
              Replaces the identifying columns with the markers the compliance policy
              specifies. Financial records keep their amounts and dates. This cannot be
              undone.
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col gap-cards">
            {retained && (
              <Alert variant="info" title="Done — here is what was retained">
                {retained}
              </Alert>
            )}

            <Field
              id="ds-reason"
              label="Why was this requested?"
              hint="Recorded permanently. Erasure removes the evidence of why it happened, so this is the only thing that survives to answer for it."
            >
              {(props) => (
                <Textarea
                  {...props}
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Parent exercised their right to erasure by email on 2 October 2026"
                />
              )}
            </Field>

            {!confirming ? (
              <Button
                variant="outline"
                disabled={!ready || reason.trim().length < 8 || busy !== null}
                onClick={() => setConfirming(true)}
              >
                Erase this subject
              </Button>
            ) : (
              <Alert variant="danger" title="This cannot be undone">
                <div className="flex flex-col gap-stack">
                  <p>
                    The {kind === 'student' ? 'pupil' : kind === 'parent' ? 'parent' : 'staff'}{' '}
                    record <span className="font-mono">{id.trim()}</span> will be anonymised
                    permanently. Their name becomes &ldquo;DATA SUBJECT DELETED&rdquo; and
                    their account link is cleared, so the same person cannot be
                    re-associated with it.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="destructive"
                      disabled={busy !== null}
                      onClick={() => void erase()}
                    >
                      {busy === 'erase' && (
                        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                      )}
                      <AlertTriangle aria-hidden="true" />
                      Yes, erase permanently
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirming(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
