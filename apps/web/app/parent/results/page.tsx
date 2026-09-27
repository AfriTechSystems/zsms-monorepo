'use client'

/**
 * Parent results — marks the school has published.
 *
 * Spec: `Official Documentation/11 Examinations and Results/`
 *       `Official Documentation/01 Foundation Layer/DECISIONS.md` — ADR-041
 *
 * ## Only published marks exist here
 *
 * `parent_read_published_results` means an unpublished mark is invisible to the
 * database, not hidden by this screen. A teacher part-way through marking a paper
 * cannot accidentally show a parent a provisional grade, because there is nothing
 * to show.
 *
 * ## Grade, mark, and the scale that explains them
 *
 * A letter with no context is the thing parents dispute. So the mark and the
 * total are always shown beside the letter, and where the grading scale that
 * produced it is recorded (ADR-041) the boundaries can be stated. A grade that
 * predates scale versioning says so rather than implying a scale nobody kept.
 *
 * ## Position is shown only when it is real
 *
 * `class_position` out of `class_size` is meaningful; a position with no class
 * size is not, and rendering "4" alone invites a parent to assume out of what.
 */

import type { JSX } from 'react'
import { Suspense, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { ClipboardList } from 'lucide-react'

import { useApi } from '../../../lib/use-api'
import { Badge } from '../../../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { DataTable } from '../../../components/ui/data-table'
import { EmptyState } from '../../../components/ui/empty-state'
import { ErrorState, TableSkeleton } from '../../../components/ui/data-states'
import { ChildPicker, ParentPageHeader, shortDate, type ChildOption } from '../parent-shared'

interface Result {
  id: string
  subject_name: string
  academic_year: string
  term_number: number
  marks_obtained: string | number | null
  marks_total: string | number
  grade_letter: string | null
  class_position: number | null
  class_size: number | null
  comments: string | null
  published_at: string | null
  has_scale: boolean
}

interface Payload {
  children: ChildOption[]
  selected: { id: string; firstName: string; lastName: string } | null
  results: Result[]
}

function ParentResults(): JSX.Element {
  const params = useSearchParams()
  const childId = params.get('childId')

  const url = childId ? `/api/parent/results?childId=${childId}` : '/api/parent/results'
  const { data, loading, error, code, reload } = useApi<Payload>(url)

  // Grouped by term so a parent reads one report at a time rather than a flat
  // list spanning three terms in no obvious order.
  const byTerm = useMemo(() => {
    const groups = new Map<string, Result[]>()
    for (const r of data?.results ?? []) {
      const key = `${r.academic_year} · Term ${r.term_number}`
      groups.set(key, [...(groups.get(key) ?? []), r])
    }
    return [...groups.entries()]
  }, [data?.results])

  if (error) return <ErrorState message={error} code={code} onRetry={reload} />
  if (loading && !data) return <TableSkeleton rows={6} columns={4} />
  if (!data?.selected) {
    return (
      <Card>
        <CardContent className="p-0">
          <EmptyState
            icon={ClipboardList}
            title="No children linked to this account"
            description="Contact the school office to have your account linked to your child."
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-cards">
      <ParentPageHeader
        title="Results"
        childName={`${data.selected.firstName} ${data.selected.lastName}`}
        note="Only results the school has published appear here. A subject that is missing has not been published yet — it does not mean your child was not marked."
      >
        <ChildPicker children={data.children} selectedId={data.selected.id} />
      </ParentPageHeader>

      {byTerm.length === 0 && (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={ClipboardList}
              title="No results published yet"
              description="When the school publishes end-of-term results, they appear here."
            />
          </CardContent>
        </Card>
      )}

      {byTerm.map(([term, results]) => (
        <Card key={term}>
          <CardHeader>
            <CardTitle>{term}</CardTitle>
            {results[0]?.published_at && (
              <p className="text-sm text-muted-foreground">
                Published {shortDate(results[0].published_at)}
              </p>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <DataTable
              caption={`Results for ${term}`}
              rows={results}
              rowKey={(r) => r.id}
              columns={[
                {
                  key: 'subject',
                  header: 'Subject',
                  primary: true,
                  cell: (r) => (
                    <>
                      <span className="font-medium text-foreground">{r.subject_name}</span>
                      {r.comments && (
                        <span className="block text-xs text-muted-foreground">{r.comments}</span>
                      )}
                    </>
                  ),
                },
                {
                  key: 'mark',
                  header: 'Mark',
                  numeric: true,
                  // Always with the total. A bare 62 means nothing without it.
                  cell: (r) => `${r.marks_obtained ?? '—'} / ${r.marks_total}`,
                },
                {
                  key: 'grade',
                  header: 'Grade',
                  cell: (r) =>
                    r.grade_letter ? (
                      <Badge variant={r.has_scale ? 'neutral' : 'warning'}>{r.grade_letter}</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    ),
                },
                {
                  key: 'pos',
                  header: 'Position',
                  // Only when both halves are present — see the header.
                  cell: (r) =>
                    r.class_position && r.class_size
                      ? `${r.class_position} of ${r.class_size}`
                      : '—',
                },
              ]}
            />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export default function ParentResultsPage(): JSX.Element {
  return (
    <Suspense fallback={<TableSkeleton rows={6} columns={4} />}>
      <ParentResults />
    </Suspense>
  )
}
