'use client'

/**
 * The account menu — one control in the header, everything about "you" inside it.
 *
 * ## Why this replaced five separate controls
 *
 * The header carried a theme group of three buttons, an organisation `<select>`, a
 * Switch portal link, an Account link and a Sign out button, side by side. On a
 * 1280px admin screen that left the search field clipped, and none of the five is
 * something anybody presses more than a few times a day.
 *
 * They are all the same KIND of thing — settings about the person rather than the
 * work — so they belong behind one trigger. That is also what every application a
 * school already uses does, which matters more than novelty here.
 *
 * ## Switching never leaves a stale session
 *
 * Both switchers — between schools, and between portals — set the Clerk organisation
 * the destination needs and then perform a **hard navigation**. This is the fix for
 * a real reported bug: an AfriTech operator who is also a school owner would switch
 * and find features missing until they reloaded.
 *
 * The cause was a soft `<Link href="/welcome">`. A client navigation keeps the
 * session token the page was rendered with, so the server components in the new tree
 * resolved `o.rol` and `o.id` from the OLD organisation — which reads exactly like a
 * permissions bug, because every role check honestly says no. The organisation
 * `<select>` already knew this and said so in a comment; the portal link did not.
 */

import type { JSX } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
/*
  Through the provider, never from `@clerk/nextjs` directly (ADR-032). Nothing outside
  `packages/auth-provider` imports Clerk, so Keycloak can be swapped in for a
  self-hosted deployment without touching a screen.
*/
import {
  SignOutButton,
  useAuth,
  useOrganizationList,
  useUser,
} from '@zsms/auth-provider/react'
import {
  Building2,
  Check,
  ChevronDown,
  LayoutGrid,
  Loader2,
  LogOut,
  Monitor,
  Moon,
  ShieldCheck,
  Sun,
  UserCog,
} from 'lucide-react'

import { cn } from '../../lib/utils'
import { clearAllDrafts } from '../../lib/use-form-draft'
import { useTheme, type ThemeChoice } from '../../lib/use-theme'
import { Avatar } from './avatar'

interface Portal {
  key: string
  label: string
  href: string
  organisationId: string | null
  active: boolean
}

const THEMES: Array<{ value: ThemeChoice; label: string; Icon: typeof Sun }> = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'dark', label: 'Dark', Icon: Moon },
]

export function AccountMenu({ className }: { className?: string }): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [portals, setPortals] = useState<Portal[]>([])
  const wrapRef = useRef<HTMLDivElement>(null)

  const { user } = useUser()
  const { orgId } = useAuth()
  const { isLoaded, setActive, userMemberships } = useOrganizationList({
    userMemberships: { infinite: true },
  })
  const { choice, setChoice } = useTheme()

  const memberships = userMemberships?.data ?? []

  /*
    Portals are fetched only when the menu is first opened.

    They were previously fetched on every page load by `PortalSwitch`, for a control
    most accounts never see — one request per navigation to decide whether to render
    a link. Behind a trigger, the cost is paid by the people who actually look.
  */
  useEffect(() => {
    if (!open || portals.length > 0) return
    void fetch('/api/session/portals')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => setPortals(body?.data?.portals ?? []))
      .catch(() => {
        /* A menu that fails to list portals still signs you out. */
      })
  }, [open, portals.length])

  // Close on an outside click or Escape, which is what a menu is expected to do.
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e: MouseEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  /**
   * Move to another organisation or another portal.
   *
   * One function for both, because they are one operation: make the session hold the
   * organisation the destination needs, then go there with a full page load so the
   * token is reminted and every server component renders against the new claims.
   */
  const goTo = useCallback(
    async (href: string, organisationId: string | null): Promise<void> => {
      setSwitching(true)
      try {
        /*
          Only when it differs. Calling `setActive` with the organisation already held
          is a wasted round-trip, and calling it with `null` for a portal that does not
          need one would drop an organisation the CURRENT portal still requires if the
          navigation then failed.
        */
        if (organisationId && organisationId !== orgId && setActive) {
          await setActive({ organization: organisationId })
        }
        window.location.href = href
      } catch {
        setSwitching(false)
      }
    },
    [orgId, setActive],
  )

  const name = user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? 'Your account'
  const email = user?.primaryEmailAddress?.emailAddress ?? null
  const currentOrg = memberships.find((m) => m.organization.id === orgId)?.organization.name

  return (
    <div ref={wrapRef} className={cn('relative shrink-0', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex min-h-tap items-center gap-2 rounded-md border border-border px-2 py-1 text-sm transition-colors hover:bg-sunken"
      >
        <Avatar name={name} src={user?.imageUrl ?? null} size="sm" />
        {/* The name is hidden on a phone, where the header is tight. The accessible
            name survives, so the control is unchanged for a screen reader. */}
        <span className="hidden max-w-[9rem] truncate sm:inline">{name}</span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span className="sr-only">Account menu</span>
      </button>

      {open && (
        <div
          role="menu"
          /*
            Right-aligned and width-capped. A menu anchored left would run off the
            screen on a phone, where this trigger sits at the right edge of the header.
          */
          className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[17rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border border-border bg-surface shadow-xl"
        >
          {/* --- who you are ------------------------------------------------ */}
          <div className="flex items-center gap-2.5 border-b border-border p-3">
            <Avatar name={name} src={user?.imageUrl ?? null} size="md" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{name}</span>
              {email && (
                <span className="block truncate text-xs text-muted-foreground">{email}</span>
              )}
            </span>
          </div>

          {/* --- theme ------------------------------------------------------ */}
          <div className="border-b border-border p-3">
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Appearance
            </p>
            <div
              role="radiogroup"
              aria-label="Colour theme"
              className="flex rounded-md border border-border bg-background p-0.5"
            >
              {THEMES.map(({ value, label, Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={choice === value}
                  onClick={() => setChoice(value)}
                  className={cn(
                    'inline-flex flex-1 items-center justify-center gap-1 rounded px-1.5 py-1.5 text-xs transition-colors',
                    choice === value
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-sunken hover:text-foreground',
                  )}
                >
                  <Icon aria-hidden="true" className="size-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* --- schools ----------------------------------------------------
              One organisation is not a choice, so it is not rendered as one. */}
          {isLoaded && memberships.length > 1 && (
            <div className="border-b border-border p-1.5">
              <p className="px-1.5 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                School
              </p>
              {memberships.map((m) => (
                <button
                  key={m.organization.id}
                  type="button"
                  role="menuitem"
                  disabled={switching}
                  onClick={() => void goTo('/school', m.organization.id)}
                  className="flex w-full min-h-tap items-center gap-2 rounded px-1.5 text-left text-sm transition-colors hover:bg-sunken disabled:opacity-60"
                >
                  <Building2 aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{m.organization.name}</span>
                  {m.organization.id === orgId && (
                    <Check aria-hidden="true" className="size-4 shrink-0 text-success-text" />
                  )}
                </button>
              ))}
            </div>
          )}

          {/* --- portals ----------------------------------------------------
              Distinct from the schools above: that moves between SCHOOLS, one
              audience in several places. This moves between AUDIENCES — the same
              person as a parent, a teacher and an owner, which is ordinary in a
              small school. */}
          {portals.length > 1 && (
            <div className="border-b border-border p-1.5">
              <p className="px-1.5 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Switch portal
              </p>
              {portals.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  role="menuitem"
                  disabled={switching}
                  onClick={() => void goTo(p.href, p.organisationId)}
                  className="flex w-full min-h-tap items-center gap-2 rounded px-1.5 text-left text-sm transition-colors hover:bg-sunken disabled:opacity-60"
                >
                  <LayoutGrid aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{p.label}</span>
                  {p.active && (
                    <Check aria-hidden="true" className="size-4 shrink-0 text-success-text" />
                  )}
                </button>
              ))}
            </div>
          )}

          {/* --- account pages ---------------------------------------------- */}
          <div className="p-1.5">
            <Link
              href="/account"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex min-h-tap items-center gap-2 rounded px-1.5 text-sm transition-colors hover:bg-sunken"
            >
              <UserCog aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              Profile &amp; preferences
            </Link>
            <Link
              href="/account?section=privacy"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex min-h-tap items-center gap-2 rounded px-1.5 text-sm transition-colors hover:bg-sunken"
            >
              <ShieldCheck aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              Privacy &amp; your data
            </Link>
          </div>

          {/* --- out -------------------------------------------------------- */}
          <div className="border-t border-border p-1.5">
            <SignOutButton redirectUrl="/sign-in">
              <button
                type="button"
                role="menuitem"
                /**
                 * Drafts are wiped before the session ends.
                 *
                 * They are namespaced by Clerk user id, so the next person could not
                 * restore someone else's work into their own form. But a school office
                 * machine is shared and `localStorage` survives sign-out; leaving a
                 * colleague's half-written announcement in the browser is not something
                 * to defend on a technicality.
                 */
                onClick={() => clearAllDrafts()}
                className="flex w-full min-h-tap items-center gap-2 rounded px-1.5 text-left text-sm text-danger-text transition-colors hover:bg-danger-tint"
              >
                <LogOut aria-hidden="true" className="size-4 shrink-0" />
                Sign out
              </button>
            </SignOutButton>
          </div>

          {switching && (
            <p className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
              <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
              Switching…
            </p>
          )}

          {/* The current school, stated rather than implied. A menu that can switch
              between two should say which one is in force. */}
          {currentOrg && memberships.length <= 1 && (
            <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
              Signed in to {currentOrg}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
