'use client'

/**
 * How ready this school is to use ZSMS.
 *
 * Spec: `Official Documentation/15 Super Admin and Platform/ONBOARDING.md`
 *       `Official Documentation/06 School and Tenant Management/SCHOOL_SETUP.md`
 *
 * ## Why the school sees this and not only AfriTech
 *
 * `ONBOARDING.md` frames the checklist as AfriTech's queue. But nobody at AfriTech can
 * enter a school's subjects or set its term dates — the school does almost all of it. A
 * head teacher who can see "fee structure missing, which blocks fee tracking" acts on
 * it; one who cannot waits for a phone call that may not come.
 *
 * ## It says what each gap COSTS
 *
 * "Grade levels — not done" is a chore. "Grade levels — blocks student import,
 * attendance and results" is a reason. The catalogue carries that consequence and this
 * shows it, because the consequence is what makes somebody act today rather than later.
 *
 * ## It disappears when the school is ready
 *
 * A permanent checklist reading 100% is furniture. Once everything derivable is done the
 * card stops rendering, and the dashboard goes back to being about pupils.
 */

import type { JSX } from 'react'
import { useMemo } from 'react'
import Link from 'next/link'
import { ArrowRight, CircleCheck, Circle, Rocket } from 'lucide-react'

import { Badge } from '../../../components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card'
import { useApi } from '../../../lib/use-api'

interface Item {
  out_item_key: string
  out_label: string
  out_category: string
  out_blocks: string | null
  out_complete: boolean
  out_derived: boolean
}

interface Progress {
  items: Item[]
  complete: number
  total: number
  percent: number
}

/**
 * Where each outstanding item is actually done.
 *
 * Without this the card tells somebody what is missing and leaves them to find the
 * screen, which is the difference between a prompt and a complaint. Keys with no
 * destination are the ones AfriTech configures.
 */
const DESTINATION: Record<string, string> = {
  school_profile: '/settings',
  grade_structure: '/settings',
  grading_system: '/settings',
  subjects: '/settings',
  term_dates: '/settings',
  logo: '/settings/public-profile',
  fee_structure: '/fees/structures',
  first_student: '/students/new',
  first_staff: '/staff',
  parent_links: '/students',
}

export function SetupProgress({ base }: { base: string }): JSX.Element | null {
  const { data } = useApi<Progress>('/api/school/onboarding')

  const outstanding = useMemo(
    () => (data?.items ?? []).filter((i) => !i.out_complete && i.out_derived),
    [data],
  )

  // Nothing the school can act on. A checklist at 100% is furniture, and the four
  // manual items are AfriTech's to configure — listing them here would be a list of
  // somebody else's jobs.
  if (!data || outstanding.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Rocket aria-hidden="true" className="size-5 text-primary" />
          Finish setting up
        </CardTitle>
        <CardDescription>
          <span data-numeric>{data.complete}</span> of <span data-numeric>{data.total}</span>{' '}
          done. These are worked out from your own records, so they tick themselves as you
          go.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-cards">
        {/* A bar rather than only a number: the shape of "nearly there" is read at a
            glance where a percentage has to be interpreted. */}
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-sunken"
          role="progressbar"
          aria-valuenow={data.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="School setup progress"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500"
            style={{ width: `${data.percent}%` }}
          />
        </div>

        <ul className="flex flex-col gap-1">
          {(data.items ?? [])
            .filter((i) => i.out_derived)
            .map((item) => {
              const href = DESTINATION[item.out_item_key]
              const row = (
                <>
                  {item.out_complete ? (
                    <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-success" />
                  ) : (
                    <Circle aria-hidden="true" className="size-4 shrink-0 text-subtle" />
                  )}

                  <span
                    className={
                      item.out_complete ? 'text-muted-foreground line-through' : 'font-medium'
                    }
                  >
                    {item.out_label}
                  </span>

                  {/* The consequence, which is what makes somebody act. */}
                  {!item.out_complete && item.out_blocks && (
                    <Badge variant="warning">blocks {item.out_blocks.toLowerCase()}</Badge>
                  )}

                  {!item.out_complete && href && (
                    <ArrowRight
                      aria-hidden="true"
                      className="ml-auto size-4 shrink-0 text-primary-text"
                    />
                  )}
                </>
              )

              return (
                <li key={item.out_item_key}>
                  {item.out_complete || !href ? (
                    <div className="flex min-h-tap flex-wrap items-center gap-2 px-1 text-sm">
                      {row}
                    </div>
                  ) : (
                    <Link
                      href={`${base}${href}`}
                      className="flex min-h-tap flex-wrap items-center gap-2 rounded-md px-1 text-sm transition-colors hover:bg-muted"
                    >
                      {row}
                    </Link>
                  )}
                </li>
              )
            })}
        </ul>
      </CardContent>
    </Card>
  )
}
