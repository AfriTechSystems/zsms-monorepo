/**
 * GET /api/v1/… — the external integration API (API_INTEGRATION.md, Tier 2).
 *
 * Spec: `03 Infrastructure Services/API_INTEGRATION.md`
 *
 * ## Why one catch-all rather than a file per resource
 *
 * Every endpoint here does the same four things: authenticate the key, check one scope,
 * read one table filtered to the key's school, return it. Five near-identical files
 * would be five places for the school filter to be forgotten — and forgetting it once
 * is a cross-tenant leak.
 *
 * One handler, one `RESOURCES` table describing what each exposes. Adding an endpoint is
 * adding a row, and the row cannot omit the filter because the shared code applies it.
 *
 * ## `/api/v1/` is a contract
 *
 * A school's developer writes against this and does not redeploy when ZSMS does. The
 * internal `/api/school/*` routes change shape whenever a screen needs them to; these
 * must not. Hence the version in the path, and hence an explicit column list per
 * resource rather than `select('*')` — adding a column internally must not silently
 * change what an integration receives.
 *
 * ## What is deliberately not here
 *
 * Writes. API_INTEGRATION.md's Tier 1 and Tier 3 include `fees:write`,
 * `attendance:write` and `loans:write`, and the scopes exist in `0241` so a key can
 * carry them. The endpoints do not, yet: a write arriving with no user behind it needs
 * idempotency on a caller-supplied key, or a retried request double-records a payment.
 * That is its own piece of work and shipping the read half first is not a compromise —
 * Tier 2 is read-only by the document's own definition.
 */

import { NextResponse } from 'next/server'

import {
  apiKeyQuery,
  authenticateApiKey,
  checkApiKeyRate,
  recordApiKeyUsage,
  type ApiKeyContext,
} from '../../../../lib/api-key-auth'

export const dynamic = 'force-dynamic'

interface Resource {
  /** The scope a key must carry. */
  scope: string
  table: string
  /**
   * The columns an integration receives. An explicit list, never `*` — a column added
   * internally must not appear in somebody's integration without a version bump.
   */
  columns: string
  /** Applied on top of the school filter. Published-only, not-deleted, and so on. */
  filters?: (q: ReturnType<typeof apiKeyQuery>) => ReturnType<typeof apiKeyQuery>
  orderBy?: string
}

const RESOURCES: Record<string, Resource> = {
  students: {
    scope: 'students:read',
    table: 'students',
    columns:
      'id, student_id, first_name, last_name, grade_id, class_id, status, enrolment_date',
    // Soft-deleted pupils are gone as far as an integration is concerned.
    filters: (q) => q.eq('is_deleted', false),
    orderBy: 'last_name',
  },
  fees: {
    scope: 'fees:read',
    table: 'fee_records',
    columns:
      'id, student_id, academic_year, term_number, fee_label, amount_due, amount_paid, discount_amount, status, due_date',
    filters: (q) => q.eq('is_deleted', false),
    orderBy: 'due_date',
  },
  payments: {
    scope: 'fees:read',
    table: 'payments',
    columns:
      'id, student_id, fee_record_id, amount, currency, payment_method, status, receipt_number, submission_reference, created_at',
    /*
      Verified only. A pending payment is a claim somebody has made and not yet
      checked, and an accounting system that imports claims as receipts will
      reconcile to the wrong number.
    */
    filters: (q) => q.eq('status', 'verified'),
    orderBy: 'created_at',
  },
  attendance: {
    scope: 'attendance:read',
    table: 'attendance_records',
    columns: 'id, student_id, attendance_date, status, class_id',
    orderBy: 'attendance_date',
  },
  results: {
    scope: 'results:read',
    table: 'exam_results',
    columns:
      'id, student_id, academic_year, term_number, subject_code, subject_name, marks_obtained, marks_total, grade_letter, published_at',
    // Published only — the same rule a parent and a pupil get, for the same reason.
    filters: (q) => q.eq('results_published', true),
    orderBy: 'academic_year',
  },
}

function problem(status: number, error: string, code: string): NextResponse {
  return NextResponse.json({ error, code }, { status })
}

export async function GET(
  request: Request,
  context: { params: Promise<{ resource: string[] }> },
): Promise<Response> {
  const { resource } = await context.params
  const name = resource?.[0] ?? ''

  const ctx: ApiKeyContext | null = await authenticateApiKey(request)

  if (!ctx) {
    /*
      One answer for a missing key, a malformed key, a revoked key, an expired key and a
      key belonging to a suspended school. Distinguishing them would confirm which keys
      are real, which is the first thing somebody probing would want to know.
    */
    return problem(
      401,
      'Provide a valid API key as `Authorization: Bearer zsms_live_…`.',
      // ERROR_CODES.md's code for this, and it stays one answer for every cause.
      'API_KEY_INVALID',
    )
  }

  /*
    The key's own ceiling, which `0241` stores and nothing enforced until now.

    Checked AFTER authentication because the limit belongs to the key, and BEFORE the
    resource lookup because a caller over their limit should be refused the cheapest
    possible way — and because refusing with 429 before 404 stops the limit being used
    to probe which resources exist.
  */
  const rate = await checkApiKeyRate(ctx)
  if (!rate.allowed) {
    await recordApiKeyUsage(ctx, request, 429)
    return NextResponse.json(
      {
        error: `This key is limited to ${rate.limit} requests a minute. Wait and retry.`,
        code: 'RATE_LIMITED',
      },
      {
        status: 429,
        headers: {
          'Retry-After': '60',
          'X-RateLimit-Limit': String(rate.limit),
        },
      },
    )
  }

  const spec = RESOURCES[name]
  if (!spec) {
    await recordApiKeyUsage(ctx, request, 404)
    return problem(
      404,
      `Unknown resource. Available: ${Object.keys(RESOURCES).join(', ')}.`,
      'NOT_FOUND',
    )
  }

  if (!ctx.scopes.includes(spec.scope)) {
    // Recorded with the scope, so a school can see exactly what their key was refused.
    await recordApiKeyUsage(ctx, request, 403, spec.scope)
    /*
      `INSUFFICIENT_SCOPE`, not `FORBIDDEN`. ERROR_CODES.md defines it precisely for
      this case, and the distinction is actionable: FORBIDDEN tells an integrator to
      ask their school for access, INSUFFICIENT_SCOPE tells them which scope to ask for.
    */
    return problem(
      403,
      `This key does not carry the \`${spec.scope}\` scope.`,
      'INSUFFICIENT_SCOPE',
    )
  }

  const url = new URL(request.url)
  const rawLimit = Number(url.searchParams.get('limit') ?? '100')
  // Clamped, not refused — and capped, because an unbounded read of a 2,000-pupil
  // school is a slow query for every other tenant on the same database.
  const limit = Number.isFinite(rawLimit)
    ? Math.min(500, Math.max(1, Math.trunc(rawLimit)))
    : 100
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? '0') || 0)

  try {
    /*
      `apiKeyQuery` applies `school_id = ctx.schoolId` before anything else. The service
      role bypasses RLS, so that filter IS the tenant boundary here — which is why it
      lives in shared code rather than being written out per resource.
    */
    let query = apiKeyQuery(ctx, spec.table)
    if (spec.filters) query = spec.filters(query)

    const { data, error } = await query
      .select(spec.columns)
      .order(spec.orderBy ?? 'created_at')
      .range(offset, offset + limit - 1)

    if (error) {
      await recordApiKeyUsage(ctx, request, 500, spec.scope)
      return problem(500, 'The request could not be completed.', 'SERVER_ERROR')
    }

    await recordApiKeyUsage(ctx, request, 200, spec.scope)

    return NextResponse.json({
      data: data ?? [],
      meta: {
        resource: name,
        count: data?.length ?? 0,
        limit,
        offset,
        // So a caller can page without guessing whether there is more.
        hasMore: (data?.length ?? 0) === limit,
      },
    })
  } catch {
    await recordApiKeyUsage(ctx, request, 500, spec.scope)
    return problem(500, 'The request could not be completed.', 'SERVER_ERROR')
  }
}
