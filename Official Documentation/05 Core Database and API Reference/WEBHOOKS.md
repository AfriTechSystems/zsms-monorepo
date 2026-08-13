# WEBHOOKS.md — Webhook Reference

## Related Documents

- `docs/api/ENDPOINTS.md` — webhook route definitions
- `docs/api/EDGE_FUNCTIONS.md` — Edge Functions that process webhooks
- `docs/api/ERROR_CODES.md` — error responses for failed webhook validation
- `docs/infra/META_API.md` — Meta webhook configuration
- `docs/infra/CLERK.md` — Clerk webhook configuration
- `docs/modules/fees/GATEWAY.md` — payment gateway webhook details
- `docs/modules/loans/LENDER_INTEGRATION.md` — lender webhook details
- `docs/ENV.md` — webhook secret environment variables

---

## Purpose

This document covers every webhook in ZSMS — both incoming webhooks (external services calling ZSMS) and outgoing webhooks (ZSMS calling school systems for API integration). Every webhook endpoint, its authentication method, payload structure, and processing logic is documented here. Claude Code reads this before implementing any webhook handler to ensure correct signature verification and payload handling.

---

## Incoming Webhooks

---

### Clerk User and Organisation Events

**URL:** `POST /api/webhooks/clerk`
**Sender:** Clerk
**Auth method:** Svix HMAC

**Signature verification:**
```typescript
import { Webhook } from 'https://esm.sh/svix@1'

const webhook = new Webhook(Deno.env.get('CLERK_WEBHOOK_SIGNING_SECRET')!)

const event = webhook.verify(rawBody, {
  'svix-id': req.headers.get('svix-id')!,
  'svix-timestamp': req.headers.get('svix-timestamp')!,
  'svix-signature': req.headers.get('svix-signature')!,
})
```

**Events and payloads:**

`user.created`
```json
{
  "type": "user.created",
  "data": {
    "id": "user_2abc123",
    "email_addresses": [{ "email_address": "teacher@school.zm" }],
    "phone_numbers": [{ "phone_number": "+260977123456" }],
    "first_name": "Chanda",
    "last_name": "Bwalya",
    "public_metadata": { "role": "parent", "school_id": "ZM-LSK-0001" }
  }
}
```

`organizationMembership.created`
```json
{
  "type": "organizationMembership.created",
  "data": {
    "id": "orgmem_abc",
    "role": "org:teacher",
    "organization": { "id": "org_ZM-LSK-0001", "slug": "zm-lsk-0001" },
    "public_user_data": { "user_id": "user_2abc123", "first_name": "Chanda" }
  }
}
```

`organizationMembership.deleted`
```json
{
  "type": "organizationMembership.deleted",
  "data": {
    "id": "orgmem_abc",
    "role": "org:teacher",
    "organization": { "id": "org_ZM-LSK-0001" },
    "public_user_data": { "user_id": "user_2abc123" }
  }
}
```

`session.created`
```json
{
  "type": "session.created",
  "data": {
    "user_id": "user_2abc123",
    "last_active_at": 1714089600
  }
}
```

**What ZSMS does:** See `docs/api/EDGE_FUNCTIONS.md` — `webhook-clerk` function.

---

### Flutterwave Payment Webhook

**URL:** `POST /api/webhooks/payment/flutterwave`
**Sender:** Flutterwave
**Auth method:** Custom header hash

**Signature verification:**
```typescript
const secretHash = Deno.env.get('FLUTTERWAVE_WEBHOOK_SECRET')!
const signature = req.headers.get('verif-hash')

if (signature !== secretHash) {
  return new Response('Unauthorized', { status: 401 })
}
```

**Payload:**
```json
{
  "event": "charge.completed",
  "data": {
    "id": 12345,
    "tx_ref": "ZSMS-TXN-REF-001",
    "flw_ref": "FLW-REF-001",
    "amount": 2500.00,
    "currency": "ZMW",
    "charged_amount": 2500.00,
    "status": "successful",
    "payment_type": "mobilemoney",
    "customer": {
      "name": "Chanda Bwalya",
      "phone_number": "+260977123456"
    }
  }
}
```

**ZSMS mapping:**
- `tx_ref` → maps to `payments.gateway_reference`
- `amount` → validates against `payments.amount`
- `status: "successful"` → triggers payment verification

---

### PawaPay Payment Webhook

**URL:** `POST /api/webhooks/payment/pawapay`
**Sender:** PawaPay
**Auth method:** HMAC-SHA256

**Signature verification:**
```typescript
import { createHmac } from 'https://deno.land/std/crypto/mod.ts'

const signature = req.headers.get('x-pawapay-signature')!
const computed = createHmac('sha256', Deno.env.get('PAWAPAY_WEBHOOK_SECRET')!)
  .update(rawBody)
  .digest('hex')

if (signature !== `sha256=${computed}`) {
  return new Response('Unauthorized', { status: 401 })
}
```

**Payload:**
```json
{
  "payoutId": "ZSMS-TXN-REF-001",
  "status": "COMPLETED",
  "amount": "2500.00",
  "currency": "ZMW",
  "country": "ZMB",
  "correspondent": "AIRTEL_ZAMBIA",
  "recipient": { "type": "MSISDN", "address": { "value": "260977123456" } },
  "customerTimestamp": "2026-09-15T10:23:00Z",
  "created": "2026-09-15T10:20:00Z"
}
```

**ZSMS mapping:**
- `payoutId` → maps to `payments.gateway_reference`
- `status: "COMPLETED"` → triggers payment verification
- `status: "FAILED"` → triggers payment failure notification

---

### DPO Payment Webhook

**URL:** `POST /api/webhooks/payment/dpo`
**Sender:** DPO Group
**Auth method:** XML payload with CompanyToken verification

**Payload:** XML format
```xml
<API3G>
  <Response>000</Response>
  <TransactionToken>TOKEN123</TransactionToken>
  <TransRef>ZSMS-TXN-REF-001</TransRef>
  <Amount>2500.00</Amount>
  <Currency>ZMW</Currency>
  <TransactionFinal>Y</TransactionFinal>
</API3G>
```

**Verification:**
```typescript
// DPO uses a verification API call rather than HMAC
// When webhook received, call DPO verify endpoint with TransactionToken
const verifyResponse = await fetch('https://secure.3gdirectpay.com/API/v6/', {
  method: 'POST',
  body: buildVerifyXml(transactionToken, Deno.env.get('DPO_COMPANY_TOKEN')!),
})
// Parse response — Response code '000' = verified
```

**ZSMS mapping:**
- `TransRef` → maps to `payments.gateway_reference`
- `Response: '000'` and `TransactionFinal: 'Y'` → triggers payment verification

---

### Pesapal Payment Webhook

**URL:** `POST /api/webhooks/payment/pesapal`
**Sender:** Pesapal
**Auth method:** Bearer token (Pesapal OAuth token)

**Signature verification:**
```typescript
// Pesapal sends a notification — ZSMS must call back to verify
const orderTrackingId = payload.OrderTrackingId
const merchantReference = payload.OrderMerchantReference

// Call Pesapal API to verify transaction status
const status = await pesapalVerifyTransaction(orderTrackingId)
```

**Payload:**
```json
{
  "OrderTrackingId": "PES-ORDER-123",
  "OrderMerchantReference": "ZSMS-TXN-REF-001",
  "OrderNotificationType": "IPNCHANGE"
}
```

---

### Airtel Money Webhook

**URL:** `POST /api/webhooks/payment/airtel_money`
**Sender:** Airtel Zambia
**Auth method:** HMAC-SHA256

**Payload:**
```json
{
  "transaction": {
    "id": "AIRTEL-TXN-001",
    "message": "Payment successful",
    "reference_id": "ZSMS-TXN-REF-001",
    "airtel_money_id": "AMZ-12345",
    "status": "TS"
  }
}
```

**Status codes:**
- `TS` = Transaction Successful
- `TF` = Transaction Failed
- `TP` = Transaction Pending

---

### MTN MoMo Webhook

**URL:** `POST /api/webhooks/payment/mtn_momo`
**Sender:** MTN Mobile Money API
**Auth method:** API key in header

**Signature verification:**
```typescript
const apiKey = req.headers.get('x-api-key')
const storedKey = Deno.env.get('MTN_MOMO_WEBHOOK_API_KEY')!
if (apiKey !== storedKey) {
  return new Response('Unauthorized', { status: 401 })
}
```

**Payload:**
```json
{
  "referenceId": "ZSMS-TXN-REF-001",
  "status": "SUCCESSFUL",
  "amount": "2500",
  "currency": "ZMW",
  "financialTransactionId": "MTN-FIN-12345",
  "externalId": "ZSMS-TXN-REF-001"
}
```

---

### Zanaco ZPay Webhook

**URL:** `POST /api/webhooks/payment/zanaco_zpay`
**Sender:** Zanaco
**Auth method:** HMAC-SHA256 with timestamp

**Signature verification:**
```typescript
const timestamp = req.headers.get('x-zanaco-timestamp')!
const signature = req.headers.get('x-zanaco-signature')!
const payload = `${timestamp}.${rawBody}`
const computed = createHmac('sha256', Deno.env.get('ZANACO_ZPAY_WEBHOOK_SECRET')!)
  .update(payload)
  .digest('hex')

if (signature !== computed) {
  return new Response('Unauthorized', { status: 401 })
}

// Reject if timestamp is more than 5 minutes old (replay attack prevention)
if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) {
  return new Response('Timestamp expired', { status: 401 })
}
```

**Payload:**
```json
{
  "reference": "ZSMS-TXN-REF-001",
  "status": "SUCCESS",
  "amount": 2500.00,
  "currency": "ZMW",
  "transactionId": "ZAN-TXN-12345",
  "timestamp": "2026-09-15T10:23:00Z"
}
```

---

### Meta WhatsApp Webhook

**URL:** `GET /api/webhooks/whatsapp` (verification) and `POST /api/webhooks/whatsapp` (events)
**Sender:** Meta
**Auth method:** HMAC-SHA256 on POST, verify token on GET

**GET — Webhook verification (one-time setup):**
```typescript
const mode = url.searchParams.get('hub.mode')
const token = url.searchParams.get('hub.verify_token')
const challenge = url.searchParams.get('hub.challenge')

if (mode === 'subscribe' && token === Deno.env.get('META_WEBHOOK_VERIFY_TOKEN')!) {
  return new Response(challenge, { status: 200 })
}
```

**POST — Signature verification:**
```typescript
const signature = req.headers.get('x-hub-signature-256')!
const computed = 'sha256=' + createHmac('sha256', Deno.env.get('META_WEBHOOK_APP_SECRET')!)
  .update(rawBody)
  .digest('hex')

if (signature !== computed) {
  return new Response('Unauthorized', { status: 401 })
}
```

**Inbound message payload:**
```json
{
  "entry": [{
    "changes": [{
      "value": {
        "messages": [{
          "from": "260977123456",
          "type": "text",
          "text": { "body": "FEES" },
          "timestamp": "1714089600"
        }]
      }
    }]
  }]
}
```

**Delivery status payload:**
```json
{
  "entry": [{
    "changes": [{
      "value": {
        "statuses": [{
          "id": "wamid.abc123",
          "status": "delivered",
          "timestamp": "1714089600",
          "recipient_id": "260977123456"
        }]
      }
    }]
  }]
}
```

---

### Loan Disbursement Webhook (Lending Partners)

**URL:** `POST /api/webhooks/loan`
**Sender:** MFI partner or bank
**Auth method:** HMAC-SHA256 using `LOAN_WEBHOOK_SECRET`

**Signature verification:**
```typescript
const signature = req.headers.get('x-zsms-signature')!
const computed = createHmac('sha256', Deno.env.get('LOAN_WEBHOOK_SECRET')!)
  .update(rawBody)
  .digest('hex')

if (signature !== `sha256=${computed}`) {
  return new Response('Unauthorized', { status: 401 })
}
```

**Payload:**
```json
{
  "event": "loan.disbursed",
  "lender_reference": "MFI-LOAN-REF-001",
  "application_id": "zsms-loan-uuid",
  "status": "disbursed",
  "disbursed_amount": 3500.00,
  "disbursement_reference": "MFI-DISB-001",
  "disbursed_at": "2026-09-15T10:23:00Z",
  "repayment_schedule": [
    { "due_date": "2026-10-01", "amount": 583.33 },
    { "due_date": "2026-11-01", "amount": 583.33 },
    { "due_date": "2026-12-01", "amount": 583.34 }
  ]
}
```

**Possible status values:** `approved`, `declined`, `disbursed`, `under_review`

---

## Outgoing Webhooks (ZSMS → School Systems)

For schools using the Tier 1 API integration, ZSMS sends event notifications to their registered webhook endpoints.

### Outgoing Webhook Delivery

```typescript
async function sendOutgoingWebhook(
  webhookUrl: string,
  secret: string,
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  const body = JSON.stringify({ event, data: payload, timestamp: new Date().toISOString() })
  const signature = createHmac('sha256', secret).update(body).digest('hex')

  // Queue via the queue for reliable delivery with retries
  await fetch(`${QSTASH_URL}/v2/publish/${webhookUrl}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${QSTASH_TOKEN}`,
      'Content-Type': 'application/json',
      'Upstash-Retries': '3',
      'x-zsms-signature': `sha256=${signature}`,
      'x-zsms-event': event,
    },
    body,
  })
}
```

### Events Sent to School Systems

| Event | Trigger | Payload |
|---|---|---|
| `payment.verified` | Accountant verifies a payment | `{ payment_id, student_id, amount, method, receipt_url }` |
| `payment.rejected` | Accountant rejects a payment | `{ payment_id, student_id, rejection_reason }` |
| `results.published` | Principal publishes term results | `{ academic_year, term_number, class_ids }` |
| `attendance.marked` | Daily attendance recorded | `{ class_id, date, absent_student_ids }` |
| `loan.disbursed` | Loan disbursement confirmed | `{ student_id, amount, fee_record_id }` |
| `student.created` | New student enrolled | `{ student_id, first_name, last_name, grade_id }` |

### School Webhook Registration

Schools register their endpoint and subscribe to specific events in school settings:

```sql
-- Example: school subscribes to payment events only
INSERT INTO public.school_webhooks (school_id, url, events, secret)
VALUES (
  'school-uuid',
  'https://school-system.example.com/zsms-events',
  ARRAY['payment.verified', 'payment.rejected'],
  'school-generated-secret'
);
```

---

## Webhook Failure Handling

### Incoming Webhooks

If ZSMS fails to process an incoming webhook (Edge Function error):
- The function returns a 500 response
- The sending service (Clerk, gateway, Meta) will retry based on their own retry policy
- Failed events appear in Sentry with the raw payload for investigation
- After max retries from the sender, the event is lost — manual recovery via the sender's dashboard

### Outgoing Webhooks

If delivery to a school system fails (HTTP error or timeout):
- the queue retries 3 times with exponential backoff (10s, 30s, 90s)
- After 3 failures, job enters the dead letter queue
- School is notified in-app: "Webhook delivery failed for [event]"
- AfriTech admin can replay failed events from the admin panel

---

## Business Rules

1. Every incoming webhook verifies its HMAC signature before any processing. A webhook without a valid signature returns 401 and is not processed.
2. Webhook endpoints are excluded from Clerk authentication middleware — they use HMAC for auth, not JWTs.
3. Timestamp replay attack prevention is applied on webhooks that include a timestamp in their signature (Zanaco ZPay). Webhooks older than 5 minutes are rejected.
4. Payment webhook processing is idempotent — if the same gateway_reference is received twice, the second delivery is detected as a duplicate and ignored (the payment already exists in the database).
5. Outgoing webhooks to school systems are delivered via the queue for reliable retry — never as direct HTTP calls from the Edge Function, which could fail without retry.
6. The `LOAN_WEBHOOK_SECRET` is shared with each lender during partnership setup. It must be rotated if the lender relationship changes.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 5 API reference documentation |
| 2026-04-26 | Added all seven payment gateway webhooks | Multi-gateway payment support confirmed |
| 2026-04-26 | Added outgoing webhook system | Tier 1 API integration for schools with existing systems |
