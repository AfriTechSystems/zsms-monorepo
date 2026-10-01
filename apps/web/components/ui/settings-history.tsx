'use client'

/**
 * What changed in a school's settings, who changed it, and when.
 *
 * Spec: `Official Documentation/15 Super Admin and Platform/SUPERADMIN.md`
 *       `Official Documentation/01 Foundation Layer/COMPLIANCE.md`
 *
 * ## One component, two readers
 *
 * The school sees its own history on its settings screen; AfriTech sees the same rows on the
 * school's admin detail page. They are the same question — "who changed this and when" — and
 * `school_settings_history()` already scopes it: AfriTech may name a school, a school may only
 * ever read its own, and the parameter is ignored for them.
 *
 * Deliberately NOT one of the places where AfriTech is narrowed to aggregates the way
 * `0169` narrows AI usage. A settings change is a named act by a member of staff on their own
 * school's configuration — that is exactly what an audit trail is for, and the distinction
 * from "what has Mrs Banda been generating" is the point.
 *
 * ## Only what moved
 *
 * The function returns a diff rather than two whole rows. A school record has two dozen
 * columns and a rename moves one of them; showing all twenty-four buries the answer. The
 * values are already masked by `mask_audit_values()` on the way in, so anything sensitive is
 * redacted before it reaches here rather than being hidden by this component.
 */

import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import { History } from 'lucide-react'

import { Badge } from './badge'
import { Button } from './button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card'
import { useApi } from '../../lib/use-api'

interface HistoryRow {
  out_id: string
  out_action: string
  out_table_name: string
  out_actor: string
  out_actor_name: string
  out_impersonated: string | null
  out_changed: Record<string, { from: unknown; to: unknown }>
  out_created_at: string
}

/** What the table names mean to somebody who did not design the schema. */
const AREA: Record<string, string> = {
  schools: 'School details',
  school_academic_config: 'Academic setup',
  school_term_dates: 'Term dates',
}

/** Column names a head teacher should not have to decode. */
const FIELD: Record<string, string> = {
  name: 'School name',
  display_name: 'Short name',
  ministry_reg_number: 'Ministry registration',
  phone: 'Phone',
  email: 'Email',
  address: 'Address',
  logo_url: 'Logo',
  type: 'School type',
  level: 'Level',
  city_code: 'Town',
  province_code: 'Province',
  starts_on: 'Term starts',
  ends_on: 'Term ends',
  term_number: 'Term',
  academic_year: 'Academic year',
}

const show = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '(empty)'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

export function SettingsHistory({
  /** AfriTech names a school; a school omits it and gets its own. */
  schoolId,
  className,
}: {
  schoolId?: string
  className?: string
}): JSX.Element | null {
  const url = schoolId
    ? `/api/school/settings/history?schoolId=${encodeURIComponent(schoolId)}`
    : '/api/school/settings/history'
  const { data } = useApi<{ history: HistoryRow[] }>(url)
  const [expanded, setExpanded] = useState(false)

  const rows = useMemo(() => data?.history ?? [], [data])

  // A school that has never changed a setting does not need a panel explaining that.
  if (rows.length === 0) return null

  const visible = expanded ? rows : rows.slice(0, 5)

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History aria-hidden="true" className="size-5 text-muted-foreground" />
          Settings history
        </CardTitle>
        <CardDescription>
          Every change to the school&rsquo;s details, academic setup and term dates. These
          records cannot be edited or deleted by anyone, including AfriTech.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-2">
        <ul className="flex flex-col gap-2">
          {visible.map((row) => (
            <li key={row.out_id} className="rounded-md border border-border bg-surface p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="neutral">{AREA[row.out_table_name] ?? row.out_table_name}</Badge>
                <span className="text-sm font-medium">{row.out_actor_name}</span>
                {row.out_impersonated && (
                  // The real actor is already in `out_actor`; this says somebody was being
                  // impersonated at the time, which changes how the entry should be read.
                  <Badge variant="warning">via AfriTech support</Badge>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  {new Date(row.out_created_at).toLocaleString('en-ZM')}
                </span>
              </div>

              <ul className="mt-1.5 flex flex-col gap-0.5">
                {Object.entries(row.out_changed ?? {})
                  // Timestamps move on every write and tell nobody anything.
                  .filter(([key]) => key !== 'updated_at' && key !== 'created_at')
                  .map(([key, change]) => (
                    <li key={key} className="text-sm">
                      <span className="text-muted-foreground">{FIELD[key] ?? key}: </span>
                      <span className="line-through opacity-60">{show(change.from)}</span>
                      <span aria-hidden="true"> → </span>
                      <span className="font-medium">{show(change.to)}</span>
                    </li>
                  ))}
              </ul>
            </li>
          ))}
        </ul>

        {rows.length > 5 && (
          <Button variant="outline" size="sm" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Show fewer' : `Show all ${rows.length} changes`}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
