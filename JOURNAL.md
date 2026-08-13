# JOURNAL.md — ZSMS Working Journal

Running log of substantive work on the ZSMS repository. Newest entry first.

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

**Phase 0 scaffold** — per `01 Foundation Layer/BUILD_SEQUENCE.md`:

1. Turborepo monorepo: `apps/{web,mobile}`, `packages/{auth-provider,types,utils,validators,config}`
2. Migrations `0001`–`0065` applied to `zsms-dev`
3. RLS policies for every table with pgTAP coverage
4. Clerk behind `packages/auth-provider` — no direct imports elsewhere
5. Queue abstraction with BullMQ as the default driver (ADR-035)
6. CI/CD — closes the Layer 7 gap; must precede the first production migration
7. Sentry, PostHog, health endpoint
8. `zsms-staging` provisioned in `af-south-1` at the end of the phase

**Phase 0 exit gate:** signup → school created → Clerk org provisioned → authenticated dashboard; pgTAP isolation suite passes; a job enqueued through the abstraction is processed by a worker; CI blocks a merge adding a table without an RLS policy.

The first commit of application code happens after this scaffold lands.
