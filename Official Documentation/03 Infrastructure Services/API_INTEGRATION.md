# API_INTEGRATION.md — Modular API and External Integration

## Related Documents

- `docs/ARCHITECTURE.md` — overall system architecture and API layer
- `docs/DATABASE.md` — school_api_keys table
- `docs/RLS.md` — how API key authentication integrates with RLS
- `docs/modules/auth/ROLES.md` — role scoping for API key access
- `docs/modules/fees/GATEWAY.md` — payment gateway webhook integration
- `docs/modules/loans/LENDER_INTEGRATION.md` — lender webhook integration
- `docs/ENV.md` — API key encryption configuration
- `docs/infra/VERCEL.md` — API route hosting

---

## Purpose

This document defines the ZSMS modular API integration system — how schools with existing management systems can access individual ZSMS services (loan module, communication, fee tracking) without migrating their entire operation to ZSMS. It also covers the API key authentication model, the three tiers of integration, and how new API routes are written to support both Clerk JWT and API key authentication simultaneously.

---

## Overview

ZSMS is designed as a full school management platform but is also architected to offer individual modules as standalone services. A school that already has a student database and fee management system might only want the ZSMS loan module, or only the WhatsApp communication system. Rather than forcing a full migration, ZSMS exposes its modules via a documented public API that external systems can call.

This creates a lower-barrier entry point — schools try one service, see the value, and progressively adopt more. It also opens a separate revenue stream from API-only subscriptions that are priced differently from full platform subscriptions.

---

## Three Integration Tiers

### Tier 1 — Webhook Receive (Push Integration)

The school's existing system pushes data to ZSMS via webhooks. ZSMS receives the data, processes it, and makes it available in the relevant module.

**Example use case:** A school has their own fee collection software. When their accountant records a payment there, it automatically sends a webhook to ZSMS with the student identifier, amount, payment method, and reference. ZSMS records it in the fee ledger, updates the parent's portal balance, and queues a WhatsApp confirmation to the parent.

**What the school gets:** Parent notifications, audit trail, payment tracking, and the parent portal — without abandoning their existing accounting software.

**What ZSMS does:** Receives and validates the webhook, maps the external student identifier to a ZSMS student record, records the event, and triggers downstream automation.

### Tier 2 — API Read (Pull Integration)

The school queries ZSMS for data to display in their own system or app.

**Example use case:** A school has built their own parent-facing mobile app. They call the ZSMS API to fetch a student's current fee balance, attendance history, and published results, then display it in their own UI. ZSMS is the data layer; the school owns the presentation layer.

**What the school gets:** Reliable, structured data from ZSMS modules without needing to build ZSMS's data collection workflows.

**What ZSMS does:** Authenticates the API key, validates scope permissions, returns structured JSON responses respecting the school's data isolation.

### Tier 3 — Module as a Service (Full Module Integration)

The school uses one complete ZSMS module end-to-end via API, without accessing the ZSMS dashboard at all.

**Example use case:** A large school group has their own IT system for student management and fees. They want to offer school fee loans to their parents. They integrate the ZSMS loan module: send parent and fee data to ZSMS via API, parents apply through a ZSMS-hosted loan page (white-labelable with the school's branding), AfriTech earns the origination commission, and the school receives full fee payment from the lender.

**What the school gets:** Access to AfriTech's lending partner network and the ZSMS loan infrastructure without any other module.

**What ZSMS does:** Manages the complete loan lifecycle — consent, application, lender submission, disbursement webhook, repayment tracking — for the school's students using data provided via API.

---

## API Key Authentication

External integrations authenticate using API keys rather than Clerk JWTs. API keys are suitable for machine-to-machine communication where a user session is not involved.

### `school_api_keys` Table

```sql
CREATE TABLE public.school_api_keys (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id       UUID NOT NULL REFERENCES public.schools(id),
  name            TEXT NOT NULL,
  -- Descriptive name: 'Fee System Integration', 'Parent App Read Access'

  key_hash        TEXT NOT NULL,
  -- SHA-256 hash of the actual key. The plaintext key is shown ONCE on creation.

  key_prefix      TEXT NOT NULL,
  -- First 8 characters of the key for identification: 'zsms_live_abc12345...'

  scopes          TEXT[] NOT NULL DEFAULT '{}',
  -- Array of permitted scopes:
  -- 'students:read', 'fees:read', 'fees:write', 'attendance:read',
  -- 'results:read', 'communication:send', 'loans:read', 'payments:write'

  rate_limit_rpm  INT NOT NULL DEFAULT 60,
  -- Requests per minute allowed for this key

  is_active       BOOLEAN DEFAULT TRUE,
  last_used_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  -- NULL = never expires. Set an expiry for time-limited integrations.

  created_by      TEXT NOT NULL,
  -- Clerk user ID of the school owner who created this key

  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_api_keys_hash ON public.school_api_keys(key_hash);
CREATE INDEX idx_api_keys_school ON public.school_api_keys(school_id, is_active);
```

### Key Generation

API keys are generated using a cryptographically secure random string:

```typescript
// Format: zsms_live_[32 random characters]
// Example: zsms_live_a3f8k2m9p1q7r4s6t0v5w8x2y9z1b4c7

function generateApiKey(): { plaintext: string; hash: string; prefix: string } {
  const randomBytes = crypto.getRandomValues(new Uint8Array(24))
  const randomPart = btoa(String.fromCharCode(...randomBytes))
    .replace(/[+/=]/g, '')
    .substring(0, 32)

  const plaintext = `zsms_live_${randomPart}`
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plaintext))
  const hashHex = Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

  return {
    plaintext,                          // Shown ONCE to the school owner
    hash: hashHex,                      // Stored in database
    prefix: plaintext.substring(0, 18), // 'zsms_live_a3f8k2m9' for display
  }
}
```

The plaintext key is shown exactly once — on the creation screen. After the school owner copies it, it cannot be retrieved again. If lost, a new key must be generated and the old one revoked.

### API Key Authentication Middleware

API routes that support external integration check for an API key in the `Authorization` header as an alternative to the Clerk JWT:

```typescript
// apps/web/lib/auth/apiKeyAuth.ts
export async function authenticateApiKey(req: Request): Promise<{
  schoolId: string
  scopes: string[]
} | null> {

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer zsms_')) return null

  const providedKey = authHeader.replace('Bearer ', '')

  // Hash the provided key
  const hash = await hashKey(providedKey)

  // Look up the key
  const { data: apiKey } = await supabaseAdmin
    .from('school_api_keys')
    .select('school_id, scopes, is_active, expires_at, rate_limit_rpm')
    .eq('key_hash', hash)
    .single()

  if (!apiKey || !apiKey.is_active) return null
  if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) return null

  // Update last_used_at
  await supabaseAdmin
    .from('school_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('key_hash', hash)

  return { schoolId: apiKey.school_id, scopes: apiKey.scopes }
}
```

### Dual Authentication in API Routes

Every externally-accessible API route supports both Clerk JWT (for dashboard use) and API key (for external integrations):

```typescript
// apps/web/app/api/students/route.ts
export async function GET(req: Request) {
  let schoolId: string
  let hasScope: (scope: string) => boolean

  // Try API key first
  const apiKeyAuth = await authenticateApiKey(req)

  if (apiKeyAuth) {
    schoolId = apiKeyAuth.schoolId
    hasScope = (scope) => apiKeyAuth.scopes.includes(scope)
  } else {
    // Fall back to Clerk JWT
    const { userId, orgId } = auth()
    if (!userId || !orgId) {
      return Response.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 })
    }
    schoolId = orgId
    hasScope = () => true  // Clerk users have full access within their RLS scope
  }

  // Check scope for API key requests
  if (apiKeyAuth && !hasScope('students:read')) {
    return Response.json({ error: 'Insufficient scope', code: 'FORBIDDEN' }, { status: 403 })
  }

  // Proceed with data fetch — uses schoolId for filtering
  const students = await getStudents(schoolId)
  return Response.json({ data: students })
}
```

---

## Available API Scopes

| Scope | What It Permits | Tier |
|---|---|---|
| `students:read` | GET student profiles, search, list | Tier 2 |
| `students:write` | Create and update student records | Tier 3 |
| `fees:read` | GET fee records, balances, payment history | Tier 2 |
| `fees:write` | Record payments via API | Tier 1/3 |
| `attendance:read` | GET attendance records | Tier 2 |
| `attendance:write` | POST attendance records | Tier 1 |
| `results:read` | GET published exam results | Tier 2 |
| `communication:send` | Send WhatsApp/email via ZSMS | Tier 1/3 |
| `loans:read` | GET loan application status | Tier 2/3 |
| `loans:write` | Submit loan applications via API | Tier 3 |
| `webhooks:receive` | Register webhook endpoints for events | Tier 1 |

---

## Public API Endpoints

The following endpoints are available to external integrations. All require a valid API key with the appropriate scope.

### Students

```
GET  /api/v1/students                   List students (students:read)
GET  /api/v1/students/{student_id}      Get student profile (students:read)
POST /api/v1/students                   Create student (students:write)
PUT  /api/v1/students/{student_id}      Update student (students:write)
```

### Fees

```
GET  /api/v1/fees/{student_id}          Get student fee balance (fees:read)
GET  /api/v1/fees/{student_id}/history  Get payment history (fees:read)
POST /api/v1/fees/payments              Record a payment (fees:write)
```

### Attendance

```
GET  /api/v1/attendance/{student_id}    Get attendance records (attendance:read)
POST /api/v1/attendance                 Record attendance (attendance:write)
```

### Results

```
GET  /api/v1/results/{student_id}       Get published results (results:read)
```

### Communication

```
POST /api/v1/messages/send              Send WhatsApp or email (communication:send)
```

### Loans

```
GET  /api/v1/loans/{student_id}         Get loan status (loans:read)
POST /api/v1/loans/apply                Submit loan application (loans:write)
```

---

## Webhook Registration (Tier 1)

Schools can register their own webhook endpoints to receive ZSMS events in their systems. When ZSMS processes an event (payment recorded, results published, attendance marked), it sends a POST request to the school's registered endpoint.

```sql
CREATE TABLE public.school_webhooks (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id       UUID NOT NULL REFERENCES public.schools(id),
  url             TEXT NOT NULL,
  events          TEXT[] NOT NULL,
  -- Events to subscribe to:
  -- 'payment.verified', 'payment.rejected', 'results.published',
  -- 'attendance.marked', 'loan.disbursed', 'student.created'
  secret          TEXT NOT NULL,
  -- HMAC secret for the school to verify ZSMS webhook authenticity
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

ZSMS signs all outbound webhook requests with the school's secret using HMAC-SHA256. The school validates the signature on their end — same pattern as how ZSMS validates incoming webhooks from Meta and payment gateways.

---

## Rate Limiting

API key requests are rate-limited using Upstash Redis. Each key has a `rate_limit_rpm` (requests per minute) configured at creation time.

Default limits by integration tier:

| Tier | Default RPM | Maximum RPM |
|---|---|---|
| Tier 1 (webhook receive) | 120 | 600 |
| Tier 2 (read only) | 60 | 300 |
| Tier 3 (full module) | 300 | 1,200 |

Rate limit exceeded response:
```json
{
  "error": "Rate limit exceeded",
  "code": "RATE_LIMITED",
  "retry_after_seconds": 12
}
```

---

## Module-Specific Subscription Model

A school using only the loan module via API pays a different rate than a full platform subscriber:

| Module Access | Monthly Fee (ZMW) | Monthly Fee (USD) |
|---|---|---|
| Loan module only (API) | K275 | $10 |
| Communication API only | K138 | $5 + per-message credits |
| Fee tracking API (read) | K138 | $5 |
| Full API access (all modules) | K550 | $20 |
| Full platform (dashboard + API) | Standard tier pricing | Standard tier pricing |

Module subscriptions are tracked in a `module_subscriptions` table alongside the main `subscription_tier`. A school can have `{ loan_module_api: 'active', full_platform: 'inactive' }`.

---

## API Documentation Site

External API documentation is maintained separately from internal developer docs. Planned tooling: **Mintlify** or **Readme.io** — a hosted documentation site with interactive API explorer.

The API docs site is generated from OpenAPI specification files maintained in `docs/api/openapi.yaml`. Every new API endpoint must have a corresponding OpenAPI specification entry.

---

## Business Rules

1. API keys are never stored in plaintext. Only the SHA-256 hash is stored. The plaintext is shown once at creation and cannot be recovered.
2. Every API key has a scope list. Requests for data outside the key's scope return 403, not an empty result.
3. API key authentication and Clerk JWT authentication produce identical data access — the same school_id scoping applies regardless of authentication method.
4. Module API subscriptions are validated on every request. A school whose module subscription has lapsed receives 402 Payment Required until the subscription is renewed.
5. Outbound webhook requests from ZSMS to school systems are signed with HMAC-SHA256 using the school's registered webhook secret.
6. API keys can be created only by `org:owner` role users via the school settings panel. API key management is not available to other school roles.
7. All API key usage is logged in `audit_logs` with the key prefix and the action performed.

---

## Known Limitations and Future Work

- The public API in Phase 1 supports read operations and basic write operations. Full module-as-a-service (Tier 3 for loans) is a Phase 2 feature requiring the loan module to be completed first.
- The OpenAPI specification and external documentation site are Phase 2 deliverables. Phase 1 focus is the internal ZSMS platform.
- API key rotation (generating a new key while keeping the old one briefly active) is not supported in Phase 1. Schools must generate a new key and immediately update their integration.
- Webhook delivery to school systems uses a best-effort retry model (3 retries via the queue). No guaranteed delivery SLA in Phase 1.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 3 — modular API integration confirmed as strategic direction |
