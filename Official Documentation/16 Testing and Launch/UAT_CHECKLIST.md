# UAT_CHECKLIST.md — User Acceptance Testing Checklist

## Related Documents

- `docs/testing/TEST_STRATEGY.md` — overall testing approach
- `docs/testing/TEST_DATA.md` — test entities used in these scenarios
- `docs/testing/LAUNCH_CHECKLIST.md` — go/no-go criteria referencing UAT outcomes
- `docs/modules/school/SCHOOL_SETUP.md` — scenario 1
- `docs/modules/fees/PAYMENTS.md` — scenarios 3 and 4
- `docs/modules/results/PUBLISHING.md` — scenario 5

---

## Purpose

This document is the complete User Acceptance Testing checklist for the September 2026 pilot launch. AfriTech runs these scenarios with each of the 10 pilot schools before go-live. Each scenario has step-by-step actions, expected outcomes, and a pass/fail result. All 10 scenarios must pass before a school goes live.

---

## UAT Environment

- **URL:** `staging.zsms.co.zm`
- **Test accounts:** Created per pilot school (real school data — not test seed data)
- **Test payment gateway:** PawaPay sandbox mode
- **WhatsApp:** Meta test phone numbers (AfriTech shared number, sandbox mode)
- **Run by:** AfriTech regional manager + pilot school owner together (screen share)

---

## Scenario 1 — School Onboarding From Scratch

**Tested by:** School owner
**Duration:** 45-60 minutes
**Precondition:** Fresh school account, no configuration

### Steps

| # | Action | Expected Result | Pass |
|---|---|---|---|
| 1 | Log into ZSMS for the first time with invitation email link | Dashboard loads showing onboarding checklist at 0% | ☐ |
| 2 | Navigate to Settings → Academic Structure → Select curriculum type | Three options visible: Traditional ECZ, New Curriculum, Hybrid | ☐ |
| 3 | Select the correct option for this school | Grade level builder pre-populates with appropriate levels | ☐ |
| 4 | Review grade levels — rename any using school's own terminology | Display names saved correctly | ☐ |
| 5 | Navigate to Grading System — select ECZ Percentage | Grade bands A-F shown with correct percentages | ☐ |
| 6 | Navigate to Subjects — review pre-populated list, uncheck subjects not offered, add any custom subjects | Subject list matches school's actual curriculum | ☐ |
| 7 | Navigate to Settings → School Profile — upload school logo | Logo appears in dashboard header and will appear on documents | ☐ |
| 8 | Navigate to Settings → Communication → WhatsApp — choose shared number or configure own | WhatsApp configuration saved, `whatsapp_configured` checklist item marked complete | ☐ |
| 9 | Check onboarding checklist completion percentage | Academic structure items marked complete — checklist at 50%+ | ☐ |
| 10 | Navigate to Fees → Fee Structures → Create fee structure for current term | Fee structure saved with correct amounts | ☐ |

**Pass criteria:** All 10 steps pass. Checklist at 60%+ after completion.

---

## Scenario 2 — Bulk Student Import with Column Mapping

**Tested by:** School admin or owner
**Duration:** 20-30 minutes
**Precondition:** Grade structure configured, at least one fee structure created

### Steps

| # | Action | Expected Result | Pass |
|---|---|---|---|
| 1 | Navigate to Students → Import → Download template | Excel template downloads with correct headers | ☐ |
| 2 | Upload the school's existing student spreadsheet (their own format) | Column mapping screen appears showing school's column headers | ☐ |
| 3 | Map "Pupil Name" → Full Name (or first/last name columns) | Mapping accepted | ☐ |
| 4 | Map "Grade/Form" → Grade Level | Grade level validated against school's configured levels | ☐ |
| 5 | Map "Parent Contact" → Parent Phone | Phone number column mapped | ☐ |
| 6 | Click "Validate with this mapping" | Validation runs — errors shown in red, valid rows in green | ☐ |
| 7 | Fix any validation errors shown (e.g. invalid grade names) | Errors corrected, all rows valid | ☐ |
| 8 | Review preview — confirm student count matches expectation | Preview shows correct number of students | ☐ |
| 9 | Click "Confirm Import" | Progress bar shows import running | ☐ |
| 10 | Import completes — review summary | Success count matches, errors listed if any, first_student checklist item complete | ☐ |
| 11 | Search for a specific student by name | Student found with correct grade and parent linked | ☐ |
| 12 | Check that parent accounts were created for rows with parent phone | Parent can log in using their phone number | ☐ |

**Pass criteria:** All 12 steps pass. At least 90% of students imported successfully.

---

## Scenario 3 — Accountant Records and Verifies a Payment

**Tested by:** School accountant
**Duration:** 15 minutes
**Precondition:** At least one student with an outstanding fee record

### Steps

| # | Action | Expected Result | Pass |
|---|---|---|---|
| 1 | Log in as accountant | Fee dashboard visible with outstanding fee records | ☐ |
| 2 | Navigate to Fees → Verification Queue | Queue shows any pending submissions | ☐ |
| 3 | Navigate to a specific student → Record Payment | Payment form opens | ☐ |
| 4 | Enter amount: K2,500, Method: Cash, Date: today | Amount validated against fee balance | ☐ |
| 5 | Click Submit (accountant-recorded — no proof required for cash) | Payment recorded with status 'verified', receipt generated | ☐ |
| 6 | Open the generated receipt | Receipt PDF displays school logo, student name, amount, receipt number | ☐ |
| 7 | Verify fee record shows 'paid' status | Fee record status updated to 'paid' | ☐ |
| 8 | Check that parent can see the payment in their portal | Parent portal shows payment in history with receipt download | ☐ |

**Pass criteria:** All 8 steps pass. Receipt number in format REC-ZM-XXX-XXXX-XXXXXX.

---

## Scenario 4 — Parent Submits Payment with Proof Upload

**Tested by:** School owner as parent (using parent portal login)
**Duration:** 10 minutes
**Precondition:** Student with outstanding fee record, parent account linked

### Steps

| # | Action | Expected Result | Pass |
|---|---|---|---|
| 1 | Log into parent portal using phone number | OTP sent to email, login successful | ☐ |
| 2 | Navigate to Fees → Outstanding balance for child | Fee balance and outstanding amount shown correctly | ☐ |
| 3 | Click "Submit Payment" on a fee record | Payment form opens | ☐ |
| 4 | Enter amount, select Mobile Money, enter transaction reference | Fields validated | ☐ |
| 5 | Upload a test image as proof of payment | Image uploads successfully | ☐ |
| 6 | Tick confirmation checkbox | Submit button activates | ☐ |
| 7 | Click Submit | Submission reference shown: PAY-ZM-XXX-XXXX-XXXXXX | ☐ |
| 8 | Check parent sees "Pending Verification" status | Status shown correctly in fee history | ☐ |
| 9 | Log in as accountant → check Verification Queue | New submission appears in queue with proof viewable | ☐ |
| 10 | Accountant verifies the payment | Parent portal updates to 'Verified' with receipt download link | ☐ |

**Pass criteria:** All 10 steps pass. Submission reference and receipt number both generated correctly.

---

## Scenario 5 — Teacher Marks Attendance on Mobile (Offline)

**Tested by:** Teacher using mobile app
**Duration:** 15 minutes
**Precondition:** Teacher account with class assignment, mobile app installed

### Steps

| # | Action | Expected Result | Pass |
|---|---|---|---|
| 1 | Open ZSMS mobile app, log in as teacher | Dashboard loads with assigned classes | ☐ |
| 2 | Confirm initial sync is complete | Sync indicator shows 🟢 Synced | ☐ |
| 3 | Put device in airplane mode | Network disconnected | ☐ |
| 4 | Open Attendance → Select class | Class loads with all students (from offline sync) | ☐ |
| 5 | Mark 2 students as absent | Students toggled to absent (red) | ☐ |
| 6 | Tap Save | "Saved locally — will sync when connected" shown | ☐ |
| 7 | Verify sync indicator shows 🟡 Pending (2) | Pending count correct | ☐ |
| 8 | Disable airplane mode | Network restored | ☐ |
| 9 | Wait up to 60 seconds for sync | Sync indicator changes to 🟢 Synced | ☐ |
| 10 | Check web dashboard — attendance recorded for those students | Attendance records appear in school admin view | ☐ |
| 11 | Check principal's daily overview shows the correct absent count | Count matches | ☐ |

**Pass criteria:** All 11 steps pass. Sync completes within 60 seconds.

---

## Scenario 6 — Principal Publishes Results and Generates Report Cards

**Tested by:** School principal
**Duration:** 20 minutes
**Precondition:** At least one class with all marks entered for Term 2

### Steps

| # | Action | Expected Result | Pass |
|---|---|---|---|
| 1 | Log in as principal | Results dashboard visible | ☐ |
| 2 | Navigate to Results → Term 2 → Completeness Check | Completeness check runs — all subjects shown with counts | ☐ |
| 3 | Click "Calculate Positions" | Class positions calculated for all students | ☐ |
| 4 | Preview one student's report card | Report card PDF opens with school logo, correct marks, positions | ☐ |
| 5 | Enter principal's comment for the term | Comment saved | ☐ |
| 6 | Click "Publish Results" | Results published — confirmation shown | ☐ |
| 7 | Verify parents can now see results in their portal | Parent portal shows results tab with marks visible | ☐ |
| 8 | Click "Generate Report Cards" (separate button) | Generation progress screen appears | ☐ |
| 9 | Monitor progress bar until completion | Progress updates in real time, completes in under 90 seconds | ☐ |
| 10 | Parent downloads report card from their portal | PDF downloads correctly with all sections visible | ☐ |

**Pass criteria:** All 10 steps pass. Report card PDF correct in layout and content.

---

## Scenario 7 — WhatsApp Chatbot Fee Query

**Tested by:** AfriTech with test parent phone (Meta sandbox)
**Duration:** 5 minutes
**Precondition:** Parent account with fee records, WhatsApp opted in

### Steps

| # | Action | Expected Result | Pass |
|---|---|---|---|
| 1 | Send "FEES" to ZSMS WhatsApp test number | Response received within 5 seconds | ☐ |
| 2 | Verify response contains student name, school name, outstanding amount | Content correct | ☐ |
| 3 | Send "RESULTS" | Latest published results shown with grades | ☐ |
| 4 | Send "ATTENDANCE" | Last 30 days attendance summary shown | ☐ |
| 5 | Send "HELP" | All available commands listed | ☐ |
| 6 | Send an unrecognised command ("XYZ") | HELP menu returned | ☐ |

**Pass criteria:** All 6 steps pass. All responses received within 5 seconds.

---

## Scenario 8 — Timetable Builder

**Tested by:** School admin
**Duration:** 20 minutes
**Precondition:** Staff assignments configured, subjects configured

### Steps

| # | Action | Expected Result | Pass |
|---|---|---|---|
| 1 | Navigate to Timetable → Configure School Day | Period builder opens | ☐ |
| 2 | Add 6 teaching periods and a morning break | Periods saved with correct times | ☐ |
| 3 | Open Timetable Builder → Select Grade 9A class | Empty grid shown with periods as rows, days as columns | ☐ |
| 4 | Click Monday, Period 1 → Add Mathematics → Select Mr. Banda | Slot created: Mathematics / Mr. Banda / Monday P1 | ☐ |
| 5 | Try to add Mr. Banda to another class at the same time | Conflict error shown: "Mr. Banda is already teaching [class] at this time" | ☐ |
| 6 | Add remaining slots for Grade 9A for the full week | All slots saved | ☐ |
| 7 | Drag a slot from Monday to Tuesday | Slot moves, conflict check passes | ☐ |
| 8 | Click Publish Timetable | Timetable published — teacher and parent can now view | ☐ |
| 9 | Log in as teacher → check My Timetable | Teacher sees their own slots only | ☐ |
| 10 | Log in as parent → check child's timetable | Parent sees Grade 9A timetable | ☐ |

**Pass criteria:** All 10 steps pass. Conflict detection fires correctly.

---

## Scenario 9 — Loan Application (Phase 1)

**Tested by:** School owner acting as parent
**Duration:** 15 minutes
**Precondition:** Finance Module enabled, test lender configured, outstanding fee record

### Steps

| # | Action | Expected Result | Pass |
|---|---|---|---|
| 1 | Parent portal → Fees → Outstanding record → Apply for Fee Loan | Loan introduction screen shown | ☐ |
| 2 | Click Continue → Select Test Finance Zambia | Consent flow starts | ☐ |
| 3 | Scroll to bottom of consent text | Checkbox becomes visible | ☐ |
| 4 | Tick consent checkbox → Click "I Consent" | Consent confirmation screen shown with reference | ☐ |
| 5 | Complete application form — employment details, income | Form validates correctly | ☐ |
| 6 | Upload test payslip document | Document uploaded to private R2 bucket | ☐ |
| 7 | Review repayment estimate | Estimated monthly instalment shown | ☐ |
| 8 | Tick confirmation checkbox → Submit | Application reference shown: LAP-ZM-XXX-XXXX-XXXXXX | ☐ |
| 9 | Check AfriTech admin panel → Loan Applications | Application appears with behaviour score | ☐ |
| 10 | AfriTech loan officer updates status to "Approved" | Parent receives in-app notification: loan approved | ☐ |

**Pass criteria:** All 10 steps pass. Consent log entry created. Behaviour score shown in admin.

---

## Scenario 10 — Super Admin Impersonation and Audit

**Tested by:** AfriTech super admin
**Duration:** 10 minutes
**Precondition:** Pilot school fully configured

### Steps

| # | Action | Expected Result | Pass |
|---|---|---|---|
| 1 | Log into AfriTech admin panel at /admin | Admin dashboard loads with school health grid | ☐ |
| 2 | Search for the pilot school by name | School found instantly | ☐ |
| 3 | Click Impersonate as School Owner | Reason and ticket reference prompt appears | ☐ |
| 4 | Enter reason and click Start Impersonation | School owner dashboard opens with impersonation banner | ☐ |
| 5 | Navigate through the school as the owner | All data visible correctly | ☐ |
| 6 | Click End Impersonation Session | Redirected back to admin panel | ☐ |
| 7 | Check global audit log | Impersonation start and end entries visible | ☐ |
| 8 | Log in as school owner → Settings → Security → AfriTech Access Log | Impersonation session visible with role, duration, action count | ☐ |

**Pass criteria:** All 8 steps pass. Audit trail complete. School owner can see access log.

---

## UAT Sign-Off

Each scenario is signed off by the AfriTech team member who ran it and the pilot school representative who participated.

```
School: ________________________
Date of UAT: ________________________

Scenario Results:
1. School Onboarding:           PASS / FAIL
2. Bulk Import:                 PASS / FAIL
3. Accountant Payment:          PASS / FAIL
4. Parent Payment Submission:   PASS / FAIL
5. Mobile Attendance:           PASS / FAIL
6. Results Publication:         PASS / FAIL
7. WhatsApp Chatbot:            PASS / FAIL
8. Timetable Builder:           PASS / FAIL
9. Loan Application:            PASS / FAIL
10. Impersonation and Audit:    PASS / FAIL

Issues found: ________________________

AfriTech sign-off: ________________________
School sign-off: ________________________
```

A school goes live only after all 10 scenarios pass. Scenarios with issues must be resolved and re-tested before go-live.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 16 testing and launch documentation |
| 2026-04-26 | Added timetable scenario | Timetable module confirmed as core feature |
| 2026-04-26 | Added WhatsApp chatbot scenario | Chatbot is a key parent-facing feature |
| 2026-04-26 | Added impersonation scenario | AfriTech admin tool must be verified before launch |
