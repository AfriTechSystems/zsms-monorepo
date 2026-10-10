'use client'

/**
 * Choosing which organisation to act in.
 *
 * Spec: `Official Documentation/02 Authentication and Identity/AUTH.md`
 *       → *Role Selector — Multi-School and Multi-Role Users*
 *
 * ## The gap this fills
 *
 * Clerk's instance had `force_organization_selection: true`, which pushed every user into a
 * Clerk-owned task page at `/sign-in/tasks/choose-organization` before any ZSMS code ran.
 * That broke the three audiences who have no organisation by design — standalone teachers,
 * parents, and a school owner mid-registration whose organisation does not exist yet — and
 * left them on a dead-end page reading "You must belong to an organization".
 *
 * Turning it off fixed those three and revealed the opposite problem: a user who belongs to
 * organisations now has NONE active. `whoami` reported `organisationId: null` and
 * `role: "none"` for an account that is `org:owner` at a school AND `org:admin` at AfriTech.
 * Clerk was doing the selecting; with it off, nothing was.
 *
 * So the selection moves here, where it belongs — ZSMS knows what the organisations MEAN
 * (this one is a school, that one is the admin console) and Clerk does not.
 *
 * ## Why our own rather than `<OrganizationSwitcher />`
 *
 * Clerk's prebuilt switcher shows organisation names and an avatar. It cannot say "this is
 * your school's dashboard" versus "this is the AfriTech admin console", because those are
 * ZSMS concepts. It also offers "Create organisation", which must never be reachable: only
 * ZSMS provisions school organisations, and a user-created one would bypass the reserved
 * slug check that keeps school codes unique.
 *
 * `useOrganizationList` and `setActive` are re-exported from `@zsms/auth-provider/react`
 * for this, so ADR-032 holds and no screen imports Clerk directly.
 *
 * ## After `setActive`, a full reload — not a client navigation
 *
 * The active organisation changes the SESSION TOKEN, and the token is what `/welcome` reads
 * on the server to decide where to send somebody. A client-side `router.push` can race the
 * new token and dispatch on the old claims, which lands a school owner on the page they just
 * came from. `window.location.assign` guarantees the next request carries the new token.
 */

import type { JSX } from 'react'
import { useState } from 'react'
import { Building2, Loader2, ShieldCheck } from 'lucide-react'

import { useOrganizationList } from '@zsms/auth-provider/react'

/** Must match `AFRITECH_ORG_SLUG` on the server side of `/welcome`. */
const AFRITECH_SLUG = 'afritech-systems-admin'

export function OrganisationPicker(): JSX.Element | null {
  const { isLoaded, userMemberships, setActive } = useOrganizationList({
    userMemberships: { infinite: true },
  })
  const [busy, setBusy] = useState<string | null>(null)

  if (!isLoaded) return null

  const memberships = userMemberships?.data ?? []
  // Nobody to choose between. The page's own copy covers this case.
  if (memberships.length === 0) return null

  return (
    <section className="flex flex-col gap-stack">
      <div>
        <h2 className="font-semibold">Where are you headed?</h2>
        <p className="text-sm text-muted-foreground">
          {memberships.length === 1
            ? 'Continue to your dashboard.'
            : 'Your account has access to more than one place. You can switch later.'}
        </p>
      </div>

      <ul className="flex flex-col gap-stack">
        {memberships.map((membership) => {
          const org = membership.organization
          const isAfritech = org.slug === AFRITECH_SLUG
          const Icon = isAfritech ? ShieldCheck : Building2

          return (
            <li key={org.id}>
              <button
                type="button"
                disabled={busy !== null}
                onClick={async () => {
                  setBusy(org.id)
                  try {
                    await setActive?.({ organization: org.id })
                    // Full load, deliberately — see the header.
                    window.location.assign('/welcome')
                  } catch {
                    setBusy(null)
                  }
                }}
                className="group flex w-full items-center gap-3 rounded-lg border border-border bg-card p-card text-left transition-colors hover:border-primary disabled:opacity-60"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Icon aria-hidden="true" className="size-5 text-primary" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{org.name}</span>
                  <span className="block text-sm text-muted-foreground">
                    {/*
                      What the organisation MEANS, which is the whole reason this is not
                      Clerk's prebuilt switcher.
                    */}
                    {isAfritech
                      ? 'AfriTech admin console'
                      : `School dashboard · ${(membership.role ?? '').replace('org:', '')}`}
                  </span>
                </span>
                {busy === org.id && (
                  <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin" />
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
