/**
 * `/for-schools` — the page a school owner reads before registering.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/SCHOOL_SETUP.md`
 *       `Official Documentation/06 School and Tenant Management/TRIAL.md`
 *       `Official Documentation/17 Integration and Pricing/PRICING.md`
 *
 * ## The whole picture, with every item labelled
 *
 * Asked for on 2026-09-30: this page carries the complete feature set — working, being built, and
 * planned — so that shipping a feature is not an occasion to rewrite a marketing page.
 *
 * That creates the risk this page has to manage. It is the one page in ZSMS whose job is persuasion,
 * which makes it the one page where a sentence can quietly become a lie. The list therefore lives in
 * `features.ts` with a status on every item, rendered under headings that say plainly which is which:
 * *Working today*, *Being built now*, *Planned*. A school can read the roadmap and still know exactly
 * what it is buying.
 *
 * **A feature may say `live` only if a school could use it today, end to end** — not "the code
 * exists". Parent messaging and AI lesson generation are both `building` for that reason: both are
 * written and tested, and one has no provider credentials while the other returns a scaffold. Marking
 * either `live` would be the easiest way to lose a school's trust in everything else on the list.
 *
 * ## No prices
 *
 * Tiers and prices live in `afritech.subscription_tiers` and are changed without a deployment. Putting
 * numbers in this file would create a second source that drifts — and `PRICING.md` is explicit that a
 * price is never hardcoded. The page sells the trial instead, which needs no number.
 */

import type { JSX } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, BadgeCheck } from 'lucide-react'

import { getCountryConfig } from '@zsms/config'

import { PublicShell } from '../../components/public/public-shell'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { FEATURES, STATUS_COPY, type FeatureStatus } from './features'
import { featureIcon } from './feature-icons'

/**
 * Icons resolved here so `features.ts` stays free of JSX and can be imported anywhere — including,
 * later, by the mobile app, which has no lucide-react.
 */
const ORDER: readonly FeatureStatus[] = ['live', 'building', 'planned'] as const

export const metadata: Metadata = {
  title: 'ZSMS for schools — pupils, fees, attendance and results in one place',
  description:
    'ZSMS is school management software built for Zambian schools. Track pupils, collect and ' +
    'reconcile fees, mark attendance, enter marks and produce report cards. Thirty days free.',
}

export default function ForSchoolsPage(): JSX.Element {
  const country = getCountryConfig()

  return (
    <PublicShell width="narrow">

      <header className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Run your school from one place
        </h1>
        <p className="text-muted-foreground">
          ZSMS keeps your pupils, staff, fees, attendance and results together, and gives parents a way
          to follow their own child without phoning the office. Built in Lusaka, for {country.name}
          &rsquo;s schools — including the ones running ECZ and the new curriculum side by side.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild size="lg">
            <Link href="/register">
              Start 30 days free
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
          <span className="text-sm text-muted-foreground">No card. No commitment.</span>
        </div>
      </header>

      {ORDER.map((status) => {
        const items = FEATURES.filter((f) => f.status === status)
        // An empty bucket renders nothing, so the page reorganises itself as features move between
        // them and no orphaned heading is left behind.
        if (items.length === 0) return null
        const copy = STATUS_COPY[status]

        return (
          <section key={status} className="mt-cards">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight">{copy.heading}</h2>
              <Badge variant={copy.tone}>{items.length}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{copy.note}</p>

            <ul className="mt-stack grid grid-cols-1 gap-cards sm:grid-cols-2">
              {items.map((f) => {
                const Icon = featureIcon(f.icon)
                return (
                  <li
                    key={f.title}
                    className={
                      'rounded-lg border p-card ' +
                      (status === 'live' ? 'border-border' : 'border-dashed border-border')
                    }
                  >
                    <h3 className="flex flex-wrap items-center gap-2 font-medium">
                      <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                      {f.title}
                      {/* The status is repeated on every card, not only in the heading above it.
                          Somebody skimming on a phone sees one card at a time, and a roadmap item
                          read out of context is exactly how a school ends up expecting something
                          that is not there yet. */}
                      {status !== 'live' && <Badge variant={copy.tone}>{copy.badge}</Badge>}
                      {f.audience && (
                        <span className="text-sm font-normal text-muted-foreground">
                          {f.audience}
                        </span>
                      )}
                    </h3>
                    <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}

      <section className="mt-cards rounded-lg border border-border bg-muted/30 p-card">
        <h2 className="flex items-center gap-2 font-semibold">
          <BadgeCheck aria-hidden="true" className="size-5 text-success" />
          Your school gets a page parents can find
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Every school on ZSMS appears in our public directory, so a parent searching for you online
          finds a page with your grades, your facilities and the code they need to sign in. You choose
          what else to show — pupils per teacher, average class size, a fee range — and where a figure
          can be calculated from your own records, we calculate it rather than asking you to claim it.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          <strong className="font-medium text-foreground">We do not rank or score schools.</strong> Any
          score we could publish would measure how thoroughly you use our software, which tells a parent
          nothing useful and would be unfair to a good school with a busy office.
        </p>
        <Button asChild variant="outline" size="sm" className="mt-stack">
          <Link href="/schools">See the directory</Link>
        </Button>
      </section>

      <section className="mt-cards">
        <h2 className="text-lg font-semibold tracking-tight">How starting works</h2>
        <ol className="mt-stack space-y-stack text-sm">
          <li className="flex gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
              1
            </span>
            <span>
              <strong className="font-medium">Register.</strong> Create your account, tell us your
              school&rsquo;s name and town, and your trial begins immediately.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
              2
            </span>
            <span>
              <strong className="font-medium">We call you within a day.</strong> Someone from AfriTech
              helps you set up your grades, subjects and fees on a screen share — most schools are
              running the same week.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
              3
            </span>
            <span>
              <strong className="font-medium">Bring your pupils across.</strong> Upload the spreadsheet
              you already keep. We map your columns to ours, so you do not retype anything.
            </span>
          </li>
        </ol>
        <p className="mt-stack text-sm text-muted-foreground">
          Whatever you enter during the trial stays yours. If you decide not to subscribe, your data is
          not deleted — you keep full access to read and export it.
        </p>
      </section>

      <section className="mt-cards rounded-lg border border-border bg-muted/30 p-card">
        <h2 className="font-semibold">Why we show you the unfinished parts</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Most software lists everything and lets you discover which bits work. We would rather you
          knew, because you are choosing the system that will hold your pupils&rsquo; records for years
          — and the fastest way for us to lose your trust in the parts that do work is to have oversold
          one that does not.
        </p>
      </section>

      <div className="mt-cards flex flex-wrap items-center gap-3 border-t border-border pt-cards">
        <Button asChild size="lg">
          <Link href="/register">
            Start 30 days free
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
        <span className="text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/sign-in" className="underline">
            Sign in
          </Link>
        </span>
      </div>
    </PublicShell>
  )
}
