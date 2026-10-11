# TEST_DATA.md — Test Data and Seed Scripts

## Related Documents

- `docs/testing/TEST_STRATEGY.md` — testing approach that uses this data
- `docs/testing/UAT_CHECKLIST.md` — UAT scenarios that use these entities
- `docs/infra/SUPABASE.md` — seed data applied to zsms-dev project
- `docs/countries/ZM.md` — Zambia reference data used in seed
- `docs/CONVENTIONS.md` — test entity naming conventions

---

## Implementation Status (2026-10-11)

**Built as `supabase/seed/dev_seed.sql`**, run by `npm run db:seed`, which **refuses any
project but `zsms-dev`** — the one guard that matters, since the region exception in
`COMPLIANCE.md` depends entirely on dev holding synthetic data only.

Seeded: 6 schools spanning the health bands, teaching assignments (so the directory's
verified ratio has something to divide), 6 grading scales, 24 subjects, and 95 exam
results graded through `grade_from_scale_version()` **with the scale version recorded** —
the fixture exercises the real grading path rather than hardcoding letters.

Three schools sit in three different publishing states and two have no profile row at all
— the default, and the case a public directory is likeliest to render wrongly.

**Deliberately not seeded:**

- **Loan applications.** A synthetic one means synthetic employment and income, and this
  document is the right place to decide whether that is wanted before inventing it.
- **A lender's collection details.** `0260` deactivated the seeded lender rather than
  giving it a plausible Airtel number: the lender is a real company, and fabricated
  payment details in front of a parent about to send money is the most harmful thing a
  seed could do.

**Never load real school data into `zsms-dev`** — no production dumps, no anonymised
extracts, no pilot records.

---

## Purpose

This document defines every test entity, seed script, and test scenario setup that Claude Code sessions need to build and test ZSMS features. All test data is clearly fictional — never real school names, real phone numbers, or real financial amounts. Every Claude Code session that needs test data reads this document first before inventing its own.

---

## Test Data Principles

1. All test phone numbers use the `+260700XXXXXX` range — Zamtel test numbers, non-routable
2. All test emails use the `@zsms-test.invalid` domain — guaranteed non-deliverable
3. All test school IDs follow real format but use sequence numbers above 9000 (e.g. ZM-LSK-9001) — clearly fictional
4. All test student IDs use school sequence 9001 (STU-ZM-LSK-9001-XXXXX)
5. Test financial amounts use round numbers (K1,000, K2,500, K5,000) — easy to verify in assertions
6. Never use real MFI names, real lender data, or real commission amounts in tests

---

## Test Schools

### School A — ECZ Traditional Day School (Lusaka)

```typescript
export const TEST_SCHOOL_A = {
  school_id: 'ZM-LSK-9001',
  name: 'Test Academy Lusaka',
  type: 'day',
  level: 'combined',
  city_code: 'LSK',
  country_code: 'ZM',
  subscription_tier: 'growth',
  status: 'active',
  curriculum_type: 'ecz_grades',
  // Uses ECZ percentage grading
  // Grade 1 through Grade 12
  // WhatsApp: AfriTech shared number (whatsapp_owns_number = FALSE)
}
```

### School B — Cambridge Boarding School (Copperbelt)

```typescript
export const TEST_SCHOOL_B = {
  school_id: 'ZM-CBE-9001',
  name: 'Test College Copperbelt',
  type: 'boarding',
  level: 'secondary',
  city_code: 'CBE',
  country_code: 'ZM',
  subscription_tier: 'professional',
  status: 'active',
  curriculum_type: 'cambridge_forms',
  // Uses Cambridge O-Level (Forms 1-4) and A-Level (Forms 5-6)
  // WhatsApp: School-specific number (whatsapp_owns_number = TRUE)
  whatsapp_phone_number_id: 'test_phone_number_id_001',
}
```

### School C — Trial School (For trial expiry tests)

```typescript
export const TEST_SCHOOL_C = {
  school_id: 'ZM-LSK-9002',
  name: 'Test Trial School',
  type: 'day',
  level: 'primary',
  status: 'trial',
  trial_ends_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
  // Trial expires in 5 days — used for trial expiry testing
}
```

---

## Test Grade Structure (School A)

```sql
-- School A grade levels (ECZ Traditional)
INSERT INTO school_grade_levels (school_id, level_id, display_name, level_order, level_type, examination_type, is_active)
VALUES
  ('school_a_uuid', 'grade_1',  'Grade 1',  1,  'primary',           'none',       TRUE),
  ('school_a_uuid', 'grade_6',  'Grade 6',  6,  'primary',           'ecz',        TRUE),
  ('school_a_uuid', 'grade_7',  'Grade 7',  7,  'junior_secondary',  'ecz',        TRUE),
  ('school_a_uuid', 'grade_8',  'Grade 8',  8,  'junior_secondary',  'ecz',        TRUE),
  ('school_a_uuid', 'grade_9',  'Grade 9',  9,  'junior_secondary',  'ecz',        TRUE),
  ('school_a_uuid', 'grade_10', 'Grade 10', 10, 'senior_secondary',  'ecz',        TRUE),
  ('school_a_uuid', 'grade_11', 'Grade 11', 11, 'senior_secondary',  'ecz',        TRUE),
  ('school_a_uuid', 'grade_12', 'Grade 12', 12, 'senior_secondary',  'ecz',        TRUE);

-- Classes per grade (Grade 9 only — for testing)
-- grade_id: grade_9, classes: ['9A', '9B', '9C']
```

---

## Test Students

### Five Students for School A — Grade 9A

```typescript
export const TEST_STUDENTS = [
  {
    student_id: 'STU-ZM-LSK-9001-00001',
    first_name: 'Chanda',
    last_name: 'Bwalya',
    grade_id: 'grade_9',
    class_id: 'grade_9a',
    is_boarding: false,
    examination_number: '2024/TEST001',  // Set for Grade 9 (not exam class — for display testing only)
  },
  {
    student_id: 'STU-ZM-LSK-9001-00002',
    first_name: 'Mwamba',
    last_name: 'Phiri',
    grade_id: 'grade_9',
    class_id: 'grade_9a',
    is_boarding: false,
  },
  {
    student_id: 'STU-ZM-LSK-9001-00003',
    first_name: 'Kunda',
    last_name: 'Zulu',
    grade_id: 'grade_9',
    class_id: 'grade_9a',
    is_boarding: false,
  },
  {
    student_id: 'STU-ZM-LSK-9001-00004',
    first_name: 'Grace',
    last_name: 'Mwale',
    grade_id: 'grade_9',
    class_id: 'grade_9a',
    is_boarding: false,
  },
  {
    student_id: 'STU-ZM-LSK-9001-00005',
    first_name: 'Peter',
    last_name: 'Banda',
    grade_id: 'grade_9',
    class_id: 'grade_9a',
    is_boarding: false,
  },
]
```

---

## Test Parents

```typescript
export const TEST_PARENTS = [
  {
    // Primary parent for Chanda Bwalya
    clerk_user_id: 'test_parent_001',
    full_name: 'Alice Bwalya',
    phone_e164: '+260700000001',      // Non-routable test number
    email: 'alice.bwalya@zsms-test.invalid',
    whatsapp_opted_in: true,
    marketing_opt_in: false,
  },
  {
    // Primary parent for Mwamba Phiri
    clerk_user_id: 'test_parent_002',
    full_name: 'Robert Phiri',
    phone_e164: '+260700000002',
    email: 'robert.phiri@zsms-test.invalid',
    whatsapp_opted_in: false,         // WhatsApp opted out — for fallback testing
    marketing_opt_in: false,
  },
  {
    // Parent with two children at two different schools — for multi-school testing
    clerk_user_id: 'test_parent_003',
    full_name: 'Mary Zulu',
    phone_e164: '+260700000003',
    email: 'mary.zulu@zsms-test.invalid',
    whatsapp_opted_in: true,
    marketing_opt_in: true,           // Alumni marketing opted in — for promotional content testing
  },
]
```

---

## Test Staff

```typescript
export const TEST_STAFF = [
  {
    clerk_user_id: 'test_teacher_001',
    first_name: 'John',
    last_name: 'Banda',
    email: 'j.banda@zsms-test.invalid',
    clerk_role: 'org:teacher',
    // Assigned to: Grade 9A Mathematics, Grade 8B Mathematics
  },
  {
    clerk_user_id: 'test_accountant_001',
    first_name: 'Sarah',
    last_name: 'Mwale',
    email: 's.mwale@zsms-test.invalid',
    clerk_role: 'org:accountant',
  },
  {
    clerk_user_id: 'test_principal_001',
    first_name: 'Dr. Agnes',
    last_name: 'Phiri',
    email: 'a.phiri@zsms-test.invalid',
    clerk_role: 'org:principal',
  },
  {
    clerk_user_id: 'test_owner_001',
    first_name: 'James',
    last_name: 'Zulu',
    email: 'j.zulu@zsms-test.invalid',
    clerk_role: 'org:owner',
  },
  {
    // Custom role staff — for custom role permission testing
    clerk_user_id: 'test_custom_001',
    first_name: 'Matron',
    last_name: 'Chileshe',
    email: 'm.chileshe@zsms-test.invalid',
    clerk_role: 'org:staff',   // Custom role base — no default access
    custom_role_name: 'Head of Boarding',
  },
]
```

---

## Test Fee Structures and Records

```sql
-- Fee structure for Grade 9, Term 2, 2026 — School A
INSERT INTO fee_structures (school_id, academic_year, term_number, grade_id, student_type, fee_label, amount, currency_code, is_mandatory)
VALUES
  (school_a_uuid, '2026', 2, 'grade_9', 'all',     'Tuition Fee',   2500.00, 'ZMW', TRUE),
  (school_a_uuid, '2026', 2, 'grade_9', 'all',     'Activity Fee',   300.00, 'ZMW', TRUE),
  (school_a_uuid, '2026', 2, 'grade_9', 'all',     'Exam Fee',       150.00, 'ZMW', TRUE);

-- Fee records for test students (auto-generated from structure)
-- Chanda Bwalya: K2,500 Tuition (unpaid), K300 Activity (unpaid), K150 Exam (paid)
-- Mwamba Phiri: K2,500 Tuition (partial — K1,000 paid), K300 Activity (unpaid)
-- Kunda Zulu: All fees paid
-- Grace Mwale: All fees unpaid (for reminder testing)
-- Peter Banda: Loan pending (fee_record status: loan_pending)
```

---

## Test Exam Results

```sql
-- Marks for Grade 9A, Term 2, 2026 — entered by test_teacher_001
-- Subjects: Mathematics, English Language, Biology, Chemistry, Physics

INSERT INTO exam_results (school_id, student_id, class_id, academic_year, term_number, subject_code, marks_obtained, marks_total, grade_letter, grade_points, results_published)
VALUES
  -- Chanda Bwalya (deliberately varied marks for position testing)
  (school_a, 'STU-9001-00001', 'grade_9a', '2026', 2, 'mathematics',     88, 100, 'A', 1, FALSE),
  (school_a, 'STU-9001-00001', 'grade_9a', '2026', 2, 'english_lang',    72, 100, 'B', 2, FALSE),
  (school_a, 'STU-9001-00001', 'grade_9a', '2026', 2, 'biology',         61, 100, 'C', 3, FALSE),
  (school_a, 'STU-9001-00001', 'grade_9a', '2026', 2, 'chemistry',       54, 100, 'C', 3, FALSE),
  (school_a, 'STU-9001-00001', 'grade_9a', '2026', 2, 'physics',         45, 100, 'D', 4, FALSE);
  -- Aggregate: 13 points → Position 2 of 5

  -- Kunda Zulu (highest marks — position 1)
  -- (marks inserted separately — aggregate 8 points)

  -- Mwamba Phiri, Grace Mwale, Peter Banda — lower marks for position ordering
```

---

## Test Timetable

```sql
-- School A timetable — Term 2, 2026
-- Monday to Friday, Grade 9A class

-- Period 1 (08:00-08:45): Mathematics — test_teacher_001
-- Period 2 (08:45-09:30): English Language — test_teacher_002
-- Morning Break (09:30-09:45): No lesson
-- Period 3 (09:45-10:30): Biology — test_teacher_003
-- ...
```

---

## Test WhatsApp Configuration

### School A — AfriTech Shared Number

```typescript
// No additional configuration needed
// whatsapp_owns_number = FALSE (default)
// Uses META_WHATSAPP_PHONE_NUMBER_ID from environment variables
```

### School B — School-Specific Number (Mocked)

```typescript
// For testing school-specific WhatsApp number code path
TEST_SCHOOL_B_WHATSAPP = {
  whatsapp_owns_number: true,
  whatsapp_phone_number_id: 'test_phone_number_id_001',
  whatsapp_access_token_enc: encrypt('test_access_token'),
  whatsapp_business_acct_id: 'test_waba_id_001',
}
```

---

## Test Loan Data

### Test Lender

```sql
INSERT INTO public.lenders (
  lender_name, display_name, integration_type, intake_email,
  max_loan_amount, min_loan_amount, interest_rate_display,
  turnaround_label, commission_rate, min_behaviour_score,
  collection_account, is_active
) VALUES (
  'test_lender_zmw',
  'Test Finance Zambia',
  'email',
  'loans@zsms-test.invalid',
  10000.00,
  500.00,
  '18% per annum (test)',
  'Decision within 24 hours (test)',
  0.0250,
  450,
  '{"mobile_money": "+260700009999", "network": "Airtel"}',
  TRUE
);
```

### Test Loan Application (Pre-consented Parent)

```typescript
// Pre-seeded consent log for test_parent_001 → test_lender
TEST_LOAN_CONSENT = {
  parent_user_id: 'test_parent_001',
  lender_id: 'test_lender_uuid',
  consent_version: 'v2.1',
  consent_text_hash: sha256('test consent text v2.1'),
  consented_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 minutes ago — within 30-day window
}
```

---

## Test Behaviour Score Inputs

Standard test fixtures that produce predictable scores:

```typescript
// Excellent payer — score should be ~800
export const EXCELLENT_PAYER_INPUTS = {
  totalFeeRecords: 18,
  paidOnTime: 16,
  paidWithin7Days: 2,
  paidWithin14Days: 0,
  paidAfter30Days: 0,
  neverPaid: 0,
  monthsOnZsms: 24,
  portalLoginsLast90Days: 15,
  whatsappOptedIn: true,
  hasPreviouslyRepaidZsmsLoan: false,
  averageRemindersBeforePayment: 0,
  activeLoans: 0,
  currentOutstandingTotal: 0,
}
// Expected: score in range 750-850 (Excellent)

// Poor payer — score should be ~380
export const POOR_PAYER_INPUTS = {
  totalFeeRecords: 12,
  paidOnTime: 2,
  paidWithin7Days: 1,
  paidWithin14Days: 2,
  paidAfter30Days: 4,
  neverPaid: 3,
  monthsOnZsms: 8,
  portalLoginsLast90Days: 1,
  whatsappOptedIn: false,
  hasPreviouslyRepaidZsmsLoan: false,
  averageRemindersBeforePayment: 3,
  activeLoans: 1,
  currentOutstandingTotal: 5000,
}
// Expected: score in range 300-449 (Very Poor)

// Neutral — no history
export const NO_HISTORY_INPUTS = {
  totalFeeRecords: 0,
  monthsOnZsms: 1,
}
// Expected: score = 500 (Neutral)
```

---

## Column Mapping Saved Profile (Bulk Import Testing)

A saved column mapping for the bulk import test so Claude Code sessions can import test students without remapping every time.

```json
{
  "mapping_name": "Test Import Format",
  "school_id": "ZM-LSK-9001",
  "column_map": {
    "Pupil Name":      "full_name_split",
    "Form/Grade":      "grade_id",
    "Stream":          "class_id",
    "Parent Contact":  "parent_phone",
    "Parent Email":    "parent_email"
  }
}
```

The test CSV file (`supabase/seed/test-import.csv`) uses these headers and contains 10 fictional students.

---

## Applying Seed Data

```bash
# Reset and reseed the development database
supabase db reset

# This runs:
# 1. All migrations (fresh schema)
# 2. supabase/seed/01_reference_data.sql  (reference_subjects_zm)
# 3. supabase/seed/02_test_schools.sql    (TEST_SCHOOL_A, B, C)
# 4. supabase/seed/03_test_users.sql      (parents, staff, owner)
# 5. supabase/seed/04_test_students.sql   (5 students per school)
# 6. supabase/seed/05_test_fees.sql       (fee structures + records)
# 7. supabase/seed/06_test_results.sql    (exam results for Grade 9A)
# 8. supabase/seed/07_test_timetable.sql  (timetable for School A)
# 9. supabase/seed/08_test_lender.sql     (test lender + consent)
```

---

## Business Rules

1. All test phone numbers use the `+260700XXXXXX` range. Never use real Zambian phone numbers in test data.
2. All test emails use the `@zsms-test.invalid` domain. This domain does not exist — emails cannot be accidentally delivered.
3. Test school IDs use sequence numbers above 9000 to avoid any confusion with real school IDs.
4. Seed scripts are idempotent — running `supabase db reset` multiple times always produces the same clean state.
5. Test data includes both WhatsApp configurations (shared number and school-specific) to ensure both code paths are tested.
6. Test behaviour score fixtures produce deterministic results within the expected score bands — tests can assert the band (Excellent/Good/etc.) without asserting an exact score number.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 16 testing and launch documentation |
| 2026-04-26 | Added both WhatsApp configurations | School-specific number must be tested |
| 2026-04-26 | Added behaviour score test fixtures | Loan module algorithm needs predictable test inputs |
| 2026-04-26 | Added column mapping saved profile | Reduces friction for bulk import testing |
