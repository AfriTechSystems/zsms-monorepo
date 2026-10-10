'use client'

/**
 * Pieces every parent screen needs.
 *
 * ## Why a shared child picker
 *
 * Four screens all answer "for which child". Written four times they would drift
 * — one would forget to carry `childId` into the URL, and a parent would lose
 * their selection by tapping a tab. That is the single most irritating failure a
 * multi-child portal has, so the behaviour lives in one place.
 */

import type { JSX } from 'react'
import { useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { Field, Select } from '../../components/ui/field'

export interface ChildOption {
  id: string
  firstName: string
  lastName: string
  /** Present when the parent has children at more than one school. */
  schoolName?: string | null
}

export const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : 0
  return Number.isFinite(n) ? n : 0
}

export const kwacha = (v: string | number | null | undefined): string =>
  `K${num(v).toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * Dates for a parent, not for a developer.
 *
 * `en-ZM` with a spelled month: `27 Sep 2026`. Numeric-only would be ambiguous
 * between day-first and month-first readers, which for a term date matters.
 */
export const shortDate = (iso: string | null | undefined): string =>
  iso
    ? new Date(iso).toLocaleDateString('en-ZM', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '—'

/**
 * The child selector, rendered only when there is a choice.
 *
 * A select with one option is a control that does nothing, which makes a parent
 * wonder which child they are missing.
 */
export function ChildPicker({
  children,
  selectedId,
}: {
  children: ChildOption[]
  selectedId: string
}): JSX.Element | null {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const switchChild = useCallback(
    (id: string) => {
      const s = new URLSearchParams(params.toString())
      s.set('childId', id)
      router.replace(`${pathname}?${s.toString()}`, { scroll: false })
    },
    [params, pathname, router],
  )

  if (children.length <= 1) return null

  // Grouped by school only when the family actually spans schools. A parent with
  // three children at one school does not need a heading repeating its name three
  // times — and a parent with children at two schools very much needs to know
  // which Ben they are looking at.
  const schools = [...new Set(children.map((c) => c.schoolName).filter(Boolean))] as string[]
  const spansSchools = schools.length > 1

  return (
    <div className="w-full sm:w-64">
      <Field id="child" label="Child">
        {(props) =>
          spansSchools ? (
            <Select {...props} value={selectedId} onChange={(e) => switchChild(e.target.value)}>
              {schools.map((school) => (
                <optgroup key={school} label={school}>
                  {children
                    .filter((c) => c.schoolName === school)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.firstName} {c.lastName}
                      </option>
                    ))}
                </optgroup>
              ))}
            </Select>
          ) : (
            <Select {...props} value={selectedId} onChange={(e) => switchChild(e.target.value)}>
              {children.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.firstName} {c.lastName}
                </option>
              ))}
            </Select>
          )
        }
      </Field>
    </div>
  )
}

export function ParentPageHeader({
  title,
  childName,
  schoolName,
  note,
  children: picker,
}: {
  title: string
  childName?: string
  /**
   * The school this child attends.
   *
   * Reported from the running application: a parent reached the portal and saw no
   * indication which school they were looking at. For a parent with children at two
   * schools that is the first thing they need; for one with children at a single school it
   * is still the confirmation that ZSMS is anything to do with their child.
   */
  schoolName?: string | null
  note?: string
  children?: JSX.Element | null
}): JSX.Element {
  return (
    <div className="space-y-stack">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
          {(childName || schoolName) && (
            <p className="text-sm text-muted-foreground">
              {childName}
              {childName && schoolName && ' · '}
              {schoolName && <span className="font-medium text-foreground">{schoolName}</span>}
            </p>
          )}
        </div>
        {picker}
      </div>
      {note && (
        <p className="max-w-prose rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          {note}
        </p>
      )}
    </div>
  )
}
