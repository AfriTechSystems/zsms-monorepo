'use client'

/**
 * Organisation switcher and sign-out.
 *
 * Spec: `Official Documentation/02 Authentication and Identity/SESSIONS.md`
 *       `Official Documentation/03 Infrastructure Services/CLERK.md`
 *
 * ## Why this has to exist
 *
 * Which school a session is "in" is not a property of the URL — it is the active
 * organisation on the Clerk session, which is what puts the `o.id` / `o.slg` /
 * `o.rol` claims in the token every RLS policy reads. Without a switcher there
 * is no way to change it from inside the product at all.
 *
 * ## Why it is OURS rather than Clerk's `<OrganizationSwitcher>`
 *
 * The first version used Clerk's prebuilt component. It rendered for an
 * AfriTech operator and **not** for school roles, and the likeliest reason is
 * instructive: ZSMS's seven `org:*` roles are configured in Clerk with
 * deliberately **empty permission sets**, because enforcement is RLS plus
 * `lib/roles.ts` and a second permission model in Clerk would be a rule nothing
 * tests. Clerk's own prebuilt components are gated on Clerk's *system*
 * permissions (`org:sys_profile:*`, `org:sys_memberships:*`) — plumbing for its
 * UI, not application authorisation. A custom role with no permissions at all
 * therefore has none of those either, and Clerk's component degrades.
 *
 * There are two ways out. Grant every ZSMS role the `org:sys_*` permissions so
 * Clerk's widget works — which means the "permissions are intentionally empty"
 * decision quietly stops being true, in a place nothing in this repository can
 * check. Or stop depending on the widget.
 *
 * This is the second. `useOrganizationList` and `setActive` are plain hooks with
 * no permission gate: they return the memberships the user actually holds and
 * change which one is active. The control below is a native `<select>`, which
 * is also the right answer for a portal used on phones — it gets the platform's
 * own picker, keyboard handling, and accessibility for free, and there is no
 * popover to mis-position on a 375px screen.
 *
 * ## Everything lands on `/school`
 *
 * After a switch the correct destination depends on the organisation just
 * chosen, and `/school` already answers exactly that: AfriTech goes to `/admin`,
 * a school role to `/school/<slug>`. One router, and no chance of landing
 * somewhere the new claims cannot open.
 */

import type { JSX } from 'react'
import { useState } from 'react'
import { Loader2, LogOut } from 'lucide-react'

import { SignOutButton, useAuth, useOrganizationList } from '@zsms/auth-provider/react'

import { cn } from '../../lib/utils'
import { PortalSwitch } from './portal-switch'
import { clearAllDrafts } from '../../lib/use-form-draft'

export function AccountMenu({ className }: { className?: string }): JSX.Element | null {
  // The ACTIVE organisation, which is what the select must show as selected.
  // Taking the first membership instead would render the wrong school as
  // current on every session whose active org is not first in the list — and it
  // would look right often enough to survive a casual check.
  const { orgId } = useAuth()
  const { isLoaded, setActive, userMemberships } = useOrganizationList({
    userMemberships: { infinite: true },
  })
  const [switching, setSwitching] = useState(false)

  const memberships = userMemberships?.data ?? []

  const switchTo = async (organizationId: string): Promise<void> => {
    if (!setActive) return
    setSwitching(true)
    try {
      await setActive({ organization: organizationId })
      // A full navigation, not a client push. The session token is reminted
      // with new `o.*` claims, and every server component in the tree resolved
      // its data from the OLD ones — a soft navigation would leave a school
      // shell rendered around another school's session until something
      // happened to refetch.
      window.location.href = '/school'
    } catch {
      setSwitching(false)
    }
  }

  return (
    <div className={cn('flex shrink-0 items-center gap-2', className)}>
      {/* One organisation is not a choice, so it is not rendered as one. The
          heading already names the school. */}
      {isLoaded && memberships.length > 1 && (
        <>
          <label htmlFor="org-switcher" className="sr-only">
            Switch organisation
          </label>
          <select
            id="org-switcher"
            disabled={switching}
            value={orgId ?? ''}
            onChange={(e) => void switchTo(e.target.value)}
            className={cn(
              'h-tap min-h-tap max-w-[11rem] truncate rounded-md border border-input bg-background',
              'px-2.5 text-sm text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'disabled:cursor-not-allowed disabled:opacity-70',
            )}
          >
            {memberships.map((m) => (
              <option key={m.organization.id} value={m.organization.id}>
                {m.organization.name}
              </option>
            ))}
          </select>
        </>
      )}

      {switching && <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin" />}

      {/*
        A way back to the portal chooser.

        Distinct from the organisation switcher above: that moves between SCHOOLS, which
        is one audience in several places. This moves between AUDIENCES — the same person
        as a parent, a teacher and an owner, which is ordinary in a small school. Renders
        nothing when the account reaches only one portal.
      */}
      <PortalSwitch />

      <SignOutButton redirectUrl="/sign-in">
        <button
          type="button"
          /**
           * Drafts are wiped before the session ends.
           *
           * They are already namespaced by Clerk user id, so the next person to sign in on this
           * machine could not restore someone else's work into their own form. But a school
           * office computer is shared, `localStorage` survives sign-out, and leaving a
           * colleague's half-written announcement sitting in the browser is not something to
           * defend on a technicality. Signing out clears it.
           */
          onClick={() => clearAllDrafts()}
          className={cn(
            'inline-flex min-h-tap shrink-0 items-center gap-1.5 rounded-md border border-border',
            'px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-sunken hover:text-foreground',
          )}
        >
          <LogOut aria-hidden="true" className="size-4 shrink-0" />
          {/* Label hidden on a phone, where the header is already tight. The
              accessible name is kept, so the control is unchanged for a screen
              reader. */}
          <span className="hidden sm:inline">Sign out</span>
          <span className="sr-only sm:hidden">Sign out</span>
        </button>
      </SignOutButton>
    </div>
  )
}
