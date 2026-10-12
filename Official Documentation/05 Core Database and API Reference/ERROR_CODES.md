# ERROR_CODES.md — Error Code Reference

## Related Documents

- `docs/api/ENDPOINTS.md` — endpoints that return these errors
- `docs/api/EDGE_FUNCTIONS.md` — Edge Functions that throw these errors
- `docs/api/RATE_LIMITS.md` — rate limit error specifics
- `docs/CONVENTIONS.md` — standard error response shape

---

## Implementation Status (2026-10-11)

**This document defines 36 codes; the API envelope admits nine.**

That is deliberate, and the split is worth stating. The envelope's `code` is the
*category* a client branches on, and a client branching on thirty-six values breaks when
a thirty-seventh arrives. The six HTTP-shaped ones —
`VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `SERVER_ERROR`
— cover nearly everything.

Three more were added on 2026-10-11 because code in this repository was already returning
them on the wire, and a type that does not admit what it sends is a type disagreeing with
reality:

- `RATE_LIMITED` (429) — returned by the middleware limiter and by the per-key limiter.
- `INSUFFICIENT_SCOPE` (403) — returned by `/api/v1/`. Actionable where `FORBIDDEN` is
  not: it tells an integrator *which scope* to ask for rather than to ask their school
  for access they may already have.
- `API_KEY_INVALID` (401) — one answer for a missing, malformed, revoked or expired key,
  so a prober learns nothing about which keys are real.

**The remaining 27 are domain codes and belong in the message or in `details`**, not in
the envelope's `code`. `DUPLICATE_STUDENT` and `FEE_ALREADY_PAID` tell a human what went
wrong; `CONFLICT` tells a client what to do about it, and both can travel together.

---

## Purpose

This document defines every error code used across the ZSMS API layer. All errors follow a consistent shape. Claude Code reads this before implementing any error handling to ensure consistent codes, messages, and HTTP status codes across all endpoints and Edge Functions.

---

## Standard Error Shape

Every error response — from API routes and Edge Functions — follows this exact structure:

```typescript
type ApiError = {
  error: string                           // Human-readable message for display
  code: string                            // Machine-readable code for programmatic handling
  details?: Record<string, string>        // Field-level validation errors
  retry_after_seconds?: number            // Present on RATE_LIMITED errors only
}
```

**Examples:**

```json
// Validation error with field details
{
  "error": "Validation failed",
  "code": "VALIDATION_ERROR",
  "details": {
    "first_name": "First name is required",
    "phone_e164": "Phone number must be in E.164 format (+260XXXXXXXXX)"
  }
}

// Rate limit error
{
  "error": "Too many requests",
  "code": "RATE_LIMITED",
  "retry_after_seconds": 12
}

// Business logic error
{
  "error": "Results have already been published for this term",
  "code": "RESULTS_ALREADY_PUBLISHED"
}
```

---

## HTTP Status Code Reference

| Status | When Used |
|---|---|
| 200 | Successful GET, PATCH, PUT |
| 201 | Successful POST (resource created) |
| 202 | Request accepted, processing asynchronously (bulk jobs) |
| 400 | Validation error — invalid input, missing required field |
| 401 | Not authenticated — no token, expired token, invalid API key |
| 402 | Payment required — subscription lapsed, quota exceeded |
| 403 | Authenticated but not permitted — wrong role, wrong school, impersonation restriction |
| 404 | Resource not found (also used when existence should not be revealed to the caller) |
| 409 | Conflict — duplicate entry, resource already exists |
| 422 | Business logic failure — action not possible given current data state |
| 429 | Rate limit exceeded |
| 500 | Unexpected server error — never exposes raw error details |
| 503 | Service temporarily unavailable — external dependency down |

---

## Authentication Errors (401)

### `UNAUTHORIZED`
No authentication provided or authentication is invalid.

**When thrown:** No `Authorization` header, expired Clerk JWT, invalid API key hash
**HTTP status:** 401
**Client action:** Redirect to sign-in or prompt user to re-authenticate
**Retryable:** Yes — after re-authentication

```json
{ "error": "Authentication required", "code": "UNAUTHORIZED" }
```

---

### `SESSION_EXPIRED`
The Clerk session has expired beyond the role's allowed duration.

**When thrown:** Middleware detects session age exceeds role limit (e.g. school owner session older than 7 days)
**HTTP status:** 401
**Client action:** Redirect to sign-in page with `?session_expired=true` query param to show appropriate message

```json
{ "error": "Your session has expired. Please sign in again.", "code": "SESSION_EXPIRED" }
```

---

### `API_KEY_INVALID`
The provided API key does not exist or has been revoked.

**When thrown:** API key hash not found in `school_api_keys` table or `is_active = FALSE`
**HTTP status:** 401

```json
{ "error": "Invalid or revoked API key", "code": "API_KEY_INVALID" }
```

---

### `API_KEY_EXPIRED`
The API key's `expires_at` has passed.

**When thrown:** API key found but `expires_at < NOW()`
**HTTP status:** 401

```json
{ "error": "API key has expired", "code": "API_KEY_EXPIRED" }
```

---

### `WEBHOOK_SIGNATURE_INVALID`
Webhook HMAC signature does not match.

**When thrown:** Any webhook endpoint when signature verification fails
**HTTP status:** 401
**Client action:** N/A — webhook senders handle retries

```json
{ "error": "Invalid webhook signature", "code": "WEBHOOK_SIGNATURE_INVALID" }
```

---

### `WEBHOOK_TIMESTAMP_EXPIRED`
Webhook timestamp is too old (replay attack prevention).

**When thrown:** Webhooks with timestamp-based signatures (Zanaco ZPay) when timestamp > 5 minutes old
**HTTP status:** 401

```json
{ "error": "Webhook timestamp expired", "code": "WEBHOOK_TIMESTAMP_EXPIRED" }
```

---

## Permission Errors (403)

### `FORBIDDEN`
Authenticated but not permitted for this action.

**When thrown:** Clerk role check fails, school_permissions check fails, or scope check fails for AfriTech team member
**HTTP status:** 403

```json
{ "error": "You do not have permission to perform this action", "code": "FORBIDDEN" }
```

---

### `INSUFFICIENT_SCOPE`
API key does not have the required scope for this endpoint.

**When thrown:** API key authentication succeeds but the key's `scopes` array does not include the required scope
**HTTP status:** 403

```json
{ "error": "This API key does not have the required scope", "code": "INSUFFICIENT_SCOPE" }
```

---

### `WRONG_SCHOOL`
Attempting to access data belonging to a different school.

**When thrown:** Should rarely reach the API layer — RLS catches this at the database. If it does reach the API layer (e.g. explicit school_id in request body that differs from JWT school), this code is returned.
**HTTP status:** 403

```json
{ "error": "Access to this school's data is not permitted", "code": "WRONG_SCHOOL" }
```

---

### `IMPERSONATION_WRITE_RESTRICTED`
Write action attempted during a read-only impersonation session.

**When thrown:** Support agent or regional manager impersonation session attempts any write operation
**HTTP status:** 403

```json
{
  "error": "Write actions are not available in this support view. Contact your manager to request temporary write access.",
  "code": "IMPERSONATION_WRITE_RESTRICTED"
}
```

---

### `PRIVATE_SCHEMA_FORBIDDEN`
Attempt to access the private schema from a school-level role.

**When thrown:** Any school-level role attempts to access loan PII directly
**HTTP status:** 403

```json
{
  "error": "This data is not accessible through the standard API",
  "code": "PRIVATE_SCHEMA_FORBIDDEN"
}
```

---

## Validation Errors (400)

### `VALIDATION_ERROR`
One or more request fields failed validation.

**When thrown:** Zod schema validation fails on request body or query params
**HTTP status:** 400
**Client action:** Show field-level errors from `details` object

```json
{
  "error": "Validation failed",
  "code": "VALIDATION_ERROR",
  "details": {
    "amount": "Amount must be a positive number",
    "payment_method": "Payment method must be one of: cash, bank_deposit, online_gateway, mobile_money"
  }
}
```

---

### `MISSING_CONFIRMATION`
Financial submission missing the required confirmation checkbox timestamp.

**When thrown:** Payment or loan submission request missing `confirmation_checkbox_at` field
**HTTP status:** 400
**Client action:** Show error on the confirmation checkbox, re-enable submit

```json
{
  "error": "Confirmation is required before submitting",
  "code": "MISSING_CONFIRMATION"
}
```

---

### `MISSING_PROOF_OF_PAYMENT`
Fee payment submission missing proof of payment.

**When thrown:** Payment submission request missing `proof_of_payment_url`
**HTTP status:** 400
**Client action:** Prompt user to upload proof of payment

```json
{
  "error": "Proof of payment is required",
  "code": "MISSING_PROOF_OF_PAYMENT"
}
```

---

### `INVALID_PHONE_FORMAT`
Phone number not in E.164 format.

**When thrown:** Phone number field fails E.164 validation
**HTTP status:** 400

```json
{
  "error": "Validation failed",
  "code": "VALIDATION_ERROR",
  "details": { "phone_e164": "Phone number must be in E.164 format. Example: +260977123456" }
}
```

---

### `INVALID_STUDENT_ID`
Student ID format does not match expected pattern.

**When thrown:** student_id field fails STU-XX-XXX-XXXX-XXXXX format check
**HTTP status:** 400

```json
{
  "error": "Validation failed",
  "code": "VALIDATION_ERROR",
  "details": { "student_id": "Student ID format is invalid. Expected format: STU-ZM-LSK-0001-00042" }
}
```

---

### `FILE_TOO_LARGE`
Uploaded file exceeds the size limit for its type.

**When thrown:** `generate-upload-url` function receives file_size exceeding the limit
**HTTP status:** 400

```json
{
  "error": "File is too large",
  "code": "FILE_TOO_LARGE",
  "details": { "file_size": "Payment proof images must be under 10MB" }
}
```

---

### `INVALID_FILE_TYPE`
Uploaded file MIME type not permitted.

**When thrown:** content_type not in the allowed list for the requested file_type
**HTTP status:** 400

```json
{
  "error": "File type not permitted",
  "code": "INVALID_FILE_TYPE",
  "details": { "content_type": "Accepted types: image/jpeg, image/png, application/pdf" }
}
```

---

## Not Found Errors (404)

### `NOT_FOUND`
The requested resource does not exist or the caller does not have permission to know it exists.

**When thrown:** Database query returns no rows. Also used when a resource exists but RLS would deny access — returning 403 in this case would reveal the resource's existence.
**HTTP status:** 404

```json
{ "error": "Resource not found", "code": "NOT_FOUND" }
```

---

### `SCHOOL_NOT_FOUND`
School ID not found in the public directory.

**When thrown:** Public school search by school_id returns no result
**HTTP status:** 404
**Client action:** Show "School not found. Check the School ID and try again."

```json
{ "error": "School not found", "code": "SCHOOL_NOT_FOUND" }
```

---

### `STUDENT_NOT_FOUND`
Student ID lookup returns no matching student.

**When thrown:** Parent login flow — student ID entered does not match any student
**HTTP status:** 404
**Client action:** Show "Student ID not found. Check the ID or contact your school."

```json
{ "error": "Student not found", "code": "STUDENT_NOT_FOUND" }
```

---

## Conflict Errors (409)

### `DUPLICATE_STUDENT`
Student with same name and date of birth already exists at this school.

**When thrown:** Bulk import or manual student creation detects a possible duplicate
**HTTP status:** 409
**Client action:** Show duplicate warning with existing student details. Require explicit confirmation to proceed.

```json
{
  "error": "A student with this name and date of birth may already exist",
  "code": "DUPLICATE_STUDENT",
  "details": { "existing_student_id": "STU-ZM-LSK-0001-00042" }
}
```

---

### `DUPLICATE_TRANSACTION_REFERENCE`
Transaction reference already exists in the payment ledger.

**When thrown:** Fee payment submission with a `transaction_reference` that already exists for this school
**HTTP status:** 409
**Client action:** Show warning "This transaction reference has already been submitted. Are you sure this is a different payment?" Require explicit `force: true` in request to proceed.

```json
{
  "error": "This transaction reference has already been submitted",
  "code": "DUPLICATE_TRANSACTION_REFERENCE",
  "details": { "existing_payment_id": "payment-uuid" }
}
```

---

### `ATTENDANCE_ALREADY_RECORDED`
Attendance for this student on this date already exists.

**When thrown:** Second attendance entry attempt for the same student + date combination (unique constraint violation)
**HTTP status:** 409
**Client action:** Show current attendance status and ask if user wants to update it

```json
{
  "error": "Attendance has already been recorded for this student today",
  "code": "ATTENDANCE_ALREADY_RECORDED",
  "details": { "current_status": "present" }
}
```

---

## Business Logic Errors (422)

### `RESULTS_ALREADY_PUBLISHED`
Attempt to modify exam results after they have been published.

**When thrown:** Teacher attempts to update marks after principal has published results for the term
**HTTP status:** 422
**Client action:** Show "Results have been published. Contact your principal to make corrections."

```json
{
  "error": "Results have already been published for this term",
  "code": "RESULTS_ALREADY_PUBLISHED"
}
```

---

### `LOAN_ALREADY_PENDING`
Parent already has an active loan application for this fee record.

**When thrown:** `loan-submit` detects an existing non-declined application for the same fee_record_id
**HTTP status:** 422
**Client action:** Show existing application status and reference number

```json
{
  "error": "A loan application is already in progress for this fee",
  "code": "LOAN_ALREADY_PENDING",
  "details": { "existing_reference": "MFI-LOAN-REF-001", "status": "submitted" }
}
```

---

### `FEE_ALREADY_PAID`
Fee record is already fully paid.

**When thrown:** Payment attempted against a fee_record where status is 'paid' or 'loan_paid'
**HTTP status:** 422
**Client action:** Show current payment status and offer to record an additional payment with explicit confirmation

```json
{
  "error": "This fee has already been paid in full",
  "code": "FEE_ALREADY_PAID",
  "details": { "current_status": "paid", "amount_paid": "2500.00" }
}
```

---

### `SCHOOL_SUSPENDED`
School account is suspended — data entry not permitted.

**When thrown:** Any write operation attempted at a suspended school
**HTTP status:** 422
**Client action:** Show "Your school account is suspended. Contact AfriTech Systems for assistance." with AfriTech contact details

```json
{
  "error": "School account is suspended",
  "code": "SCHOOL_SUSPENDED"
}
```

---

### `TRIAL_EXPIRED`
School trial period has ended without subscribing.

**When thrown:** Write operation attempted at a school where `status = 'trial_expired'`
**HTTP status:** 422
**Client action:** Show upgrade prompt with subscription options

```json
{
  "error": "Your trial period has ended. Please subscribe to continue using ZSMS.",
  "code": "TRIAL_EXPIRED"
}
```

---

### `LAST_OWNER_REMOVAL`
Attempt to remove the only school owner from the organisation.

**When thrown:** Staff removal attempt when the target user is the last `org:owner`
**HTTP status:** 422
**Client action:** "You cannot remove the only school owner. Assign ownership to another user first."

```json
{
  "error": "Cannot remove the last school owner",
  "code": "LAST_OWNER_REMOVAL"
}
```

---

### `MARKS_MISSING`
Attempt to publish results or generate report cards when some students have missing marks.

**When thrown:** Results publish or report generation when not all students have marks for all subjects
**HTTP status:** 422
**Client action:** Show list of students/subjects with missing marks

```json
{
  "error": "Some students have missing marks for this term",
  "code": "MARKS_MISSING",
  "details": {
    "missing_count": "5",
    "students": "STU-001, STU-002, STU-003, STU-004, STU-005"
  }
}
```

---

## Payment and Subscription Errors (402)

### `WHATSAPP_QUOTA_EXCEEDED`
School's WhatsApp message quota for the current billing period is exhausted.

**When thrown:** WhatsApp message enqueue attempt when quota is at zero
**HTTP status:** 402
**Client action:** Show quota upgrade prompt

```json
{
  "error": "WhatsApp message quota for this period has been reached",
  "code": "WHATSAPP_QUOTA_EXCEEDED",
  "details": { "quota_used": "500", "quota_limit": "500", "resets_at": "2026-10-01" }
}
```

---

### `MODULE_NOT_SUBSCRIBED`
API key attempting to access a module the school is not subscribed to.

**When thrown:** External API call for a module the school has no active subscription for
**HTTP status:** 402

```json
{
  "error": "This module is not included in your current subscription",
  "code": "MODULE_NOT_SUBSCRIBED"
}
```

---

## Rate Limit Errors (429)

### `RATE_LIMITED`
Too many requests in the current time window.

**When thrown:** Upstash Redis rate limiter triggers
**HTTP status:** 429
**Client action:** Wait `retry_after_seconds` before retrying

```json
{
  "error": "Too many requests. Please slow down.",
  "code": "RATE_LIMITED",
  "retry_after_seconds": 12
}
```

---

## Server Errors (500 / 503)

### `SERVER_ERROR`
Unexpected server-side error.

**When thrown:** Any unhandled exception in an API route or Edge Function
**HTTP status:** 500
**Client action:** Show generic error message. Do not show technical details.
**Note:** Raw error details are never exposed to the client. They are logged to Sentry.

```json
{ "error": "An unexpected error occurred. Please try again.", "code": "SERVER_ERROR" }
```

---

### `EXTERNAL_SERVICE_UNAVAILABLE`
A required external service (Meta API, Twilio, R2) is unavailable.

**When thrown:** External API call times out or returns a 5xx response
**HTTP status:** 503
**Client action:** Show "Service temporarily unavailable. Please try again in a few minutes."

```json
{
  "error": "A required service is temporarily unavailable",
  "code": "EXTERNAL_SERVICE_UNAVAILABLE",
  "details": { "service": "whatsapp" }
}
```

---

## Business Rules

1. Raw database errors are never exposed to the client. All database errors are caught and mapped to the appropriate error code before responding.
2. The `details` field is present only on `VALIDATION_ERROR` responses. No other error code includes `details`.
3. `NOT_FOUND` is used even when the resource exists but the caller lacks permission — to avoid revealing resource existence to unauthorised callers.
4. `retry_after_seconds` is present only on `RATE_LIMITED` responses. Its value is calculated from the Upstash Redis window reset time.
5. All 500-level errors are logged to Sentry with full context before the sanitised response is returned to the client.
6. Error messages in the `error` field are written in plain English suitable for display to end users — not technical jargon.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 5 API reference documentation |
| 2026-04-26 | Added MISSING_CONFIRMATION and MISSING_PROOF_OF_PAYMENT | Payment confirmation workflow without OTP |
| 2026-04-26 | Added WHATSAPP_QUOTA_EXCEEDED and MODULE_NOT_SUBSCRIBED | Tiered messaging quotas and modular API |
| 2026-04-26 | Added DUPLICATE_TRANSACTION_REFERENCE | Fraud mitigation for payment submissions |
