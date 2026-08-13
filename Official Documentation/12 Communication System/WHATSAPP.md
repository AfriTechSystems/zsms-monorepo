# WHATSAPP.md — WhatsApp Communication

## Related Documents

- `docs/modules/communication/TEMPLATES.md` — approved message templates
- `docs/modules/communication/MESSAGE_LOG.md` — delivery tracking
- `docs/modules/communication/ANNOUNCEMENTS.md` — school broadcast announcements
- `docs/modules/communication/CHATBOT.md` — inbound WhatsApp chatbot
- `docs/infra/META_API.md` — Meta Cloud API infrastructure
- `docs/infra/QSTASH.md` — message dispatch queue
- `docs/DATABASE.md` — school_message_quotas, schools WhatsApp fields
- `docs/modules/school/SUBSCRIPTION.md` — quota tiers by subscription

---

## Purpose

This document defines the complete WhatsApp communication system from the school's perspective — the portal-first model, approved message types, school-specific number configuration, quota management, parent opt-out, and the fallback chain. Every Claude Code session building any WhatsApp feature must read this document alongside `docs/infra/META_API.md`.

---

## Overview

WhatsApp is not the primary communication channel in ZSMS — the portal is. WhatsApp is used for high-value, low-frequency messages that parents genuinely want on WhatsApp. Every other communication happens through the portal, push notifications, and email. This discipline keeps costs predictable and prevents parents from blocking the school's number due to message fatigue.

---

## WhatsApp Number Configuration

Each school chooses between two WhatsApp sender configurations at setup.

### Option A — AfriTech Shared Number (Default)

Messages come from the AfriTech ZSMS WhatsApp Business number. Parents see "ZSMS Zambia" as the sender.

**Pros:** Zero setup — works immediately. AfriTech manages the number, templates, and Meta compliance.
**Cons:** Parents cannot save the contact as their school's name. Quota shared across AfriTech's monthly limit.

**Configuration:** `schools.whatsapp_phone_number_id = NULL` — the system uses the AfriTech default number from environment variables.

### Option B — School's Own WhatsApp Business Number

Messages come from the school's own registered number. Parents see "Sunrise Academy" as the sender.

**Pros:** Branded experience. Parents save the contact with the school's name. School manages their own Meta relationship and quota.
**Cons:** School must complete Meta business verification (1-2 weeks). School manages their own number and template registrations. AfriTech configures the connection during onboarding.

**Setup process:**
```
1. School owner applies for WhatsApp Business API via Meta for Developers
2. Completes Meta business verification (requires business registration documents)
3. Registers their phone number as a WhatsApp Business number
4. Provides AfriTech with: Phone Number ID, Access Token (encrypted), WABA ID
5. AfriTech configures in Settings → Communication → WhatsApp Sender:

   WhatsApp Sender:
   ○ Use ZSMS shared number (ZSMS Zambia)
   ● Use our school's number (Sunrise Academy)

   Phone Number ID: [from Meta dashboard]
   Access Token: [encrypted before storage]
   Business Account ID: [from Meta dashboard]

   [Save and verify connection]

6. System sends a test message to the school owner's phone to confirm
7. School registers their own message templates with Meta
   (AfriTech provides the template specifications for all required messages)
8. Templates approved by Meta (24-72 hours)
9. School's number is active
```

**Database fields added to `schools` table:**
```sql
whatsapp_phone_number_id    TEXT,     -- NULL = use AfriTech default
whatsapp_access_token_enc   TEXT,     -- School's Meta access token, encrypted
whatsapp_business_acct_id   TEXT,     -- School's WABA ID
whatsapp_sender_name        TEXT,     -- Display name: 'Sunrise Academy'
whatsapp_owns_number        BOOLEAN DEFAULT FALSE,
```

**How the Edge Function selects which number to use:**
```typescript
// supabase/functions/send-whatsapp/index.ts
async function getWhatsAppConfig(schoolId: string) {
  const { data: school } = await supabase
    .from('schools')
    .select('whatsapp_owns_number, whatsapp_phone_number_id, whatsapp_access_token_enc')
    .eq('id', schoolId)
    .single()

  if (school.whatsapp_owns_number && school.whatsapp_phone_number_id) {
    return {
      phoneNumberId: school.whatsapp_phone_number_id,
      accessToken: decrypt(school.whatsapp_access_token_enc),
      isSchoolOwned: true,
    }
  }

  // Fall back to AfriTech default
  return {
    phoneNumberId: Deno.env.get('META_WHATSAPP_PHONE_NUMBER_ID')!,
    accessToken: Deno.env.get('META_WHATSAPP_ACCESS_TOKEN')!,
    isSchoolOwned: false,
  }
}
```

---

## Approved Message Types

Only these message types trigger WhatsApp messages. The portal, push notifications, and email handle everything else.

| Message Type | Template | Trigger | Quota Impact |
|---|---|---|---|
| Results published + report card | `results_published` | Principal publishes results | 1 per student |
| Payment verified | `fee_payment_confirmed` | Accountant verifies payment | 1 per payment |
| Payment rejected | `fee_payment_rejected` | Accountant rejects payment | 1 per rejection |
| Fee overdue — 7 days | `fee_overdue_reminder` | Daily cron | 1 per fee record |
| Fee overdue — 14 days | `fee_overdue_reminder` | Daily cron | 1 per fee record |
| Fee overdue — 30 days | `fee_overdue_final` | Daily cron | 1 per fee record |
| Monthly attendance summary | `monthly_attendance_summary` | Monthly cron | 1 per student |
| Important school announcement | `school_announcement` | Admin manually sends | 1 per recipient |
| Loan application submitted | `loan_status_update` | Parent submits application | 1 per application |
| Loan approved/declined/disbursed | `loan_status_update` | Lender webhook | 1 per status change |
| Per-absence alert (opt-in) | `absence_alert` | Attendance trigger | 1 per absence |

**What does NOT send WhatsApp:**
- Regular (non-important) school announcements
- Timetable updates
- General portal reminders
- Staff management notifications
- Every payment submission (only on verification)

---

## Monthly Quota System

### Quota by Subscription Tier

Schools using AfriTech's shared number have a monthly quota from AfriTech's Meta account allocation:

| Tier | Monthly Messages | WhatsApp Cost to AfriTech |
|---|---|---|
| Starter | 500 | ~$5/month |
| Growth | 1,500 | ~$15/month |
| Professional | 4,000 | ~$40/month |
| Enterprise | Unlimited | Usage-based |
| Pay-as-you-go add-on | +500 per K50 | ~$5 per block |

Schools using their own WhatsApp Business number have **no ZSMS quota** — their usage is governed by their own Meta account limits and billing. AfriTech tracks their message volume for analytics only.

### Quota Tracking

```sql
-- school_message_quotas — one row per school per billing period
-- billing_period format: 'YYYY-MM' (e.g. '2026-09')

-- For schools using AfriTech's number: quota enforced
-- For schools using own number: quota_limit = NULL (no enforcement)
```

### Quota Alerts

| Threshold | What Happens |
|---|---|
| 80% used | In-app notification to school owner: "You've used 400 of 500 messages this month" |
| 100% used | WhatsApp messages blocked. Owner sees: "Quota reached — upgrade or purchase credits" |
| Per-absence alerts enabled at 80%+ | Additional warning: "Enabling per-absence alerts will rapidly consume remaining quota" |

### Quota Reset

Quota resets on the 1st of each calendar month at 00:00 UTC regardless of billing cycle date.

---

## Per-Absence Alert Toggle

Per-absence WhatsApp alerts are disabled by default. Schools enable them in Settings → Communication → Attendance Alerts.

```
Per-absence WhatsApp alerts:
[Toggle — OFF by default]

When enabled, parents receive a WhatsApp message each time
their child is marked absent.

⚠️ Quota estimate: A school with 400 students at 5% daily absence
rate sends approximately 400 messages/month on absence alerts alone.
This uses 80% of your Starter quota.

Consider upgrading to Growth before enabling this feature.
```

For schools using their own WhatsApp number, this warning is replaced with: "Absence alerts will use your school's own WhatsApp quota."

---

## Parent WhatsApp Opt-Out

Parents can opt out of WhatsApp messages individually. Two methods:

**From the parent portal:** Profile → Notifications → WhatsApp → Off

**Via WhatsApp:** Parent replies "STOP" to any ZSMS WhatsApp message. Meta automatically marks the number as opted out. The ZSMS delivery status webhook detects this and sets `parents.whatsapp_opted_in = FALSE`.

**Effect of opt-out:**
- All WhatsApp messages to this parent are skipped
- Email and in-app notifications continue
- The parent can re-opt-in from their portal settings

---

## Alumni and Graduated Users — WhatsApp

When a student graduates or a parent's child has graduated, their account transitions to alumni status. AfriTech may send them promotional content (scholarships, marketplace, study abroad) via WhatsApp — but only if they explicitly opted in during the graduation/departure flow.

The `parents.marketing_opt_in` field controls this. It is separate from `parents.whatsapp_opted_in`:
- `whatsapp_opted_in`: controls school notifications
- `marketing_opt_in`: controls AfriTech promotional content

School messages never go to marketing_opt_in accounts. AfriTech promotional messages never go to accounts where `marketing_opt_in = FALSE`.

---

## Fallback Chain

```
1. WhatsApp (primary — within quota and parent opted in)
   ↓ if fails or quota exceeded or opted out
2. Email (free — if parent email is registered)
   ↓ if fails or no email registered
3. In-app notification (always — no channel dependency)
   ↓ additionally
4. SMS via Twilio (last resort — only for critical messages)
```

The fallback chain is implemented in the `send-whatsapp` Edge Function. The function does not return until it has successfully queued at least one delivery channel.

---

## Business Rules

1. Schools using AfriTech's shared number have a monthly quota enforced by ZSMS. Schools using their own number have no ZSMS quota enforcement — their Meta account governs their limits.
2. Per-absence WhatsApp alerts are opt-in and disabled by default for all schools.
3. WhatsApp opt-out by a parent suppresses all WhatsApp messages regardless of message type (school notifications and marketing).
4. Marketing_opt_in is separate from whatsapp_opted_in. Marketing content from AfriTech requires a separate explicit opt-in. Default is FALSE.
5. School-specific WhatsApp numbers require Meta business verification — AfriTech cannot shortcut this requirement.
6. Templates for school-owned numbers must be registered by the school with Meta. AfriTech provides the template specifications and reviews them before go-live.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 12 communication documentation |
| 2026-04-26 | Added school-specific WhatsApp number support | Decision 1 confirmed — build now, not Phase 2 |
| 2026-04-26 | Added alumni marketing opt-in distinction | Graduated account model confirmed |
| 2026-04-26 | Per-absence alerts confirmed opt-in default | Portal-first communication model |
