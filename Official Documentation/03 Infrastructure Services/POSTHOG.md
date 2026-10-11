# POSTHOG.md — Product Analytics Reference

## Related Documents

- `docs/infra/SENTRY.md` — error tracking (separate from analytics)
- `docs/modules/admin/PLATFORM_METRICS.md` — AfriTech internal metrics (separate from PostHog)
- `docs/ENV.md` — PostHog environment variables

---

## Implementation Status (2026-10-11)

**Live, EU region, with autocapture OFF.**

`apps/web/lib/analytics.ts`. Verified by `npm run posthog:smoke`.

Autocapture, input capture and session recording are all disabled and **must stay
disabled**. PostHog's default captures every click and input with the surrounding DOM
text, and the DOM of a ZSMS screen is a class register with children's names, a fee ledger
with amounts beside them, and a pupil record carrying an NRC and medical notes.

Query strings are stripped before anything leaves the browser (`?childId=`, `?classId=`
and `?feeRecordId=` each name a child), and page-view paths have their dynamic segments
replaced, since `/school/ZM-LSK-0001/pupils/<uuid>` names a school and a pupil in the path
itself. Nobody is identified: `identifyRole()` sends a role and a school code.

---

## Purpose

This document defines every PostHog event tracked in ZSMS — what is tracked, when it fires, what properties are included, and which dashboards use it. Every Claude Code session adding a new user-facing feature must add the corresponding PostHog event here and in the implementation.

---

## PostHog Setup

```typescript
// apps/web/lib/posthog.ts
import posthog from 'posthog-js'

posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
  api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  capture_pageview: false,  // Manual page tracking only
  persistence: 'localStorage+cookie',
  bootstrap: {
    distinctId: clerkUserId,  // Set from Clerk session
  },
})

// Identity set on every authenticated page load
posthog.identify(clerkUserId, {
  school_id: schoolId,
  role: userRole,
  subscription_tier: schoolTier,
  country_code: 'ZM',
})
```

---

## School Lifecycle Events

| Event | When | Key Properties |
|---|---|---|
| `school_trial_started` | New school registers | school_id, tier, city_code |
| `school_onboarding_step_completed` | Checklist item ticked | school_id, step_key, completion_pct |
| `school_subscribed` | Trial converts to paid | school_id, tier, billing_cycle |
| `school_tier_upgraded` | School upgrades tier | school_id, from_tier, to_tier |
| `school_addon_enabled` | Add-on purchased | school_id, addon_key, monthly_price |
| `school_suspended` | Subscription lapses | school_id, days_since_last_payment |
| `school_reactivated` | Suspended school pays | school_id, suspended_days |

---

## Teacher Hub Events

| Event | When | Key Properties |
|---|---|---|
| `teacher_hub_signup` | Standalone teacher registers | country_code, curriculum_type |
| `teacher_hub_subscribed` | Free trial converts to paid | plan_type (monthly/annual) |
| `teacher_hub_linked_to_school` | Standalone links to school | school_id, days_since_signup |
| `lesson_plan_generated` | Teacher generates a plan | subject, grade_level, curriculum_type, duration_minutes |
| `lesson_plan_saved` | Teacher saves a plan | subject, grade_level |
| `lesson_plan_exported` | Teacher exports PDF/Word | export_format |
| `lesson_plan_shared` | Teacher makes plan public | subject, grade_level |
| `quiz_generated` | Teacher generates a quiz | subject, grade_level, question_count |
| `homework_generated` | Teacher generates homework | subject, grade_level |
| `knowledge_base_rated` | Teacher rates a generated plan | rating (1-5), subject, grade_level |

---

## AI Assistant Events

| Event | When | Key Properties |
|---|---|---|
| `ai_assistant_opened` | User opens assistant panel | role, school_id |
| `ai_assistant_query_sent` | User sends a message | role, intent_type, response_time_ms |
| `ai_assistant_feedback_positive` | User thumbs up response | intent_type |
| `ai_assistant_feedback_negative` | User thumbs down | intent_type |
| `ai_insights_unlocked` | School reaches 70% completeness | school_id, previous_score |
| `ai_insights_blocked` | User sees completeness gate | school_id, completeness_score |
| `early_warning_viewed` | Principal views at-risk list | school_id, at_risk_count |
| `early_warning_actioned` | Principal acts on a flag | action_type (contact_parent, assign_intervention) |

---

## Timetable Events

| Event | When | Key Properties |
|---|---|---|
| `timetable_created` | New timetable created | school_id, academic_year, term |
| `timetable_slot_added` | Slot added to timetable | school_id, subject, day_of_week |
| `timetable_conflict_detected` | Conflict blocked a slot | school_id, conflict_type |
| `timetable_published` | Timetable published | school_id, slot_count, class_count |
| `timetable_viewed_teacher` | Teacher views their timetable | school_id |
| `timetable_viewed_parent` | Parent views child timetable | school_id |

---

## Announcement Events

| Event | When | Key Properties |
|---|---|---|
| `announcement_created` | Admin creates announcement | school_id, importance, target_type |
| `announcement_sent` | Announcement dispatched | school_id, recipients_count, whatsapp_sent |
| `announcement_read` | User opens announcement | school_id, announcement_id, reader_type |
| `announcement_reach_viewed` | Admin views read analytics | school_id, read_pct, delivered_pct |

---

## Loan Module Events

| Event | When | Key Properties |
|---|---|---|
| `loan_application_started` | Parent begins application | school_id, lender_id |
| `loan_consent_completed` | Parent completes consent | school_id, lender_id |
| `loan_application_submitted` | Application submitted | school_id, amount_requested, behaviour_score_band |
| `loan_application_approved` | Lender approves | school_id, lender_id |
| `loan_application_declined` | Lender declines | school_id, lender_id |
| `loan_disbursed` | Loan funds sent to school | school_id, amount, lender_id |
| `loan_repayment_initiated` | Parent initiates repayment | school_id, instalment_number |

---

## Integration Events

| Event | When | Key Properties |
|---|---|---|
| `integration_connected` | School connects an integration | school_id, integration_type |
| `integration_sync_success` | Event dispatched successfully | school_id, integration_type, event_type |
| `integration_sync_failed` | Dispatch failed | school_id, integration_type, error_code |
| `integration_disconnected` | School disconnects | school_id, integration_type, days_connected |

---

## Communication Events

| Event | When | Key Properties |
|---|---|---|
| `whatsapp_own_number_configured` | School sets up own number | school_id |
| `per_absence_alerts_enabled` | School enables per-absence alerts | school_id |
| `chatbot_command_received` | Parent texts a command | command_type, school_id |
| `parent_opted_out_whatsapp` | Parent disables notifications | school_id |
| `alumni_marketing_opted_in` | Parent opts into marketing | graduation_year |

---

## Fee and Payment Events

| Event | When | Key Properties |
|---|---|---|
| `fee_structure_created` | Admin creates fee structure | school_id, grade_id, term |
| `fee_records_generated` | Bulk fee records created | school_id, student_count, total_amount |
| `payment_submitted` | Parent submits payment | school_id, payment_method |
| `payment_verified` | Accountant verifies | school_id, payment_method, amount |
| `payment_rejected` | Accountant rejects | school_id, rejection_reason |
| `receipt_downloaded` | Parent downloads receipt | school_id |

---

## Results and Attendance Events

| Event | When | Key Properties |
|---|---|---|
| `marks_entry_started` | Teacher begins marks entry | school_id, class_id, subject |
| `marks_entry_completed` | All marks entered for class | school_id, class_id, subject |
| `results_published` | Principal publishes results | school_id, class_count, student_count |
| `report_cards_generated` | Bulk PDF generation | school_id, student_count, duration_seconds |
| `report_card_downloaded` | Parent downloads report card | school_id |
| `attendance_marked_offline` | Teacher marks offline | school_id, class_id |
| `offline_sync_completed` | Attendance syncs after offline | school_id, pending_records, sync_duration_seconds |

---

## Alumni Portal Events

| Event | When | Key Properties |
|---|---|---|
| `alumni_portal_accessed` | Alumni logs in | graduation_year, school_id |
| `alumni_document_downloaded` | Alumni downloads historical doc | document_type, years_since_graduation |
| `alumni_certificate_requested` | Alumni requests attendance cert | school_id |
| `alumni_marketing_received` | AfriTech marketing message sent | campaign_type, graduation_year |

---

## Key Dashboards

### Growth Dashboard (Julius — CFO)
Events: `school_trial_started`, `school_subscribed`, `school_tier_upgraded`, `school_addon_enabled`, `school_suspended`
Shows: Trial starts per week, conversion funnel, MRR by tier, churn

### Product Engagement Dashboard (Mwando — CTO)
Events: All feature usage events
Shows: DAU/WAU/MAU, feature adoption by tier, most/least used features, session duration

### Teacher Hub Dashboard
Events: All `teacher_hub_*` and lesson plan events
Shows: Signup rate, trial-to-paid conversion, plans per teacher, most requested subjects/grades

### AI Performance Dashboard
Events: All `ai_*` events
Shows: Assistant usage rate, most common intents, response satisfaction, completeness score distribution

---

## Privacy Rules

1. Never track personally identifiable information (PII) in PostHog events — no names, phone numbers, email addresses, student IDs, or financial amounts.
2. School ID and role are acceptable — they are internal identifiers, not personal data.
3. Behaviour score bands (Excellent/Good/Fair/Poor) are acceptable — not the raw score.
4. Payment amounts are never tracked — only payment method and verification status.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Analytics reference |
| 2026-04-26 | Added Teacher Hub events | Standalone teacher B2C product |
| 2026-04-26 | Added AI assistant and lesson planner events | AI module |
| 2026-04-26 | Added timetable events | Timetable module |
| 2026-04-26 | Added announcement read events | Full read tracking confirmed |
| 2026-04-26 | Added integration connector events | Accounting/CRM integrations |
| 2026-04-26 | Added alumni portal events | Graduated account model |
| 2026-04-26 | Added loan application funnel events | Loan module |
