'use client'

/**
 * Teachers asking to be linked to this school.
 *
 * Spec: `Official Documentation/13 Teacher Portal/TEACHER_PORTAL.md`
 *       `Official Documentation/04 Staff Management/STAFF.md`
 *
 * ## It lives on the Staff screen, not a screen of its own
 *
 * Approving one of these sends the same invitation the Staff screen sends. Putting it
 * anywhere else would mean two places that add a member to the school, and whoever is
 * looking at the staff list is already the person who decides.
 *
 * It renders nothing at all when there are no requests. A school with none should not
 * carry a permanently empty panel explaining a feature it is not using.
 *
 * ## The copy is deliberately cautious
 *
 * A request is an unverified claim by a stranger who typed in a code. The panel says so:
 * "says they work here". Nothing about the request proves employment, and the person
 * approving needs to recognise the name rather than trust the screen — so the teacher's own
 * note is shown prominently, because that is the only evidence there is.
 */

import type { JSX } from 'react'
import { useCallback, useState } from 'react'
import { Check, Loader2, UserPlus, X } from 'lucide-react'

import { Button } from '../../../../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../../components/ui/card'
import { useApi } from '../../../../lib/use-api'
import { useToast } from '../../../../components/ui/toast'

interface PendingRequest {
  id: string
  requester_name: string
  requester_email: string
  note: string | null
  requested_at: string
}

/** Roles a join request may grant. Mirrors the server's list; owner is not among them. */
const ROLES = [
  { value: 'org:teacher', label: 'Teacher' },
  { value: 'org:admin', label: 'Administrator' },
  { value: 'org:staff', label: 'Staff (no default access)' },
] as const

export function JoinRequests(): JSX.Element | null {
  const { data, reload } = useApi<{ requests: PendingRequest[] }>('/api/school/join-requests')
  const { toast } = useToast()

  const [busyId, setBusyId] = useState<string | null>(null)
  const [roles, setRoles] = useState<Record<string, string>>({})

  const decide = useCallback(
    async (requestId: string, approve: boolean) => {
      setBusyId(requestId)
      try {
        const response = await fetch('/api/school/join-requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId,
            approve,
            role: approve ? (roles[requestId] ?? 'org:teacher') : undefined,
          }),
        })
        const body = await response.json()

        if (!response.ok) {
          toast(body?.error ?? 'That could not be saved.', 'danger')
          return
        }

        /*
          `invited: false` on an approval is the case worth surfacing loudly: the request is
          marked approved but no invitation went out, so the teacher is waiting for an email
          that was never sent. The route explains what to do; passing its message through is
          better than a generic success.
        */
        if (approve && body?.data?.invited === false) {
          toast(body.data.message ?? 'Approved, but no invitation was sent.', 'danger')
        } else {
          toast(
            approve ? 'Approved — an invitation has been sent.' : 'Request declined.',
            'success',
          )
        }

        reload()
      } finally {
        setBusyId(null)
      }
    },
    [roles, reload, toast],
  )

  const requests = data?.requests ?? []
  // See the header: no empty-state panel.
  if (requests.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus aria-hidden="true" className="size-5 text-primary" />
          Teachers asking to join
          <span
            data-numeric
            className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground"
          >
            {requests.length}
          </span>
        </CardTitle>
        <CardDescription>
          Each of these is someone with a Teacher Hub account who entered your school code
          and says they work here. Approving sends them a staff invitation — check you
          recognise the name first.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <ul className="flex flex-col gap-3">
          {requests.map((request) => (
            <li
              key={request.id}
              className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3"
            >
              <div className="min-w-0">
                <p className="font-medium">{request.requester_name}</p>
                <p className="truncate text-sm text-muted-foreground">
                  {request.requester_email}
                </p>
                {request.note && (
                  // The only evidence there is — see the header.
                  <p className="mt-2 rounded border-l-2 border-primary/40 bg-muted/40 px-3 py-2 text-sm">
                    &ldquo;{request.note}&rdquo;
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor={`role-${request.id}`} className="text-sm text-muted-foreground">
                  Join as
                </label>
                <select
                  id={`role-${request.id}`}
                  value={roles[request.id] ?? 'org:teacher'}
                  onChange={(e) => setRoles((r) => ({ ...r, [request.id]: e.target.value }))}
                  className="min-h-tap rounded-md border border-border bg-background px-2 text-sm"
                >
                  {ROLES.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>

                <div className="ml-auto flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyId === request.id}
                    onClick={() => decide(request.id, false)}
                  >
                    <X aria-hidden="true" />
                    Decline
                  </Button>
                  <Button
                    size="sm"
                    disabled={busyId === request.id}
                    onClick={() => decide(request.id, true)}
                  >
                    {busyId === request.id ? (
                      <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                    ) : (
                      <Check aria-hidden="true" />
                    )}
                    Approve &amp; invite
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
