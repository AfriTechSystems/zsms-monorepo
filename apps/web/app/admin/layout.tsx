/**
 * AfriTech admin shell.
 *
 * Spec: `Official Documentation/15 Super Admin and Platform/SUPERADMIN.md`
 *       `Official Documentation/01 Foundation Layer/DESIGN_SYSTEM.md`
 *
 * **This surface is never themed.** `platformTheme()` resolves the ZSMS default
 * and ignores every school's branding, which is ADR-043's one hard exclusion. An
 * operator moves between forty schools in a session and impersonates users
 * inside them; if the platform's own tooling adopted each school's colours,
 * "am I in AfriTech admin or inside a school" would become a question answered
 * by reading the URL — exactly when getting it wrong costs most.
 *
 * The navigation is a white surface with navy ink, not a navy block. Same rule
 * as everywhere else: the anchor colour is ink and structure.
 */

import type { JSX, ReactNode } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getAuthProvider } from '@zsms/auth-provider'

import { platformTheme, ThemeStyle } from '../../lib/theme'
import { ThemeToggle } from '../../components/ui/theme-toggle'
import { AdminNav } from './admin-nav'

export const metadata = {
  title: 'AfriTech Admin · ZSMS',
  description: 'Platform administration for ZSMS',
}

export default async function AdminLayout({ children }: { children: ReactNode }): Promise<JSX.Element> {
  // Signed-out visitors are sent to sign in rather than shown the shell with
  // five failed panels inside it. This is a *routing* courtesy, not the access
  // check: a signed-in non-admin still reaches this layout, and the honest 403
  // they get from each route is the real answer. Authorisation stays in the RLS
  // policy, exactly as `lib/admin-context.ts` argues.
  const session = await getAuthProvider().getSessionUser()
  if (!session) redirect('/sign-in?redirect_url=/admin')

  const theme = platformTheme()

  return (
    <>
      {/*
        Re-emitted at this level rather than inherited. A school layout further
        down the tree writes its own variables; this guarantees the admin shell
        is drawn in ZSMS colours no matter what has been resolved above it.
      */}
      <ThemeStyle theme={theme} />

      <div className="min-h-screen bg-background">
        <a href="#main" className="skip-link">
          Skip to content
        </a>

        <header className="sticky top-0 z-30 border-b border-border bg-card">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-gutter py-3">
            <div className="flex min-w-0 items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/zsms-icon-192.png"
                alt=""
                width={36}
                height={36}
                className="size-9 shrink-0"
              />
              <div className="min-w-0">
                <Link
                  href="/admin"
                  className="block truncate text-base font-semibold text-foreground hover:underline"
                >
                  AfriTech Admin
                </Link>
                {/*
                  Named on every screen, not just the landing page. It is the
                  standing answer to "whose system am I in", which matters more
                  here than anywhere else in the product.
                */}
                <p className="truncate text-xs text-muted-foreground">ZSMS platform administration</p>
              </div>
            </div>

            <ThemeToggle />
          </div>

          <AdminNav />
        </header>

        <main id="main" className="mx-auto max-w-7xl px-gutter py-6">
          {children}
        </main>
      </div>
    </>
  )
}
