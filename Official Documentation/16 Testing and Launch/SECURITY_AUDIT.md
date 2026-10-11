# SECURITY_AUDIT.md — Pre-Launch Security Audit Checklist

## Related Documents

- `docs/RLS.md` — RLS policies being verified
- `docs/testing/TEST_STRATEGY.md` — RLS tests that automate some checks here
- `docs/testing/LAUNCH_CHECKLIST.md` — security audit referenced in go/no-go
- `docs/modules/auth/AUTH.md` — authentication implementation
- `docs/modules/auth/IMPERSONATION.md` — impersonation security model
- `docs/modules/fees/PAYMENTS.md` — payment security model
- `docs/modules/loans/SUBMISSION.md` — loan submission security model
- `docs/countries/ZM.md` — ZDPA compliance requirements

---

## Implementation Status (2026-10-11)

**This document is now a command: `npm run security:audit`.**

523 lines of pre-launch checks, most of which are questions the database answers in
milliseconds. A check nobody can run is a check nobody runs, so the mechanically
checkable half now executes against the live schema and reports four states:

| State | Meaning |
|---|---|
| **PASS** | verified against the live schema just now |
| **FAIL** | a finding; the command exits non-zero |
| **SUITE** | covered by a named pgTAP suite, which CI runs against a from-scratch database |
| **BLOCKED** | cannot be verified yet, with the blocker named |

**A BLOCKED item is not a pass.** The failure this guards against is a sign-off that
reads green because the unverifiable items were quietly omitted.

**First run: 15 pass, 1 fail, 7 suite-covered, 7 blocked.**

**The finding was real.** Check 1.4 — `authenticated` held `USAGE` on the `private`
schema. Fixed in `0262`, which also revokes the default privileges so a table created
there later does not arrive reachable.

**The severity was initially overstated, and that is worth recording.** The script's first
message said loan employer, income and payslip were exposed. They were not: `private` has
no table grants to end users, so a SELECT fails on the table privilege before RLS is
consulted. The real risk was narrower — with USAGE held, a future `GRANT` mistake becomes
immediately exploitable instead of still being blocked. **Overstating a finding is its own
defect**, because an audit that cries wolf is ignored on the day it is right.

Revoking USAGE is safe because all five functions reading `private` are SECURITY DEFINER
and run as owner. `0262` asserts each is still callable, because "the grant is gone" is not
the property that matters — "the loan module still works" is.

**The seven blocked checks** are the honest pre-launch list: three webhook verifications
(no gateway or Meta account), field encryption (`FIELD_ENCRYPTION_KEY` unset), CORS,
expired-session rejection, and `af-south-1` residency — dev is `eu-west-1` by documented
exception and staging and production do not exist.

---

## Purpose

This document is the pre-launch security audit checklist. It covers every security control that must be verified before any school data is stored in production. This is not a penetration test — it is a verification that the security controls designed in the documentation are correctly implemented. Run this checklist before every major release, not just at launch.

---

## Section 1 — RLS Policy Verification

RLS is the primary security control. Every check here must pass. If any fails, fix before launch.

### 1.1 School Data Isolation

```sql
-- Run these as the authenticated role for a parent at School A
-- All should return 0 rows

-- Test: Parent at School A cannot read School B students
SET LOCAL role = authenticated;
SET LOCAL request.jwt.claims = '{"sub": "parent_school_a_clerk_id", ...}';
SELECT COUNT(*) FROM students WHERE school_id = 'school_b_uuid';
-- Expected: 0

-- Test: Parent at School A cannot read School B fee records
SELECT COUNT(*) FROM fee_records WHERE school_id = 'school_b_uuid';
-- Expected: 0

-- Test: Parent at School A cannot read School B payments
SELECT COUNT(*) FROM payments WHERE school_id = 'school_b_uuid';
-- Expected: 0

-- Test: Teacher at School A cannot read School B attendance
SELECT COUNT(*) FROM attendance_records WHERE school_id = 'school_b_uuid';
-- Expected: 0
```

**Status:** ☐ Verified passing

---

### 1.2 Teacher Class Scoping

```sql
-- As teacher assigned only to Grade 9A:
-- Cannot see students in Grade 9B
SELECT COUNT(*) FROM students WHERE class_id = 'grade_9b';
-- Expected: 0

-- Cannot enter marks for Grade 9B
INSERT INTO exam_results (school_id, student_id, class_id, subject_code, ...)
VALUES ('school_uuid', 'student_9b_uuid', 'grade_9b', 'mathematics', ...);
-- Expected: RLS violation error

-- Cannot mark attendance for Grade 9B
INSERT INTO attendance_records (school_id, student_id, class_id, ...)
VALUES ('school_uuid', 'student_9b_uuid', 'grade_9b', ...);
-- Expected: RLS violation error
```

**Status:** ☐ Verified passing

---

### 1.3 Parent Access to Own Children Only

```sql
-- As parent of Student A only:
-- Cannot see Student B's fee records
SELECT COUNT(*) FROM fee_records WHERE student_id = 'student_b_uuid';
-- Expected: 0

-- Cannot see Student B's exam results
SELECT COUNT(*) FROM exam_results WHERE student_id = 'student_b_uuid';
-- Expected: 0

-- Cannot see Student B's attendance
SELECT COUNT(*) FROM attendance_records WHERE student_id = 'student_b_uuid';
-- Expected: 0
```

**Status:** ☐ Verified passing

---

### 1.4 Private Schema Inaccessibility

```sql
-- As any school-level role (teacher, accountant, owner):
SELECT * FROM private.loan_applications;
-- Expected: ERROR: permission denied for schema private

SELECT * FROM private.loan_consent_log;
-- Expected: ERROR: permission denied for schema private
```

**Verified via:** PostgREST returns 404 for any private schema table request (schema not exposed)

**Status:** ☐ Verified passing

---

### 1.5 Audit Log Immutability

```sql
-- As school owner (most privileged school role):
UPDATE audit_logs SET action = 'hacked' WHERE id = (SELECT id FROM audit_logs LIMIT 1);
-- Expected: ERROR: permission denied for table audit_logs

DELETE FROM audit_logs WHERE id = (SELECT id FROM audit_logs LIMIT 1);
-- Expected: ERROR: permission denied for table audit_logs
```

**Status:** ☐ Verified passing

---

### 1.6 Payments Table Immutability

```sql
-- As school accountant:
UPDATE payments SET amount = 999999 WHERE id = (SELECT id FROM payments LIMIT 1);
-- Expected: ERROR: permission denied (no UPDATE policy for non-admin roles)

DELETE FROM payments WHERE id = (SELECT id FROM payments LIMIT 1);
-- Expected: ERROR: permission denied (no DELETE policy for any role)
```

**Status:** ☐ Verified passing

---

### 1.7 Results Locked After Publication

```sql
-- As teacher — after results_published = TRUE:
UPDATE exam_results
SET marks_obtained = 100
WHERE student_id = 'student_uuid'
  AND results_published = TRUE;
-- Expected: 0 rows updated (RLS UPDATE policy blocks updates to published results)
```

**Status:** ☐ Verified passing

---

## Section 2 — Authentication and Session Security

### 2.1 Clerk JWT Verification

```bash
# Test: Invalid JWT returns 401
curl -X GET https://zsms.co.zm/api/students \
  -H "Authorization: Bearer invalid_token"
# Expected: 401 { "error": "Authentication required", "code": "UNAUTHORIZED" }
```

**Status:** ☐ Verified

---

### 2.2 Expired Session Rejection

```bash
# Test: Session token from 8 days ago is rejected for org:owner
# (org:owner max session = 7 days)
# Expected: 401 SESSION_EXPIRED
```

**Status:** ☐ Verified

---

### 2.3 API Key Authentication

```bash
# Test: Invalid API key returns 401
curl -X GET https://zsms.co.zm/api/v1/students \
  -H "Authorization: Bearer zsms_live_invalidkey"
# Expected: 401 { "code": "API_KEY_INVALID" }

# Test: Revoked API key returns 401
# Set is_active = FALSE for a test key, then try to use it
# Expected: 401 { "code": "API_KEY_INVALID" }

# Test: API key without required scope returns 403
# Use a key with only students:read, try to access fees
curl -X GET https://zsms.co.zm/api/v1/fees/student-uuid \
  -H "Authorization: Bearer zsms_live_students_only_key"
# Expected: 403 { "code": "INSUFFICIENT_SCOPE" }
```

**Status:** ☐ Verified

---

### 2.4 API Keys Stored as Hashes

```sql
-- Verify no plaintext API keys in database
SELECT COUNT(*) FROM school_api_keys
WHERE LENGTH(key_hash) != 64;  -- SHA-256 hash is always 64 hex chars
-- Expected: 0
```

**Status:** ☐ Verified

---

## Section 3 — Webhook Security

### 3.1 PawaPay HMAC Verification

```bash
# Test: Invalid signature returns 401
curl -X POST https://zsms.co.zm/api/webhooks/payment/pawapay \
  -H "x-pawapay-signature: sha256=invalid_signature" \
  -H "Content-Type: application/json" \
  -d '{"payoutId": "test", "status": "COMPLETED"}'
# Expected: 401 { "code": "WEBHOOK_SIGNATURE_INVALID" }
```

**Status:** ☐ Verified

---

### 3.2 Flutterwave Signature Verification

```bash
# Test: Missing verif-hash header returns 401
curl -X POST https://zsms.co.zm/api/webhooks/payment/flutterwave \
  -H "Content-Type: application/json" \
  -d '{"event": "charge.completed"}'
# Expected: 401
```

**Status:** ☐ Verified

---

### 3.3 Meta WhatsApp HMAC Verification

```bash
# Test: Invalid X-Hub-Signature-256 returns 401
curl -X POST https://zsms.co.zm/api/webhooks/whatsapp \
  -H "X-Hub-Signature-256: sha256=invalid" \
  -H "Content-Type: application/json" \
  -d '{"entry": []}'
# Expected: 401
```

**Status:** ☐ Verified

---

### 3.4 Clerk Webhook Svix Verification

```bash
# Test: Missing svix headers returns 401
curl -X POST https://zsms.co.zm/api/webhooks/clerk \
  -H "Content-Type: application/json" \
  -d '{"type": "user.created"}'
# Expected: 401
```

**Status:** ☐ Verified

---

## Section 4 — Sensitive Data Protection

### 4.1 Field-Level Encryption Verification

```sql
-- Verify loan_applications sensitive fields are encrypted (not plaintext)
SELECT
  monthly_income_encrypted,
  nrc_encrypted,
  payslip_urls_encrypted
FROM private.loan_applications
LIMIT 1;
-- Expected: All values are hex or base64 strings, NOT readable text like "K8500" or "123456/78/1"

-- Attempt to read as plaintext should produce garbage
SELECT monthly_income_encrypted::text FROM private.loan_applications LIMIT 1;
-- Expected: encrypted binary/hex — NOT a number
```

**Status:** ☐ Verified

---

### 4.2 Payment Gateway Credentials Encrypted

```sql
SELECT api_key_encrypted FROM payment_gateways LIMIT 5;
-- Expected: All values are encrypted — not readable API keys like "FLW..."
```

**Status:** ☐ Verified

---

### 4.3 R2 Private Bucket Access Control

```bash
# Test: Direct URL access to private bucket returns 403
curl https://zsms-private-zm.r2.cloudflarestorage.com/ZM-LSK-0001/loan-payslips/test.pdf
# Expected: 403 Access Denied (no public access policy)

# Test: Expired signed URL returns 403
# Generate a signed URL with 1-second expiry, wait 2 seconds, try to use it
# Expected: 403 URL expired
```

**Status:** ☐ Verified

---

### 4.4 Payment Proof Accessible Only to Authorised Roles

```bash
# Test: Parent cannot access another student's payment proof
# Get a signed URL for payment proof of Student A
# Try to use it as a parent of Student B (different Clerk JWT)
# Expected: The URL is R2-signed — it works for anyone who has it
# Security: The URL is never exposed to parents — only to accountants via dashboard
# Verify: Payment proof URL is NOT returned in the /api/fees/payments response to parents
```

**Status:** ☐ Verified

---

## Section 5 — API Security

### 5.1 Rate Limiting

```bash
# Test: 31 rapid requests to public search triggers rate limit
for i in $(seq 1 31); do
  curl -s -o /dev/null -w "%{http_code}\n" https://zsms.co.zm/api/schools/search?q=test
done
# Expected: First 30 return 200, 31st returns 429 with Retry-After header
```

**Status:** ☐ Verified

---

### 5.2 Confirmation Checkbox Freshness

```bash
# Test: confirmation_checkbox_at more than 10 minutes old returns 400
curl -X POST https://zsms.co.zm/api/fees/payments \
  -H "Authorization: Bearer valid_parent_jwt" \
  -d '{
    "fee_record_id": "valid-uuid",
    "amount": 2500,
    "payment_method": "mobile_money",
    "proof_of_payment_url": "valid-r2-key",
    "confirmation_checkbox_at": "2026-09-15T08:00:00Z"  // 3 hours ago
  }'
# Expected: 400 { "code": "MISSING_CONFIRMATION" }
```

**Status:** ☐ Verified

---

### 5.3 CORS Configuration

```bash
# Test: Cross-origin request from non-ZSMS domain is blocked
curl -X GET https://zsms.co.zm/api/students \
  -H "Origin: https://malicious-site.com" \
  -H "Authorization: Bearer valid_jwt"
# Expected: No Access-Control-Allow-Origin header for this origin
# Note: API routes don't need CORS for browser clients — Clerk auth handles this
```

**Status:** ☐ Verified

---

## Section 6 — Data Flow Verification (ZDPA Compliance)

### 6.1 Student PII in Supabase (af-south-1)

Verify that the following data exists ONLY in the `zsms-zm` Supabase project (af-south-1, South Africa):
- Student names and dates of birth
- Parent phone numbers and emails
- Fee records and payment amounts
- Exam results and attendance records
- Loan application data (private schema)

```bash
# Query the project ref to confirm region
curl https://api.supabase.com/v1/projects/zsms-zm-ref \
  -H "Authorization: Bearer service_role_key"
# Expected: "region": "af-south-1"
```

**Status:** ☐ Verified

---

### 6.2 Clerk Data Scope Confirmation

Clerk (US-based) contains ONLY:
- Email addresses
- Phone numbers
- Session tokens
- Clerk user IDs

Clerk does NOT contain:
- Student academic records ✓
- Fee or payment data ✓
- Loan application data ✓
- Attendance or results data ✓

Verify by logging into Clerk dashboard and confirming user metadata contains only IDs and roles — no substantive personal data beyond contact information.

**Status:** ☐ Verified

---

### 6.3 Consent Log for Loan Applications

```sql
-- Verify every submitted loan application has a corresponding consent log entry
SELECT COUNT(*) FROM private.loan_applications la
LEFT JOIN private.loan_consent_log lcl ON lcl.parent_user_id = la.parent_user_id
  AND lcl.lender_id = la.lender_id
  AND lcl.consented_at < la.submitted_at
WHERE la.status != 'abandoned'
  AND lcl.id IS NULL;
-- Expected: 0 (every application has consent)
```

**Status:** ☐ Verified

---

## Section 7 — Impersonation Security

### 7.1 Support Agent Cannot Write Without Grant

```bash
# Test: Support agent impersonating school owner tries to verify a payment
# (support agent has no write grant)
curl -X PATCH https://zsms.co.zm/api/fees/payments/payment-uuid/verify \
  -H "Authorization: Bearer impersonation_token_for_support_agent" \
  -d '{"action": "verify"}'
# Expected: 403 { "code": "IMPERSONATION_WRITE_RESTRICTED" }
```

**Status:** ☐ Verified

---

### 7.2 Every Impersonation Session Logged

```sql
-- Verify audit_logs has impersonation_start entry for every known test session
SELECT COUNT(*) FROM audit_logs
WHERE action = 'impersonation_start'
  AND created_at > NOW() - INTERVAL '7 days';
-- Expected: Matches number of test impersonation sessions conducted during security audit
```

**Status:** ☐ Verified

---

## Security Audit Sign-Off

```
Audit Date: ________________________
Auditor: Mwando Hamwenda (CTO)

Section 1 — RLS Policies:              PASS / FAIL  (failures: ___)
Section 2 — Authentication:            PASS / FAIL  (failures: ___)
Section 3 — Webhook Security:          PASS / FAIL  (failures: ___)
Section 4 — Sensitive Data:            PASS / FAIL  (failures: ___)
Section 5 — API Security:              PASS / FAIL  (failures: ___)
Section 6 — ZDPA Compliance:           PASS / FAIL  (failures: ___)
Section 7 — Impersonation:             PASS / FAIL  (failures: ___)

OVERALL: PASS / FAIL

Issues found and remediation plan:
___________________________________________

Signature: ________________________  Date: ____________
```

All sections must PASS before launch. Any failure is a hard blocker.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 16 testing and launch documentation |
| 2026-04-26 | Added ZDPA compliance data flow verification | Zambia data residency legal requirement |
| 2026-04-26 | Added school-specific WhatsApp credential encryption check | School-specific numbers store encrypted tokens |
| 2026-04-26 | Added consent log completeness check | Loan module legal requirement |
