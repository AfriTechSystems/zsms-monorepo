/**
 * School portal shell.
 *
 * Spec: `Official Documentation/06 School and Tenant Module/SCHOOL.md`
 *       `Official Documentation/01 Foundation Layer/DESIGN_SYSTEM.md`
 *       `Official Documentation/01 Foundation Layer/DECISIONS.md` — ADR-043
 *
 * ## This surface IS themed, and that is the point of the exclusion
 *
 * The admin shell is deliberately never themed, so an operator always knows
 * whose system they are in. Here the opposite holds: a school's staff should see
 * their own school. The theme is resolved on the server and emitted as CSS
 * custom properties in the first response — no client fetch, no flash of ZSMS
 * blue before the school's colours arrive, and no JavaScript required to render
 * them. That matters more on this portal than on admin: an accountant opening
 * the fee list on a phone over a slow connection is the normal case.
 *
 * ## The impersonation banner is not decoration
 *
 * When an AfriTech operator is signed in *as* a school user, every action they
 * take is attributed to that user in the audit trail. A permanent, unmissable
 * band across the top is the only thing standing between "I looked" and "I
 * changed something while I was looking". It is rendered above the header so it
 * survives scrolling to the top of any screen.
 */

import type { JSX, ReactNode } from 'react'
import Link from 'next/link'
import { ShieldAlert } from 'lucide-react'

import { resolveTheme } from '@zsms/design-tokens'

import { loadSchoolBranding, ThemeStyle } from '../../../lib/theme'
import { requireSchoolSession } from '../../../lib/school-session'
import { ROLE_LABEL } from '../../../lib/roles'
import { AccountMenu } from '../../../components/ui/account-menu'
import { ThemeToggle } from '../../../components/ui/theme-toggle'
import { SchoolNav } from './school-nav'

export const metadata = {
  title: 'School portal · ZSMS',
}

export default async function SchoolLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ schoolCode: string }>
}): Promise<JSX.Element> {
  const { schoolCode } = await params

  // Redirects when signed out, 404s when the URL names a school this session is
  // not in. Both exits happen here so no screen below has to remember to check.
  const session = await requireSchoolSession(schoolCode)

  const branding = await loadSchoolBranding(session.client, session.school.id)
  const theme = resolveTheme(branding)
  const base = `/school/${session.slug}`

  return (
    <>
      <ThemeStyle theme={theme} />

      <div className="min-h-screen bg-background">
        <a href="#main" className="skip-link">
          Skip to content
        </a>

        {session.isImpersonating && (
          <div
            role="status"
            className="flex items-center justify-center gap-2 bg-warning-fill px-gutter py-2 text-center text-sm font-medium text-white"
          >
            <ShieldAlert aria-hidden="true" className="size-4 shrink-0" />
            <span>
              You are signed in as a user at {session.school.name}. Everything you do is recorded
              against them.
            </span>
          </div>
        )}

        <header className="sticky top-0 z-30 border-b border-border bg-card">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-gutter py-3">
            <div className="flex min-w-0 items-center gap-3">
              {/* The school's own mark when it has one, the ZSMS icon otherwise.
                  eslint-disable because next/image cannot serve an arbitrary
                  R2 URL without a configured remote pattern per school. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={theme.iconUrl ?? '/brand/zsms-icon-192.png'}
                alt=""
                width={36}
                height={36}
                className="size-9 shrink-0 rounded object-contain"
              />
              <div className="min-w-0">
                <Link
                  href={base}
                  className="block truncate text-base font-semibold text-foreground hover:underline"
                >
                  {session.school.name}
                </Link>
                <p className="truncate text-xs text-muted-foreground">
                  {session.school.schoolCode} · {ROLE_LABEL[session.role] ?? session.role}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <ThemeToggle />
              <AccountMenu />
            </div>
          </div>

          {/* The nav is built from the session's role on the server, so a link
              a role cannot use is never rendered — not rendered and disabled,
              which would still tell them it exists. */}
          <SchoolNav base={base} role={session.role} />
        </header>

        <main id="main" className="mx-auto max-w-7xl px-gutter py-6">
          {children}
        </main>
      </div>
    </>
  )
}
