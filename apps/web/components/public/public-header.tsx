'use client'

/**
 * The navigation bar across every public page.
 *
 * Spec: `Official Documentation/01 Foundation Layer/DESIGN_SYSTEM.md`
 *       `Official Documentation/06 School and Tenant Management/PUBLIC_DIRECTORY.md`
 *
 * ## What its absence looked like
 *
 * Seen in the browser rather than inferred: the directory opened with a floating logo and a heading,
 * and there was **no way to reach anything else in ZSMS from it**. A parent who arrived on a school's
 * profile from a search result could read that page and leave. Every public page was a cul-de-sac.
 *
 * ## Sticky, and why that is not decoration
 *
 * The directory is a scrolling list. Without a fixed header, "sign in" and "for schools" are wherever
 * the person last scrolled past, which on a phone is three screens up. The bar is 56px on mobile so it
 * costs little of a short viewport, and it is the only fixed element on the page.
 *
 * ## The mobile menu is a disclosure, not a drawer
 *
 * A slide-over drawer needs a focus trap, a scroll lock, an escape handler and an overlay — four
 * things to get wrong for four links. A panel that pushes the page down needs none of them, closes
 * when a link is followed, and is reachable by keyboard for free.
 *
 * `Sign in` stays visible at every width rather than hiding behind the menu, because it is the one
 * action a returning parent arrives wanting and the only one they would hunt for.
 */

import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { GraduationCap, LayoutGrid, Menu, Search, Sparkles, X } from 'lucide-react'

import { cn } from '../../lib/utils'
import { Button } from '../ui/button'

const LINKS = [
  { href: '/schools', label: 'Find a school', icon: Search },
  { href: '/features', label: 'Features', icon: LayoutGrid },
  { href: '/for-schools', label: 'For schools', icon: GraduationCap },
  { href: '/teacher', label: 'For teachers', icon: Sparkles },
] as const

export function PublicHeader(): JSX.Element {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  // Following a link must close the panel. Without this the menu stays open over the page that was
  // just navigated to, which reads as a broken link rather than a successful one.
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/95">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-gutter sm:h-16">
        {/*
          `flex-1 basis-0` on the outer two columns is what actually centres the tabs. With `ml-auto`
          the nav sat wherever the logo's width left it, which is off-centre by however wide the
          wordmark happens to be — and it moves when the logo does. Equal-basis side columns make the
          centre column's midpoint the header's midpoint regardless.
        */}
        <div className="flex flex-1 basis-0 justify-start">
        <Link href="/" className="shrink-0" aria-label="ZSMS home">
          {/*
            `zsms-logo.png`, not `zsms-lockup.png`. The lockup is 640x524 — a stacked mark with the
            wordmark beneath it — so at any width that fits a header it is roughly as tall as it is
            wide, and it overflowed the bar. This asset is 1777x885 and genuinely horizontal.

            Dimensions declared honestly: `next/image` reserves layout space from these numbers, and
            every page in this repo had them as 200x64 regardless of the file, which reserved the wrong
            box and shifted the page as the image loaded.
          */}
          <Image
            src="/brand/zsms-logo.png"
            alt="ZSMS"
            width={1777}
            height={885}
            priority
            className="h-7 w-auto sm:h-8"
          />
        </Link>
        </div>

        <nav aria-label="Main" className="hidden items-center gap-1 sm:flex">
          {LINKS.map((link) => {
            // `startsWith` so a school's profile page keeps "Find a school" marked as current — the
            // person is still inside the directory, and a nav that forgets that is disorienting.
            const active = pathname.startsWith(link.href)
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-tap items-center rounded-md px-3 text-sm font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )}
              >
                {link.label}
              </Link>
            )
          })}
        </nav>

        <div className="flex flex-1 basis-0 items-center justify-end gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/sign-in">Sign in</Link>
          </Button>

          <button
            type="button"
            aria-expanded={open}
            aria-controls="public-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:hidden"
          >
            {open ? <X aria-hidden="true" className="size-5" /> : <Menu aria-hidden="true" className="size-5" />}
          </button>
        </div>
      </div>

      {/* Pushes the page down rather than covering it — see the header comment. */}
      {open && (
        <nav id="public-menu" aria-label="Main" className="border-t border-border sm:hidden">
          <ul className="mx-auto flex w-full max-w-5xl flex-col px-gutter py-2">
            {LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={pathname.startsWith(link.href) ? 'page' : undefined}
                  className="flex min-h-tap items-center gap-3 rounded-md px-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                >
                  <link.icon aria-hidden="true" className="size-4 text-muted-foreground" />
                  {link.label}
                </Link>
              </li>
            ))}
            <li>
              <Link
                href="/register"
                className="flex min-h-tap items-center gap-3 rounded-md px-2 text-sm font-medium text-primary transition-colors hover:bg-muted"
              >
                <GraduationCap aria-hidden="true" className="size-4" />
                Register your school
              </Link>
            </li>
          </ul>
        </nav>
      )}
    </header>
  )
}
