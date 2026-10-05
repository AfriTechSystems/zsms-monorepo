'use client'

/**
 * One saved resource — read, annotate, print, remove.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md`
 *
 * ## The generated text is not editable, and the screen says why
 *
 * `content` is absent from the column-level UPDATE grant in `0130`. A teacher annotates
 * with notes beside the plan rather than rewriting it, because a row that claimed a
 * generator produced text somebody else had since rewritten would make the provenance a
 * lie — and provenance is the only thing that will distinguish today's scaffolds from
 * tomorrow's model output.
 *
 * ## Print rather than a PDF endpoint
 *
 * `packages/documents` renders PDFs for receipts and report cards through a worker. Wiring
 * a lesson plan into that pipeline is a job of its own, and a teacher who wants this on
 * paper wants it now — so the page carries print styles and the browser does the rest. The
 * documented Word export is not built and is not pretended at.
 */

import type { JSX, ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Download, Printer, Trash2, Users } from 'lucide-react'

import { Badge } from '../../../../components/ui/badge'
import { Button } from '../../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui/card'
import { Field, Textarea } from '../../../../components/ui/field'
import { ErrorState, PageHeader, TableSkeleton } from '../../../../components/ui/data-states'
import { useToast } from '../../../../components/ui/toast'
import { CURRICULUM_LABELS, KIND_LABELS, hubFetch, shortDate } from '../../hub-shared'

interface LessonPhase {
  phase: string
  minutes: number
  teacherActivity: string
  pupilActivity: string
}

interface QuizQuestion {
  number: number
  type: string
  prompt: string
  options?: string[]
  marks: number
  answer: string
  markingNotes?: string
}

interface ResourceDetail {
  id: string
  resource_kind: string
  title: string
  subject: string
  grade_level: string
  topic: string
  curriculum_type: string
  duration_minutes: number | null
  lesson_type: string | null
  teacher_notes: string | null
  is_shared: boolean
  generator_name: string
  generator_version: string
  created_at: string
  content: {
    summary?: string
    objectives?: string[]
    priorKnowledge?: string
    materials?: string[]
    outline?: LessonPhase[]
    assessment?: { formative: string; questions: string[] }
    homework?: string
    differentiation?: { support: string; extension: string }
    reflectionPrompts?: string[]
    questions?: QuizQuestion[]
    totalMarks?: number
    instructions?: string
    estimatedMinutes?: number
  }
}

export default function ResourcePage(): JSX.Element {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { toast } = useToast()

  const [resource, setResource] = useState<ResourceDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [notes, setNotes] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [format, setFormat] = useState('pdf')

  /**
   * A plain navigation rather than a fetch-and-blob.
   *
   * The endpoint sets `Content-Disposition: attachment`, so the browser downloads it and stays on
   * this page. Fetching it into memory to build an object URL would double the memory for a file
   * the browser can stream, and would lose the server's filename — which carries the subject,
   * grade and topic, and is the whole reason the download is recognisable in a crowded folder.
   */
  const download = (): void => {
    window.location.href = `/api/teacher/hub/resources/${params.id}/export?format=${format}`
  }

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: loadError } = await hubFetch<ResourceDetail>(
      `/api/teacher/hub/resources/${params.id}`,
    )
    if (loadError) {
      setError(loadError)
      setLoading(false)
      return
    }
    setError(null)
    setResource(data)
    setNotes(data?.teacher_notes ?? '')
    setLoading(false)
  }, [params.id])

  useEffect(() => {
    void load()
  }, [load])

  const saveNotes = async (): Promise<void> => {
    setSavingNotes(true)
    const { error: saveError } = await hubFetch(`/api/teacher/hub/resources/${params.id}`, {
      method: 'PATCH',
      // `null` rather than an empty string: a cleared note is the absence of a note.
      body: JSON.stringify({ teacherNotes: notes.trim() || null }),
    })
    setSavingNotes(false)
    toast(saveError ?? 'Notes saved.', saveError ? 'danger' : 'success')
  }

  /**
   * Publish to the Community Library, or withdraw.
   *
   * Through `/api/teacher/community` rather than the resource PATCH, because
   * `share_teaching_resource()` sets `is_shared` and `shared_at` in ONE statement — a
   * row shared with no share time sorts last in a list ordered by it, forever.
   *
   * The message says what other teachers will see. A teacher deciding whether to share
   * their work is entitled to know that before they do, not after.
   */
  const toggleShare = async (): Promise<void> => {
    if (!resource) return
    setSharing(true)
    const { data, error: shareError } = await hubFetch<{ message?: string }>(
      '/api/teacher/community',
      {
        method: 'PATCH',
        body: JSON.stringify({
          action: 'share',
          id: params.id,
          shared: !resource.is_shared,
        }),
      },
    )
    setSharing(false)
    if (shareError) {
      toast(shareError, 'danger')
      return
    }
    toast(data?.message ?? 'Updated.', 'success')
    void load()
  }

  /**
   * Removal is a flag, not a DELETE — there is no DELETE grant on this table. No modal
   * confirmation: `window.confirm` blocks the page, and the resource is recoverable by
   * support because the row is still there.
   */
  const remove = async (): Promise<void> => {
    setRemoving(true)
    const { error: removeError } = await hubFetch(`/api/teacher/hub/resources/${params.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isDeleted: true }),
    })
    setRemoving(false)
    if (removeError) {
      toast(removeError, 'danger')
      return
    }
    toast('Removed from your library.', 'success')
    router.push('/teacher/library')
  }

  if (loading) return <TableSkeleton rows={8} columns={2} />
  if (error) return <ErrorState message={error} onRetry={() => void load()} />
  if (!resource) return <ErrorState message="No such resource." onRetry={() => void load()} />

  const c = resource.content
  const isQuizLike = resource.resource_kind === 'quiz' || resource.resource_kind === 'homework'

  return (
    <>
      <PageHeader
        title={resource.title}
        description={[
          resource.subject,
          resource.grade_level,
          CURRICULUM_LABELS[resource.curriculum_type] ?? resource.curriculum_type,
          resource.duration_minutes ? `${resource.duration_minutes} min` : null,
          shortDate(resource.created_at),
        ]
          .filter(Boolean)
          .join(' · ')}
        backTo="/teacher/library"
        backLabel="My library"
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <Badge variant="neutral">{KIND_LABELS[resource.resource_kind] ?? resource.resource_kind}</Badge>
            {/*
              A plain select rather than a styled menu: it is three options on a screen a teacher
              visits to read, and the native control is keyboard- and screen-reader-correct on every
              device without any work.
            */}
            <select
              aria-label="Download format"
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text"
            >
              <option value="pdf">PDF</option>
              <option value="docx">Word (.docx)</option>
            </select>
            <Button variant="outline" size="sm" onClick={() => download()}>
              <Download className="size-4" aria-hidden />
              Download
            </Button>
            <Button variant="ghost" size="sm" onClick={() => window.print()}>
              <Printer className="size-4" aria-hidden />
              Print
            </Button>
          </div>
        }
      />

      <div className="space-y-cards">
        {c.summary && <p className="text-sm text-muted-text">{c.summary}</p>}

        {c.objectives && c.objectives.length > 0 && (
          <Section title="Learning objectives">
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {c.objectives.map((o, i) => (
                <li key={i}>{o}</li>
              ))}
            </ul>
          </Section>
        )}

        {c.priorKnowledge && (
          <Section title="Prior knowledge">
            <p className="text-sm">{c.priorKnowledge}</p>
          </Section>
        )}

        {c.materials && c.materials.length > 0 && (
          <Section title="Materials">
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {c.materials.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </Section>
        )}

        {c.outline && c.outline.length > 0 && (
          <Section
            title="Lesson outline"
            // The sum is shown because it is the claim the plan makes about itself, and a
            // head of department checks it first.
            aside={`${c.outline.reduce((sum, p) => sum + p.minutes, 0)} minutes total`}
          >
            <ol className="space-y-4">
              {c.outline.map((phase, i) => (
                <li key={i} className="border-l-2 border-primary pl-4">
                  <p className="text-sm font-semibold text-text">
                    {phase.phase} · {phase.minutes} min
                  </p>
                  <p className="mt-1 text-sm text-muted-text">
                    <span className="font-medium text-text">Teacher: </span>
                    {phase.teacherActivity}
                  </p>
                  <p className="mt-0.5 text-sm text-muted-text">
                    <span className="font-medium text-text">Pupils: </span>
                    {phase.pupilActivity}
                  </p>
                </li>
              ))}
            </ol>
          </Section>
        )}

        {c.instructions && (
          <Section title="Instructions">
            <p className="text-sm">{c.instructions}</p>
          </Section>
        )}

        {isQuizLike && c.questions && c.questions.length > 0 && (
          <Section
            title="Questions"
            aside={c.totalMarks ? `${c.totalMarks} marks` : undefined}
          >
            <ol className="space-y-5">
              {c.questions.map((q) => (
                <li key={q.number}>
                  <p className="text-sm font-medium text-text">
                    {q.number}. {q.prompt}
                  </p>
                  {q.options && (
                    <ul className="mt-1.5 space-y-1 pl-5 text-sm text-muted-text">
                      {q.options.map((o, i) => (
                        <li key={i}>{o}</li>
                      ))}
                    </ul>
                  )}
                  {/*
                    The answer key. Kept on the same page rather than behind a toggle,
                    because this is the teacher's own copy and the screen is never shown to
                    a class — but marked clearly so it is obvious what not to project.
                  */}
                  <p className="mt-1.5 rounded bg-neutral-tint px-2 py-1 text-xs text-neutral-text">
                    <span className="font-semibold">Answer ({q.marks} mark
                    {q.marks === 1 ? '' : 's'}): </span>
                    {q.answer}
                    {q.markingNotes ? ` — ${q.markingNotes}` : ''}
                  </p>
                </li>
              ))}
            </ol>
          </Section>
        )}

        {c.assessment && (
          <Section title="Assessment">
            <p className="text-sm">{c.assessment.formative}</p>
            {c.assessment.questions.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                {c.assessment.questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            )}
          </Section>
        )}

        {c.homework && (
          <Section title="Homework">
            <p className="text-sm">{c.homework}</p>
          </Section>
        )}

        {c.differentiation && (
          <Section title="Differentiation">
            <p className="text-sm">
              <span className="font-medium">Support: </span>
              {c.differentiation.support}
            </p>
            <p className="mt-1 text-sm">
              <span className="font-medium">Extension: </span>
              {c.differentiation.extension}
            </p>
          </Section>
        )}

        {c.reflectionPrompts && c.reflectionPrompts.length > 0 && (
          <Section title="After the lesson">
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {c.reflectionPrompts.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </Section>
        )}

        <Card className="print:hidden">
          <CardHeader>
            <CardTitle>Your notes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field
              id="teacher-notes"
              label="Notes"
              hint="What happened when you taught it, what to change next time. The plan itself cannot be edited — these notes sit beside it."
            >
              {(props) => (
                <Textarea
                  {...props}
                  rows={4}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              )}
            </Field>
            <Button onClick={() => void saveNotes()} disabled={savingNotes} size="sm">
              {savingNotes ? 'Saving…' : 'Save notes'}
            </Button>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between border-t border-border pt-5 print:hidden">
          <p className="text-xs text-muted-text">
            Built by {resource.generator_name} {resource.generator_version}.
          </p>
          {/*
            Sharing, beside removing, because both are decisions about where this
            resource lives rather than about its content.
          */}
          <Button
            variant={resource.is_shared ? 'outline' : 'default'}
            size="sm"
            onClick={() => void toggleShare()}
            disabled={sharing}
          >
            <Users className="size-4" aria-hidden />
            {sharing
              ? 'Saving…'
              : resource.is_shared
                ? 'Withdraw from Community Library'
                : 'Share to Community Library'}
          </Button>

          {resource.is_shared && (
            <p className="text-xs text-muted-text">
              {/* Said where the decision is made. Other teachers see a first name and
                  the subject — never a full name, a school or a contact detail. */}
              Other teachers can see this and copy it. They see your first name and the
              subject, nothing else.
            </p>
          )}

          <Button variant="ghost" size="sm" onClick={() => void remove()} disabled={removing}>
            <Trash2 className="size-4" aria-hidden />
            {removing ? 'Removing…' : 'Remove from library'}
          </Button>
        </div>
      </div>
    </>
  )
}

function Section({
  title,
  aside,
  children,
}: {
  title: string
  aside?: string
  // `ReactNode`, not `JSX.Element[]`: several sections pass a conditional child, whose type
  // includes `false`, and narrowing that away at every call site would be noise.
  children: ReactNode
}): JSX.Element {
  return (
    <Card>
      <CardHeader className="flex-row items-baseline justify-between">
        <CardTitle>{title}</CardTitle>
        {aside && <span className="text-xs text-muted-text">{aside}</span>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}
