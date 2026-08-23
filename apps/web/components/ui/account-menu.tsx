'use client'

/**
 * Organisation switcher and account menu.
 *
 * Spec: `Official Documentation/02 Authentication and Identity/SESSIONS.md`
 *       `Official Documentation/03 Infrastructure Services/CLERK.md`
 *
 * ## Why this has to exist, and why its absence was a real bug
 *
 * Which school a session is "in" is not a property of the URL — it is the active
 * organisation on the Clerk session, which is what puts the `o.id` / `o.slg` /
 * `o.rol` claims in the token that every RLS policy reads. Without a switcher
 * there is no way to change it from inside the product at all: a user who
 * belongs to the AfriTech org and a school org is permanently stuck in whichever
 * one Clerk last made active, and the only escape is Clerk's own hosted account
 * portal. That is not a workaround, it is a missing control.
 *
 * It matters beyond convenience. An AfriTech operator with a school membership,
 * a principal who owns two schools, a teacher employed at two — all of them are
 * shapes the roles model already admits and the interface could not express.
 *
 * ## Everything lands on `/school`
 *
 * `afterSelectOrganizationUrl` is `/school` rather than a specific portal,
 * because after a switch the correct destination depends on the org just
 * selected — and `/school` already answers exactly that question: AfriTech goes
 * to `/admin`, a school role goes to `/school/<slug>`. One router, no branching
 * here, and no chance of landing somewhere the new claims cannot open.
 *
 * ## Personal accounts are hidden
 *
 * Every ZSMS user acts within an organisation; a session with no active org has
 * no `o` claim, so `current_school_uuid()` returns NULL and every policy refuses
 * it. Offering "Personal account" would offer a state in which nothing works.
 */

import type { JSX } from 'react'

import { OrganizationSwitcher, UserButton } from '@zsms/auth-provider/react'

export function AccountMenu(): JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <OrganizationSwitcher
        hidePersonal
        afterSelectOrganizationUrl="/school"
        afterCreateOrganizationUrl="/school"
        appearance={{
          elements: {
            // Clerk renders its own trigger; these keep it inside our tap target
            // and stop it from setting its own font stack against the tokens.
            rootBox: 'flex items-center',
            organizationSwitcherTrigger:
              'min-h-tap rounded-md border border-border px-2.5 py-1.5 text-sm text-foreground hover:bg-sunken',
          },
        }}
      />
      <UserButton
        appearance={{ elements: { rootBox: 'flex items-center', userButtonAvatarBox: 'size-8' } }}
      />
    </div>
  )
}
