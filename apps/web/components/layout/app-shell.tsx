'use client'

/**
 * The sidebar shell every staff-facing portal sits in.
 *
 * Spec: `Official Documentation/01 Foundation Layer/DESIGN_SYSTEM.md`
 *
 * ## Why a sidebar replaced the top row
 *
 * The school portal has nine sections and the admin panel seven, and both were a horizontally
 * scrolling row. A scrolling nav has two problems that get worse as a product grows: the
 * sections past the fold are invisible rather than merely further away, and a flat list gives
 * the reader no way to tell which three of nine are about money. A vertical sidebar has room
 * for headings, and headings are what turn a list into a map.
 *
 * ## The school's brand colour is an accent, never the chrome
 *
 * `packages/design-tokens` supports per-school theming, and the obvious move is to paint the
 * sidebar in the school's colour. That is a trap: a school whose brand is dark maroon or
 * near-black gets an unreadable nav, and `/design`'s live WCAG audit would fail the very
 * surface the reader uses most. So the sidebar is platform-neutral and the brand appears on the
 * active indicator — recognisable, and legible at any brand colour.
 *
 * ## Collapsed state is remembered, and its absence is not an error
 *
 * Wrapped in try/catch because `localStorage` throws outright in some contexts rather than
 * returning null — a private window, a browser set to block site data. The documented pattern
 * in this repository, and why `no-empty` allows an empty catch.
 */

import type { JSX, ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDown, Menu, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'

import { cn } from '../../lib/utils'
import type { NavGroup } from './nav-config'

const COLLAPSE_KEY = 'zsms.sidebar.collapsed'
const GROUPS_KEY = 'zsms.sidebar.closedGroups'

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // A preference that cannot be saved is a preference that resets. Nothing else breaks.
  }
}

export interface AppShellProps {
  /** Portal root — `/admin`, `/school/ZM-LSK-0001`, `/teacher`. Items hang off this. */
  base: string
  /** Shown at the top of the sidebar. The product or the school. */
  title: string
  subtitle?: string
  groups: NavGroup[]
  /** Account menu, theme toggle, school switcher — whatever belongs to this portal. */
  headerActions?: ReactNode
  /** Rendered under the nav, pinned to the bottom. Sign-out, a support link. */
  footer?: ReactNode
  children: ReactNode
}

export function AppShell({
  base,
  title,
  subtitle,
  groups,
  headerActions,
  footer,
  children,
}: AppShellProps): JSX.Element {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [closedGroups, setClosedGroups] = useState<string[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)

  /**
   * Read after mount, never during render. Reading `localStorage` while rendering would make
   * the server and client markup disagree and produce a hydration error — so the first paint is
   * always the expanded default and the stored preference applies immediately after.
   */
  useEffect(() => {
    setCollapsed(readStored(COLLAPSE_KEY) === '1')
    const stored = readStored(GROUPS_KEY)
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as unknown
        if (Array.isArray(parsed)) setClosedGroups(parsed.filter((v): v is string => typeof v === 'string'))
      } catch {
        // Corrupt value — ignore it rather than clearing, which would lose nothing anyway.
      }
    } else {
      setClosedGroups(groups.filter((g) => g.defaultCollapsed && g.label).map((g) => g.label!))
    }
  }, [groups])

  // Navigating on a phone must close the drawer, or the destination arrives hidden behind it.
  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      writeStored(COLLAPSE_KEY, prev ? '0' : '1')
      return !prev
    })
  }, [])

  const toggleGroup = useCallback((label: string) => {
    setClosedGroups((prev) => {
      const next = prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]
      writeStored(GROUPS_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const isActive = (path: string, exact?: boolean): boolean => {
    const href = path === '' ? base : `${base}${path}`
    return exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)
  }

  const nav = (
    <nav aria-label={`${title} sections`} className="flex-1 overflow-y-auto px-2 py-3">
      <ul className="space-y-4">
        {groups.map((group, gi) => {
          const items = group.items
          if (items.length === 0) return null

          const groupClosed = group.label !== null && closedGroups.includes(group.label)

          return (
            <li key={group.label ?? `group-${gi}`}>
              {/*
                A collapsed sidebar shows icons only, so a text heading would be a wall of
                clipped words. The group becomes a hairline separator instead — the grouping
                survives, the words do not need to.
              */}
              {group.label !== null && !collapsed && (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.label!)}
                  aria-expanded={!groupClosed}
                  className="mb-1 flex w-full items-center justify-between rounded px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-text transition-colors hover:text-text"
                >
                  <span>{group.label}</span>
                  <ChevronDown
                    className={cn('size-3.5 transition-transform', groupClosed && '-rotate-90')}
                    aria-hidden
                  />
                </button>
              )}
              {group.label !== null && collapsed && gi > 0 && (
                <hr className="mx-2 mb-2 border-border" />
              )}

              {!groupClosed && (
                <ul className="space-y-0.5">
                  {items.map(({ path, label, icon: Icon, exact, badge }) => {
                    const href = path === '' ? base : `${base}${path}`
                    const active = isActive(path, exact)

                    return (
                      <li key={href}>
                        <Link
                          href={href}
                          aria-current={active ? 'page' : undefined}
                          // The label is the accessible name when the sidebar is icon-only.
                          title={collapsed ? label : undefined}
                          className={cn(
                            'group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                            collapsed && 'justify-center px-2',
                            active
                              // The brand accent, and the only place it appears.
                              ? 'bg-primary-tint text-primary-text'
                              : 'text-muted-text hover:bg-neutral-tint hover:text-text',
                          )}
                        >
                          <Icon className="size-4 shrink-0" aria-hidden />
                          {!collapsed && <span className="flex-1 truncate">{label}</span>}
                          {/*
                            A badge is the point of a sidebar that earns its width: three
                            unverified payments is work, and seeing it without navigating is the
                            difference between a menu and a dashboard. Hidden when collapsed
                            rather than shrunk to an unreadable dot.
                          */}
                          {!collapsed && badge !== null && badge !== undefined && badge !== 0 && (
                            <span
                              className={cn(
                                'rounded-full px-1.5 py-0.5 text-xs font-semibold',
                                active ? 'bg-primary text-white' : 'bg-danger-tint text-danger-text',
                              )}
                            >
                              {badge}
                            </span>
                          )}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </nav>
  )

  return (
    <div className="min-h-dvh bg-background">
      {/* ---------------- Desktop sidebar ---------------- */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-border bg-surface transition-[width] lg:flex',
          collapsed ? 'w-16' : 'w-64',
        )}
      >
        <div className={cn('flex items-center gap-2 border-b border-border px-4 py-3', collapsed && 'justify-center px-2')}>
          <Link href={base} className="min-w-0 flex-1">
            {collapsed ? (
              <span className="font-bold text-primary" aria-label={title}>
                Z
              </span>
            ) : (
              <span className="block truncate font-semibold text-text">{title}</span>
            )}
            {!collapsed && subtitle && (
              <span className="block truncate text-xs text-muted-text">{subtitle}</span>
            )}
          </Link>
        </div>

        {nav}

        <div className={cn('border-t border-border p-2', collapsed && 'flex justify-center')}>
          {!collapsed && footer}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="mt-1 flex w-full items-center justify-center gap-2 rounded-md px-2 py-2 text-sm text-muted-text transition-colors hover:bg-neutral-tint hover:text-text"
          >
            {collapsed ? <PanelLeftOpen className="size-4" aria-hidden />
                       : <PanelLeftClose className="size-4" aria-hidden />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      {/* ---------------- Mobile drawer ----------------
          A sidebar on a phone IS a drawer. Rendered separately rather than by animating the
          desktop one, because the desktop sidebar is position-fixed and reusing it would leave
          it holding layout space behind the overlay. */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-surface shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="min-w-0">
                <span className="block truncate font-semibold text-text">{title}</span>
                {subtitle && <span className="block truncate text-xs text-muted-text">{subtitle}</span>}
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
                className="rounded-md p-1.5 text-muted-text hover:bg-neutral-tint hover:text-text"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>
            {nav}
            {footer && <div className="border-t border-border p-2">{footer}</div>}
          </div>
        </div>
      )}

      {/* ---------------- Content ---------------- */}
      <div className={cn('transition-[padding]', collapsed ? 'lg:pl-16' : 'lg:pl-64')}>
        <header className="sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur">
          <div className="flex items-center gap-3 px-gutter py-3">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              className="rounded-md p-1.5 text-muted-text transition-colors hover:bg-neutral-tint hover:text-text lg:hidden"
            >
              <Menu className="size-5" aria-hidden />
            </button>
            <span className="truncate font-semibold text-text lg:hidden">{title}</span>
            <div className="ml-auto flex items-center gap-2">{headerActions}</div>
          </div>
        </header>

        {/* `id="main"` is the skip-link target from the root layout. Without it the link in
            every page announces a destination that does not exist. */}
        <main id="main" className="mx-auto max-w-7xl px-gutter py-cards">
          {children}
        </main>
      </div>
    </div>
  )
}
