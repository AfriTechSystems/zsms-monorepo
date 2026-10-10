'use client'

/**
 * Staff roles — school-defined jobs and what they may do (ADR-012).
 *
 * Spec: `01 Foundation Layer/DECISIONS.md` → ADR-012,
 *       `02 Authentication and Identity/PERMISSIONS.md`
 *
 * ## What a school is actually doing here
 *
 * ZSMS ships six fixed roles. A real school has a Librarian, an Exams Officer, a Sports
 * Master and a Boarding Matron, and none of them map onto "Administrator". ADR-012's
 * answer is that the school defines the job and ticks what it may see.
 *
 * The holder carries `org:staff` in Clerk with **zero default access**, so a job with
 * nothing ticked can sign in and do nothing. That is the safe failure, and it is why the
 * empty state here says so plainly rather than looking broken.
 *
 * ## Only the owner and the principal
 *
 * Ticking a box here grants a capability, so whoever can tick can grant themselves
 * anything. Deliberately narrower than the rest of settings — not even an Administrator.
 * The database refuses regardless; this screen just does not pretend otherwise.
 */

import type { ChangeEvent, JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Plus, ShieldCheck, Trash2, UserPlus, X } from 'lucide-react'

import { Button } from '../../../../../components/ui/button'
import { Card } from '../../../../../components/ui/card'
import { Input } from '../../../../../components/ui/field'
import { Badge } from '../../../../../components/ui/badge'
import { useToast } from '../../../../../components/ui/toast'

interface CustomRole {
  id: string
  name: string
  description: string | null
  permissions: Record<string, Record<string, boolean>>
  isActive: boolean
  holders: string[]
}

interface Payload {
  roles: CustomRole[]
  resources: string[]
  actions: string[]
  meta: { used: number; limit: number | null }
}

/** Plain words for what each resource covers — "assignments" means nothing on its own. */
const RESOURCE_LABEL: Record<string, string> = {
  students: 'Pupils',
  fees: 'Fees and payments',
  attendance: 'Attendance registers',
  results: 'Marks and results',
  staff: 'Staff list',
  announcements: 'Announcements',
  assignments: 'Teaching assignments',
}

export default function StaffRolesPage(): JSX.Element {
  const params = useParams<{ schoolCode: string }>()
  const { toast } = useToast()

  const [payload, setPayload] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<CustomRole | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/school/custom-roles')
      const body = await response.json()
      if (!response.ok) {
        setError(body.error ?? 'Could not load staff roles.')
        return
      }
      setError(null)
      setPayload(body.data)
    } catch {
      setError('Could not reach ZSMS. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function send(body: unknown, done: string): Promise<void> {
    setSaving(true)
    try {
      const response = await fetch('/api/school/custom-roles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const result = await response.json()
      if (!response.ok) {
        // The ceiling message names the school's actual plan, so show it verbatim.
        toast(result.error ?? 'That did not save.', 'danger')
        return
      }
      toast(result.data?.message ?? done)
      setDraft(null)
      await load()
    } finally {
      setSaving(false)
    }
  }

  const atCeiling =
    payload?.meta.limit !== null &&
    payload !== null &&
    payload.meta.used >= (payload.meta.limit ?? 0)

  if (loading) {
    return <div className="p-card text-muted-foreground">Loading staff roles…</div>
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

  return (
    <div className="space-y-stack">
      <header className="flex flex-wrap items-start justify-between gap-stack">
        <div>
          <h1 className="text-2xl font-semibold">Staff roles</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            ZSMS ships six standard roles. Define your own here for jobs they do not
            cover — a Librarian, an Exams Officer, a Boarding Matron — and tick exactly
            what each one may see.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            <span data-numeric>{data.meta.used}</span>
            {data.meta.limit === null ? (
              ' roles'
            ) : (
              <>
                {' of '}
                <span data-numeric>{data.meta.limit}</span>
                {' on your plan'}
              </>
            )}
          </span>
          <Button
            onClick={() =>
              setDraft({
                id: '',
                name: '',
                description: '',
                permissions: {},
                isActive: true,
                holders: [],
              })
            }
            disabled={atCeiling}
          >
            <Plus className="mr-2 h-4 w-4" />
            New role
          </Button>
        </div>
      </header>

      {atCeiling ? (
        <Card className="border-warning/40 bg-warning/5 p-card text-sm">
          Your plan includes <span data-numeric>{data.meta.limit}</span> custom roles and
          all of them are in use. Switch one off below to free a slot, or ask AfriTech
          about a larger plan.
        </Card>
      ) : null}

      {draft ? (
        <RoleEditor
          draft={draft}
          resources={data.resources}
          actions={data.actions}
          saving={saving}
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onSave={() =>
            void send(
              {
                action: 'save',
                ...(draft.id ? { id: draft.id } : {}),
                name: draft.name,
                description: draft.description ?? null,
                permissions: draft.permissions,
              },
              'Role saved.',
            )
          }
        />
      ) : null}

      {data.roles.length === 0 && !draft ? (
        <Card className="p-card text-center">
          <ShieldCheck className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-stack font-medium">No custom roles yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Your staff all hold one of the six standard roles. Add a custom role when
            somebody needs a job those do not describe.
          </p>
        </Card>
      ) : null}

      <div className="space-y-stack">
        {data.roles.map((role) => (
          <Card key={role.id} className="p-card">
            <div className="flex flex-wrap items-start justify-between gap-stack">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-medium">{role.name}</h2>
                  {role.isActive ? null : <Badge variant="neutral">Switched off</Badge>}
                </div>
                {role.description ? (
                  <p className="mt-1 text-sm text-muted-foreground">{role.description}</p>
                ) : null}
              </div>

              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setDraft(role)}>
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void send(
                      { action: 'setActive', id: role.id, isActive: !role.isActive },
                      'Updated.',
                    )
                  }
                >
                  {role.isActive ? 'Switch off' : 'Switch on'}
                </Button>
              </div>
            </div>

            <div className="mt-stack flex flex-wrap gap-2">
              {Object.entries(role.permissions).flatMap(([resource, actions]) =>
                Object.entries(actions)
                  .filter(([, granted]) => granted)
                  .map(([action]) => (
                    <Badge key={`${resource}:${action}`} variant="neutral">
                      {RESOURCE_LABEL[resource] ?? resource}
                      {action === 'write' ? ' — can change' : ' — can see'}
                    </Badge>
                  )),
              )}
              {Object.keys(role.permissions).length === 0 ? (
                <span className="text-sm text-muted-foreground">
                  Nothing ticked yet, so anyone in this role can sign in and see nothing.
                </span>
              ) : null}
            </div>

            <Holders
              role={role}
              onAssign={(staffUserId) =>
                void send({ action: 'assign', id: role.id, staffUserId }, 'Added.')
              }
              onUnassign={(staffUserId) =>
                void send({ action: 'unassign', id: role.id, staffUserId }, 'Removed.')
              }
            />
          </Card>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Only the owner and the principal can change staff roles — ticking a box here
        grants a permission, so the list of people who can do it is deliberately short.
        Every change is recorded in the{' '}
        <a href={`/school/${params.schoolCode}/settings/audit`} className="underline">
          audit trail
        </a>
        .
      </p>
    </div>
  )
}

/** The grant grid. One row per resource, a tick for see and a tick for change. */
function RoleEditor({
  draft,
  resources,
  actions,
  saving,
  onChange,
  onCancel,
  onSave,
}: {
  draft: CustomRole
  resources: string[]
  actions: string[]
  saving: boolean
  onChange: (role: CustomRole) => void
  onCancel: () => void
  onSave: () => void
}): JSX.Element {
  function toggle(resource: string, action: string): void {
    const current = draft.permissions[resource] ?? {}
    const next = { ...current, [action]: !current[action] }

    /*
      Changing marks without being able to see them is not a coherent job, so ticking
      "can change" ticks "can see" too. Said in the hint rather than silently done.
    */
    if (action === 'write' && next.write) next.read = true

    onChange({ ...draft, permissions: { ...draft.permissions, [resource]: next } })
  }

  return (
    <Card className="border-primary/40 p-card">
      <h2 className="font-medium">{draft.id ? 'Edit role' : 'New role'}</h2>

      <div className="mt-stack grid gap-stack sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium">Role name</span>
          <Input
            value={draft.name}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...draft, name: e.target.value })}
            placeholder="Exams Officer"
            className="mt-1"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">What this job does (optional)</span>
          <Input
            value={draft.description ?? ''}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...draft, description: e.target.value })}
            placeholder="Runs end-of-term examinations"
            className="mt-1"
          />
        </label>
      </div>

      <p className="mt-stack text-sm font-medium">What this role may do</p>
      <p className="text-xs text-muted-foreground">
        Ticking &ldquo;can change&rdquo; also ticks &ldquo;can see&rdquo; — changing
        something without being able to look at it is not a job anybody can do.
      </p>

      <div className="mt-stack overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="pb-2 font-medium">Area</th>
              {actions.map((a) => (
                <th key={a} className="pb-2 text-center font-medium">
                  {a === 'write' ? 'Can change' : 'Can see'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {resources.map((resource) => (
              <tr key={resource} className="border-b border-border/50">
                <td className="py-2">{RESOURCE_LABEL[resource] ?? resource}</td>
                {actions.map((action) => (
                  <td key={action} className="py-2 text-center">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={Boolean(draft.permissions[resource]?.[action])}
                      onChange={() => toggle(resource, action)}
                      aria-label={`${RESOURCE_LABEL[resource] ?? resource} — ${
                        action === 'write' ? 'can change' : 'can see'
                      }`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-stack flex gap-2">
        <Button onClick={onSave} disabled={saving || draft.name.trim() === ''}>
          {saving ? 'Saving…' : 'Save role'}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </Card>
  )
}

/** Who holds this role. */
function Holders({
  role,
  onAssign,
  onUnassign,
}: {
  role: CustomRole
  onAssign: (staffUserId: string) => void
  onUnassign: (staffUserId: string) => void
}): JSX.Element {
  const [adding, setAdding] = useState(false)
  const [value, setValue] = useState('')

  return (
    <div className="mt-stack border-t border-border pt-stack">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {role.holders.length === 0
            ? 'Nobody holds this role yet'
            : `${role.holders.length} in this role`}
        </span>

        {role.holders.map((h) => (
          <Badge key={h} variant="neutral" className="gap-1">
            {h}
            <button
              type="button"
              onClick={() => onUnassign(h)}
              aria-label={`Remove ${h} from ${role.name}`}
              className="ml-1"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}

        {adding ? (
          <span className="flex items-center gap-2">
            <Input
              value={value}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
              placeholder="Staff user id"
              className="h-8 w-56"
            />
            <Button
              size="sm"
              onClick={() => {
                onAssign(value.trim())
                setValue('')
                setAdding(false)
              }}
              disabled={value.trim() === ''}
            >
              Add
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </span>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            <UserPlus className="mr-1 h-3 w-3" />
            Add someone
          </Button>
        )}
      </div>
    </div>
  )
}
