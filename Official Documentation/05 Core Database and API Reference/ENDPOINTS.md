# ENDPOINTS.md — API Endpoints Reference

## Related Documents

- `docs/api/SCHEMA.md` — data model
- `docs/api/ERROR_CODES.md` — error responses
- `docs/api/RATE_LIMITS.md` — rate limiting rules
- `docs/api/EDGE_FUNCTIONS.md` — Supabase Edge Functions
- `docs/modules/auth/AUTH.md` — authentication for each endpoint

---

## Purpose

This document lists every ZSMS API endpoint — the route, HTTP method, authentication required, and what it does. Every Claude Code session adding a new endpoint must add it here.

---

## Authentication

All endpoints require a valid Clerk JWT in the `Authorization: Bearer {token}` header unless marked as `[Public]`.

---

## School Management

```
GET    /api/schools/search                    [Public] Search school directory
GET    /api/schools/:school_id               School members — view own school
PATCH  /api/schools/:school_id               org:owner, org:admin — update school
GET    /api/schools/:school_id/config        School members — view configuration
PATCH  /api/schools/:school_id/config        org:owner, org:admin — update config
GET    /api/schools/:school_id/onboarding    School admin — onboarding checklist
PATCH  /api/schools/:school_id/onboarding/:item  Mark checklist item complete
```

---

## Students

```
GET    /api/students                          School staff — list students (filtered by role)
POST   /api/students                          org:admin, org:owner — create student
GET    /api/students/:student_id             School staff, linked parent — view student
PATCH  /api/students/:student_id             org:admin, org:owner, org:principal — update
DELETE /api/students/:student_id             org:admin, org:owner — soft delete
POST   /api/students/bulk-import             org:admin, org:owner — trigger bulk import
GET    /api/students/import-jobs/:job_id     Track import progress
POST   /api/students/:student_id/graduate    org:admin, org:principal — graduate student
POST   /api/students/:student_id/transfer    org:admin, org:principal — transfer student
```

---

## Parents and Linking

```
GET    /api/parents                           org:admin — list parents
POST   /api/parents                           org:admin — create parent
GET    /api/parents/:parent_id               School admin, self — view parent
PATCH  /api/parents/:parent_id               Self — update own profile (whatsapp_opted_in, marketing_opt_in)
POST   /api/students/:student_id/link-parent org:admin — link parent to student
DELETE /api/students/:student_id/parents/:parent_id  org:admin — unlink parent
```

---

## Staff and Timetable

```
GET    /api/staff                             School admin — list staff
POST   /api/staff/invite                      org:owner, org:admin — invite staff member
DELETE /api/staff/:staff_id                   org:owner, org:admin — remove staff
GET    /api/staff/assignments                 org:teacher — view own class assignments
POST   /api/staff/assignments                 org:admin — assign teacher to class

GET    /api/timetables                        School staff, parents, students — list timetables
POST   /api/timetables                        org:admin, org:principal — create timetable
GET    /api/timetables/:timetable_id         School members — view timetable
PATCH  /api/timetables/:timetable_id/publish org:admin, org:principal — publish timetable
GET    /api/timetables/:timetable_id/slots   School members — view all slots
POST   /api/timetables/:timetable_id/slots   org:admin, org:principal — add slot
PATCH  /api/timetables/:timetable_id/slots/:slot_id  Update slot
DELETE /api/timetables/:timetable_id/slots/:slot_id  Delete slot
GET    /api/timetables/periods               School members — view school day periods
POST   /api/timetables/periods               org:admin — add period
```

---

## Fees and Payments

```
GET    /api/fees/structures                  School staff — list fee structures
POST   /api/fees/structures                  org:accountant, org:admin — create structure
POST   /api/fees/records/generate            org:accountant, org:admin — bulk generate records
GET    /api/fees/records                     School staff — list fee records
GET    /api/fees/records/:record_id          Staff, linked parent — view fee record
GET    /api/fees/verification-queue          org:accountant, org:admin — pending verifications

POST   /api/fees/payments                    School staff, org:parent — submit payment
PATCH  /api/fees/payments/:payment_id/verify org:accountant, org:admin — verify payment
PATCH  /api/fees/payments/:payment_id/reject org:accountant, org:admin — reject payment

GET    /api/fees/receipts/:receipt_number    Staff, linked parent — view receipt
POST   /api/fees/statements/generate         Staff, org:parent — generate fee statement
```

---

## Attendance

```
GET    /api/attendance                        School staff (scoped by role) — list records
POST   /api/attendance/bulk                   org:teacher (own classes) — bulk mark attendance
GET    /api/attendance/summary/:student_id   Staff, linked parent — attendance summary
GET    /api/attendance/class/:class_id/date/:date  Teacher, admin — class attendance sheet
```

---

## Results and Report Cards

```
GET    /api/results                           School staff (scoped) — list results
POST   /api/results/bulk                      org:teacher (own classes/subjects) — bulk entry
PATCH  /api/results/:result_id               org:teacher (own, unpublished) — update mark
POST   /api/results/publish                   org:principal, org:admin — publish results
POST   /api/results/calculate-positions       org:principal — calculate class positions
POST   /api/reports/generate                  org:principal, org:admin — bulk report cards
GET    /api/reports/jobs/:run_id             Track generation progress
```

---

## Communication

```
GET    /api/announcements                     School members — list announcements
POST   /api/announcements                     org:admin, org:principal — create
POST   /api/announcements/:id/send           org:admin, org:principal — dispatch
POST   /api/announcements/:id/reads          Any authenticated — mark as read
GET    /api/announcements/:id/analytics      org:admin, org:principal — read analytics
GET    /api/messages/log                      org:admin, org:accountant — message history
```

---

## Loans

```
GET    /api/loans/lenders                     Any authenticated — list active lenders
POST   /api/loans/consent                     org:parent — record consent
POST   /api/loans/apply                       org:parent — submit application
GET    /api/loans/applications               org:parent (own), org:accountant (school's)
GET    /api/loans/applications/:id           org:parent (own), org:accountant, afritech:loan_officer
PATCH  /api/loans/applications/:id/status    afritech:loan_officer — update status (Phase 1 manual)
POST   /api/loans/repayments/initiate         org:parent — initiate repayment (Phase 2)
```

---

## Integrations

```
GET    /api/integrations                      org:owner, org:admin — list integrations
POST   /api/integrations                      org:owner, org:admin — create integration
PATCH  /api/integrations/:id                 org:owner, org:admin — update config
DELETE /api/integrations/:id                 org:owner, org:admin — disconnect
POST   /api/integrations/:id/test            org:owner, org:admin — send test event
GET    /api/integrations/:id/log             org:owner, org:admin — event log
POST   /api/integrations/:id/retry-failed    org:owner, org:admin — retry failed events
POST   /api/storage/upload-url               Any authenticated — get pre-signed PUT URL
```

---

## AI and Teacher Hub

```
POST   /api/ai/assistant                      School staff, org:parent, platform:teacher — send message
GET    /api/ai/conversations/:id             Own conversations only — view history
DELETE /api/ai/conversations/:id             Own conversations — delete history

POST   /api/ai/lesson-plans                  org:teacher, platform:teacher — generate plan
GET    /api/ai/lesson-plans                  Own plans — list
GET    /api/ai/lesson-plans/:id             Own plans, or shared = true — view plan
PATCH  /api/ai/lesson-plans/:id             Own plans — update/share
DELETE /api/ai/lesson-plans/:id             Own plans — delete

GET    /api/ai/lesson-plans/community        Any authenticated — browse shared plans
POST   /api/ai/quizzes                       org:teacher, platform:teacher — generate quiz
POST   /api/ai/homework                      org:teacher, platform:teacher — generate homework

GET    /api/ai/analytics/completeness        School admin — data completeness score
GET    /api/ai/analytics/at-risk             org:admin, org:principal — at-risk students
GET    /api/ai/analytics/performance         School staff — class performance data
GET    /api/ai/analytics/fee-collection      org:accountant, org:admin — fee analytics
```

---

## Standalone Teacher Hub

**Built 2026-09-27.** The paths differ from the plan below them: `/api/teacher/hub/…`, matching the `/teacher` URL space
the screens use, rather than a second `teacher-hub` prefix.

```
GET    /api/teacher/hub                      own account, entitlement and the plan catalogue
POST   /api/teacher/hub                      self-registration (the profile step)
PATCH  /api/teacher/hub                      update own profile
GET    /api/teacher/hub/resources            own library, filterable by kind/subject/grade
POST   /api/teacher/hub/resources            generate a resource and save it
GET    /api/teacher/hub/resources/[id]       one resource, full document
PATCH  /api/teacher/hub/resources/[id]       rename, annotate, share, or remove (soft)
DELETE /api/teacher/hub/subscription         cancel — takes effect at the end of the period
GET    /api/admin/teacher-hub                afritech:* — every Hub account with usage
POST   /api/admin/teacher-hub                afritech:* — record a payment, activate a plan
```

**Three differences from the plan, each deliberate:**

- **No `POST /api/teacher-hub/signup` as a public route.** Registration needs an authenticated session, because the row
  is keyed to the Clerk user id and the INSERT policy compares it to `get_user_id()`. Sign-up is Clerk's; the profile
  step is `POST /api/teacher/hub`.
- **No `POST …/subscription`.** Payment is recorded by hand, so a teacher-callable activation would grant the paid
  product for nothing. Activation is `POST /api/admin/teacher-hub`, and `teacher_hub_activate_subscription()` refuses
  anybody who is not AfriTech.
- **No `POST …/link-school`.** There is no invitation code to redeem: ZSMS invites staff server-side through the Clerk
  Backend API, so linking happens when a school invites the teacher, and `my_schools()` reflects it immediately.

`GET …/subscription` is folded into `GET /api/teacher/hub`, which returns the account, the resolved entitlement and the
plan catalogue in one call — the shell needs all three on every page.

---

## Alumni Portal

```
GET    /api/alumni/profile                   platform:alumni — view own profile
PATCH  /api/alumni/profile                   platform:alumni — update marketing_opt_in
GET    /api/alumni/documents                 platform:alumni — list historical documents
POST   /api/alumni/documents/signed-url      platform:alumni — get download URL
POST   /api/alumni/certificates/attendance   platform:alumni — request attendance certificate
```

---

## Templates and Documents

```
GET    /api/templates                         School admin — list document templates
PATCH  /api/templates/:doc_type              School admin — update template config
POST   /api/templates/preview                School admin — generate preview PDF
```

---

## Webhooks (Inbound)

```
GET    /api/webhooks/whatsapp                [Public] Meta webhook verification
POST   /api/webhooks/whatsapp                [Public] Meta delivery status + inbound messages
POST   /api/webhooks/payment/pawapay         [Public] PawaPay payment status
POST   /api/webhooks/payment/flutterwave     [Public] Flutterwave payment status
POST   /api/webhooks/clerk                   [Public] Clerk user/org events
POST   /api/webhooks/loan                    [Public] Lender disbursement/repayment status
POST   /api/webhooks/qstash                  [Public] queued job delivery (internal)
```

All webhook endpoints verify HMAC signatures before processing. Return 401 for invalid signatures.

---

## External API (School-Generated API Keys)

```
GET    /api/v1/students                      API key with students:read scope
POST   /api/v1/students                      API key with students:write scope
GET    /api/v1/fee-records                   API key with fees:read scope
GET    /api/v1/results                       API key with results:read scope
GET    /api/v1/attendance                    API key with attendance:read scope
POST   /api/v1/webhooks                      API key — register outbound webhook
```

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | API reference |
| 2026-04-26 | Added timetable endpoints | Timetable module confirmed |
| 2026-04-26 | Added announcement endpoints | Communication module |
| 2026-04-26 | Added alumni portal endpoints | Graduated account model |
| 2026-04-26 | Added AI and lesson planner endpoints | AI module |
| 2026-04-26 | Added Teacher Hub endpoints | Standalone teacher B2C product |
| 2026-04-26 | Added integration connector endpoints | Accounting/CRM integrations |
