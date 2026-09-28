/**
 * School Network shell.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/SCHOOL_SETUP.md`
 *
 * ## No school theming, by necessity
 *
 * A network spans many schools with many brands. There is no single palette that could be
 * applied, so the platform theme is the only honest choice — and switching palette as the owner
 * moves between the network view and one school is the correct signal that they have changed
 * context.
 */

import type { JSX, ReactNode } from 'react'

import { AccountMenu } from '../../components/ui/account-menu'
import { ThemeToggle } from '../../components/ui/theme-toggle'
import { SchoolSwitcher } from '../../components/ui/school-switcher'
import { NetworkShell } from './network-shell'

export const metadata = {
  title: 'School network · ZSMS',
}

export default function NetworkLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <NetworkShell
        headerActions={
          <>
            {/* The drill-down into any one school. A context change rather than a destination,
                which is why it belongs in the header and not in the sidebar. */}
            <SchoolSwitcher />
            <ThemeToggle />
            <AccountMenu />
          </>
        }
      >
        {children}
      </NetworkShell>
    </>
  )
}
