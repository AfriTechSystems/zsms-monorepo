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
import { useState } from 'react'
import { FileUp, Info, Trash2, TriangleAlert } from 'lucide-react'

import { Alert } from '../../../components/ui/alert'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card'
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
}

interface Extraction {
  topics: Topic[]
  detectedSource: string
  detectedSyllabusYear: number | null
  notes: string
  context: { curriculumType: string; subject: string; gradeLevel: string }
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
  const [subject, setSubject] = useState('')
  const [gradeLevel, setGradeLevel] = useState('')
  const [file, setFile] = useState<File | null>(null)

  const [extracting, setExtracting] = useState(false)
  const [extraction, setExtraction] = useState<Extraction | null>(null)
  const [topics, setTopics] = useState<Topic[]>([])
  const [source, setSource] = useState('')
  const [year, setYear] = useState('')
  const [importing, setImporting] = useState(false)

  const ready = subject.trim() !== '' && gradeLevel.trim() !== '' && file !== null

  const extract = async (): Promise<void> => {
    if (!file) return
    setExtracting(true)
    setExtraction(null)

    const form = new FormData()
    form.append('file', file)
    form.append('curriculumType', curriculumType)
    form.append('subject', subject)
    form.append('gradeLevel', gradeLevel)

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
          ? 'Nothing was found for that subject and grade.'
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
      subject: extraction.context.subject,
      grade_level: extraction.context.gradeLevel,
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
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="curriculum" label="Curriculum" required>
            {(props) => (
              <Select
                {...props}
                value={curriculumType}
                onChange={(e) => setCurriculumType(e.target.value)}
              >
                {CURRICULA.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field id="subject" label="Subject" required hint="Type your own if it is not listed.">
            {(props) => (
              <>
                <Input
                  {...props}
                  list="subject-options"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
                <datalist id="subject-options">
                  {SUBJECTS.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </>
            )}
          </Field>

          <Field id="grade" label="Grade or form" required>
            {(props) => (
              <Select {...props} value={gradeLevel} onChange={(e) => setGradeLevel(e.target.value)}>
                <option value="">Choose a grade</option>
                {GRADES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <Alert variant="info" title="One subject and grade at a time">
          A syllabus document usually covers several grades and sometimes several subjects. Naming
          the slice first is what stops the extraction merging them into a table nobody can
          untangle — and it is why these three come before the upload rather than after it.
        </Alert>

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
              <Badge variant="neutral">
                {extraction.context.subject} · {extraction.context.gradeLevel}
              </Badge>
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
    </Card>
  )
}
