'use client'

/**
 * Defining what a grade costs.
 *
 * Spec: `Official Documentation/09 Fee and Financial Management/FEE_STRUCTURES.md`
 *         → *Fee Structure Builder UI*
 *
 * ## Why this is the missing half
 *
 * `fee_structures` has carried every field since `0070` — label, grade, student type, amount,
 * term, mandatory — and `/api/fees/structures` has had GET and POST for as long. **No screen
 * ever let a school write one.** The structures page could only *issue* fees from structures
 * that did not exist, so the whole module read as unbuilt while the backend was complete.
 *
 * Business rule 1 is the consequence: with no structure for a grade and term, generation
 * creates nothing. A school would press "issue fees", see nothing happen, and have no way to
 * find out why.
 *
 * ## The term checkboxes are not a convenience
 *
 * One fee line applies to several terms — tuition to all three, an exam fee to Term 3 alone —
 * and the table stores a row per term. Without them a school defines tuition three times and
 * the three copies drift the first time one is edited.
 *
 * ## Changing a line never re-prices a bill already issued
 *
 * Business rule 3: `fee_records.amount_due` is copied at generation and preserved. Everything
 * here describes what FUTURE issuing will charge, and the screen says so, because a bursar
 * raising tuition in week 6 would otherwise reasonably assume every outstanding invoice moved.
 *
 * ## Retire, never delete
 *
 * A fee that no longer applies stops generating records but stays in history, because records
 * already issued from it reference what the school charged. The control says "Retire" for the
 * same reason the sibling screen says "issue" rather than "generate" — it describes what the
 * school is doing, not what the code does.
 */

import type { JSX } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { LoaderCircle, Plus, Receipt, RotateCcw } from 'lucide-react'

import { Badge } from '../../../../../components/ui/badge'
import { Input, Select } from '../../../../../components/ui/field'
import { Button } from '../../../../../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../../../components/ui/card'
import { useApi } from '../../../../../lib/use-api'
import { can } from '../../../../../lib/roles'
import type { Role } from '@zsms/auth-provider'
import { useToast } from '../../../../../components/ui/toast'
import { ReviseIssued } from './revise-issued'

interface Structure {
  id: string
  academic_year: string
  term_number: number
  grade_id: string
  student_type: string
  fee_label: string
  amount: number
  currency_code: string
  is_mandatory: boolean
  is_active: boolean
}

interface SchoolStructure {
  role: string
  gradeLevels: { level_id: string; display_name?: string | null }[]
}

const STUDENT_TYPES = [
  { value: 'all', label: 'Every pupil' },
  { value: 'day', label: 'Day pupils only' },
  { value: 'boarding', label: 'Boarders only' },
] as const

const kwacha = (amount: number, currency = 'ZMW'): string =>
  `${currency === 'ZMW' ? 'K' : currency + ' '}${Number(amount).toLocaleString('en-ZM', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

export function FeeLineBuilder({
  structures,
  onChanged,
}: {
  structures: Structure[]
  onChanged: () => void
}): JSX.Element {
  const school = useApi<SchoolStructure>('/api/school/structure')
  const { toast } = useToast()

  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(String(thisYear))
  const [label, setLabel] = useState('')
  const [gradeId, setGradeId] = useState('ALL')
  const [studentType, setStudentType] = useState<string>('all')
  const [amount, setAmount] = useState('')
  const [terms, setTerms] = useState<number[]>([1, 2, 3])
  const [mandatory, setMandatory] = useState(true)
  const [busy, setBusy] = useState(false)

  const grades = useMemo(() => school.data?.gradeLevels ?? [], [school.data])

  /*
    The permission comes from the role `/api/school/structure` already returns, rather than a
    prop: this component is the only thing that knows it needs it, and threading it through a
    page that never knew the role would be a second place for the rule to drift.

    This hides the controls. The ENFORCEMENT is the `fee_structures` policy — a bursar-only
    write that the route relies on and that a hidden button does not provide.
  */
  const canWrite = can((school.data?.role ?? 'none') as Role, 'fees:write')

  /** The lines in force for the year being edited, grouped so a school sees its price list. */
  const forYear = useMemo(
    () => structures.filter((s) => s.academic_year === year),
    [structures, year],
  )

  /**
   * What a pupil in each grade actually pays, per term.
   *
   * The flat list below is how a bursar finds and retires ONE line; it is not how anybody
   * checks the result is right. A school setting tuition, boarding and an activity fee
   * separately has no way to see that a Grade 8 day pupil therefore owes K2,900 — which is
   * the only number a parent will ever ask about.
   *
   * Day and boarding are separated because `student_type` means a line applies to one or
   * the other: summing them would quote every pupil a boarder's fees.
   */
  const totals = useMemo(() => {
    const groups = new Map<
      string,
      { gradeId: string; term: number; total: number; boardingExtra: number; parts: string[] }
    >()

    for (const line of forYear) {
      if (!line.is_active) continue
      const key = `${line.grade_id}-${line.term_number}`
      const g = groups.get(key) ?? {
        gradeId: line.grade_id,
        term: line.term_number,
        total: 0,
        boardingExtra: 0,
        parts: [] as string[],
      }

      const amount = Number(line.amount) || 0

      if (line.student_type === 'boarding') {
        // An extra, not part of the base: a day pupil never pays it.
        g.boardingExtra += amount
      } else if (line.student_type === 'day') {
        g.total += amount
        g.parts.push(`${line.fee_label} ${kwacha(amount)}`)
      } else {
        g.total += amount
        g.parts.push(`${line.fee_label} ${kwacha(amount)}`)
      }

      groups.set(key, g)
    }

    return [...groups.values()].sort(
      (a, b) => a.gradeId.localeCompare(b.gradeId) || a.term - b.term,
    )
  }, [forYear])

  /** Years already defined, so last year can be copied forward. */
  const years = useMemo(
    () => [...new Set(structures.map((s) => s.academic_year))].sort().reverse(),
    [structures],
  )

  const addLine = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      const value = Number(amount)
      if (!label.trim() || !Number.isFinite(value) || value < 0 || terms.length === 0) return

      setBusy(true)
      try {
        const response = await fetch('/api/fees/structures', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            academicYear: year.trim(),
            // Sent for compatibility with the original single-term shape; `termNumbers`
            // is what the route actually writes from.
            termNumber: terms[0],
            termNumbers: terms,
            gradeId,
            feeLabel: label.trim(),
            amount: value,
            studentType,
            isMandatory: mandatory,
          }),
        })
        const body = await response.json()
        if (!response.ok) {
          toast(body?.error ?? 'That fee line could not be saved.', 'danger')
          return
        }
        toast(
          `Added to ${terms.length} term${terms.length === 1 ? '' : 's'}.`,
          'success',
        )
        setLabel('')
        setAmount('')
        onChanged()
      } finally {
        setBusy(false)
      }
    },
    [year, terms, gradeId, label, amount, studentType, mandatory, onChanged, toast],
  )

  const setActive = useCallback(
    async (id: string, isActive: boolean) => {
      setBusy(true)
      try {
        const response = await fetch('/api/fees/structures', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, isActive }),
        })
        if (!response.ok) {
          const body = await response.json()
          toast(body?.error ?? 'That could not be changed.', 'danger')
          return
        }
        toast(isActive ? 'Fee line restored.' : 'Fee line retired.', 'success')
        onChanged()
      } finally {
        setBusy(false)
      }
    },
    [onChanged, toast],
  )

  /**
   * Copy a year forward, optionally with an increase.
   *
   * Every school does this annually, and the alternative is retyping forty lines — which is
   * where transcription errors in money come from. Rounded to whole kwacha: a tuition fee of
   * K2,625.00 is a price a school sets, K2,624.9999 is a rounding artefact on an invoice.
   */
  const copyYear = useCallback(
    async (fromYear: string, percent: number) => {
      const source = structures.filter((s) => s.academic_year === fromYear && s.is_active)
      if (source.length === 0) return

      setBusy(true)
      try {
        let written = 0
        for (const line of source) {
          const next = Math.round(Number(line.amount) * (1 + percent / 100))
          const response = await fetch('/api/fees/structures', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              academicYear: year.trim(),
              termNumber: line.term_number,
              gradeId: line.grade_id,
              feeLabel: line.fee_label,
              amount: next,
              studentType: line.student_type,
              isMandatory: line.is_mandatory,
            }),
          })
          if (response.ok) written += 1
        }
        toast(`Copied ${written} of ${source.length} fee lines into ${year}.`, 'success')
        onChanged()
      } finally {
        setBusy(false)
      }
    },
    [structures, year, onChanged, toast],
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Receipt aria-hidden="true" className="size-5 text-primary" />
          What each grade costs
        </CardTitle>
        <CardDescription>
          Define the price list before issuing fees — with no line for a grade and term, issuing
          creates nothing for those pupils. Changing a line here never alters a bill already
          issued.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-cards">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="fee-year" className="text-sm font-medium">
              Academic year
            </label>
            <Input
              id="fee-year"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="w-32"
            />
          </div>
          {/* Next year is a normal thing to prepare in October, so it is one tap rather than
              a field to retype. */}
          <Button variant="outline" size="sm" onClick={() => setYear(String(thisYear + 1))}>
            Prepare {thisYear + 1}
          </Button>
        </div>

        {canWrite && (
          <form
            onSubmit={addLine}
            className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-card"
          >
            <div className="flex flex-wrap gap-3">
              <div className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
                <label htmlFor="fee-label" className="text-sm font-medium">
                  Fee
                </label>
                <Input
                  id="fee-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Tuition Fee"
                  required
                  
                />
              </div>

              <div className="flex w-36 flex-col gap-1.5">
                <label htmlFor="fee-amount" className="text-sm font-medium">
                  Amount (K)
                </label>
                <Input
                  id="fee-amount"
                  type="number"
                  min={0}
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                  
                />
              </div>

              <div className="flex min-w-[10rem] flex-col gap-1.5">
                <label htmlFor="fee-grade" className="text-sm font-medium">
                  Grade
                </label>
                <Select
                  id="fee-grade"
                  value={gradeId}
                  onChange={(e) => setGradeId(e.target.value)}
                  
                >
                  {/* `ALL` is the documented special value — one amount for every grade. */}
                  <option value="ALL">Every grade</option>
                  {grades.map((g) => (
                    <option key={g.level_id} value={g.level_id}>
                      {g.display_name ?? g.level_id}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="flex min-w-[10rem] flex-col gap-1.5">
                <label htmlFor="fee-type" className="text-sm font-medium">
                  Applies to
                </label>
                <Select
                  id="fee-type"
                  value={studentType}
                  onChange={(e) => setStudentType(e.target.value)}
                  
                >
                  {STUDENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <fieldset className="flex flex-wrap items-center gap-3">
              <legend className="sr-only">Terms</legend>
              <span className="text-sm font-medium">Terms</span>
              {[1, 2, 3].map((t) => (
                <label key={t} className="flex min-h-tap cursor-pointer items-center gap-2 text-sm">
                  <Input
                    type="checkbox"
                    checked={terms.includes(t)}
                    onChange={(e) =>
                      setTerms((current) =>
                        e.target.checked
                          ? [...current, t].sort()
                          : current.filter((x) => x !== t),
                      )
                    }
                    className="size-4"
                  />
                  Term {t}
                </label>
              ))}

              <label className="ml-auto flex min-h-tap cursor-pointer items-center gap-2 text-sm">
                <Input
                  type="checkbox"
                  checked={mandatory}
                  onChange={(e) => setMandatory(e.target.checked)}
                  className="size-4"
                />
                Every pupil must pay it
              </label>
            </fieldset>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={busy || terms.length === 0}>
                {busy ? (
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                ) : (
                  <Plus aria-hidden="true" />
                )}
                Add fee line
              </Button>
              {terms.length === 0 && (
                <p className="text-sm text-danger">Choose at least one term.</p>
              )}
            </div>
          </form>
        )}

        {/* ---- what each grade actually pays ---- */}
        {totals.length > 0 && (
          <div className="rounded-lg border border-border bg-surface p-card">
            <h3 className="text-sm font-semibold">What a pupil pays in {year}</h3>
            <p className="mb-stack text-sm text-muted-foreground">
              The lines below added up, the way they will appear on a parent&rsquo;s
              statement. Check this before issuing — it is the number a family will ask
              about.
            </p>

            <ul className="flex flex-col gap-1">
              {totals.map((t) => (
                <li
                  key={`${t.gradeId}-${t.term}`}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-border py-1.5 text-sm last:border-0"
                >
                  <span className="min-w-[7rem] font-medium">
                    {t.gradeId === 'ALL' ? 'Every grade' : t.gradeId}
                  </span>
                  <span className="text-muted-foreground">Term {t.term}</span>

                  {/* The components, named. A total with no breakdown is the thing a
                      parent rings the office about, and the office cannot explain a
                      number it cannot see either. */}
                  <span className="min-w-[12rem] flex-1 text-muted-foreground">
                    {t.parts.join(' + ')}
                  </span>

                  <span data-numeric className="font-semibold">
                    {kwacha(t.total)}
                  </span>

                  {t.boardingExtra > 0 && (
                    // Boarders pay more, and the difference is the question a school is
                    // asked next. Shown as the extra rather than a second total, because
                    // that is how a school quotes it.
                    <span data-numeric className="text-sm text-muted-foreground">
                      +{kwacha(t.boardingExtra)} boarding
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ---- the price list ---- */}
        {forYear.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No fee lines for {year} yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {forYear
              .slice()
              .sort((a, b) =>
                a.fee_label.localeCompare(b.fee_label) || a.term_number - b.term_number,
              )
              .map((line) => (
                <li
                  key={line.id}
                  className={
                    'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border px-3 py-2 '
                    + (line.is_active ? 'bg-surface' : 'bg-muted/40 opacity-70')
                  }
                >
                  <span className="min-w-[8rem] flex-1 text-sm font-medium">
                    {line.fee_label}
                  </span>
                  <span data-numeric className="text-sm font-semibold">
                    {kwacha(line.amount, line.currency_code)}
                  </span>
                  <Badge variant="neutral">Term {line.term_number}</Badge>
                  <Badge variant="neutral">
                    {line.grade_id === 'ALL' ? 'Every grade' : line.grade_id}
                  </Badge>
                  {line.student_type !== 'all' && (
                    <Badge variant="info">
                      {line.student_type === 'boarding' ? 'Boarders' : 'Day pupils'}
                    </Badge>
                  )}
                  {!line.is_mandatory && <Badge variant="neutral">Optional</Badge>}
                  {!line.is_active && <Badge variant="neutral">Retired</Badge>}

                  {canWrite && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => setActive(line.id, !line.is_active)}
                    >
                      {line.is_active ? 'Retire' : 'Restore'}
                    </Button>
                  )}
                </li>
              ))}
          </ul>
        )}

        {/* Correcting bills already issued. Business rule 3 means the editor above
            deliberately does not touch them, which left a school that billed a whole
            term wrongly with no way to fix it. */}
        <ReviseIssued
          year={year}
          labels={[...new Set(forYear.filter((l) => l.is_active).map((l) => l.fee_label))].sort()}
        />

        {/* ---- copy a year forward ---- */}
        {canWrite && years.filter((y) => y !== year).length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-cards">
            <RotateCcw aria-hidden="true" className="size-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              Copy {years.filter((y) => y !== year)[0]} into {year}:
            </span>
            {[0, 5, 10].map((pct) => (
              <Button
                key={pct}
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => copyYear(years.filter((y) => y !== year)[0] as string, pct)}
              >
                {pct === 0 ? 'Same amounts' : `+${pct}%`}
              </Button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
