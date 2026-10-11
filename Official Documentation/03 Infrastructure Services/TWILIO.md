# TWILIO.md — Twilio Communication Fallback

## Related Documents

- `docs/infra/META_API.md` — primary WhatsApp messaging
- `docs/modules/communication/MESSAGE_LOG.md` — delivery tracking
- `docs/ENV.md` — Twilio environment variables
- `docs/infra/QSTASH.md` — message dispatch queue

---

## Implementation Status (2026-10-11)

**Code complete; waiting on an account.**

`packages/notifications/src/providers/twilio-sms.ts` is implemented and gated behind
`useMock()` exactly as the WhatsApp provider is.

Worth noting for `AUTH.md`: SMS OTP is disabled on cost grounds in Zambia, which is why
parents are matched by verified email rather than by phone. Twilio here is for outbound
notifications as a WhatsApp fallback, not for authentication.

---

## Purpose

This document covers Twilio's role in ZSMS. With the move to email OTP only and the portal-first communication model, Twilio's scope is deliberately narrow. This document defines exactly when Twilio is used, how it is configured, and what the fallback triggers are.

---

## Overview

Twilio is a secondary communication service in ZSMS. It is not a primary channel. The decision to minimise Twilio usage is driven by cost — SMS messages in Zambia cost approximately $0.02–$0.05 each, which becomes significant at scale. Twilio is retained for specific fallback scenarios where email and WhatsApp both fail.

---

## Twilio's Exact Role in ZSMS

| Scenario | Twilio Used? | Notes |
|---|---|---|
| Login OTP delivery | No | Email OTP only |
| WhatsApp message delivery failure fallback | Yes — email first, SMS if email also fails | Last resort |
| Account creation notification | No | Email only |
| Fee reminders | No | WhatsApp (quota) + email |
| Attendance alerts | No | Push notification + email |
| Any primary communication | No | Never a primary channel |

Twilio is the **last resort** fallback. The fallback chain for any important notification is:

```
1. WhatsApp (primary — within school quota)
2. Email via Resend (if WhatsApp fails or quota exceeded)
3. SMS via Twilio (if email also fails — e.g. parent has no email)
```

The SMS fallback only fires when both WhatsApp and email have confirmed delivery failures. Most parents will be reached before SMS is needed.

---

## Configuration

### Account Setup

1. Create a Twilio account at twilio.com
2. Register a Zambia-capable phone number (can send to +260 numbers)
3. Enable SMS messaging for the account
4. Verify the sending number

### Zambia-Specific Notes

- Twilio's Zambia coverage is through aggregator networks (Airtel, MTN, Zamtel)
- Delivery rates are generally good for urban numbers, variable for rural
- SMS character limit: 160 characters per message. ZSMS SMS messages are kept under 160 characters to avoid multi-part charges
- Sender ID: numeric Twilio number only (Zambia does not support alphanumeric sender IDs via Twilio without a local registration)

---

## SMS Fallback Implementation

```typescript
// supabase/functions/send-sms/index.ts
// Called by the queue worker when WhatsApp and email both fail

async function sendSMS(
  toPhone: string,
  message: string,
  messageLogId: string
): Promise<void> {
  // Enforce 160 character limit
  const truncated = message.length > 160
    ? message.substring(0, 157) + '...'
    : message

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${Deno.env.get('TWILIO_ACCOUNT_SID')}/Messages.json`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(`${Deno.env.get('TWILIO_ACCOUNT_SID')}:${Deno.env.get('TWILIO_AUTH_TOKEN')}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: toPhone,
        From: Deno.env.get('TWILIO_PHONE_NUMBER')!,
        Body: truncated,
      }),
    }
  )

  const data = await response.json()

  // Update message_log with SMS fallback status
  await supabaseAdmin
    .from('message_log')
    .update({
      status: response.ok ? 'fallback_sent' : 'failed',
      channel: 'sms',
      provider_message_id: data.sid,
      error_code: response.ok ? null : data.code?.toString(),
    })
    .eq('id', messageLogId)
}
```

---

## SMS Message Format

SMS messages must be concise — 160 characters maximum. They carry the essential information only, with a portal link for detail.

```
Results: Chanda Term 2 ready. Pos 3/38. Download: zsms.co.zm/p
```

```
Fee confirmed K1500 for Chanda at Sunrise Academy. Balance: K1000
```

```
ZSMS: K2500 overdue for Chanda. Pay or view: zsms.co.zm/fees
```

---

## Cost Management

Twilio costs are tracked as part of the communication infrastructure budget. Because SMS is a last-resort fallback, costs should be minimal. Monitor monthly:

- Total SMS sent per month (should be very low — under 1% of total messages)
- If SMS volume is unexpectedly high, investigate why WhatsApp and email are failing

---

## Business Rules

1. Twilio SMS is never the primary communication channel for any ZSMS feature.
2. SMS is triggered only when both WhatsApp and email delivery have failed for a specific message.
3. SMS messages are kept under 160 characters to avoid multi-part message charges.
4. The `message_log.channel` field is updated to `'sms'` when Twilio fallback fires, and `status` to `'fallback_sent'` on success.
5. SMS sending is logged in `audit_logs` like all other communication events.

---

## Known Limitations and Future Work

- WhatsApp OTP delivery via Twilio (for parents without email) is a planned future feature. When SMS budget allows, enable Twilio's WhatsApp sender and add it as an OTP delivery option for parents.
- Twilio does not support alphanumeric sender IDs for Zambia without local number registration. The phone number sender is less recognisable to parents than a name. This is acceptable for a last-resort fallback channel.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial draft | Stage 3 infrastructure documentation |
| 2026-04-26 | Scope narrowed to last-resort fallback only | Email OTP replaces SMS OTP — Twilio cost reduction |
