# RATE_LIMITS.md — Rate Limiting Reference

## Related Documents

- `docs/api/ENDPOINTS.md` — endpoints subject to rate limiting
- `docs/api/ERROR_CODES.md` — RATE_LIMITED error code and response shape
- `docs/api/API_INTEGRATION.md` — API key rate limits by tier
- `docs/infra/META_API.md` — WhatsApp message quota system
- `docs/infra/QSTASH.md` — QStash-level rate limiting for bulk dispatch
- `docs/ENV.md` — Upstash Redis environment variables

---

## Purpose

This document defines all rate limiting rules across the ZSMS API layer. Rate limiting operates at multiple levels — per IP for public routes, per user session for authenticated routes, per API key for external integrations, and per school for WhatsApp messaging. Claude Code reads this before implementing any new endpoint to apply the correct rate limiting tier.

---

## Rate Limiting Implementation

ZSMS uses **Upstash Redis** for all rate limiting. Limits are enforced at the Next.js middleware level before any business logic runs. The `@upstash/ratelimit` library provides sliding window rate limiting.

```typescript
// apps/web/lib/rateLimit.ts
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

export const rateLimiters = {
  // Public routes — per IP
  public: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(30, '1 m'),
    prefix: 'rl:public',
  }),

  // Auth routes — stricter per IP
  auth: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, '1 m'),
    prefix: 'rl:auth',
  }),

  // Authenticated API routes — per user ID
  authenticated: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(120, '1 m'),
    prefix: 'rl:user',
  }),

  // Financial write routes — per user ID (stricter)
  financial: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(20, '1 m'),
    prefix: 'rl:financial',
  }),

  // Bulk operations — per school (not per user)
  bulk: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, '1 m'),
    prefix: 'rl:bulk',
  }),

  // External API keys — per key
  apiKey: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(60, '1 m'), // Default — overridden per key
    prefix: 'rl:apikey',
  }),
}

export async function checkRateLimit(
  limiter: Ratelimit,
  identifier: string
): Promise<{ success: boolean; retryAfter?: number }> {
  const { success, reset } = await limiter.limit(identifier)
  if (!success) {
    return { success: false, retryAfter: Math.ceil((reset - Date.now()) / 1000) }
  }
  return { success: true }
}
```

---

## Rate Limits by Route Category

### Public Routes (No Authentication)

**Identifier:** Client IP address

| Route | Limit | Window | Rationale |
|---|---|---|---|
| `GET /api/schools/search` | 30 requests | 1 minute | Prevents scraping of school directory |
| `GET /api/schools/[schoolId]/public` | 30 requests | 1 minute | Public profile lookup |
| `GET /api/students/lookup` | 10 requests | 1 minute | Stricter — prevents student ID enumeration |

---

### Authentication Routes

**Identifier:** Client IP address — stricter limits to prevent brute force

| Route | Limit | Window | Rationale |
|---|---|---|---|
| Email OTP request | 5 requests | 15 minutes | Prevents OTP flooding to a single email |
| OTP verification attempt | 3 attempts | 15 minutes | After 3 failures, Clerk locks the OTP |
| Parent phone lookup (login) | 10 requests | 1 minute | Prevents phone number enumeration |

These limits are enforced by Clerk's own rate limiting in addition to the ZSMS middleware layer. Clerk's limits apply first.

---

### Authenticated API Routes (Clerk JWT)

**Identifier:** Clerk user ID

| Route Category | Limit | Window | Rationale |
|---|---|---|---|
| General dashboard reads | 120 requests | 1 minute | Typical interactive use — comfortable headroom |
| Student search | 60 requests | 1 minute | Debounced search — 60 is more than sufficient |
| Financial reads (fee records, payment history) | 60 requests | 1 minute | Slightly stricter — financial data |
| Financial writes (record payment, update fee) | 20 requests | 1 minute | Prevents accidental duplicate submissions |
| Bulk operations (import, generate reports) | 5 requests | 1 minute | Heavy operations — one at a time per school |
| Communication sends (broadcast messages) | 10 requests | 1 minute | Prevents accidental mass messaging |
| AfriTech admin routes | 200 requests | 1 minute | Internal team needs higher throughput |

---

### Webhook Routes

**Identifier:** Not rate-limited by ZSMS — senders have their own retry logic

Webhook endpoints are excluded from ZSMS rate limiting. The HMAC signature verification is the security control. Blocking retries from Clerk, payment gateways, or Meta would cause data loss.

**Exception:** The Meta WhatsApp inbound webhook is rate-limited at 1,000 messages per minute per phone number — this is a Meta platform limit, not a ZSMS limit.

---

### External API Key Routes (v1 Endpoints)

**Identifier:** API key ID (not IP — IP changes for external systems)

Rate limits for API keys are configured per key in `school_api_keys.rate_limit_rpm`. The `apiKey` rate limiter uses the per-key limit rather than a global default.

```typescript
// Rate limit using the key's configured RPM
const keyRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(apiKey.rate_limit_rpm, '1 m'),
  prefix: `rl:apikey:${apiKey.id}`,
})
```

| Integration Tier | Default RPM | Maximum RPM |
|---|---|---|
| Tier 2 — Read only | 60 | 300 |
| Tier 1 — Webhook receive | 120 | 600 |
| Tier 3 — Full module | 300 | 1,200 |
| Custom (negotiated) | As configured | No hard cap |

Schools requiring higher throughput contact AfriTech to increase their API key's `rate_limit_rpm`. This is a database update — no code change required.

---

## WhatsApp Message Quota System

The WhatsApp quota is a separate system from API rate limiting. It operates on a monthly billing period rather than a per-minute window, and it is tracked in the database rather than Redis.

This is documented in detail in `docs/infra/META_API.md` and `docs/modules/communication/WHATSAPP.md`. Summary:

| Subscription Tier | Monthly WhatsApp Messages | Overage Option |
|---|---|---|
| Starter | 500 | +K50 per 500 |
| Growth | 1,500 | +K50 per 500 |
| Professional | 4,000 | +K50 per 500 |
| Enterprise | Unlimited | — |

**Quota enforcement point:** Before enqueuing any WhatsApp job, the API route checks and decrements the school's quota. If quota is zero, the job is not enqueued and `WHATSAPP_QUOTA_EXCEEDED` is returned.

---

## Queue-Level Rate Limiting (Bulk Dispatch)

For bulk WhatsApp message dispatch, the Meta Cloud API enforces its own rate limits:

- **Default:** 1,000 messages per second (varies by business tier)
- **ZSMS enforcement:** 60 messages per minute via the worker rate limiter (BullMQ `limiter`; QStash `Upstash-Delay` header under the fallback)

This is configured in the `send-whatsapp` Edge Function — see `docs/infra/QSTASH.md` for implementation details.

---

## Duplicate Transaction Reference Detection

This is not a rate limit but a fraud mitigation control applied to payment submissions.

**Window:** Lifetime of the payment record (no expiry)
**Scope:** Per school — same reference submitted twice at the same school

When a parent submits a payment with a `transaction_reference` that already exists in `public.payments` for that school:
1. The API returns `DUPLICATE_TRANSACTION_REFERENCE` (409)
2. The client shows a warning with the existing payment details
3. The parent must explicitly confirm `{ force: true }` in a second request to proceed
4. The second submission is marked with `is_possible_duplicate: true` in the database
5. The accountant sees a "Possible duplicate" flag in the verification queue

---

## Rate Limit Response

When a rate limit is exceeded, the response includes the `Retry-After` header and the `retry_after_seconds` field:

```typescript
// Middleware implementation
const { success, retryAfter } = await checkRateLimit(limiter, identifier)

if (!success) {
  return new Response(
    JSON.stringify({
      error: 'Too many requests. Please slow down.',
      code: 'RATE_LIMITED',
      retry_after_seconds: retryAfter,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': retryAfter.toString(),
        'X-RateLimit-Reset': new Date(Date.now() + retryAfter * 1000).toISOString(),
      },
    }
  )
}
```

---

## Client-Side Rate Limit Handling

The frontend and external API clients should implement exponential backoff when receiving 429 responses:

```typescript
// Recommended client-side retry logic
async function apiCallWithRetry(fn: () => Promise<Response>, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fn()

    if (response.status !== 429) return response

    const { retry_after_seconds } = await response.json()
    const delay = (retry_after_seconds || Math.pow(2, attempt)) * 1000

    await new Promise(resolve => setTimeout(resolve, delay))
  }

  throw new Error('Max retries exceeded')
}
```

---

## Business Rules

1. Rate limits are enforced in middleware before any authentication or business logic. A rate-limited request never reaches the database.
2. Webhook endpoints are excluded from ZSMS rate limiting. HMAC signature verification is the security control for webhooks.
3. AfriTech admin routes have higher limits than school staff routes — internal team operations should not be impeded by standard user limits.
4. API key rate limits are per-key, not per-school. A school with two API keys has two independent rate limit buckets.
5. The WhatsApp quota system is separate from API rate limiting. Both can apply simultaneously — a school can hit their WhatsApp quota without being rate limited on API calls.
6. Rate limit identifiers are never logged or exposed in error responses — only the retry window is communicated.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 5 API reference documentation |
| 2026-04-26 | Added duplicate transaction reference detection | Fraud mitigation for payment submissions |
| 2026-04-26 | Added WhatsApp quota summary | Portal-first model with tiered messaging |
