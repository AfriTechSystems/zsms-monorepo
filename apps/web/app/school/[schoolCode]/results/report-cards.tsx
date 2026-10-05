'use client'

/**
 * Generating report cards, and seeing what came of it.
 *
 * Spec: `Official Documentation/11 Examinations and Results/PUBLISHING.md`
 *         → *Button 2 — "Publish + Generate Report Cards"*
 *       `Official Documentation/13 Document and PDF System/PDF_GENERATION.md`
 *
 * ## What this closes
 *
 * `generated_documents`, the `generate-report-card` worker and the PDF renderer in
 * `packages/documents` have all existed for some time, and **nothing reached any of them**.
 * A school could publish results and then had no way to produce the document those results
 * are for — which is the artefact a Zambian term actually ends with.
 *
 * ## Two buttons, not one
 *
 * `PUBLISHING.md` is explicit that publishing and generating are separate actions in either
 * order: a principal may want to read a draft card before parents see the marks. So this
 * panel never refuses an unpublished term — it says how many marks are still unpublished
 * and lets the principal decide, which is the honest version of the same caution.
 *
 * ## Progress is polled, not streamed
 *
 * A batch is a queued job; the screen asks again rather than holding a socket open. A
 * school generating 400 cards is doing it once a term, and a dropped connection on a
 * Zambian link must not make a finished batch look unfinished.
 */

import type { JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { FileText, Loader2, RefreshCw } from 'lucide-react'

import { Alert } from '../../../../components/ui/alert'
import { Badge } from '../../../../components/ui/badge'
import { Button } from '../../../../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../../components/ui/card'
import { apiSend, useApi } from '../../../../lib/use-api'
import { DocumentDownload } from '../../../../components/ui/document-download'
import { useToast } from '../../../../components/ui/toast'

interface Summary {
  total: number
  ready: number
  failed: number
  pending: number
}

export function ReportCards({
  academicYear,
  termNumber,
  classId,
  canGenerate,
}: {
  academicYear: string
  termNumber: string
  /** The class currently chosen on the mark sheet, or '' for the whole term. */
  classId: string
  canGenerate: boolean
}): JSX.Element {
  const { toast } = useToast()
  const [starting, setStarting] = useState(false)

  /*
    The cards for this term, refetched alongside the summary.

    Scoped by year and term so a school looking at term 2 is not handed term 1's cards —
    the worker records both on every row for exactly this.
  */
  const { data: docs } = useApi<{
    documents: Array<{
      id: string
      status: string
      failureReason: string | null
      studentName: string | null
    }>
  }>(
    `/api/documents?docType=report_card&academicYear=${encodeURIComponent(academicYear)}&termNumber=${termNumber}&limit=100`,
  )

  const { data, reload } = useApi<{ summary: Summary }>(
    `/api/school/report-cards?year=${encodeURIComponent(academicYear)}&term=${termNumber}`,
  )

  const summary = data?.summary
  const pending = summary?.pending ?? 0

  /*
    Poll only while something is actually in flight, and stop as soon as it is not.
    A timer left running on a finished batch is a request every few seconds, forever,
    from every open tab in the school office.
  */
  useEffect(() => {
    if (pending === 0) return undefined
    const timer = setInterval(() => reload(), 4000)
    return () => clearInterval(timer)
  }, [pending, reload])

  const generate = useCallback(
    async (scope: 'class' | 'term') => {
      setStarting(true)
      try {
        const result = await apiSend<{
          queued: boolean
          pupils: number
          unpublishedMarks: number
        }>('/api/school/report-cards', 'POST', {
          academicYear,
          termNumber: Number(termNumber),
          classId: scope === 'class' && classId ? classId : undefined,
        })

        if (result.error) {
          toast(result.error, 'danger')
          return
        }

        const pupils = result.data?.pupils ?? 0
        const unpublished = result.data?.unpublishedMarks ?? 0
        toast(
          unpublished > 0
            ? `Started for ${pupils} pupils. ${unpublished} marks are not published yet — those cards will show them anyway.`
            : `Started for ${pupils} pupils.`,
          'success',
        )
        reload()
      } finally {
        setStarting(false)
      }
    },
    [academicYear, termNumber, classId, toast, reload],
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText aria-hidden="true" className="size-5 text-primary" />
          Report cards
        </CardTitle>
        <CardDescription>
          One PDF per pupil for term {termNumber}, {academicYear}. Generating does not publish
          results, and publishing does not generate cards — they are separate on purpose.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-cards">
        {summary && summary.total > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="success">
              <span data-numeric>{summary.ready}</span> ready
            </Badge>
            {summary.pending > 0 && (
              <Badge variant="info">
                <Loader2 aria-hidden="true" className="mr-1 inline size-3 animate-spin" />
                <span data-numeric>{summary.pending}</span> generating
              </Badge>
            )}
            {summary.failed > 0 && (
              <Badge variant="danger">
                <span data-numeric>{summary.failed}</span> failed
              </Badge>
            )}
            <Button variant="ghost" size="sm" onClick={() => reload()}>
              <RefreshCw aria-hidden="true" className="size-4" />
              Refresh
            </Button>
          </div>
        )}

        {/*
          The cards themselves.

          The counts alone told a school that 400 cards were ready and gave them no way
          to open one — the renderer, the worker and the storage all worked and the
          result was unreachable. Listed per pupil, because "download all" is a zip
          nothing in this stack builds yet and one card at a time is what a parent at
          the counter actually asks for.
        */}
        {(docs?.documents.length ?? 0) > 0 && (
          <ul className="divide-y divide-border rounded-md border border-border">
            {(docs?.documents ?? []).map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 p-stack">
                <span className="font-medium">
                  {/* The id is a poor label, but a missing name is worse than an ugly
                      one: without it there is no way to tell which card failed. */}
                  {d.studentName ?? 'Unnamed pupil'}
                </span>
                <span className="ml-auto">
                  <DocumentDownload
                    documentId={d.id}
                    label="Open"
                    knownFailure={
                      d.status === 'failed'
                        ? (d.failureReason ?? 'Could not be produced')
                        : null
                    }
                  />
                </span>
              </li>
            ))}
          </ul>
        )}

        {summary && summary.failed > 0 && (
          <Alert variant="warning" title="Some cards did not render">
            {/* Per-pupil failure isolation is the worker's design: one missing mark or a
                corrupt logo fails that card and the batch continues. Re-running is safe —
                a card that already succeeded is not re-rendered. */}
            Those pupils are usually missing a mark or a grading scale. Fixing the cause and
            generating again only re-renders what failed.
          </Alert>
        )}

        {canGenerate ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={starting} onClick={() => void generate('term')}>
              {starting && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
              Generate for the whole term
            </Button>
            {/* A single class, for the common case of one mark sheet arriving late after
                the rest of the term was already generated. */}
            {classId && (
              <Button variant="outline" disabled={starting} onClick={() => void generate('class')}>
                Just {classId}
              </Button>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Only the owner or principal can generate report cards — the document carries the
            school&rsquo;s name and crest.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
