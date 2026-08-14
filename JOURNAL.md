# JOURNAL.md — ZSMS Working Journal

Running log of substantive work on the ZSMS repository. Newest entry first.

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

### 2. Branch protection — **not done, needs the user**

`gh` is not installed on this machine (neither on the Windows PATH nor in Git Bash), and no GitHub token is configured, so the API route was unavailable. Exact click-through settings were handed to the user instead. **`main` is still unprotected.**

Caveat worth remembering: with a single maintainer, setting *Require approvals ≥ 1* makes `main` unmergeable, since GitHub forbids approving your own PR. Start at 0 approvals, raise it when a second reviewer exists.

Required status checks were deliberately left unconfigured — there is no CI yet (the Layer 7 gap). They should be added the moment `CI_CD.md` lands.

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

- **Branch protection on `main` is not yet enabled** — needs the user to apply it in the GitHub UI, or `gh` installed so it can be set by API. Until then ADR-011's workflow rests on discipline, not enforcement. **This is the only item still blocking.**

Resolved: the Next.js version decision (upgraded to 15.5.23 per ADR-036; all 21 advisories cleared).

### Open items carried forward

- `INDEXES.md` still needs the eight `afritech` index entries when `0065` is written
- Layer 1 (Frontend) and Layer 7 (CI-CD) remain **Thin** in `THIRTEEN_LAYER_COMPLIANCE.md`
- `sharp` `<0.35.0` — **must be resolved before user-uploaded images pass through `next/image`**
- `tar` critical advisory under `apps/mobile` — needs Expo 57 (major); build-time only
- The root `react`/`react-dom` pin and the Clerk `next` override exist only to control npm hoisting — remove both once React Native supports React 19
- PowerSync has no documented self-hosted path — largest open risk in the Tier 2 deployment model
- Clerk per-MAU billing vs permanent alumni accounts (ADR-015) — unmodelled cost growth
