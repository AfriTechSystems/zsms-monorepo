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
import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight, GraduationCap, Search, Sparkles, Users } from 'lucide-react'

import { getCountryConfig } from '@zsms/config'

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
const DOORS = [
  {
    href: '/schools',
    icon: Search,
    eyebrow: 'Parents',
    title: 'Find a school for my child',
    body:
      'Search schools by town, level and fees. See pupils per teacher and average class sizes, ' +
      'calculated from each school’s own records.',
    cta: 'Browse schools',
    emphasis: true,
  },
  {
    href: '/sign-in',
    icon: Users,
    eyebrow: 'Parents',
    title: 'My child’s school uses ZSMS',
    body:
      'See attendance, results and fee statements, and pay fees. You will need your school’s code — ' +
      'it is on the school’s page in our directory.',
    cta: 'Sign in',
    emphasis: false,
  },
  {
    href: '/for-schools',
    icon: GraduationCap,
    eyebrow: 'School owners',
    title: 'I run a school',
    body:
      'Pupils, staff, fees, attendance, results and report cards in one place, with WhatsApp to ' +
      'parents. Thirty days free, no card.',
    cta: 'See ZSMS for schools',
    emphasis: true,
  },
  {
    href: '/teacher',
    icon: Sparkles,
    eyebrow: 'Teachers',
    title: 'I’m a teacher',
    body:
      'Build lesson plans, quizzes and homework for the Zambian curriculum, and export them to PDF ' +
      'or Word. Works whether or not your school uses ZSMS.',
    cta: 'Open the Teacher Hub',
    emphasis: false,
  },
] as const

export default function HomePage(): JSX.Element {
  const country = getCountryConfig()

  return (
    <main id="main" className="mx-auto w-full max-w-4xl px-gutter py-10">
      <header className="flex flex-col items-center gap-4 text-center">
        <Image
          src="/brand/zsms-lockup.png"
          alt="ZSMS — school management by AfriTech Systems"
          width={200}
          height={64}
          priority
          className="h-auto w-[170px] sm:w-[200px]"
        />
        <h1 className="max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">
          School management built for {country.name}
        </h1>
        <p className="max-w-xl text-muted-foreground">
          One place for pupils, fees, attendance and results — and one place for parents to follow
          their child. Built by AfriTech Systems in Lusaka.
        </p>
      </header>

      <nav aria-label="Where would you like to go?" className="mt-cards">
        <h2 className="sr-only">Choose what you came for</h2>
        <ul className="grid grid-cols-1 gap-cards sm:grid-cols-2">
          {DOORS.map((door) => (
            <li key={door.href}>
              {/* The whole card is the link. A card with a small link inside it makes the obvious
                  gesture — tapping the card — do nothing, which on a phone reads as a broken page. */}
              <Link
                href={door.href}
                className={
                  'group flex h-full flex-col gap-2 rounded-lg border p-card transition-colors ' +
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
                  (door.emphasis
                    ? 'border-primary/40 bg-primary/5 hover:border-primary'
                    : 'border-border bg-card hover:border-foreground/30')
                }
              >
                <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <door.icon aria-hidden="true" className="size-4" />
                  {door.eyebrow}
                </span>
                <span className="text-lg font-semibold leading-snug">{door.title}</span>
                <span className="text-sm text-muted-foreground">{door.body}</span>
                <span className="mt-auto flex items-center gap-1.5 pt-2 text-sm font-medium">
                  {door.cta}
                  <ArrowRight
                    aria-hidden="true"
                    className="size-4 transition-transform group-hover:translate-x-0.5"
                  />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <section className="mt-cards rounded-lg border border-border bg-muted/30 p-card">
        <h2 className="font-semibold">Why the numbers here can be trusted</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Where a school publishes its pupils-per-teacher or average class size, ZSMS calculates it from
          that school&rsquo;s live pupil and staff records rather than taking their word for it. Schools
          decide what to publish, and <strong className="font-medium text-foreground">we do not rank or
          score schools</strong> — a league table built from how thoroughly a school uses our software
          would tell you nothing about whether your child would be happy there.
        </p>
      </section>

      <footer className="mt-cards flex flex-wrap items-center gap-x-cards gap-y-2 border-t border-border pt-cards text-sm text-muted-foreground">
        <span>ZSMS is a product of AfriTech Systems Limited.</span>
        <Link href="/legal/privacy" className="underline">
          Privacy
        </Link>
        <Link href="/legal/terms" className="underline">
          Terms
        </Link>
        <Link href="/register" className="underline">
          Register a school
        </Link>
      </footer>
    </main>
  )
}
