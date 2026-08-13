# TRIAL.md — Free Trial Lifecycle

## Related Documents

- `docs/modules/school/SCHOOL_SETUP.md` — how trial is activated on self-registration
- `docs/modules/school/SUBSCRIPTION.md` — trial to subscription conversion
- `docs/infra/QSTASH.md` — trial expiry cron job
- `docs/DATABASE.md` — schools table trial fields
- `docs/api/ERROR_CODES.md` — TRIAL_EXPIRED error code
- `docs/infra/POSTHOG.md` — trial conversion tracking events

---

## Purpose

This document defines the complete 30-day free trial lifecycle — activation, what access is available during the trial, the notification schedule, what happens at expiry, and how the trial converts to a paid subscription. Every Claude Code session that touches trial status, expiry handling, or the subscription conversion flow must read this document.

---

## Trial Activation

The trial is activated automatically when a school self-registers through `zsms.co.zm/register`. It is never activated during AfriTech manual onboarding — manually onboarded schools go directly to `pending_verification` and then `active` status.

On successful self-registration:

```typescript
// Set during school creation in school-onboard Edge Function
await supabaseAdmin
  .from('schools')
  .update({
    status: 'trial',
    trial_ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    subscription_tier: 'starter',
  })
  .eq('id', schoolId)
```

The trial always starts on the Starter tier. Schools cannot select a higher tier during self-registration — they choose their tier when converting to a paid subscription.

---

## Trial Access

During the trial, the school has full access to all Starter tier features with one adjustment:

| Feature | Normal Starter | Trial Starter |
|---|---|---|
| All core modules | ✅ | ✅ |
| WhatsApp messages | 500/month | 250/month (halved) |
| Custom staff roles | Up to 3 | Up to 3 |
| API access | ❌ | ❌ |
| Finance module | ❌ | ❌ |

WhatsApp quota is halved during trial to reduce cost exposure for schools that set up ZSMS and send messages without converting. This is enforced in the quota check before any WhatsApp job is enqueued.

A persistent banner appears on every page during the trial:

```
📅  Free Trial — [N] days remaining
    You have full access to ZSMS. Subscribe before [date] to keep your data.
    [Subscribe Now]  [Remind me later]
```

The banner is dismissible per session (clicking "Remind me later" hides it for 24 hours). It reappears on the next login session.

---

## AfriTech Outreach Workflow

The 24-hour outreach requirement is enforced through the admin panel task system.

**On registration:**
1. A task is created in the AfriTech admin panel: "New trial school — contact within 24 hours: [School Name], [City], [Owner Phone]"
2. The task is assigned to the regional manager responsible for that city
3. If no regional manager is assigned, it goes to the AfriTech super admin queue
4. A queued job is scheduled for 24 hours later — if the task is still open (not marked contacted), an escalation notification fires to the super admin

**Outreach outcomes recorded in admin panel:**
- Contacted — scheduled onboarding call
- Contacted — no answer, will retry
- Contacted — school not interested
- Contacted — school needs technical help (creates a support ticket)

Recording an outreach outcome is mandatory before the task closes. This data feeds into the trial conversion analytics.

---

## Trial Notification Schedule

All notifications are sent to the school owner's email. In-app notifications appear on every login.

| Day | Email | In-App | Notes |
|---|---|---|---|
| Day 1 (registration) | Welcome email with getting started guide | Welcome banner | Sent immediately |
| Day 3 | "Have you set up your grade structure?" | Onboarding checklist prompt | Only if checklist < 30% |
| Day 7 | "Your trial is going well" or "Complete your setup" | Checklist progress | Varies by onboarding % |
| Day 14 | Mid-trial check-in | — | Only if not yet subscribed |
| Day 25 | "5 days left in your trial" | Urgent banner | |
| Day 28 | "2 days left — subscribe to keep your data" | Urgent banner | |
| Day 30 | "Your trial ends today" | Final banner | |
| Day 30 (expiry) | "Your trial has expired" | Expired state UI | Sent on expiry |
| Day 33 | "Your data is safe — subscribe to regain access" | — | 3 days after expiry |
| Day 37 | Final outreach email | — | 7 days after expiry |

All notification emails are sent via Resend using pre-designed templates. In-app notifications are stored in a `school_notifications` table and displayed on the dashboard.

---

## Trial Expiry

The `check-trial-expiry` Edge Function runs daily at 01:00 UTC via queue cron.

```typescript
// Expiry check logic
const { data: expiringSchools } = await supabaseAdmin
  .from('schools')
  .select('id, name, trial_ends_at')
  .eq('status', 'trial')
  .lt('trial_ends_at', new Date().toISOString())

for (const school of expiringSchools) {
  await supabaseAdmin
    .from('schools')
    .update({ status: 'trial_expired' })
    .eq('id', school.id)

  // Queue owner notification
  await enqueueJob('send-email', {
    template: 'trial_expired',
    school_id: school.id,
  })

  // PostHog event
  posthog.capture('school_trial_expired', {
    school_id: school.school_id,
    days_since_registration: 30,
  })
}
```

**On expiry, school status becomes `trial_expired`:**

| Action | Permitted |
|---|---|
| Login (owner) | ✅ |
| View existing data | ✅ |
| Export data | ✅ |
| Create new records | ❌ |
| Record payments | ❌ |
| Import students | ❌ |
| Invite staff | ❌ |
| Send WhatsApp | ❌ |

The school owner sees a full-screen interstitial on login:

```
Your free trial has ended

Your data is safe and waiting for you.
Subscribe to ZSMS to continue managing your school.

[View Plans and Subscribe]   [Export My Data]

Questions? Contact us: support@afritechsystems.com
```

The "Export My Data" option allows the school to download all their data as CSV files even without subscribing — this is a legal requirement under the Zambia Data Protection Act and builds trust that AfriTech is not holding data hostage.

---

## Trial to Paid Conversion

When a school subscribes during or after their trial:

```
1. School owner clicks Subscribe (from trial banner or expired interstitial)
2. Plan selection screen shown — Starter, Growth, Professional, Enterprise
3. Billing details entered
4. Payment processed via Flutterwave
5. On successful payment webhook:
   - schools.status → 'active'
   - schools.subscription_tier → selected tier
   - schools.subscription_ends_at → NOW() + 30 or 365 days
   - schools.trial_ends_at → unchanged (preserved for analytics)
6. Owner receives confirmation email
7. PostHog event: school_trial_converted
8. All trial restrictions lifted immediately
9. WhatsApp quota reset to full tier allocation
```

**Data continuity on conversion:** All data entered during the trial — students, fee records, attendance, exam results — is preserved exactly as entered. The conversion is seamless. Schools that used the trial productively enter their paid subscription with a running system rather than starting from scratch.

---

## Trial Analytics

PostHog tracks these events for trial conversion analysis:

```typescript
// On registration
posthog.capture('school_trial_started', { tier: 'starter', city_code, country_code })

// Daily — onboarding progress snapshot
posthog.capture('trial_onboarding_progress', {
  days_elapsed: number,
  checklist_percent: number,
  students_added: boolean,
  staff_invited: boolean,
  fee_structure_created: boolean,
})

// On conversion
posthog.capture('school_trial_converted', {
  days_to_convert: number,        // How many days into trial they converted
  converted_tier: string,
  checklist_percent_at_conversion: number,
})

// On expiry without conversion
posthog.capture('school_trial_expired_no_conversion', {
  checklist_percent_at_expiry: number,
  outreach_attempts: number,
})
```

These events feed the trial conversion funnel in PostHog which is the primary business metric for Year 1. A school that reached 60%+ onboarding completion converts at a much higher rate than one that never completed setup — this data drives the outreach prioritisation.

---

## Business Rules

1. Trial activation is automatic on self-registration only. AfriTech manually onboarded schools skip the trial entirely.
2. Trial data is never automatically deleted. Even a school that expires and never subscribes retains their data for 1 year before automated archiving.
3. WhatsApp quota during trial is exactly half the Starter tier quota (250 messages). This cannot be increased without subscribing.
4. The 24-hour outreach requirement is enforced through the admin panel task system. Tasks not marked as contacted after 48 hours escalate to the super admin.
5. Schools can subscribe at any point during or after the trial — there is no penalty for subscribing late.
6. Trial expiry does not revoke the school owner's Clerk account. They can always log in and view their data or export it.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 6 school module documentation |
