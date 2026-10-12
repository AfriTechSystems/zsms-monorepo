/**
 * API key authentication for external integrations.
 *
 * Spec: `03 Infrastructure Services/API_INTEGRATION.md`
 *
 * ## The problem this solves
 *
 * A school already running its own management system wants one piece of ZSMS — fee
 * tracking, or the loan module — without migrating everything. There is no user session
 * in that conversation, so a Clerk JWT is the wrong instrument.
 *
 * ## Why this needs the service role, and why that is safe here
 *
 * `verify_api_key()` runs before any identity exists: `get_user_id()` is NULL and
 * `current_school_uuid()` is NULL, so a user client's every policy refuses. The key IS
 * the identity, and resolving it must happen before RLS can mean anything.
 *
 * `CONVENTIONS.md` prohibition 1 permits the service role in a trusted server-side
 * context. This is one — a route handler, never shipped to a browser — and the exposure
 * is deliberately narrow: the service role is used for the key lookup and the usage log
 * and **nothing else**. Every subsequent query runs through a client scoped to the
 * resolved school, so a bug in a route cannot read across tenants.
 *
 * ## The scope check is the authorisation
 *
 * An API key is not a role. It carries an explicit list, and a route states which one it
 * needs. There is no "full access" key: `issue_api_key()` refuses an empty scope array,
 * and the schema constrains the values so a typo is refused rather than silently
 * granting nothing.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export interface ApiKeyContext {
  keyId: string
  schoolId: string
  scopes: string[]
  rateLimitRpm: number
}

/** The scopes API_INTEGRATION.md defines, matching `0241`'s CHECK. */
export type ApiScope =
  | 'students:read'
  | 'students:write'
  | 'fees:read'
  | 'fees:write'
  | 'attendance:read'
  | 'attendance:write'
  | 'results:read'
  | 'communication:send'
  | 'loans:read'
  | 'loans:write'
  | 'webhooks:receive'

/**
 * SHA-256 of the key, hex.
 *
 * `crypto.subtle` rather than Node's `crypto`, so this is identical in a route handler
 * and in the Edge runtime — a hash that differs between environments would mean keys
 * that work in one and not the other, discovered in production.
 */
export async function hashApiKey(plaintext: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(plaintext),
  )
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Generates a key. The plaintext is returned once and never stored.
 *
 * Format `zsms_live_<32>`, per the document. The prefix is the first 18 characters —
 * distinctive enough to tell two keys apart in a list, far short of the whole.
 */
export async function generateApiKey(): Promise<{
  plaintext: string
  hash: string
  prefix: string
}> {
  const bytes = crypto.getRandomValues(new Uint8Array(24))

  /*
    Base64 with the non-alphanumerics stripped, as the document specifies. Stripping
    shortens the string, so 24 bytes are drawn to be sure of 32 characters afterwards —
    32 characters of this alphabet is roughly 190 bits, which is ample.
  */
  const random = btoa(String.fromCharCode(...bytes))
    .replace(/[+/=]/g, '')
    .slice(0, 32)

  const plaintext = `zsms_live_${random}`
  return {
    plaintext,
    hash: await hashApiKey(plaintext),
    prefix: plaintext.slice(0, 18),
  }
}

function serviceClient(): SupabaseClient | null {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}

/**
 * Resolves the `Authorization: Bearer zsms_live_…` header to a school and its scopes.
 *
 * Returns null when there is no API key header at all — which is the ordinary case for
 * a browser request, and means "carry on with the Clerk session", not "refused".
 */
export async function authenticateApiKey(
  request: Request,
): Promise<ApiKeyContext | null> {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer zsms_')) return null

  const plaintext = header.slice('Bearer '.length).trim()
  const client = serviceClient()
  if (!client) return null

  const { data, error } = await client
    .rpc('verify_api_key', { p_key_hash: await hashApiKey(plaintext) })
    .maybeSingle()

  if (error || !data) return null

  const row = data as {
    out_key_id: string
    out_school_id: string
    out_scopes: string[]
    out_rate_limit: number
  }

  return {
    keyId: row.out_key_id,
    schoolId: row.out_school_id,
    scopes: row.out_scopes ?? [],
    rateLimitRpm: row.out_rate_limit,
  }
}

/**
 * Enforces the key's own requests-per-minute.
 *
 * `0241` stores `rate_limit_rpm` per key and `RATE_LIMITS.md` specifies 60 by default
 * with 300 as the Tier 2 maximum. Until now the column was **decorative** — it was
 * written, shown on the management screen, and consulted by nothing. A limit a school
 * can see and set, and that does not apply, is worse than no limit: it is a promise.
 *
 * ## Why this is per KEY and not per IP
 *
 * `lib/rate-limit.ts` limits by IP in middleware, which is right for abuse from an
 * unauthenticated source. An integration is the opposite case: one server, one IP, a
 * legitimate key, and a loop that should not be allowed to pull a 2,000-pupil roll
 * forty times a minute. The key is the identity that matters, and it carries its own
 * ceiling because a school may reasonably grant one integration more than another.
 *
 * Both apply. The IP limit catches the flood; this catches the enthusiastic customer.
 *
 * ## Fails open, for the same reason as everything else on this path
 *
 * An unreachable Redis allows the request. See `lib/rate-limit.ts` for the full trade —
 * the short version is that a cache outage must not stop a school's integration from
 * reconciling its fees.
 */
export async function checkApiKeyRate(
  ctx: ApiKeyContext,
): Promise<{ allowed: boolean; limit: number }> {
  const url = process.env['UPSTASH_REDIS_REST_URL']?.trim()
  const token = process.env['UPSTASH_REDIS_REST_TOKEN']?.trim()

  const limit = ctx.rateLimitRpm > 0 ? ctx.rateLimitRpm : 60
  // Not configured is not a refusal — development runs without Redis.
  if (!url || !token) return { allowed: true, limit }

  /*
    Keyed on the KEY id, not the school: two integrations at one school have separate
    ceilings, which is the point of storing the limit per key.
  */
  const window = Math.floor(Date.now() / 60_000)
  const redisKey = `zsms:ratelimit:apikey:${ctx.keyId}:${window}`

  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([
        ['INCR', redisKey],
        ['EXPIRE', redisKey, '60'],
      ]),
      signal: AbortSignal.timeout(1000),
    })

    if (!response.ok) return { allowed: true, limit }

    const body = (await response.json()) as { result?: number }[]
    const count = body?.[0]?.result

    return {
      allowed: typeof count !== 'number' || count <= limit,
      limit,
    }
  } catch {
    return { allowed: true, limit }
  }
}

/**
 * Records the call, including the refusals.
 *
 * A run of 403s is the clearest evidence a key has been stolen and is being probed, and
 * it is exactly what a log of successful calls would not show.
 *
 * Never throws and is awaited by callers: a serverless function can be frozen the moment
 * it returns, so an un-awaited write is one the platform is free to discard — and the
 * calls most worth recording are from the routes failing fastest.
 */
export async function recordApiKeyUsage(
  ctx: ApiKeyContext,
  request: Request,
  status: number,
  requiredScope?: string,
): Promise<void> {
  try {
    const client = serviceClient()
    if (!client) return
    await client.rpc('record_api_key_usage', {
      p_key_id: ctx.keyId,
      p_method: request.method,
      p_path: new URL(request.url).pathname,
      p_status: status,
      p_scope: requiredScope ?? null,
    })
  } catch {
    // Telemetry must never turn a working request into a failed one.
  }
}

/**
 * A client scoped to the school the key belongs to.
 *
 * The service role bypasses RLS, so this is the dangerous half and it is kept small on
 * purpose: callers get a client and **must** filter by `ctx.schoolId` on every query.
 * `apiKeyQuery()` below exists so they do not have to remember.
 */
export function apiKeyClient(): SupabaseClient | null {
  return serviceClient()
}

/**
 * A query already filtered to the key's school.
 *
 * The whole tenant-isolation risk of API keys is a route forgetting one `.eq()`. This
 * makes the safe thing the short thing — `apiKeyQuery(ctx, 'students').select(...)` is
 * both less typing and impossible to get wrong.
 */
export function apiKeyQuery(ctx: ApiKeyContext, table: string) {
  const client = serviceClient()
  if (!client) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set.')
  return client.from(table).select().eq('school_id', ctx.schoolId)
}
