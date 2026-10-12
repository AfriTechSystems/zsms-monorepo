/**
 * HTTP rate limiting, on Upstash Redis.
 *
 * Spec: `05 Core Database and API Reference/RATE_LIMITS.md`,
 *       `03 Infrastructure Services/CACHING_CDN.md`
 *
 * ## What was there before
 *
 * Nothing. `CLAUDE.md` said API routes were "rate-limited via Upstash Redis" and one
 * route had anything at all. `ai_assistant_quota()` and `consume_message_quota()` are
 * real and enforced, but those are DOMAIN quotas — "how many AI questions today",
 * "how many messages this month". They are billing limits, not abuse protection, and
 * neither of them notices somebody sending ten thousand requests in a minute.
 *
 * ## Why this is middleware and not `guard()`
 *
 * `guard()` takes a handler with no access to the request, so it cannot see an IP or a
 * path. Threading one through every route would mean 120 edits and a 121st route that
 * forgets — and the route that forgets is the one that gets hammered.
 *
 * Middleware sees every request before any route does, including routes written later.
 *
 * ## Fails OPEN, deliberately
 *
 * If Redis is unreachable the request is allowed. A rate limiter that fails closed turns
 * a cache outage into a total outage, and ZSMS is a school's attendance register on a
 * Monday morning. `lib/features.ts` made the same call for the same reason.
 *
 * The honest consequence: a Redis outage is also an open window. That is the trade, and
 * it is the right way round — the alternative is being certain of downtime in order to
 * avoid being occasionally exposed.
 *
 * ## Fixed window, not sliding
 *
 * A fixed window lets a caller send up to 2× the limit across a boundary. A sliding
 * window is two or three Redis round-trips instead of one, on every request. For abuse
 * protection the cheaper one is right: the aim is to stop a flood, not to meter billing
 * precisely, and anything that needs precision is already a domain quota in the database.
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

interface Policy {
  /** Requests allowed per window. */
  limit: number
  /** Window length in seconds. */
  windowSeconds: number
  /** Used in the key and the log line, so a 429 can be traced to a rule. */
  name: string
}

/**
 * Policies, narrowest first — the first match wins.
 *
 * The figures come from `RATE_LIMITS.md`'s own categories rather than being invented
 * here: 10/min on enumeration, 5 on bulk, 10 on communication, 20 on financial, 200 for
 * AfriTech, 120 for everything else. Where this file shipped with three broad bands
 * yesterday, the document had seven, and its distinctions are the useful ones — a
 * broadcast and a dashboard read are not the same risk.
 *
 * They remain generous on purpose. A school office with thirty staff behind one NAT
 * address shares an IP, so a limit tight enough to stop a determined attacker would stop
 * a busy Monday morning first. These stop floods and scripted enumeration; a patient
 * attacker is what the database's own rules are for.
 */
const POLICIES: { test: (path: string) => boolean; policy: Policy }[] = [
  {
    /*
      Enumeration, at RATE_LIMITS.md's strictest documented figure.

      `/api/teacher/school-link` takes a school CODE and deliberately answers the same
      way for an unknown code as for a real one — which defeats enumeration one guess at
      a time and does nothing about ten thousand guesses a minute. This is the other half
      of that defence, and the document's 10/min for student lookup is the right shape
      for all of it.
    */
    test: (p) =>
      p.startsWith('/api/register') ||
      p.startsWith('/api/school/join-requests') ||
      p.startsWith('/api/teacher/school-link') ||
      p.startsWith('/api/parent/claims') ||
      p.includes('/lookup'),
    policy: { limit: 10, windowSeconds: 60, name: 'enumeration' },
  },
  {
    // "Bulk operations (import, generate reports) — 5 per minute. Heavy operations,
    // one at a time per school."
    test: (p) =>
      p.includes('/import') ||
      p.includes('/export') ||
      p.startsWith('/api/admin/curriculum/extract') ||
      p.includes('/report-cards'),
    policy: { limit: 5, windowSeconds: 60, name: 'bulk' },
  },
  {
    // "Communication sends (broadcast messages) — 10 per minute. Prevents accidental
    // mass messaging." The one where the cost of a mistake is measured in a school's
    // message quota and a parent's patience.
    test: (p) =>
      p.startsWith('/api/announcements') ||
      p.startsWith('/api/messages') ||
      p.startsWith('/api/school/announcements'),
    policy: { limit: 10, windowSeconds: 60, name: 'communication' },
  },
  {
    /*
      "Financial writes — 20 per minute. Prevents accidental duplicate submissions."

      Path-based rather than method-based, because middleware would have to read the
      method and a GET to `/api/payments` is as cheap as any other read. Erring strict
      on the whole financial surface is the safer direction: 20 a minute is still far
      more than an accountant can type.
    */
    test: (p) =>
      p.startsWith('/api/payments') ||
      p.startsWith('/api/fees') ||
      p.startsWith('/api/school/fees'),
    policy: { limit: 20, windowSeconds: 60, name: 'financial' },
  },
  {
    // Anything that costs money or CPU per call: a model, a PDF, a document.
    test: (p) =>
      p.startsWith('/api/assistant') ||
      p.startsWith('/api/teacher/hub/resources') ||
      p.startsWith('/api/documents'),
    policy: { limit: 30, windowSeconds: 60, name: 'expensive' },
  },
  {
    /*
      "AfriTech admin routes — 200 per minute. Internal team needs higher throughput."

      Higher than a school's, which looks backwards until you consider what an admin
      screen does: `/admin/schools` resolves a feature matrix per school, and a support
      agent moving between twenty schools in a minute is working, not attacking.
    */
    test: (p) => p.startsWith('/api/admin/'),
    policy: { limit: 200, windowSeconds: 60, name: 'admin' },
  },
  {
    /*
      "General dashboard reads — 120 per minute. Typical interactive use, comfortable
      headroom."

      Lower than the 300 this file shipped with yesterday, and closer to the document.
      A school office with thirty staff behind one NAT address is the case that argues
      for generosity — but a dashboard makes a handful of calls per screen, so 120 is
      two screens a second from one address, which no human reaches.
    */
    test: (p) => p.startsWith('/api/'),
    policy: { limit: 120, windowSeconds: 60, name: 'api' },
  },
]

/**
 * Never limited.
 *
 * `/api/health` is what an uptime monitor polls. Rate-limiting the health check means
 * the monitor reports an outage caused by the monitor, which is a genuinely maddening
 * hour to spend.
 */
const EXEMPT = ['/api/health']

function policyFor(pathname: string): Policy | null {
  if (EXEMPT.some((e) => pathname.startsWith(e))) return null
  return POLICIES.find((p) => p.test(pathname))?.policy ?? null
}

/**
 * Who is being limited.
 *
 * The IP, because middleware runs before authentication and there is no user id yet.
 * That is also the right unit: the abuse this protects against is unauthenticated, and
 * somebody attacking the registration endpoint has no account by definition.
 *
 * Behind Cloudflare, `cf-connecting-ip` is the only trustworthy one —
 * `x-forwarded-for` can be set by the caller. Preferring it also means the limiter
 * starts working correctly the moment the proxy is in front, with no code change.
 */
function callerKey(request: NextRequest): string {
  const cf = request.headers.get('cf-connecting-ip')
  if (cf) return cf

  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]!.trim()

  return request.headers.get('x-real-ip') ?? 'unknown'
}

interface Upstash {
  url: string
  token: string
}

function upstash(): Upstash | null {
  const url = process.env['UPSTASH_REDIS_REST_URL']?.trim()
  const token = process.env['UPSTASH_REDIS_REST_TOKEN']?.trim()
  if (!url || !token) return null
  return { url: url.replace(/\/$/, ''), token }
}

/**
 * Counts this request and says whether it is over the line.
 *
 * One round-trip: Upstash's REST pipeline runs `INCR` and `EXPIRE` together. `EXPIRE`
 * is unconditional rather than `NX` — re-setting it on every hit inside a window costs
 * nothing and removes the case where a key created by a racing request never gets a TTL
 * and so blocks that caller forever.
 */
async function hit(
  cfg: Upstash,
  key: string,
  policy: Policy,
): Promise<{ count: number } | null> {
  try {
    const response = await fetch(`${cfg.url}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        ['INCR', key],
        ['EXPIRE', key, String(policy.windowSeconds)],
      ]),
      // A limiter that hangs is worse than one that is absent.
      signal: AbortSignal.timeout(1000),
    })

    if (!response.ok) return null

    const body = (await response.json()) as { result?: number }[]
    const count = body?.[0]?.result
    return typeof count === 'number' ? { count } : null
  } catch {
    // Unreachable, slow, or malformed: fail open. See the header.
    return null
  }
}

/**
 * Returns a 429 when the caller is over their limit, or null to continue.
 *
 * Called from `middleware.ts` before the auth middleware, so an unauthenticated flood
 * is stopped before it reaches Clerk's token verification — which is itself work worth
 * not doing for a request that is going to be refused.
 */
export async function rateLimitResponse(
  request: NextRequest,
): Promise<NextResponse | null> {
  const pathname = request.nextUrl.pathname

  const policy = policyFor(pathname)
  if (!policy) return null

  const cfg = upstash()
  // Not configured is not an error — development runs without Redis.
  if (!cfg) return null

  /*
    `ratelimit:` is the namespace CACHING_CDN.md reserves for exactly this, and the
    window number is in the key so a new window is a new counter with no reset step.
  */
  const window = Math.floor(Date.now() / 1000 / policy.windowSeconds)
  const key = `zsms:ratelimit:${policy.name}:${callerKey(request)}:${window}`

  const result = await hit(cfg, key, policy)
  if (!result || result.count <= policy.limit) return null

  const retryAfter = policy.windowSeconds

  /*
    The ZSMS error envelope, not a bare 429 body. Every other failure a client sees
    from this API is `{ error, code }`, and a route that breaks that shape under load is
    the one whose error handling has never been tested.
  */
  return NextResponse.json(
    {
      error:
        'Too many requests. Wait about a minute and try again — this limit protects the service for everybody.',
      code: 'RATE_LIMITED',
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfter),
        'X-RateLimit-Limit': String(policy.limit),
        'X-RateLimit-Policy': policy.name,
      },
    },
  )
}
