'use client'

/**
 * Bulk pupil import.
 *
 * Spec: `Official Documentation/07 Student and Parent Modules/STUDENTS.md`
 *
 * ## Check, then import — never one button
 *
 * The file is checked first and nothing is written. A school's first import is
 * always partly wrong, and finding that out after 300 rows have landed in the
 * roll is the difference between a tool people trust and one they abandon. So
 * "Check the file" is the primary action and "Import" only appears once the
 * check comes back clean.
 *
 * ## Problems are listed by row and column, not counted
 *
 * "23 errors" is useless. "Row 14, house: "Purple" is not one of: Red, Blue,
 * Green" can be fixed. The list is capped because a wrong header produces one
 * problem per row and a wall of identical messages buries the real ones.
 *
 * ## Parsing happens here, validation happens on the server
 *
 * The CSV is split in the browser because the file never needs to be uploaded —
 * but nothing is trusted from it. Every cell is coerced and checked server-side
 * against the school's own field definitions, and the database refuses anything
 * that still slips through.
 */

import type { ChangeEvent, JSX } from 'react'
import { use, useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { CircleCheck, FileUp, LoaderCircle, Upload } from 'lucide-react'

import { apiSend, useApi } from '../../../../../lib/use-api'
import { Alert } from '../../../../../components/ui/alert'
import { SectionLink } from '../../../../../components/ui/section-link'
import { Button } from '../../../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../../../components/ui/card'
import { DataTable } from '../../../../../components/ui/data-table'
import { PageHeader } from '../../../../../components/ui/data-states'
import { useToast } from '../../../../../components/ui/toast'

interface Problem {
  row: number
  field: string
  message: string
}

interface ImportResult {
  rows: number
  problems: Problem[]
  problemCount: number
  committed: boolean
  willCreate?: number
  created?: number
}

interface FieldDef {
  field_key: string
  label: string
  sensitivity: 'standard' | 'sensitive'
  is_active: boolean
}

const STANDARD_COLUMNS = [
  'first_name',
  'last_name',
  'class_id',
  'grade_id',
  'date_of_birth',
  'gender',
  'nrc_or_birth_cert',
  'enrolment_date',
  'is_boarding',
]

/**
 * Minimal CSV parse — quoted cells and embedded commas.
 *
 * Deliberately not `split(',')`: a Zambian address or a guardian name with a
 * comma inside quotes would shift every later column by one, and the import
 * would succeed with the wrong data in the wrong fields.
 */
function parseCsv(text: string): { headers: string[]; rows: Array<Record<string, string>> } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() !== '')
  if (lines.length === 0) return { headers: [], rows: [] }

  const splitLine = (line: string): string[] => {
    const out: string[] = []
    let cur = ''
    let quoted = false
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]
      if (quoted) {
        if (ch === '"') {
          // A doubled quote inside a quoted cell is a literal quote.
          if (line[i + 1] === '"') {
            cur += '"'
            i += 1
          } else {
            quoted = false
          }
        } else {
          cur += ch
        }
      } else if (ch === '"') {
        quoted = true
      } else if (ch === ',') {
        out.push(cur)
        cur = ''
      } else {
        cur += ch
      }
    }
    out.push(cur)
    return out.map((c) => c.trim())
  }

  const headers = splitLine(lines[0] ?? '')
  const rows = lines.slice(1).map((line) => {
    const cells = splitLine(line)
    const row: Record<string, string> = {}
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? ''
    })
    return row
  })

  return { headers, rows }
}

export default function ImportPupilsPage({
  params,
}: {
  params: Promise<{ schoolCode: string }>
}): JSX.Element {
  const { schoolCode } = use(params)
  const base = `/school/${schoolCode}`
  const { toast } = useToast()

  const fieldsApi = useApi<{ fields: FieldDef[] }>('/api/school/custom-fields')

  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<Array<Record<string, string>>>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [result, setResult] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Only standard-sensitivity fields are importable — a sensitive field is
  // refused server-side, so offering it in the template would be a trap.
  const template = useMemo(() => {
    const custom = (fieldsApi.data?.fields ?? [])
      .filter((f) => f.is_active && f.sensitivity === 'standard')
      .map((f) => f.field_key)
    return [...STANDARD_COLUMNS, ...custom].join(',')
  }, [fieldsApi.data])

  const onFile = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setError(null)
    setResult(null)
    setFileName(file.name)

    const reader = new FileReader()
    reader.onload = () => {
      const parsed = parseCsv(String(reader.result ?? ''))
      if (parsed.rows.length === 0) {
        setError('That file has a header row but no pupils in it.')
        setRows([])
        setHeaders([])
        return
      }
      if (parsed.rows.length > 500) {
        setError(
          `That file has ${parsed.rows.length} rows. Import up to 500 at a time — split it into smaller files.`,
        )
        setRows([])
        return
      }
      setHeaders(parsed.headers)
      setRows(parsed.rows)
    }
    reader.onerror = () => setError('That file could not be read.')
    reader.readAsText(file)
  }, [])

  const run = useCallback(
    async (mode: 'validate' | 'commit') => {
      setBusy(true)
      setError(null)

      const res = await apiSend<ImportResult>('/api/school/students/import', 'POST', { mode, rows })

      setBusy(false)
      if (res.error) {
        setError(res.error)
        setResult(null)
        return
      }
      setResult(res.data ?? null)

      if (mode === 'commit' && res.data?.committed) {
        toast(`${res.data.created ?? 0} pupils added to the roll.`)
      }
    },
    [rows, toast],
  )

  const clean = result !== null && result.problemCount === 0 && !result.committed

  return (
    <>
      <PageHeader
        backTo={`${base}/students`}
        backLabel="Pupils"
        title="Import pupils"
        description="Add many pupils at once from a spreadsheet."
        note="Nothing is saved until you have checked the file and pressed Import. The check reports every problem by row and column so you can fix the spreadsheet rather than guess. Either every row is imported or none is — a part-finished import would leave a roll nobody can reconcile. Fields marked sensitive cannot be imported; enter those on the pupil's record."
      />

      <div className="space-y-cards">
        <Card>
          <CardHeader>
            <CardTitle>The file</CardTitle>
            <p className="text-sm text-muted-foreground">
              A CSV whose first row is the column names. Dates as YYYY-MM-DD; several choices in
              one cell separated by semicolons.
            </p>
          </CardHeader>
          <CardContent className="space-y-stack">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="csv" className="text-sm font-medium text-foreground">
                Choose a CSV file
              </label>
              <input
                id="csv"
                type="file"
                accept=".csv,text/csv"
                onChange={onFile}
                className="block w-full rounded-md border border-border bg-background p-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm"
              />
            </div>

            <div className="rounded-md border border-border bg-muted/40 p-3">
              <p className="text-sm font-medium text-foreground">Column names to use</p>
              {/* Shown as text rather than a download: a viewer-initiated
                  download is blocked in some contexts, and a header row is
                  short enough to copy. */}
              <p className="mt-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-muted-foreground">
                {template}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                <code className="font-mono">first_name</code>,{' '}
                <code className="font-mono">last_name</code>,{' '}
                <code className="font-mono">grade_id</code> and{' '}
                <code className="font-mono">class_id</code> are required. The rest are optional.{' '}
                <Link href={`${base}/settings/fields`} className="underline">
                  Manage the extra fields
                </Link>
                .
              </p>
            </div>

            {fileName && rows.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {fileName} — {rows.length} row{rows.length === 1 ? '' : 's'},{' '}
                {headers.length} columns.
              </p>
            )}

            {error && (
              <Alert variant="danger" title="Nothing was imported">
                {error}
              </Alert>
            )}

            <div className="flex flex-wrap gap-2">
              <Button disabled={busy || rows.length === 0} onClick={() => run('validate')}>
                {busy ? (
                  <LoaderCircle aria-hidden="true" className="animate-spin" />
                ) : (
                  <FileUp aria-hidden="true" />
                )}
                Check the file
              </Button>

              {clean && (
                <Button variant="default" disabled={busy} onClick={() => run('commit')}>
                  <Upload aria-hidden="true" />
                  Import {result?.willCreate ?? rows.length} pupils
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {result?.committed && (
          <Alert variant="success" title="Import finished">
            {result.created} pupils were added to the roll.
            {/*
              A BUTTON, not an underlined link: this is the next action after a
              successful import, not a reference inside a sentence. The distinction is
              the design rule — a standalone navigation affordance is a button with an
              arrow; a link inside prose stays a link, because turning "recorded in the
              audit trail" into a button would break the sentence it is part of.
            */}
            <span className="mt-stack block">
              <SectionLink href={`${base}/students`} variant="outline">
                See the roll
              </SectionLink>
            </span>
            .
          </Alert>
        )}

        {clean && (
          <Alert variant="success" title="The file looks good">
            <CircleCheck aria-hidden="true" className="mr-1 inline size-4" />
            {result?.willCreate} pupils are ready to import. Nothing has been saved yet.
          </Alert>
        )}

        {result && result.problemCount > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>
                {result.problemCount} problem{result.problemCount === 1 ? '' : 's'} to fix
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Nothing was imported. Fix the spreadsheet and check it again.
                {result.problemCount > result.problems.length &&
                  ` Showing the first ${result.problems.length}.`}
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <DataTable
                caption="Problems found in the file"
                rows={result.problems}
                rowKey={(p) => `${p.row}-${p.field}-${p.message}`}
                columns={[
                  { key: 'row', header: 'Row', cell: (p) => p.row, numeric: true },
                  {
                    key: 'field',
                    header: 'Column',
                    primary: true,
                    cell: (p) => <span className="font-mono text-sm">{p.field}</span>,
                  },
                  { key: 'msg', header: 'Problem', cell: (p) => p.message },
                ]}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </>
  )
}
