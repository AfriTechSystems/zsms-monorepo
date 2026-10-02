'use client'

/**
 * Which portal — for an account that reaches more than one.
 *
 * Spec: `Official Documentation/02 Authentication and Identity/AUTH.md`
 *
 * ## Why a choice rather than a guess
 *
 * One address is often a parent, a teacher AND a school owner at once. `/welcome` used to
 * redirect on the first match, so an owner who was also a parent landed in the school
 * portal and never learned the parent portal existed.
 *
 * ## A school portal needs the organisation switched first
 *
 * A session acts in ONE Clerk organisation, and every RLS policy reads `o.id` from the
 * token. Navigating to `/school/other-school` while the session still holds the previous
 * organisation resolves the WRONG school — or nothing. So a portal carrying an
 * `organisationId` the session does not hold is switched before it is opened, and the
 * card says it is switching rather than appearing to hang.
 *
 * The parent portal and the Hub carry no organisation at all, which is why they are a
 * plain link: a parent's access is the link row, not a membership.
 */

import type { JSX } from 'react'
import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  Building2,
  GraduationCap,
  Loader2,
  Network,
  ShieldCheck,
  Users,
} from 'lucide-react'

import { useOrganizationList } from '@zsms/auth-provider/react'
import type { Portal } from '../../lib/portals'
import { SignOutLink } from './sign-out-link'

const ICON = {
  admin: ShieldCheck,
  school: Building2,
  parent: Users,
  teacher: GraduationCap,
  network: Network,
} as const

export function PortalChooser({
  portals,
  email,
}: {
  portals: Portal[]
  email: string | null
}): JSX.Element {
  const router = useRouter()
  const { setActive } = useOrganizationList()
  const [busy, setBusy] = useState<string | null>(null)

  const open = useCallback(
    async (portal: Portal) => {
      // No organisation needed, or the session already holds it.
      if (!portal.organisationId || portal.ready) {
        router.push(portal.href)
        return
      }

      setBusy(portal.key)
      try {
        // Switch FIRST. The destination reads the organisation from the token, so
        // navigating before the switch lands resolves the previous school.
        await setActive?.({ organization: portal.organisationId })
        router.push(portal.href)
      } catch {
        setBusy(null)
        // Navigate anyway: `/school/[code]` resolves the school from the URL and will
        // say plainly if the session cannot reach it, which is a better answer than a
        // card that silently does nothing.
        router.push(portal.href)
      }
    },
    [router, setActive],
  )

  return (
    <main
      id="main"
      className="relative mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center gap-4 px-gutter py-6"
    >
      <div className="flex flex-col gap-1.5 text-center">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          Where would you like to go?
        </h1>
        <p className="text-sm text-muted-foreground">
          {/* Named, because somebody with several portals usually has several accounts
              too, and the commonest confusion is being signed in as the wrong one. */}
          This account{email ? ` (${email})` : ''} reaches more than one part of ZSMS.
        </p>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2">
        {portals.map((portal) => {
          const Icon = ICON[portal.kind]
          const switching = busy === portal.key

          return (
            <li key={portal.key}>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void open(portal)}
                className="group flex min-h-tap w-full flex-col gap-1.5 rounded-xl border border-border bg-card p-card text-left transition-colors hover:border-foreground/25 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              >
                <span className="flex size-9 items-center justify-center rounded-lg bg-muted">
                  {switching ? (
                    <Loader2 aria-hidden="true" className="size-4 animate-spin text-primary" />
                  ) : (
                    <Icon aria-hidden="true" className="size-4 text-primary" />
                  )}
                </span>

                <span className="font-semibold">{portal.label}</span>
                <span className="text-sm text-muted-foreground">
                  {switching ? 'Switching…' : portal.description}
                </span>

                <span className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-primary-text">
                  Open
                  <ArrowRight
                    aria-hidden="true"
                    className="size-3.5 transition-transform group-hover:translate-x-0.5"
                  />
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <div className="flex flex-col items-center gap-2 border-t border-border pt-3">
        <p className="text-xs text-muted-foreground">
          You can come back here any time — look for &ldquo;Switch portal&rdquo;.
        </p>
        <SignOutLink />
      </div>
    </main>
  )
}
