/**
 * API response envelopes.
 *
 * Spec: `Official Documentation/05 Core Database and API Reference/ENDPOINTS.md`
 *       `Official Documentation/05 Core Database and API Reference/ERROR_CODES.md`
 *
 * Success: { data, meta? }        Error: { error, code, details? }
 */

import { NextResponse } from 'next/server'
import { reportRouteError, routeFromStack } from './report-error'
import { ZodError } from 'zod'

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'SERVER_ERROR'

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  SERVER_ERROR: 500,
}

export interface Meta {
  page?: number
  perPage?: number
  total?: number
  /**
   * The resolved student ceiling, on list routes where it governs what the
   * caller may do next.
   *
   * It rides in `meta` rather than in `data` because it is not part of the
   * collection — it describes the collection's limit. Returning it with the
   * list rather than from a second endpoint matters: a students screen that
   * fetched the roll and the ceiling separately would render "142 pupils" and
   * "of 140" from two different instants, and the disagreement would appear
   * exactly when the school is at the boundary and someone is watching.
   */
  capacity?: {
    student_limit: number | null
    is_unlimited: boolean
    source: string
    current_count: number
    remaining: number | null
    at_capacity: boolean
  } | null
}

export function ok<T>(data: T, meta?: Meta): NextResponse {
  return NextResponse.json(meta ? { data, meta } : { data }, { status: 200 })
}

export function created<T>(data: T): NextResponse {
  return NextResponse.json({ data }, { status: 201 })
}

export function fail(code: ErrorCode, message: string, details?: unknown): NextResponse {
  return NextResponse.json(
    details === undefined ? { error: message, code } : { error: message, code, details },
    { status: STATUS_BY_CODE[code] },
  )
}

export function validationFailed(error: ZodError): NextResponse {
  return fail(
    'VALIDATION_ERROR',
    'Request body failed validation.',
    error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  )
}

/**
 * Maps a PostgREST error to an API error.
 *
 * RLS denial is the case that matters. A SELECT blocked by policy returns zero
 * rows rather than an error — it is indistinguishable from "no such row", and
 * that is deliberate: replying 403 would confirm the record exists at another
 * school, which is itself a cross-tenant disclosure. Blocked writes DO raise
 * 42501, which maps to FORBIDDEN.
 */
export function fromPostgrestError(error: { code?: string; message: string }): NextResponse {
  switch (error.code) {
    case '42501':
      return fail('FORBIDDEN', 'You do not have permission to perform this action.')
    case '23505':
      return fail('CONFLICT', 'A record with these details already exists.')
    case '23503':
      return fail('VALIDATION_ERROR', 'A referenced record does not exist.')
    case '23514':
      return fail('VALIDATION_ERROR', 'A field value is outside its permitted set.')
    case 'P0002':
      // `no_data_found`, raised by the admin_* functions when the row they were
      // asked to change is not there or is already in the target state — most
      // often an override revoked in another tab. Reporting that as a server
      // fault sends an operator looking for a bug behind a screen that is
      // merely stale.
      return fail('NOT_FOUND', 'That record no longer exists, or has already been changed. Reload and try again.')
    case 'ZS001':
      // The student ceiling (migration 0101). The exception message is raised by
      // `enforce_student_limit()` and is written for the person trying to enrol
      // a pupil — it names the resolved limit and the two ways out. This is the
      // one place a driver message is passed through, and it is safe because the
      // text is ours and contains a configured ceiling, not row data.
      //
      // CONFLICT rather than FORBIDDEN: the caller has every right to enrol
      // students, and nothing about their permissions would change the outcome.
      // The school's state is what refuses it.
      return fail('CONFLICT', error.message)
    case 'ZS002':
      // The school lifecycle (migration 0149). Raised when a school that is trial_expired,
      // suspended or terminated tries to write anything. The message names the status and says
      // reading still works, which is the difference between "your account has a problem" and
      // "your data is gone" — and for a school mid-term that distinction is the whole message.
      //
      // CONFLICT, for the same reason as ZS001: nothing about the caller's permissions would
      // change the outcome. It is the school's standing that refuses, not their role.
      return fail('CONFLICT', error.message)
    case 'ZS003':
      // An unverified school trying to enrol a pupil (migration 0153). The message names what they
      // CAN do meanwhile, which is the difference between a blocked screen and a next step.
      return fail('CONFLICT', error.message)
    case 'PGRST116':
      return fail('NOT_FOUND', 'Record not found.')
    case 'PGRST301':
      return fail('UNAUTHORIZED', 'Your session has expired. Sign in again.')
    case 'PGRST303':
      // "JWT not yet valid" — the token's `nbf` is fractionally ahead of the
      // database server's clock. Clerk mints the token and Supabase validates
      // it, so a sub-second skew between two third-party clocks is enough, and
      // neither is ours to correct. It is genuinely transient: the same token
      // succeeds a moment later, which is exactly why it must not be reported
      // as SERVER_ERROR. That code renders as "an unexpected error occurred"
      // with no retry, sending an operator to look for a fault that is already
      // gone.
      console.warn('[api] clock skew between Clerk and Supabase (PGRST303)')
      return fail('CONFLICT', 'The session token is a moment ahead of the server clock. Try again.')
    default:
      // Never surface the raw driver message: it can carry column names,
      // constraint definitions, and row values from other tenants.
      console.error('[api] unhandled postgrest error', error.code, error.message)
      return fail('SERVER_ERROR', 'An unexpected error occurred.')
  }
}

/**
 * Wraps a handler so an unexpected throw becomes a clean 500, never a stack trace.
 *
 * Generic over the success type rather than fixed to `NextResponse`, because the job this does —
 * catching a throw and answering with a safe error — has nothing to do with the response format. A
 * route returning a PDF or a `.docx` needs exactly the same protection, and the alternative was a
 * second near-identical `guardBinary()` that would drift from this one.
 *
 * Existing callers are unaffected: a handler returning `NextResponse` still yields `NextResponse`.
 */
export async function guard<T extends Response>(
  handler: () => Promise<T>,
): Promise<T | NextResponse> {
  try {
    return await handler()
  } catch (err) {
    console.error('[api] unhandled exception', err)

    /**
     * Reported to Sentry AND recorded as a platform incident — see `lib/report-error.ts` for why those
     * are two different questions and why one without the other is not much use.
     *
     * Awaited rather than fired and forgotten. A serverless function can be frozen the moment it
     * returns a response, so an un-awaited report is one the platform is free to discard — and the
     * reports that would be lost are exactly the ones from the routes failing fastest.
     *
     * `reportRouteError` never throws, by construction. An exception raised while reporting an
     * exception would replace a useful 500 with a useless one and lose the original.
     */
    await reportRouteError(err, routeFromStack(err))

    return fail('SERVER_ERROR', 'An unexpected error occurred.')
  }
}
