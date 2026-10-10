/**
 * The faint school-objects backdrop.
 *
 * Spec: `Official Documentation/01 Foundation Layer/DESIGN_SYSTEM.md`
 *
 * Ten objects — cap, test tube, flask, ruler, pencil, pen, book, globe, calculator, microscope
 * — as a repeating texture behind the page.
 *
 * ## Why this is a component rather than three lines in `PublicShell`
 *
 * It lived inside `PublicShell`, so only the five pages using that shell had it. The auth
 * pages, `/welcome` and `/register` are the ones a visitor meets FIRST and they were plain —
 * exactly the screens where "the website looks boring" lands hardest. One component means one
 * opacity to tune and one asset path to change.
 *
 * ## The opacity is the design
 *
 * Cards are opaque, so the texture is only ever visible in the gutters and behind headings, and
 * at these values the eye resolves it as paper grain rather than pictures. Lighter in dark mode:
 * the same stroke against a dark ground reads far stronger than against white, so one value
 * would be invisible on one theme and distracting on the other.
 *
 * `fixed` rather than scrolling with the page, so it reads as a backdrop the content moves over
 * instead of wallpaper glued to the article. `aria-hidden` keeps ten object names out of the
 * accessibility tree — it is decoration.
 */

import type { JSX } from 'react'

export function SchoolTexture(): JSX.Element {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 bg-[url('/brand/school-pattern.svg')] bg-[length:440px_440px] bg-repeat opacity-[0.10] dark:opacity-[0.055]"
    />
  )
}
