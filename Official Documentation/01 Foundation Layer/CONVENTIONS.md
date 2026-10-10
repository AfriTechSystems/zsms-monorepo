# CONVENTIONS.md — Naming and Code Conventions

## Related Documents

- `docs/ARCHITECTURE.md` — system architecture and project structure
- `docs/DATABASE.md` — database naming conventions applied in practice
- `docs/GLOSSARY.md` — definitions of all terms used in naming decisions
- `docs/ENV.md` — environment variable naming conventions
- `docs/infra/SUPABASE.md` — migration file naming

---

## Purpose

This document defines every naming convention, formatting rule, and structural standard used across the ZSMS codebase and documentation. Every Claude Code session must read this document before writing any code, SQL, or file names. Consistency in naming is not a preference — it is what allows Claude Code to predict file locations, understand relationships between entities, and maintain the codebase coherently across dozens of sessions.

If a convention is not defined here, do not invent one. Ask first, agree on the convention, add it here, then apply it.

---

## Overview

ZSMS uses different conventions for different contexts. The table below is the complete reference. Each convention is explained in detail in the sections that follow.

| Context | Convention | Example |
|---|---|---|
| Files and folders | kebab-case | `student-profile.tsx`, `fee-management.ts` |
| TypeScript interfaces and types | PascalCase | `StudentProfile`, `FeeRecord` |
| TypeScript variables and functions | camelCase | `getStudentById()`, `feeAmount` |
| TypeScript constants | SCREAMING_SNAKE_CASE | `MAX_STUDENTS_PER_CLASS` |
| React components | PascalCase | `StudentCard`, `FeeTable` |
| React hooks | camelCase with `use` prefix | `useSchoolContext()`, `useFeeRecord()` |
| Database tables | snake_case, plural | `students`, `fee_records` |
| Database columns | snake_case | `school_id`, `created_at` |
| Database functions | snake_case | `get_school_id()`, `trigger_set_updated_at()` |
| Database indexes | `idx_[table]_[column(s)]` | `idx_students_school_id` |
| Database triggers | `[action]_[table]_[event]` | `set_updated_at_students` |
| RLS policies | `[role]_[action]_[table]` | `teacher_read_own_class_attendance` |
| Migration files | `NNNN_description.sql` | `0003_create_students_table.sql` |
| Edge Functions | kebab-case | `send-whatsapp`, `generate-report-card` |
| Environment variables (server) | UPPER_SNAKE_CASE | `SUPABASE_SERVICE_ROLE_KEY` |
| Environment variables (client) | `NEXT_PUBLIC_` prefix | `NEXT_PUBLIC_SUPABASE_URL` |
| Git branches | type/description | `feature/student-bulk-import` |
| Commit messages | `type: description` | `feat: add bulk import validation` |
| School IDs | `ZM-LSK-0001` | Country-City-Sequence |
| Student IDs | `STU-ZM-LSK-0001-00042` | STU-SchoolID-Sequence |
| Receipt numbers | `REC-ZM-LSK-0001-000001` | REC-SchoolID-Sequence |

---

## File and Folder Naming

### Rule: All files and folders use kebab-case

No spaces. No underscores. No camelCase. Lowercase only.

```
✅ student-profile.tsx
✅ fee-management.ts
✅ bulk-import-validator.ts
✅ send-whatsapp/index.ts
✅ docs/modules/fees/PAYMENTS.md

❌ studentProfile.tsx
❌ FeeManagement.ts
❌ bulk_import_validator.ts
```

### Exception: Documentation files use UPPER_SNAKE_CASE with .md extension

Documentation markdown files in `docs/` use uppercase names to distinguish them from code files.

```
✅ ARCHITECTURE.md
✅ DATABASE.md
✅ BULK_IMPORT.md
✅ AUTH.md

❌ architecture.md
❌ database.md
```

### Exception: React component files use PascalCase matching the component name

```
✅ StudentCard.tsx
✅ FeeTable.tsx
✅ LoanApplicationForm.tsx
```

### Folder structure is flat within each domain

Do not create deeply nested folder hierarchies. Each module has one folder. Related files go in that folder, not in sub-subfolders.

```
✅ apps/web/components/students/StudentCard.tsx
✅ apps/web/components/students/StudentTable.tsx
✅ apps/web/components/students/BulkImportModal.tsx

❌ apps/web/components/students/cards/StudentCard.tsx
❌ apps/web/components/students/tables/StudentTable.tsx
```

---

## TypeScript Naming

### Interfaces and Types: PascalCase

All TypeScript interfaces, types, and enums use PascalCase. Every entity in the database has a corresponding TypeScript type in `packages/types/`.

```typescript
// ✅ Correct
interface StudentProfile { ... }
type FeeStatus = 'unpaid' | 'partial' | 'paid' | 'waived'
interface LoanApplication { ... }
enum PaymentMethod { ... }

// ❌ Incorrect
interface studentProfile { ... }
type fee_status = ...
interface loan_application { ... }
```

### Variables and Functions: camelCase

```typescript
// ✅ Correct
const studentId = 'STU-ZM-LSK-0001-00042'
const feeAmount = 2500.00
function getStudentById(id: string): Promise<StudentProfile> { ... }
function formatCurrency(amount: number, code: string): string { ... }

// ❌ Incorrect
const StudentId = ...
const fee_amount = ...
function GetStudentById() { ... }
function format_currency() { ... }
```

### Constants: SCREAMING_SNAKE_CASE

Used only for values that are truly constant — never change at runtime and are not configuration values.

```typescript
// ✅ Correct
const MAX_STUDENTS_PER_IMPORT_BATCH = 50
const RECEIPT_NUMBER_PREFIX = 'REC'
const DEFAULT_GRACE_PERIOD_DAYS = 30

// ❌ Incorrect
const maxStudentsPerImportBatch = 50
const receiptNumberPrefix = 'REC'
```

### React Components: PascalCase

```typescript
// ✅ Correct
export function StudentCard({ student }: { student: StudentProfile }) { ... }
export function FeePaymentForm() { ... }
export default function AttendancePage() { ... }

// ❌ Incorrect
export function studentCard() { ... }
export function fee_payment_form() { ... }
```

### React Hooks: camelCase with `use` prefix

```typescript
// ✅ Correct
function useSchoolContext() { ... }
function useFeeRecords(termId: string) { ... }
function usePermissionGrant(module: string) { ... }

// ❌ Incorrect
function SchoolContext() { ... }
function getFeeRecords() { ... }
```

### Type import source

All database entity types are imported from `packages/types/database.ts` (auto-generated by Supabase). Do not define database types manually — regenerate this file after every schema migration using `supabase gen types typescript`.

```typescript
// ✅ Correct
import type { Database } from '@zsms/types/database'
type Student = Database['public']['Tables']['students']['Row']

// ❌ Incorrect — manually defining a type that matches the database
interface Student {
  id: string
  school_id: string
  // ... manually typed fields
}
```

---

## Database Naming

### Tables: snake_case, plural

```sql
-- ✅ Correct
public.students
public.fee_records
public.student_parent_links
public.teacher_assignments

-- ❌ Incorrect
public.Student
public.FeeRecord
public.studentParentLinks
public.StaffAssignment
```

### Columns: snake_case

```sql
-- ✅ Correct
school_id
first_name
amount_paid
is_boarding
created_at
deleted_at

-- ❌ Incorrect
schoolId
FirstName
amountPaid
isBoarding
createdAt
```

### Required columns on every table

Every table must have these columns in this order at the end of the CREATE TABLE statement:

```sql
-- For tables that cannot be updated:
created_at TIMESTAMPTZ DEFAULT NOW()

-- For tables that can be updated:
created_at TIMESTAMPTZ DEFAULT NOW(),
updated_at TIMESTAMPTZ DEFAULT NOW()

-- For tables with soft delete:
is_deleted  BOOLEAN DEFAULT FALSE,
deleted_at  TIMESTAMPTZ,
deleted_by  TEXT,
created_at  TIMESTAMPTZ DEFAULT NOW(),
updated_at  TIMESTAMPTZ DEFAULT NOW()
```

### Indexes: `idx_[table]_[column(s)]`

```sql
-- ✅ Correct
CREATE INDEX idx_students_school_id ON public.students(school_id);
CREATE INDEX idx_fee_records_status ON public.fee_records(school_id, status);
CREATE INDEX idx_students_fulltext ON public.students USING GIN(...);

-- ❌ Incorrect
CREATE INDEX students_school_id_index ON ...
CREATE INDEX school_id_idx ON ...
```

Partial indexes include the filter condition description:

```sql
-- ✅ Correct
CREATE INDEX idx_fee_records_due_date_unpaid ON public.fee_records(due_date)
  WHERE status IN ('unpaid', 'partial');
```

### Triggers: `[action]_[description]_on_[table]`

```sql
-- ✅ Correct
CREATE TRIGGER set_updated_at_on_students ...
CREATE TRIGGER queue_absence_notification_on_attendance ...
CREATE TRIGGER set_grace_period_on_student_parent_links ...

-- ❌ Incorrect
CREATE TRIGGER students_updated_at ...
CREATE TRIGGER attendance_trigger ...
```

### RLS Policies: `[role_or_scope]_[action]_[table]`

```sql
-- ✅ Correct
CREATE POLICY "afritech_admin_all_students" ON public.students ...
CREATE POLICY "teacher_read_own_class_attendance" ON public.attendance_records ...
CREATE POLICY "parent_read_own_children" ON public.students ...
CREATE POLICY "school_management_write_students" ON public.students ...

-- ❌ Incorrect
CREATE POLICY "students_policy" ON public.students ...
CREATE POLICY "read_attendance" ON public.attendance_records ...
```

### Foreign Keys: always reference the full table and column

```sql
-- ✅ Correct
school_id UUID NOT NULL REFERENCES public.schools(id)
student_id UUID NOT NULL REFERENCES public.students(id)

-- ❌ Incorrect (omitting schema or column)
school_id UUID REFERENCES schools
student_id UUID REFERENCES students(id)  -- missing schema prefix
```

---

## Migration File Naming

### Format: `NNNN_description_of_change.sql`

- `NNNN` — four-digit zero-padded sequence number
- `description` — lowercase words separated by underscores describing what the migration does
- File extension: `.sql`

```
✅ 0001_rls_helper_functions.sql
✅ 0003_create_students_table.sql
✅ 0014_add_indexes.sql
✅ 0021_add_loan_repayment_schedule_column.sql

❌ create-students.sql
❌ 3_students.sql
❌ addIndexes.sql
```

### Migration file structure

Every migration file follows this structure:

```sql
-- Migration: NNNN_description.sql
-- Created: YYYY-MM-DD
-- Description: One sentence describing what this migration does and why.
-- Related documents: docs/DATABASE.md, docs/modules/[module]/[MODULE].md

-- === MIGRATION START ===

-- SQL statements here

-- === MIGRATION END ===
```

---

## Edge Function Naming

### Directory name: kebab-case matching the function's primary action

```
✅ supabase/functions/send-whatsapp/
✅ supabase/functions/generate-report-card/
✅ supabase/functions/process-bulk-import/
✅ supabase/functions/webhook-payment/
✅ supabase/functions/loan-submit/

❌ supabase/functions/sendWhatsapp/
❌ supabase/functions/GenerateReportCard/
❌ supabase/functions/webhook_payment/
```

Every Edge Function directory contains exactly one file: `index.ts`.

---

## Environment Variable Naming

### Server-side variables: UPPER_SNAKE_CASE

Never accessible in client-side code or mobile app bundles.

```
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_URL
CLERK_SECRET_KEY
QSTASH_TOKEN
META_WHATSAPP_ACCESS_TOKEN
TWILIO_AUTH_TOKEN
CLOUDFLARE_R2_SECRET_ACCESS_KEY
ENCRYPTION_KEY
```

### Client-side variables: `NEXT_PUBLIC_` prefix

Accessible in browser code. Must never contain secrets.

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
NEXT_PUBLIC_COUNTRY_CODE
NEXT_PUBLIC_APP_URL
```

### The `.env.example` file

Every environment variable used anywhere in the codebase must be listed in `.env.example` with a placeholder value and a comment explaining what it is and where to find it. Real values are never committed.

```bash
# .env.example

# Supabase — find in Supabase dashboard > Settings > API
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key  # NEVER expose client-side

# Clerk — find in Clerk dashboard > API Keys
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...

# Country config
NEXT_PUBLIC_COUNTRY_CODE=ZM
```

---

## Git Branch Naming

### Format: `type/short-description`

```
✅ feature/student-bulk-import
✅ feature/fee-reminder-scheduler
✅ fix/receipt-number-duplicate
✅ fix/rls-parent-access-grace-period
✅ docs/update-database-md
✅ chore/upgrade-supabase-client
✅ db/add-payment-gateway-table

❌ mwando/students
❌ new-feature
❌ fix2
❌ test-branch-june
```

### Branch types

| Type | When to use |
|---|---|
| `feature/` | New module, feature, or capability |
| `fix/` | Bug fix in existing code |
| `docs/` | Documentation-only changes |
| `chore/` | Dependency updates, tooling, configuration |
| `db/` | Database schema changes (migration files) |
| `rls/` | RLS policy changes only |

### Reserved branches

- `main` — production. No direct push. Merged from `integration` only after testing.
- `integration` — UAT environment. Feature branches merge here for testing.

---

## Commit Message Format

### Format: `type: short description in present tense`

```
✅ feat: add bulk student import with CSV validation
✅ fix: correct RLS policy for parent grace period access
✅ db: add payment_gateways table with multi-gateway support
✅ rls: add teacher write policy for attendance records
✅ docs: update DATABASE.md with payment_gateways table
✅ chore: upgrade supabase-js to v2.40.0

❌ Added bulk import
❌ fixed bug
❌ update docs
❌ WIP
```

### Commit types

| Type | When to use |
|---|---|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `db` | Database migration or schema change |
| `rls` | RLS policy change |
| `docs` | Documentation file changes |
| `chore` | Tooling, dependencies, configuration |
| `test` | Adding or updating tests |
| `refactor` | Code restructuring with no behaviour change |
| `style` | Formatting, whitespace (no logic change) |

### Multi-line commits for significant changes

When a commit touches multiple files or has an important reason, use a body:

```
feat: add automated fee reminder scheduler

Adds queue cron job that runs daily at 6am and queues WhatsApp
reminder messages for students with outstanding fee balances at
7, 14, and 30 days past due date.

Affected tables: fee_records (reads), message_log (writes)
Edge Functions: send-whatsapp (called by queue worker)
Related docs: docs/modules/fees/REMINDERS.md
```

---

## Identifier Formats

### School ID

```
Format:  ZM-LSK-0001
Pattern: {COUNTRY_CODE}-{CITY_CODE}-{4_DIGIT_SEQUENCE}

Examples:
  ZM-LSK-0001  — first school in Lusaka, Zambia
  ZM-CBE-0003  — third school on the Copperbelt
  BW-GAB-0001  — first school in Gaborone, Botswana
```

Generated by the school onboarding Edge Function. Never manually assigned. Never reused if a school is terminated.

### Student ID

```
Format:  STU-ZM-LSK-0001-00042
Pattern: STU-{SCHOOL_ID}-{5_DIGIT_SEQUENCE}

Examples:
  STU-ZM-LSK-0001-00001  — first student at ZM-LSK-0001
  STU-ZM-LSK-0001-00042  — forty-second student
```

The student ID is permanent. It does not change if the student transfers schools. The new school gets a record with their own student ID, but historical records at the old school retain the original student ID.

### Receipt Number

```
Format:  REC-ZM-LSK-0001-000001
Pattern: REC-{SCHOOL_ID}-{6_DIGIT_SEQUENCE}

Examples:
  REC-ZM-LSK-0001-000001  — first receipt at this school
  REC-ZM-LSK-0001-001523  — fifteen hundred and twenty-third receipt
```

Generated atomically using a PostgreSQL sequence per school. Guaranteed unique. No gaps from failed transactions — the sequence increments even if the payment fails after the number is assigned.

---

## API and Edge Function Conventions

### API route file location

```
apps/web/app/api/[resource]/route.ts         — collection routes (GET list, POST create)
apps/web/app/api/[resource]/[id]/route.ts    — individual resource routes
apps/web/app/api/[resource]/[action]/route.ts — action routes

Examples:
apps/web/app/api/students/route.ts
apps/web/app/api/students/[id]/route.ts
apps/web/app/api/reports/generate/route.ts
apps/web/app/api/fees/payment/route.ts
```

### API response shape — success

```typescript
// All successful responses follow this shape
{
  data: T,           // The requested or created resource
  meta?: {           // Optional pagination metadata
    total: number,
    page: number,
    perPage: number
  }
}
```

### API response shape — error

```typescript
// All error responses follow this shape — no exceptions
{
  error: string,     // Human-readable message
  code: string,      // Machine-readable: 'VALIDATION_ERROR' | 'UNAUTHORIZED' |
                     // 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'SERVER_ERROR'
  details?: Record<string, string>  // Field-level errors for form validation
}
```

### HTTP status codes

| Code | When to use |
|---|---|
| 200 | Successful GET, PUT, PATCH |
| 201 | Successful POST (resource created) |
| 400 | Validation error — invalid input, missing required field |
| 401 | Not authenticated — no token or expired token |
| 403 | Authenticated but not permitted — wrong role or school |
| 404 | Resource not found (also used when existence should not be revealed) |
| 409 | Conflict — duplicate entry, already exists |
| 422 | Business logic failure — fee already paid, results already published |
| 500 | Unexpected server error — never expose raw error details |

### Supabase client usage

```typescript
// ✅ Correct — anon client with user JWT for all user-facing operations
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ✅ Correct — service role ONLY in Edge Functions for audit writes and webhook processing
const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// ❌ Never — service role key in any client-side or API route code
const supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!)
```

---

## Documentation File Conventions

### Every documentation file follows this structure

```markdown
# FILENAME.md — Title

## Related Documents
[List of related docs with description]

---

## Purpose
[One paragraph]

---

## Overview
[2-3 paragraphs]

## [Section headings as needed]

## Business Rules
[Numbered list — cannot be violated]

## Edge Cases and Error Handling

## Integration Points

## Security Considerations

## Known Limitations and Future Work

## Change Log
| Date | Change | Reason |
```

### Updating documentation after a code change

Every Claude Code session that builds or modifies a feature must end with a documentation update step. The prompt to use:

```
We just completed [description of what was built/changed].
Update docs/modules/[module]/[MODULE].md to reflect:
- Any new or changed API endpoints
- Any new or changed business rules
- Any new database tables or columns used
- Any new integration points
- Update the Change Log section with today's date

Also check the Related Documents section of this file and
list any other docs that reference this module and may need updating.
```

---

## Shared Package Conventions

### `packages/types/`

Contains TypeScript type definitions. The `database.ts` file is auto-generated — never manually edited. Other files in this package are hand-written type definitions for non-database entities (API request/response shapes, country config types, etc.).

### `packages/validators/`

Contains Zod validation schemas. One file per entity. Schemas are shared between the API layer (server-side validation) and forms (client-side validation).

```typescript
// packages/validators/student.ts
import { z } from 'zod'

export const createStudentSchema = z.object({
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  date_of_birth: z.string().date().optional(),
  grade_id: z.string().min(1),
  class_id: z.string().min(1),
  is_boarding: z.boolean().default(false),
})

export type CreateStudentInput = z.infer<typeof createStudentSchema>
```

### `packages/utils/`

Contains pure utility functions with no side effects. Each file exports functions related to a single concern.

```
packages/utils/formatCurrency.ts    — currency formatting using country config
packages/utils/formatPhone.ts       — phone number normalisation to E.164
packages/utils/schoolId.ts          — school ID and student ID generation helpers
packages/utils/grading.ts           — grade letter calculation from marks and country config
packages/utils/dates.ts             — date formatting and academic year helpers
```

### `packages/config/countries/`

One file per country. The active country is determined by `NEXT_PUBLIC_COUNTRY_CODE`. Do not add conditional logic to application code based on country — use the config object instead.

---

## Things That Are Never Done

These are absolute prohibitions. No exception, no matter the circumstance:

1. The Supabase service role key is never used outside a **trusted server-side context** — an Edge Function, or a Railway background worker. It is never present in `apps/web`, `apps/mobile`, any browser or device bundle, or any code path a request from an end user can reach. *(Amended 2026-08-15 — ADR-042. The original wording named only Edge Functions, which made Phase 3's workers unimplementable: a cron firing at 08:00 has no end-user JWT to act under. The rule's intent was always to keep the key out of client-reachable code, and a Railway worker is no more client-reachable than an Edge Function. See ADR-042 for the conditions a worker must satisfy.)*
2. Real credentials, API keys, or secrets are never committed to version control.
3. Database types are never manually defined — always generated from the schema.
4. New tables are never created without a corresponding RLS policy.
5. Financial amounts are never stored as FLOAT or REAL.
6. Timestamps are never stored as TIMESTAMP without time zone.
7. New features are never added to an existing migration file — always a new migration.
8. Hard deletes are never performed on students, fee records, payments, or exam results.
9. The `private` schema is never referenced in client-side code or Lovable-generated pages.
10. A migration is never applied to production without first being applied to integration and verified.

---

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-04-26 | Initial complete draft | Pre-development documentation |
