/**
 * AfriTech admin shell.
 *
 * Spec: `Official Documentation/15 Super Admin and Platform/SUPERADMIN.md`
 *
 * ## A server layout wrapping a client shell
 *
 * The session check and the redirect must happen on the server. The sidebar must be a client
 * component — it holds collapse state, a live incident count, and icon references that cannot
 * cross the RSC boundary as props. So this file does the auth and hands `children` to
 * `AdminShell`, which owns the navigation.
 */

import type { JSX, ReactNode } from 'react'
import { redirect } from 'next/navigation'

import { getAuthProvider } from '@zsms/auth-provider'

import { platformTheme, ThemeStyle } from '../../lib/theme'
import { AccountMenu } from '../../components/ui/account-menu'
import { ThemeToggle } from '../../components/ui/theme-toggle'
import { AskAi } from '../../components/assistant/ask-ai'
import { AdminShell } from './admin-shell'

export const metadata = {
  title: 'AfriTech Admin \u00b7 ZSMS',
  description: 'Platform administration for ZSMS',
}

export default async function AdminLayout({
  children,
}: {
  children: ReactNode
}): Promise<JSX.Element> {
  // Signed-out visitors are sent to sign in rather than shown the shell with five failed panels
  // inside it. This is a *routing* courtesy, not the access check: a signed-in non-admin still
  // reaches this layout, and the honest 403 they get from each route is the real answer.
  // Authorisation stays in the RLS policy, exactly as `lib/admin-context.ts` argues.
  const session = await getAuthProvider().getSessionUser()
  if (!session) redirect('/sign-in?redirect_url=/admin')

  const theme = platformTheme()

  return (
    <>
      {/* Re-emitted at this level rather than inherited. A school layout further down the tree
          writes its own variables; this guarantees the admin shell is drawn in ZSMS colours no
          matter what has been resolved above it. */}
      <ThemeStyle theme={theme} />
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <AdminShell
        headerActions={
          <>
            {/*
              Ask AI, which the AfriTech admin was missing entirely.

              The school, teacher and parent shells each got it when the assistant was
              built; this one was simply never done, so the icon did not appear in the
              top navigation at all. Audience `school`, because an AfriTech operator asks
              the same operational questions a head teacher does.
            */}
            <AskAi audience="school" />
            <ThemeToggle />
            <AccountMenu />
          </>
        }
      >
        {children}
      </AdminShell>
    </>
  )
}
