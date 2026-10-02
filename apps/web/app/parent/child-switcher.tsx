'use client'

/**
 * Which child, and at which school — on every parent screen.
 *
 * Spec: `Official Documentation/07 Student and Parent Modules/PARENT_LINKING.md`
 *       `Official Documentation/02 Authentication and Identity/AUTH.md`
 *
 * ## What this replaces
 *
 * Three separate problems, reported from the running application on 2026-10-02:
 *
 *   * **`/parent/schools` was unreachable.** The screen exists and is good; nothing
 *     anywhere linked to it, so a parent who navigated away could not get back.
 *   * **The child picker was on three screens out of five.** Home, attendance and results
 *     had it; fees and notices did not. A parent reading one child's fees had to go back to
 *     the dashboard to change child, and nothing said so.
 *   * **Two children at one school had no switcher at all in several places**, which is the
 *     commonest case of all — siblings at the same school, with different classes,
 *     different marks and different bills.
 *
 * One control in the shell fixes all three, and fixes them for every screen added later.
 * The per-page pickers are removed rather than left alongside: two controls doing the same
 * thing is how one of them stops being updated.
 *
 * ## Grouped by school only when it earns it
 *
 * A parent with three children at one school does not need its name repeated three times.
 * A parent with children at two schools very much needs to know which Ben they are looking
 * at. The grouping appears only in the second case — and only then does the "All schools"
 * link appear, because a parent with one school has nothing to choose between.
 *
 * ## The selection lives in the URL
 *
 * `childId` is a query parameter, which is what makes a link to a particular child
 * shareable, survivable across a reload, and correct in the back button. The shell already
 * carries it between tabs; this writes it.
 */

import type { JSX } from 'react'
import { useCallback, useMemo } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Building2, Users } from 'lucide-react'

import { useApi } from '../../lib/use-api'

interface ChildRow {
  id: string
  first_name: string
  last_name: string
  school_id: string
  school_name: string | null
}

export function ChildSwitcher(): JSX.Element | null {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  // The light endpoint — names and schools only. The full overview is per-screen and far
  // too much to fetch again in a shell that renders on every page.
  const { data } = useApi<{ children: ChildRow[] }>('/api/parent/schools')

  const children = useMemo(() => data?.children ?? [], [data])

  const schools = useMemo(
    () => [...new Set(children.map((c) => c.school_name).filter(Boolean))] as string[],
    [children],
  )

  const selectedId = params.get('childId') ?? children[0]?.id ?? ''
  const selected = children.find((c) => c.id === selectedId) ?? children[0]

  const switchTo = useCallback(
    (id: string) => {
      const next = new URLSearchParams(params.toString())
      next.set('childId', id)
      // `replace`, not `push`: switching child is changing what you are looking at, not
      // navigating somewhere new, and a back button that walks through every child a
      // parent glanced at is noise.
      router.replace(`${pathname}?${next.toString()}`, { scroll: false })
    },
    [params, pathname, router],
  )

  // One child and one school: there is nothing to switch between, and a disabled control
  // saying so is worse than no control.
  if (children.length <= 1) return null

  const spansSchools = schools.length > 1

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="child-switcher" className="sr-only">
        Choose a child
      </label>

      <div className="relative flex items-center">
        <Users
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground"
        />
        <select
          id="child-switcher"
          value={selected?.id ?? ''}
          onChange={(e) => switchTo(e.target.value)}
          className="min-h-tap w-full min-w-[11rem] rounded-lg border border-border bg-background py-1 pl-8 pr-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {spansSchools
            ? schools.map((school) => (
                <optgroup key={school} label={school}>
                  {children
                    .filter((c) => c.school_name === school)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.first_name} {c.last_name}
                      </option>
                    ))}
                </optgroup>
              ))
            : children.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.first_name} {c.last_name}
                </option>
              ))}
        </select>
      </div>

      {/* The school, named. A parent reading results needs to know whose school's results
          these are — and when there is only one school it is still the confirmation that
          ZSMS has anything to do with their child. */}
      {selected?.school_name && !spansSchools && (
        <span className="hidden text-sm text-muted-foreground sm:inline">
          {selected.school_name}
        </span>
      )}

      {/* Only when there is more than one school to choose between. The screen has existed
          all along with nothing linking to it. */}
      {spansSchools && (
        <Link
          href="/parent/schools"
          className="inline-flex min-h-tap items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-primary-text transition-colors hover:bg-muted"
        >
          <Building2 aria-hidden="true" className="size-4" />
          <span className="hidden sm:inline">All schools</span>
        </Link>
      )}
    </div>
  )
}
