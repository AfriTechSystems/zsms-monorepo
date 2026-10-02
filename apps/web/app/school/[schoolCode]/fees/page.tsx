'use client'

/**
 * Fees — who owes what.
 *
 * Spec: `Official Documentation/09 Fee and Financial Management/PAYMENTS.md`
 *
 * ## Two figures that must never be added together
 *
 * "Outstanding" is what is owed. "Awaiting verification" is money somebody has
 * *claimed* to have paid and nobody has confirmed. They are shown as separate
 * cards, and the second links to the queue rather than reducing the first,
 * because a school that treats an unverified deposit slip as income is a school
 * that reconciles a shortfall at the end of term.
 *
 * ## Arrears are a figure and a link, never a lock
 *
 * Nothing on this screen — or downstream of it — withholds a result, a report
 * card, or a certificate over a balance. That is a school-configurable policy,
 * off by default. It is worth saying on the screen itself, which the page note
 * does, because a bursar looking at a list of debtors is exactly the person who
 * would assume otherwise.
 */

import type { FormEvent, JSX } from 'react'
import { Suspense, use, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ClipboardCheck, Receipt, Search, Wallet } from 'lucide-react'

import { Pagination } from '../../../../components/ui/pagination'
import { useApi } from '../../../../lib/use-api'
import { Badge } from '../../../../components/ui/badge'
import { Button } from '../../../../components/ui/button'
import { Card, CardContent } from '../../../../components/ui/card'
import { DataTable } from '../../../../components/ui/data-table'
import { EmptyState } from '../../../../components/ui/empty-state'
import { ErrorState, PageHeader, StatSkeleton } from '../../../../components/ui/data-states'
import { Field, Input, Select } from '../../../../components/ui/field'
import { FormGrid, FormSection } from '../../../../components/ui/form'
import { StatCard } from '../../../../components/ui/stat-card'
import { formatCount, formatKwacha } from '../school-shared'

interface Balance {
  student_id: string
  student_code: string
  first_name: string
  last_name: string
  student_status: string
  outstanding: string | number
  arrears_amount: string | number
  is_overdue: boolean
  days_overdue: number | null
  records_outstanding: number
  records_overdue: number
}

interface FeesPayload {
  balances: Balance[]
  summary: {
    outstanding: number
    arrears: number
    pupilsOwing: number
    pupilsOverdue: number
  }
  pendingVerification: number
  canRecord: boolean
}

function FeesList({ base }: { base: string }): JSX.Element {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const filter = params.get('filter') ?? 'outstanding'
  const q = params.get('q') ?? ''

  const page = Math.max(1, Number(params.get('page') ?? '1') || 1)

  const url = useMemo(() => {
    const s = new URLSearchParams({ filter })
    if (q.trim()) s.set('q', q.trim())
    if (page > 1) s.set('page', String(page))
    return `/api/school/fees?${s.toString()}`
  }, [filter, q, page])

  const { data, meta, loading, error, code, reload } = useApi<FeesPayload>(url)

  const total = meta?.total ?? 0
  const perPage = meta?.perPage ?? 25

  const setParam = useCallback(
    (next: Record<string, string>) => {
      const s = new URLSearchParams(params.toString())
      for (const [k, v] of Object.entries(next)) {
        if (v) s.set(k, v)
        else s.delete(k)
      }
      // Changing the filter or the search returns to page 1. Holding page 4 while
      // the result set shrinks to one page shows an empty table that reads as
      // "no pupils owe anything" — the opposite of what it means.
      if (!('page' in next)) s.delete('page')
      router.replace(`${pathname}?${s.toString()}`, { scroll: false })
    },
    [params, pathname, router],
  )

  const submitSearch = useCallback(
    (event: FormEvent) => {
      event.preventDefault()
      const value = new FormData(event.target as HTMLFormElement).get('q')
      setParam({ q: typeof value === 'string' ? value : '' })
    },
    [setParam],
  )

  return (
    <>
      <PageHeader
        title="Fees"
        description="Balances, arrears, and payments waiting to be confirmed."
        note="An outstanding balance is never a lock. Nothing here withholds a result, a report card, or a certificate — that is a school policy which is off by default. A payment shown as awaiting verification is a claim, not money, and is not subtracted from what is owed until somebody confirms it."
        actions={
          data && (
            <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link href={`${base}/fees/structures`}>
                <Receipt aria-hidden="true" />
                Fee structures
              </Link>
            </Button>
            <Button variant={data.pendingVerification > 0 ? 'default' : 'outline'} asChild>
              <Link href={`${base}/fees/verify`}>
                <ClipboardCheck aria-hidden="true" />
                Verification
                {data.pendingVerification > 0 && (
                  <span className="ml-1 rounded-full bg-white/20 px-1.5 text-xs">
                    {data.pendingVerification}
                  </span>
                )}
              </Link>
            </Button>
            </div>
          )
        }
      />

      {error && <ErrorState message={error} code={code} onRetry={reload} />}
      {loading && !data && !error && <StatSkeleton count={4} />}

      {!error && data && (
        <div className="space-y-cards">
          <div className="grid grid-cols-2 gap-cards lg:grid-cols-4">
            <StatCard
              label="Outstanding"
              value={formatKwacha(data.summary.outstanding)}
              hint="Billed and not yet paid"
              tone="primary"
              icon={<Wallet />}
            />
            <StatCard
              label="Overdue"
              value={formatKwacha(data.summary.arrears)}
              hint={`${formatCount(data.summary.pupilsOverdue)} pupils past a due date`}
              tone={data.summary.arrears > 0 ? 'danger' : 'success'}
              icon={<Wallet />}
            />
            <StatCard
              label="Pupils owing"
              value={formatCount(data.summary.pupilsOwing)}
              hint="With any balance at all"
              tone="neutral"
              icon={<Wallet />}
            />
            <StatCard
              label="Awaiting verification"
              value={formatCount(data.pendingVerification)}
              // Never added to "collected". Recorded is a claim; verified is money.
              hint="Recorded, not yet confirmed"
              tone={data.pendingVerification > 0 ? 'warning' : 'neutral'}
              icon={<ClipboardCheck />}
            />
          </div>

          <FormSection>
            <form onSubmit={submitSearch} noValidate>
              <FormGrid columns={3}>
                <Field id="fee-search" label="Search" hint="Name or pupil number">
                  {(props) => (
                    <Input {...props} name="q" type="search" defaultValue={q} maxLength={100} />
                  )}
                </Field>

                <Field id="fee-filter" label="Show">
                  {(props) => (
                    <Select
                      {...props}
                      value={filter}
                      onChange={(e) => setParam({ filter: e.target.value })}
                    >
                      <option value="outstanding">Anyone with a balance</option>
                      <option value="overdue">Past a due date only</option>
                      <option value="all">Everyone</option>
                    </Select>
                  )}
                </Field>

                <div className="flex flex-col gap-1.5">
                  <span aria-hidden="true" className="hidden text-sm font-medium sm:block">
                    &nbsp;
                  </span>
                  <Button type="submit" variant="outline" className="w-full">
                    <Search aria-hidden="true" />
                    Search
                  </Button>
                </div>
              </FormGrid>
            </form>
          </FormSection>

          <Card>
            <CardContent className="p-0">
              <DataTable
                caption="Pupil balances"
                rows={data.balances}
                rowKey={(b) => b.student_id}
                href={(b) => `${base}/fees/${b.student_id}`}
                columns={[
                  {
                    key: 'pupil',
                    header: 'Pupil',
                    primary: true,
                    cell: (b) => (
                      <>
                        <span className="font-medium text-foreground">
                          {b.last_name}, {b.first_name}
                        </span>
                        <span className="block font-mono text-xs text-subtle">{b.student_code}</span>
                      </>
                    ),
                  },
                  {
                    key: 'outstanding',
                    header: 'Outstanding',
                    numeric: true,
                    cell: (b) => formatKwacha(b.outstanding),
                  },
                  {
                    key: 'overdue',
                    header: 'Overdue',
                    numeric: true,
                    cell: (b) =>
                      b.is_overdue ? (
                        <span className="text-danger-text">{formatKwacha(b.arrears_amount)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      ),
                  },
                  {
                    key: 'age',
                    header: 'Oldest',
                    cell: (b) =>
                      b.is_overdue && b.days_overdue ? (
                        <Badge variant={b.days_overdue > 60 ? 'danger' : 'warning'}>
                          {b.days_overdue} days
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      ),
                  },
                ]}
                empty={
                  <EmptyState
                    illustration={filter === 'all' ? 'pupils' : 'fees'}
                    title={filter === 'all' ? 'No pupils' : 'Nothing outstanding'}
                    description={
                      filter === 'all'
                        ? 'Enrol pupils and issue a fee structure to see balances here.'
                        : 'Every pupil is up to date on this filter.'
                    }
                  />
                }
              />
            </CardContent>
          </Card>

          <Pagination
            page={page}
            total={total}
            perPage={perPage}
            noun="pupils"
            onPageChange={(next) => setParam({ page: String(next) })}
          />
        </div>
      )}
    </>
  )
}

export default function FeesPage({
  params,
}: {
  params: Promise<{ schoolCode: string }>
}): JSX.Element {
  const { schoolCode } = use(params)
  return (
    <Suspense fallback={<StatSkeleton count={4} />}>
      <FeesList base={`/school/${schoolCode}`} />
    </Suspense>
  )
}
