'use client'

/**
 * A list that is a table on a desktop and a stack of cards on a phone.
 *
 * Spec: `Official Documentation/01 Foundation Layer/DESIGN_SYSTEM.md` → Data Tables
 *
 * ## Why a horizontally scrolling table is not a mobile table
 *
 * Every list in ZSMS began as `<div class="overflow-x-auto"><table>…`. That
 * keeps the page from breaking, which is why it is the usual advice, and it is
 * not the same thing as being usable. On a 390px screen a five-column table
 * shows two columns; the rest exist but must be discovered by dragging, the
 * header scrolls away from the cell it labels, and a row that wraps to three
 * lines makes the whole grid ragged. An accountant checking a balance at the
 * school gate is doing it one-handed, and "scroll right to see the amount" is
 * the moment they stop using the product on their phone.
 *
 * So below `sm` each row becomes a card: the primary column is its heading, and
 * every other column is a label/value pair underneath. Nothing is hidden, no
 * axis scrolls, and the label travels with its value instead of living in a
 * header row that is somewhere off-screen.
 *
 * At `sm` and above it is a real `<table>` — proper `<th scope>`, a `<caption>`,
 * one row per record. Screen readers and keyboards get the semantics they
 * expect, and a registrar with 400 pupils on a laptop gets a table, which is
 * genuinely the right instrument there.
 *
 * ## The two halves render the same cells
 *
 * `cell(row)` is called by both branches. This is deliberate and load-bearing:
 * the alternative — a table markup block and a separate card markup block — is
 * two places to change a currency format, and they diverge within a month. The
 * cost is that a column definition cannot assume table context; that is a fair
 * price and the reason `cell` returns content rather than a `<td>`.
 */

import type { JSX, ReactNode } from 'react'
import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight } from 'lucide-react'

import { cn } from '../../lib/utils'

export interface Column<T> {
  /** Stable identity for React keys. */
  key: string
  /** Column heading, and the label beside the value on a phone. */
  header: string
  cell: (row: T) => ReactNode
  /**
   * The identifying column — a name, a code. Exactly one should be primary.
   * It becomes the `<th scope="row">` in the table and the card's heading on a
   * phone, where it is the thing someone scans for.
   */
  primary?: boolean
  /** Right-aligned in the table. Money and counts; never text. */
  numeric?: boolean
  /**
   * Dropped from the card layout on a phone.
   *
   * Use sparingly and only for genuinely secondary detail. A column worth
   * showing on a laptop is usually worth showing on a phone — the card layout
   * has room, because it stacks. This exists for the third date on a row, not
   * for anything a decision depends on.
   */
  hideOnMobile?: boolean
}

export interface DataTableProps<T> {
  /** Announced to screen readers, and never shown. The heading above says it. */
  caption: string
  columns: Array<Column<T>>
  rows: T[]
  rowKey: (row: T) => string
  /** Rendered instead of the list when `rows` is empty. */
  empty?: ReactNode
  /**
   * Where a row leads, if anywhere.
   *
   * Supplying this makes the whole mobile card heading a link and gives the
   * table row a hover state, so "this is openable" is visible rather than
   * discovered by tapping a name and hoping. Without it the row is inert and
   * looks it, which is the honest rendering for a list nothing hangs off.
   */
  href?: (row: T) => string
  /**
   * Collapse secondary columns behind a disclosure on a phone. On by default.
   *
   * A card showing eight label/value pairs is the stacked equivalent of a table
   * too wide to read: correct, complete, and impossible to scan. Collapsed, the
   * list shows the identifying column and a chevron, and a tap reveals the rest
   * — so ten pupils fit on a screen instead of two.
   *
   * Turn it off for a short list whose secondary values are the point.
   */
  collapsible?: boolean
  className?: string
}

export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  empty,
  href,
  collapsible = true,
  className,
}: DataTableProps<T>): JSX.Element {
  // Which mobile cards are open. Held for the whole list rather than per row so
  // the state survives a re-render — a reload that collapsed everything the
  // reader had just opened would be worse than not collapsing at all.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const primary = columns.find((c) => c.primary) ?? columns[0]
  const rest = columns.filter((c) => c !== primary)

  // After the hooks, never before. An early return above `useState` changes the
  // hook order between an empty and a populated list, which React treats as a
  // different component.
  if (rows.length === 0 && empty) return <>{empty}</>

  return (
    <div className={className}>
      {/* ---------------------------------------------------------------
          Phone: one card per row.
          `sm:hidden` rather than a JS width check — a media query is resolved
          before paint, so there is no flash of the wrong layout and no
          hydration mismatch between server and client.
      --------------------------------------------------------------- */}
      <ul className="divide-y divide-border sm:hidden">
        <li className="sr-only">{caption}</li>
        {rows.map((row) => {
          const key = rowKey(row)
          const target = href?.(row)
          const isOpen = expanded.has(key)
          const details = rest.filter((c) => !c.hideOnMobile)
          const showDetails = !collapsible || isOpen

          return (
            <li key={key}>
              <div className="flex items-start gap-2 p-card">
                <div className="min-w-0 flex-1">
                  {primary && (
                    <div className="text-base font-medium text-foreground">
                      {/* The whole heading is the link when there is one, so the
                          tap target is the width of the card rather than the
                          width of a name. */}
                      {target ? (
                        <Link
                          href={target}
                          className="block rounded hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {primary.cell(row)}
                        </Link>
                      ) : (
                        primary.cell(row)
                      )}
                    </div>
                  )}

                  {showDetails && details.length > 0 && (
                    <dl className="mt-2 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1.5">
                      {details.map((c) => (
                        <div key={c.key} className="contents">
                          <dt className="text-sm text-muted-foreground">{c.header}</dt>
                          {/* `min-w-0` so a long value wraps inside its cell
                              rather than widening the grid and pushing the card
                              off-screen — the failure this component removes. */}
                          <dd className="min-w-0 text-sm text-foreground">{c.cell(row)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>

                {collapsible && details.length > 0 && (
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() =>
                      setExpanded((prev) => {
                        const next = new Set(prev)
                        if (next.has(key)) next.delete(key)
                        else next.add(key)
                        return next
                      })
                    }
                    className={cn(
                      '-my-1 inline-flex size-tap shrink-0 items-center justify-center rounded-md',
                      'text-muted-foreground transition-colors hover:bg-sunken hover:text-foreground',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    )}
                  >
                    {isOpen ? (
                      <ChevronDown aria-hidden="true" className="size-5" />
                    ) : (
                      <ChevronRight aria-hidden="true" className="size-5" />
                    )}
                    <span className="sr-only">
                      {isOpen ? 'Hide details' : 'Show details'}
                    </span>
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {/* ---------------------------------------------------------------
          Tablet and up: a real table.
          `overflow-x-auto` is kept as a floor for a genuinely wide table on a
          narrow laptop. It is a backstop, not the mobile strategy.
      --------------------------------------------------------------- */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="border-b border-border bg-sunken text-left">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn('px-4 py-2.5 font-medium', c.numeric && 'text-right')}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                className={cn(
                  'border-b border-border last:border-0',
                  // A row that leads somewhere says so on hover. Without it the
                  // only clue is the link inside the first cell.
                  href && 'transition-colors hover:bg-sunken',
                )}
              >
                {columns.map((c) =>
                  c === primary ? (
                    <th key={c.key} scope="row" className="px-4 py-3 text-left font-normal">
                      {c.cell(row)}
                    </th>
                  ) : (
                    <td
                      key={c.key}
                      {...(c.numeric ? { 'data-numeric': true } : {})}
                      className={cn('px-4 py-3', c.numeric && 'text-right')}
                    >
                      {c.cell(row)}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
