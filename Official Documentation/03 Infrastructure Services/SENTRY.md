# SENTRY.md — Error Monitoring

## Related Documents

- `docs/ARCHITECTURE.md` — observability layer
- `docs/ENV.md` — Sentry environment variables
- `docs/infra/POSTHOG.md` — product analytics alongside error monitoring
- `docs/infra/SUPABASE.md` — Edge Function errors captured by Sentry
- `docs/CONVENTIONS.md` — error code standards referenced in Sentry

---

## Purpose

This document covers Sentry configuration for ZSMS — how errors are captured across the web app, mobile app, and Edge Functions, what alert rules are configured, and how to investigate a Sentry error back to the relevant audit log entry or queued job. Every Claude Code session adding error handling must reference this document to ensure consistent Sentry integration.

---

## Overview

Sentry captures all unhandled errors and exceptions across every layer of ZSMS — Next.js web app, React Native mobile app, and Supabase Edge Functions. It provides stack traces, breadcrumbs (the sequence of events leading to an error), user context, and release tracking.

Sentry is the first place to check when a school reports an issue. The error in Sentry will link back to the specific Edge Function, API route, or mobile screen where the problem occurred.

---

## Project Setup

Two Sentry projects are created — one for each platform:

| Project | Platform | What It Monitors |
|---|---|---|
| `zsms-web` | Next.js | Web dashboard, parent portal, admin panel, API routes |
| `zsms-mobile` | React Native (Expo) | Teacher and parent mobile apps |

Edge Function errors are captured by routing them to the `zsms-web` project using Sentry's Node.js/Deno SDK. They appear as server-side errors within the web project.

---

## Web Application Integration

```typescript
// apps/web/sentry.client.config.ts
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  // 10% of transactions traced in production to control volume
  // 100% in development for full visibility

  environment: process.env.NODE_ENV,
  release: process.env.NEXT_PUBLIC_APP_VERSION,

  beforeSend(event) {
    // Strip PII from error events before sending to Sentry
    if (event.user) {
      delete event.user.email
      delete event.user.ip_address
    }
    return event
  },

  ignoreErrors: [
    'ResizeObserver loop limit exceeded',  // Browser noise
    'Network request failed',              // Expected on poor connections
    'ChunkLoadError',                      // Next.js chunk loading on slow connections
  ],
})
```

```typescript
// apps/web/sentry.server.config.ts
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: process.env.NODE_ENV,
})
```

---

## Mobile App Integration

```typescript
// apps/mobile/app/_layout.tsx
import * as Sentry from '@sentry/react-native'

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: process.env.NODE_ENV,

  beforeSend(event) {
    // Remove phone numbers from mobile error events
    if (event.user?.username) {
      event.user.username = '[redacted]'
    }
    return event
  },
})
```

---

## Edge Function Error Capture

Edge Functions use a lightweight Sentry integration via fetch:

```typescript
// Utility used in all Edge Functions
async function captureEdgeFunctionError(
  error: Error,
  context: Record<string, unknown>
): Promise<void> {
  // Log to Supabase function logs (always available)
  console.error('Edge function error:', {
    message: error.message,
    stack: error.stack,
    context,
  })

  // Send to Sentry
  await fetch('https://sentry.io/api/{project_id}/store/', {
    method: 'POST',
    headers: {
      'X-Sentry-Auth': `Sentry sentry_key=${Deno.env.get('SENTRY_DSN_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      exception: {
        values: [{ type: error.name, value: error.message }],
      },
      extra: context,
      environment: Deno.env.get('NODE_ENV'),
      tags: {
        function: Deno.env.get('FUNCTION_NAME'),
        school_id: context.school_id,
      },
    }),
  })
}
```

---

## User Context

Setting user context in Sentry allows filtering errors by school or role:

```typescript
// Set after authentication in the web app layout
import * as Sentry from '@sentry/nextjs'
import { useUser, useOrganization } from '@clerk/nextjs'

Sentry.setUser({
  id: user.id,              // Clerk user ID — not PII
  // Never set: email, name, phone number
})

Sentry.setTag('school_id', organization?.id)
Sentry.setTag('user_role', membership?.role)
Sentry.setTag('country_code', process.env.NEXT_PUBLIC_COUNTRY_CODE)
```

This allows filtering Sentry issues by school, role, or country — without storing PII in Sentry.

---

## Alert Configuration

Alerts are configured in Sentry Dashboard → Alerts → Create Alert Rule.

### Critical Alerts (Immediate Notification)

| Condition | Threshold | Notification |
|---|---|---|
| New unhandled error in production | First occurrence | Email to Mwando |
| Error rate spike | >10 errors per minute | Email + in-app notification |
| Edge Function error rate | >5% of requests failing | Email to Mwando |
| Payment Edge Function error | Any error | Email to Mwando + Julius |

### Warning Alerts (Daily Digest)

| Condition | Threshold | Notification |
|---|---|---|
| Mobile app crash | Any new crash type | Email digest |
| New error type | First occurrence in 24h | Email digest |

Payment-related Edge Function errors get immediate notification because they affect financial records and school accountants may be waiting for payment confirmations.

---

## Investigating an Error

### Step 1 — Sentry Event Details

Find the error in Sentry. Note:
- Which function or route threw the error
- The stack trace
- The user tags (school_id, user_role)
- The breadcrumbs (what happened before the error)

### Step 2 — Cross-Reference with Audit Log

If the error involves a data operation, find the corresponding audit log entry:

```sql
-- Find audit events around the time of the Sentry error
SELECT * FROM public.audit_logs
WHERE school_id = (SELECT id FROM schools WHERE clerk_org_id = 'org_from_sentry_tag')
  AND created_at BETWEEN '2026-09-15T10:20:00Z' AND '2026-09-15T10:25:00Z'
ORDER BY created_at DESC;
```

### Step 3 — Cross-Reference with the Job Queue

If the error occurred in a queued job (BullMQ by default; QStash if the fallback is active):
1. Note the job ID from the error context
2. Check Bull Board for that job ID (or Upstash console → QStash → Messages under the fallback)
3. View the message payload and delivery attempts

### Step 4 — Supabase Function Logs

For Edge Function errors, check the raw logs in Supabase Dashboard → Edge Functions → [function name] → Logs. These show the full console.error output including the context object.

---

## Release Tracking

Sentry tracks which code version introduced an error. Set the release version in the build:

```bash
# In the Vercel build command
NEXT_PUBLIC_APP_VERSION=$(git rev-parse --short HEAD)
```

This lets Sentry show "First seen in release abc1234" which maps to a specific Git commit. Combined with the changelog, this identifies exactly what changed when an error was introduced.

---

## PII Handling in Sentry

Sentry must never receive PII. Rules enforced via `beforeSend`:

- Email addresses are stripped from all error events
- Phone numbers are stripped from user context
- Student names are never included in error messages — use student IDs only
- IP addresses are not stored in Sentry (configured in Sentry project settings → Security → Data Scrubbing)
- NRC numbers and income figures must never appear in error messages or context

If an error message accidentally includes PII (e.g. a database error that echoes query parameters), the `beforeSend` function must sanitise it:

```typescript
beforeSend(event) {
  // Remove phone numbers matching E.164 pattern
  const json = JSON.stringify(event)
  const sanitised = json.replace(/\+\d{10,15}/g, '[phone]')
  return JSON.parse(sanitised)
}
```

---

## Business Rules

1. Sentry is never used to store PII. The `beforeSend` function must sanitise all events before transmission.
2. Payment-related errors trigger immediate email notification to both co-founders.
3. The Sentry DSN is a client-safe value — it only allows sending errors, not reading them. It can appear in `NEXT_PUBLIC_` variables.
4. Source maps are uploaded to Sentry during every production build via the Sentry Webpack plugin. Without source maps, stack traces show minified code which is difficult to interpret.
5. Error events are retained in Sentry for 90 days on the free tier. Upgrade to a paid plan if longer retention is needed for compliance.

---

## Known Limitations and Future Work

- Edge Function Sentry integration is manual (fetch-based). A proper Sentry Deno SDK would simplify this when available.
- Sentry free tier has a limit of 5,000 error events per month. At 10 pilot schools this is more than sufficient. Monitor monthly event volume as schools are added.
- Performance monitoring (tracing slow API routes) is enabled at 10% sampling rate. If specific routes are suspected to be slow, temporarily increase sampling for that route only.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 3 infrastructure documentation |
