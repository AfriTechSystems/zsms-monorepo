'use client'

/**
 * Print this page, and the heading that appears when it is printed.
 *
 * Schools here keep paper beside the system rather than instead of it: a register
 * signed on paper survives a power cut and is what an inspector asks for. The global
 * print rules in `globals.css` strip the application's chrome; these two pieces are
 * what a screen adds.
 *
 * `PrintHeading` is invisible on screen and appears on paper. A printed register with
 * no school name, class or date is not a record of anything — and the screen version
 * of that information is in a header the print rules have just removed.
 */

import type { JSX } from 'react'
import { Printer } from 'lucide-react'

import { Button } from './button'

export function PrintButton({ label = 'Print' }: { label?: string }): JSX.Element {
  return (
    <Button
      variant="outline"
      size="sm"
      // `print-hide` as well: the global rules already drop every button, and this
      // keeps the intent legible to the next reader rather than relying on that.
      className="print-hide"
      onClick={() => window.print()}
    >
      <Printer aria-hidden="true" className="size-4" />
      {label}
    </Button>
  )
}

export function PrintHeading({
  title,
  subtitle,
}: {
  title: string
  subtitle?: string
}): JSX.Element {
  return (
    <div className="print-only mb-4 border-b border-black pb-2">
      <p className="text-lg font-semibold">{title}</p>
      {subtitle ? <p className="text-sm">{subtitle}</p> : null}
      {/*
        The date the sheet was PRINTED, not the date it covers.

        Both matter and they are different facts: a register printed a week late is
        still a register for the day it covers, and somebody filing it needs to know
        which is which. The subtitle carries the day covered.
      */}
      <p className="text-xs">
        Printed {new Date().toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}
      </p>
    </div>
  )
}
