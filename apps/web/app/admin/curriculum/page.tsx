'use client'

/**
 * Curriculum — what the AI is grounded in, and how to ground it further.
 *
 * Spec: `Official Documentation/18 AI Module/LESSON_PLANNER.md`
 *
 * ## This screen exists because the store ships empty
 *
 * `0136` creates the curriculum tables and inserts no syllabus content, deliberately: inventing
 * ECZ topic codes to make a demo look complete would put fabricated curriculum references into the
 * product, which is the exact failure the whole design prevents. Real content comes from the ECZ
 * syllabus PDFs — publicly available from the Examinations Council of Zambia — through this page.
 *
 * ## Outcomes are the number that matters, not topics
 *
 * A subject showing thirty topics and zero outcomes is ingested and useless. A topic name alone
 * tells a model almost nothing it did not already know; "solve a pair of simultaneous linear
 * equations by substitution and by elimination" is what makes a plan syllabus-aligned rather than
 * merely plausible. So the table leads with outcomes and flags a row that has none.
 */

import type { JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { BookMarked, TriangleAlert } from 'lucide-react'

import { Alert } from '../../../components/ui/alert'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card'
import { Field, Textarea } from '../../../components/ui/field'
import { EmptyState } from '../../../components/ui/empty-state'
import { ErrorState, PageHeader, TableSkeleton } from '../../../components/ui/data-states'
import { StatCard } from '../../../components/ui/stat-card'
import { useToast } from '../../../components/ui/toast'

interface CoverageRow {
  country_code: string
  curriculum_type: string
  subject: string
  grade_level: string
  topic_count: number
  outcome_count: number
  sources: string[]
  last_updated: string
}

interface Payload {
  coverage: CoverageRow[]
  totals: { combinations: number; topics: number; outcomes: number; subjects: number }
}

const EXAMPLE = `[
  {
    "subject": "Mathematics",
    "grade_level": "Grade 9",
    "curriculum_type": "ecz",
    "topic_code": "7.3",
    "topic_name": "Simultaneous equations",
    "sub_topics": ["Substitution method", "Elimination method"],
    "learning_outcomes": [
      "Solve a pair of simultaneous linear equations by substitution",
      "Solve a pair of simultaneous linear equations by elimination",
      "Apply simultaneous equations to word problems"
    ],
    "suggested_periods": 6,
    "source": "ECZ Mathematics Syllabus Grades 8-9",
    "syllabus_year": 2023,
    "display_order": 3
  }
]`

export default function CurriculumPage(): JSX.Element {
  const { toast } = useToast()
  const [payload, setPayload] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [raw, setRaw] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/admin/curriculum')
      const body = (await response.json()) as { data?: Payload; error?: string }
      if (!response.ok) {
        setError(body.error ?? 'Could not load curriculum coverage.')
        setLoading(false)
        return
      }
      setError(null)
      setPayload(body.data ?? null)
    } catch {
      setError('Could not reach the server.')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const runImport = async (): Promise<void> => {
    setImporting(true)
    setResult(null)

    let rows: unknown
    try {
      rows = JSON.parse(raw)
    } catch {
      // Parsed here rather than posted blindly, so a stray comma is a message in front of the
      // operator instead of a validation error round trip.
      toast('That is not valid JSON. Check for a trailing comma.', 'danger')
      setImporting(false)
      return
    }

    if (!Array.isArray(rows)) {
      toast('The top level must be an array of topic rows.', 'danger')
      setImporting(false)
      return
    }

    try {
      const response = await fetch('/api/admin/curriculum', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      })
      const body = (await response.json()) as {
        data?: { inserted: number; updated: number; skipped: number; errors: unknown[] }
        error?: string
      }

      if (!response.ok || !body.data) {
        toast(body.error ?? 'The import failed.', 'danger')
        setImporting(false)
        return
      }

      const { inserted, updated, skipped, errors } = body.data
      setResult(
        `${inserted} added, ${updated} updated, ${skipped} skipped.`
          + (errors.length > 0 ? ` Problems: ${JSON.stringify(errors, null, 2)}` : ''),
      )
      // A partial success is still a success worth reporting honestly — skipped rows are named
      // rather than rounded away.
      toast(
        skipped > 0
          ? `Imported with ${skipped} row${skipped === 1 ? '' : 's'} skipped.`
          : 'Imported.',
        skipped > 0 ? 'danger' : 'success',
      )
      if (inserted + updated > 0) {
        setRaw('')
        void load()
      }
    } catch {
      toast('Could not reach the server.', 'danger')
    }
    setImporting(false)
  }

  const coverage = payload?.coverage ?? []
  const totals = payload?.totals

  return (
    <>
      <PageHeader
        title="Curriculum"
        description="The syllabus content that grounds AI lesson plans, quizzes and homework."
        note={
          <>
            A generation is given <strong>every topic for the subject and grade</strong> — not a
            matched one — so the model cannot cite a code that was not in front of it. Where
            nothing is ingested, the prompt is told to cite nothing at all rather than to guess.
          </>
        }
      />

      <div className="space-y-cards">
        {totals && (
          <div className="grid gap-4 sm:grid-cols-4">
            <StatCard label="Subjects" value={String(totals.subjects)} />
            <StatCard label="Subject + grade" value={String(totals.combinations)} />
            <StatCard label="Topics" value={String(totals.topics)} />
            <StatCard
              label="Learning outcomes"
              value={String(totals.outcomes)}
              tone={totals.outcomes > 0 ? 'success' : 'warning'}
              hint="What actually grounds a plan"
            />
          </div>
        )}

        {totals?.outcomes === 0 && (
          <Alert variant="warning" title="Nothing is grounded yet">
            <p>
              No syllabus content has been imported, so every generation runs ungrounded — the
              model writes from its own knowledge and is instructed to cite nothing. That is
              honest, but it is not the product.
            </p>
            <p className="mt-2">
              ECZ syllabuses are published by the Examinations Council of Zambia and can be
              transcribed into the format below. Start with one subject and grade — Grade 9
              Mathematics is a good first slice — and check the output before doing more.
            </p>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Import syllabus topics</CardTitle>
            <CardDescription>
              An array of topic rows. Re-importing a topic code <strong>replaces</strong> it, so a
              corrected syllabus is an update rather than a duplicate. A row missing a required
              field is skipped and reported — the rest of the file still imports.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field
              id="rows"
              label="Topic rows (JSON)"
              hint="Required on every row: subject, grade_level, topic_code, topic_name, source."
            >
              {(props) => (
                <Textarea
                  {...props}
                  rows={12}
                  value={raw}
                  placeholder={EXAMPLE}
                  onChange={(e) => setRaw(e.target.value)}
                  className="font-mono text-xs"
                />
              )}
            </Field>

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => void runImport()} disabled={importing || raw.trim().length < 2}>
                {importing ? 'Importing…' : 'Import'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setRaw(EXAMPLE)}>
                Load the example
              </Button>
            </div>

            {result && (
              <pre className="max-h-60 overflow-auto rounded-md bg-neutral-tint p-3 text-xs text-neutral-text">
                {result}
              </pre>
            )}
          </CardContent>
        </Card>

        {loading ? (
          <TableSkeleton rows={5} columns={4} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : coverage.length === 0 ? (
          <EmptyState
            icon={BookMarked}
            title="No syllabus content yet"
            description="Import a subject and grade above to ground generation in the real syllabus."
          />
        ) : (
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y divide-border">
                {coverage.map((row) => (
                  <li
                    key={`${row.country_code}-${row.curriculum_type}-${row.subject}-${row.grade_level}`}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-text">
                        {row.subject} · {row.grade_level}
                      </p>
                      <p className="truncate text-xs text-muted-text">
                        {row.curriculum_type.toUpperCase()} · {row.country_code} ·{' '}
                        {row.sources.join(', ')}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-muted-text">
                        {row.topic_count} topic{Number(row.topic_count) === 1 ? '' : 's'}
                      </span>
                      {/*
                        The flag that matters. Topics with no outcomes look ingested on any row
                        count and ground nothing at all.
                      */}
                      {Number(row.outcome_count) === 0 ? (
                        <Badge variant="warning">
                          <TriangleAlert className="size-3" aria-hidden />
                          No outcomes
                        </Badge>
                      ) : (
                        <Badge variant="success">{row.outcome_count} outcomes</Badge>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  )
}
