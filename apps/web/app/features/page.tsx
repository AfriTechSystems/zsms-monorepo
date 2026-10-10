/**
 * The full ZSMS feature set, grouped by suite.
 *
 * Spec: every module document under `Official Documentation/06`–`18`.
 *       `Official Documentation/06 School and Tenant Management/PUBLIC_DIRECTORY.md`
 *
 * ## How this differs from `/for-schools`
 *
 * `/for-schools` is a sales page: it argues, it has a call to action, and it groups by readiness
 * because a school deciding whether to start a trial is asking "what works today". This page is the
 * reference — every feature, grouped by what part of the school it serves, with its status stated
 * plainly beside it. Somebody arrives here from the navigation wanting the whole picture, not a pitch.
 *
 * Both read `FEATURES` from one file, so a feature cannot exist on one page and not the other, and
 * promoting one from `building` to `live` still means changing a single word.
 *
 * ## Status is shown, never hidden
 *
 * Every card carries its badge — `Available`, `Being built`, `Planned`. A features page that lists
 * planned work as though it shipped is the specific dishonesty this structure exists to prevent, and
 * the counts in the summary row are computed from the data rather than written by hand, so they
 * cannot drift from it.
 */

import type { JSX } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, Check } from 'lucide-react'

import { PublicShell } from '../../components/public/public-shell'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { FEATURES, STATUS_COPY, SUITES, type FeatureStatus } from '../for-schools/features'
import { featureIcon } from '../for-schools/feature-icons'

export const metadata: Metadata = {
  title: 'Features — everything ZSMS does for a school',
  description:
    'The complete ZSMS feature set: pupil and staff records, fees, attendance, marks and results, '
    + 'report cards, the parent portal, the Teacher Hub, and what is still being built.',
}

const STATUS_ORDER: Record<FeatureStatus, number> = { live: 0, building: 1, planned: 2 }

export default function FeaturesPage(): JSX.Element {
  // Computed, never written by hand — see the header comment.
  const counts = FEATURES.reduce<Record<FeatureStatus, number>>(
    (acc, f) => ({ ...acc, [f.status]: (acc[f.status] ?? 0) + 1 }),
    { live: 0, building: 0, planned: 0 },
  )

  return (
    <PublicShell>
      <header className="mb-cards flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Everything ZSMS does
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          The whole product, grouped by the part of the school it serves. We show what is being built
          alongside what works today, with each marked plainly — so you can see where ZSMS is going,
          not just where it is.
        </p>

        <dl className="flex flex-wrap gap-2">
          {(['live', 'building', 'planned'] as const).map((status) => (
            <div
              key={status}
              className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm"
            >
              <Badge variant={STATUS_COPY[status].tone}>{STATUS_COPY[status].badge}</Badge>
              <dd data-numeric className="font-semibold">
                {counts[status]}
              </dd>
              <dt className="sr-only">{STATUS_COPY[status].heading}</dt>
            </div>
          ))}
        </dl>
      </header>

      {/* Jump links. Six suites is more than fits on one screen, and a reference page people scroll
          past wants a way back to the top of a section. */}
      <nav aria-label="Feature suites" className="mb-cards flex flex-wrap gap-2">
        {SUITES.map((suite) => {
          const Icon = featureIcon(suite.icon)
          return (
            <a
              key={suite.key}
              href={`#${suite.key}`}
              className="inline-flex min-h-tap items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium transition-colors hover:border-foreground/25 hover:bg-muted"
            >
              <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
              {suite.title}
            </a>
          )
        })}
      </nav>

      <div className="flex flex-col gap-10">
        {SUITES.map((suite) => {
          const items = FEATURES.filter((f) => f.suite === suite.key)
            // Within a suite, what works comes first. A school reading "the classroom" wants to know
            // what it gets on day one before what arrives later.
            .slice()
            .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])

          if (items.length === 0) return null
          const SuiteIcon = featureIcon(suite.icon)

          return (
            <section key={suite.key} id={suite.key} className="scroll-mt-20">
              <div className="mb-cards flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <SuiteIcon aria-hidden="true" className="size-5 text-primary" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold tracking-tight">{suite.title}</h2>
                  <p className="text-sm text-muted-foreground">{suite.blurb}</p>
                </div>
              </div>

              <ul className="grid grid-cols-1 gap-cards sm:grid-cols-2">
                {items.map((f) => {
                  const Icon = featureIcon(f.icon)
                  const status = STATUS_COPY[f.status]

                  return (
                    <li
                      key={f.title}
                      className="flex flex-col gap-2 rounded-lg border border-border bg-card p-card transition-colors hover:border-foreground/20"
                    >
                      <div className="flex items-start gap-3">
                        <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                        <h3 className="flex-1 font-medium leading-tight">{f.title}</h3>
                        <Badge variant={status.tone}>{status.badge}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{f.body}</p>
                      {f.audience && (
                        <p className="mt-auto pt-1 text-xs text-subtle">For {f.audience.toLowerCase()}</p>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
      </div>

      <section className="mt-10 flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-card">
        <h2 className="font-semibold tracking-tight">
          <Check aria-hidden="true" className="mr-1.5 inline size-4 text-success" />
          Everything marked available is in the trial
        </h2>
        <p className="text-sm text-muted-foreground">
          There is no feature tier to choose on day one — a trial school gets the whole of what works
          today, so you can judge ZSMS on the parts that are finished rather than a demo.
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button asChild size="lg">
            <Link href="/register">
              Start 30 days free
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/for-schools">Why schools choose ZSMS</Link>
          </Button>
        </div>
      </section>
    </PublicShell>
  )
}
