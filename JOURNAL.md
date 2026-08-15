# JOURNAL.md — ZSMS Working Journal

Running log of substantive work on the ZSMS repository. Newest entry first.

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
