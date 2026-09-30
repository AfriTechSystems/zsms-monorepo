'use client'

/**
 * What a signed-out visitor sees at `/teacher`.
 *
 * Spec: `Official Documentation/02 Authentication and Identity/AUTH.md`
 *         → *Standalone Teacher Login Flow*
 *       `Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md`
 *
 * ## The gap this fills
 *
 * `/teacher` had no signed-out branch. It mounted, called `/api/teacher/hub`, received 401, and
 * rendered an error state reading "Authentication required." — which looks like a broken page rather
 * than an invitation to sign in. The homepage and the directory both send teachers here, so the Hub's
 * front door reported a fault to every first-time visitor.
 *
 * `AUTH.md` names `/teacher` as the standalone teacher's entry point, and an entry point that only
 * works for people who are already through it is not one.
 *
 * ## Why the copy leads with "no school required"
 *
 * The Hub's whole proposition is that a teacher does not need their school's permission or
 * participation — it is the one part of ZSMS an individual can adopt alone, and `TEACHER_PORTAL.md`
 * treats that as the acquisition route rather than a side effect. A teacher whose school has never
 * heard of ZSMS assumes a school system is closed to them, so the first sentence has to say otherwise.
 */

import type { JSX } from 'react'
import Link from 'next/link'
import { ArrowRight, FileText, Sparkles, WandSparkles } from 'lucide-react'

import { Button } from '../../components/ui/button'

const WHAT_YOU_GET = [
  {
    icon: WandSparkles,
    title: 'Lesson plans in minutes',
    body: 'Give it a subject, a grade and a topic. Get a timed plan with objectives, phases and activities.',
  },
  {
    icon: FileText,
    title: 'Quizzes and homework',
    body: 'Built for the grade you teach, with an answer key you can keep or edit.',
  },
  {
    icon: Sparkles,
    title: 'Yours to export',
    body: 'Download as PDF, or as Word if you want to change it. Your plans stay yours.',
  },
] as const

export function HubSignIn(): JSX.Element {
  return (
    <div className="flex flex-col gap-cards">
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">The ZSMS Teacher Hub</h1>
        <p className="max-w-xl text-muted-foreground">
          Planning tools for the Zambian curriculum &mdash; ECZ and Cambridge, primary through A-Level.{' '}
          <strong className="font-medium text-foreground">
            You don&rsquo;t need your school to use ZSMS.
          </strong>{' '}
          Create an account and start planning.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          {/*
            Both routes go through `/welcome`, which sends an account with no organisation here —
            so a teacher signing up lands back on this page with their Hub ready, and one who turns
            out to belong to a school lands in their school instead. Neither needs to be guessed at
            this point, which is why the dispatcher exists.
          */}
          <Button asChild size="lg">
            <Link href="/sign-up?redirect_url=/teacher">
              Create a free account
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
          <span className="text-sm text-muted-foreground">
            Already have one?{' '}
            <Link href="/sign-in?redirect_url=/teacher" className="underline">
              Sign in
            </Link>
          </span>
        </div>
      </header>

      <ul className="grid grid-cols-1 gap-cards sm:grid-cols-3">
        {WHAT_YOU_GET.map((item) => (
          <li key={item.title} className="rounded-lg border border-border p-card">
            <h2 className="flex items-center gap-2 font-medium">
              <item.icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              {item.title}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">{item.body}</p>
          </li>
        ))}
      </ul>

      <div className="rounded-lg border border-border bg-muted/30 p-card text-sm text-muted-foreground">
        <p>
          <strong className="font-medium text-foreground">Teaching at a school that uses ZSMS?</strong>{' '}
          Sign in with the email your school has on file and you&rsquo;ll get your classes, registers
          and mark sheets as well as the Hub.
        </p>
      </div>
    </div>
  )
}
