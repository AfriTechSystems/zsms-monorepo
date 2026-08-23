# THIRTEEN_LAYER_COMPLIANCE.md — Thirteen-Layer Architecture Compliance

## Related Documents

- `01 Foundation Layer/ARCHITECTURE.md` — the system architecture this document audits
- `01 Foundation Layer/DECISIONS.md` — ADR-030 records the thirteen-layer model itself
- `01 Foundation Layer/DYNAMIC_CONFIG.md` — cross-cutting configuration registry
- `03 Infrastructure Services/DEPLOYMENT_TOPOLOGY.md` — how layers 5 and 6 vary per country
- `16 Testing and Launch/SECURITY_AUDIT.md` — pre-launch verification of layers 4, 8, and 9
- `16 Testing and Launch/LAUNCH_CHECKLIST.md` — go/no-go gate referencing this audit

---

## Purpose

This document maps every one of the thirteen architecture layers to ZSMS's actual implementation, names the document that owns each layer, and honestly flags where coverage is thin or absent. It exists so that architectural completeness can be assessed at a glance rather than inferred by reading forty documents. Every Claude Code session proposing a new infrastructure component should check which layer it belongs to and whether that layer already has an owner.

---

## Overview

A system is not complete because its features work. It is complete when every architectural layer has a deliberate design, a document that owns it, and someone who would notice if it broke. The thirteen-layer model is the checklist ZSMS uses to prove that.

This document is an audit, not a design. Each layer below states what ZSMS actually does, which document is authoritative for it, and a coverage verdict. The verdict is deliberately unflattering where it should be — a layer marked **Thin** or **Gap** is a commitment to future work, not a failure to hide.

**Coverage verdicts used:**

| Verdict | Meaning |
|---|---|
| **Complete** | A dedicated document owns this layer and specifies it to build-ready detail |
| **Adequate** | Covered sufficiently across existing documents; no dedicated document needed |
| **Thin** | Covered only in passing; a dedicated document is warranted but not blocking |
| **Gap** | No meaningful coverage; must be closed before the milestone noted |

---

## Layer Map

| # | Layer | ZSMS Implementation | Owning Document | Verdict |
|---|---|---|---|---|
| 1 | Frontend | Next.js 15 App Router, React Native/Expo | *(distributed)* | **Thin** |
| 2 | APIs / Backend | Next.js API routes + Supabase Edge Functions | `05/ENDPOINTS.md`, `05/EDGE_FUNCTIONS.md` | **Complete** |
| 3 | Database / Storage | Supabase PostgreSQL, Cloudflare R2 | `01/DATABASE.md`, `13/STORAGE.md` | **Complete** |
| 4 | Auth / Permissions | Clerk + `packages/auth-provider`, DB permission grants | `02/AUTH.md`, `02/PERMISSIONS.md` | **Complete** |
| 5 | Hosting / Deployment | Vercel, Supabase, per-country self-hosted option | `03/VERCEL.md`, `03/DEPLOYMENT_TOPOLOGY.md` | **Complete** |
| 6 | Cloud / Compute | Vercel functions, Edge Functions, Railway workers | `03/COST_MANAGEMENT.md` | **Complete** |
| 7 | CI-CD / Version Control | GitHub, two-branch workflow, Vercel preview deploys | `01/CONVENTIONS.md`, `03/VERCEL.md` | **Thin** |
| 8 | Security / RLS | PostgreSQL RLS, Cloudflare WAF, field encryption | `01/RLS.md`, `01/SECURITY_POLICIES.md` | **Complete** |
| 9 | Rate Limiting | Upstash Redis, Cloudflare Worker edge limits | `05/RATE_LIMITS.md`, `03/CLOUDFLARE_WAF.md` | **Complete** |
| 10 | Caching / CDN | Upstash Redis, Cloudflare CDN, Next.js ISR | `03/CACHING_CDN.md` | **Complete** |
| 11 | Load Balancing / Scaling | Vercel auto-scale, Railway workers, pooling | `03/SCALING.md` | **Complete** |
| 12 | Error Tracking / Logs | Sentry, PostHog, `audit_logs`, `integration_log` | `03/SENTRY.md`, `09/AUDIT.md` | **Adequate** |
| 13 | Availability / Recovery | Railway standby, PITR, uptime monitoring | `03/AVAILABILITY.md` | **Complete** |

---

## Layer 1 — Frontend

**Implementation.** Next.js 15 App Router (ADR-036) serves the school portal, parent portal, admin panel, and Teacher Hub from `apps/web`. React Native/Expo serves the teacher attendance app and parent mobile app from `apps/mobile`. Component conventions, folder flatness, and PascalCase component naming are specified in `CONVENTIONS.md`.

**Coverage: Partial** (was Thin until 2026-08-16). `DESIGN_SYSTEM.md` now owns the visual layer: component library choice (shadcn/ui + Lucide), the token architecture in `packages/design-tokens`, typography, colour hierarchy and its semantic mapping, component rules, loading and empty state conventions, the WCAG AA accessibility baseline, and per-school theming under ADR-043. Contrast is asserted arithmetically in tests rather than reviewed by eye, and enforced by database constraint for school-supplied palettes.

**Still missing.** State management approach, data-fetching and caching strategy, form handling library, error boundary placement, and route-level layout composition. These are answerable only against real screens, and no portal screen exists yet.

**Recommendation.** Settle the remaining items during Phase 4 sub-phase 2 (admin dashboard), which is the first sub-phase with enough real screens to decide them against — and record them in `DESIGN_SYSTEM.md` or a sibling `FRONTEND.md` at that point. The original recommendation stands in spirit: deciding these after twenty screens exist is significantly more expensive than deciding them after two.

---

## Layer 2 — APIs / Backend

**Implementation.** Next.js API routes under `apps/web/app/api/` handle user-facing operations at request latency. Supabase Edge Functions (Deno) handle operations exceeding two seconds, service-role writes, and webhook processing. Every route follows the fixed response shape defined in `CONVENTIONS.md`: `{ data, meta? }` on success, `{ error, code, details? }` on failure.

**Coverage: Complete.** `ENDPOINTS.md` catalogues every route with method and auth requirement. `EDGE_FUNCTIONS.md` catalogues every function with trigger and invoking job. `ERROR_CODES.md` fixes the error vocabulary. `API_INTEGRATION.md` covers external API key authentication.

---

## Layer 3 — Database / Storage

**Implementation.** Supabase PostgreSQL holds 58 tables across three schemas — `public` (46), `private` (4, loan PII, no PostgREST exposure), and `afritech` (16, platform configuration and pricing). Cloudflare R2 provides two buckets separating public documents from sensitive uploads. Migrations `0001`–`0065` are specified in sequence.

**Coverage: Complete.** `DATABASE.md` is the authoritative schema reference, `SCHEMA.md` its plain-English companion, `INDEXES.md` covers query performance, `MIGRATIONS.md` the sequence, `STORAGE.md` and `R2.md` the file layer.

---

## Layer 4 — Auth / Permissions

**Implementation.** Clerk issues JWTs carrying `sub`, `org_id`, `org_role`, and metadata. All Clerk access is mediated by `packages/auth-provider` so that no other package imports Clerk directly — this abstraction is what makes the Keycloak swap a configuration change for self-hosted deployments. Permissions beyond base role live in `staff_permission_grants`; school-defined roles live in `school_custom_roles` applied to the zero-access `org:staff` base role.

**Coverage: Complete.** `AUTH.md`, `ROLES.md`, `PERMISSIONS.md`, `SESSIONS.md`, `IMPERSONATION.md`, and `CLERK.md` cover the layer end to end.

---

## Layer 5 — Hosting / Deployment

**Implementation.** Vercel hosts the web application with branch-to-environment mapping (`feature/*` preview, `integration` staging, `main` production). Supabase hosts the database per environment and per country. For countries mandating local data hosting, the self-hosted path substitutes Supabase self-hosted, MinIO, BullMQ, and Keycloak.

**Coverage: Complete.** `VERCEL.md` covers the managed path. `DEPLOYMENT_TOPOLOGY.md` covers the three-tier model and how each country is selected into a tier. `HOSTING_STRATEGY.md` covers the decision process.

---

## Layer 6 — Cloud / Compute

**Implementation.** Compute is spread across Vercel serverless functions, Supabase Edge Functions (50-second ceiling), and Railway persistent workers for BullMQ queue processing. No always-on application servers exist in the managed deployment.

**Coverage: Complete.** `COST_MANAGEMENT.md` owns this layer — billing alerts, per-service cost attribution, expensive-pattern audits, and the cost-per-school unit economics that determine whether tier pricing is sustainable.

---

## Layer 7 — CI-CD / Version Control

**Implementation.** GitHub hosts `AfriTechSystems/zsms-monorepo`. The two-branch workflow is `feature/*` → `integration` → `main`, with direct push to `main` blocked by branch protection. Vercel builds a preview deployment per pull request. Commit and branch naming conventions are fixed in `CONVENTIONS.md`.

**Coverage: Thin.** Version control conventions are fully specified, but the continuous integration pipeline is not. There is no document specifying which checks run on a pull request, whether migrations are validated before merge, whether pgTAP RLS tests run automatically, what blocks a merge, or how secrets reach GitHub Actions.

**Recommendation.** Author `CI_CD.md` in Phase 0 alongside the first GitHub Actions workflow. The specific risk this gap creates: `CONVENTIONS.md` prohibition #10 states a migration is never applied to production without first being applied to integration and verified — but nothing currently automates that check, so it depends on discipline alone. This should be closed before the first production migration, not before launch.

---

## Layer 8 — Security / RLS

**Implementation.** PostgreSQL Row Level Security is the primary tenant isolation mechanism — every `public` table carries `school_id` and every policy filters through `get_school_id()` reading Clerk JWT claims. Cloudflare WAF sits in front of Vercel with the origin restricted to Cloudflare IPs to prevent bypass. Sensitive fields are encrypted at the application layer with `GATEWAY_ENCRYPTION_KEY` and `FIELD_ENCRYPTION_KEY`.

**Coverage: Complete.** `RLS.md` specifies every policy. `SECURITY_POLICIES.md` provides the SOC 2 policy framework. `CLOUDFLARE_WAF.md` covers the edge. `SECURITY_AUDIT.md` verifies the whole layer pre-launch.

---

## Layer 9 — Rate Limiting

**Implementation.** Rate limiting operates at four scopes: per IP for public routes (Cloudflare Worker, at the edge, before Vercel is billed), per user session for authenticated routes (Upstash Redis), per API key for external integrations, and per school for WhatsApp message quotas.

**Coverage: Complete.** `RATE_LIMITS.md` owns the application tiers, `CLOUDFLARE_WAF.md` the edge tier.

---

## Layer 10 — Caching / CDN

**Implementation.** Upstash Redis caches feature access resolution, tier feature matrices, and school records. Cloudflare CDN caches static assets and public pages. Next.js ISR revalidates the public pricing page every 300 seconds.

**Coverage: Complete.** `CACHING_CDN.md` owns cache key naming, TTL policy, and — most importantly — the invalidation rules that keep a database-driven pricing system from serving stale prices.

---

## Layer 11 — Load Balancing / Scaling

**Implementation.** Vercel auto-scales serverless functions with no configuration. Supabase connection pooling (Supavisor, transaction mode) prevents connection exhaustion under serverless fan-out. Railway workers scale horizontally by replica count. Read replicas are a Phase 3 capability, not a launch requirement.

**Coverage: Complete.** `SCALING.md` owns scaling limits, pooling configuration, and the load targets that `LOAD_TESTING.md` verifies.

---

## Layer 12 — Error Tracking / Logs

**Implementation.** Sentry captures errors across web, mobile, and Edge Functions with source maps uploaded at build. PostHog captures product analytics events. `public.audit_logs` is the append-only application audit trail with no delete policy for any role. `integration_log` records outbound integration dispatch outcomes. `message_log` is the append-only record of every outbound message.

**Coverage: Adequate.** The layer is well served by `SENTRY.md`, `POSTHOG.md`, `AUDIT.md`, and `MESSAGE_LOG.md` between them. No dedicated observability document is warranted at current scale.

**Watch item.** There is no centralised log aggregation — Sentry, Supabase logs, Vercel logs, Railway logs, and Cloudflare logs are five separate panes of glass. This is acceptable for a solo developer at pilot scale and becomes painful somewhere past twenty schools. Revisit when the support burden justifies it, not before.

---

## Layer 13 — Availability / Recovery

**Implementation.** Railway PostgreSQL runs as a hot standby replica with automatic failover targeted within 60 seconds. Supabase provides automated backups with point-in-time recovery. Uptime monitoring alerts on external probe failure.

**Coverage: Complete.** `AVAILABILITY.md` owns uptime targets, backup verification (the discipline of proving a backup restores, not merely that it ran), and consolidated recovery runbooks.

---

## Using This Document

**When adding new infrastructure.** Identify which layer the component belongs to. If that layer has an owning document, update it. If the component does not fit any layer, that is a signal to question whether it belongs in the architecture at all.

**At launch gates.** `LAUNCH_CHECKLIST.md` references this document. No layer may be at **Gap** verdict at the January 2027 commercial launch. **Thin** is acceptable at pilot with a named remediation owner.

**During audits.** SOC 2 and ZICTA both ask for an asset and control inventory. This table is the architectural half of that answer.

---

## Business Rules

1. Every new infrastructure component must be assigned to exactly one of the thirteen layers before it is adopted. Components that fit no layer require an ADR justifying the architecture extension.
2. A layer at **Gap** verdict blocks the January 2027 commercial launch. A layer at **Thin** verdict does not block the September 2026 pilot but must carry a named owner and target date.
3. This document is re-audited at each phase boundary defined in `BUILD_SEQUENCE.md`. Verdicts are revised up or down honestly — a layer that regresses is marked down.
4. Layers 5 and 6 vary by deployment tier. A self-hosted country deployment satisfies these layers differently, and the substitutions are specified in `DEPLOYMENT_TOPOLOGY.md` rather than duplicated here.

---

## Edge Cases and Error Handling

**A component spanning multiple layers.** Cloudflare spans layers 8 (WAF), 9 (edge rate limiting), and 10 (CDN). Assign the component to the layer whose failure would be most severe — Cloudflare is assigned to layer 8 for ownership purposes and referenced from the others.

**Self-hosted deployments.** A country running self-hosted satisfies layers 5, 6, 10, 11, and 13 with different technology (local VPS, MinIO, local Redis, no Vercel auto-scale). The layer is still satisfied; the implementation differs. Country partners are responsible for layers 5, 6, 11, and 13 in their deployment, and AfriTech remains responsible for 1, 2, 3, 4, 7, 8, 9, and 12 through the software it ships.

---

## Integration Points

- `BUILD_SEQUENCE.md` — each phase gate re-audits this table
- `LAUNCH_CHECKLIST.md` — the go/no-go gate references layer verdicts
- `SECURITY_AUDIT.md` — verifies layers 4, 8, and 9 in depth
- `COMPLIANCE.md` — the SOC 2 asset inventory draws on this layer map

---

## Security Considerations

This document is an architectural inventory and contains no credentials, endpoints, or exploitable configuration detail. It is safe to share with auditors and prospective enterprise customers, and doing so is often faster than answering a security questionnaire field by field.

---

## Known Limitations and Future Work

- Layer 1 (Frontend) needs `FRONTEND.md` before substantial UI work begins.
- Layer 7 (CI-CD) needs `CI_CD.md` before the first production migration.
- Layer 12 has no centralised log aggregation; five separate consoles is a known friction point past roughly twenty schools.
- The model treats layers as independent, which they are not — a caching failure (10) presents as an availability incident (13). Cross-layer failure modes are not mapped and would be a useful addition once real incident data exists.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-08-13 | Initial complete draft | Architectural completeness audit — thirteen-layer model adopted in ADR-030 |
| 2026-08-13 | Flagged layers 1 and 7 as Thin with remediation targets | Honest coverage assessment — frontend architecture and CI pipeline undocumented |
| 2026-08-14 | Layer 1 framework updated to Next.js 15 | ADR-036 — the 14.x line no longer receives security backports |
