# GATEWAY.md — Payment Gateway Configuration

## Related Documents

- `docs/modules/fees/PAYMENTS.md` — how gateway payments flow into the payment system
- `docs/modules/fees/RECEIPTS.md` — receipts generated from gateway-verified payments
- `docs/api/WEBHOOKS.md` — webhook handlers for each gateway
- `docs/api/EDGE_FUNCTIONS.md` — webhook-payment Edge Function
- `docs/DATABASE.md` — payment_gateways table
- `docs/ENV.md` — GATEWAY_ENCRYPTION_KEY
- `docs/infra/META_API.md` — WhatsApp confirmation after gateway payment

---

## Purpose

This document covers payment gateway configuration from the school's perspective — how schools connect their gateway accounts, how multiple gateways work simultaneously, how the parent payment page presents gateway options, and how gateway webhooks flow into the payment verification system. Every Claude Code session building gateway configuration or the parent payment page must read this document.

---

## Overview

ZSMS never processes payments on behalf of schools. Schools connect their own registered gateway accounts. Funds flow directly from the parent through the gateway to the school's bank account. ZSMS only records the confirmed outcome via webhook and generates the receipt.

AfriTech earns no transaction fees from school fee payments. Revenue comes from subscription fees only.

---

## Supported Gateways

| Gateway | Type | Primary Market | Integration Method |
|---|---|---|---|
| Flutterwave | Card, bank, mobile money | Pan-Africa | REST API + webhook |
| PawaPay | Mobile money (Airtel, MTN, Zamtel) | Zambia + 8 African markets | REST API + webhook |
| DPO (Direct Pay Online) | Card, mobile money | Pan-Africa | REST API (XML) + webhook |
| Pesapal | Card, mobile money | East/Southern Africa | REST API + webhook |
| Airtel Money | Mobile money | Zambia | REST API + webhook |
| MTN MoMo | Mobile money | Zambia + West/Central Africa | REST API + webhook |
| Zanaco ZPay | Bank transfer | Zambia | REST API + webhook |

New gateways are added by extending the `webhook-payment` Edge Function and updating the `gateway_name` CHECK constraint in a new migration. No architectural changes are required.

---

## Gateway Configuration UI

**Location:** Settings → Payment Gateways

The gateway settings page shows all supported gateways. Each appears as a card with connection status.

### Adding a New Gateway

```
1. School clicks "Connect" on the gateway card (e.g. PawaPay)
2. Configuration panel opens:

   Gateway: PawaPay
   Display name for parents: [text — default: "Pay with Mobile Money (PawaPay)"]

   API Key: [password field — encrypted before storage]
   API Secret: [password field — encrypted before storage]
   Merchant ID: [text field — your PawaPay merchant account ID]

   [Additional gateway-specific fields based on gateway type]
   For PawaPay:
     Correspondent: [dropdown — AIRTEL_ZAMBIA / MTN_ZAMBIA / ZAMTEL]
     Country Code: ZMB [auto-filled from school country]

   Webhook Secret: [auto-generated — copy this to your PawaPay dashboard]

   ☐ Test mode (sandbox — no real money)
      Check this during setup and testing. Uncheck before going live.

   [Save and Connect]
```

**Credentials are encrypted immediately:**
When the admin clicks Save, the API key and secret are encrypted client-side using a public key before transmission, decrypted server-side, re-encrypted with `GATEWAY_ENCRYPTION_KEY` (AES-256), and stored in `payment_gateways.api_key_encrypted`. The plaintext never exists in logs or database.

### Webhook Configuration at the Gateway

After saving in ZSMS, the admin must configure the webhook URL in their gateway's developer dashboard:

```
ZSMS Webhook URL for PawaPay:
https://zsms.co.zm/api/webhooks/payment/pawapay

Webhook Secret (copy this to your PawaPay dashboard):
whsec_a3f8k2m9p1q7r4s6...

Events to subscribe to:
✅ Payment completed
✅ Payment failed
✅ Payment refunded
```

The ZSMS admin panel shows the exact URL and secret for each configured gateway, with copy buttons.

### Test Mode

Every gateway must be tested in sandbox mode before going live:

```
Test mode checklist:
✅ Gateway credentials entered
✅ Webhook URL configured in gateway dashboard
✅ Test payment sent and received
✅ Payment appears in ZSMS fee verification queue
✅ Receipt generated correctly
✅ WhatsApp confirmation delivered

[Switch to Live Mode]  ← only appears after checklist is complete
```

The "Switch to Live Mode" button sets `payment_gateways.test_mode = FALSE`. No payments are accepted via this gateway until test mode is disabled.

---

## Multiple Gateways Simultaneously

A school can have multiple gateways active at the same time. A common configuration for a Zambian school:

```
Active Gateways:
✅ PawaPay         — Mobile Money (Primary)    [Edit] [Disable]
✅ Flutterwave     — Card Payments             [Edit] [Disable]
☐ Zanaco ZPay     — Bank Transfer             [Connect]
```

### Primary Gateway

One gateway is marked as primary (`is_primary = TRUE`). The primary gateway is shown first on the parent payment page. Only one can be primary at a time.

### Parent Payment Page

When a parent clicks "Pay Online" on their fee record, they see all active gateways:

```
Choose how to pay — Tuition Fee K2,500.00

[📱 Pay with Mobile Money]      ← PawaPay (Primary — shown first)
    Airtel Money / MTN / Zamtel

[💳 Pay by Card]                ← Flutterwave
    Visa, Mastercard

Or submit proof of manual payment →
```

Each button takes the parent to that gateway's hosted checkout page. After payment, the gateway redirects back to ZSMS with a payment reference, and the webhook confirms the outcome.

---

## Gateway-Specific Configurations

### PawaPay Configuration

PawaPay processes mobile money payments across multiple operators simultaneously.

```json
gateway_config: {
  "correspondent": "AIRTEL_ZAMBIA",
  "country": "ZMB",
  "currency": "ZMW"
}
```

PawaPay supports Airtel Money, MTN MoMo, and Zamtel in Zambia through a single integration. The correspondent field is the default but the parent selects their network on the PawaPay checkout page.

**Payment initiation (Push USSD):**
PawaPay uses push USSD — the parent enters their phone number on the ZSMS payment page, PawaPay sends a USSD prompt to their phone, and the parent approves the payment on their phone. No redirect to another website.

### Flutterwave Configuration

Standard card payment integration. Parent is redirected to Flutterwave's hosted checkout page.

```json
gateway_config: {
  "public_key": "FLWPUBK_...",
  "currency": "ZMW",
  "country": "ZM"
}
```

Flutterwave also supports mobile money in Zambia — `payment_type: 'mobilemoneyzambia'` can be enabled for parents who prefer mobile money through Flutterwave rather than PawaPay.

### DPO Configuration

DPO uses XML API rather than JSON. The integration handles this in the `webhook-payment` Edge Function with an XML parser.

```json
gateway_config: {
  "company_token": "...",
  "service_type": "School Fees",
  "country_code": "ZM"
}
```

### Airtel Money Direct

For schools that have a direct Airtel Zambia merchant agreement (bypassing PawaPay). Requires a separate Airtel Money merchant account.

### MTN MoMo Direct

For schools with a direct MTN Zambia MoMo merchant agreement.

### Zanaco ZPay

Bank transfer integration for schools banking with Zanaco. Payments are bank-to-bank — the parent authorises a transfer from their Zanaco account to the school's Zanaco account directly.

---

## Manual Payment (No Gateway)

The most common payment path in Phase 1 — most schools will not have a gateway configured initially. Parents pay via mobile money or bank transfer independently and submit proof through the parent portal.

The "Submit proof of payment" option is always available on the payment page, regardless of whether any gateway is configured. This is the fallback that ensures parents can always record their payment.

```
Choose how to pay — Tuition Fee K2,500.00

[No online payment methods configured]

Submit proof of manual payment →
  Already paid via mobile money or bank transfer?
  Upload your confirmation and the accountant will verify it.
```

Schools are encouraged to configure at least PawaPay during onboarding as it is free to set up (no monthly fee — only transaction-based) and covers all three Zambian mobile networks.

---

## Gateway Status Monitoring

The Settings → Payment Gateways page shows the health of each connected gateway:

```
PawaPay          ✅ Connected · Last webhook: 2 hours ago
Flutterwave      ✅ Connected · Last webhook: 5 days ago
DPO              ⚠️ Test mode active — switch to live before accepting real payments
Airtel Money     ❌ Webhook not received in 30 days — check configuration
```

Gateway health is determined by the recency of the last successful webhook received. If no webhook has been received in 30 days, the gateway shows a warning (it may be misconfigured or the school has not had any online payments).

---

## Business Rules

1. Schools connect their own gateway accounts. ZSMS does not provide or share gateway merchant accounts between schools.
2. All gateway credentials are encrypted before storage using `GATEWAY_ENCRYPTION_KEY`. Plaintext credentials never exist in logs, API responses, or database records.
3. A gateway must be tested in sandbox mode and pass the test checklist before test mode can be disabled. The "Switch to Live Mode" button enforces this.
4. Multiple gateways can be active simultaneously. There is no limit on the number of active gateways per school.
5. The manual proof-of-payment path is always available regardless of gateway configuration. Schools cannot disable it.
6. Gateway webhook processing is idempotent — receiving the same webhook twice does not create duplicate payment records (duplicate `gateway_reference` detection).
7. AfriTech receives no transaction fees from school fee payments. School gateway accounts are entirely the school's own commercial relationship with the gateway provider.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 9 fee module documentation |
| 2026-04-26 | Added all seven supported gateways | Multi-gateway support confirmed |
| 2026-04-26 | Added manual payment path as always-available option | Schools without gateways still need to record payments |
| 2026-04-26 | Added PawaPay push USSD detail | PawaPay is the primary Zambian mobile money solution |
