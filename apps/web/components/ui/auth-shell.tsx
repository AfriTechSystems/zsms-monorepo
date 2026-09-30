/**
 * The frame around every authentication screen.
 *
 * Spec: `Official Documentation/02 Authentication and Identity/AUTH.md`
 *       `Official Documentation/06 School and Tenant Management/PUBLIC_DIRECTORY.md`
 *         → *Parent Login Flow from Directory*
 *
 * ## Built because the auth pages did not fit on a phone
 *
 * Sign-in and sign-up each carried their own copy of lockup + heading + subtitle + Clerk card +
 * footer, sized for a laptop: `py-10`, a 150px mark, a two-line legal footnote. Stacked inside
 * `min-h-dvh` on a 360×640 handset — which is most of the market ZSMS is for — the total overflowed
 * and the page scrolled. A sign-in form you have to scroll to reach is the first thing a new user
 * meets, and Clerk's card is the part that cannot be shortened.
 *
 * So everything around it got smaller on small screens and the same on large ones: a 112px mark
 * rising to 160px, `py-6` rising to `py-10`, `gap-stack` rising to `gap-cards`, and one line of
 * footnote instead of three. Nothing is hidden — hiding the legal line on mobile would be the easy
 * way to win the pixels and the wrong one.
 *
 * ## Why one component rather than tidier copies
 *
 * Three pages shared this shape and drifted: the sign-up footnote still told every visitor their
 * school administrator had invited them, months after sign-up became the front door for
 * self-registration too. A shared frame means the next change lands everywhere, and it is the reason
 * a school's own branding below was a small change rather than three.
 *
 * ## The school branding, and what it is for
 *
 * `PUBLIC_DIRECTORY.md` has the directory link a parent through as
 * `/sign-in?school_id=ZM-LSK-0001`, so the sign-in page can say *"Sign in to Sunrise Academy"* with
 * their crest on it. The parameter was being passed and read by nothing.
 *
 * It matters more than decoration: a parent arriving from a search result has no idea what ZSMS is,
 * and seeing their child's school named on the page is what tells them they are in the right place.
 * Resolved through `school_branding_by_slug()`, which is `anon`-readable and returns a name, two
 * colours and a logo — nothing else, by design.
 */

import type { JSX, ReactNode } from 'react'
import Link from 'next/link'
import Image from 'next/image'

import { createAnonClient } from '../../lib/supabase'

export interface AuthBranding {
  schoolName: string
  logoUrl: string | null
}

/**
 * Branding for the school a parent came from, or null.
 *
 * Returns null for anything unexpected rather than throwing. A sign-in page that fails to render
 * because a school code was mistyped would be a far worse outcome than one that renders unbranded,
 * and the unbranded version still works perfectly.
 */
export async function loadAuthBranding(schoolCode: string | undefined): Promise<AuthBranding | null> {
  if (!schoolCode) return null

  const client = createAnonClient()
  if (!client) return null

  const { data, error } = await client.rpc('school_branding_by_slug', {
    // The slug is the school code lowercased — one identifier shared with Clerk.
    p_slug: schoolCode.trim().toLowerCase(),
  })
  if (error || !data) return null

  const branding = data as { schoolName?: string; logoUrl?: string | null }
  if (!branding.schoolName) return null

  return { schoolName: branding.schoolName, logoUrl: branding.logoUrl ?? null }
}

export function AuthShell({
  title,
  subtitle,
  branding,
  children,
  footnote,
}: {
  title: string
  /** One short line. Two lines costs a phone the room Clerk's card needs. */
  subtitle?: string
  branding?: AuthBranding | null
  children: ReactNode
  footnote?: ReactNode
}): JSX.Element {
  return (
    <main
      id="main"
      /**
       * `justify-center` with `min-h-dvh`, so on a laptop the card sits in the middle and on a short
       * handset it starts at the top and stays reachable. `dvh` rather than `vh` because mobile Safari
       * counts its collapsing toolbar into `vh`, which is the specific reason a form can look centred
       * in a screenshot and sit under the address bar in someone's hand.
       */
      className="flex min-h-dvh flex-col items-center justify-center gap-stack bg-background px-gutter py-6 sm:gap-cards sm:py-10"
    >
      <div className="flex w-full max-w-md flex-col items-center gap-2 text-center sm:gap-3">
        <Link href="/" aria-label="ZSMS home">
          <Image
            src="/brand/zsms-lockup.png"
            alt="ZSMS — school management by AfriTech Systems"
            width={200}
            height={64}
            priority
            className="h-auto w-[112px] sm:w-[160px]"
          />
        </Link>

        {/* The school's own mark, when a parent arrived from its directory page. Shown between the
            ZSMS lockup and the heading, so the hierarchy reads "ZSMS, for this school". */}
        {branding?.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={branding.logoUrl}
            alt=""
            width={44}
            height={44}
            className="size-11 rounded-md object-contain"
          />
        )}

        <h1 className="text-lg font-semibold tracking-tight text-foreground sm:text-2xl">
          {branding ? `Sign in to ${branding.schoolName}` : title}
        </h1>

        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>

      {children}

      {footnote && (
        <p className="max-w-md text-balance text-center text-xs text-subtle">{footnote}</p>
      )}
    </main>
  )
}
