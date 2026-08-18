/**
 * Route-level loading boundary for every `/admin` screen.
 *
 * Deliberately skeletons rather than the branded splash. The splash belongs to
 * initial app load and to genuinely heavy dashboards; showing it on a
 * tab-to-tab move inside a section the operator is already in replaces a 200ms
 * transition with a full-screen interruption, which reads as slower even when
 * it is not.
 *
 * Shaped like the page beneath it — a header block, a row of figures, a table —
 * so the layout does not jump when real content arrives.
 */

import type { JSX } from 'react'

import { StatSkeleton, TableSkeleton } from '../../components/ui/data-states'
import { Skeleton } from '../../components/ui/skeleton'

export default function AdminLoading(): JSX.Element {
  return (
    <div className="space-y-cards" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-9 w-52" />
        <Skeleton className="h-5 w-full max-w-xl" />
      </div>
      <StatSkeleton count={3} />
      <TableSkeleton rows={6} columns={4} />
    </div>
  )
}
