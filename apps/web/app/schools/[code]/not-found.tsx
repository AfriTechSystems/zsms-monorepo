/**
 * Shown when a school code matches nothing listed.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/PUBLIC_DIRECTORY.md`
 *
 * ## Three situations, one page, on purpose
 *
 * `school_public_profile()` returns no row for a school that does not exist, one that is suspended or
 * terminated, and one still awaiting verification. This page covers all three without hinting which.
 * Distinguishing them would make the URL a status oracle — anybody could learn that a named school had
 * been suspended, which is commercially damaging information about a customer.
 *
 * So the copy avoids implying the school does not exist. "Not listed" is true in every case; "no such
 * school" would be a guess, and in the suspended case a wrong one that a parent might repeat.
 *
 * ## Why this file exists rather than Next's default
 *
 * Two reasons, and the second is the substantive one:
 *
 *   * a parent who mistyped a code needs a way back to the directory, which the default page has no
 *     concept of;
 *   * **the status code cannot be relied on here.** `notFound()` is thrown from an async server
 *     component that awaits a fetch, so the response has already begun streaming and Next cannot
 *     retract the 200 it committed. Measured on a clean dev server: the not-found UI renders with HTTP
 *     200. The protection against a crawler indexing it therefore has to be `robots: noindex`, set in
 *     the page's `generateMetadata` — not the status line.
 */

import type { JSX } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { SearchX } from 'lucide-react'

import { Button } from '../../../components/ui/button'

export default function SchoolNotFound(): JSX.Element {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh w-full max-w-lg flex-col items-center justify-center gap-cards px-gutter py-10 text-center"
    >
      <Link href="/">
        <Image
          src="/brand/zsms-lockup.png"
          alt="ZSMS"
          width={200}
          height={64}
          className="h-auto w-[140px]"
        />
      </Link>

      <SearchX aria-hidden="true" className="size-10 text-muted-foreground" />

      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold tracking-tight">That school is not listed</h1>
        <p className="text-sm text-muted-foreground">
          Check the code — it looks like <span className="font-mono">ZM-LSK-0001</span>. Schools appear
          in our directory only while they are actively using ZSMS, so a school you know may not be
          here.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button asChild>
          <Link href="/schools">Search the directory</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/sign-in">Sign in</Link>
        </Button>
      </div>
    </main>
  )
}
