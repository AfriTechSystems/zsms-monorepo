'use client'

/**
 * AfriTech team — who holds which platform role, and what it lets them do.
 *
 * Spec: `02 Authentication and Identity/ROLES.md`
 *
 * ## Why this screen exists
 *
 * `ROLES.md` describes six AfriTech roles with real differences — a finance officer who
 * may not see loan PII, a developer who may not impersonate. Until `0237` the build had
 * one boolean and all six were the same account.
 *
 * The matrix is now enforced in the database. This screen makes it *visible*, which
 * matters for a boundary nobody can otherwise see: without it, the only way to discover
 * that a loan officer cannot read revenue is to hire one and watch them fail.
 *
 * ## Scope is opt-in, and the screen says so
 *
 * `afritech_school_in_scope()` returns TRUE for anybody with no scope rows, so this
 * migration did not silently remove access from a live account. The consequence is that
 * an unscoped regional manager still sees every school — which is correct behaviour and
 * a surprising one, so it is stated rather than left to be discovered.
 */

import type { ChangeEvent, JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Check, Globe, Minus, ShieldCheck, Users } from 'lucide-react'

import { Button } from '../../../components/ui/button'
import { Card } from '../../../components/ui/card'
import { Badge } from '../../../components/ui/badge'
import { Input, Select } from '../../../components/ui/field'
import { useToast } from '../../../components/ui/toast'

interface Scope {
  id: string
  staff_user_id: string
  scope_kind: string
  country_code: string | null
  school_id: string | null
  assigned_at: string
}

interface Payload {
  me: { role: string; capabilities: string[]; isScoped: boolean }
  scopesLoaded: boolean
  scopes: Scope[]
  schools: { id: string; name: string; school_id: string; country_code: string }[]
  roles: { role: string; summary: string }[]
}

/** Every capability in `has_afritech_capability()`, in the order the matrix reads best. */
const CAPABILITIES = [
  { key: 'platform:read', label: 'See the admin area' },
  { key: 'schools:read', label: 'Read school data' },
  { key: 'schools:write', label: 'Change school data' },
  { key: 'billing:read', label: 'See revenue' },
  { key: 'billing:write', label: 'Change billing' },
  { key: 'loans:read', label: 'See loan applications' },
  { key: 'loans:write', label: 'Decide loans' },
  { key: 'incidents:write', label: 'Raise incidents' },
  { key: 'impersonate', label: 'Act as another user' },
  { key: 'settings:write', label: 'Change platform settings' },
]

/**
 * The matrix as `0237` encodes it.
 *
 * A second copy, and that is a real cost — but the alternative is ten RPC calls per role
 * to render a table. The database is the enforcement; if these ever disagree, the
 * database is right and this is the bug.
 */
const MATRIX: Record<string, string[]> = {
  'afritech:super_admin': CAPABILITIES.map((c) => c.key),
  'afritech:regional_manager': [
    'platform:read',
    'schools:read',
    'schools:write',
    'billing:read',
    'incidents:write',
  ],
  'afritech:support_agent': ['platform:read', 'schools:read', 'incidents:write'],
  'afritech:loan_officer': ['platform:read', 'loans:read', 'loans:write'],
  'afritech:finance_officer': ['platform:read', 'billing:read', 'billing:write'],
  'afritech:developer': ['platform:read'],
}

export default function AfriTechTeamPage(): JSX.Element {
  const { toast } = useToast()
  const [payload, setPayload] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    staffUserId: '',
    scopeKind: 'country',
    countryCode: 'ZM',
    schoolId: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/admin/staff-scope')
      const body = await response.json()
      if (!response.ok) {
        setError(body.error ?? 'Could not load the team.')
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

  async function addScope(): Promise<void> {
    setSaving(true)
    try {
      const response = await fetch('/api/admin/staff-scope', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffUserId: form.staffUserId,
          scopeKind: form.scopeKind,
          countryCode: form.scopeKind === 'country' ? form.countryCode : null,
          schoolId: form.scopeKind === 'school' ? form.schoolId : null,
        }),
      })
      const body = await response.json()
      if (!response.ok) {
        toast(body.error ?? 'That did not save.', 'danger')
        return
      }
      toast(body.data?.message ?? 'Saved.')
      setForm({ ...form, staffUserId: '' })
      await load()
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-card text-muted-foreground">Loading the team…</div>

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
  const isSuper = data.me.role === 'afritech:super_admin'

  return (
    <div className="space-y-stack">
      <header>
        <h1 className="text-2xl font-semibold">AfriTech team</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          What each platform role may do, and which schools a scoped role can see.
        </p>
      </header>

      <Card className="p-card">
        <h2 className="flex items-center gap-2 font-medium">
          <ShieldCheck className="h-4 w-4" />
          You are signed in as {data.me.role.replace('afritech:', '').replace(/_/g, ' ')}
        </h2>
        <div className="mt-stack flex flex-wrap gap-2">
          {CAPABILITIES.filter((c) => data.me.capabilities.includes(c.key)).map((c) => (
            <Badge key={c.key} variant="neutral">
              {c.label}
            </Badge>
          ))}
        </div>
        {!data.me.isScoped && data.me.role !== 'afritech:super_admin' ? (
          <p className="mt-stack text-xs text-muted-foreground">
            You have no scope set, so you can see every school. Scope is opt-in — adding
            one narrows what you see; having none does not.
          </p>
        ) : null}
      </Card>

      <Card className="p-card">
        <h2 className="font-medium">What each role may do</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Enforced in the database by <code>has_afritech_capability()</code>, not by this
          page. The table is here so the boundaries can be seen without hiring somebody to
          find them.
        </p>

        <div className="mt-stack overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="pb-2 pr-4 font-medium">Can…</th>
                {data.roles.map((r) => (
                  <th key={r.role} className="px-2 pb-2 text-center font-medium">
                    {r.role.replace('afritech:', '').replace(/_/g, ' ')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CAPABILITIES.map((c) => (
                <tr key={c.key} className="border-b border-border/50">
                  <td className="py-2 pr-4">{c.label}</td>
                  {data.roles.map((r) => {
                    const yes = (MATRIX[r.role] ?? []).includes(c.key)
                    return (
                      <td key={r.role} className="px-2 py-2 text-center">
                        {yes ? (
                          <Check className="mx-auto h-4 w-4 text-success" aria-label="yes" />
                        ) : (
                          <Minus
                            className="mx-auto h-4 w-4 text-muted-foreground"
                            aria-label="no"
                          />
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {isSuper ? (
        <Card className="p-card">
          <h2 className="flex items-center gap-2 font-medium">
            <Globe className="h-4 w-4" />
            Regional scope
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Limit a regional manager or support agent to one country, or to a single
            school. Only a super admin can set this — otherwise somebody could widen their
            own scope.
          </p>

          <div className="mt-stack grid gap-stack sm:grid-cols-4">
            <label className="block sm:col-span-2">
              <span className="text-sm font-medium">Clerk user id</span>
              <Input
                value={form.staffUserId}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setForm({ ...form, staffUserId: e.target.value })
                }
                placeholder="user_…"
                className="mt-1"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium">Scope to</span>
              <Select
                value={form.scopeKind}
                onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                  setForm({ ...form, scopeKind: e.target.value })
                }
                className="mt-1"
              >
                <option value="country">A country</option>
                <option value="school">One school</option>
              </Select>
            </label>

            <label className="block">
              <span className="text-sm font-medium">
                {form.scopeKind === 'country' ? 'Country' : 'School'}
              </span>
              {form.scopeKind === 'country' ? (
                <Input
                  value={form.countryCode}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    setForm({ ...form, countryCode: e.target.value.toUpperCase() })
                  }
                  placeholder="ZM"
                  maxLength={2}
                  className="mt-1"
                />
              ) : (
                <Select
                  value={form.schoolId}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                    setForm({ ...form, schoolId: e.target.value })
                  }
                  className="mt-1"
                >
                  <option value="">Choose…</option>
                  {data.schools.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              )}
            </label>
          </div>

          <Button
            className="mt-stack"
            onClick={() => void addScope()}
            disabled={saving || form.staffUserId.trim() === ''}
          >
            {saving ? 'Saving…' : 'Add scope'}
          </Button>

          <div className="mt-stack">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <Users className="h-4 w-4" />
              Current scopes
            </h3>
            {!data.scopesLoaded ? (
              <p className="mt-2 text-sm text-muted-foreground">
                The scope list could not be read. Your own role above is unaffected.
              </p>
            ) : data.scopes.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Nobody is scoped, so every AfriTech account sees every school.
              </p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">
                {data.scopes.map((sc) => (
                  <li key={sc.id} className="flex items-center gap-2">
                    <code className="text-xs">{sc.staff_user_id}</code>
                    <span className="text-muted-foreground">
                      {sc.scope_kind === 'country'
                        ? sc.country_code
                        : (data.schools.find((s) => s.id === sc.school_id)?.name ??
                          'one school')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      ) : null}
    </div>
  )
}
