# Endpoint Inventory

> **This file is generated. Do not edit it.**
> Run `npm run api:inventory` to refresh it from the route tree.

## Related Documents

- `ENDPOINTS.md` — request and response shapes, auth requirements, reasoning
- `ERROR_CODES.md` — the error vocabulary every route returns
- `RATE_LIMITS.md` — the policy each route falls under

## Purpose

To answer "what endpoints exist right now" without anybody keeping a list by hand.

`ENDPOINTS.md` documents the shapes and the reasoning, which is worth writing and worth reading. It does not cover every route — an audit on 2026-10-11 found it describing 74 of 124 — and hand-writing the rest would produce something accurate for about a week.

## Overview

Generated on 2026-10-11.

**125 routes** across 24 groups.

| Rate limit policy | Routes |
|---|---:|
| api (120/min) | 72 |
| admin (200/min) | 25 |
| financial (20/min) | 9 |
| expensive (30/min) | 6 |
| communication (10/min) | 5 |
| bulk (5/min) | 4 |
| enumeration (10/min) | 3 |
| exempt | 1 |

## `/api/admin`

| Path | Methods | Rate limit |
|---|---|---|
| `/api/admin/billing` | GET, POST | admin (200/min) |
| `/api/admin/costs` | GET | admin (200/min) |
| `/api/admin/curriculum` | GET, POST | admin (200/min) |
| `/api/admin/curriculum/extract` | POST | bulk (5/min) |
| `/api/admin/data-subjects` | GET, POST | admin (200/min) |
| `/api/admin/features` | GET, PATCH | admin (200/min) |
| `/api/admin/impersonate` | POST | admin (200/min) |
| `/api/admin/incidents` | GET, PATCH | admin (200/min) |
| `/api/admin/lenders` | GET, PATCH | admin (200/min) |
| `/api/admin/loans` | GET, PATCH | admin (200/min) |
| `/api/admin/networks` | GET, POST | admin (200/min) |
| `/api/admin/onboarding` | GET, POST | admin (200/min) |
| `/api/admin/overrides` | GET, POST, DELETE | admin (200/min) |
| `/api/admin/overview` | GET | admin (200/min) |
| `/api/admin/price-bands` | GET, POST, PATCH, DELETE | admin (200/min) |
| `/api/admin/schools` | GET | admin (200/min) |
| `/api/admin/schools/[id]` | GET, PATCH | admin (200/min) |
| `/api/admin/schools/[id]/activate` | POST | admin (200/min) |
| `/api/admin/schools/[id]/ai-usage` | GET | admin (200/min) |
| `/api/admin/schools/[id]/checklist` | POST | admin (200/min) |
| `/api/admin/schools/[id]/provisioning` | POST, DELETE | admin (200/min) |
| `/api/admin/schools/provision` | POST | admin (200/min) |
| `/api/admin/settings` | GET, PATCH | admin (200/min) |
| `/api/admin/staff-scope` | GET, POST | admin (200/min) |
| `/api/admin/teacher-hub` | GET, POST, PATCH | admin (200/min) |
| `/api/admin/tiers` | GET, PATCH | admin (200/min) |

## `/api/announcements`

| Path | Methods | Rate limit |
|---|---|---|
| `/api/announcements` | GET, POST | communication (10/min) |
| `/api/announcements/[id]/read` | POST | communication (10/min) |

## `/api/assistant`

| Path | Methods | Rate limit |
|---|---|---|
| `/api/assistant` | GET, POST | expensive (30/min) |
| `/api/assistant/confirm` | POST | expensive (30/min) |

## `/api/attendance`

| Path | Methods | Rate limit |
|---|---|---|
| `/api/attendance` | GET, POST | api (120/min) |

## `/api/audit`

| Path | Methods | Rate limit |
|---|---|---|
| `/api/audit` | GET | api (120/min) |

## `/api/documents`

| Path | Methods | Rate limit |
|---|---|---|
| `/api/documents` | GET | expensive (30/min) |
| `/api/documents/[id]` | GET | expensive (30/min) |

## `/api/fees`

| Path | Methods | Rate limit |
|---|---|---|
| `/api/fees/records` | GET, POST | financial (20/min) |
| `/api/fees/structures` | GET, POST, PATCH | financial (20/min) |

## `/api/health`

| Path | Methods | Rate limit |
|---|---|---|
| `/api/health` | GET | exempt |

## `/api/messages`

| Path | Methods | Rate limit |
|---|---|---|
| `/api/messages` | GET | communication (10/min) |

## `/api/network`

| Path | Methods | Rate limit |
|---|---|---|
| `/api/network/overview` | GET | api (120/min) |

## `/api/parent`

| Path | Methods | Rate limit |
|---|---|---|
| `/api/parent/attendance` | GET | api (120/min) |
| `/api/parent/fees` | GET, POST | api (120/min) |
| `/api/parent/fees/proof` | POST | api (120/min) |
| `/api/parent/link` | POST | api (120/min) |
| `/api/parent/loans` | GET, POST | api (120/min) |
| `/api/parent/notices` | GET, POST | api (120/min) |
| `/api/parent/overview` | GET | api (120/min) |
| `/api/parent/preferences` | GET, PATCH | api (120/min) |
| `/api/parent/results` | GET | api (120/min) |
| `/api/parent/schools` | GET | api (120/min) |
| `/api/parent/timetable` | GET | api (120/min) |

## `/api/payments`

| Path | Methods | Rate limit |
|---|---|---|
| `/api/payments` | GET, POST | financial (20/min) |
| `/api/payments/[id]/verify` | POST | financial (20/min) |

## `/api/public`

| Path | Methods | Rate limit |
|---|---|---|
| `/api/public/schools` | GET | api (120/min) |
| `/api/public/schools/[code]` | GET | api (120/min) |

## `/api/register`

| Path | Methods | Rate limit |
|---|---|---|
| `/api/register/school` | POST | enumeration (10/min) |

## `/api/results`

| Path | Methods | Rate limit |
|---|---|---|
| `/api/results` | GET, POST | api (120/min) |
| `/api/results/publish` | POST | api (120/min) |

## `/api/school`

| Path | Methods | Rate limit |
|---|---|---|
| `/api/school/announcements` | GET, POST, PATCH | communication (10/min) |
| `/api/school/announcements/starters` | GET | communication (10/min) |
| `/api/school/api-keys` | GET, POST, PATCH | api (120/min) |
| `/api/school/attendance/register` | GET, POST | api (120/min) |
| `/api/school/classes` | GET | api (120/min) |
| `/api/school/credits` | GET, POST | api (120/min) |
| `/api/school/credits/usage` | GET | api (120/min) |
| `/api/school/custom-fields` | GET, POST, PATCH | api (120/min) |
| `/api/school/custom-roles` | GET, PATCH | api (120/min) |
| `/api/school/fees` | GET | financial (20/min) |
| `/api/school/fees/[studentId]` | GET, POST | financial (20/min) |
| `/api/school/fees/generate` | POST | financial (20/min) |
| `/api/school/fees/revise` | POST | financial (20/min) |
| `/api/school/fees/verify` | GET, POST | financial (20/min) |
| `/api/school/integrations` | GET, PATCH | api (120/min) |
| `/api/school/join-requests` | GET, POST | enumeration (10/min) |
| `/api/school/loans` | GET | api (120/min) |
| `/api/school/onboarding` | GET, POST | api (120/min) |
| `/api/school/overview` | GET | api (120/min) |
| `/api/school/parent-claims` | GET, POST | api (120/min) |
| `/api/school/payment-details` | GET, PATCH | api (120/min) |
| `/api/school/permissions` | GET, POST, PATCH | api (120/min) |
| `/api/school/public-profile` | GET, PATCH | api (120/min) |
| `/api/school/recipients` | GET | api (120/min) |
| `/api/school/report-cards` | GET, POST | bulk (5/min) |
| `/api/school/results` | GET, POST | api (120/min) |
| `/api/school/results/publish` | POST | api (120/min) |
| `/api/school/results/unlock` | POST | api (120/min) |
| `/api/school/settings` | GET, PATCH | api (120/min) |
| `/api/school/settings/history` | GET | api (120/min) |
| `/api/school/settings/terms` | POST | api (120/min) |
| `/api/school/staff` | GET, POST | api (120/min) |
| `/api/school/staff/members` | PATCH, DELETE | api (120/min) |
| `/api/school/staff/record` | PATCH | api (120/min) |
| `/api/school/structure` | GET | api (120/min) |
| `/api/school/students/[id]/custom-values` | GET, PUT | api (120/min) |
| `/api/school/students/import` | POST | bulk (5/min) |
| `/api/school/students/year-end` | POST | api (120/min) |
| `/api/school/subscription` | GET | api (120/min) |
| `/api/school/teaching` | GET, POST, DELETE | api (120/min) |
| `/api/school/timetable` | GET, POST, PATCH | api (120/min) |

## `/api/schools`

| Path | Methods | Rate limit |
|---|---|---|
| `/api/schools` | GET, PATCH | api (120/min) |

## `/api/session`

| Path | Methods | Rate limit |
|---|---|---|
| `/api/session/erasure` | GET, POST, DELETE | api (120/min) |
| `/api/session/impersonation` | GET, DELETE | api (120/min) |
| `/api/session/my-data` | POST | api (120/min) |
| `/api/session/notices` | GET, POST | api (120/min) |
| `/api/session/portals` | GET | api (120/min) |
| `/api/session/push-token` | POST, DELETE | api (120/min) |
| `/api/session/schools` | GET | api (120/min) |
| `/api/session/staff-record` | POST | api (120/min) |
| `/api/session/whoami` | GET | api (120/min) |

## `/api/staff`

| Path | Methods | Rate limit |
|---|---|---|
| `/api/staff` | GET, POST | api (120/min) |

## `/api/student`

| Path | Methods | Rate limit |
|---|---|---|
| `/api/student/overview` | GET | api (120/min) |

## `/api/students`

| Path | Methods | Rate limit |
|---|---|---|
| `/api/students` | GET, POST | api (120/min) |
| `/api/students/[id]` | GET, PATCH, DELETE | api (120/min) |
| `/api/students/[id]/guardians` | POST, DELETE | api (120/min) |

## `/api/teacher`

| Path | Methods | Rate limit |
|---|---|---|
| `/api/teacher/community` | GET, PATCH | api (120/min) |
| `/api/teacher/credits` | GET | api (120/min) |
| `/api/teacher/hub` | GET, POST, PATCH | api (120/min) |
| `/api/teacher/hub/resources` | GET, POST | expensive (30/min) |
| `/api/teacher/hub/resources/[id]` | GET, PATCH | expensive (30/min) |
| `/api/teacher/hub/resources/[id]/export` | GET | bulk (5/min) |
| `/api/teacher/hub/subscription` | DELETE | api (120/min) |
| `/api/teacher/overview` | GET | api (120/min) |
| `/api/teacher/school-link` | GET, POST, DELETE | enumeration (10/min) |
| `/api/teacher/timetable` | GET | api (120/min) |

## `/api/v1`

| Path | Methods | Rate limit |
|---|---|---|
| `/api/v1/[...resource]` | GET | api (120/min) |

## `/api/webhooks`

| Path | Methods | Rate limit |
|---|---|---|
| `/api/webhooks/clerk` | POST | api (120/min) |

## Business Rules

- Every route returns the fixed envelope: `{ data, meta? }` on success, `{ error, code, details? }` on failure.
- The rate limit column is computed by mirroring the policy order in `apps/web/lib/rate-limit.ts`. **That file is authoritative** — if the two ever disagree, this table is the one that is wrong.
- `/api/v1/*` is the external integration surface and is additionally limited per API key by `rate_limit_rpm` (`0241`), which the IP-based policy above does not replace.

## Change Log

| Date | Change |
|---|---|
| 2026-10-11 | Generated for the first time, after an audit found `ENDPOINTS.md` describing 74 of 124 routes. |
