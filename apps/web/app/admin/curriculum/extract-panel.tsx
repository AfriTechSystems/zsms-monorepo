'use client'

/**
 * Upload a syllabus, check what came out, then import it.
 *
 * Spec: `Official Documentation/18 AI Module/LESSON_PLANNER.md`
 *       `Official Documentation/18 AI Module/AI_CAPTURE.md` — extract, verify, then write
 *
 * ## Three steps, and the middle one is not optional
 *
 * Pick the slice → extract → **check the table** → import. The verification step is the reason
 * this is safe to build at all: a misread topic code does not look misread, and an unchecked
 * import would put a plausible fabrication into the store that grounds every lesson plan.
 *
 * ## Inferred codes are marked, loudly
 *
 * Some syllabuses number their topics and some do not. Where the document gave no code, the model
 * uses the position and says so, and this table flags it. An inferred code is a usable internal
 * key and must never be shown to a teacher as a syllabus reference — which is a judgement only the
 * person looking at the source document can make.
 */

import type { JSX } from 'react'
import type { ChangeEvent } from 'react'
import { useState } from 'react'
import { FileUp, Info, Trash2, TriangleAlert, X } from 'lucide-react'

import { Alert } from '../../../components/ui/alert'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card'
import { Dialog } from '../../../components/ui/dialog'
import { Field, Input, Select, Textarea } from '../../../components/ui/field'
import { useToast } from '../../../components/ui/toast'

interface Topic {
  topic_code: string
  code_inferred: boolean
  topic_name: string
  sub_topics: string[]
  learning_outcomes: string[]
  suggested_periods: number | null
  display_order: number
  /** Which slice this row belongs to. Varies within one extraction now. */
  subject: string
  grade_level: string
}

interface Extraction {
  topics: Topic[]
  detectedSource: string
  detectedSyllabusYear: number | null
  notes: string
  context: { curriculumType: string; subjects: string[]; grades: string[] }
  /** Rows the model tagged outside the requested slice, dropped by the route. */
  discarded: number
  document: { name: string; kind: string; characters: number; truncated: boolean }
  cost: {
    provider: string
    model: string
    inputTokens: number
    outputTokens: number
    usd: number
    recoveredFrom: number
  }
}

const CURRICULA = [
  { value: 'ecz', label: 'ECZ (Zambia)' },
  { value: 'cambridge_igcse', label: 'Cambridge IGCSE' },
  { value: 'cambridge_alevel', label: 'Cambridge A-Level' },
  { value: 'custom', label: 'School-defined' },
]

const GRADES = [
  ...Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`),
  ...Array.from({ length: 6 }, (_, i) => `Form ${i + 1}`),
]

const SUBJECTS = [
  'Mathematics', 'English', 'Science', 'Biology', 'Chemistry', 'Physics',
  'Civic Education', 'Geography', 'History', 'Computer Studies',
  'Religious Education', 'Business Studies', 'Agricultural Science',
]

export function ExtractPanel({ onImported }: { onImported: () => void }): JSX.Element {
  const { toast } = useToast()

  const [curriculumType, setCurriculumType] = useState('ecz')

  /*
    Sets, not single values.

    An ECZ syllabus covers a subject across a band of grades — "Mathematics, Grades 8 to
    9" is one document, and under the old one-at-a-time contract an operator ran the same
    PDF once per grade. Asked for on 2026-10-05.
  */
  const [subjects, setSubjects] = useState<string[]>([])
  const [grades, setGrades] = useState<string[]>([])
  const [ownSubject, setOwnSubject] = useState('')

  /** The slice picker is a popup; the card shows a summary of what was chosen. */
  const [pickerOpen, setPickerOpen] = useState(false)

  /*
    The range selects, held separately from the chosen set.

    They are an INPUT to the set rather than the set itself, so "Add range" can be
    pressed twice to combine Grades 8-9 with Form 1 — which a school mid-reform really
    does have.
  */
  const [rangeFrom, setRangeFrom] = useState('')
  const [rangeTo, setRangeTo] = useState('')
  const [file, setFile] = useState<File | null>(null)

  const [extracting, setExtracting] = useState(false)
  const [extraction, setExtraction] = useState<Extraction | null>(null)
  const [topics, setTopics] = useState<Topic[]>([])
  const [source, setSource] = useState('')
  const [year, setYear] = useState('')
  const [importing, setImporting] = useState(false)

  const combinations = subjects.length * grades.length
  const ready = subjects.length > 0 && grades.length > 0 && file !== null && combinations <= 24

  /**
   * Fills in every grade between two, inclusive, in the order GRADES lists them.
   *
   * A range is how a syllabus describes itself ("Grades 8–9"), and picking each one
   * separately is the step an operator forgets. Order-independent, because somebody will
   * choose the later grade first.
   */
  const applyRange = (from: string, to: string): void => {
    const a = GRADES.indexOf(from)
    const b = GRADES.indexOf(to)
    if (a < 0 || b < 0) return
    const [lo, hi] = a <= b ? [a, b] : [b, a]
    // Merged with what is already chosen rather than replacing it, so two ranges can be
    // combined — Grades 8-9 plus Form 1, which a reform-transition school really has.
    setGrades((prev) => [...new Set([...prev, ...GRADES.slice(lo, hi + 1)])])
  }

  const extract = async (): Promise<void> => {
    if (!file) return
    setExtracting(true)
    setExtraction(null)

    const form = new FormData()
    form.append('file', file)
    form.append('curriculumType', curriculumType)
    // Repeated fields, which is what `form.getAll()` reads on the route.
    for (const x of subjects) form.append('subjects', x)
    for (const x of grades) form.append('grades', x)

    try {
      const response = await fetch('/api/admin/curriculum/extract', { method: 'POST', body: form })
      const body = (await response.json()) as { data?: Extraction; error?: string }

      if (!response.ok || !body.data) {
        toast(body.error ?? 'Extraction failed.', 'danger')
        setExtracting(false)
        return
      }

      setExtraction(body.data)
      setTopics(body.data.topics)
      setSource(body.data.detectedSource)
      setYear(body.data.detectedSyllabusYear ? String(body.data.detectedSyllabusYear) : '')
      toast(
        body.data.topics.length === 0
          ? 'Nothing was found for those subjects and grades.'
          : `Found ${body.data.topics.length} topics. Check them before importing.`,
        body.data.topics.length === 0 ? 'danger' : 'success',
      )
    } catch {
      toast('Could not reach the server.', 'danger')
    }
    setExtracting(false)
  }

  const runImport = async (): Promise<void> => {
    if (!extraction) return
    setImporting(true)

    const rows = topics.map((t) => ({
      country_code: 'ZM',
      curriculum_type: extraction.context.curriculumType,
      /*
        The TOPIC's own subject and grade, not the extraction's.

        One document can now produce rows across several of both, and
        `curriculum_topics` is unique on (country, curriculum, subject, grade_level,
        topic_code) — so taking the slice from the extraction would collapse every grade
        onto one and silently overwrite as it went.
      */
      subject: t.subject,
      grade_level: t.grade_level,
      topic_code: t.topic_code,
      topic_name: t.topic_name,
      sub_topics: t.sub_topics,
      learning_outcomes: t.learning_outcomes,
      suggested_periods: t.suggested_periods,
      source,
      syllabus_year: year === '' ? undefined : Number(year),
      display_order: t.display_order,
    }))

    try {
      const response = await fetch('/api/admin/curriculum', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      })
      const body = (await response.json()) as {
        data?: { inserted: number; updated: number; skipped: number }
        error?: string
      }

      if (!response.ok || !body.data) {
        toast(body.error ?? 'The import failed.', 'danger')
        setImporting(false)
        return
      }

      const { inserted, updated, skipped } = body.data
      toast(
        `${inserted} added, ${updated} updated${skipped > 0 ? `, ${skipped} skipped` : ''}.`,
        skipped > 0 ? 'danger' : 'success',
      )
      if (skipped === 0) {
        setExtraction(null)
        setTopics([])
        setFile(null)
      }
      onImported()
    } catch {
      toast('Could not reach the server.', 'danger')
    }
    setImporting(false)
  }

  const inferredCount = topics.filter((t) => t.code_inferred).length
  const noOutcomeCount = topics.filter((t) => t.learning_outcomes.length === 0).length

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import from a syllabus document</CardTitle>
        <CardDescription>
          Choose the slice, upload the PDF or Word file, then check what came out before it is
          saved. Nothing is written until you press import.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* ---------- Step 1: which slice ---------- */}
        {/*
          A summary and a button, not the three fields.

          The fields were a 3-column grid above the upload, and multi-select plus a grade
          range does not fit there — it would push the file picker and the Extract button
          off a laptop screen. The popup also makes the ORDER explicit: the slice is
          chosen, then the document is uploaded against it.
        */}
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border p-card">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-sm font-medium">What to extract</span>

            {subjects.length === 0 || grades.length === 0 ? (
              <span className="text-sm text-muted-text">
                Nothing chosen yet. The slice comes first — it is what stops one document&apos;s
                grades merging into a table nobody can untangle.
              </span>
            ) : (
              <span className="flex flex-wrap items-center gap-1.5">
                {subjects.map((x) => (
                  <Badge key={`s-${x}`} variant="neutral">
                    {x}
                  </Badge>
                ))}
                <span aria-hidden="true" className="text-muted-text">
                  ·
                </span>
                {grades.map((x) => (
                  <Badge key={`g-${x}`} variant="neutral">
                    {x}
                  </Badge>
                ))}
              </span>
            )}

            {combinations > 0 && (
              <span className="text-xs text-muted-text">
                {combinations} subject-and-grade combination{combinations === 1 ? '' : 's'}
                {combinations > 24 && ' — too many for one pass, keep it under 24'}
              </span>
            )}
          </div>

          <Button
            variant="outline"
            className="ml-auto"
            onClick={() => setPickerOpen(true)}
          >
            {subjects.length === 0 || grades.length === 0 ? 'Choose' : 'Change'}
          </Button>
        </div>

        {/* ---------- Step 2: the file ---------- */}
        <Field
          id="file"
          label="Syllabus file"
          required
          hint="PDF, .docx or plain text, up to 15MB. A scanned document will not work — the pages are images with no text in them."
        >
          {(props) => (
            <Input
              {...props}
              type="file"
              accept=".pdf,.docx,.txt,.md"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          )}
        </Field>

        <Button onClick={() => void extract()} disabled={!ready || extracting}>
          <FileUp className="size-4" aria-hidden />
          {extracting ? 'Reading the document…' : 'Extract topics'}
        </Button>

        {/* ---------- Step 3: verification ---------- */}
        {extraction && (
          <div className="space-y-4 border-t border-border pt-5">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="font-semibold text-text">
                {topics.length} topic{topics.length === 1 ? '' : 's'} found
              </h3>
              {/* A count, not a name: one extraction now spans several subjects and
                  grades, and the table below carries the per-row detail. */}
              <Badge variant="neutral">
                {extraction.context.subjects.length} subject
                {extraction.context.subjects.length === 1 ? '' : 's'} ·{' '}
                {extraction.context.grades.length} grade
                {extraction.context.grades.length === 1 ? '' : 's'}
              </Badge>
              {extraction.discarded > 0 && (
                <Badge variant="warning">
                  {/* Said out loud. Otherwise an operator who gets 40 topics from a
                      60-topic document assumes the extraction was thin, when in fact the
                      model tagged 20 rows outside the slice they asked for. */}
                  {extraction.discarded} outside the slice, dropped
                </Badge>
              )}
              <span className="text-xs text-muted-text">
                {/* What it cost, so a 200-page syllabus is a known quantity before doing eleven
                    more. Not charged to anyone's credits — this is AfriTech's own platform work. */}
                {extraction.cost.provider} · {extraction.cost.inputTokens.toLocaleString()} in /{' '}
                {extraction.cost.outputTokens.toLocaleString()} out · $
                {extraction.cost.usd.toFixed(4)}
                {extraction.cost.recoveredFrom > 0 &&
                  ` · recovered from ${extraction.cost.recoveredFrom} provider failure(s)`}
              </span>
            </div>

            {extraction.document.truncated && (
              <Alert variant="warning" title="The document was too long to read in one pass">
                Only the first part was sent to the model, so topics near the end are missing. Split
                the file by grade or subject and import each piece.
              </Alert>
            )}

            {extraction.notes && (
              <Alert variant="info" title="The extraction left a note">
                {extraction.notes}
              </Alert>
            )}

            {inferredCount > 0 && (
              <Alert variant="warning" title={`${inferredCount} topic code(s) were made up from position`}>
                The document gave no code for these, so their position was used. That is fine as an
                internal key — but it is <strong>not</strong> a real syllabus reference, and a
                lesson plan citing it would be citing something that does not exist. Correct them
                against the document, or accept that those topics carry a number of our own.
              </Alert>
            )}

            {noOutcomeCount > 0 && (
              <Alert variant="warning" title={`${noOutcomeCount} topic(s) have no learning outcomes`}>
                A topic name alone grounds almost nothing — the outcomes are the substance. Either
                the document does not state them for these topics, or they were missed.
              </Alert>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="source" label="Source" required hint="Printed on every citation.">
                {(props) => (
                  <Input {...props} value={source} onChange={(e) => setSource(e.target.value)} />
                )}
              </Field>
              <Field id="year" label="Syllabus year">
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                  />
                )}
              </Field>
            </div>

            <ul className="space-y-3">
              {topics.map((topic, index) => (
                <li key={index} className="rounded-lg border border-border p-4">
                  {/*
                    Which slice this row will be filed under.

                    Shown because an extraction now spans several subjects and grades, and
                    this is the field an operator must actually check: a topic filed under
                    the wrong grade looks perfectly correct in a review table and becomes a
                    syllabus citation the lesson planner shows a teacher as national
                    curriculum. A missing topic is visible; a misfiled one is not.
                  */}
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    <Badge variant="neutral">{topic.subject}</Badge>
                    <Badge variant="neutral">{topic.grade_level}</Badge>
                  </div>

                  <div className="flex flex-wrap items-start gap-3">
                    <div className="w-28 shrink-0">
                      <Field id={`code-${index}`} label="Code">
                        {(props) => (
                          <Input
                            {...props}
                            value={topic.topic_code}
                            onChange={(e) => {
                              const next = [...topics]
                              // Editing a code makes it the operator's, not the model's guess.
                              next[index] = {
                                ...topic,
                                topic_code: e.target.value,
                                code_inferred: false,
                              }
                              setTopics(next)
                            }}
                          />
                        )}
                      </Field>
                      {topic.code_inferred && (
                        <Badge variant="warning" className="mt-1">
                          <TriangleAlert className="size-3" aria-hidden />
                          Made up
                        </Badge>
                      )}
                    </div>

                    <div className="min-w-0 flex-1 space-y-2">
                      <Field id={`name-${index}`} label="Topic">
                        {(props) => (
                          <Input
                            {...props}
                            value={topic.topic_name}
                            onChange={(e) => {
                              const next = [...topics]
                              next[index] = { ...topic, topic_name: e.target.value }
                              setTopics(next)
                            }}
                          />
                        )}
                      </Field>

                      <Field
                        id={`outcomes-${index}`}
                        label={`Learning outcomes (${topic.learning_outcomes.length})`}
                        hint="One per line. These are what ground a lesson plan."
                      >
                        {(props) => (
                          <Textarea
                            {...props}
                            rows={Math.min(Math.max(topic.learning_outcomes.length, 2), 6)}
                            value={topic.learning_outcomes.join('\n')}
                            onChange={(e) => {
                              const next = [...topics]
                              next[index] = {
                                ...topic,
                                learning_outcomes: e.target.value
                                  .split('\n')
                                  .map((l) => l.trim())
                                  .filter(Boolean),
                              }
                              setTopics(next)
                            }}
                          />
                        )}
                      </Field>
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${topic.topic_name}`}
                      onClick={() => setTopics(topics.filter((_, i) => i !== index))}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
              <Button
                onClick={() => void runImport()}
                disabled={importing || topics.length === 0 || source.trim() === ''}
              >
                {importing ? 'Importing…' : `Import ${topics.length} topics`}
              </Button>
              <Button variant="ghost" onClick={() => { setExtraction(null); setTopics([]) }}>
                Discard
              </Button>
              <p className="text-xs text-muted-text">
                <Info className="mr-1 inline size-3" aria-hidden />
                Re-importing a topic code replaces it rather than duplicating.
              </p>
            </div>
          </div>
        )}
      </CardContent>

      {/* ---------- the slice picker ---------- */}
      <Dialog
        open={pickerOpen}
        title="What to extract"
        description="One document can cover several subjects and a band of grades. Name them, and every topic is filed under the right one."
        onClose={() => setPickerOpen(false)}
        footer={
          <>
            <Button
              disabled={subjects.length === 0 || grades.length === 0 || combinations > 24}
              onClick={() => setPickerOpen(false)}
            >
              Done
            </Button>
            <Button variant="ghost" onClick={() => setPickerOpen(false)}>
              Cancel
            </Button>
            {(subjects.length > 0 || grades.length > 0) && (
              <Button
                variant="ghost"
                className="ml-auto"
                onClick={() => {
                  setSubjects([])
                  setGrades([])
                }}
              >
                Clear all
              </Button>
            )}
          </>
        }
      >
        <div className="flex flex-col gap-cards">
          <Field id="curriculum" label="Curriculum" required>
            {(props) => (
              <Select
                {...props}
                value={curriculumType}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => setCurriculumType(e.target.value)}
              >
                {CURRICULA.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {/* ---- subjects ---- */}
          <Field
            id="subjects"
            label="Subjects"
            required
            hint="Tick every subject this document covers. Add your own if it is not listed."
          >
            {() => (
              <div className="flex flex-col gap-stack">
                <div className="flex flex-wrap gap-2">
                  {SUBJECTS.map((x) => (
                    <label
                      key={x}
                      className="flex min-h-tap cursor-pointer items-center gap-1.5 text-sm"
                    >
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={subjects.includes(x)}
                        onChange={(e) =>
                          setSubjects((prev) =>
                            e.target.checked ? [...prev, x] : prev.filter((y) => y !== x),
                          )
                        }
                      />
                      {x}
                    </label>
                  ))}
                </div>

                {/*
                  A subject the list does not have.

                  The spelling is load-bearing: it goes into the prompt AND becomes the
                  `subject` column, and `curriculum_topics` is unique on it — so "Civic
                  Education" and "Civics" would be two subjects with two sets of topics,
                  and the lesson planner would find only one of them.
                */}
                <div className="flex flex-wrap items-end gap-2">
                  <Input
                    aria-label="Another subject"
                    placeholder="Another subject"
                    value={ownSubject}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setOwnSubject(e.target.value)}
                    maxLength={60}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={ownSubject.trim() === '' || subjects.includes(ownSubject.trim())}
                    onClick={() => {
                      setSubjects((prev) => [...new Set([...prev, ownSubject.trim()])])
                      setOwnSubject('')
                    }}
                  >
                    Add
                  </Button>
                </div>

                {subjects.filter((x) => !SUBJECTS.includes(x)).length > 0 && (
                  <span className="flex flex-wrap items-center gap-1.5 text-sm">
                    <span className="text-muted-text">Added:</span>
                    {subjects
                      .filter((x) => !SUBJECTS.includes(x))
                      .map((x) => (
                        <button
                          key={x}
                          type="button"
                          onClick={() => setSubjects((prev) => prev.filter((y) => y !== x))}
                          className="inline-flex min-h-tap items-center gap-1 rounded-md border border-border px-2 text-sm hover:bg-muted"
                        >
                          {x}
                          <X aria-hidden="true" className="size-3" />
                          <span className="sr-only">Remove {x}</span>
                        </button>
                      ))}
                  </span>
                )}
              </div>
            )}
          </Field>

          {/* ---- grades, as a range ---- */}
          <Field
            id="grades"
            label="Grades or forms"
            required
            hint="Pick a range — an ECZ syllabus usually names one, such as Grades 8 to 9. Add a second range if the document spans the reform."
          >
            {() => (
              <div className="flex flex-col gap-stack">
                <div className="flex flex-wrap items-end gap-2">
                  <Select
                    aria-label="From grade"
                    value={rangeFrom}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) => setRangeFrom(e.target.value)}
                  >
                    <option value="">From…</option>
                    {GRADES.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </Select>

                  <Select
                    aria-label="To grade"
                    value={rangeTo}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) => setRangeTo(e.target.value)}
                  >
                    <option value="">To…</option>
                    {GRADES.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </Select>

                  <Button
                    variant="outline"
                    size="sm"
                    disabled={rangeFrom === '' || rangeTo === ''}
                    onClick={() => {
                      applyRange(rangeFrom, rangeTo)
                      setRangeFrom('')
                      setRangeTo('')
                    }}
                  >
                    Add range
                  </Button>
                </div>

                {/* Chosen grades, each removable — a range that caught one grade too many
                    is corrected here rather than by clearing and starting again. */}
                {grades.length > 0 && (
                  <span className="flex flex-wrap items-center gap-1.5">
                    {/* Sorted the way GRADES lists them, so Grade 10 follows Grade 9
                        rather than Grade 1 — a plain string sort gets this wrong. */}
                    {[...grades]
                      .sort((a, b) => GRADES.indexOf(a) - GRADES.indexOf(b))
                      .map((x) => (
                        <button
                          key={x}
                          type="button"
                          onClick={() => setGrades((prev) => prev.filter((y) => y !== x))}
                          className="inline-flex min-h-tap items-center gap-1 rounded-md border border-border px-2 text-sm hover:bg-muted"
                        >
                          {x}
                          <X aria-hidden="true" className="size-3" />
                          <span className="sr-only">Remove {x}</span>
                        </button>
                      ))}
                  </span>
                )}
              </div>
            )}
          </Field>

          {combinations > 24 && (
            <Alert variant="warning" title="Too many combinations for one pass">
              {combinations} subject-and-grade combinations. A smaller extraction is more
              accurate and costs less — run the document again for the rest.
            </Alert>
          )}
        </div>
      </Dialog>
    </Card>
  )
}

