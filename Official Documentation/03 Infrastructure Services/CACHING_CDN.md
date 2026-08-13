# CACHING_CDN.md — Caching Strategy and CDN Configuration

## Related Documents

- `01 Foundation Layer/THIRTEEN_LAYER_COMPLIANCE.md` — this document owns Layer 10 (Caching / CDN)
- `01 Foundation Layer/DYNAMIC_CONFIG.md` — the configuration registry this cache serves
- `17 Integration and Pricing/PRICING.md` — `schoolHasFeature()` and its cache TTLs
- `03 Infrastructure Services/CLOUDFLARE_WAF.md` — the same Cloudflare zone, security rules
- `05 Core Database and API Reference/RATE_LIMITS.md` — shares the Redis instance
- `03 Infrastructure Services/COST_MANAGEMENT.md` — caching is the primary cost lever
- `13 Document and PDF System/STORAGE.md` — signed URL expiry interacts with CDN caching

---

## Purpose

This document defines every cache in ZSMS — what is cached, where, for how long, under what key, and critically when it is invalidated. It covers the Upstash Redis application cache, the Cloudflare CDN edge cache, and Next.js ISR. Every Claude Code session that adds a hot-path lookup, changes a configuration table, or builds a public page must read this document before choosing a TTL.

---

## Overview

ZSMS caches at three levels, each solving a different problem.

```
Browser / Mobile
      │
      ▼
Cloudflare CDN ──────── static assets, public pages, images
      │                 (geographic latency, origin offload)
      ▼
Vercel / Next.js ISR ── public pricing page, school directory
      │                 (rendered HTML, revalidated on interval)
      ▼
Next.js API / Edge Fn
      │
      ▼
Upstash Redis ───────── feature access, configuration, sessions,
      │                 rate limit counters
      ▼
Supabase PostgreSQL
```

The governing tension is specific to this product. ZSMS pricing and feature access are entirely database-driven (ADR-014, ADR-031) precisely so a super admin can change them without a deployment. Caching those values is what makes them fast enough to check on every request — and is also what can make a price change appear not to work. **Invalidation is therefore not an optimisation detail in this system; it is what makes the dynamic configuration model honest.**

---

## Layer 1 — Upstash Redis Application Cache

### Key naming convention

```
{namespace}:{scope}:{identifier}:{key}
```

| Namespace | Purpose | Example |
|---|---|---|
| `config` | Dynamic configuration values | `config:platform:global:trial_length_days` |
| `tier_features` | Tier feature matrix | `tier_features:growth` |
| `school_overrides` | Per-school feature overrides | `school_overrides:{school_id}` |
| `module_subs` | Active module subscriptions | `module_subs:{school_id}` |
| `school` | School record | `school:{school_id}` |
| `ratelimit` | Rate limit counters | `ratelimit:session:{user_id}:{window}` |
| `session` | Session metadata cache | `session:{clerk_session_id}` |
| `metrics` | Precomputed dashboard metrics | `metrics:platform:daily:{date}` |

Keys are always lowercase, colon-delimited, and namespaced by scope so a school-scoped value can never collide with another school's. **Never construct a key from user input without validation** — a key containing a school-supplied string is a cache-poisoning vector.

### TTL bands

| Band | TTL | Applies to | Rationale |
|---|---|---|---|
| Structural | 3,600s (1h) | Tier feature matrix, grading scales, term structure, score weights | Changes rarely; a super admin edit invalidates immediately anyway |
| Operational | 300s (5m) | School overrides, module subscriptions, school record, rate limit config | Changes occasionally; five minutes bounds worst-case staleness |
| Volatile | 60s | Exchange rates, promo code validity, health score summaries | Changes often or is time-sensitive |
| Counter | Window length | Rate limit counters | TTL is the rate limit window itself |
| **Never cached** | — | Data completeness score used for AI gating | ADR-029 — gating decisions are always computed fresh |

These bands match the TTLs already specified in `PRICING.md` (`tierFeatures` 3600, `schoolOverrides` 300, `moduleSubscriptions` 300). Where the two documents overlap, `PRICING.md` is authoritative for feature access specifically and this document is authoritative for everything else.

### What must never be cached in Redis

| Never cached | Why |
|---|---|
| Student, parent, or staff personal data | Redis is not RLS-enforced. A cached row bypasses tenant isolation entirely. |
| Loan application PII | `private` schema data never leaves Edge Functions. |
| Decrypted credentials | Gateway keys, WhatsApp tokens, lender API keys stay encrypted at rest and decrypt per use. |
| Data completeness score for gating | ADR-029 — stale completeness could unlock AI insights that should be locked. |
| Anything used for an authorisation decision beyond feature access | Feature access is a commercial gate. Permission and RLS decisions are made live against the database. |

The rule in one line: **Redis holds configuration and counters, never tenant data.**

### Invalidation

Every write to a cached source invalidates its keys **in the same request handler, immediately after the write succeeds and before the response returns.** TTL expiry is a safety net for missed invalidations, never the mechanism.

| Write target | Keys invalidated |
|---|---|
| `afritech.subscription_tiers` | `tier_features:*`, `config:platform:*:tier:*` |
| `afritech.tier_features` | `tier_features:{tier_name}` |
| `afritech.feature_flags` | `tier_features:*`, `config:platform:global:features` |
| `afritech.school_feature_overrides` | `school_overrides:{school_id}`, `module_subs:{school_id}` |
| `afritech.platform_settings` | `config:platform:*:{key}`, `config:country:*:{key}` |
| `afritech.score_config` | `config:platform:global:score_*` |
| `public.schools` (tier or status change) | `school:{school_id}`, `school_overrides:{school_id}` |
| `public.module_subscriptions` | `module_subs:{school_id}` |
| `public.school_grading_scales` | `config:school:{school_id}:grading_*` |

**Wildcard invalidation uses `SCAN`, never `KEYS`.** `KEYS` blocks the Redis server for the duration of the scan; on a shared instance that is an outage.

```typescript
async function invalidatePattern(pattern: string): Promise<void> {
  let cursor = 0
  do {
    const [next, keys] = await redis.scan(cursor, { match: pattern, count: 100 })
    if (keys.length) await redis.del(...keys)
    cursor = Number(next)
  } while (cursor !== 0)
}
```

### Failure behaviour

Redis is a performance dependency, never a correctness dependency.

- **Read failure** → fall through to the database, serve the request, log at warning level.
- **Write failure** → log and swallow. The value is simply not cached this time.
- **Redis entirely unavailable** → every request falls through to PostgreSQL. Latency degrades and Supabase load rises sharply, but the application remains correct and available.

A caching outage must never produce a 500. Any code path where a Redis failure surfaces as an error is a defect.

---

## Layer 2 — Cloudflare CDN

Cloudflare fronts all traffic. The same zone carries the WAF rules in `CLOUDFLARE_WAF.md`; this section covers only caching.

| Content | Cache rule | Edge TTL | Browser TTL |
|---|---|---|---|
| Static assets (`/_next/static/*`) | Cache everything | 1 year (immutable) | 1 year |
| Images, fonts | Cache everything | 30 days | 7 days |
| Public marketing pages | Cache everything | 1 hour | 5 minutes |
| `/pricing` | Cache everything | 5 minutes | 0 (revalidate) |
| Public school directory | Cache everything | 10 minutes | 0 |
| `/api/*` | **Bypass** | — | — |
| Any authenticated route | **Bypass** | — | — |
| R2 public bucket assets | Cache everything | 30 days | 7 days |

### Non-negotiable CDN rules

1. **Never cache a response carrying an `Authorization` header or a session cookie.** A cached authenticated response served to another user is a cross-tenant data leak — the most severe failure this system can produce.
2. **Never cache `/api/*`.** All API responses are tenant-scoped.
3. **Never cache a signed R2 URL.** Signed URLs are per-user, time-limited, and often point at the private bucket. Caching one extends its life and shares it. See `STORAGE.md`.
4. **Cache keys must not include user identity.** If a response varies by user, it is not cacheable at the edge.

Rules 1 and 3 exist because their failure mode is a security incident, not a stale page.

### Purging

Deployments purge automatically via Vercel's Cloudflare integration. Manual purge is by URL or cache-tag, never a full zone purge — a full purge sends every request to origin simultaneously and can cause a self-inflicted load spike.

---

## Layer 3 — Next.js ISR

Incremental Static Regeneration serves public pages as static HTML, regenerated on an interval.

| Page | `revalidate` | Data source |
|---|---|---|
| `/pricing` | 300s | `afritech.subscription_tiers`, `feature_flags`, `tier_features` |
| Public school directory | 600s | `public.schools` where publicly listed |
| Marketing pages | 3,600s | Static content |

The pricing page revalidation is already specified in `PRICING.md`. The combined worst case for a price change to become publicly visible is **Redis TTL + ISR interval + CDN edge TTL** — roughly ten minutes with the values above. This is acceptable and should be stated plainly to super admins in the admin panel rather than left as a surprise.

**ISR is never used for authenticated pages.** Server-rendered per request, always.

---

## End-to-End Example: A Price Change

Tracing a super admin changing the Growth tier price makes the whole chain concrete.

```
1. Admin submits new price
2. API writes afritech.subscription_tiers          ← source of truth updated
3. Same handler invalidates tier_features:*        ← Redis cleared immediately
   and config:platform:*:tier:*
4. Audit log row written with old and new values
5. Next schoolHasFeature() call: Redis miss → DB → re-cached
   → application behaviour is correct immediately
6. Public /pricing page: stale up to 300s (ISR)
   then rebuilt from the database
7. Cloudflare edge: stale up to 300s beyond that
   → public page fully consistent within ~10 minutes
```

Step 3 is the one that is easy to forget and the one that makes the difference between "the price changed" and "the price changed everywhere except where customers look."

---

## Business Rules

1. Every write to a cached source invalidates its keys in the same request handler. TTL expiry is a safety net, not the invalidation mechanism.
2. Redis caches configuration and counters only. Student, parent, staff, and loan data are never cached.
3. Cloudflare never caches responses carrying an `Authorization` header or session cookie, and never caches `/api/*`.
4. Signed R2 URLs are never cached at any layer.
5. Wildcard invalidation uses `SCAN`, never `KEYS`.
6. A Redis failure degrades latency, never correctness. No code path may surface a cache failure as a request error.
7. The data completeness score used for AI gating is never served from cache (ADR-029).
8. New cache keys must follow the `{namespace}:{scope}:{identifier}:{key}` convention and be added to this document in the same change.

---

## Edge Cases and Error Handling

**Cache stampede after invalidation.** Invalidating `tier_features:*` sends every concurrent request to the database at once. At current scale this is harmless. If it becomes a problem, the fix is a short-lived lock so one request repopulates while others briefly serve stale — not longer TTLs.

**Partial invalidation failure.** If a `SCAN`-based invalidation fails midway, some keys remain stale until TTL. The write already succeeded, so the database is correct. Log the failure with the pattern that failed; the operational band caps exposure at five minutes.

**School changes tier mid-request.** A request that resolved feature access before the change completes under the old tier. Acceptable — the next request sees the new tier.

**Clock skew across Redis and application.** TTLs are relative, not absolute, so skew is not a concern. Rate limit windows are the exception and use Redis server time consistently.

**Cloudflare caching an error page.** A 500 cached at the edge outlives the incident. Error responses must send `Cache-Control: no-store`.

---

## Integration Points

- `DYNAMIC_CONFIG.md` — defines what is configurable; this document defines how it is cached
- `PRICING.md` — authoritative for feature-access TTLs specifically
- `RATE_LIMITS.md` — shares the Redis instance; counters use the same key conventions
- `CLOUDFLARE_WAF.md` — same Cloudflare zone, security rules rather than cache rules
- `STORAGE.md` — signed URL expiry policy that CDN rules must not undermine
- `COST_MANAGEMENT.md` — cache hit rate is the primary lever on Vercel and Supabase spend

---

## Security Considerations

The two highest-severity failures available in this layer are both cache-related, and both are cross-tenant:

1. **Caching an authenticated response at the CDN.** One school's dashboard served to another school's user. This is why rule 1 above is absolute rather than a default.
2. **Caching tenant data in Redis.** Redis has no RLS. Any tenant row placed in Redis has left the security model that protects it.

Cache keys constructed from unvalidated user input allow poisoning — an attacker who controls part of a key can write to or read from another scope. All key components are either system-generated identifiers or validated enumerations.

Rate limit counters share the Redis instance. A Redis outage therefore disables application-layer rate limiting; the Cloudflare Worker edge limits in `CLOUDFLARE_WAF.md` remain and are the reason this degrades rather than fails open completely.

---

## Known Limitations and Future Work

- No cache hit rate monitoring. Hit rate is the single most useful signal for both performance and cost, and it is currently not measured. Add Upstash metrics to the admin dashboard.
- No stale-while-revalidate at the Redis layer. Invalidation is a hard delete, so the next request pays full database latency.
- Combined worst-case propagation for a public price change is roughly ten minutes across Redis, ISR, and CDN. Acceptable, but it should be surfaced in the admin panel so super admins are not confused by the delay.
- Self-hosted deployments substitute local Redis for Upstash. TTLs and key conventions carry over unchanged; CDN behaviour depends on whatever the country partner fronts the deployment with, and may be absent entirely.
- No cache warming after deployment. The first requests after a deploy pay full database cost.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-08-13 | Initial complete draft | Layer 10 (Caching / CDN) had no owning document |
| 2026-08-13 | Key naming convention and TTL bands defined | Cache keys were specified ad hoc across PRICING.md and RATE_LIMITS.md |
| 2026-08-13 | Invalidation matrix documented | Database-driven pricing is only honest if invalidation is reliable |
| 2026-08-13 | CDN rules on authenticated responses and signed URLs made absolute | Both failure modes are cross-tenant security incidents |
