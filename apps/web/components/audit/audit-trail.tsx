'use client'

/**
 * The audit trail — who did what, where, when and why.
 *
 * Spec: `Official Documentation/09 Fee and Financial Management/AUDIT.md`
 *
 * ## One component, two audiences
 *
 * A school owner looking at their own trail and an AfriTech operator looking across the
 * platform want the same thing: a filtered list where a row can be opened to see exactly
 * what changed. The difference is scope, and scope is decided by RLS — so there is one
 * component and the policy decides what fills it.
 *
 * Two copies would drift, and it is always the less-used one that rots.
 *
 * ## A row is not useful until it is opened
 *
 * `old_values` and `new_values` are whole row snapshots. Printed raw they are unreadable;
 * summarised away they are useless. So a collapsed row says who, what and when, and
 * opening it shows **only the fields that actually changed**, before and after — which is
 * the question somebody has when they open an audit entry.
 */

import type { JSX } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, ShieldAlert, UserCog } from 'lucide-react'

import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'
import { ErrorState, TableSkeleton } from '../ui/data-states'
import { EmptyState } from '../ui/empty-state'
import { Field, Input, Select } from '../ui/field'
import { useApi } from '../../lib/use-api'

interface Entry {
  id: string
  at: string
  actor: { id: string; name: string | null }
  impersonating: { id: string; name: string | null } | null
  action: string
  table: string
  recordId: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  schoolId: string | null
  ipAddress: string | null
  userAgent: string | null
  reason: string | null
  metadata: Record<string, unknown> | null
}

/**
 * The tables worth filtering by.
 *
 * Not every table in the schema — a list of sixty is a list nobody uses. These are the
 * ones a dispute is actually about.
 */
const TABLES = [
  { value: '', label: 'Everything' },
  { value: 'payments', label: 'Payments' },
  { value: 'fee_records', label: 'Fee records' },
  { value: 'school_payment_details', label: 'Where parents pay' },
  { value: 'students', label: 'Pupils' },
  { value: 'exam_results', label: 'Results' },
  { value: 'attendance_records', label: 'Attendance' },
  { value: 'staff_members', label: 'Staff' },
  { value: 'student_parent_links', label: 'Parent links' },
  { value: 'announcements', label: 'Announcements' },
  { value: 'schools', label: 'School settings' },
] as const

/** Fields that changed, which is the only part of a snapshot anybody reads. */
function changedFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Array<{ field: string; from: unknown; to: unknown }> {
  if (!after) {
    // A delete. Everything it held is "what was lost", which is the useful framing.
    return Object.entries(before ?? {}).map(([field, from]) => ({ field, from, to: null }))
  }

  if (!before) {
    return Object.entries(after).map(([field, to]) => ({ field, from: null, to }))
  }

  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const out: Array<{ field: string; from: unknown; to: unknown }> = []

  for (const k of keys) {
    // `updated_at` moves on every write and tells nobody anything.
    if (k === 'updated_at') continue
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      out.push({ field: k, from: before[k], to: after[k] })
    }
  }
  return out
}

function show(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function AuditTrail({
  /** AfriTech passes a school to narrow to; a school passes nothing and RLS scopes it. */
  schoolId,
}: {
  schoolId?: string
}): JSX.Element {
  const [table, setTable] = useState('')
  const [actor, setActor] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [offset, setOffset] = useState(0)
  const [openId, setOpenId] = useState<string | null>(null)

  const query = useMemo(() => {
    const p = new URLSearchParams()
    if (table) p.set('table', table)
    if (actor.trim()) p.set('actor', actor.trim())
    if (from) p.set('from', from)
    if (to) p.set('to', to)
    if (schoolId) p.set('schoolId', schoolId)
    p.set('offset', String(offset))
    return p.toString()
  }, [table, actor, from, to, schoolId, offset])

  const { data, loading, error, code, reload } = useApi<{
    entries: Entry[]
    meta: { total: number; limit: number; offset: number }
  }>(`/api/audit?${query}`)

  const resetAnd = useCallback((fn: () => void) => {
    // Any filter change returns to the first page: staying on page 4 of a different
    // result set shows an empty list that reads as "nothing matched".
    setOffset(0)
    fn()
  }, [])

  if (loading && !data) return <TableSkeleton rows={8} columns={4} />
  if (error) return <ErrorState message={error} code={code} onRetry={reload} />

  const entries = data?.entries ?? []
  const total = data?.meta.total ?? 0
  const limit = data?.meta.limit ?? 100

  return (
    <>
      <Card className="mb-cards">
        <CardContent className="grid gap-stack pt-card sm:grid-cols-4">
          <Field id="a-table" label="What">
            {(props) => (
              <Select
                {...props}
                value={table}
                onChange={(e) => resetAnd(() => setTable(e.target.value))}
              >
                {TABLES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field id="a-actor" label="Who" hint="A user id.">
            {(props) => (
              <Input
                {...props}
                value={actor}
                placeholder="user_…"
                onChange={(e) => resetAnd(() => setActor(e.target.value))}
              />
            )}
          </Field>

          <Field id="a-from" label="From">
            {(props) => (
              <Input
                {...props}
                type="date"
                value={from}
                onChange={(e) => resetAnd(() => setFrom(e.target.value))}
              />
            )}
          </Field>

          <Field id="a-to" label="To">
            {(props) => (
              <Input
                {...props}
                type="date"
                value={to}
                onChange={(e) => resetAnd(() => setTo(e.target.value))}
              />
            )}
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-card">
          {entries.length === 0 ? (
            <EmptyState
              icon={ShieldAlert}
              title="Nothing recorded for that"
              description="Either nothing has happened yet, or the filters are too narrow. Clear them and try again."
            />
          ) : (
            <>
              <p className="mb-stack text-sm text-muted-foreground">
                <span data-numeric>{total.toLocaleString()}</span> entr
                {total === 1 ? 'y' : 'ies'}
                {total > limit && `, showing ${offset + 1}–${Math.min(offset + limit, total)}`}
              </p>

              <ul className="divide-y divide-border">
                {entries.map((e) => {
                  const open = openId === e.id
                  const changes = open ? changedFields(e.before, e.after) : []

                  return (
                    <li key={e.id} className="py-stack">
                      <button
                        type="button"
                        onClick={() => setOpenId(open ? null : e.id)}
                        aria-expanded={open}
                        className="flex w-full items-start gap-2 text-left"
                      >
                        {open ? (
                          <ChevronDown aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                        ) : (
                          <ChevronRight aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                        )}

                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium">{e.action}</span>
                            <Badge variant="neutral">{e.table}</Badge>

                            {/*
                              Impersonation is flagged, not buried.

                              An action taken by AfriTech acting as somebody else is the
                              single most sensitive row in this table, and it must not look
                              like an ordinary one.
                            */}
                            {e.impersonating && (
                              <Badge variant="warning">
                                <UserCog aria-hidden="true" className="mr-1 inline size-3" />
                                impersonating
                              </Badge>
                            )}
                          </span>

                          <span className="text-sm text-muted-foreground">
                            {e.actor.name ?? e.actor.id}
                            {e.impersonating &&
                              ` acting as ${e.impersonating.name ?? e.impersonating.id}`}
                            {' · '}
                            <span data-numeric>{new Date(e.at).toLocaleString()}</span>
                          </span>

                          {/* WHY, when there is one. */}
                          {e.reason && (
                            <span className="text-sm italic text-muted-foreground">
                              &ldquo;{String(e.reason)}&rdquo;
                            </span>
                          )}
                        </span>
                      </button>

                      {open && (
                        <div className="ml-6 mt-stack rounded-md border border-border bg-sunken p-card">
                          {changes.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                              No field values changed — the row was touched without its
                              contents differing.
                            </p>
                          ) : (
                            <table className="w-full text-sm">
                              <caption className="sr-only">What changed</caption>
                              <thead>
                                <tr className="text-left text-muted-foreground">
                                  <th scope="col" className="pb-1 pr-3 font-medium">Field</th>
                                  <th scope="col" className="pb-1 pr-3 font-medium">Before</th>
                                  <th scope="col" className="pb-1 font-medium">After</th>
                                </tr>
                              </thead>
                              <tbody>
                                {changes.map((ch) => (
                                  <tr key={ch.field} className="align-top">
                                    <td className="py-0.5 pr-3 font-mono text-xs">{ch.field}</td>
                                    <td className="py-0.5 pr-3 text-muted-foreground">
                                      {show(ch.from)}
                                    </td>
                                    <td className="py-0.5 font-medium">{show(ch.to)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}

                          {/* WHERE — kept out of the collapsed row, which is about who
                              and what. */}
                          <dl className="mt-stack grid gap-x-cards gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-2">
                            {e.recordId && (
                              <div>
                                <dt className="inline">Record: </dt>
                                <dd className="inline font-mono">{e.recordId}</dd>
                              </div>
                            )}
                            {e.ipAddress && (
                              <div>
                                <dt className="inline">From: </dt>
                                <dd className="inline font-mono">{e.ipAddress}</dd>
                              </div>
                            )}
                            {e.userAgent && (
                              <div className="sm:col-span-2">
                                <dt className="inline">Device: </dt>
                                <dd className="inline">{e.userAgent}</dd>
                              </div>
                            )}
                          </dl>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>

              {total > limit && (
                <div className="mt-cards flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - limit))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={offset + limit >= total}
                    onClick={() => setOffset(offset + limit)}
                  >
                    Next
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </>
  )
}
