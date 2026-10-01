/**
 * `zsms.co.zm` — the front door.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/PUBLIC_DIRECTORY.md`
 *
 * ## Four doors, not a "who are you?" splash
 *
 * The tempting design is an interstitial asking the visitor to pick a role. It was rejected: it adds
 * a click for everybody, it is the one screen a first-time visitor cannot skip, and people pick wrong
 * and then have to come back. So this page does a homepage's job — one line on what ZSMS is — and then
 * puts four unmistakably different entrances below it, because the four audiences arrive with
 * completely different intent and almost no overlap.
 *
 * The order is deliberate and is about traffic, not importance. A parent searching for a school is the
 * largest group arriving cold from a search engine; a parent whose child is already at a ZSMS school
 * wants to sign in and should not have to read marketing to find the link.
 *
 * ## What this page replaced
 *
 * Until now `/` served fourteen lines reading "Phase 0 scaffold. No application features are built
 * yet." — on the domain, in production, for the whole of Phases 0 to 4.
 */

import type { JSX } from 'react'
import type { Metadata } from 'next'
import { BadgeCheck, GraduationCap, Search, Sparkles, Users } from 'lucide-react'

import { getCountryConfig } from '@zsms/config'

import { PublicShell } from '../components/public/public-shell'
import { PortalCards, type PortalCard } from '../components/public/portal-cards'

export const metadata: Metadata = {
  title: 'ZSMS — school management for Zambian schools',
  description:
    'ZSMS helps Zambian schools manage pupils, fees, attendance and results. Parents can find a ' +
    'school, follow their child’s progress and pay fees. Teachers get free lesson planning tools.',
}

/**
 * The four entrances.
 *
 * Each is a real destination rather than a marketing page where possible: the directory and the
 * sign-in page do something immediately, and only the two "learn about it" doors lead to copy. That
 * ratio is on purpose — three of the four audiences already know what they want.
 */
const DOORS: readonly PortalCard[] = [
  {
    href: '/schools',
    icon: Search,
    eyebrow: 'Parents',
    title: 'Find a school',
    body:
      'Search by town, level and fees. Pupils per teacher and class sizes, calculated from each ' +
      'school’s own records.',
    cta: 'Browse',
    emphasis: true,
  },
  {
    href: '/sign-in',
    icon: Users,
    eyebrow: 'Parents',
    title: 'My child’s school uses ZSMS',
    body: 'Attendance, results and fee statements. Sign in with the email your school has on file.',
    cta: 'Sign in',
  },
  {
    href: '/for-schools',
    icon: GraduationCap,
    eyebrow: 'School owners',
    title: 'I run a school',
    body:
      'Pupils, staff, fees, attendance, results and report cards in one place. Thirty days free, ' +
      'no card.',
    cta: 'See ZSMS',
    emphasis: true,
  },
  {
    href: '/teacher',
    icon: Sparkles,
    eyebrow: 'Teachers',
    title: 'I’m a teacher',
    body:
      'Lesson plans, quizzes and homework for the Zambian curriculum. Works whether or not your ' +
      'school uses ZSMS.',
    cta: 'Open the Hub',
  },
] as const

export default function HomePage(): JSX.Element {
  const country = getCountryConfig()

  return (
    <PublicShell>
      {/*
        Tighter than it was. The old header ran a 3xl heading over a two-line paragraph with
        `gap-4`, which on a 768px laptop pushed the fourth door below the fold — and the doors
        are the entire purpose of this page.
      */}
      <header className="flex flex-col items-center gap-2 text-center">
        <h1 className="max-w-2xl text-xl font-semibold tracking-tight sm:text-3xl">
          School management built for {country.name}
        </h1>
        <p className="max-w-xl text-sm text-muted-foreground sm:text-base">
          One place for pupils, fees, attendance and results — and one place for parents to follow
          their child.
        </p>
      </header>

      <PortalCards
        cards={DOORS}
        label="Where would you like to go?"
        className="mt-5 sm:mt-cards"
      />

      {/*
        Folded away by default. It is a good answer to a question nobody has yet asked on
        arrival, and it was costing the fourth door its place on screen. A `<details>` keeps it
        one tap away, keyboard-accessible, with no state to manage.
      */}
      <details className="mt-5 rounded-xl border border-border bg-card/60 sm:mt-cards">
        <summary className="flex min-h-tap cursor-pointer list-none items-center gap-2 px-card text-sm font-medium transition-colors hover:bg-muted/50 [&::-webkit-details-marker]:hidden">
          <BadgeCheck aria-hidden="true" className="size-4 shrink-0 text-success" />
          Why the numbers here can be trusted
        </summary>
        <p className="border-t border-border px-card py-3 text-sm text-muted-foreground">
          Where a school publishes its pupils-per-teacher or average class size, ZSMS calculates it
          from that school&rsquo;s live pupil and staff records rather than taking their word for it.
          Schools decide what to publish, and{' '}
          <strong className="font-medium text-foreground">we do not rank or score schools</strong> —
          a league table built from how thoroughly a school uses our software would tell you nothing
          about whether your child would be happy there.
        </p>
      </details>

    </PublicShell>
  )
}
