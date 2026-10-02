'use client'

/**
 * A way back to the portal chooser, from inside any portal.
 *
 * Spec: `Official Documentation/02 Authentication and Identity/AUTH.md`
 *
 * ## Why this is needed
 *
 * Reported from the running application on 2026-10-02: one address is a parent, a teacher
 * and possibly a school owner — all true at once, which in a small Zambian private school
 * is ordinary rather than unusual. A head teacher's own children attend the school they
 * run.
 *
 * `/welcome` routed on the FIRST match and redirected, so an owner who was also a parent
 * landed in the school portal and never learned the parent portal existed. Even once
 * `/welcome` offers the choice, somebody already inside a portal had no route back to it.
 *
 * ## It renders nothing for most people
 *
 * The large majority of accounts reach exactly one portal, and a "switch" control offering
 * nothing to switch to is noise in a header that is already busy. So the count decides,
 * and the answer is cached for the browsing session.
 *
 * ## Why a module-level cache rather than per-mount state
 *
 * `AccountMenu` lives in five layouts. A layout does not remount during client-side
 * navigation, but it does on a full page load, and a school office clicking between
 * screens all morning should not pay three queries each time. The count changes only when
 * somebody is added to an organisation or linked to a child, neither of which happens
 * mid-session — and a stale answer costs at most a redirect from `/welcome`, which is the
 * page that recounts anyway.
 */

import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { LayoutGrid } from 'lucide-react'

import { cn } from '../../lib/utils'

/** Survives client-side navigation; cleared by a full reload, which is correct. */
let cachedCount: number | null = null

export function PortalSwitch({ className }: { className?: string }): JSX.Element | null {
  const [count, setCount] = useState<number | null>(cachedCount)

  useEffect(() => {
    if (cachedCount !== null) return

    let alive = true
    void fetch('/api/session/portals')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        const n = body?.data?.count
        if (typeof n !== 'number') return
        cachedCount = n
        if (alive) setCount(n)
      })
      .catch(() => {
        // A header control is not worth an error. One portal is the safe assumption:
        // it renders nothing, and `/welcome` is still reachable by typing it.
      })

    return () => {
      alive = false
    }
  }, [])

  if (count === null || count < 2) return null

  return (
    <Link
      href="/welcome"
      className={cn(
        'inline-flex min-h-tap shrink-0 items-center gap-1.5 rounded-md border border-border',
        'px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-sunken hover:text-foreground',
        className,
      )}
    >
      <LayoutGrid aria-hidden="true" className="size-4" />
      {/* Hidden on a phone, where the header is tight and the icon is unambiguous
          beside a label the screen reader still reads. */}
      <span className="hidden sm:inline">Switch portal</span>
      <span className="sr-only sm:hidden">Switch portal</span>
    </Link>
  )
}
