/**
 * Shared TypeScript types.
 *
 * `database.ts` is GENERATED — never hand-edit it.
 * Regenerate after every migration:
 *   npm run db:types
 * CONVENTIONS.md prohibition 3: database types are never manually defined.
 */

export type ApiSuccess<T> = {
  data: T
  meta?: { total: number; page: number; perPage: number }
}

/** CONVENTIONS.md fixes this vocabulary — do not extend without an ADR. */
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'SERVER_ERROR'

export type ApiError = {
  error: string
  code: ApiErrorCode
  details?: Record<string, string>
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError

export function isApiError<T>(r: ApiResponse<T>): r is ApiError {
  return 'error' in r
}
