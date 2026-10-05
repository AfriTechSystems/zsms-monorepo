/**
 * `schoolHasFeature()` — the wrapper the documents have always named.
 *
 * Spec: `Official Documentation/01 Foundation Layer/ARCHITECTURE.md`,
 *       `Official Documentation/01 Foundation Layer/DYNAMIC_CONFIG.md`, ADR-014
 *
 * ## Why this did not exist until now
 *
 * `public.school_has_feature()` has been in the database since `0095`, and
 * `ARCHITECTURE.md` has named a `schoolHasFeature()` wrapper for longer than that. It
 * was never written, and the consequence was not a missing convenience: **nothing in the
 * product gated on any of the 18 feature flags.** The three places that called the
 * resolver all did so to DISPLAY what a school has. A flag could be off and the feature
 * still worked.
 *
 * That makes this the prerequisite for every toggle-shaped thing: the AI assistant's
 * three flags, the loan module, and the payment gateways. Without it a toggle is
 * decoration.
 *
 * ## The cache, and why one TTL rather than two
 *
 * ADR-014 specifies a Redis cache with "5-min TTL for overrides, 60-min for tier
 * features". Those are two TTLs over two layers of one answer — and the answer is
 * resolved as a whole, so caching it as a whole needs the SHORTER window. A 60-minute
 * entry would leave a revoked feature working for an hour after AfriTech revoked it,
 * which is the exact situation an override exists to handle quickly.
 *
 * So: one entry per school, five minutes. The 60-minute figure is only reachable by
 * caching the tier matrix separately from the overrides, which would mean two round
 * trips to save one, and a second place for the resolution order to be assembled.
 *
 * ## Upstash over HTTP, not ioredis
 *
 * `CONVENTIONS.md` confines `bullmq` and `ioredis` to `packages/queue`. The Upstash REST
 * API is neither — it is a GET and a POST with a bearer token, so it is called with
 * `fetch` and adds no dependency at all.
 *
 * ## Failing open vs failing closed
 *
 * **A cache failure fails OPEN to the database**, never to a guess: an unreachable Redis
 * must not change what a school can do. A DATABASE failure fails CLOSED — if the
 * resolver cannot be reached, the feature is treated as absent, because granting access
 * on the strength of an error is how a school ends up using something it has not bought.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** Five minutes, per the reasoning above. */
const TTL_SECONDS = 300

/**
 * Per-request memo.
 *
 * A single route can ask about several features — the assistant checks `ai_assistant`
 * and then `ai_assistant_write` — and in a serverless invocation this map lives for that
 * invocation only. It saves the second Redis round trip without introducing a staleness
 * window longer than one request.
 */
const inFlight = new Map<string, Promise<Record<string, boolean>>>()

function upstash(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim()
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (!url || !token) return null
  return { url: url.replace(/\/$/, ''), token }
}

async function cacheGet(key: string): Promise<Record<string, boolean> | null> {
  const cfg = upstash()
  if (!cfg) return null

  try {
    const res = await fetch(`${cfg.url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${cfg.token}` },
      // Next would otherwise cache this fetch itself, which would cache the cache.
      cache: 'no-store',
    })
    if (!res.ok) return null

    const body = (await res.json()) as { result?: string | null }
    if (!body.result) return null

    return JSON.parse(body.result) as Record<string, boolean>
  } catch {
    // Fails open to the database. An unreachable cache must not change what a school
    // can do.
    return null
  }
}

async function cacheSet(key: string, value: Record<string, boolean>): Promise<void> {
  const cfg = upstash()
  if (!cfg) return

  try {
    await fetch(`${cfg.url}/set/${encodeURIComponent(key)}?EX=${TTL_SECONDS}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(value),
      cache: 'no-store',
    })
  } catch {
    // A write failure is not worth failing a request over; the next call resolves
    // from the database again.
  }
}

/**
 * Every feature resolved for one school.
 *
 * `schoolId` is optional and only meaningful for AfriTech — `school_feature_resolution()`
 * ignores it for anybody else and resolves from the session, so a caller cannot read
 * another school's entitlements by passing an id.
 */
export async function schoolFeatures(
  client: SupabaseClient,
  schoolId?: string | null,
): Promise<Record<string, boolean>> {
  const key = `zsms:features:${schoolId ?? 'session'}`

  const pending = inFlight.get(key)
  if (pending) return pending

  const work = (async (): Promise<Record<string, boolean>> => {
    const cached = await cacheGet(key)
    if (cached) return cached

    const { data, error } = await client.rpc('school_feature_resolution', {
      p_school_id: schoolId ?? null,
    })

    if (error) {
      /*
        Fails CLOSED. Every feature absent.

        Granting access because the resolver could not be reached is how a school ends
        up using something it has not bought, and the caller cannot tell the difference
        between "not entitled" and "could not ask" — which is why this is logged.
      */
      console.error('[features] could not resolve features', error)
      return {}
    }

    const rows = (data ?? []) as Array<{ out_feature_key: string; out_included: boolean }>
    const map: Record<string, boolean> = {}
    for (const r of rows) map[r.out_feature_key] = r.out_included

    // Not awaited: the answer is already known, and a slow cache write should not
    // delay the response.
    void cacheSet(key, map)
    return map
  })()

  inFlight.set(key, work)
  try {
    return await work
  } finally {
    inFlight.delete(key)
  }
}

/**
 * Whether one feature is available to this caller's school.
 *
 * ```ts
 * if (!(await schoolHasFeature(client, 'ai_assistant'))) {
 *   return fail('FORBIDDEN', 'Your school does not include the AI assistant.')
 * }
 * ```
 *
 * **This is a product gate, not a security boundary.** It decides whether a feature is
 * sold to this school; it does not decide whether this user may see a given row. RLS
 * does that, and a route that relied on this for tenant isolation would be bypassable by
 * calling PostgREST directly.
 */
export async function schoolHasFeature(
  client: SupabaseClient,
  featureKey: string,
  schoolId?: string | null,
): Promise<boolean> {
  const map = await schoolFeatures(client, schoolId)
  /*
    Absent means NO.

    A feature with no row for a tier is "not sold with this tier", never "unspecified,
    allow it" — the same rule `0095` applies in the database, restated here because a
    `?? true` would quietly invert it.
  */
  return map[featureKey] === true
}

/**
 * Drops a school's cached entitlements.
 *
 * Called after AfriTech changes an override or a tier, so the change is visible
 * immediately rather than in up to five minutes. Without this the admin screen would
 * save a revocation and the school would keep working for the rest of the window, which
 * reads as the save having failed.
 */
export async function forgetSchoolFeatures(schoolId?: string | null): Promise<void> {
  const cfg = upstash()
  const key = `zsms:features:${schoolId ?? 'session'}`
  inFlight.delete(key)
  if (!cfg) return

  try {
    await fetch(`${cfg.url}/del/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}` },
      cache: 'no-store',
    })
  } catch {
    // The entry expires on its own in five minutes.
  }
}
