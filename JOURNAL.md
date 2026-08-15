# JOURNAL.md — ZSMS Working Journal

Running log of substantive work on the ZSMS repository. Newest entry first.

---

## 2026-08-15 - Phase 3: background jobs and communications

Branch `feature/phase-3-jobs-communications`, cut before any work this time. **Migrations `0082`-`0089` applied. Communications suite 45/45, gate harness 28/28.**

### The same default-privilege bug, a third time - and finally fixed as a class

`0019` found `authenticated` holding DELETE on every Phase 1 table. `0076` found it holding UPDATE on `payments`. This phase found it holding **INSERT and UPDATE on `message_log` and `school_message_quotas`** - which would have allowed a fabricated delivery record (the artefact a school would use to claim a parent was warned) and a school resetting `messages_used` to zero to send without limit.

Three times I granted what a table needed and assumed that was the whole story. **`GRANT` is not a whitelist**: Supabase's defaults already give `authenticated` and `anon` `ALL` on anything new in `public`.

`0089` stops the class rather than the instance - `ALTER DEFAULT PRIVILEGES` so new objects arrive with nothing granted, plus an inline verification that fails at apply time. Asserted: **a table created after `0089` inherits no end-user privileges at all.**

**And its verification immediately caught something I did not know about.** The two arrears *views* carried INSERT and UPDATE. `fee_record_status` is a simple view over `fee_records`, which makes it **auto-updatable** - a write through the view reaches the table. `security_invoker` meant RLS still applied, so nothing was exploitable, but it was an entire write path nobody designed. My first sweep missed it because it joined `pg_tables`, which excludes views. A narrow query created the gap; a broad assertion caught it.

### The abstraction was only half-built

The queue abstraction covered *producing* jobs. BULLMQ.md's own worker example imports `bullmq` directly, so **consuming was never behind it** - switching providers would have been configuration for producers and a refactor for consumers.

`createWorker()` now lives in `@zsms/queue`, and `apps/workers` has no `bullmq` or `ioredis` dependency at all. The abstraction also states the asymmetry plainly rather than hiding it: BullMQ workers *pull*; QStash *pushes* over HTTP and has no worker process, so `createWorker()` throws under QStash with an explanation. That is the same trade ADR-035 already records, seen from the consuming side.

Verified by grep: no `bullmq`/`ioredis` import outside `packages/queue`, no provider SDK or endpoint outside `packages/notifications/src/providers`.

### What the gate actually proves - and what it does not

28/28 on the harness, running the **real** handler, the **real** pdf-lib renderer, and the **real** fallback chain across five scenarios: happy path, WhatsApp failure falling through to email, quota exhaustion, total delivery failure, and a student with no linked guardian.

**Not proven, and it matters:**
- **BullMQ-to-Redis transport.** No Redis on this machine. The handler is invoked directly; `worker.ts` is a thin adapter over exactly that call, but "thin" is an assertion until Redis exists.
- **Real provider delivery.** No Meta, Resend, or Twilio credentials, so channels run through the mock provider. This is also correct for `zsms-dev`, whose fixtures carry real-shaped phone numbers.
- **The handler's database adapter.** Deliberately unimplemented - see below.

### Open question I refused to answer alone

`CONVENTIONS.md` prohibition 1: *"the service role key is never used outside an Edge Function."* A worker is not an Edge Function, yet it must read a payment, its student, and the guardian - and holds no end-user JWT, because nobody has a session when a cron fires at 08:00.

`createWorkerDeps()` throws, with the three options written out (Edge Functions for all DB work / amend the prohibition to cover Railway workers / a dedicated Postgres role). The rule exists to keep the key out of client-reachable code, so amending it is probably the intent - but a documented prohibition should be amended deliberately, not reinterpreted by whoever happens to write the worker.

### Everything dynamic

Quota ceilings come from `afritech.subscription_tiers`, which required creating the first table in a schema that had been empty since `0002` - the pricing tables were specified in the void `0061`-`0065` block. Message wording lives in `notification_templates` with school override and platform fallback; 13 platform defaults seeded. No template string exists in application code, because a wording change is the most common request a school makes and it must not be a deployment.

### Not built

API routes for announcements and message history, the fee-reminder and scheduled-announcement cron handlers, and report-card bulk generation. The renderers exist for all three document types; what is missing is the routes and the cron wiring.

---

## 2026-08-15 — Pre-Phase-3 documentation reconciliation

Documentation only. No schema or code changes.

### CLAUDE.md brought current

It still opened *"Phase 0 scaffold complete. Phase 1 not started."* — four phases of work out of date, and it is the file every session reads first. Now states Phases 0–2 plus arrears, 12 API routes, 29 applied migrations, three pgTAP suites (155 assertions), 23 tables, 97 policies, and — importantly — **that there is no user interface at all**, which the old text left ambiguous.

Its *Known documentation inconsistencies* table was entirely stale: all five conflicts (session lengths, schema counts, QStash vs BullMQ, missing WAF, missing ADRs) had been resolved sessions ago. Replaced with the four items actually open, and with the pattern worth knowing: **repeatedly a document has described something the schema could not do**, and each case was found by implementing against the doc rather than reading it.

### Stale table references — larger than flagged

The readiness report listed four stale `class_enrolments` references. Fixing them surfaced **28 further `staff_assignments` references across 10 documents** — a table dropped in `0069`. `ASSIGNMENTS.md` is structurally built around it, and `POWERSYNC.md` carried three sync rules joining two tables that no longer exist; anyone implementing PowerSync from that document would have written SQL that cannot run.

Corrected in `POWERSYNC.md`, `ASSIGNMENTS.md`, `OFFLINE_SYNC.md`, `RESULTS.md`, `REPORT_CARDS.md`, `TIMETABLE.md`, `INVITATIONS.md`, `CONVENTIONS.md`, `DATABASE.md`, and `INDEXES.md`. The DDL blocks in `DATABASE.md` and `INDEXES.md` are retained under a **REMOVED** banner so older references resolve to an explanation instead of a dead end.

**The lesson: dropping a table is not one migration.** The schema change took one file; the documentation it invalidated took ten.

### Two gaps recorded as ADRs

- **ADR-040 — multi-country config hardening (deferred).** Catalogues the hardcoded CHECK constraints and the `reference_subjects_zm` naming. Deferred on purpose: designing a configuration vocabulary against one known market usually produces the wrong abstraction, and the `custom` escape hatch means a new market is degraded rather than blocked.
- **ADR-041 — grading-scale versioning (open data-integrity gap).** `exam_results` stores a grade letter without the scale that produced it. A mid-year revision makes every historical grade unexplainable, and **the column cannot be backfilled for rows already written** — which is the argument for fixing it before a school accumulates a year of results. `score_config` already solves exactly this for loan scoring.

Both are listed in `BUILD_SEQUENCE.md` under *Tracked pre-launch decisions*, with ADR-041 carrying a deadline of the Phase 6 pilot.

### Process note

The previous commit landed **directly on `integration`** rather than through a feature branch — the prior merge left me on that branch and I did not check before committing. Agreed with the user to leave it rather than rewrite a pushed shared branch. It is exactly what branch protection would catch, and cannot, on the free plan.

---

## 2026-08-15 — AI-assisted capture design; pre-Phase-3 readiness

Branch `feature/fee-arrears-model` (continued). **Design and documentation only — no capture code built.**

### AI-assisted capture recorded as a planned Phase 4/5 module

`18 AI Module/AI_CAPTURE.md` + **ADR-039**, registered in `BUILD_SEQUENCE.md`, `AI_OVERVIEW.md` (as System 5), and `DYNAMIC_CONFIG.md`.

The design point that matters most: **context-anchored matching is why this is feasible at all.** Handwriting against an open vocabulary is unreliable; handwriting against a known roster of ~30 names is a constrained match. Extraction always runs inside a class the teacher already occupies, matched only against that class's roster via `teacher_reaches_class()`. **The roster is never widened to the whole school to find a match** — that is exactly how a mark lands on a same-named child in another grade, and it is also a privacy control, since the roster leaves the system inside the prompt.

Everything else follows from assist-not-autopilot: no confidence threshold permits a direct write; unmatched names are surfaced, never guessed; the approving teacher is the author.

**Compatibility with the Phase 2 schema was assessed, not assumed.** No change is required now. The domain tables never receive drafts, and their existing unique keys already make repeated approval idempotent. Two changes land with the module: an added `sync_source` value, and an optional `source_capture_id` for provenance that cannot be backfilled.

Credit pricing is fully dynamic — trial allowance, per-capture rates by type, pack prices, individual-purchase toggle, and the match confidence floor. Balance derives from an append-only ledger rather than a mutable column, for the same reason as ADR-038's arrears.

### A test gap I had reported as covered

In the arrears gate report I listed *"`revise_fee_records()` refuses to drop below verified payments"* under what was implemented, in a way that implied test coverage. **It was implemented but untested** — only the missing-reason branch had an assertion. Tested now and passing, along with atomicity of the refusal and the transferred-student flag. Arrears suite is 38 assertions.

The lesson is narrow and worth keeping: a guard written in a migration and described in a report is not a guard that has been exercised.

### Config-driven audit findings (reported, not fixed)

Grading scales and class structures are genuinely config-driven — `school_grading_scales.grade_bands` is JSONB, `exam_results.grade_letter`/`grade_points` are free text and integer, class identifiers are free-form. But several **CHECK constraints encode Zambia/Cambridge assumptions in the schema**, which contradicts ADR-031's dynamic-config principle. Full list in the readiness report; the significant ones are `curriculum_type`, `grading_system`, and `examination_type`, all of which would need a migration to admit another country's system.

Separately: `exam_results` records `grade_letter` but **not which grading scale produced it**, so a scale revised mid-year makes historical grades unexplainable — the same versioning problem `score_config` already solves for loans.

---

## 2026-08-15 — Fee arrears model (pre-Phase 3)

Branch `feature/fee-arrears-model`. **Migrations `0077`–`0081` applied. Arrears suite 33/33.**

### What the investigation found

Asked whether unpaid balances carry forward, the honest answer from the schema was: **the rows persisted, but there was no arrears model.** Prior-term records were never deleted, so debt did not reset — but there was no linkage between terms, no cumulative balance, no overdue signal, and no endpoint answering *"what does this student owe?"*. Verified against the catalog: **0 balance views, 0 arrears columns, no `balance` column on `students`.**

Worse, three documents already promised what the schema could not produce — `GLOSSARY.md` and `PDF_GENERATION.md` describe a fee statement *"with a running balance"*, and `CHATBOT.md` has a `FEES — View outstanding balance` command. All three now reference the implementation.

A second gap surfaced in the same investigation: revising an **already-generated** term silently did nothing. `generate_fee_records()`'s `ON CONFLICT DO NOTHING` protects against double-billing, but it also blocked correcting a mis-keyed fee — returning `created: 0` with no error and no alternative path.

### The model (ADR-038)

**Derived, not materialised.** `fee_records` stays the single source of truth. Writing a *"Balance brought forward"* row into each new term reads like a bursar's ledger but double-counts while the original record exists. The brought-forward line is emitted by `fee_statement()` at render time instead — **one truth in the data, ledger-style on the page.**

**`security_invoker = true` is load-bearing.** A view runs with its *owner's* privileges by default, which would have bypassed RLS on `fee_records` and shown every parent every family's balance. The suite attacks that specific failure from parent, cross-family, and cross-tenant angles.

**Overdue is a separate axis from payment progress.** `status` means how much has been paid; `is_overdue` / `days_overdue` / `arrears_amount` derive from `due_date`. A record can be `partial` and overdue, or `partial` and not yet due — collapsing them into one enum would destroy that and break the balance trigger.

**Carry-forward spans years and survives status changes.** No year filter, and no filter on `students.status` — a graduated student owing 800 still shows it, because schools withhold certificates until cleared. Asserted directly.

**The model never gates.** Nothing refuses a result, certificate, or re-registration because a balance is outstanding. Arrears commonly *do* gate those things in Zambia, which is exactly why it must be a per-school setting, off by default, rather than schema behaviour — a school that does not withhold results must not inherit the behaviour of one that does. The suite asserts publishing succeeds while a student is in arrears, so a future gate cannot be added silently.

### Two real defects the suite caught

- **`allocate_payment()` was completely broken.** `RETURNS TABLE` columns become PL/pgSQL variables, and `amount` / `fee_record_id` collided with the internal temp table's columns — `42702 column reference "amount" is ambiguous` aborted every call. Fixed in `0080` by prefixing the OUT columns.
- **`fee_statement()` was non-deterministic.** Charges were dated by `created_at`, but generation writes a whole term in one statement, so every charge shared a timestamp and the running balance had no defined order. **The same statement closed at 1000 or 2200 depending on planner order.** A financial document that reads differently each time is not a financial document. Fixed in `0081`: charges date by `due_date`, and the window function and final `ORDER BY` use one complete key. The suite now runs the same call eight times and asserts a single distinct closing balance.

That second one also explains the windowed-statement failure — with charges dated at generation time, nothing fell before a five-day window, so no brought-forward line appeared even though a term due forty days earlier was plainly outstanding.

### Verified

Arrears suite 33/33 · Phase 2 suite 45/45 · Phase 1 suite 72/72 · `turbo type-check` 8/8 · types regenerated · fixtures cleaned up.

### Not built, deliberately

- **Arrears gating** — per-school, admin-configurable, off by default. Reads these columns when it lands.
- **Loan linkage** — `records_overdue`, `days_overdue`, `paid_at`, and `due_date` are the raw material `BEHAVIOUR_SCORE.md` would need. Not coupled, not precluded.
- **API routes for the balance/statement** — the views and functions exist and are RLS-safe; surfacing them is UI work.

---

## 2026-08-15 — Phase 2: fees, attendance, and results

Branch `feature/phase-2-fees-attendance-results`. **Migrations `0070`–`0076` applied to `zsms-dev`. Phase 2 suite passes 45/45; Phase 1 suite still 72/72.**

### The suite caught the same class of bug again

First run was **44/45**:

```
not ok 3 - authenticated holds no UPDATE on payments   (have 1, want 0)
```

Identical root cause to `0019`: **Supabase's default privileges grant `ALL` on a new `public` table to `authenticated`.** `0070` granted `SELECT, INSERT` and revoked `DELETE`/`TRUNCATE`, but adding a grant does not remove the `UPDATE` already held — and `0019`'s `ALTER DEFAULT PRIVILEGES` only covered `DELETE` and `TRUNCATE`.

`0070`'s own comment asserted *"no UPDATE privilege for end users at all."* **That was false when written.** `payments` has no UPDATE policy, so RLS filtered direct updates to zero rows for ordinary roles — but `afritech_admin_all_payments` is `FOR ALL`, which covers UPDATE. A super admin could have edited a payment in place, bypassing `verify_payment()` and its guard against re-verifying. Payments are supposed to be immutable with corrections as reversal rows; an in-place edit leaves no trace.

Fixed in `0076`, which verifies itself inline. **Twice now the same default-privilege mechanism has produced a hole, both times found by an assertion rather than by review.** The lesson is that `GRANT` is not a whitelist — the baseline is already permissive, so every new table needs an explicit revoke of what it must not expose.

### Fee lifecycle, proven end to end

Structure → generated records → parent submits → accountant verifies → balance moves. Twelve assertions walk it, and two carry the design:

- **A pending payment moves nothing.** `amount_paid` stays 0 and the record stays `unpaid` until verification. Without that assertion, "verification" would be decorative.
- **Verification is attributed.** A `CHECK` requires `verified_by` and `verified_at` together — *verified by nobody at no time* is not a valid state for a money record.

Three things are database functions rather than route code because they must be atomic: receipt numbering (locks the school row; two concurrent cashiers would otherwise compute the same number), balance derivation (a trigger over **verified** payments only, so it cannot drift), and verification itself.

`generate_fee_records()` is idempotent — asserted, because a second run silently doubling every balance is the worst plausible failure here.

### Teaching scope reaches attendance and marks

ADR-037 paid off exactly where intended. Attendance uses `teacher_reaches_class()`; marks use the narrower `teacher_teaches_subject()`, where a `scope='class'` teacher owns every subject in their class and a `scope='subject'` teacher only their own. The suite asserts a subject teacher cannot enter marks for **a different subject in a class they do reach** — the case a coarser model would have allowed.

**One deviation from `RLS.md`, deliberate.** It left the publication lock to the application layer. That would leave a published mark editable by any direct PostgREST call, so `results_published = FALSE` is in the UPDATE policy's `USING` clause. The suite asserts a teacher cannot edit after publication and cannot publish by flipping the flag on their own row.

### Numbering: the reserved block was unusable

`0022`–`0068` sort **below** the applied high-water mark (`0069`), and `supabase db push` skips anything older than the last applied without `--include-all`. A migration written as `0030` today would simply never run. Phase 2 therefore starts at `0070`, and `MIGRATIONS.md` now states the rule plainly: **numbers are assigned when a migration is written, never reserved in advance.**

### Document conflict resolved: `payments`

`SCHEMA.md` and the 2026-04-26 `CHANGELOG.md` entry specify `status`, `verified_by`, `verified_at`, `rejection_reason`, `proof_of_payment_url`, and `confirmation_checkbox_at` — the change that *"removed OTP for financial submissions, replaced with confirmation workflow"*. `DATABASE.md`'s DDL had none of them. Without those columns there is no verification step at all. SCHEMA.md governs; `DATABASE.md` corrected.

### API routes

`/api/fees/structures` · `/api/fees/records` (GET, POST=generate) · `/api/payments` (GET, POST=submit) · `/api/payments/[id]/verify` · `/api/attendance` · `/api/results` · `/api/results/publish`. Twelve routes total across Phases 1–2, all registering in the build.

Two rules held throughout: **the client never names its own status** — every submission lands `pending_verification`, and the field is absent from the schema — and **teaching-scope checks are not duplicated in route code**. The policy is the check; a second copy in TypeScript is a second thing to drift.

### Verified

Phase 2 suite 45/45 · Phase 1 suite 72/72 · `turbo type-check` 8/8 · `turbo build` clean · types regenerated · fixtures cleaned up.

---

## 2026-08-15 — Phase 1: core domain backend (schools, students, staff)

Branch `feature/phase-1-core-domain`, cut from `integration` at `8ffbddb`.

**Status: APPLIED to `zsms-dev` and verified. Isolation suite passes 72/72. Merged to `integration`.**

### The teaching-assignment model — ADR-037 (migrations `0020`, `0021`)

The `class_enrolments` gap was closed at its root rather than worked around. `class_subjects` records which subjects a class is taught; `teacher_assignments` records what a teacher teaches, discriminated by a `scope` field:

| scope | Shape | Models |
|---|---|---|
| `class` | `class_id` set, `subject_id` NULL | primary school, form teacher |
| `subject` | both set | secondary school subject teacher |

A teacher may hold any number of rows of either scope, including both. **Both scopes carry `class_id`** — that is the load-bearing detail, because it lets `teacher_reaches_class()` ignore `scope` entirely and therefore never branch on school type. The shape of a school is data, not a code path.

The scope/subject `CHECK` constraint is a security control, not tidiness: a `scope='subject'` row with a NULL `subject_id` would read to the predicate as reaching the *whole* class, silently widening that teacher.

Write access is owner and principal only. Teacher reach is derived from this table, so a teacher who could insert their own row could grant themselves any class's students — the suite asserts that directly.

`teacher_assigned_to_class()`, the `0016` interim helper, is **dropped** rather than left in place. Two predicates answering "which students may this teacher see" is exactly how the wrong one ends up in a future policy.

**`staff_assignments` dropped in `0069`** (2026-08-15), on explicit approval. Verified dead first: 0 rows, 0 inbound FKs, 0 functions, 0 views, no application references. The migration re-checks the row count at apply time and refuses if non-empty — "it was empty when I checked" is not "it is empty now" — and uses `RESTRICT`, not `CASCADE`, so a surviving dependency fails loudly instead of being silently removed too.

Removing it surfaced four **Phase 2** policies in `RLS.md` — two on `attendance_records`, two on `exam_results` — still resolving teachers through the dropped table. Repointed at `teacher_reaches_class()` and a newly specified `teacher_teaches_subject(class_id, subject_code)`, which lands with the exam-results migration. Left unfixed, those would have been written against a table that no longer exists.

**Twelve new assertions**, covering both scopes, the mixed case, the two constraint violations, self-assignment, and the one that matters: *a subject teacher cannot see students in a class they do not teach*. Suite is now 72, all passing.

### I collided with reserved migration numbers

`0019`, `0020`, and `0021` were **already claimed** by the plan — `create_fee_tables`, `create_fee_rls`, `create_message_quota_table`. I named files by looking at the highest number on disk instead of reading *Next Available Sequence Number*, which said `0066`.

Mine are applied, and an applied version cannot be renumbered — it is the identity `supabase db push` reconciles against. So the *planned* migrations moved instead: fees and message quota are now `0066`–`0068`, next available `0069`.

The document also carried **three conflicting "next available" pointers** (`0022`, `0056`, `0066`) in different sections. Reconciled, with the one near the top declared authoritative.

**Rule 3 exists for exactly this and I skipped it.** Most of the sequence is planned in the document long before it exists on disk, so the filesystem is never the source of truth for the next number.

### The isolation suite caught a real defect on its first run

This is the entry that matters. The first run was **53/55**, and the two failures were the same root cause:

```
not ok 3  - authenticated holds no DELETE privilege on students   (have 1, want 0)
not ok 27 - owner A cannot hard-delete even their OWN student     (caught: no exception)
```

**Supabase's default privileges grant `ALL` on every new `public` table to `authenticated`.** Migrations `0003`–`0018` revoked that for `anon` but only *added* `SELECT, INSERT, UPDATE` for `authenticated` — which does not remove the `DELETE` it already held.

No data was lost: `students` has no `DELETE` policy, so RLS filtered the delete to zero rows, and a later assertion confirmed the row survived. But the guarantee was resting on RLS alone, and that was thinner than it looked — **policies written `FOR ALL` cover DELETE too.** `afritech_admin_all_students`, `management_write_staff`, and `school_management_links` are all `FOR ALL`, so on those paths the privilege was live. An AfriTech super admin could have hard-deleted a student, which prohibition 8 says must be impossible for anyone.

Fixed by **migration `0019`**, which revokes `DELETE, TRUNCATE` from `authenticated` and `anon` across all fifteen tables, sets `ALTER DEFAULT PRIVILEGES` so future tables inherit the correction, and verifies itself inline — the migration raises at apply time if any grant survives. Four assertions were added to the suite (now **60**) covering the `FOR ALL` paths and the super admin specifically.

**The lesson is the one the brief was built around.** Every "can School A read its own data" test passed on the broken schema. Only the assertion that *actively attempted a forbidden delete* found it. Testing what users cannot do is what located a defect that review had not.

### Two further defects found while running

- **Data-modifying CTEs are illegal as function arguments.** The suite used `is((WITH x AS (UPDATE ...) SELECT count(*) FROM x), 0, ...)`, which PostgreSQL rejects with *WITH clause containing a data-modifying statement must be at the top level*. Replaced with a `SECURITY INVOKER` `rows_affected()` helper — invoker rights are essential, so the write executes as the role under test.
- **One assertion tested the wrong failure mode.** "Owner A cannot reassign their own student into School B" expected zero rows affected. It does not: `USING` passes because the row *is* visible to that caller, and `WITH CHECK` rejects the post-update row, raising `42501`. Changed to `throws_ok`.

### Applied state (verified by query, not assumed)

| Check | Result |
|---|---|
| `public` tables | 17 |
| Tables without RLS | **0** |
| Tables without `FORCE` | **0** |
| Policies | 64 |
| `DELETE`/`TRUNCATE` granted to end-user roles | **0** |
| Migrations applied | 21 (`0001`–`0021`) |
| Non-four-digit versions | **0** |
| Stale `teacher_assigned_to_class()` | **0** — dropped in `0021` |
| Leftover test fixtures | 0 (suite cleans up after itself) |
| pgTAP isolation suite | **72 / 72** |

`turbo type-check` 8/8 · `turbo build` clean · types regenerated from the live schema.

### On the CLI

The user reported login *and* link succeeded; the CLI reported neither. Both were half true: **login had succeeded** — the token lives in the Windows Credential Manager, not `~/.supabase/access-token`, which is why the file check said otherwise — but **link had not** (`"linked": false` from the API). Diagnosed with `supabase projects list`, which returned the project list *and* `linked: false` in one response. Worth remembering: on Windows, the absence of the token file proves nothing.

### Migrations 0002–0018

Schemas · schools · school config tables (`academic_config`, `grade_levels`, `subjects`, `grading_scales`, `reference_subjects_zm`, `onboarding_checklists`) · students · parents · `student_parent_links` · permission tables · staff tables · RLS for all of it.

Written contiguously rather than only the three tables named in the brief. Leaving `0005`–`0010` as gaps would have meant filling them later with versions that sort *before* the applied maximum, which `supabase db push` skips without `--include-all` — the exact hazard the versioning procedure written yesterday exists to prevent.

### Three specification defects found by implementing against the docs

| Defect | Resolution |
|---|---|
| **Migration order is impossible.** `MIGRATIONS.md` put the permission tables at `0017`, *after* the student RLS (`0014`) and staff RLS (`0016`) whose policies call `has_permission_grant()` — which reads `staff_permission_grants`. A policy evaluated before its table exists raises `relation does not exist`, so every `students` query would error rather than filter. | Permission tables → `0014`, staff tables → `0015`, student RLS → `0016`. Corrected order recorded in `MIGRATIONS.md`. |
| **Policy recursion.** `RLS.md` writes three policies as cross-table subqueries: `students` reads `student_parent_links`, whose policy reads `students`. Literally applied, PostgreSQL aborts with *infinite recursion detected in policy*. | Predicates unchanged, relocated into four `SECURITY DEFINER` lookups (`is_linked_parent_of`, `student_in_current_school`, `parent_has_student_in_current_school`, `teacher_assigned_to_class`) which do not re-trigger RLS on the inner table. |
| **`class_enrolments` did not exist.** `RLS.md` resolves a teacher's students through it. It has no DDL in `DATABASE.md`, no entry in `SCHEMA.md`'s 58-table inventory, and no migration — yet four documents reference it (`RLS.md`, `ASSIGNMENTS.md`, `POWERSYNC.md`, `OFFLINE_SYNC.md`). | `teacher_read_assigned_students` resolves through `students.class_id`, which *is* defined and `NOT NULL`. **RESOLVED** by ADR-037 — see the teaching-assignment section above. `class_subjects` and `teacher_assignments` replace it. |

### Two hardening choices beyond the spec

- **`FORCE ROW LEVEL SECURITY` on every table**, not just `ENABLE`. Without it the table owner bypasses every policy — and the isolation suite would then pass against a boundary that does not hold for the owning role.
- **RLS enabled at table-creation time, policies deferred.** `0014` and `0015` enable RLS immediately and add policies in `0017`/`0018`. A table with RLS on and no policies denies everything, so the gap fails closed. The alternative would leave `staff_permission_grants` — the table deciding who may exceed their role — readable by every authenticated user for the length of the gap.

### API routes

`/api/schools` (GET, PATCH) · `/api/students` (GET, POST) · `/api/students/[id]` (GET, PATCH, DELETE→soft) · `/api/staff` (GET, POST). Zod validation, documented `{ data, meta? }` / `{ error, code, details? }` envelopes.

Two decisions worth keeping:

- **`school_id` is always derived from the JWT, never read from a request body.** A client that can name its own tenant turns `WITH CHECK` into the only thing standing between it and another school's data.
- **Cross-tenant reads return `404`, not `403`.** A 403 confirms the record exists somewhere, which is itself a cross-tenant disclosure. RLS makes the row invisible rather than forbidden, and the routes preserve that.

The service role key appears nowhere: `createServiceClient()` deliberately does not exist, because a Next.js API route is not an Edge Function (prohibition 1).

### pgTAP isolation suite — 60 assertions

`supabase/tests/rls/tenant_isolation_test.sql`. Adversarial by construction: the majority of assertions have School A actively attempt to read, update, insert into, reassign, or delete School B's records and assert refusal. Covers owner, teacher, parent, student, super admin, and `anon`, in both directions between the two schools.

The subtle ones worth noting: reassigning one's *own* student into another school (the `USING` clause passes because the row is currently visible, so only `WITH CHECK` stops it); a `students:write` grant at School A not conferring write at School B; a teacher blocked from an unassigned class *within their own school*; and a cross-school aggregate returning only the caller's count. Section 6 asserts the AfriTech super admin *does* cross tenants — without it, a blanket-deny bug would make every other assertion pass for the wrong reason.

### Verified so far

`turbo type-check` 8/8 including the new routes. Nothing else can be verified until the migrations are applied.

### Known limitation

`nextStudentId()` computes the sequence as `count + 1`, so two concurrent enrolments at one school can collide. The `UNIQUE` constraint turns that into a 409 rather than a duplicate, so it is safe but not graceful. `STUDENT_ID.md` assigns generation to an Edge Function; moving it there with a per-school sequence removes the race.

---

## 2026-08-14 — Pre-Phase-1 cleanup: security bump, migration procedure, permission policy

Three cleanups before Phase 1, plus a persistent permission configuration.

### 1. Next.js security bump — done

`14.2.18` → **`14.2.35`**, the exact version the [2025-12-11 advisory](https://nextjs.org/blog/security-update-2025-12-11) names for the 14.x line. It carries the complete fix for **CVE-2025-67779** — the initial patch for CVE-2025-55184 (DoS) was incomplete — plus CVE-2025-55183 (Server Function source-code exposure). Both are App Router / RSC issues, so they apply directly to `apps/web`.

Verified after the bump: `turbo type-check` 8/8 pass, `turbo build` pass.

**The larger finding: Next.js 14 is effectively end-of-life for security.** `npm audit` still reports `next` as high severity after the bump, across ~21 further advisories whose fixed versions land in the **15.5.x** line — nothing is backported to 14.x. A sample of what remains unpatched on 14:

| Advisory | Fixed in |
|---|---|
| SSRF in rewrites via attacker-controlled destination hostname | 15.5.21 |
| SSRF in Server Actions on custom servers | 15.5.21 |
| Unauthenticated disclosure of internal Server Function endpoints | 15.5.21 |
| XSS in App Router apps using CSP nonces | 15.5.16 |
| Cache poisoning in RSC responses / middleware redirects | 15.5.16 |
| HTTP request smuggling in rewrites | 15.5.13 |

`npm audit` reports `fixAvailable: next@16.3.0 (isSemVerMajor)`.

**Raised as a decision rather than fixed silently — the user chose to upgrade.** `apps/web` now runs **Next.js 15.5.23** (ADR-036). `npm audit` confirms **`next` has zero advisories of its own**; it is now flagged only transitively through `postcss` and `sharp`.

#### The upgrade exposed a hoisting fault — worth reading before Phase 1

The build failed on `15.5.23` with `Cannot read properties of null (reading 'useContext')` while prerendering `/_error`. The require stack named the culprit:

```
node_modules/styled-jsx/dist/index/index.js        ← monorepo ROOT
  └─ next/dist/compiled/next-server/pages.runtime.prod.js
      └─ apps/web/.next/server/pages/_document.js
```

`styled-jsx` is a transitive dependency of `next`. npm hoists it to the **root**, while `next` stays nested in `apps/web`. It therefore resolves `react` against the **root** `node_modules` — which held `18.3.1`, hoisted there for React Native 0.76. Prerendering loaded a second React instance, and the two shared no dispatcher.

The repo genuinely needs two React majors (Next 15 App Router wants 19; RN 0.76 pins 18.3.1). They cannot be reconciled by picking one — what matters is **which version occupies the root slot**, because hoisted transitive dependencies resolve against it. Fixed by declaring `react`/`react-dom` at `19.2.8` in the root `package.json` purely to control hoisting, plus a scoped `overrides` pinning Clerk's `next` peer.

**Three hypotheses were tested and rejected first, each by experiment:**

| Hypothesis | How it was killed |
|---|---|
| React major mismatch in `apps/web` | Failed with React 18 *and* React 19 |
| `transpilePackages` pulling `auth-provider` in | Removing it changed nothing; `apps/web` imports only `@zsms/config` |
| Mismatched SWC binary | The `@next/swc` warning was a benign hoisting artifact, correct at `15.5.23` |

A pristine Next 15.5.23 + React 19.2.8 app built outside the monorepo compiled cleanly — that is what localised the fault to the dependency tree rather than the framework. **The lesson: I guessed twice before isolating, and both guesses cost a full reinstall cycle. The pristine-app comparison should have been the first move, not the fourth.**

Verified after the fix: `turbo type-check` 8/8, `turbo build` clean and stable across repeat runs.

**What remains after the upgrade**, none of it currently reachable, all of it needing a decision before it becomes reachable:

| Package | Issue | Reachable when | Fix |
|---|---|---|---|
| `sharp` `<0.35.0` | libvips CVEs | a user-uploaded image passes through `next/image` | sharp ≥ 0.35, or serve images straight from R2/Cloudflare and bypass the Next optimizer |
| `postcss` | sourceMappingURL path traversal, stringify XSS | only if we ever process untrusted CSS | build-time only; we author all CSS |
| `tar` **critical** | hardlink path traversal | build/install time under Expo 52 | needs Expo 57 (major) |

`sharp` is the one that matters: ZSMS will serve student photos and school logos. **Resolve it before any user-uploaded image is served through `next/image`.**

### 2. Branch protection — **DEFERRED, not skipped**

**Blocked by GitHub plan, not by configuration.** Rulesets and branch protection are not enforced on a **free private organisation repository**. The rules can be created, but GitHub does not apply them, so a direct push to `main` still succeeds. The user set protection on `main` manually; it will not take effect until the org moves to **GitHub Team**.

**Until then, ADR-011's workflow rests on PR discipline, not platform enforcement.** Treat `feature/* → integration → main` as a convention that nothing prevents you from violating. Do not assume a failed push means the rule worked.

Re-attempt when the org upgrades to Team. Two settings to get right at that point:

- **Required approvals: 0**, not 1, while there is a single maintainer — GitHub forbids approving your own PR, so 1 makes `main` unmergeable.
- **Leave "Do not allow bypassing" off** until the workflow is proven; with 0 reviewers it can lock the owner out of the default branch.

Required status checks were deliberately left unconfigured — there is no CI yet (the Layer 7 gap). They should be added the moment `CI_CD.md` lands. **That is what actually makes prohibition 4 — no table without an RLS policy — enforceable rather than aspirational.**

`gh` is also not installed on this machine (neither Windows PATH nor Git Bash) and no token is configured, so any future attempt needs `winget install GitHub.cli` and `gh auth login` first.

### 3. Migration versioning convention — established

Root cause of the `0001` desync: **the version string and the filename come from different places.** Supabase keys `supabase_migrations.schema_migrations` on a version string; the MCP's `apply_migration` writes a timestamp version regardless of what the file is called, and `supabase migration new` generates timestamp *filenames*. Either one breaks the `NNNN_` convention.

The ordering consequence is worse than the naming one: **versions sort as strings, so a timestamp version sorts after every four-digit version.** One stray timestamp silently reorders the entire sequence — and the sequence is load-bearing, since `0001`'s `has_permission_grant()` depends on tables created in `0003` and `0017`.

Resolution — the Supabase CLI is now the only supported path:

- CLI pinned as a root `devDependency` (**2.114.0**) so every developer and CI runner uses one version
- Added `db:push`, `db:list`, `db:diff` scripts alongside the existing `db:types` / `db:test`
- Full procedure documented in `MIGRATIONS.md` → *Migration Versioning and Application Procedure*, summarised in `CLAUDE.md`
- MCP `apply_migration` is now dev-exploration only, and requires the history-row correction in the same session
- Staging and production are release actions requiring explicit human approval, with a re-link-to-dev-immediately rule

**Latent bug found in passing:** `package.json` already had `db:types` and `db:test` calling a bare `supabase`, but the CLI was not installed anywhere — globally, locally, or as a dependency. Both scripts would have failed the first time anyone ran them. Fixed by the pin above. Also corrected placeholder project refs (`zsms-dev-ref`) and a generated-types path in `MIGRATIONS.md` that disagreed with `package.json`.

### 4. Permission configuration — persisted to the repo

Written to `.claude/settings.json` (tracked, team-shared) rather than `settings.local.json`, so it survives sessions and applies to everyone.

Routine and reversible work now runs unprompted: reads, edits, builds, type-checks, tests, local git, and `zsms-dev` queries and migrations. Irreversible or outward-facing work still prompts: pushes, branch deletion, `reset --hard`, file deletion, project re-linking, Edge Function deploys, and anything aimed at a non-dev project. Force-push and reading `.env` / key material are denied outright rather than merely gated.

**Two things this required beyond a plain allow-list:**

- **A `PreToolUse` hook** (`.claude/hooks/guard-supabase-sql.js`). Permission rules match on *tool name only*, so allowing `execute_sql` for routine dev queries would equally allow `DROP TABLE` — the split the user asked for is not expressible in rules alone. The hook inspects the SQL and escalates on `DROP`, `TRUNCATE`, `ALTER … DROP`, `DELETE`/`UPDATE` without `WHERE`, `DISABLE ROW LEVEL SECURITY`, and on any `project_id` that is not `zsms-dev`. It fails closed: an unparseable payload escalates rather than passes. Verified against eight payloads covering both directions.
- **Pruning `settings.local.json`.** It had accumulated ~70 one-off approvals from earlier sessions, including `git push origin main` and `git push -f origin integration`. Local settings **outrank** project settings, so those entries would have silently defeated the very rules being added. Reduced to four durable entries; backup kept in the session scratchpad.

**Known gap, deliberate:** MCP permission rules cannot match on arguments, so `apply_migration` cannot be allowed for dev while prompting for staging. The hook closes this by reading `project_id`, but the hook is the only thing enforcing it — if it is removed or errors non-fatally, the rule reverts to allow-all-projects. Revisit when `zsms-staging` is provisioned.

---

## 2026-08-13 — Phase 0 scaffold

**State at start:** documentation-only repo, 118 markdown files, empty `zsms-dev` schema.
**State at end:** Turborepo monorepo with all three provider abstractions stubbed, migration `0001` applied and verified, `main` and `integration` both on GitHub.

### Completed

**Monorepo** — `apps/web` (Next.js 14 App Router, `/api/health` returning component-level status per `AVAILABILITY.md`), `apps/mobile` (Expo 52 / RN 0.76), six workspace packages, `supabase/{migrations,functions,tests/rls,seed}` + `config.toml` exposing only `public`.

**Abstractions** — all three stubbed interface-complete with dynamic imports so the scaffold builds before dependencies land:

| Package | Default | Alternate | Swap point |
|---|---|---|---|
| `@zsms/queue` | BullMQ (ADR-035) | QStash fallback | `JOB_QUEUE_PROVIDER` |
| `@zsms/auth-provider` | Clerk | Keycloak (Tier 2, throws until built) | `AUTH_PROVIDER` |
| `@zsms/storage` | Cloudflare R2 | MinIO (Tier 2) | endpoint + credentials |

Boundary verified by grep: no `@clerk/*`, `bullmq`, `@upstash/qstash`, or `@aws-sdk/*` import exists outside its owning wrapper.

**Migration `0001`** — written, applied to `zsms-dev`, verified:
- `vector` + `pgtap` `WITH SCHEMA extensions`, never `public`
- Seven canonical RLS helpers from `RLS.md`, implemented verbatim
- `public`: **0 tables, 7 functions**; `extensions`: 1,252 functions
- `SET LOCAL check_function_bodies = off` — `has_permission_grant()` reads tables from `0003`/`0017` that do not exist yet
- History version corrected from the MCP timestamp `20260813143727` to `0001` so `supabase db push` reconciles against the `NNNN_` convention

**Helper reconciliation** — proposed `is_afritech_staff()` and `is_school_admin()` were **not** created. Competing near-synonyms in a security layer are how the wrong check lands in a policy. Mapped to `is_afritech_admin()` and `get_user_role() IN (...)` respectively; recorded in `MIGRATIONS.md`.

### Documentation bugs found while scaffolding

Writing the migration surfaced a cluster the earlier reconciliation pass missed — all in the same family (`ARCHITECTURE.md`/`AUTH.md` drifting from `RLS.md`):

| Bug | Fix |
|---|---|
| `get_school_id()` returned `uuid` from `user_metadata` in **two** docs | Corrected to `RLS.md`'s TEXT/`auth.jwt()` version |
| Example policy compared a UUID column to `get_school_id()` | Type error — corrected to resolve via `schools.clerk_org_id` |
| `ARCHITECTURE.md` listed 5 of 8 `org:*` roles | Added `org:admin`, `org:parent`, `org:student` |
| `RLS.md` role list omitted `org:staff` | Added |
| `AUTH.md` `ZsmsJwtClaims` used `org_id`/`org_role`/`metadata` | Corrected to compact `o`/`act` claims |
| Two alumni "indefinite session" references | Corrected to 30 days |

**Lesson:** the earlier text-level sweep caught string mismatches but not *semantic* drift between an authoritative doc and its illustrative copies. Implementing against a doc is what exposed it. Expect more of this at each phase boundary.

### Build verification

| Check | Result |
|---|---|
| `npm install` | 703 + 96 packages, exit 0 |
| `turbo type-check` | **8/8 workspaces pass** |
| `turbo build` | **pass** — `/` static, `/api/health` dynamic (ƒ), 87.1 kB shared JS |
| Abstraction boundaries | no `@clerk`, `bullmq`, `@upstash/qstash`, or `@aws-sdk` import outside its wrapper |

Two scaffold defects found and fixed during verification:
- **Implicit `@types/*` inclusion.** With hoisted workspaces, `tsc` pulled every `@types` package in the root and failed to resolve them. Fixed with `"types": []` in `tsconfig.base.json` plus explicit per-workspace declarations.
- **`.js` extensions in relative imports.** `tsc` under `moduleResolution: "Bundler"` accepted them; webpack could not resolve `./countries/zm.js` against `zm.ts`. Stripped from 11 source files. Worth remembering: type-check passing does not imply the bundler agrees.

### Open items carried forward

- `INDEXES.md` still needs the eight `afritech` index entries when `0065` is written
- Layer 1 (Frontend) and Layer 7 (CI-CD) remain **Thin** in `THIRTEEN_LAYER_COMPLIANCE.md`; CI must land before the first production migration
- `next@14.2.18` carries a published security advisory (npm deprecation warning points to the 2025-12-11 Next.js security update). Needs a patch bump within 14.x before any deployment — flagged, not applied, since it is a dependency-policy decision

---

## 2026-08-13 — Documentation reconciliation, architecture gap fill, repo initialisation

**State at start:** documentation-only repository, 108 markdown files, no git, no Supabase schema.
**State at end:** 118 markdown files, git initialised on `main` with remote configured, `zsms-dev` extensions enabled, all known documentation contradictions resolved.

### Completed

**Repository setup**
- `git init`, branch renamed `master` → `main` (ADR-011 workflow)
- Remote `origin` → `https://github.com/AfriTechSystems/zsms-monorepo.git`
- `.gitignore` — secrets, `.claude/settings.local.json`, `~$*.docx`, Node/Turborepo/Next/Expo/Supabase
- `.gitattributes` — `* text=auto eol=lf`, CRLF for Windows scripts, binary and generated-file handling
- `CLAUDE.md` authored — repo state, doc map, conventions, Supabase environments, known inconsistencies

**Supabase (`zsms-dev`, ref `tevblmcebsqqjgzjptgw`)**
- `vector` 0.8.2 and `pgtap` 1.3.3 enabled, relocated to the `extensions` schema
  (they initially landed in `public`, adding ~1,190 functions to the schema PostgREST exposes and `supabase gen types` introspects)
- Region confirmed as `eu-west-1` — a deliberate, documented exception; synthetic data only
- Schema remains empty; migrations are specified but not applied

**Documentation — 10 new documents**
- `THIRTEEN_LAYER_COMPLIANCE.md`, `DYNAMIC_CONFIG.md`, `BUILD_SEQUENCE.md`
- `COST_MANAGEMENT.md`, `CACHING_CDN.md`, `SCALING.md`, `AVAILABILITY.md`, `DEPLOYMENT_TOPOLOGY.md`, `HOSTING_STRATEGY.md`
- `LOAD_TESTING.md`

**Documentation — six new ADRs (030–035)**
13-layer compliance · dynamic-config-everything · three-tier deployment topology · k6 load testing · context-aware AI assistant with approval-gated writes · BullMQ as default job queue

**Contradictions resolved**
| Was | Now |
|---|---|
| QStash-first vs BullMQ-first | ADR-035 is sole source of truth; 0 unqualified references remain |
| `RAILWAY.md` "is a database only" | Standby **+** BullMQ workers; correlated-failure risk flagged |
| `DATABASE.md` / `SUPABASE.md` "two schemas" | Three schemas, counts corrected |
| 365-day sessions in 5 documents | 30 days, per the 2026-06-23 `SESSIONS.md` revision |
| Migration gap in `DYNAMIC_CONFIG.md` | Closed — migrations `0061`–`0065` |

**Migration gap closure**
`DYNAMIC_CONFIG.md` specified `afritech` tables with no migration. Recorded as five; cross-check found **eight** — `platform_settings`, `platform_products`, and `commission_rates` were also missing. All eight now defined in migrations `0061`–`0065` with full DDL, deny-by-default RLS, and indexes. **Documentation only — not applied to any database.**

### Incidents

- **UTF-8 corruption during bulk edit.** A PowerShell find/replace across 32 files read them as ANSI (PS 5.1 default), double-encoding every non-ASCII character and adding BOMs. Detected, reversed via CP1252 round-trip, BOMs stripped. Verified clean across all 118 files. **Lesson: use `[System.IO.File]::ReadAllBytes` with explicit UTF-8 decoding in PS 5.1, or use `sed`.**

### Verification at close

| Check | Result |
|---|---|
| QStash-as-default claims | 0 |
| Unqualified QStash references | 0 |
| Mojibake / BOM | 0 / 0 |
| "two PostgreSQL schemas" | 0 |
| Stale 365-day sessions | 0 |
| Stale migration range | 0 |
| ADRs | 35 |
| Markdown files | 118 |

### Open items

- `THIRTEEN_LAYER_COMPLIANCE.md` Layer 1 (Frontend) — **Thin**, needs `FRONTEND.md` before substantial UI work
- `THIRTEEN_LAYER_COMPLIANCE.md` Layer 7 (CI-CD) — **Thin**, needs `CI_CD.md` before the first production migration
- PowerSync has no documented self-hosted path — largest open risk in the Tier 2 deployment model
- `INDEXES.md` needs the eight `afritech` index entries when `0065` is written
- Clerk per-MAU billing vs permanent alumni accounts (ADR-015) — unmodelled cost growth

---

## Next step

**Phase 1** — per `01 Foundation Layer/BUILD_SEQUENCE.md`. The Phase 0 scaffold has landed; what remains of Phase 0's scope carries into Phase 1:

1. Migrations `0002`–`0065` written and applied to `zsms-dev` **via the CLI** (`MIGRATIONS.md` procedure)
2. RLS policy for every table, with pgTAP coverage — a table without a policy is a defect
3. Clerk wired through `packages/auth-provider`; signup → school created → Clerk org provisioned → authenticated dashboard
4. A job enqueued through the queue abstraction, processed by a BullMQ worker (ADR-035)
5. CI/CD — closes the Layer 7 gap; must precede the first production migration
6. Sentry and PostHog
7. `zsms-staging` provisioned in `af-south-1`

**Phase 0 exit gate:** signup → school created → Clerk org provisioned → authenticated dashboard; pgTAP isolation suite passes; a job enqueued through the abstraction is processed by a worker; CI blocks a merge adding a table without an RLS policy.

### Blocking before Phase 1

Nothing blocking. Both prior blockers are closed:

- **Next.js version decision** — resolved; upgraded to 15.5.23 per ADR-036, all 21 advisories cleared.
- **Branch protection** — **deferred, not skipped.** Not enforceable on a free private org repo; revisit at GitHub Team. Until then the ADR-011 workflow is convention only, with nothing preventing a direct push to `main`.

`integration` fast-forwarded to `main` at `8ffbddb`, so Phase 1 feature branches start from the security fix rather than from vulnerable Next 14.

### Open items carried forward

- `INDEXES.md` still needs the eight `afritech` index entries when `0065` is written
- Layer 1 (Frontend) and Layer 7 (CI-CD) remain **Thin** in `THIRTEEN_LAYER_COMPLIANCE.md`
- `sharp` `<0.35.0` — **must be resolved before user-uploaded images pass through `next/image`**
- `tar` critical advisory under `apps/mobile` — needs Expo 57 (major); build-time only
- The root `react`/`react-dom` pin and the Clerk `next` override exist only to control npm hoisting — remove both once React Native supports React 19
- PowerSync has no documented self-hosted path — largest open risk in the Tier 2 deployment model
- Clerk per-MAU billing vs permanent alumni accounts (ADR-015) — unmodelled cost growth
