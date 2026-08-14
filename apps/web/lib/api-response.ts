/**
 * API response envelopes.
 *
 * Spec: `Official Documentation/05 Core Database and API Reference/ENDPOINTS.md`
 *       `Official Documentation/05 Core Database and API Reference/ERROR_CODES.md`
 *
 * Success: { data, meta? }        Error: { error, code, details? }
 */

import { NextResponse } from 'next/server'
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
    case 'PGRST116':
      return fail('NOT_FOUND', 'Record not found.')
    default:
      // Never surface the raw driver message: it can carry column names,
      // constraint definitions, and row values from other tenants.
      console.error('[api] unhandled postgrest error', error.code, error.message)
      return fail('SERVER_ERROR', 'An unexpected error occurred.')
  }
}

/** Wraps a handler so an unexpected throw becomes a clean 500, never a stack trace. */
export async function guard(handler: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await handler()
  } catch (err) {
    console.error('[api] unhandled exception', err)
    return fail('SERVER_ERROR', 'An unexpected error occurred.')
  }
}
