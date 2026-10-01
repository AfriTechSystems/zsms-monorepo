'use client'

/**
 * Fee structures — the price list, and issuing it to pupils.
 *
 * Spec: `Official Documentation/09 Fee and Financial Management/FEE_STRUCTURES.md`
 *
 * ## Two different things on one screen, named so they are not confused
 *
 * A structure is a *price*: "Grade 8, term 1, tuition, K2,500". It bills nobody.
 * Issuing turns the price list into a bill for every pupil in that grade. The
 * screen keeps them visually separate and calls the second "Issue fees to
 * pupils" rather than "Generate", because "generate" describes what the code
 * does and "issue" describes what the school is doing — which is charging
 * families money.
 *
 * ## Issuing twice is safe, and the confirmation proves it
 *
 * `generate_fee_records()` skips a pupil who already has that record. The
 * confirmation names both counts, so "0 issued, 240 already had it" answers the
 * question a bursar actually has after an accidental second click. It is also
 * the intended way to bill a pupil enrolled mid-term.
 */

import type { FormEvent, JSX } from 'react'
import { use, useCallback, useMemo, useState } from 'react'
import { Loader2, Receipt, Send } from 'lucide-react'

import { apiSend, useApi } from '../../../../../lib/use-api'
import { Alert } from '../../../../../components/ui/alert'
import { Badge } from '../../../../../components/ui/badge'
import { Button } from '../../../../../components/ui/button'
import { Card, CardContent } from '../../../../../components/ui/card'
import { DataTable } from '../../../../../components/ui/data-table'
import { EmptyState } from '../../../../../components/ui/empty-state'
import { ErrorState, PageHeader, TableSkeleton } from '../../../../../components/ui/data-states'
import { Field, Input, Select } from '../../../../../components/ui/field'
import { FormActions, FormGrid, FormSection } from '../../../../../components/ui/form'
import { useToast } from '../../../../../components/ui/toast'
import { formatKwacha, formatLevel } from '../../school-shared'
import { FeeLineBuilder } from './fee-line-builder'

interface Structure {
  id: string
  academic_year: string
  term_number: number
  grade_id: string
  student_type: string | null
  fee_label: string
  amount: string | number
  is_mandatory: boolean
  is_active: boolean
  currency_code: string
}

export default function StructuresPage({
  params,
}: {
  params: Promise<{ schoolCode: string }>
}): JSX.Element {
  const { schoolCode } = use(params)
  const base = `/school/${schoolCode}`
  const { toast } = useToast()

  const { data, loading, error, code, reload } = useApi<Structure[]>('/api/fees/structures')

  const thisYear = String(new Date().getFullYear())
  const [year, setYear] = useState(thisYear)
  const [term, setTerm] = useState('1')
  const [dueDate, setDueDate] = useState('')
  const [issuing, setIssuing] = useState(false)
  const [issueError, setIssueError] = useState<string | null>(null)

  // How many structures the chosen year/term would actually bill from. Zero is
  // worth knowing *before* pressing the button, not after it reports nothing.
  const matching = useMemo(
    () =>
      (data ?? []).filter((s) => s.academic_year === year && s.term_number === Number(term)).length,
    [data, year, term],
  )

  const issue = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      setIssuing(true)
      setIssueError(null)

      const result = await apiSend<{ created: number; skipped: number }>(
        '/api/school/fees/generate',
        'POST',
        {
          academicYear: year,
          termNumber: Number(term),
          // A date input gives `YYYY-MM-DD`; the column is TIMESTAMPTZ and the
          // API takes an ISO instant, so it is widened to end-of-day rather
          // than midnight — a fee due "on the 14th" is not overdue at 00:01.
          dueDate: dueDate ? new Date(`${dueDate}T23:59:59`).toISOString() : undefined,
        },
      )

      setIssuing(false)
      if (result.error) {
        setIssueError(result.error)
        return
      }

      const { created = 0, skipped = 0 } = result.data ?? {}
      toast(
        created === 0
          ? `Nothing new to issue — all ${skipped} pupils already have these fees.`
          : `${created} fee${created === 1 ? '' : 's'} issued.` +
              (skipped > 0 ? ` ${skipped} already had them.` : ''),
        created === 0 ? 'danger' : 'success',
      )
    },
    [year, term, dueDate, toast],
  )

  return (
    <>
      <PageHeader
        backTo={`${base}/fees`}
        backLabel="All balances"
        title="Fee structures"
        description="What each grade costs, and issuing it to pupils."
        note="A structure is a price, not a bill — it charges nobody until you issue it. Issuing creates one fee record per pupil in that grade, which is what appears on a statement and can receive a payment. Issuing the same term twice is safe: pupils who already have the fee are skipped, which is also how you bill someone who enrolled mid-term."
      />

      {error && <ErrorState message={error} code={code} onRetry={reload} />}
      {loading && !data && !error && <TableSkeleton rows={6} columns={4} />}

      {!error && data && (
        <div className="space-y-cards">
          {/*
            The builder comes BEFORE issuing, because that is the order the work happens in —
            and because the page used to open with "issue fees to pupils" above a price list
            nothing could add to. Business rule 1: with no structure for a grade and term,
            issuing creates nothing for those pupils and says nothing about why.
          */}
          <FeeLineBuilder structures={data as never} onChanged={reload} />

          <FormSection
            title="Issue fees to pupils"
            description="Turns the price list below into a bill for every pupil in each grade."
          >
            <form onSubmit={issue} noValidate>
              <FormGrid columns={3}>
                <Field id="gen-year" label="Academic year" required hint="2026 or 2026/2027">
                  {(props) => (
                    <Input
                      {...props}
                      value={year}
                      required
                      maxLength={9}
                      onChange={(e) => setYear(e.target.value)}
                    />
                  )}
                </Field>

                <Field id="gen-term" label="Term" required>
                  {(props) => (
                    <Select {...props} value={term} onChange={(e) => setTerm(e.target.value)}>
                      <option value="1">Term 1</option>
                      <option value="2">Term 2</option>
                      <option value="3">Term 3</option>
                    </Select>
                  )}
                </Field>

                <Field
                  id="gen-due"
                  label="Due date"
                  hint="Left blank, nothing is ever overdue."
                >
                  {(props) => (
                    <Input
                      {...props}
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                    />
                  )}
                </Field>
              </FormGrid>

              <p className="mt-stack text-sm text-muted-foreground">
                {matching === 0 ? (
                  <span className="text-warning-text">
                    No fee structures exist for {year} term {term} — there is nothing to issue yet.
                  </span>
                ) : (
                  <>
                    {matching} structure{matching === 1 ? '' : 's'} would be issued for {year} term{' '}
                    {term}.
                  </>
                )}
              </p>

              {issueError && (
                <Alert variant="danger" title="Nothing was issued" className="mt-stack">
                  {issueError}
                </Alert>
              )}

              <FormActions>
                <Button type="submit" disabled={issuing || matching === 0}>
                  {issuing ? (
                    <Loader2 aria-hidden="true" className="animate-spin" />
                  ) : (
                    <Send aria-hidden="true" />
                  )}
                  Issue fees to pupils
                </Button>
              </FormActions>
            </form>
          </FormSection>

          <Card>
            <CardContent className="p-0">
              <DataTable
                caption="Fee structures"
                rows={data}
                rowKey={(s) => s.id}
                columns={[
                  {
                    key: 'label',
                    header: 'Fee',
                    primary: true,
                    cell: (s) => (
                      <>
                        <span className="font-medium text-foreground">{s.fee_label}</span>
                        {!s.is_mandatory && (
                          <Badge variant="neutral" className="ml-2">
                            Optional
                          </Badge>
                        )}
                      </>
                    ),
                  },
                  { key: 'grade', header: 'Grade', cell: (s) => formatLevel(s.grade_id) },
                  {
                    key: 'term',
                    header: 'When',
                    cell: (s) => `${s.academic_year} term ${s.term_number}`,
                  },
                  {
                    key: 'amount',
                    header: 'Amount',
                    numeric: true,
                    cell: (s) => formatKwacha(s.amount),
                  },
                ]}
                empty={
                  <EmptyState
                    icon={Receipt}
                    title="No fee structures yet"
                    description="A structure sets what one grade pays for one term. Nothing can be billed or paid until at least one exists."
                  />
                }
              />
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )
}
