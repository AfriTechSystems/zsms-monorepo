/**
 * The frame every public page sits in.
 *
 * Spec: `Official Documentation/01 Foundation Layer/DESIGN_SYSTEM.md`
 *
 * Header, footer and the route progress bar in one place, so the five public pages share one set of
 * chrome rather than five copies that drift — which is exactly what happened to the auth pages before
 * `AuthShell` pulled them together.
 *
 * A server component wrapping two client islands. The nav and the progress bar need state; the layout,
 * the footer and the page content do not, and keeping the boundary here means a public page stays
 * server-rendered — which for `/schools/[code]` is the whole point, since its content has to be in the
 * HTML for a crawler.
 */

import type { JSX, ReactNode } from 'react'
import { Suspense } from 'react'
import Link from 'next/link'

import { PublicHeader } from './public-header'
import { RouteProgress } from './route-progress'

export function PublicShell({
  children,
  width = 'wide',
}: {
  children: ReactNode
  /** `narrow` for reading (a profile, a policy), `wide` for scanning (the directory). */
  width?: 'narrow' | 'wide'
}): JSX.Element {
  return (
    <div className="relative flex min-h-dvh flex-col bg-background">
      {/*
        School objects — cap, test tube, flask, ruler, pencil, pen, book, globe, calculator,
        microscope — as a faint repeating texture.

        `fixed` rather than scrolling with the page, so it reads as a backdrop the content moves over
        instead of wallpaper glued to the article. `-z-10` puts it behind everything, and `aria-hidden`
        keeps it out of the accessibility tree — it is decoration and announcing ten object names to a
        screen reader would be noise.

        The opacity is the whole design. Cards are opaque, so the texture is only ever visible in the
        gutters and behind headings, and at these values the eye resolves it as paper grain rather than
        pictures. It is lighter in dark mode: the same stroke against a dark ground reads far stronger
        than it does against white, so a single value would be invisible on one theme and distracting
        on the other.
      */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10 bg-[url('/brand/school-pattern.svg')] bg-[length:440px_440px] bg-repeat opacity-[0.10] dark:opacity-[0.055]"
      />

      <a href="#main" className="skip-link">
        Skip to content
      </a>

      {/* `RouteProgress` reads `useSearchParams`, which opts its subtree out of static rendering
          unless it is inside Suspense. Without this boundary every public page would become dynamic
          and the profile pages would lose the caching that makes them worth having. */}
      <Suspense fallback={null}>
        <RouteProgress />
      </Suspense>

      <PublicHeader />

      <main
        id="main"
        className={
          'mx-auto w-full flex-1 px-gutter py-6 sm:py-10 ' +
          (width === 'narrow' ? 'max-w-3xl' : 'max-w-5xl')
        }
      >
        {children}
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-gutter py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            ZSMS is a product of{' '}
            <span className="font-medium text-foreground">AfriTech Systems Limited</span>, Lusaka.
          </p>
          <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link href="/schools" className="hover:text-foreground hover:underline">
              Find a school
            </Link>
            <Link href="/for-schools" className="hover:text-foreground hover:underline">
              For schools
            </Link>
            <Link href="/register" className="hover:text-foreground hover:underline">
              Register a school
            </Link>
            <Link href="/legal/privacy" className="hover:text-foreground hover:underline">
              Privacy
            </Link>
            <Link href="/legal/terms" className="hover:text-foreground hover:underline">
              Terms
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
