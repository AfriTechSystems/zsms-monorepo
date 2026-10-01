/**
 * `/welcome` — where every successful sign-in lands, and the only page that decides where to send it.
 *
 * Spec: `Official Documentation/02 Authentication and Identity/AUTH.md`
 *       → *User Types and Login Entry Points*, *Standalone Teacher Login Flow*
 *
 * ## The lockout this page exists to end
 *
 * Both `/sign-in` and `/sign-up` sent every successful authentication to `/school`, which presumes the
 * person is school staff. `/school/page.tsx` then had no destination for anybody else and finished
 * with:
 *
 *     redirect('/sign-in?redirect_url=/school')
 *
 * Sending an already-authenticated user to a sign-in page is not a fallback, it is a loop — Clerk sees
 * a live session and returns them to `/school`, which returns them to `/sign-in`. And because sign-out
 * lives in `account-menu.tsx` inside the portal shells, somebody caught in that loop **could not sign
 * out either**, so they could not reach the admin or school dashboards with a different account. One
 * missing branch locked the whole product.
 *
 * Reported from the running application, not found by reading. The comment on that redirect said "the
 * honest answer is the sign-in screen rather than a staff shell they cannot use" — which was right
 * about the shell and wrong that a sign-in page is an answer.
 *
 * ## What it routes on
 *
 * `AUTH.md` gives one entry point per audience — `/login`, `/portal/login`, `/teacher/login`,
 * `/admin/login`. ZSMS has a single Clerk instance and one session shape, so separate URLs would be
 * four doors onto the same lock: the audience is not decided by which page you arrived at, it is
 * decided by **what the account is**. So one sign-in, and the routing happens here, once, where it can
 * be read in full:
 *
 *   | Session                              | Goes to           |
 *   |--------------------------------------|-------------------|
 *   | AfriTech organisation                | `/admin`          |
 *   | School organisation, staff role       | `/school/[code]`  |
 *   | School organisation, parent or pupil  | `/parent`         |
 *   | No organisation                       | asked, see below  |
 *
 * ## Why "no organisation" is asked rather than assumed
 *
 * `AUTH.md`'s standalone-teacher flow says no membership routes to `/teacher`. That was written before
 * self-registration existed, and a person with no organisation is now genuinely ambiguous: a teacher
 * who wants the Hub, or a head teacher who has just made an account and is on their way to registering
 * a school. Guessing sends half of them somewhere confusing.
 *
 * So this page asks — and, crucially, **it is where sign-out lives for anyone outside a portal.** That
 * is the property that makes the lockout impossible to recreate, more than the routing table above.
 */

import type { JSX } from 'react'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { createUserClient } from '../../lib/supabase'
import { OrganisationPicker } from './organisation-picker'
import Link from 'next/link'
import Image from 'next/image'
import { AlertTriangle, ArrowRight, Building2, Sparkles, Users } from 'lucide-react'

import { getAuthProvider } from '@zsms/auth-provider'

import { AFRITECH_ORG_SLUG } from '../../lib/admin-context'
import { isPortalRole } from '../../lib/roles'
import { SignOutLink } from './sign-out-link'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Welcome · ZSMS',
  // Nothing here is useful to a search engine, and it is reachable only with a session.
  robots: { index: false, follow: false },
}

export default async function WelcomePage(): Promise<JSX.Element> {
  const session = await getAuthProvider().getSessionUser()

  // No session at all is the one case that legitimately belongs at sign-in.
  if (!session) redirect('/sign-in?redirect_url=/welcome')

  if (session.organisationSlug === AFRITECH_ORG_SLUG) redirect('/admin')

  if (session.organisationSlug) {
    // The slug IS the school code, lowercased — one identifier shared with Clerk and with
    // `school_branding_by_slug()`.
    if (isPortalRole(session.role)) {
      redirect(`/school/${session.organisationSlug.toLowerCase()}`)
    }
    // A parent or pupil signed into a school organisation. Their portal is a separate surface.
    redirect('/parent')
  }

  /**
   * No organisation — and this is where a PARENT lands, which is the second half of the
   * lockout this page was built to end.
   *
   * A parent is not a member of any Clerk organisation and does not need to be:
   * `is_linked_parent_of()` reads `parent_user_id = get_user_id()` and nothing else, so a
   * parent's access is scoped by the link row rather than by an org. `AUTH.md` says
   * otherwise — it lists parents as `org:parent | Clerk org member` — and the schema has
   * never agreed with it.
   *
   * So before offering the generic choice below, try to link them. `claim_parent_links()`
   * matches the VERIFIED email on their token against the addresses schools recorded at
   * enrolment, links every match across every school, and returns how many. One match or
   * twenty, they go to the parent portal.
   *
   * Failures are swallowed on purpose. If the linking call throws — most likely because
   * Clerk is not sending the `email` claim — this page must still render the choice and the
   * sign-out button. A dispatcher that 500s is the lockout again, in a new costume.
   */
  let linkedAsParent = false
  /** The verified address we matched on, shown back so they can read it to the school. */
  let verifiedEmail: string | null = session.email
  /** True when Clerk is not sending the `email` claim — a fault on our side, not theirs. */
  let emailClaimMissing = false

  try {
    const client = await createUserClient()
    if (client) {
      const { data, error } = await client.rpc('claim_parent_links').maybeSingle()
      if (error) {
        // P0003 is 0170's named error for a missing `email` claim. It must never present
        // as "no children found" — a configuration fault that looks like an empty portal
        // is the exact failure the parent work exists to end.
        emailClaimMissing = error.code === 'P0003'
      } else {
        const row = (data ?? {}) as {
          out_linked?: number
          out_already_linked?: number
          out_email?: string
        }
        linkedAsParent = (row.out_linked ?? 0) + (row.out_already_linked ?? 0) > 0
        verifiedEmail = row.out_email ?? session.email
      }
    }
  } catch {
    // Swallowed: a dispatcher that 500s is the lockout again, in a new costume.
  }

  if (linkedAsParent) redirect('/parent')

  /**
   * Still nothing. Both destinations below are real and reachable, and sign-out is present —
   * which is the whole point of rendering rather than redirecting.
   */
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-cards px-gutter py-10"
    >
      <header className="flex flex-col items-center gap-3 text-center">
        <Link href="/">
          <Image
            src="/brand/zsms-lockup.png"
            alt="ZSMS"
            width={640}
            height={524}
            priority
            className="h-auto w-[150px]"
          />
        </Link>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          You&rsquo;re signed in. What next?
        </h1>
        <p className="text-sm text-muted-foreground">
          {/*
            Deliberately neutral. This page serves two different people: somebody with no
            organisation at all, and somebody who HAS organisations but none active — which
            is the normal state now that Clerk no longer forces the choice. The server
            cannot tell them apart (the session reports only the ACTIVE org, and there is
            none in either case), so the copy must be true of both. The old line asserted
            "your account isn't attached to a school yet", which is plainly wrong when read
            by the owner of one.
          */}
          Pick where you&rsquo;re headed. You can change this later.
        </p>
      </header>

      {/*
        Shown when the account belongs to organisations but none is active — which is the
        normal state now that Clerk's forced selection is off. It renders nothing when there
        are no memberships, so an unattached teacher or parent never sees it.

        First on the page, deliberately: somebody who already owns a school should not be
        offered "register my school" above the school they own.
      */}
      <OrganisationPicker />

      {/*
        The third audience this page has to serve, and the one it used to ignore.

        A parent who lands here is not weighing up two doors: they have signed up, we have
        looked for their children, and the address on their account is not one any school
        recorded. Offering them "register my school" and "open the Teacher Hub" is answering
        a question they did not ask.

        So they get the one thing that actually resolves it — their own verified address,
        shown back to them, to read to the school office. There is deliberately no school
        code box: a parent is already a row in the school's records, and where matching
        fails the office has to edit that row regardless, so a code would add a queue that
        resolves exactly as the phone call does.
      */}
      {emailClaimMissing ? (
        <section className="rounded-lg border border-danger/40 bg-danger/5 p-card">
          <h2 className="flex items-center gap-2 font-semibold">
            <AlertTriangle aria-hidden="true" className="size-5 shrink-0 text-danger" />
            We can&rsquo;t read your email address
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            This is a configuration problem on our side, not something you can fix. Please
            contact AfriTech and quote <span className="font-mono">email claim missing</span>.
          </p>
        </section>
      ) : (
        <section className="rounded-lg border border-border bg-card p-card">
          <h2 className="flex items-center gap-2 font-semibold">
            <Users aria-hidden="true" className="size-5 shrink-0 text-primary" />
            Are you a parent?
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            We looked, and no school has recorded this address against a pupil:
          </p>
          <p className="mt-2 break-all rounded-md bg-muted px-3 py-2 font-mono text-sm">
            {verifiedEmail ?? 'your sign-in address'}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Ask your school office to add exactly this address to your child&rsquo;s record.
            Your children will appear here the next time you sign in — nothing else to do.
          </p>
        </section>
      )}

      <nav aria-label="Choose where to go">
        <p className="mb-stack text-sm text-muted-foreground">Otherwise:</p>
        <ul className="flex flex-col gap-stack">
          <li>
            <Link
              href="/register"
              className="group flex flex-col gap-2 rounded-lg border border-primary/40 bg-primary/5 p-card transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex items-center gap-2 font-semibold">
                <Building2 aria-hidden="true" className="size-5 shrink-0" />
                Register my school
              </span>
              <span className="text-sm text-muted-foreground">
                Set up your school on ZSMS and start a 30-day trial. You become its owner.
              </span>
              <span className="flex items-center gap-1.5 pt-1 text-sm font-medium">
                Continue
                <ArrowRight
                  aria-hidden="true"
                  className="size-4 transition-transform group-hover:translate-x-0.5"
                />
              </span>
            </Link>
          </li>

          <li>
            <Link
              href="/teacher"
              className="group flex flex-col gap-2 rounded-lg border border-border bg-card p-card transition-colors hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex items-center gap-2 font-semibold">
                <Sparkles aria-hidden="true" className="size-5 shrink-0" />
                Open the Teacher Hub
              </span>
              <span className="text-sm text-muted-foreground">
                Lesson plans, quizzes and homework for the Zambian curriculum. Works whether or not your
                school uses ZSMS.
              </span>
              <span className="flex items-center gap-1.5 pt-1 text-sm font-medium">
                Continue
                <ArrowRight
                  aria-hidden="true"
                  className="size-4 transition-transform group-hover:translate-x-0.5"
                />
              </span>
            </Link>
          </li>
        </ul>
      </nav>

      <div className="flex flex-col gap-2 border-t border-border pt-cards text-sm">
        <p className="text-muted-foreground">
          Waiting for an invitation from your school? They&rsquo;ll email you a link — once you accept
          it, signing in brings you straight to their dashboard.
        </p>
        {/*
          The sign-out that was missing. Its absence outside the portal shells is what turned a wrong
          redirect into a lockout, so it belongs on the one page every session passes through.
        */}
        <p className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">Wrong account?</span>
          <SignOutLink />
        </p>
      </div>

      <p className="text-center text-xs text-subtle">
        ZSMS is a product of AfriTech Systems Limited.
      </p>
    </main>
  )
}
