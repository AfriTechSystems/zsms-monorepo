/**
 * GET /api/search?q= — the global search box.
 *
 * Spec: migration `0266`
 *
 * ## There is no authorisation in this file, deliberately
 *
 * `search_everything()` is SECURITY INVOKER, so Postgres applies the caller's own
 * policies to every table it touches. A school administrator finds their pupils, a
 * teacher finds only the classes they are assigned to, AfriTech finds schools — all
 * without this route, or that function, knowing any of those rules.
 *
 * Adding a role check here would be a fourth copy of rules that already live in the
 * policies, and it is the copy a direct PostgREST call would skip. The only thing this
 * route adds is the school code, which the database does not have.
 */

import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { createUserClient } from '../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok } from '../../../lib/api-response'

export const dynamic = 'force-dynamic'

const query = z.object({
  q: z.string().trim().max(80),
  limit: z.coerce.number().int().min(1).max(10).default(6),
})

interface SearchRow {
  out_kind: string
  out_id: string
  out_title: string
  out_subtitle: string | null
  out_href: string
}

export async function GET(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const parsed = query.safeParse(Object.fromEntries(request.nextUrl.searchParams))
    if (!parsed.success) {
      return fail('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid search.')
    }

    /*
      Below two characters the function returns nothing anyway. Short-circuiting here
      saves a round trip on every keystroke of a two-letter word — which, with a box
      that searches as you type, is most of them.
    */
    if (parsed.data.q.length < 2) return ok({ results: [], query: parsed.data.q })

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client.rpc('search_everything', {
      p_query: parsed.data.q,
      p_limit: parsed.data.limit,
    })

    if (error) return fromPostgrestError(error)

    const rows = (data ?? []) as unknown as SearchRow[]

    /*
      The function builds `/school/:code/...` because it holds the school's UUID, not
      the code the router uses. Resolving it here rather than in the function keeps the
      database out of the business of knowing URL shapes.

      One lookup for the whole result set, and only when a school-scoped row is
      actually present — an AfriTech search for a school name needs no code at all.
    */
    let code: string | null = null
    if (rows.some((r) => r.out_href.includes(':code'))) {
      const school = await client.from('schools').select('school_id').maybeSingle()
      code = (school.data?.school_id as string | undefined) ?? null
    }

    return ok({
      query: parsed.data.q,
      results: rows
        .map((r) => ({
          kind: r.out_kind,
          id: r.out_id,
          title: r.out_title,
          subtitle: r.out_subtitle,
          href: r.out_href.replace(':code', code ?? ''),
        }))
        /*
          A school-scoped result with no code would link to `/school//students/…`,
          which 404s. Dropping it is better than offering a link that cannot work —
          and it only happens for a caller with no school, who should not have been
          shown the box.
        */
        .filter((r) => !r.href.includes('//students') && !r.href.startsWith('/school//')),
    })
  })
}
