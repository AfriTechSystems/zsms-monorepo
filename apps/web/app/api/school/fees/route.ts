/**
 * GET /api/school/fees — every pupil's balance, and what is overdue.
 *
 * Spec: `Official Documentation/09 Fee and Financial Management/PAYMENTS.md`
 *       `Official Documentation/09 Fee and Financial Management/PAYMENTS.md`
 *       `Official Documentation/01 Foundation Layer/RLS.md`
 *
 * ## Arrears are surfaced. They are never a gate.
 *
 * This route returns figures and nothing else. No caller may read a balance and
 * withhold a result, a report card, or a certificate: that is a school-
 * configurable policy which is **off by default**, never behaviour ZSMS
 * assumes. It is written here because an arrears endpoint is exactly where such
 * an assumption creeps in — one `if (outstanding > 0)` in the wrong screen and
 * the product has quietly taken a position on a child's education.
 *
 * ## The balance is computed by the database, not assembled here
 *
 * `student_fee_balance` already carries outstanding, arrears, overdue counts and
 * the oldest unpaid due date, netted of discounts and verified payments. Summing
 * `fee_records` in TypeScript would be a second implementation of money
 * arithmetic — in a language with one numeric type, against a schema that uses
 * NUMERIC(12,2) precisely to avoid it. The view is the answer.
 */

import type { NextRequest } from 'next/server'

import { createUserClient } from '../../../../lib/supabase'
import { can } from '../../../../lib/roles'
import { resolveFeeCaller } from '../../../../lib/fee-context'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const caller = await resolveFeeCaller()
    if (!caller.ok) return caller.response

    if (!can(caller.role, 'fees:read')) {
      return fail('FORBIDDEN', 'Your role does not include fees.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const filter = request.nextUrl.searchParams.get('filter') ?? 'outstanding'
    const search = request.nextUrl.searchParams.get('q')?.trim()

    const page = Math.max(1, Number(request.nextUrl.searchParams.get('page') ?? '1') || 1)
    const perPage = 25

    // No school filter: `financial_staff_read_fee_records` and its siblings
    // already scope the view to the caller's own school.
    let query = client
      .from('student_fee_balance')
      .select(
        'student_id, student_code, first_name, last_name, student_status, currency_code, ' +
          'total_due, total_paid, outstanding, arrears_amount, is_overdue, days_overdue, ' +
          'oldest_unpaid_due_date, records_outstanding, records_overdue',
      )
      .order('arrears_amount', { ascending: false })

    if (filter === 'overdue') query = query.eq('is_overdue', true)
    else if (filter === 'outstanding') query = query.gt('outstanding', 0)

    if (search) {
      const safe = search.replace(/[%_,()]/g, ' ').trim()
      if (safe) {
        query = query.or(
          `first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,student_code.ilike.%${safe}%`,
        )
      }
    }

    const [balances, summary, pending] = await Promise.all([
      /*
        A page, not a truncation. `.limit(500)` silently dropped every pupil past
        the five hundredth — ordered by arrears, so the pupils omitted were the
        ones least in debt, which made the omission least likely to be noticed.
      */
      query.range((page - 1) * perPage, page * perPage - 1),

      /*
        The totals come from the database over the WHOLE filtered set (0159), not
        from the rows above. Summing a page would have made "Outstanding" mean
        "outstanding among these twenty-five", which is not a number anybody
        wants and reads exactly like one they do.

        Same filter and search, passed to a function that applies them in SQL, so
        the summary and the list cannot describe different sets of pupils.
      */
      client.rpc('school_fee_summary', {
        p_filter: filter,
        p_search: search && search.length > 0 ? search : null,
      }),
      // The verification queue's size, so the screen can badge it without a
      // second request. A payment recorded but not verified is a claim, not
      // money — the two must never be added together.
      client
        .from('payments')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending_verification'),
    ])

    if (balances.error) return fromPostgrestError(balances.error)
    if (summary.error) return fromPostgrestError(summary.error)

    // `.or()` widens PostgREST's inferred row type to a union including its
    // error shape; the runtime error is handled above, so the rows are narrowed
    // here rather than every field access being guarded.
    const rows = (balances.data ?? []) as unknown as Array<Record<string, unknown>>
    const num = (v: unknown): number => {
      const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : 0
      return Number.isFinite(n) ? n : 0
    }

    // `school_fee_summary` returns exactly one row; PostgREST still delivers a set.
    const totals = ((summary.data ?? []) as unknown as Array<Record<string, unknown>>)[0]

    return ok(
      {
        balances: rows,
        summary: {
          outstanding: num(totals?.['out_outstanding']),
          arrears: num(totals?.['out_arrears']),
          pupilsOwing: num(totals?.['out_pupils_owing']),
          pupilsOverdue: num(totals?.['out_pupils_overdue']),
        },
        pendingVerification: pending.count ?? 0,
        canRecord: can(caller.role, 'fees:write'),
      },
      { total: num(totals?.['out_total_pupils']), page, perPage },
    )
  })
}
