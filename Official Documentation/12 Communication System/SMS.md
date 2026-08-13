# SMS.md — SMS Fallback Communication

## Related Documents

- `docs/modules/communication/WHATSAPP.md` — primary channel SMS falls back from
- `docs/modules/communication/MESSAGE_LOG.md` — SMS delivery tracking
- `docs/infra/TWILIO.md` — Twilio infrastructure configuration
- `docs/infra/QSTASH.md` — send-sms job queue
- `docs/DATABASE.md` — message_log channel field

---

## Purpose

This document defines SMS's narrow role in ZSMS as a last-resort fallback channel. It is intentionally brief — SMS is deliberately minimal in Phase 1 to control costs. Every Claude Code session that touches SMS must read this document to ensure SMS is never used as a primary channel.

---

## Overview

SMS via Twilio is the last resort in the communication fallback chain. It fires only when both WhatsApp and email have confirmed delivery failures for a specific message to a specific parent. In practice, most parents will be reached via WhatsApp or email. SMS costs are expected to be negligible in Phase 1.

---

## When SMS Fires

SMS is triggered only when ALL of the following are true:

1. A WhatsApp message was attempted and failed (Meta returned an error, not just undelivered)
2. An email was attempted and failed (no valid email address OR Resend returned a hard bounce)
3. The message is classified as critical (payment verified, results published, loan disbursed)
4. The parent has not opted out of all communications

Non-critical messages (fee reminders, announcements, attendance summaries) do not trigger SMS fallback — they wait for the parent to check the portal.

```typescript
// In send-whatsapp Edge Function — after WhatsApp and email both fail
if (whatsappFailed && emailFailed && isCriticalMessage(templateId)) {
  await enqueueJob('send-sms', {
    recipient_phone: recipientPhone,
    message: buildSmsMessage(templateId, variables),
    school_id: schoolId,
    message_log_id: messageLogId,
  })
}
```

---

## Critical Messages That Trigger SMS Fallback

| Message | Why Critical |
|---|---|
| Payment verified | Parent needs receipt confirmation |
| Payment rejected | Parent needs to resubmit |
| Results published | High emotional significance |
| Loan disbursed | Financial confirmation |
| Account security (future) | Trust and safety |

---

## SMS Message Format

SMS messages must fit within 160 characters to avoid multi-part charges. All SMS templates are pre-formatted to this limit.

**Payment confirmed:**
```
ZSMS: K2500 confirmed for Chanda at Sunrise Academy.
Receipt: zsms.co.zm/r/REC001234  (15-min link)
```

**Payment rejected:**
```
ZSMS: Your payment for Chanda at Sunrise Academy needs attention.
Contact school or visit zsms.co.zm/portal
```

**Results published:**
```
ZSMS: Chanda's Term 2 results ready at Sunrise Academy.
View: zsms.co.zm/portal/results
```

**Loan disbursed:**
```
ZSMS: Loan for Chanda's fees at Sunrise Academy has been disbursed.
View: zsms.co.zm/portal
```

**URL shortening:** All portal links in SMS are shortened to keep messages under 160 characters. A URL shortening service or Supabase Edge Function generates short redirects (`zsms.co.zm/r/{code}`) that redirect to the full portal URL.

---

## Cost Tracking

SMS costs are tracked in the `message_log` table. The `channel = 'sms'` field identifies SMS messages. AfriTech monitors monthly SMS spend via Twilio's dashboard.

**Expected cost at scale:**
- 100 schools × 500 students = 50,000 parent accounts
- Estimated SMS rate: under 0.1% of messages (WhatsApp and email cover 99.9%)
- At 50 SMS messages/month × $0.04/message = $2/month
- Negligible at Phase 1 scale

When SMS volume exceeds $50/month, review whether a specific message type is failing WhatsApp and email at an unusual rate — this indicates a configuration issue, not normal usage.

---

## Future SMS Expansion (Phase 2+)

When ZSMS generates sufficient revenue, SMS can be offered as a primary channel option:

- **SMS-first parents:** Parents in areas with poor WhatsApp penetration can choose SMS as their primary notification channel
- **School SMS add-on:** Schools pay a per-message fee for SMS as a primary channel (K0.10 per SMS, billed monthly)
- **Bulk SMS campaigns:** Schools can send SMS announcements to all parents simultaneously

This expansion is documented here as planned but not built in Phase 1. The architecture supports it — the `send-sms` Edge Function and Twilio integration are already in place.

---

## Business Rules

1. SMS is never used as a primary channel. It fires only when WhatsApp and email both fail for a critical message.
2. SMS messages are limited to 160 characters. Messages that cannot fit are truncated with a portal link.
3. All SMS portal links use the shortened URL format (`zsms.co.zm/r/{code}`) to preserve the 160-character limit.
4. SMS costs are monitored monthly. Unusual SMS volume is investigated as a potential configuration issue.
5. Parents who opt out of WhatsApp are still eligible for SMS fallback on critical messages. SMS opt-out is a separate preference not yet implemented in Phase 1.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 12 communication documentation |
| 2026-04-26 | Confirmed last-resort fallback only | Cost control — SMS expensive at scale |
| 2026-04-26 | Added future SMS expansion section | Phase 2 roadmap item documented |
