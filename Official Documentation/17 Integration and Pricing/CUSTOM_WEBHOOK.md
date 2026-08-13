# CUSTOM_WEBHOOK.md — Custom Outbound Webhook Configuration

## Related Documents

- `docs/modules/integrations/INTEGRATIONS.md` — integrations framework overview
- `docs/modules/integrations/CRM_CONNECTORS.md` — custom webhook for CRM systems
- `docs/api/API_INTEGRATION.md` — inbound API and outbound webhooks (developer reference)
- `docs/api/WEBHOOKS.md` — outgoing webhook delivery via the queue
- `docs/DATABASE.md` — school_integrations, school_webhooks tables
- `docs/api/ERROR_CODES.md` — integration error handling

---

## Purpose

This document is the end-user guide for configuring custom outbound webhooks — how school IT admins and owners configure ZSMS to send event notifications to any external system. This complements `API_INTEGRATION.md` (the developer/technical reference) with the school-facing UI flow, event catalogue, payload formats, verification guide, and integration health monitoring. Every Claude Code session building the webhook configuration UI must read this document.

---

## Overview

A custom webhook lets schools connect ZSMS to any system that can receive HTTP POST requests — a custom ERP, a third-party school management tool, a no-code automation platform (Zapier, Make), or a developer's own backend. When a ZSMS event fires, ZSMS sends a signed HTTP POST to the configured URL with the event data as JSON.

The school's system uses the HMAC signature to verify the message came from ZSMS, then processes the event however it needs to.

---

## What Is a Custom Webhook vs a Pre-Built Connector?

| | Custom Webhook | Pre-Built Connector (Sage, QuickBooks, HubSpot) |
|---|---|---|
| Setup complexity | Low — enter a URL | Medium — OAuth flow + field mapping |
| Data transformation | Done by the school's system | Done by ZSMS automatically |
| Who needs to be involved | School IT or developer | School admin or accountant (no developer needed) |
| Best for | Custom systems, Zapier, any webhook-capable tool | Specific tools with ZSMS-managed integration |
| Authentication | HMAC signature verification | OAuth 2.0 |

---

## Setting Up a Custom Webhook

**Location:** Settings → Integrations → Custom Webhook → Add Webhook

### Step 1 — Enter Endpoint URL

```
Webhook Endpoint URL:
[https://your-system.example.com/zsms-webhook]

Requirements:
✓ Must start with https:// (secure connections only)
✓ Must return HTTP 200 within 10 seconds to confirm receipt
✓ Must be publicly accessible (not localhost or internal network)

[Test Connection →]
```

The "Test Connection" sends a `ping` event to verify the URL is reachable before saving:

```json
{
  "event": "zsms.ping",
  "zsms_school_id": "ZM-LSK-0001",
  "timestamp": "2026-09-15T10:00:00Z",
  "data": { "message": "ZSMS webhook connection test" }
}
```

If the URL returns 200 within 10 seconds: "Connection successful ✓"
If not reachable or returns non-200: "Connection failed — check your URL and try again"

### Step 2 — Copy Your Webhook Secret

```
Your Webhook Secret

This secret is used to verify that events come from ZSMS.
Copy it now — it will not be shown again.

zsms_whsec_a3f8k2m9p1q7r4s6t0v5w8x2y9z1b4c7d6e8f1...

[📋 Copy Secret]

Store this securely in your system's environment variables,
not in your code directly.

If you lose this secret, you can generate a new one in
Settings → Integrations → [Webhook Name] → Regenerate Secret.
Regenerating invalidates the previous secret immediately.
```

### Step 3 — Select Events to Forward

```
Which events should be forwarded to your system?

Student Events:
☑ student.created        New student enrolled
☑ student.updated        Student grade, class, or status changed
☐ student.transferred    Student transferred to another school
☐ student.graduated      Student graduated

Fee Events:
☑ payment.verified       Payment confirmed by accountant or gateway
☑ payment.rejected       Payment submission rejected
☐ payment.queried        Accountant requested more information
☐ fee_record.generated   New fee records created for a term

Academic Events:
☑ results.published      Term results made visible to parents
☐ attendance.marked      Daily attendance recorded (high volume — use with caution)
☐ report_card.generated  Report card PDFs generated

Communication Events:
☐ announcement.sent      School announcement dispatched

Finance Events:
☑ loan.disbursed         Loan funds sent to school account
☐ loan.status_changed    Loan application status updated

⚠️ High-volume events (attendance.marked) will generate one webhook call
per class per day. For a school with 12 classes, this is 12 calls/day.
Ensure your endpoint can handle this volume.
```

### Step 4 — Configure Payload Options

```
Payload Options:

Include full data:
● Full payload  — event data included in the webhook body
○ Minimal payload — event IDs only, your system fetches details via API

Full payload is recommended unless your system is rate-limited
or you need to filter data before storing it.

Additional headers (optional):
These headers will be added to every webhook request.
Useful for authentication with your system.

Header name          Value
Authorization        Bearer your-api-token-here
X-School-Tenant      ZM-LSK-0001
[Add header]

[Save Webhook]
```

### Step 5 — Active Webhook Confirmed

```
Custom Webhook Configured ✓

Name: My School ERP
Endpoint: https://your-system.example.com/zsms-webhook
Events: student.created, payment.verified, results.published
Status: Active

[View Event Log]   [Test Send]   [Edit]   [Pause]   [Delete]
```

---

## Verifying Webhook Signatures

Every webhook ZSMS sends includes an `X-ZSMS-Signature` header containing an HMAC-SHA256 signature of the request body.

**Why verification matters:** Without signature verification, any system on the internet could send fake events to your endpoint. Verification proves the event came from ZSMS.

### Verification Examples

**Node.js / JavaScript:**

```javascript
const crypto = require('crypto')

function verifyZsmsWebhook(rawBody, signatureHeader, secret) {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex')

  // Use timing-safe comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signatureHeader)
  )
}

// Express.js example
app.post('/zsms-webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-zsms-signature']
  const secret = process.env.ZSMS_WEBHOOK_SECRET

  if (!verifyZsmsWebhook(req.body, signature, secret)) {
    return res.status(401).send('Invalid signature')
  }

  const event = JSON.parse(req.body)
  // Process the event...
  res.status(200).send('OK')
})
```

**Python:**

```python
import hmac
import hashlib

def verify_zsms_webhook(payload_body: bytes, signature_header: str, secret: str) -> bool:
    expected = 'sha256=' + hmac.new(
        secret.encode('utf-8'),
        payload_body,
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header)

# Flask example
@app.route('/zsms-webhook', methods=['POST'])
def handle_zsms_webhook():
    signature = request.headers.get('X-ZSMS-Signature')
    secret = os.environ.get('ZSMS_WEBHOOK_SECRET')

    if not verify_zsms_webhook(request.get_data(), signature, secret):
        return 'Invalid signature', 401

    event = request.get_json()
    # Process the event...
    return 'OK', 200
```

**PHP:**

```php
function verifyZsmsWebhook($rawBody, $signatureHeader, $secret) {
    $expected = 'sha256=' . hash_hmac('sha256', $rawBody, $secret);
    return hash_equals($expected, $signatureHeader);
}

$rawBody = file_get_contents('php://input');
$signature = $_SERVER['HTTP_X_ZSMS_SIGNATURE'];
$secret = getenv('ZSMS_WEBHOOK_SECRET');

if (!verifyZsmsWebhook($rawBody, $signature, $secret)) {
    http_response_code(401);
    exit('Invalid signature');
}
```

---

## Complete Payload Reference

### Common Headers on Every Request

```
POST https://your-system.example.com/zsms-webhook
Content-Type: application/json
X-ZSMS-Signature: sha256=a3f8k2m9p1q7r4s6...
X-ZSMS-Event: payment.verified
X-ZSMS-School-ID: ZM-LSK-0001
X-ZSMS-Delivery-ID: del-uuid-123  ← unique per delivery attempt
```

### `student.created`

```json
{
  "event": "student.created",
  "zsms_school_id": "ZM-LSK-0001",
  "timestamp": "2026-09-15T09:00:00Z",
  "data": {
    "student_id": "STU-ZM-LSK-0001-00047",
    "first_name": "Chanda",
    "last_name": "Bwalya",
    "grade_id": "grade_9",
    "class_id": "grade_9a",
    "is_boarding": false,
    "enrolment_date": "2026-09-15",
    "status": "active"
  }
}
```

### `student.updated`

```json
{
  "event": "student.updated",
  "zsms_school_id": "ZM-LSK-0001",
  "timestamp": "2026-09-15T09:00:00Z",
  "data": {
    "student_id": "STU-ZM-LSK-0001-00047",
    "changed_fields": ["grade_id", "class_id"],
    "previous": { "grade_id": "grade_8", "class_id": "grade_8a" },
    "current": { "grade_id": "grade_9", "class_id": "grade_9a" }
  }
}
```

### `payment.verified`

```json
{
  "event": "payment.verified",
  "zsms_school_id": "ZM-LSK-0001",
  "timestamp": "2026-09-15T11:45:00Z",
  "data": {
    "payment_id": "pay-uuid",
    "receipt_number": "REC-ZM-LSK-0001-000042",
    "student_id": "STU-ZM-LSK-0001-00047",
    "student_name": "Chanda Bwalya",
    "grade_id": "grade_9a",
    "amount": 2500.00,
    "currency": "ZMW",
    "payment_method": "mobile_money",
    "fee_label": "Tuition Fee",
    "term_number": 2,
    "academic_year": "2026",
    "transaction_reference": "TXN20260915001234",
    "verified_at": "2026-09-15T11:45:00Z"
  }
}
```

### `payment.rejected`

```json
{
  "event": "payment.rejected",
  "zsms_school_id": "ZM-LSK-0001",
  "timestamp": "2026-09-15T11:45:00Z",
  "data": {
    "payment_id": "pay-uuid",
    "student_id": "STU-ZM-LSK-0001-00047",
    "amount": 2500.00,
    "currency": "ZMW",
    "fee_label": "Tuition Fee",
    "rejection_reason": "Transaction reference not found in our records",
    "rejected_at": "2026-09-15T11:45:00Z"
  }
}
```

### `results.published`

```json
{
  "event": "results.published",
  "zsms_school_id": "ZM-LSK-0001",
  "timestamp": "2026-09-15T14:00:00Z",
  "data": {
    "academic_year": "2026",
    "term_number": 2,
    "classes_published": ["grade_9a", "grade_9b", "grade_8a"],
    "students_count": 115,
    "published_by_role": "org:principal"
  }
}
```

### `loan.disbursed`

```json
{
  "event": "loan.disbursed",
  "zsms_school_id": "ZM-LSK-0001",
  "timestamp": "2026-09-18T09:30:00Z",
  "data": {
    "loan_application_id": "loan-uuid",
    "application_reference": "LAP-ZM-LSK-0001-000001",
    "student_id": "STU-ZM-LSK-0001-00047",
    "disbursed_amount": 3400.00,
    "currency": "ZMW",
    "fee_label": "Tuition Fee",
    "term_number": 2,
    "academic_year": "2026",
    "lender_reference": "MFI-LOAN-REF-001"
  }
}
```

---

## Retry and Failure Handling

ZSMS retries failed webhook deliveries via the queue:

| Attempt | Delay | Condition |
|---|---|---|
| 1 | Immediate | First delivery |
| 2 | 30 seconds | Non-2xx response or timeout |
| 3 | 5 minutes | Non-2xx response or timeout |
| 4 | 30 minutes | Non-2xx response or timeout |
| Dead letter | — | After 3 failures: logged as 'failed' in integration log |

**What counts as success:** Any HTTP 2xx response (200, 201, 202, 204).

**Your endpoint must respond within 10 seconds.** If processing takes longer, respond with 200 immediately and process asynchronously.

**Duplicate delivery prevention:** Each delivery attempt has a unique `X-ZSMS-Delivery-ID` header. Store and check this ID to handle duplicate deliveries idempotently (ZSMS retries can occasionally send the same event twice).

---

## Integration Event Log

**Location:** Settings → Integrations → [Webhook Name] → View Log

```
My School ERP — Event Log

Status filter: [All ▼]   Date: [Last 7 days ▼]

Date          Event              Status     Response  Actions
────────────────────────────────────────────────────────────
15 Sep 11:45  payment.verified   ✅ Success  200
15 Sep 10:23  student.created    ✅ Success  200
14 Sep 17:00  payment.verified   ❌ Failed   504       [Retry]
14 Sep 09:30  results.published  ✅ Success  200

Failed events remain in the log for 30 days.
[Retry all failed]   [Export log CSV]
```

Failed events can be retried individually (one click) or in bulk. Retrying sends the original event payload again — the receiving system should handle idempotently using the `X-ZSMS-Delivery-ID`.

---

## Regenerating the Webhook Secret

If a webhook secret is compromised or lost:

```
Settings → Integrations → [Webhook Name] → Security → Regenerate Secret

⚠️ Warning: Regenerating the secret will immediately invalidate the
current secret. All events will fail signature verification until
you update your system with the new secret.

We recommend:
1. Generate the new secret
2. Update your system with the new value
3. The changeover happens in seconds

[Generate New Secret]
```

The new secret is shown once. After closing the modal it cannot be retrieved — only regenerated again.

---

## Business Rules

1. Webhook URLs must use HTTPS. HTTP endpoints are rejected.
2. Webhook payloads for custom webhooks never include: NRC numbers, income figures, loan application PII, or any private schema data. Only public-facing ZSMS data is included.
3. Your endpoint must return a 2xx HTTP status within 10 seconds. Longer processing should be done asynchronously — respond 200 first, process later.
4. ZSMS retries failed deliveries 3 times with exponential backoff. After 3 failures the event is in the dead letter queue — manual retry is required.
5. Each delivery attempt has a unique `X-ZSMS-Delivery-ID`. Idempotent processing using this ID is strongly recommended to handle the rare case of duplicate delivery.
6. Pausing a webhook stops event dispatch immediately. Events that occur while paused are not retroactively delivered when the webhook is resumed.
7. Deleting a webhook removes the configuration and secret. The integration log entries are retained for 30 days. A deleted webhook cannot be restored — it must be recreated with a new secret.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Custom webhook UI guide — integration framework |
| 2026-04-26 | Added full payload reference for all events | Schools need exact payload format before building |
| 2026-04-26 | Added verification examples in 3 languages | Most common backend languages for Zambian school IT |
| 2026-04-26 | Added retry and duplicate handling guidance | queue retry behaviour is important for receiving systems |
