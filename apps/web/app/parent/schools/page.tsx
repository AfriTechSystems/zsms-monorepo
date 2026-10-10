'use client'

/**
 * Which school — the first thing a parent sees after signing in.
 *
 * Spec: `Official Documentation/02 Authentication and Identity/AUTH.md`
 *       `Official Documentation/07 Students and Parents/PARENTS.md`
 *
 * ## This is a screen, not an auth problem
 *
 * `parent/layout.tsx` records a limitation: "a parent with children at two ZSMS schools is
 * in two Clerk organisations, and a session acts in one at a time. Today they see the
 * children of whichever org is active."
 *
 * **The premise is false and the limitation does not exist.** `is_linked_parent_of()` reads
 * `parent_user_id = get_user_id()` and nothing else — no organisation anywhere — which is
 * why `/api/parent/overview` already notes that "parent policies already span schools, so
 * the data is there". A parent can read every child at every school simultaneously.
 *
 * So choosing a school is a filter over rows already readable, not an organisation switch.
 * Nothing here calls Clerk.
 *
 * ## It is shown even for one school, deliberately
 *
 * Asked for on 2026-10-01. A parent with one child still lands here and taps their school's
 * name. The extra tap buys two things: the school's name and crest confirm they are in the
 * right place — which matters most to somebody who has just signed up and is not sure ZSMS
 * is anything to do with their child — and the mental model stays the same on the day a
 * second child is enrolled somewhere else.
 */

import type { JSX } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, School } from 'lucide-react'

import { Card, CardContent } from '../../../components/ui/card'
import { ErrorState, PageHeader, StatSkeleton } from '../../../components/ui/data-states'
import { useApi } from '../../../lib/use-api'

interface ChildRow {
  id: string
  first_name: string
  last_name: string
  school_id: string
  school_name: string | null
}

interface SchoolsPayload {
  children: ChildRow[]
}

export default function ParentSchoolsPage(): JSX.Element {
  const router = useRouter()
  const { data, loading, error, code, reload } = useApi<SchoolsPayload>('/api/parent/schools')

  if (error) return <ErrorState message={error} code={code} onRetry={reload} />
  if (loading || !data) return <StatSkeleton count={2} />

  // Group the children the parent can already read, by school.
  const bySchool = new Map<string, { name: string; children: ChildRow[] }>()
  for (const child of data.children) {
    const entry = bySchool.get(child.school_id)
    if (entry) entry.children.push(child)
    else
      bySchool.set(child.school_id, {
        name: child.school_name ?? 'Your school',
        children: [child],
      })
  }

  const schools = [...bySchool.entries()]

  return (
    <>
      <PageHeader
        title="Your children"
        description={
          schools.length > 1
            ? 'You have children at more than one school. Choose one to see their attendance, marks and fees.'
            : 'Tap your school to see attendance, marks and fees.'
        }
      />

      <div className="flex flex-col gap-3">
        {schools.map(([schoolId, entry]) => (
          <button
            key={schoolId}
            type="button"
            onClick={() => {
              /*
                Navigate to the first child at that school rather than storing a
                "current school" anywhere. The portal already switches on a `child`
                query param through `ChildPicker`, so a second piece of state meaning
                almost the same thing would be two things to keep in step.
              */
              router.push(`/parent?child=${entry.children[0]?.id ?? ''}`)
            }}
            className="w-full text-left"
          >
            <Card className="transition-colors hover:border-primary">
              <CardContent className="flex items-center gap-3 pt-card">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <School aria-hidden="true" className="size-6 text-primary" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{entry.name}</span>
                  <span className="block truncate text-sm text-muted-text">
                    {entry.children
                      .map((c) => `${c.first_name} ${c.last_name}`)
                      .join(', ')}
                  </span>
                </span>
                <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted-text" />
              </CardContent>
            </Card>
          </button>
        ))}
      </div>
    </>
  )
}
