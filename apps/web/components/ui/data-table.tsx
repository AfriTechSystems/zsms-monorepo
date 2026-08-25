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
  className?: string
}

export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  empty,
  className,
}: DataTableProps<T>): JSX.Element {
  if (rows.length === 0 && empty) return <>{empty}</>

  const primary = columns.find((c) => c.primary) ?? columns[0]
  const rest = columns.filter((c) => c !== primary)

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
        {rows.map((row) => (
          <li key={rowKey(row)} className="p-card">
            {primary && (
              <div className="mb-2 text-base font-medium text-foreground">{primary.cell(row)}</div>
            )}
            <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1.5">
              {rest
                .filter((c) => !c.hideOnMobile)
                .map((c) => (
                  <div key={c.key} className="contents">
                    <dt className="text-sm text-muted-foreground">{c.header}</dt>
                    {/* `min-w-0` so a long value wraps inside its cell rather
                        than widening the grid and pushing the card off-screen —
                        the failure this whole component exists to remove. */}
                    <dd className="min-w-0 text-sm text-foreground">{c.cell(row)}</dd>
                  </div>
                ))}
            </dl>
          </li>
        ))}
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
              <tr key={rowKey(row)} className="border-b border-border last:border-0">
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
