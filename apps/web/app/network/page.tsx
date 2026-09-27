'use client'

/**
 * School Network dashboard — every school at once, then into any one of them.
 *
 * Spec: `Official Documentation/01 Foundation Layer/DATABASE.md` — school-group views
 *       migrations `0119`–`0122`
 *
 * ## Built to stay readable at 100 schools
 *
 * The totals answer "how is the network doing" without scrolling. Below them the
 * schools are a sortable, searchable table rather than a wall of cards: at 100
 * schools a card grid is six screens of scrolling and no way to find the one that
 * is struggling. Sorting by collection rate or attendance is how an owner actually
 * uses this — worst first.
 *
 * ## Aggregates only, and it says so
 *
 * No pupil names, no individual fee records, no marks. The page states this rather
 * than leaving an owner hunting for a drill-down that does not exist, and the
 * reason is honest: seeing an individual child means entering that school, where
 * the ordinary rules apply and the access is recorded against that school.
 *
 * ## A rate with no amount is still useful
 *
 * When the network is aggregates-only, or the member's role excludes money, the
 * kwacha columns come back NULL and are rendered as a dash — never as zero, which
 * would read as "owed nothing". The collection RATE is still shown, because a
 * percentage is a performance figure rather than an amount.
 */

import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import { Building2, TrendingDown, Users, Wallet } from 'lucide-react'

import { useApi } from '../../lib/use-api'
import { Alert } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { Card, CardContent } from '../../components/ui/card'
import { DataTable } from '../../components/ui/data-table'
import { EmptyState } from '../../components/ui/empty-state'
import { ErrorState, StatSkeleton } from '../../components/ui/data-states'
import { Field, Input, Select } from '../../components/ui/field'
import { FormGrid, FormSection } from '../../components/ui/form'
import { StatCard } from '../../components/ui/stat-card'

interface NetworkSchool {
  id: string
  code: string
  name: string
  cityCode: string
  status: string
  tier: string | null
  organisationId: string | null
  pupils: number
  staff: number
  capacity: number | null
  atCapacity: boolean
  feesOutstanding: string | number | null
  collectionRate: number | null
  attendanceRate: number | null
  resultsPublished: number
}

interface Payload {
  hasNetwork: boolean
  network: {
    name: string
    roleLabel: string
    dataScope: string
    canSeeMoney: boolean
  } | null
  schools: NetworkSchool[]
  totals: {
    schools: number
    pupils: number
    staff: number
    feesOutstanding: string | number | null
    collectionRate: number | null
    attendanceRate: number | null
    schoolsAtCapacity: number
  } | null
}

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : 0
  return Number.isFinite(n) ? n : 0
}

/** A dash, never a zero, when a figure is withheld rather than absent. */
const kwachaOrDash = (v: string | number | null | undefined): string =>
  v === null || v === undefined
    ? '—'
    : `K${num(v).toLocaleString('en-ZM', { maximumFractionDigits: 0 })}`

const pctOrDash = (v: number | null): string => (v === null ? '—' : `${v}%`)

type SortKey = 'name' | 'pupils' | 'collection' | 'attendance' | 'outstanding'

export default function NetworkDashboardPage(): JSX.Element {
  const { data, loading, error, code, reload } = useApi<Payload>('/api/network/overview')

  const [query, setQuery] = useState('')
  // Worst-first by default on a chosen metric is the point of the sort — an owner
  // opens this to find the school that needs attention, not to read an alphabet.
  const [sort, setSort] = useState<SortKey>('name')

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = (data?.schools ?? []).filter(
      (s) =>
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q) ||
        (s.cityCode ?? '').toLowerCase().includes(q),
    )

    const sorted = [...filtered]
    switch (sort) {
      case 'pupils':
        sorted.sort((a, b) => b.pupils - a.pupils)
        break
      case 'collection':
        // Nulls last: a school with nothing billed has no rate, and putting it
        // first would bury the school that genuinely collects badly.
        sorted.sort((a, b) => (a.collectionRate ?? 999) - (b.collectionRate ?? 999))
        break
      case 'attendance':
        sorted.sort((a, b) => (a.attendanceRate ?? 999) - (b.attendanceRate ?? 999))
        break
      case 'outstanding':
        sorted.sort((a, b) => num(b.feesOutstanding) - num(a.feesOutstanding))
        break
      default:
        sorted.sort((a, b) => a.name.localeCompare(b.name))
    }
    return sorted
  }, [data?.schools, query, sort])

  if (error) return <ErrorState message={error} code={code} onRetry={reload} />
  if (loading && !data) return <StatSkeleton count={4} />

  if (!data?.hasNetwork) {
    return (
      <Card>
        <CardContent className="p-0">
          <EmptyState
            icon={Building2}
            title="This account is not part of a school network"
            description="A school network gives an owner of several schools one place to see all of them. AfriTech sets one up and attaches the schools — contact support if you run more than one school and would like this."
          />
        </CardContent>
      </Card>
    )
  }

  const t = data.totals
  const net = data.network

  return (
    <div className="space-y-cards">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{net?.name}</h1>
        <p className="text-sm text-muted-foreground">
          {t?.schools} schools · {net?.roleLabel}
        </p>
      </div>

      <Alert variant="info" title="Totals and rates only">
        This page shows how each school is doing, not the people in it. To see a
        pupil, a fee record or a result, open that school — your access there is
        recorded against that school like any other member of staff.
      </Alert>

      <div className="grid grid-cols-2 gap-cards lg:grid-cols-4">
        <StatCard
          label="Pupils"
          value={(t?.pupils ?? 0).toLocaleString('en-ZM')}
          hint={`across ${t?.schools ?? 0} schools`}
          tone="primary"
          icon={<Users />}
        />
        <StatCard
          label="Outstanding"
          value={kwachaOrDash(t?.feesOutstanding)}
          hint={net?.canSeeMoney ? 'billed and not yet paid' : 'not shown for your role'}
          tone="neutral"
          icon={<Wallet />}
        />
        <StatCard
          label="Collection"
          value={pctOrDash(t?.collectionRate ?? null)}
          hint="of everything billed"
          tone={
            t?.collectionRate === null || t?.collectionRate === undefined
              ? 'neutral'
              : t.collectionRate >= 80
                ? 'success'
                : t.collectionRate >= 60
                  ? 'warning'
                  : 'danger'
          }
          icon={<TrendingDown />}
        />
        <StatCard
          label="Attendance"
          value={pctOrDash(t?.attendanceRate ?? null)}
          // Weighted by pupils, not a mean of percentages — a 12-pupil school must
          // not move the network figure as much as a 900-pupil one.
          hint="weighted by pupils, last 30 days"
          tone={
            t?.attendanceRate === null || t?.attendanceRate === undefined
              ? 'neutral'
              : t.attendanceRate >= 90
                ? 'success'
                : t.attendanceRate >= 75
                  ? 'warning'
                  : 'danger'
          }
          icon={<Users />}
        />
      </div>

      {(t?.schoolsAtCapacity ?? 0) > 0 && (
        <Alert variant="warning" title="Schools at their pupil limit">
          {t?.schoolsAtCapacity} of your schools cannot enrol another pupil on their
          current plan. Sort by pupils below to find them.
        </Alert>
      )}

      <FormSection>
        <FormGrid columns={2}>
          <Field id="net-search" label="Find a school" hint="Name, code, or town">
            {(props) => (
              <Input
                {...props}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                maxLength={80}
              />
            )}
          </Field>
          <Field id="net-sort" label="Order by" hint="Worst first, for the rates.">
            {(props) => (
              <Select {...props} value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                <option value="name">Name</option>
                <option value="pupils">Most pupils</option>
                <option value="collection">Lowest fee collection</option>
                <option value="attendance">Lowest attendance</option>
                <option value="outstanding">Most outstanding</option>
              </Select>
            )}
          </Field>
        </FormGrid>
      </FormSection>

      <Card>
        <CardContent className="p-0">
          <DataTable
            caption="Schools in this network"
            rows={rows}
            rowKey={(s) => s.id}
            columns={[
              {
                key: 'school',
                header: 'School',
                primary: true,
                cell: (s) => (
                  <>
                    <span className="font-medium text-foreground">{s.name}</span>
                    <span className="block font-mono text-xs text-subtle">
                      {s.code}
                      {s.cityCode ? ` · ${s.cityCode}` : ''}
                    </span>
                  </>
                ),
              },
              {
                key: 'pupils',
                header: 'Pupils',
                numeric: true,
                cell: (s) => (
                  <>
                    {s.pupils}
                    {s.atCapacity && (
                      <Badge variant="warning" className="ml-2">
                        Full
                      </Badge>
                    )}
                  </>
                ),
              },
              { key: 'staff', header: 'Staff', numeric: true, cell: (s) => s.staff },
              {
                key: 'collection',
                header: 'Collection',
                numeric: true,
                cell: (s) => (
                  <span
                    className={
                      s.collectionRate === null
                        ? 'text-muted-foreground'
                        : s.collectionRate < 60
                          ? 'text-danger-text'
                          : s.collectionRate < 80
                            ? 'text-warning-text'
                            : 'text-success-text'
                    }
                  >
                    {pctOrDash(s.collectionRate)}
                  </span>
                ),
              },
              {
                key: 'outstanding',
                header: 'Outstanding',
                numeric: true,
                cell: (s) => kwachaOrDash(s.feesOutstanding),
              },
              {
                key: 'attendance',
                header: 'Attendance',
                numeric: true,
                cell: (s) => (
                  <span
                    className={
                      s.attendanceRate === null
                        ? 'text-muted-foreground'
                        : s.attendanceRate < 75
                          ? 'text-danger-text'
                          : s.attendanceRate < 90
                            ? 'text-warning-text'
                            : 'text-success-text'
                    }
                  >
                    {pctOrDash(s.attendanceRate)}
                  </span>
                ),
              },
            ]}
            empty={
              <EmptyState
                icon={Building2}
                title={query ? 'No school matches that' : 'No schools attached yet'}
                description={
                  query
                    ? 'Try a different name, code or town.'
                    : 'AfriTech attaches schools to a network one at a time. Contact support to add yours.'
                }
              />
            }
          />
        </CardContent>
      </Card>
    </div>
  )
}
