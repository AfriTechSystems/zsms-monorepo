'use client'

/**
 * Staff — who works here, what access they hold, and who has been invited.
 *
 * Spec: `Official Documentation/08 Staff Management/STAFF.md`
 *       `Official Documentation/02 Authentication and Identity/ROLES.md`
 *
 * ## One list, two kinds of row
 *
 * A member of staff exists in Clerk (the account and the role) and in
 * `staff_members` (the employment record), and either half can exist alone. The
 * list shows both and says which is missing, because the two gaps mean opposite
 * things: an account with no record is somebody already working who nobody has
 * filled in the paperwork for; a record with no account is somebody who cannot
 * sign in. Hiding either would make the screen wrong exactly when it is opened
 * to find out why someone cannot do something.
 *
 * ## Role names are ours
 *
 * Clerk knows `org:principal`; a school knows "Principal". Every role rendered
 * here goes through `ROLE_LABEL`, so nobody is asked to reason about a claim
 * string — and the invite form offers the five roles a school may actually
 * assign, not Clerk's built-in `admin` and `member`.
 */

import type { FormEvent, JSX } from 'react'
import { SectionTabs, useSectionTabs } from '../../../../components/ui/section-tabs'
import { Avatar } from '../../../../components/ui/avatar'
import { use, useCallback, useState } from 'react'
import { Loader2, MailPlus, ShieldOff, UserCog, X } from 'lucide-react'

import { apiSend, useApi } from '../../../../lib/use-api'
import { EditStaff } from './edit-staff'
import { ROLE_LABEL } from '../../../../lib/roles'
import { Alert } from '../../../../components/ui/alert'
import { Badge } from '../../../../components/ui/badge'
import { Button } from '../../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui/card'
import { DataTable } from '../../../../components/ui/data-table'
import { EmptyState } from '../../../../components/ui/empty-state'
import { JoinRequests } from './join-requests'
import { ErrorState, PageHeader, TableSkeleton } from '../../../../components/ui/data-states'
import { Field, Input, Select } from '../../../../components/ui/field'
import { FormActions, FormGrid, FormSection } from '../../../../components/ui/form'
import { formatDate } from '../school-shared'

interface StaffRow {
  id: string | null
  clerk_user_id: string
  staff_number: string | null
  phone_e164: string | null
  location: string | null
  qualifications: string | null
  photo_url: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  department: string | null
  employment_type: string | null
  join_date: string | null
  is_active: boolean
  role: string | null
  hasAccount: boolean
}

interface Invitation {
  id: string
  email: string
  role: string
  status: string
  createdAt: number
}

interface StaffPayload {
  staff: StaffRow[]
  invitations: Invitation[]
  accountsLoaded: boolean
  assignableRoles: string[]
  canManage: boolean
}

const fullName = (r: StaffRow): string =>
  [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || r.email || 'Unnamed'

/** Invite form. Two fields, because two is all an invitation needs. */
function InviteForm({ roles, onSent }: { roles: string[]; onSent: () => void }): JSX.Element {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState(roles[0] ?? 'org:teacher')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      setSending(true)
      setError(null)
      setSent(null)

      const result = await apiSend('/api/school/staff', 'POST', { email: email.trim(), role })

      setSending(false)
      if (result.error) {
        // Nothing is cleared on failure — a duplicate invitation is the most
        // likely error and the address is almost always right.
        setError(result.error)
        return
      }

      setSent(email.trim())
      setEmail('')
      onSent()
    },
    [email, role, onSent],
  )

  return (
    <FormSection
    title="Invite someone"
      description="They receive an email, choose a password, and land in this school with the role you pick."
    >
      <form onSubmit={submit} noValidate>
        <FormGrid columns={2}>
          <Field
            id="invite-email"
            label="Email address"
            required
            hint="The address the invitation is sent to."
          >
            {(props) => (
              <Input
                {...props}
                type="email"
                value={email}
                required
                maxLength={254}
                autoComplete="off"
                placeholder="teacher@school.co.zm"
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>

          <Field
            id="invite-role"
            label="Role"
            required
            hint="What they can do. Changeable afterwards."
          >
            {(props) => (
              <Select {...props} value={role} onChange={(e) => setRole(e.target.value)}>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r] ?? r}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </FormGrid>

        {error && (
          <Alert variant="danger" title="Invitation not sent" className="mt-stack">
            {error}
          </Alert>
        )}

        <FormActions>
          <Button type="submit" disabled={sending || !email.trim()}>
            {sending ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : (
              <MailPlus aria-hidden="true" />
            )}
            Send invitation
          </Button>
          <p role="status" aria-live="polite" className="text-sm text-success-text">
            {sent ? `Invitation sent to ${sent}.` : ''}
          </p>
        </FormActions>
      </form>
    </FormSection>
  )
}

export default function StaffPage({
  params,
}: {
  params: Promise<{ schoolCode: string }>
}): JSX.Element {
  use(params)

  const { data, loading, error, code, reload } = useApi<StaffPayload>('/api/school/staff')
  const [section, setSection] = useSectionTabs<'members' | 'invited' | 'invite'>('members', ['members', 'invited', 'invite'])
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState<StaffRow | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const canManage = data?.canManage === true

  const changeRole = useCallback(
    async (userId: string, role: string) => {
      setBusy(userId)
      setActionError(null)
      const result = await apiSend('/api/school/staff/members', 'PATCH', { userId, role })
      setBusy(null)
      if (result.error) {
        setActionError(result.error)
        return
      }
      reload()
    },
    [reload],
  )

  const revoke = useCallback(
    async (invitation: Invitation) => {
      const confirmed = window.confirm(
        `Withdraw the invitation to ${invitation.email}?\n\n` +
          'The link in their email stops working. They can be invited again later.',
      )
      if (!confirmed) return

      setBusy(invitation.id)
      setActionError(null)
      const result = await apiSend('/api/school/staff/members', 'DELETE', {
        invitationId: invitation.id,
      })
      setBusy(null)
      if (result.error) {
        setActionError(result.error)
        return
      }
      reload()
    },
    [reload],
  )

  const removeAccess = useCallback(
    async (row: StaffRow) => {
      const confirmed = window.confirm(
        `Remove ${fullName(row)}'s access to this school?\n\n` +
          'They can no longer sign in here. Their staff record, the registers they ' +
          'marked, and the marks they entered are all kept.',
      )
      if (!confirmed) return

      setBusy(row.clerk_user_id)
      setActionError(null)
      const result = await apiSend('/api/school/staff/members', 'DELETE', {
        userId: row.clerk_user_id,
      })
      setBusy(null)
      if (result.error) {
        setActionError(result.error)
        return
      }
      reload()
    },
    [reload],
  )

  return (
    <>
      <PageHeader
        title="Staff"
        description="Everyone who works here and the access they hold."
        note="A person needs a ROLE to sign in and a STAFF RECORD to appear on registers and mark sheets. Inviting someone creates the first; the second is filled in separately. Removing access never deletes their record or the work attached to it."
      />

      {/* A staff list grows without limit, and the invite form sat below all of it. */}
      <SectionTabs
        tabs={[
          { key: 'members', label: 'On the staff' },
          { key: 'invited', label: 'Invited' },
          { key: 'invite', label: 'Invite someone' },
        ]}
        active={section}
        onChange={setSection}
      />

      {/* Renders nothing when there are none — see the component. Placed above the
          staff list because an unanswered request is the thing on this screen that
          somebody is waiting on. */}
      <JoinRequests />

      {error && <ErrorState message={error} code={code} onRetry={reload} />}
      {loading && !data && !error && <TableSkeleton rows={6} columns={4} />}


      {/* Opened from a row's staff record. Above the table rather than inline, so a

          form with nine fields does not push the row being edited off screen. */}

      {editing && (

        <EditStaff

          staff={editing as never}

          onCancel={() => setEditing(null)}

          onSaved={() => {

            setEditing(null)

            reload()

          }}

        />

      )}


      {!error && data && (
        <div className="space-y-cards">
          {/* Said out loud rather than left as an empty column. An unreachable
              Clerk and a school with no accounts look identical otherwise. */}
          {!data.accountsLoaded && (
            <Alert variant="warning" title="Account details unavailable">
              The employment records below are current, but sign-in accounts and roles could not be
              loaded just now. Reload in a moment.
            </Alert>
          )}

          {actionError && (
            <Alert variant="danger" title="That did not work">
              {actionError}
            </Alert>
          )}

          {section === 'members' && (
            <Card>
              <CardHeader>
                <CardTitle>On the staff</CardTitle>
                <p className="text-sm text-muted-foreground">
                  A person needs a role to sign in, and a staff record to appear on registers and
                  mark sheets. Both are shown.
                </p>
              </CardHeader>
              <CardContent className="p-0">
                <DataTable
                  caption="Staff at this school"
                  rows={data.staff}
                  rowKey={(r) => r.clerk_user_id || (r.id ?? fullName(r))}
                  columns={[
                    {
                      key: 'person',
                      header: 'Person',
                      primary: true,
                      cell: (r) => (
                        /*
                          A face beside the name. `photo_url` has been on
                          `staff_members` and in this route's select the whole time;
                          nothing rendered it.

                          Read-only here. A member of staff sets their own picture on
                          their account screen — the school records who they are, not
                          what they look like, and a colleague editing somebody else's
                          photograph is not a permission this product wants.
                        */
                        <span className="flex min-w-0 items-center gap-2.5">
                          <Avatar name={fullName(r)} src={r.photo_url} size="sm" />
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-foreground">
                              {fullName(r)}
                            </span>
                            {r.email && (
                              <span className="block truncate text-xs text-subtle">{r.email}</span>
                            )}
                          </span>
                        </span>
                      ),
                    },
                    {
                      key: 'role',
                      header: 'Access',
                      cell: (r) =>
                        r.role ? (
                          <Badge variant={r.role === 'org:owner' ? 'primary' : 'neutral'}>
                            {ROLE_LABEL[r.role] ?? r.role}
                          </Badge>
                        ) : (
                          <Badge variant="warning">No sign-in</Badge>
                        ),
                    },
                    {
                      key: 'record',
                      header: 'Staff record',
                      cell: (r) =>
                        !r.id ? (
                          /*
                            A Clerk member with no `staff_members` row.

                            Before `0184` this was permanent: accepting an invitation created
                            the membership and nothing else, so the person was invisible here
                            forever. It now resolves itself the first time they open the
                            portal or the app, which is what this says rather than leaving a
                            warning that looks like something the school must fix.
                          */
                          <span className="text-muted-foreground">
                            Appears when they first sign in
                          </span>
                        ) : canManage ? (
                          <button
                            type="button"
                            onClick={() => setEditing(r)}
                            className="min-h-tap rounded px-1 text-left text-primary-text hover:underline"
                          >
                            {r.staff_number ?? 'Add details'}
                            {r.department ? ` · ${r.department}` : ''}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">
                            {r.staff_number ?? '—'}
                            {r.department ? ` · ${r.department}` : ''}
                          </span>
                        ),
                    },
                    {
                      key: 'joined',
                      header: 'Joined',
                      hideOnMobile: true,
                      cell: (r) => formatDate(r.join_date),
                    },
                    ...(canManage
                      ? [
                          {
                            key: 'manage',
                            header: 'Change access',
                            cell: (r: StaffRow) =>
                              // The owner is not editable here, and there is no
                              // point rendering a control that always refuses.
                              r.role === 'org:owner' || !r.hasAccount ? (
                                <span className="text-muted-foreground">—</span>
                              ) : (
                                <div className="flex flex-wrap items-center gap-2">
                                  <label htmlFor={`role-${r.clerk_user_id}`} className="sr-only">
                                    Role for {fullName(r)}
                                  </label>
                                  <Select
                                    id={`role-${r.clerk_user_id}`}
                                    value={r.role ?? ''}
                                    disabled={busy === r.clerk_user_id}
                                    className="h-9 min-h-0 w-auto py-1 text-sm"
                                    onChange={(e) => void changeRole(r.clerk_user_id, e.target.value)}
                                  >
                                    {data.assignableRoles.map((role) => (
                                      <option key={role} value={role}>
                                        {ROLE_LABEL[role] ?? role}
                                      </option>
                                    ))}
                                  </Select>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={busy === r.clerk_user_id}
                                    onClick={() => void removeAccess(r)}
                                  >
                                    <ShieldOff aria-hidden="true" />
                                    <span className="sr-only">Remove access for {fullName(r)}</span>
                                  </Button>
                                </div>
                              ),
                          },
                        ]
                      : []),
                  ]}
                  empty={
                    <EmptyState
                      icon={UserCog}
                      title="Nobody on staff yet"
                      description={
                        canManage
                          ? 'Invite the first colleague below.'
                          : 'Staff appear here once the school owner invites them.'
                      }
                    />
                  }
                />
              </CardContent>
            </Card>
          )}

          {section === 'invited' && canManage && data.invitations.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Invited, not yet joined</CardTitle>
                <p className="text-sm text-muted-foreground">
                  They have an email but have not signed in. Nothing is created for them until
                  they do.
                </p>
              </CardHeader>
              <CardContent className="p-0">
                <DataTable
                  caption="Pending invitations"
                  rows={data.invitations}
                  rowKey={(i) => i.id}
                  columns={[
                    {
                      key: 'email',
                      header: 'Email',
                      primary: true,
                      cell: (i) => <span className="break-all">{i.email}</span>,
                    },
                    {
                      key: 'role',
                      header: 'Role',
                      cell: (i) => (
                        <Badge variant="neutral">{ROLE_LABEL[i.role] ?? i.role}</Badge>
                      ),
                    },
                    {
                      key: 'sent',
                      header: 'Sent',
                      cell: (i) => formatDate(new Date(i.createdAt).toISOString()),
                    },
                    {
                      key: 'withdraw',
                      header: 'Withdraw',
                      cell: (i) => (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy === i.id}
                          onClick={() => void revoke(i)}
                        >
                          {busy === i.id ? (
                            <Loader2 aria-hidden="true" className="animate-spin" />
                          ) : (
                            <X aria-hidden="true" />
                          )}
                          Withdraw
                        </Button>
                      ),
                    },
                  ]}
                />
              </CardContent>
            </Card>
          )}

          {/* The refusal belongs on this tab too: somebody who cannot invite should
              learn that where they went looking, not be shown nothing. */}
          {section === 'invite' &&
            (canManage ? (
              <InviteForm roles={data.assignableRoles} onSent={reload} />
            ) : (
              <Alert variant="info" title="Inviting staff is the owner's to do">
                Only the school owner and the principal can invite colleagues or change what
                someone can do. Ask one of them, and they can do it from this screen.
              </Alert>
            ))}
        </div>
      )}
    </>
  )
}
