'use client'

/**
 * Permission grants — temporary access beyond somebody's role.
 *
 * Spec: `02 Authentication and Identity/PERMISSIONS.md`
 *
 * ## The situation this screen is for
 *
 * The accountant is on medical leave for three weeks and somebody has to record cash
 * payments. Without this, the choice is to change the teacher's role permanently or share
 * a password. Both are worse than a grant that expires on its own.
 *
 * ## Why the expiry is front and centre
 *
 * A grant without an end date is a role change with extra steps. The form defaults to 21
 * days — the document's own worked example — and the list sorts live grants first with
 * the days remaining shown, because the failure that actually hurts is a grant quietly
 * lapsing in the middle of term.
 *
 * ## Only owner and principal
 *
 * The database refuses anyone else, including an administrator. A principal is further
 * refused financial write, because they do not hold it themselves and the whole point of
 * the hierarchy is that you cannot hand out what you have not got.
 */

import type { ChangeEvent, JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, KeyRound, Clock, ShieldOff } from 'lucide-react'

import { Button } from '../../../../../components/ui/button'
import { Card } from '../../../../../components/ui/card'
import { Badge } from '../../../../../components/ui/badge'
import { Input, Select } from '../../../../../components/ui/field'
import { useToast } from '../../../../../components/ui/toast'

interface Grant {
  id: string
  granteeId: string
  granteeName: string
  grantorName: string
  module: string
  action: string
  reason: string
  grantedAt: string
  expiresAt: string | null
  isActive: boolean
  revokedAt: string | null
  expiresInDays: number | null
}

interface Payload {
  grants: Grant[]
  modules: string[]
  actions: string[]
  meta: { active: number; expiringSoon: number }
}

interface StaffMember {
  clerkUserId: string | null
  firstName?: string | null
  lastName?: string | null
  role?: string | null
}

/** Plain words. "assignments" and "results_publish" mean nothing on their own. */
const MODULE_LABEL: Record<string, string> = {
  fees: 'Fee structures',
  payments: 'Payments',
  attendance: 'Attendance registers',
  results: 'Marks and results',
  results_publish: 'Publishing results',
  students: 'Pupil records',
  parents: 'Parent accounts',
  staff: 'Staff records',
  assignments: 'Teaching assignments',
  communication: 'Announcements',
  reports: 'Reports and exports',
  settings: 'School settings',
  loans: 'Loan applications',
  audit: 'Audit trail',
  permissions: 'Granting permissions',
}

const ACTION_LABEL: Record<string, string> = {
  read: 'can see',
  write: 'can change',
  delete: 'can remove',
  export: 'can export',
  publish: 'can publish',
}

export default function PermissionsPage(): JSX.Element {
  const { toast } = useToast()
  const [payload, setPayload] = useState<Payload | null>(null)
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)

  const [form, setForm] = useState({
    granteeUserId: '',
    module: 'payments',
    action: 'write',
    reason: '',
    // The document's own worked example is three weeks of cover.
    expiresInDays: '21',
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [grantsRes, staffRes] = await Promise.all([
        fetch('/api/school/permissions'),
        fetch('/api/school/staff'),
      ])
      const grantsBody = await grantsRes.json()
      if (!grantsRes.ok) {
        setError(grantsBody.error ?? 'Could not load permission grants.')
        return
      }
      setError(null)
      setPayload(grantsBody.data)

      if (staffRes.ok) {
        const staffBody = await staffRes.json()
        setStaff(staffBody.data?.staff ?? staffBody.data?.members ?? [])
      }
    } catch {
      setError('Could not reach ZSMS. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function submit(): Promise<void> {
    setSaving(true)
    try {
      const response = await fetch('/api/school/permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          granteeUserId: form.granteeUserId,
          module: form.module,
          action: form.action,
          reason: form.reason,
          expiresInDays: form.expiresInDays === '' ? null : Number(form.expiresInDays),
        }),
      })
      const body = await response.json()
      if (!response.ok) {
        // The database's refusals explain themselves; show them verbatim.
        toast(body.error ?? 'That did not save.', 'danger')
        return
      }
      toast(body.data?.message ?? 'Granted.')
      setOpen(false)
      setForm({ ...form, granteeUserId: '', reason: '' })
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function revoke(id: string): Promise<void> {
    const response = await fetch('/api/school/permissions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    const body = await response.json()
    toast(body.data?.message ?? body.error ?? 'Done', response.ok ? 'success' : 'danger')
    if (response.ok) await load()
  }

  if (loading) {
    return <div className="p-card text-muted-foreground">Loading permission grants…</div>
  }

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
  const live = data.grants.filter((g) => g.isActive)
  const past = data.grants.filter((g) => !g.isActive)

  return (
    <div className="space-y-stack">
      <header className="flex flex-wrap items-start justify-between gap-stack">
        <div>
          <h1 className="text-2xl font-semibold">Permission grants</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Give somebody access beyond their role for a set period — covering for a
            colleague on leave, or a one-off task. The access ends by itself.
          </p>
        </div>
        <Button onClick={() => setOpen(!open)}>
          <KeyRound className="mr-2 h-4 w-4" />
          Grant access
        </Button>
      </header>

      {data.meta.expiringSoon > 0 ? (
        <Card className="border-warning/40 bg-warning/5 p-card text-sm">
          <p className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>
              <span data-numeric>{data.meta.expiringSoon}</span> grant
              {data.meta.expiringSoon === 1 ? '' : 's'} lapse within two days. If the cover
              is still needed, grant it again before it ends — the access stops on its own.
            </span>
          </p>
        </Card>
      ) : null}

      {open ? (
        <Card className="border-primary/40 p-card">
          <h2 className="font-medium">New grant</h2>

          <div className="mt-stack grid gap-stack sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium">Who</span>
              <Select
                value={form.granteeUserId}
                onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                  setForm({ ...form, granteeUserId: e.target.value })
                }
                className="mt-1"
              >
                <option value="">Choose a member of staff…</option>
                {staff
                  .filter((m) => m.clerkUserId)
                  .map((m) => (
                    <option key={m.clerkUserId} value={m.clerkUserId!}>
                      {[m.firstName, m.lastName].filter(Boolean).join(' ') || m.clerkUserId}
                    </option>
                  ))}
              </Select>
            </label>

            <label className="block">
              <span className="text-sm font-medium">For how long</span>
              <Select
                value={form.expiresInDays}
                onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                  setForm({ ...form, expiresInDays: e.target.value })
                }
                className="mt-1"
              >
                <option value="7">7 days</option>
                <option value="14">14 days</option>
                <option value="21">21 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                {/*
                  Last, and worded as a warning. A grant with no end date is a role
                  change with extra steps, and the whole point of this screen is that
                  access stops on its own.
                */}
                <option value="">No end date — until revoked by hand</option>
              </Select>
            </label>

            <label className="block">
              <span className="text-sm font-medium">What area</span>
              <Select
                value={form.module}
                onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                  setForm({ ...form, module: e.target.value })
                }
                className="mt-1"
              >
                {data.modules.map((m) => (
                  <option key={m} value={m}>
                    {MODULE_LABEL[m] ?? m}
                  </option>
                ))}
              </Select>
            </label>

            <label className="block">
              <span className="text-sm font-medium">What they may do</span>
              <Select
                value={form.action}
                onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                  setForm({ ...form, action: e.target.value })
                }
                className="mt-1"
              >
                {data.actions.map((a) => (
                  <option key={a} value={a}>
                    {ACTION_LABEL[a] ?? a}
                  </option>
                ))}
              </Select>
            </label>
          </div>

          <label className="mt-stack block">
            <span className="text-sm font-medium">Why</span>
            <Input
              value={form.reason}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setForm({ ...form, reason: e.target.value })
              }
              placeholder="Accountant on medical leave — covering fee payment recording"
              className="mt-1"
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              Required, and worth writing properly — in six months this is the only thing
              that explains why somebody had access they would not normally have.
            </span>
          </label>

          <div className="mt-stack flex gap-2">
            <Button
              onClick={() => void submit()}
              disabled={saving || form.granteeUserId === '' || form.reason.trim() === ''}
            >
              {saving ? 'Granting…' : 'Grant access'}
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      {live.length === 0 && !open ? (
        <Card className="p-card text-center">
          <KeyRound className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-stack font-medium">No one has extra access right now</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Everybody is working within their role, which is how it should usually look.
          </p>
        </Card>
      ) : null}

      {live.length > 0 ? (
        <section>
          <h2 className="mb-stack text-sm font-medium text-muted-foreground">
            Active ({live.length})
          </h2>
          <div className="space-y-stack">
            {live.map((g) => (
              <GrantRow key={g.id} grant={g} onRevoke={() => void revoke(g.id)} />
            ))}
          </div>
        </section>
      ) : null}

      {past.length > 0 ? (
        <section>
          <h2 className="mb-stack text-sm font-medium text-muted-foreground">
            Ended ({past.length})
          </h2>
          {/*
            Kept, not hidden. "Who could see fee records last March" is the question an
            audit asks, and a deleted row answers it with silence.
          */}
          <div className="space-y-2">
            {past.map((g) => (
              <GrantRow key={g.id} grant={g} onRevoke={null} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function GrantRow({
  grant,
  onRevoke,
}: {
  grant: Grant
  onRevoke: (() => void) | null
}): JSX.Element {
  const soon = grant.expiresInDays !== null && grant.expiresInDays <= 2

  return (
    <Card className={`p-card ${grant.isActive ? '' : 'opacity-60'}`}>
      <div className="flex flex-wrap items-start justify-between gap-stack">
        <div className="min-w-0">
          <p className="font-medium">
            {grant.granteeName}{' '}
            <span className="font-normal text-muted-foreground">
              {ACTION_LABEL[grant.action] ?? grant.action}{' '}
              {(MODULE_LABEL[grant.module] ?? grant.module).toLowerCase()}
            </span>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{grant.reason}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Granted by {grant.grantorName}
            {grant.revokedAt ? ' · revoked' : ''}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {grant.isActive ? (
            grant.expiresInDays === null ? (
              <Badge variant="warning">No end date</Badge>
            ) : (
              <Badge variant={soon ? 'danger' : 'neutral'}>
                <Clock className="mr-1 h-3 w-3" />
                <span data-numeric>{grant.expiresInDays}</span>
                {grant.expiresInDays === 1 ? ' day left' : ' days left'}
              </Badge>
            )
          ) : (
            <Badge variant="neutral">Ended</Badge>
          )}

          {onRevoke ? (
            <Button variant="ghost" size="sm" onClick={onRevoke}>
              <ShieldOff className="mr-1 h-3 w-3" />
              Revoke
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  )
}
