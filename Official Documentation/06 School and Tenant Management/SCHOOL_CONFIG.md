# SCHOOL_CONFIG.md — School Configuration Reference

## Related Documents

- `docs/modules/school/SCHOOL_SETUP.md` — initial setup flow
- `docs/modules/school/SUBSCRIPTION.md` — tier determines available config options
- `docs/modules/communication/WHATSAPP.md` — WhatsApp configuration detail
- `docs/modules/staff/TIMETABLE.md` — timetable configuration
- `docs/modules/integrations/INTEGRATIONS.md` — integration connector setup
- `docs/DATABASE.md` — schools table fields

---

## Implementation Status (2026-10-11)

**Built:** the settings shell, school profile, academic structure, pupil fields, terms,
branding, public profile, AI credits, staff roles, permission grants, connections and API
keys — each with its own screen under `/school/[code]/settings`.

**Not built: per-school WhatsApp configuration.** The *WhatsApp Configuration* section
below describes a shared-number default and a bring-your-own-number path taking Meta
credentials. Neither `schools.whatsapp_phone_number_id` nor
`schools.whatsapp_access_token_enc` exists, although `ARCHITECTURE.md` refers to both as
though they do — a documented claim that is false, recorded here rather than left to be
discovered.

Deliberately not built yet, for a reason worth stating: **neither option can send.** There
is no Meta Business account, so the shared number does not work either, and
`FIELD_ENCRYPTION_KEY` is unset so a school's access token could not be stored safely if
one were offered. A settings screen where both choices are inert is a screen that lies,
and the same reasoning kept write endpoints out of the API.

The columns and the screen are a small piece of work once a Meta account exists. Doing
them before would mean shipping a form that collects credentials it cannot keep.

---

## Purpose

This document defines every school configuration option in ZSMS — what each setting does, where it lives in the UI, which database fields it maps to, and which subscription tier is required. Every Claude Code session building any settings or configuration feature must read this document.

---

## Settings Panel Structure

```
Settings
├── School Profile         Name, logo, address, type, level
├── Academic Structure     Curriculum, grades, subjects, grading
├── Term Dates             Academic year, term start/end dates
├── Communication
│   ├── WhatsApp           Shared vs own number, quota, alerts
│   └── Email              Notification preferences
├── Fees                   Currency, payment gateways, receipt numbering
├── Timetable              School day periods, conflict rules
├── Modules                Enable/disable feature add-ons
├── Integrations           Accounting and CRM connectors
├── Document Templates     Report card, receipt, certificate customisation
├── Staff & Roles          Custom role definitions
├── API Access             API keys (Growth+)
└── Security               Session settings, AfriTech access log
```

---

## School Profile

| Field | DB Column | Notes |
|---|---|---|
| School name | `schools.name` | Used in all documents and WhatsApp messages |
| Display name | `schools.display_name` | Short name for portal headers |
| Logo | `schools.logo_url` | R2 path — appears on all PDFs and portal |
| Address | `schools.address` | Shown on certificates and formal documents |
| City | `schools.city_code` | Used in school ID format |
| School type | `schools.school_type` | day / boarding / hybrid |
| Level | `schools.level` | primary / secondary / combined |
| Ministry reg. number | `schools.ministry_reg_number` | Optional — shown on attendance certificates |
| Primary colour | Document template config | Hex colour for all generated documents |

---

## Academic Structure

| Setting | Where Stored | Notes |
|---|---|---|
| Curriculum type | `school_academic_config.curriculum_type` | ecz_grades / cambridge_forms / hybrid |
| Grade levels | `school_grade_levels` | Custom display names allowed |
| Subjects | `school_subjects` | Add/remove from reference list |
| Grading system | `school_grading_scales` | ECZ percentage / Cambridge / custom bands |
| Examination class flags | `school_grade_levels.examination_type` | Flags Grade 6, Form 4, Form 6 for exam number display |

---

## WhatsApp Configuration

**Location:** Settings → Communication → WhatsApp

### Shared Number (Default)

```
WhatsApp Sender
━━━━━━━━━━━━━━
● Use ZSMS shared number (recommended)
  Messages sent from "ZSMS Zambia"
  Monthly quota: [500 / 1,500 / 4,000] messages included in your plan
  No setup required.

○ Use our school's WhatsApp Business number
  Messages sent from your school's own number
  [Configure school number →]
```

### School-Specific Number Configuration

When the school selects their own number:

```
Configure Your School WhatsApp Number
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Before connecting, you need:
✓ A WhatsApp Business Account (WABA) approved by Meta
✓ A phone number registered in your WABA
✓ All required message templates approved by Meta

Step 1: Enter your Meta credentials
  Phone Number ID:        [from Meta Business Manager]
  Access Token:           [from Meta API]
  Business Account ID:    [from Meta Business Manager]

Step 2: Send a test message to verify connection
  [Send test message to +260977XXXXXX]

Step 3: Confirm template registration
  ☑ fee_payment_confirmed approved
  ☑ fee_overdue_reminder approved
  ☐ absence_alert (required if per-absence alerts enabled)
  [I confirm all required templates are approved]

[Save and Activate]
```

DB fields updated: `whatsapp_owns_number = TRUE`, `whatsapp_phone_number_id`, `whatsapp_access_token_enc` (encrypted), `whatsapp_business_acct_id`.

### Per-Absence Alert Toggle

```
Attendance Alerts
━━━━━━━━━━━━━━━━
Send WhatsApp alert to parents each time their child is marked absent?

● Off (recommended) — Parents receive a monthly attendance summary instead
  This preserves your WhatsApp quota for important messages.

○ On — Send a WhatsApp message each absence (uses quota per message)
  Estimated quota usage: ~[N] messages/month based on your attendance history

[Save]
```

DB field: `school_academic_config.per_absence_alerts_enabled`

---

## Timetable Configuration

**Location:** Settings → Timetable
**Available:** Growth tier and above, or Timetable add-on

### School Day Setup

```
Configure School Day
━━━━━━━━━━━━━━━━━━━

Define your teaching periods:

Period    Start    End      Teaching?
──────────────────────────────────
Period 1  07:30    08:15    ✅
Period 2  08:15    09:00    ✅
Break     09:00    09:20    ☐ (no lessons)
Period 3  09:20    10:05    ✅
Period 4  10:05    10:50    ✅
Lunch     10:50    11:30    ☐ (no lessons)
Period 5  11:30    12:15    ✅
Period 6  12:15    13:00    ✅

[+ Add period]   [Save school day]
```

DB table: `timetable_periods`

### Conflict Detection Settings

```
Conflict Detection
━━━━━━━━━━━━━━━━━
● Prevent double-booking a teacher at the same time (always on)
● Prevent assigning two lessons to the same class at the same time (always on)

Room conflict detection:
○ Off (default) — rooms are tracked but conflicts are allowed
● On — prevent two classes from using the same room simultaneously
```

---

## Modules (Feature Add-Ons)

**Location:** Settings → Modules

Shows enabled/disabled status for all feature modules. Schools can toggle add-ons from here or upgrade their tier:

```
Modules
━━━━━━━
✅ Timetable Builder         Included in Growth plan
✅ Advanced Analytics        Included in Growth plan
☐ Loan Module (Finance)     K275/month   [Enable →]
☐ Integrations              K200/month   [Enable →]
✅ API Read Access           Included in Growth plan
☐ AI Assistant              K200/month   [Enable →]
```

Enabling an add-on creates a `module_subscriptions` row and charges the school's payment method.

---

## Integrations Entry Point

**Location:** Settings → Integrations
**Available:** Professional tier and above, or Integrations add-on

```
Connect your school's other tools to ZSMS.
When a payment is verified in ZSMS, it automatically updates your accounting system.

Connected:
✅ Sage Business Cloud    Last sync: 2 hours ago   [Configure]  [Disconnect]

Available to connect:
[QuickBooks]  [Xero]  [Google Sheets]  [HubSpot]  [Custom Webhook]
```

Full configuration detail in `docs/modules/integrations/INTEGRATIONS.md`.

---

## Security Settings

**Location:** Settings → Security

```
Security
━━━━━━━━

AfriTech Access Log
View when AfriTech team members have accessed your school data.
[View access log →]

Active Sessions
View and revoke active sessions for your school users.
[Manage sessions →]

API Keys
[View API keys →]   (requires API Read feature)
```

---

## Business Rules

1. WhatsApp credentials for school-specific numbers are encrypted before storage. They are never logged, displayed in plaintext, or included in API responses.
2. The `whatsapp_configured` onboarding checklist item is marked complete when either Mode A (shared — immediate) or Mode B (own number with successful test message) is confirmed.
3. Timetable configuration (school day periods) applies to all timetables for the school. Changing periods after a timetable is published requires re-publishing the timetable.
4. Feature add-on toggles in Settings → Modules create immediate module_subscriptions rows and trigger billing. The school owner confirms billing before enabling.
5. The AfriTech access log in Settings → Security shows AfriTech team role, date, duration, and action count — not staff names or data details.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | School configuration reference |
| 2026-04-26 | Added WhatsApp number configuration section | School-specific WhatsApp numbers confirmed |
| 2026-04-26 | Added timetable configuration section | Timetable module confirmed as core feature |
| 2026-04-26 | Added Modules add-on toggle section | Feature toggle billing model confirmed |
| 2026-04-26 | Added Integrations entry point | Accounting and CRM integrations framework |
