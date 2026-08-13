# TEST_STRATEGY.md — Testing Strategy

## Related Documents

- `docs/testing/TEST_DATA.md` — seed data for test environments
- `docs/testing/UAT_CHECKLIST.md` — user acceptance testing scenarios
- `docs/testing/LAUNCH_CHECKLIST.md` — pre-launch verification
- `docs/testing/SECURITY_AUDIT.md` — security-specific tests
- `docs/testing/PERFORMANCE_CHECKLIST.md` — performance validation
- `docs/CONVENTIONS.md` — code conventions tests must follow
- `docs/infra/SUPABASE.md` — local Supabase CLI for testing

---

## Purpose

This document defines the ZSMS testing philosophy, what is tested, what is not tested, and how tests are structured and run. Every Claude Code session adding a new feature must consider whether it falls into a tested category and add tests accordingly.

---

## Testing Philosophy — Pragmatic Coverage

ZSMS is built by a two-person founding team using Lovable for the web UI and Claude Code for the backend and mobile app. A 100% coverage target is neither realistic nor necessary. The testing strategy focuses on four high-risk areas where a bug causes real harm:

1. **RLS Policies** — A security bug that lets a parent at School A see School B's data is catastrophic and unrecoverable from a trust perspective
2. **Grading Calculation** — A bug in grade calculation produces wrong report cards distributed to 400 parents — embarrassing and potentially damaging to the school
3. **Payment Verification Flow** — A bug that double-counts a payment or records the wrong amount has direct financial impact
4. **Behaviour Score Algorithm** — A bug that inflates or deflates scores affects loan decisions — financial harm to parents

Everything else is covered by the UAT checklist with real pilot school users who will catch UX issues and edge cases that automated tests would never identify.

---

## Testing Layers

### Layer 1 — Unit Tests (Pure Functions)

Unit tests cover pure functions with no database or external dependencies. These run in milliseconds and must pass before any code is merged.

**Location:** `packages/utils/__tests__/`

**What is unit tested:**

```typescript
// Grade calculation
describe('calculateGrade', () => {
  test('ECZ: 80 marks = A (Distinction)', () => {
    expect(calculateGrade(80, 100, ECZ_PERCENTAGE_BANDS)).toEqual({
      grade_letter: 'A',
      grade_points: 1,
      percentage: 80,
      is_passing: true,
      descriptor: 'Distinction',
    })
  })

  test('ECZ: 79 marks = B (Merit)', () => {
    expect(calculateGrade(79, 100, ECZ_PERCENTAGE_BANDS)).toEqual({
      grade_letter: 'B',
      grade_points: 2,
      percentage: 79,
      is_passing: true,
      descriptor: 'Merit',
    })
  })

  test('ECZ: boundary 65 is exactly B', () => { /* ... */ })
  test('ECZ: 0 marks = F (Fail)', () => { /* ... */ })
  test('Custom marks_total: 45/60 = 75% = B', () => { /* ... */ })
  test('Cambridge O-Level: 90 = A*', () => { /* ... */ })
  test('Tied position ranking: standard competition', () => { /* ... */ })
  test('Grade override does not recalculate', () => { /* ... */ })
})

// Behaviour score
describe('calculateBehaviourScore', () => {
  test('All on-time payments = score near 850', () => { /* ... */ })
  test('No payment history = score 500 (neutral)', () => { /* ... */ })
  test('Multiple missed payments = score below 450', () => { /* ... */ })
  test('Score is always between 300 and 850', () => { /* ... */ })
  test('Prior ZSMS loan repaid adds 15 behaviour points', () => { /* ... */ })
})

// Student ID generation
describe('generateStudentId', () => {
  test('Format: STU-ZM-LSK-0001-00001', () => { /* ... */ })
  test('Sequence increments per school', () => { /* ... */ })
  test('Pads sequence to 5 digits', () => { /* ... */ })
})

// Payment amount formatting
describe('formatCurrency', () => {
  test('ZMW: K2,500.00', () => { /* ... */ })
  test('ZMW: K0.00', () => { /* ... */ })
  test('Handles negative amounts for reversals', () => { /* ... */ })
})

// Behaviour score category functions
describe('scorePaymentHistory', () => { /* ... */ })
describe('scorePaymentCapacity', () => { /* ... */ })
describe('scoreAccountBehaviour', () => { /* ... */ })
describe('scoreRiskIndicators', () => { /* ... */ })

// Phone normalisation
describe('normalisePhone', () => {
  test('0977123456 → +260977123456', () => { /* ... */ })
  test('+260977123456 → +260977123456 (no change)', () => { /* ... */ })
  test('Invalid number returns null', () => { /* ... */ })
})

// Consent text hashing
describe('hashConsentText', () => {
  test('Same text always produces same hash', () => { /* ... */ })
  test('Different text produces different hash', () => { /* ... */ })
})
```

**Running unit tests:**
```bash
# From monorepo root
turbo test --filter=utils

# Watch mode during development
turbo test --filter=utils -- --watch
```

---

### Layer 2 — RLS Policy Tests (Security Critical)

RLS tests use a local Supabase instance (via `supabase start`) to verify that data isolation is correctly enforced. These are integration tests but scoped to the security layer.

**Location:** `supabase/tests/rls/`

**Framework:** pgTAP (PostgreSQL testing framework built into Supabase)

```sql
-- supabase/tests/rls/school_isolation_test.sql

BEGIN;
SELECT plan(10);

-- Set up test schools and users
SELECT tests.create_supabase_user('parent_school_a@test.com', 'parent_school_a');
SELECT tests.create_supabase_user('parent_school_b@test.com', 'parent_school_b');

-- Test: Parent at School A cannot see School B's students
SELECT tests.authenticate_as('parent_school_a');
SELECT is(
  (SELECT COUNT(*) FROM students WHERE school_id = 'school_b_id'),
  0::bigint,
  'Parent at School A sees 0 students from School B'
);

-- Test: Teacher can only see their assigned classes
SELECT tests.authenticate_as('teacher_grade_9a');
SELECT is(
  (SELECT COUNT(*) FROM students WHERE class_id = 'grade_9b'),
  0::bigint,
  'Teacher assigned to 9A sees 0 students from 9B'
);

-- Test: Parent cannot see another student's fee records
SELECT tests.authenticate_as('parent_student_a');
SELECT is(
  (SELECT COUNT(*) FROM fee_records WHERE student_id = 'student_b_id'),
  0::bigint,
  'Parent of Student A sees 0 fee records for Student B'
);

-- Test: Private schema is inaccessible via anon role
SET ROLE anon;
SELECT throws_ok(
  'SELECT * FROM private.loan_applications',
  'permission denied for schema private',
  'Anon cannot access private schema'
);

-- Test: Audit logs are INSERT-only — no UPDATE
SELECT tests.authenticate_as('school_owner');
SELECT throws_ok(
  'UPDATE audit_logs SET action = ''hacked'' WHERE id = (SELECT id FROM audit_logs LIMIT 1)',
  'permission denied for table audit_logs',
  'School owner cannot UPDATE audit_logs'
);

SELECT * FROM finish();
ROLLBACK;
```

**Running RLS tests:**
```bash
supabase test db
```

---

### Layer 3 — API Integration Tests (Payment Flow)

Integration tests for the payment verification flow using real Edge Function calls against the local Supabase instance.

**Location:** `supabase/functions/__tests__/`

**Framework:** Deno test (`Deno.test`)

```typescript
// supabase/functions/__tests__/payment-verification.test.ts

Deno.test('Payment verification: pending → verified updates fee record', async () => {
  // Setup
  const { payment, feeRecord } = await createTestPayment({
    amount: 2500,
    status: 'pending_verification',
    feeRecordStatus: 'unpaid',
  })

  // Action: verify the payment
  const response = await callEdgeFunction('webhook-payment', {
    gatewayName: 'test',
    payload: buildTestWebhookPayload(payment.gateway_reference, 'successful'),
  })

  // Assert payment verified
  const updatedPayment = await getPayment(payment.id)
  assertEquals(updatedPayment.status, 'verified')
  assertExists(updatedPayment.receipt_number)

  // Assert fee record updated
  const updatedFeeRecord = await getFeeRecord(feeRecord.id)
  assertEquals(updatedFeeRecord.status, 'paid')
  assertEquals(updatedFeeRecord.amount_paid, 2500)
})

Deno.test('Payment verification: partial payment leaves fee as partial', async () => {
  const { payment, feeRecord } = await createTestPayment({
    amount: 1000,  // Partial — fee is K2,500
    status: 'pending_verification',
    feeRecordStatus: 'unpaid',
  })
  // ... verify updates to partial status
})

Deno.test('Duplicate gateway reference is detected and rejected', async () => {
  // ... test duplicate detection
})

Deno.test('Missing confirmation_checkbox_at returns 400', async () => {
  const response = await callApiRoute('/api/fees/payments', {
    fee_record_id: 'valid-uuid',
    amount: 2500,
    payment_method: 'mobile_money',
    proof_of_payment_url: 'valid-r2-key',
    // confirmation_checkbox_at missing
  })
  assertEquals(response.status, 400)
  const body = await response.json()
  assertEquals(body.code, 'MISSING_CONFIRMATION')
})
```

**Running integration tests:**
```bash
supabase start  # Start local Supabase
deno test supabase/functions/__tests__/ --allow-net --allow-env
```

---

### Layer 4 — End-to-End Tests (Critical User Journeys)

E2E tests using Playwright verify the full user journey in a real browser against the staging environment. Run before every production deployment.

**Location:** `apps/web/e2e/`

**Scenarios tested (the critical 5):**

```typescript
// apps/web/e2e/payment-flow.spec.ts
test('Parent submits payment and receives acknowledgement', async ({ page }) => {
  await loginAsParent(page, TEST_PARENT_PHONE)
  await page.goto('/portal/fees')
  await page.click('[data-testid="submit-payment-btn"]')
  await page.fill('[data-testid="amount-input"]', '2500')
  await uploadTestProof(page)
  await page.check('[data-testid="confirmation-checkbox"]')
  await page.click('[data-testid="submit-btn"]')
  await expect(page.locator('[data-testid="submission-reference"]')).toBeVisible()
  await expect(page.locator('[data-testid="submission-reference"]')).toContainText('PAY-ZM-')
})

// apps/web/e2e/results-publication.spec.ts
test('Principal publishes results and parents can view', async ({ page }) => { /* ... */ })

// apps/web/e2e/parent-login.spec.ts
test('Parent logs in via student ID discovery', async ({ page }) => { /* ... */ })

// apps/web/e2e/bulk-import.spec.ts
test('Admin imports 50 students from CSV with column mapping', async ({ page }) => { /* ... */ })

// apps/web/e2e/timetable.spec.ts
test('Admin creates timetable with conflict detection', async ({ page }) => { /* ... */ })
```

**Running E2E tests:**
```bash
# Against staging environment
PLAYWRIGHT_BASE_URL=https://staging.zsms.co.zm npx playwright test

# Headed mode for debugging
npx playwright test --headed
```

---

### Layer 5 — Mobile App Tests (Offline Attendance)

React Native tests using Jest + Detox for the offline attendance marking flow.

**Location:** `apps/mobile/e2e/`

**Critical mobile test:**
```typescript
// apps/mobile/e2e/offlineAttendance.e2e.ts
describe('Offline attendance marking', () => {
  beforeAll(async () => {
    await device.launchApp()
    await loginAsTeacher()
    await device.setNetworkConditions({ offline: true })  // Simulate offline
  })

  it('marks student absent offline and shows pending indicator', async () => {
    await element(by.id('attendance-tab')).tap()
    await element(by.id('class-grade-9a')).tap()
    await element(by.id('student-chanda-bwalya')).tap()  // Toggle to absent
    await element(by.id('save-attendance-btn')).tap()
    await expect(element(by.id('sync-indicator'))).toHaveText('Pending (1)')
  })

  it('syncs when connectivity restored', async () => {
    await device.setNetworkConditions({ offline: false })
    await waitFor(element(by.id('sync-indicator')))
      .toHaveText('Synced')
      .withTimeout(30000)
  })
})
```

---

### Layer 6 — Load Tests (Scaling Verification)

Load tests verify that ZSMS meets the growth-milestone targets in `SCALING.md`. **k6 is the primary tool; Artillery is secondary** for YAML smoke tests and Supabase Realtime WebSocket testing (ADR-033).

**Location:** `tests/load/k6/` and `tests/load/artillery/`

Load testing exists because ZSMS traffic is bursty and correlated — every school marks attendance in the same half hour, every school publishes results in the same fortnight. Averaged load proves nothing about the only moments that matter, so every scenario models a real, named school event.

```javascript
// tests/load/k6/attendance-surge.js — the most important scenario
export const options = {
  scenarios: {
    attendance_surge: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '5m',  target: 200 },   // 07:00 — early teachers
        { duration: '15m', target: 1000 },  // 07:15 — peak
        { duration: '10m', target: 1000 },  // sustained
        { duration: '5m',  target: 100 },   // 07:50 — tail
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1000', 'p(99)<2000'],
    errors: ['rate<0.005'],
    http_req_failed: ['rate<0.01'],
  },
}
```

Thresholds are declarative, so a load test result is an unambiguous pass or fail rather than a graph requiring interpretation. This matters because load results gate launch milestones.

**The eight scenarios** — attendance surge, results publication, bulk generation, portal steady load, payment burst, mixed realistic day, soak, and spike — are specified in full in `LOAD_TESTING.md`, along with the milestone matrix mapping each to the pilot (10 schools), launch (50 schools), and scale (200 schools) targets.

**Running load tests:**
```bash
# Seed staging to the target milestone first
npm run seed:staging -- --profile=launch

# Full milestone suite
npm run loadtest -- --milestone=launch --out=results/launch-$(date +%F).json

# Artillery smoke (also runs on every staging deploy)
artillery run tests/load/artillery/smoke.yml
```

**Load tests run against staging only — never production, never `zsms-dev`.** They do not run per pull request; they run before each launch gate, after any change to a hot path or the queue architecture, and monthly once the pilot is live.

---

## CI/CD Test Execution

```yaml
# .github/workflows/test.yml
name: Test

on: [push, pull_request]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npx turbo lint type-check test --filter=utils

  rls-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
      - run: supabase start
      - run: supabase test db

  # E2E tests only run on integration branch (pre-staging deployment)
  e2e-tests:
    if: github.ref == 'refs/heads/integration'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx playwright test
        env:
          PLAYWRIGHT_BASE_URL: https://staging.zsms.co.zm
```

---

## What Is Explicitly Not Tested

- Lovable-generated UI components (covered by UAT)
- Database migration correctness (verified by `supabase db diff` after each migration)
- Third-party service behaviour (Meta, Twilio, R2) — mocked in tests
- 100% branch coverage of API routes — only payment and loan routes require integration tests

---

## Business Rules

1. Unit tests for grading calculation, behaviour score, and student ID generation must pass before any production deployment.
2. RLS tests must pass before any migration that adds or modifies RLS policies goes to production.
3. E2E tests for the payment submission flow must pass before any payment-related change goes to production.
4. No test should use real phone numbers, real school data, or real financial amounts — all test data uses clearly fictional entities.
5. Tests that require a Supabase connection use the local CLI instance, never the staging or production database.
6. Load tests run against staging only. Running a load test against production is prohibited — it is a self-inflicted denial of service against real schools.
7. Every growth milestone in `SCALING.md` must pass its required load scenarios before the corresponding launch gate. A failing threshold blocks the gate and is not waived without an ADR recording the accepted risk.
8. Third-party services are never load tested. Meta, Twilio, and payment gateways are mocked.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 16 testing and launch documentation |
| 2026-04-26 | Scoped testing to four high-risk areas | Realistic for two-person founding team |
| 2026-04-26 | Added behaviour score unit tests | Loan module scoring algorithm critical |
| 2026-04-26 | Added pgTAP for RLS testing | Security-critical — automated not manual |
| 2026-08-13 | Added Layer 6 — load tests with k6 primary, Artillery secondary | ADR-033; scaling targets in SCALING.md were previously unverified |
| 2026-08-13 | Added business rules 6–8 covering load test scope and gating | Staging-only, milestone gating, and third-party mocking are absolute |
