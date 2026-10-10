'use client'

/**
 * AfriTech → School Networks.
 *
 * Spec: migrations `0119`–`0123`
 *
 * ## Attaching and granting are two separate controls, on purpose
 *
 * Attaching a school puts its numbers on the network dashboard. Granting access
 * invites the network's owner into that school so they can open a child's record.
 * The screen keeps them apart and labels the second for what it is, because an
 * operator clicking through an onboarding checklist should not hand somebody entry
 * to pupil data by accident.
 *
 * A school attached without access granted is shown plainly as "reporting only" —
 * a normal state, not a warning.
 *
 * ## Widening data scope is a decision, and the screen says what it costs
 *
 * Every network starts aggregates-only. The control to widen it explains what the
 * network will then be able to read, rather than offering three words from a
 * dropdown whose consequences live in a migration comment.
 */

import type { FormEvent, JSX } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { Building2, KeyRound, Lightbulb, Loader2, Plus, Unlink, UserPlus } from 'lucide-react'

import { apiSend, useApi } from '../../../lib/use-api'
import { Alert } from '../../../components/ui/alert'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { EmptyState } from '../../../components/ui/empty-state'
import { ErrorState, PageHeader, TableSkeleton } from '../../../components/ui/data-states'
import { Field, Input, Select } from '../../../components/ui/field'
import { FormActions, FormGrid, FormSection } from '../../../components/ui/form'
import { useToast } from '../../../components/ui/toast'

interface Network {
  id: string
  name: string
  slug: string
  data_scope: string
  billing_mode: string
  status: string
  notes: string | null
}

interface LinkRow {
  id: string
  network_id: string
  school_id: string
  attached_at: string
  owner_access_granted_at: string | null
  owner_access_invited_email: string | null
  schools: Array<{
    id: string
    school_id: string
    name: string
    clerk_org_id: string
    subscription_tier: string | null
    status: string
  }> | null
}

interface Member {
  id: string
  network_id: string
  clerk_user_id: string
  network_role: string
  full_name: string | null
  email: string | null
  is_active: boolean
}

interface RoleDef {
  role_key: string
  label: string
  description: string | null
}

interface SchoolOption {
  id: string
  school_id: string
  name: string
}

interface Suggestion {
  out_basis: 'same_account' | 'same_email'
  out_identifier: string
  out_owner_name: string | null
  out_school_count: number
  out_school_names: string[] | null
  out_already_networked: number
}

interface Payload {
  suggestions?: Suggestion[]
  networks: Network[]
  links: LinkRow[]
  members: Member[]
  roles: RoleDef[]
  unattachedSchools: SchoolOption[]
}

const SCOPE_LABEL: Record<string, string> = {
  aggregates_only: 'Totals and rates only',
  financial_detail: 'Totals, plus fee records and payments',
  full: 'Everything, including pupil academic data',
}

export default function AdminNetworksPage(): JSX.Element {
  const { data, loading, error, code, reload } = useApi<Payload>('/api/admin/networks')
  const { toast } = useToast()

  const [selectedId, setSelectedId] = useState<string>('')
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // Create form
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')

  // Attach / grant / member forms
  const [attachSchool, setAttachSchool] = useState('')
  const [grantEmail, setGrantEmail] = useState('')
  const [grantSchool, setGrantSchool] = useState('')
  const [grantRole, setGrantRole] = useState('org:owner')
  const [memberUserId, setMemberUserId] = useState('')
  const [memberName, setMemberName] = useState('')
  const [memberRole, setMemberRole] = useState('owner')

  const selected = useMemo(
    () => data?.networks.find((n) => n.id === selectedId) ?? data?.networks[0] ?? null,
    [data?.networks, selectedId],
  )

  const links = useMemo(
    () => (data?.links ?? []).filter((l) => l.network_id === selected?.id),
    [data?.links, selected?.id],
  )
  const members = useMemo(
    () => (data?.members ?? []).filter((m) => m.network_id === selected?.id),
    [data?.members, selected?.id],
  )

  const act = useCallback(
    async (label: string, payload: Record<string, unknown>) => {
      setBusy(label)
      setActionError(null)
      const result = await apiSend<{ note?: string }>('/api/admin/networks', 'POST', payload)
      setBusy(null)
      if (result.error) {
        setActionError(result.error)
        return false
      }
      toast(result.data?.note ?? 'Done.')
      reload()
      return true
    },
    [toast, reload],
  )

  const createNetwork = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      const okDone = await act('create', { action: 'create_network', name, slug })
      if (okDone) {
        setName('')
        setSlug('')
      }
    },
    [act, name, slug],
  )

  if (error) return <ErrorState message={error} code={code} onRetry={reload} />
  if (loading && !data) return <TableSkeleton rows={6} columns={3} />

  return (
    <>
      <PageHeader
        title="School networks"
        description="An owner running several schools, with one dashboard across all of them."
        note="Attaching a school puts its totals on the network dashboard. Giving access is a separate step that invites the network's owner into that school so they can open pupil records — keep them apart deliberately. Every network starts on totals-only; widening that is a data-protection decision, not a convenience."
      />

      <div className="space-y-cards">
        {actionError && (
          <Alert variant="danger" title="That did not work">
            {actionError}
          </Alert>
        )}

        <FormSection
          title="Create a network"
          description="Only AfriTech can create one — a school's ownership is not something ZSMS can verify."
        >
          <form onSubmit={createNetwork} noValidate>
            <FormGrid columns={2}>
              <Field id="n-name" label="Network name" required hint="As the owner would say it.">
                {(props) => (
                  <Input
                    {...props}
                    value={name}
                    required
                    maxLength={120}
                    onChange={(e) => {
                      setName(e.target.value)
                      setSlug(
                        e.target.value
                          .toLowerCase()
                          .replace(/[^a-z0-9]+/g, '-')
                          .replace(/^-+|-+$/g, '')
                          .slice(0, 49),
                      )
                    }}
                  />
                )}
              </Field>
              <Field id="n-slug" label="Handle" required hint="Used in the network's web address.">
                {(props) => (
                  <Input
                    {...props}
                    value={slug}
                    required
                    maxLength={49}
                    onChange={(e) => setSlug(e.target.value)}
                    className="font-mono"
                  />
                )}
              </Field>
            </FormGrid>
            <FormActions>
              <Button type="submit" disabled={busy !== null || !name || !slug}>
                {busy === 'create' ? (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                ) : (
                  <Plus aria-hidden="true" />
                )}
                Create network
              </Button>
            </FormActions>
          </form>
        </FormSection>

        {/*
          Groups that look like they want a network.

          Placed ABOVE the list, because it is the one thing on this screen that is
          new information rather than a record of decisions already taken. It renders
          nothing when there is nothing to suggest.
        */}
        {(data?.suggestions?.length ?? 0) > 0 && (
          <Card>
            <CardContent className="flex flex-col gap-stack pt-card">
              <div>
                <h2 className="flex items-center gap-2 font-semibold">
                  <Lightbulb aria-hidden="true" className="size-4 text-warning" />
                  These schools may belong together
                </h2>
                <p className="text-sm text-muted-foreground">
                  Same owner, not all in a network. Create one above, then attach them —
                  nothing is grouped automatically.
                </p>
              </div>

              <ul className="flex flex-col gap-2">
                {data?.suggestions?.map((sug) => (
                  <li
                    key={`${sug.out_basis}:${sug.out_identifier}`}
                    className="rounded-md border border-border bg-surface p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{sug.out_owner_name ?? 'Unnamed owner'}</span>
                      {/*
                        The basis matters to whoever decides. "Same account" is exact;
                        "same email" is a guess that people do use several addresses,
                        and is the only signal available for a school AfriTech created.
                      */}
                      <Badge variant={sug.out_basis === 'same_account' ? 'success' : 'neutral'}>
                        {sug.out_basis === 'same_account' ? 'Same account' : 'Same email'}
                      </Badge>
                      <span className="ml-auto text-sm text-muted-foreground">
                        <span data-numeric>{sug.out_school_count}</span> schools
                        {sug.out_already_networked > 0 && (
                          <>
                            {' · '}
                            <span data-numeric>{sug.out_already_networked}</span> already in one
                          </>
                        )}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {(sug.out_school_names ?? []).join(' · ')}
                    </p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {(data?.networks.length ?? 0) === 0 ? (
          <Card>
            <CardContent className="p-0">
              <EmptyState
                icon={Building2}
                title="No networks yet"
                description="Create one above, then attach the owner's schools to it one at a time."
              />
            </CardContent>
          </Card>
        ) : (
          <>
            <FormSection>
              <FormGrid columns={2}>
                <Field id="n-pick" label="Network">
                  {(props) => (
                    <Select
                      {...props}
                      value={selected?.id ?? ''}
                      onChange={(e) => setSelectedId(e.target.value)}
                    >
                      {data?.networks.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>

                <Field
                  id="n-scope"
                  label="What the network can see"
                  hint="Widening this lets network members read pupil or financial data without entering a school."
                >
                  {(props) => (
                    <Select
                      {...props}
                      value={selected?.data_scope ?? 'aggregates_only'}
                      onChange={(e) =>
                        void act('scope', {
                          action: 'update_network',
                          networkId: selected?.id,
                          dataScope: e.target.value,
                        })
                      }
                    >
                      {Object.entries(SCOPE_LABEL).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </FormGrid>

              {selected?.data_scope !== 'aggregates_only' && (
                <Alert variant="warning" title="This network sees more than totals" className="mt-stack">
                  Members can read{' '}
                  {selected?.data_scope === 'full'
                    ? 'pupil academic data and financial records'
                    : 'individual fee records and payments'}{' '}
                  across every attached school without entering it. Only widen this where the owner
                  genuinely needs it.
                </Alert>
              )}

              <p className="mt-stack text-sm text-muted-foreground">
                Billing: <strong className="text-foreground">{selected?.billing_mode === 'consolidated' ? 'One invoice for the network' : 'Each school billed separately'}</strong>.{' '}
                {/* Said plainly rather than implied by a dropdown. */}
                ZSMS does not generate invoices yet, so this records intent only.
              </p>
            </FormSection>

            {/* --- Schools ------------------------------------------------- */}
            <Card>
              <CardHeader>
                <CardTitle>Schools in {selected?.name}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {links.length} attached. Attaching shows a school&apos;s totals; access is separate.
                </p>
              </CardHeader>
              <CardContent className="space-y-stack">
                {links.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No schools attached yet. The dashboard will be empty until one is.
                  </p>
                )}

                <ul className="divide-y divide-border">
                  {links.map((l) => {
                    const school = l.schools?.[0]
                    return (
                      <li key={l.id} className="flex flex-wrap items-center gap-3 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-foreground">{school?.name ?? l.school_id}</p>
                          <p className="font-mono text-xs text-subtle">{school?.school_id}</p>
                        </div>
                        {l.owner_access_granted_at ? (
                          <Badge variant="success">
                            Access granted
                            {l.owner_access_invited_email ? ` · ${l.owner_access_invited_email}` : ''}
                          </Badge>
                        ) : (
                          // Not a warning. A school attached for reporting only is a
                          // legitimate and common state.
                          <Badge variant="neutral">Reporting only</Badge>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy !== null}
                          onClick={() =>
                            void act('detach', { action: 'detach_school', schoolId: l.school_id })
                          }
                        >
                          <Unlink aria-hidden="true" />
                          Detach
                        </Button>
                      </li>
                    )
                  })}
                </ul>

                <FormGrid columns={2}>
                  <Field id="n-attach" label="Attach a school" hint="Schools not already in a network.">
                    {(props) => (
                      <Select
                        {...props}
                        value={attachSchool}
                        onChange={(e) => setAttachSchool(e.target.value)}
                      >
                        <option value="">Choose a school</option>
                        {data?.unattachedSchools.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} ({s.school_id})
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <div className="flex items-end">
                    <Button
                      disabled={busy !== null || !attachSchool || !selected}
                      onClick={async () => {
                        const done = await act('attach', {
                          action: 'attach_school',
                          networkId: selected?.id,
                          schoolId: attachSchool,
                        })
                        if (done) setAttachSchool('')
                      }}
                    >
                      {busy === 'attach' ? (
                        <Loader2 aria-hidden="true" className="animate-spin" />
                      ) : (
                        <Plus aria-hidden="true" />
                      )}
                      Attach
                    </Button>
                  </div>
                </FormGrid>
              </CardContent>
            </Card>

            {/* --- Access (the deliberate step) ---------------------------- */}
            <FormSection
              title="Give a network member access to a school"
              description="Invites them into that school so they can open pupil records. Separate from attaching, because it is a different decision."
            >
              <FormGrid columns={3}>
                <Field id="g-school" label="School" required>
                  {(props) => (
                    <Select
                      {...props}
                      value={grantSchool}
                      onChange={(e) => setGrantSchool(e.target.value)}
                    >
                      <option value="">Choose a school</option>
                      {links.map((l) => (
                        <option key={l.school_id} value={l.school_id}>
                          {l.schools?.[0]?.name ?? l.school_id}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field id="g-email" label="Their email" required hint="Where the invitation goes.">
                  {(props) => (
                    <Input
                      {...props}
                      type="email"
                      value={grantEmail}
                      onChange={(e) => setGrantEmail(e.target.value)}
                    />
                  )}
                </Field>
                <Field id="g-role" label="Role in that school" hint="Owner unless there is a reason.">
                  {(props) => (
                    <Select {...props} value={grantRole} onChange={(e) => setGrantRole(e.target.value)}>
                      <option value="org:owner">School owner</option>
                      <option value="org:principal">Head teacher</option>
                      <option value="org:admin">Administrator</option>
                    </Select>
                  )}
                </Field>
              </FormGrid>

              <Alert variant="info" title="What this does" className="mt-stack">
                Sends a Clerk invitation. Once accepted, that person can switch into the school from
                their network dashboard and will see everything a member of staff in that role sees —
                including pupil records. Until they accept, the school shows as unavailable to them.
              </Alert>

              <FormActions>
                <Button
                  disabled={busy !== null || !grantSchool || !grantEmail}
                  onClick={async () => {
                    const link = links.find((l) => l.school_id === grantSchool)
                    const orgId = link?.schools?.[0]?.clerk_org_id
                    if (!orgId) {
                      setActionError('That school has no Clerk organisation recorded.')
                      return
                    }
                    const done = await act('grant', {
                      action: 'grant_access',
                      schoolId: grantSchool,
                      organisationId: orgId,
                      email: grantEmail,
                      schoolRole: grantRole,
                    })
                    if (done) setGrantEmail('')
                  }}
                >
                  {busy === 'grant' ? (
                    <Loader2 aria-hidden="true" className="animate-spin" />
                  ) : (
                    <KeyRound aria-hidden="true" />
                  )}
                  Send invitation
                </Button>
              </FormActions>
            </FormSection>

            {/* --- Members ------------------------------------------------ */}
            <Card>
              <CardHeader>
                <CardTitle>Network members</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Who can open the network dashboard. Separate from access to any school.
                </p>
              </CardHeader>
              <CardContent className="space-y-stack">
                <ul className="divide-y divide-border">
                  {members.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-foreground">
                          {m.full_name ?? m.clerk_user_id}
                        </p>
                        <p className="font-mono text-xs text-subtle">{m.clerk_user_id}</p>
                      </div>
                      <Badge variant="neutral">
                        {data?.roles.find((r) => r.role_key === m.network_role)?.label ??
                          m.network_role}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() =>
                          void act('member', {
                            action: 'set_member_active',
                            memberId: m.id,
                            isActive: !m.is_active,
                          })
                        }
                      >
                        {m.is_active ? 'Suspend' : 'Restore'}
                      </Button>
                    </li>
                  ))}
                  {members.length === 0 && (
                    <li className="py-3 text-sm text-muted-foreground">
                      Nobody yet. The dashboard is unreachable until somebody is added.
                    </li>
                  )}
                </ul>

                <FormGrid columns={3}>
                  <Field
                    id="m-user"
                    label="Their ZSMS user id"
                    hint="From Clerk. Looks like user_2abc…"
                  >
                    {(props) => (
                      <Input
                        {...props}
                        value={memberUserId}
                        onChange={(e) => setMemberUserId(e.target.value)}
                        className="font-mono"
                      />
                    )}
                  </Field>
                  <Field id="m-name" label="Name">
                    {(props) => (
                      <Input
                        {...props}
                        value={memberName}
                        onChange={(e) => setMemberName(e.target.value)}
                      />
                    )}
                  </Field>
                  <Field id="m-role" label="Network role">
                    {(props) => (
                      <Select
                        {...props}
                        value={memberRole}
                        onChange={(e) => setMemberRole(e.target.value)}
                      >
                        {data?.roles.map((r) => (
                          <option key={r.role_key} value={r.role_key}>
                            {r.label}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                </FormGrid>

                <FormActions>
                  <Button
                    variant="outline"
                    disabled={busy !== null || !memberUserId || !selected}
                    onClick={async () => {
                      const done = await act('addmember', {
                        action: 'add_member',
                        networkId: selected?.id,
                        clerkUserId: memberUserId,
                        networkRole: memberRole,
                        fullName: memberName || undefined,
                      })
                      if (done) {
                        setMemberUserId('')
                        setMemberName('')
                      }
                    }}
                  >
                    {busy === 'addmember' ? (
                      <Loader2 aria-hidden="true" className="animate-spin" />
                    ) : (
                      <UserPlus aria-hidden="true" />
                    )}
                    Add member
                  </Button>
                </FormActions>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </>
  )
}
