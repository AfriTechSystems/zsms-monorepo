/**
 * Route-level loading boundary for the school portal.
 *
 * Skeletons, not the branded splash. The splash is for a cold start where
 * nothing is on screen yet; a navigation between two portal screens keeps the
 * header and nav in place, and replacing them with a full-screen logo would make
 * moving between two lists feel like signing in again.
 */

import type { JSX } from 'react'

import { StatSkeleton, TableSkeleton } from '../../../components/ui/data-states'

export default function SchoolLoading(): JSX.Element {
  return (
    <div className="space-y-cards">
      <StatSkeleton count={4} />
      <TableSkeleton rows={6} columns={4} />
    </div>
  )
}
