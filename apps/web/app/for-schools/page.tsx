/**
 * `/for-schools` — the page a school owner reads before registering.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/SCHOOL_SETUP.md`
 *       `Official Documentation/06 School and Tenant Management/TRIAL.md`
 *       `Official Documentation/17 Integration and Pricing/PRICING.md`
 *
 * ## Every claim on this page is something that exists
 *
 * This is the one page in ZSMS whose job is persuasion, which makes it the one page where a sentence
 * can quietly become a lie. So the copy describes only what is built and working: pupils, staff, fees,
 * attendance, results, report cards, announcements, the parent portal, the Teacher Hub.
 *
 * Deliberately absent, because they are not built: WhatsApp delivery (the fallback chain is written and
 * no message has left the building — see the Phase 3 caveat), the mobile app, loans, and the timetable.
 * A school that signs up expecting WhatsApp today would have been mis-sold, and the first thing they
 * would lose faith in is everything else on the list.
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
import Image from 'next/image'
import {
  ArrowRight,
  BadgeCheck,
  CalendarCheck,
  ClipboardList,
  FileText,
  Megaphone,
  Smartphone,
  Sparkles,
  Users,
  Wallet,
} from 'lucide-react'

import { getCountryConfig } from '@zsms/config'

import { Button } from '../../components/ui/button'

export const metadata: Metadata = {
  title: 'ZSMS for schools — pupils, fees, attendance and results in one place',
  description:
    'ZSMS is school management software built for Zambian schools. Track pupils, collect and ' +
    'reconcile fees, mark attendance, enter marks and produce report cards. Thirty days free.',
}

/** What is built and working today. Nothing aspirational on this list. */
const CAPABILITIES = [
  {
    icon: Users,
    title: 'Pupils and staff',
    body:
      'Enrol pupils one at a time or import a whole roll from a spreadsheet — ZSMS maps your columns, ' +
      'so you do not reformat anything. Add your own fields for whatever your school tracks, with ' +
      'medical notes visible only to the people who should see them.',
  },
  {
    icon: Wallet,
    title: 'Fees that reconcile',
    body:
      'Build a fee structure once and issue it to a whole grade. Record payments, verify bank ' +
      'deposits, and see exactly who owes what and for how long. Receipts are generated with your ' +
      'logo on them.',
  },
  {
    icon: CalendarCheck,
    title: 'Attendance',
    body:
      'A register a teacher can mark in under a minute, per class and per day, with the term’s ' +
      'record kept for every pupil.',
  },
  {
    icon: ClipboardList,
    title: 'Marks and results',
    body:
      'Enter marks against your own grading scale — ECZ, Cambridge or one you define. Change a grade ' +
      'boundary next year and last year’s grades still mean what they meant, because ZSMS records ' +
      'which scale produced each one.',
  },
  {
    icon: FileText,
    title: 'Report cards',
    body:
      'Generated as PDFs with your school’s branding, in batches, for a whole class at a time.',
  },
  {
    icon: Smartphone,
    title: 'A portal for parents',
    body:
      'Parents sign in on a phone and see their child’s attendance, results, fee statement and ' +
      'your notices. No app to install.',
  },
  {
    icon: Megaphone,
    title: 'Announcements',
    body:
      'Write once and send to a grade, a class, all parents or all staff — with a record of who has ' +
      'read it.',
  },
  {
    icon: Sparkles,
    title: 'Lesson planning for your teachers',
    body:
      'Your teachers get the ZSMS Teacher Hub: lesson plans, quizzes and homework for the Zambian ' +
      'curriculum, exported to PDF or Word.',
  },
] as const

export default function ForSchoolsPage(): JSX.Element {
  const country = getCountryConfig()

  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-gutter py-10">
      <nav aria-label="Breadcrumb" className="mb-cards">
        <Link href="/">
          <Image
            src="/brand/zsms-lockup.png"
            alt="ZSMS"
            width={200}
            height={64}
            priority
            className="h-auto w-[130px]"
          />
        </Link>
      </nav>

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

      <section className="mt-cards">
        <h2 className="text-lg font-semibold tracking-tight">What you get</h2>
        <ul className="mt-stack grid grid-cols-1 gap-cards sm:grid-cols-2">
          {CAPABILITIES.map((c) => (
            <li key={c.title} className="rounded-lg border border-border p-card">
              <h3 className="flex items-center gap-2 font-medium">
                <c.icon aria-hidden="true" className="size-4 text-muted-foreground" />
                {c.title}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">{c.body}</p>
            </li>
          ))}
        </ul>
      </section>

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

      <section className="mt-cards">
        <h2 className="text-lg font-semibold tracking-tight">Being built next</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          We would rather tell you what is coming than let you assume it is here. WhatsApp messages to
          parents, an offline app for teachers to mark attendance without signal, timetabling, and
          school financing are all in progress and not yet available.
        </p>
      </section>

      <footer className="mt-cards flex flex-wrap items-center gap-3 border-t border-border pt-cards">
        <Button asChild>
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
      </footer>
    </main>
  )
}
