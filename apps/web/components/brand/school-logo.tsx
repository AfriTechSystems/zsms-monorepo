/**
 * School logo, with the initials fallback.
 *
 * Most schools will not have uploaded a logo on day one, and a broken image
 * icon on the parent login screen is a worse first impression than no logo at
 * all. The fallback is the school's initials on its own anchor colour, which
 * reads as deliberate rather than missing.
 */
import { cn } from '../../lib/utils'
import type { JSX } from 'react'

export interface SchoolLogoProps {
  logoUrl?: string | null
  initials: string
  schoolName: string
  /** `full` for headers and login screens, `icon` for collapsed navigation. */
  variant?: 'full' | 'icon'
  className?: string
}

export function SchoolLogo({
  logoUrl,
  initials,
  schoolName,
  variant = 'full',
  className,
}: SchoolLogoProps): JSX.Element {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        // Names the school rather than saying "logo" — a screen reader user
        // needs to know WHICH school, and "logo" carries no information.
        alt={schoolName}
        className={cn(variant === 'full' ? 'h-9 w-auto max-w-[180px] object-contain' : 'size-9 rounded-md object-contain', className)}
      />
    )
  }

  return (
    <span
      // The initials are decorative; the accessible name is the school name.
      role="img"
      aria-label={schoolName}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md bg-anchor font-semibold tracking-tight text-anchor-foreground',
        variant === 'full' ? 'h-9 min-w-9 px-2 text-sm' : 'size-9 text-sm',
        className,
      )}
    >
      <span aria-hidden="true">{initials}</span>
    </span>
  )
}
