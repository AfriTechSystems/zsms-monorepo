/**
 * Talking to the ZSMS API from the phone.
 *
 * Spec: `Official Documentation/05 Core Database and API Reference/ENDPOINTS.md`
 *
 * ## The same routes the web uses, deliberately
 *
 * There is no mobile backend. The phone calls the identical Next.js routes, which means
 * one set of permission checks, one envelope, and one place a rule changes. `ENDPOINTS.md`
 * names several routes as the contract for exactly this reason — they looked unused during
 * the gap audit precisely because mobile did not exist yet.
 *
 * ## Online only, and the shape leaves room for not being
 *
 * ADR-004 commits to offline-first attendance through PowerSync, which is a paid service
 * with no credentials yet. So this is a plain fetch — but every call goes through one
 * function, so the queue-and-sync layer lands here rather than in thirty screens.
 *
 * What that costs today is stated rather than hidden: a teacher with no signal cannot mark
 * a register, and the screen says so instead of appearing to save.
 */

import Constants from 'expo-constants'

/**
 * Where the API lives.
 *
 * `EXPO_PUBLIC_API_URL` in development points at the machine running `npm run dev` — a
 * LAN address, never `localhost`, because on a phone `localhost` is the phone. `npm run
 * dev` prints the address to use.
 */
/*
  An EMPTY value is a missing value.

  `??` only catches null and undefined, and the CI build writes
  `EXPO_PUBLIC_API_URL=` into `.env` whenever the repository variable is unset — so
  the empty string won, and `BASE_URL` became `''`. Every request then went to a
  relative path with no host, which on a phone fails in a way that reads as "the
  server is down" rather than "this build was never told where the server is".

  Trimmed too, because a trailing space in a CI variable is invisible in the UI and
  produces a URL that looks correct in a log and resolves to nothing.
*/
const configured = [
  Constants.expoConfig?.extra?.['apiUrl'] as string | undefined,
  process.env['EXPO_PUBLIC_API_URL'],
]
  .map((v) => v?.trim())
  .find((v) => Boolean(v))

const BASE_URL = configured ?? 'http://localhost:3000'

export interface ApiResult<T> {
  data: T | null
  error: string | null
  code: string | null
}

/** Matches the web envelope exactly: `{ data, meta? }` or `{ error, code, details? }`. */
interface Envelope<T> {
  data?: T
  error?: string
  code?: string
}

export type TokenGetter = () => Promise<string | null>

/**
 * One call.
 *
 * The token is passed in rather than read from a module-level store: Clerk's hook owns the
 * session, and a cached copy here would be the thing still holding a token a minute after
 * the user signed out.
 */
export async function apiCall<T>(
  path: string,
  getToken: TokenGetter,
  init: RequestInit = {},
): Promise<ApiResult<T>> {
  let token: string | null = null
  try {
    token = await getToken()
  } catch {
    // A token that cannot be minted is a signed-out session, not a network fault.
    return { data: null, error: 'Your session has expired. Sign in again.', code: 'UNAUTHORIZED' }
  }

  if (!token) {
    return { data: null, error: 'Your session has expired. Sign in again.', code: 'UNAUTHORIZED' }
  }

  let response: Response
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        /*
          JSON unless the body is FormData.

          A multipart body must set its OWN Content-Type, because the header has to
          carry the boundary string the runtime generated. Forcing
          `application/json` here made every upload arrive as unparseable — and
          spreading `init.headers` over it does not help, since there is no value that
          REMOVES a header.
        */
        ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(init.headers ?? {}),
      },
    })
  } catch {
    /*
      No signal, or the server is unreachable.

      Named as a connection problem rather than a server error, because on a Zambian
      school network it almost always is one — and "something went wrong" sends a
      teacher looking for a fault in the app instead of walking to the window.
    */
    return {
      data: null,
      error: 'No connection. Check your signal and try again.',
      code: 'OFFLINE',
    }
  }

  let body: Envelope<T> | null = null
  try {
    body = (await response.json()) as Envelope<T>
  } catch {
    body = null
  }

  if (!response.ok) {
    return {
      data: null,
      error: body?.error ?? 'That did not work.',
      code: body?.code ?? 'SERVER_ERROR',
    }
  }

  return { data: (body?.data ?? null) as T | null, error: null, code: null }
}

export const api = {
  get: <T>(path: string, getToken: TokenGetter) => apiCall<T>(path, getToken),
  post: <T>(path: string, getToken: TokenGetter, body: unknown) =>
    apiCall<T>(path, getToken, { method: 'POST', body: JSON.stringify(body) }),
  /**
   * A multipart POST, for a file.
   *
   * Separate from `post` so the body is passed through untouched — `JSON.stringify` on
   * a FormData produces `{}`, which uploads nothing and reports success.
   */
  postForm: <T>(path: string, getToken: TokenGetter, body: FormData) =>
    apiCall<T>(path, getToken, { method: 'POST', body }),
  patch: <T>(path: string, getToken: TokenGetter, body: unknown) =>
    apiCall<T>(path, getToken, { method: 'PATCH', body: JSON.stringify(body) }),
  /*
    DELETE carries a body here, which is unusual but deliberate.

    Retiring a push token names WHICH token to forget, and a token is a capability to
    reach somebody's phone — in a query string it would land in every access log
    between here and the server. The body keeps it out of them.
  */
  delete: <T>(path: string, getToken: TokenGetter, body: unknown) =>
    apiCall<T>(path, getToken, { method: 'DELETE', body: JSON.stringify(body) }),
}

export { BASE_URL }
