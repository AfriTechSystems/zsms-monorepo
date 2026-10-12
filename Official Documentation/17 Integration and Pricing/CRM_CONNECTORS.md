# CRM_CONNECTORS.md — CRM Connectors

## Related Documents

- `docs/modules/integrations/INTEGRATIONS.md` — integrations framework overview
- `docs/modules/integrations/CUSTOM_WEBHOOK.md` — custom webhook for any CRM
- `docs/modules/students/STUDENTS.md` — student creation events
- `docs/modules/students/PARENT_LINKING.md` — parent contact data
- `docs/DATABASE.md` — school_integrations config for CRM connectors

---

## Implementation Status (2026-10-11)

**Not built, and blocked on credentials rather than on engineering.**

`google_sheets` and `hubspot` are both valid `integration_type` values in
`school_integrations`, so the registry admits them. Neither has a dispatch path, and both
need OAuth or an API key that does not exist.

Scored as pending, not failing.

**Worth deciding before building either**, because it changes the shape: a CRM connector
pushes pupil and parent records to a third party. `COMPLIANCE.md` makes that a ZDPA
transfer, so it needs a lawful basis and probably a per-school consent — not just a
working OAuth flow. The accounting connectors push *financial* records, which is a
different and easier question.

That is the real reason to build the accounting side first, beyond the credentials.

---

## Purpose

This document defines the CRM connectors — HubSpot for enrollment marketing teams and the custom webhook connector for any other CRM. Every Claude Code session building a CRM connector must read this document.

---

## Overview

CRM integrations serve a different audience within the school than accounting integrations. Where accounting connectors serve the school accountant, CRM connectors serve the enrollment manager, marketing team, or school owner who tracks prospective and enrolled families.

The primary use case: a school uses HubSpot to manage their enrollment funnel — tracking prospective families from first inquiry through to enrollment. When a student is enrolled in ZSMS, HubSpot should automatically know about it. When fees are paid, the family's engagement level in HubSpot updates. This data helps the school understand which families are engaged and which may be at risk of not re-enrolling.

---

## Connector 1 — HubSpot

### Use Cases

**Enrollment tracking:**
A prospective family submits an inquiry form on the school's website (HubSpot form). The admission team manages the process in HubSpot (Deal pipeline: Inquiry → Application → Assessment → Enrolled). When the student is created in ZSMS, ZSMS moves the HubSpot deal to "Enrolled" automatically.

**Family engagement:**
Every time a parent logs into the ZSMS portal, pays a fee, or downloads a report card, it signals engagement. Schools can surface this in HubSpot as custom properties to identify engaged families vs those who are disengaged.

**Re-enrollment campaigns:**
Schools can segment families in HubSpot based on ZSMS data — families with outstanding fees, families whose children have excellent attendance, or families of upcoming Form 4 exam students — and run targeted re-enrollment or fee reminder campaigns.

### OAuth Setup

```
Settings → Integrations → Connect HubSpot
→ [Connect to HubSpot →]
→ HubSpot OAuth consent screen
→ Grant ZSMS permissions:
    - contacts (read/write)
    - deals (read/write)
    - custom properties (read/write)
→ Redirect back to ZSMS with OAuth code
→ Tokens encrypted and stored in school_integrations.credentials_enc
```

### Events and HubSpot Actions

**`student.created` → HubSpot Contact + Deal**

When a student is enrolled in ZSMS:

```typescript
async function syncStudentCreatedToHubSpot(
  student: Student,
  parent: Parent | null,
  config: HubSpotConfig
): Promise<void> {

  const hubspot = new HubSpotClient(credentials)

  // 1. Create or update the parent as a HubSpot Contact
  if (parent) {
    const contact = await hubspot.upsertContact({
      email: parent.email ?? undefined,
      phone: parent.phone_e164,
      firstname: parent.full_name?.split(' ')[0],
      lastname: parent.full_name?.split(' ').slice(1).join(' '),
      // Custom properties (configured per school)
      zsms_student_id: student.student_id,
      zsms_student_name: `${student.first_name} ${student.last_name}`,
      zsms_grade: student.grade_id,
      zsms_school: student.school_id,
      zsms_enrollment_date: student.enrolment_date,
    })

    // 2. If a pipeline is configured, move the deal to 'Enrolled' stage
    if (config.enrollment_pipeline_id && config.enrolled_stage_id) {
      const deal = await hubspot.findDealByContact(contact.id, config.enrollment_pipeline_id)
      if (deal) {
        await hubspot.updateDeal(deal.id, {
          dealstage: config.enrolled_stage_id,
          closedate: new Date().toISOString(),
        })
      }
    }
  }
}
```

**`payment.verified` → HubSpot Contact Property Update**

```typescript
async function syncPaymentToHubSpot(
  payment: Payment,
  student: Student,
  parent: Parent | null,
  config: HubSpotConfig
): Promise<void> {
  if (!parent?.email && !parent?.phone_e164) return

  const hubspot = new HubSpotClient(credentials)
  const contact = await hubspot.findContactByPhone(parent.phone_e164)
  if (!contact) return

  // Update custom properties to reflect payment activity
  await hubspot.updateContact(contact.id, {
    zsms_last_payment_date: payment.verified_at,
    zsms_last_payment_amount: payment.amount,
    zsms_fee_status: 'paid',  // or 'partial' — calculated from fee records
    zsms_last_active: new Date().toISOString(),
  })
}
```

**`student.updated` (grade promotion) → HubSpot Contact Property**

When a student moves to the next grade at year-end promotion:

```typescript
await hubspot.updateContact(contact.id, {
  zsms_grade: newGradeId,
  zsms_grade_updated: new Date().toISOString(),
})
```

### HubSpot Custom Properties Setup

ZSMS creates these custom contact properties in HubSpot on first connection:

| Property Name | Type | Description |
|---|---|---|
| `zsms_student_id` | String | ZSMS student ID |
| `zsms_student_name` | String | Student full name |
| `zsms_grade` | String | Current grade level |
| `zsms_school` | String | School ID |
| `zsms_enrollment_date` | Date | Date enrolled in ZSMS |
| `zsms_fee_status` | Enumeration | paid / partial / unpaid |
| `zsms_last_payment_date` | Date | Most recent verified payment |
| `zsms_last_payment_amount` | Number | Amount of last payment (ZMW) |
| `zsms_last_active` | Date | Last ZSMS portal activity |

The school can use these properties in HubSpot lists, workflows, and reports.

### Configuration

```typescript
interface HubSpotConfig {
  portal_id: string
  // Enrollment pipeline (optional)
  enrollment_pipeline_id?: string     // HubSpot Deal Pipeline ID
  enrolled_stage_id?: string          // Deal stage to move to on student.created
  // Custom property group
  property_group_name: string         // Default: 'ZSMS School Data'
  // Event subscriptions
  sync_on_payment: boolean            // Update contact on payment.verified
  sync_on_grade_promotion: boolean    // Update contact when grade changes
  sync_fee_status: boolean            // Keep fee status up to date in HubSpot
}
```

---

## Connector 2 — Custom CRM (Webhook)

For schools using any other CRM (Salesforce, Zoho, Microsoft Dynamics, a bespoke school ERP, or any webhook-capable system), the custom webhook connector sends ZSMS events to any HTTPS endpoint.

This is effectively the Tier 1 webhook system (`school_webhooks` table) surfaced in the integrations UI with a friendlier setup experience. The underlying mechanism is identical — ZSMS signs the payload with HMAC-SHA256 and POSTs to the configured URL.

### When to Use Custom Webhook Instead of HubSpot

- School uses Salesforce, Zoho, or any other named CRM
- School has a custom-built school management system that needs to stay in sync with ZSMS
- School has a developer who will handle the mapping on their end
- School wants to receive events in a no-code platform (Zapier, Make — before a ZSMS Zapier app exists)

### Configuration

```typescript
interface CustomWebhookConfig {
  url: string                     // HTTPS endpoint to POST events to
  secret: string                  // School's HMAC secret — shown once, store it
  events: string[]                // Events to forward
  include_full_payload: boolean   // TRUE: send full event data
                                  // FALSE: send minimal (IDs only — school fetches details via API)
  headers?: Record<string, string> // Optional additional headers (e.g. API key)
}
```

### Setup Flow

```
Settings → Integrations → Custom Webhook → Connect

Endpoint URL: [https://your-system.example.com/zsms-events]

Events to forward:
☑ student.created        ☑ payment.verified
☑ student.updated        ☑ payment.rejected
☐ attendance.marked      ☑ results.published
☐ fee_record.generated   ☑ loan.disbursed

Authentication:
Your webhook secret (copy and save this — it will not be shown again):
[zsms_whsec_a3f8k2m9p1q7r4s6...]  [Copy]

Your system must verify the X-ZSMS-Signature header using this secret.
See the verification guide in our developer documentation.

[Test Connection]   [Save and Activate]
```

### Payload Format

```json
{
  "event": "payment.verified",
  "zsms_school_id": "ZM-LSK-0001",
  "timestamp": "2026-09-15T11:45:00Z",
  "data": {
    "payment_id": "pay-uuid",
    "receipt_number": "REC-ZM-LSK-0001-000042",
    "student_id": "STU-ZM-LSK-0001-00042",
    "student_name": "Chanda Bwalya",
    "grade_id": "grade_9a",
    "amount": 2500.00,
    "currency": "ZMW",
    "payment_method": "mobile_money",
    "fee_label": "Tuition Fee",
    "term_number": 2,
    "academic_year": "2026",
    "verified_at": "2026-09-15T11:45:00Z"
  }
}
```

**Minimal payload mode** (`include_full_payload: false`):
```json
{
  "event": "payment.verified",
  "zsms_school_id": "ZM-LSK-0001",
  "timestamp": "2026-09-15T11:45:00Z",
  "data": {
    "payment_id": "pay-uuid",
    "student_id": "STU-ZM-LSK-0001-00042"
  }
}
```

In minimal mode, the receiving system uses the ZSMS API (with an API key) to fetch full details. This reduces data exposure in transit.

### HMAC Verification

The receiving system verifies the `X-ZSMS-Signature` header:

```python
# Python example for the school's receiving system
import hmac, hashlib

def verify_zsms_webhook(payload_body, signature_header, secret):
    expected = 'sha256=' + hmac.new(
        secret.encode('utf-8'),
        payload_body,
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header)
```

---

## Phase 3 — Zapier and Make Integration

When ZSMS has sufficient school volume to justify the development overhead:

**Zapier App:** ZSMS publishes a Zapier integration with triggers for every ZSMS event and actions for creating/updating ZSMS records. Schools can then connect ZSMS to any of 5,000+ apps on Zapier without any coding.

**Make (formerly Integromat):** Same concept on the Make platform.

This is documented here as planned (Phase 3) — the integration framework built in Phase 2 provides the foundation.

---

## Business Rules

1. HubSpot CRM sync is always secondary — ZSMS operations never wait for HubSpot to respond. A HubSpot API outage does not affect school operations.
2. HubSpot custom properties are created by ZSMS on first connection using the configured property group name. The school can view and use these properties immediately.
3. The custom webhook connector and the `school_webhooks` table share the same dispatch infrastructure. The difference is the configuration UI — custom webhook uses the integrations panel, school_webhooks uses the API integration panel (for developer-facing configurations).
4. Webhook payloads for the custom CRM connector never include: NRC numbers, income figures, loan application details, or any private schema data. Sensitive fields are excluded regardless of `include_full_payload` setting.
5. All CRM connector OAuth tokens are encrypted using `GATEWAY_ENCRYPTION_KEY`. Plaintext tokens never appear in logs or API responses.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | CRM integration confirmed |
| 2026-04-26 | Added HubSpot enrollment pipeline integration | Primary use case for Zambian private school marketing teams |
| 2026-04-26 | Added custom webhook as CRM fallback | Works for any webhook-capable CRM |
| 2026-04-26 | Added Phase 3 Zapier/Make note | Future platform expansion planned |
