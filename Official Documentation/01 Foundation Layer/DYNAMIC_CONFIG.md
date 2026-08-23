# DYNAMIC_CONFIG.md — Dynamic Configuration Registry

## Related Documents

- `17 Integration and Pricing/PRICING.md` — the pricing subset of this registry, in full detail
- `01 Foundation Layer/DATABASE.md` — `afritech` schema table definitions
- `03 Infrastructure Services/CACHING_CDN.md` — Redis cache configuration and invalidation
- `15 Super Admin and Platform/SUPERADMIN.md` — the admin panel that edits these values
- `01 Foundation Layer/DECISIONS.md` — ADR-031 records the dynamic-config-everything principle
- `04 Country and Configuration/ZM.md` — country config, the one deliberate exception
- `09 Fee and Financial Management/AUDIT.md` — every config change is audited

---

## Purpose

This document is the master registry of every operational parameter in ZSMS that must be administrator-controlled and must never be hardcoded. It defines what is configurable, which `afritech` table holds it, how it is resolved at runtime, how it is cached, and how the cache is invalidated. Every Claude Code session that is about to write a numeric constant, threshold, price, weight, or duration into application code must check this document first — if the value appears here, it belongs in the database.

---

## Overview

ZSMS is a product sold across multiple countries, tiers, and school types, operated by a small team that cannot afford a code deployment every time a price moves or a threshold proves wrong. The operating principle, recorded as ADR-031, is blunt:

> **If a business person might reasonably want to change it, it lives in the database and a super admin can change it without a deployment.**

This is not a preference for flexibility in the abstract. It is a response to three specific costs. A hardcoded price means a deployment to change a price — and deployments carry risk, take time, and require the one person who can do them. A hardcoded threshold means the threshold is never tuned, because tuning it is too expensive to bother with. And a hardcoded country assumption means the second country is a rewrite rather than a configuration file.

The inverse principle matters just as much. **Things that are not business decisions do not belong in this registry.** Resolution order in `schoolHasFeature()` is fixed logic, not configuration. The RLS policy structure is a security invariant, not a toggle. Making genuine invariants configurable creates the illusion of flexibility while multiplying the ways the system can be misconfigured into an unsafe state.

---

## The Configuration Registry

Every row below is a parameter that must be database-backed. The **Owner** column names the role permitted to change it.

### Pricing and Commercial

| Parameter | Storage | Owner | Default | Notes |
|---|---|---|---|---|
| Tier monthly price (ZMW/USD) | `afritech.subscription_tiers` | `super_admin` | K600 / K1,100 / K2,000 / K3,000 | Per tier, both currencies |
| Tier annual price | `afritech.subscription_tiers` | `super_admin` | Derived | Calculated from monthly + discount |
| Annual discount percentage | `afritech.subscription_tiers` | `super_admin` | 10.00 | Drives annual price calculation |
| Student limit per tier | `afritech.subscription_tiers` | `super_admin` | 200 / 500 / 1,000 / NULL | NULL = unlimited. Editable from Admin → Pricing. Resolved by `public.school_student_limit()`, enforced by a trigger on `students` (migration `0101`) |
| Student limit for one school | `afritech.school_feature_overrides` | `super_admin` | None | `override_type = 'student_limit_override'`, value a whole number or `'unlimited'`. Beats the tier. Carries a reason, an actor, and an optional expiry like every other override |
| WhatsApp quota per tier | `afritech.subscription_tiers` | `super_admin` | 500 / 1,500 / 4,000 / unlimited | Monthly messages included |
| Per-feature add-on price | `afritech.feature_flags` | `super_admin` | Per feature | e.g. timetable K100, loan_module K275 |
| Feature-to-tier inclusion matrix | `afritech.tier_features` | `super_admin` | Per ADR-014 | The toggle grid |
| Per-school overrides | `afritech.school_feature_overrides` | `super_admin` | None | Grant, revoke, extend, tier override, student limit override |
| Promotional / discount codes | `afritech.promo_codes` | `super_admin` | None | Percentage or fixed, expiry, usage cap |
| Standalone teacher subscription price | `afritech.platform_products` | `super_admin` | K300/mo, K3,000/yr | Teacher Hub B2C pricing |
| Standalone teacher free-trial plan count | `afritech.platform_products` | `super_admin` | 5 | Free lesson plans before paywall |
| Loan origination commission rate | `afritech.commission_rates` | `super_admin` + `finance_officer` | Per lender | Per lender, per product type |

### Trials and Subscriptions

| Parameter | Storage | Owner | Default | Notes |
|---|---|---|---|---|
| School trial length (days) | `afritech.platform_settings` | `super_admin` | 30 | Applied at school creation |
| Trial notification schedule | `afritech.platform_settings` | `super_admin` | Day 7, 14, 25, 29 | Days before expiry to warn |
| Grace period after expiry (days) | `afritech.platform_settings` | `super_admin` | 7 | Read-only access window |

### Financial and Regional

| Parameter | Storage | Owner | Default | Notes |
|---|---|---|---|---|
| ZMW/USD exchange rate | `afritech.exchange_rates` | `super_admin` + `finance_officer` | 27.50 | Manually updated; see limitations |
| Currency code and symbol | `packages/config/countries/` | Developer (code) | ZMW / K | Country config — deliberate exception |
| Tax / VAT rate | `afritech.tax_rates` | `super_admin` + `finance_officer` | Per country | Effective-dated; invoices use rate at issue |
| Tax registration number | `afritech.platform_settings` | `super_admin` | — | Appears on invoices |
| Enabled payment gateways per country | `afritech.platform_settings` | `super_admin` | Per `ZM.md` | Which gateways schools may select |

### Academic

| Parameter | Storage | Owner | Default | Notes |
|---|---|---|---|---|
| Grading scale definitions | `public.school_grading_scales` | `org:owner`, `org:principal` | Per country reference | School-scoped, seeded from country config |
| Grade boundaries | `public.school_grading_scales` | `org:owner`, `org:principal` | Per scale | Cambridge boundaries shift annually |
| Pass / credit / distinction marks | `public.school_grading_scales` | `org:owner`, `org:principal` | 40 / 50 / 80 (ECZ) | Per scale |
| Term structure and dates | `public.school_academic_config` | `org:owner`, `org:principal` | 3 terms, Jan–Dec | Schools set actual dates |
| Grade level structure | `public.school_grade_levels` | `org:owner` | Per onboarding option | ECZ, new curriculum, or hybrid |

### Loans and Scoring

| Parameter | Storage | Owner | Default | Notes |
|---|---|---|---|---|
| Behaviour score category weights | `afritech.score_config` | `super_admin` | 35 / 25 / 20 / 20 | History, capacity, behaviour, risk |
| Behaviour score band thresholds | `afritech.score_config` | `super_admin` | Per `BEHAVIOUR_SCORE.md` | Band boundaries on the 300–850 scale |
| Behaviour score factor definitions | `afritech.score_config` | `super_admin` | Per document | Sub-factor weights within categories |
| Loan product parameters | `public.loan_products` | `super_admin` + `loan_officer` | Per lender | Min/max amount, term, rate, eligibility |
| Lender routing rules | `public.lenders` | `super_admin` + `loan_officer` | Per lender | Which applications reach which lender |

### AI and Analytics

| Parameter | Storage | Owner | Default | Notes |
|---|---|---|---|---|
| Data completeness gate thresholds | `afritech.platform_settings` | `super_admin` | 70 full / 50 limited | Below 50 locks AI insights |
| Completeness component weights | `afritech.platform_settings` | `super_admin` | 40 / 40 / 20 | Attendance, marks, parent links |
| Early warning rule thresholds | `afritech.platform_settings` | `super_admin` | Per `ANALYTICS_INTELLIGENCE.md` | Attendance drop %, mark decline, etc. |
| AI interaction daily rate limit | `afritech.platform_settings` | `super_admin` | 100/school/day | Cost control on System 2 |
| RAG similarity threshold | `afritech.platform_settings` | `super_admin` | 0.70 | See ADR-028 — raise, never lower |

#### AI-Assisted Capture credits (planned — ADR-039, `AI_CAPTURE.md`)

Not yet implemented. Recorded here so the module is built against configuration from the first commit rather than retrofitted. Each capture is a real vision-API call, so **every value below is a commercial lever that must be changeable without a deployment.**

| Parameter | Storage | Owner | Default | Notes |
|---|---|---|---|---|
| Capture free-trial allowance | `afritech.platform_settings` | `super_admin` | TBD after pilot | Per school and per individual account. Lets anyone evaluate before paying |
| Credit cost per capture — marks | `afritech.platform_settings` | `super_admin` | TBD | A dense mark sheet costs more to process than a payment slip |
| Credit cost per capture — attendance | `afritech.platform_settings` | `super_admin` | TBD | |
| Credit cost per capture — student import | `afritech.platform_settings` | `super_admin` | TBD | |
| Credit cost per capture — payment proof | `afritech.platform_settings` | `super_admin` | TBD | Cheapest — few fields |
| Credit pack prices (ZMW / USD) | `afritech.platform_products` | `super_admin` | TBD | School and individual purchase |
| Individual purchase enabled | `afritech.feature_flags` | `super_admin` | TBD | Lets a teacher buy their own credits independently of their school |
| Per-capture-type enablement | `afritech.school_feature_overrides` | `super_admin` | — | A school may buy all capture types or a subset |
| Match confidence floor | `afritech.platform_settings` | `super_admin` | Start conservative | Below this, a name is reported unmatched rather than assigned. Raise, never lower — see ADR-039 |

**Pricing must not be fixed before a pilot against real Zambian mark sheets.** The credit price depends on the retry rate, which is unknown until measured on genuine paper.

### Platform Operations

| Parameter | Storage | Owner | Default | Notes |
|---|---|---|---|---|
| Session duration per role | `afritech.platform_settings` | `super_admin` | 30 days all roles | Ceiling is a policy invariant — see below |
| Rate limits per scope | `afritech.rate_limit_config` | `super_admin` | Per `RATE_LIMITS.md` | Per IP, session, API key, school |
| Notification template content | `public.notification_templates` | `super_admin`, `org:owner` | Seeded | Per channel, per country, per language |
| Notification send times | `afritech.platform_settings` | `super_admin` | 06:00 local | Fee reminders, summaries, digests |
| Fee reminder escalation days | `afritech.platform_settings` | `super_admin` | 7 / 14 / 30 | Days past due for each escalation |
| School health score weights | `afritech.platform_settings` | `super_admin` | Per `SCHOOL_HEALTH_SCORES.md` | Operational, financial, engagement |

### School Branding

The one registry section that is **school-scoped rather than platform-scoped**: a school changes these itself, and only for itself. Full treatment in `DESIGN_SYSTEM.md`; ADR-043 records why the list is this short.

| Parameter | Storage | Owner | Default | Notes |
|---|---|---|---|---|
| Anchor colour | `public.school_branding.anchor_color` | `org:owner`, `org:principal`, `org:admin` | ZSMS navy `#1E2A3F` | Ink — body text, headings, navigation. **Must reach 4.5:1 against the page ground `#F1F3FA`** — CHECK constraint, not a warning |
| Primary colour | `public.school_branding.primary_color` | `org:owner`, `org:principal`, `org:admin` | ZSMS blue `#3A8DDE` | Buttons, links, active states. **Must reach 3:1 against the page ground** — CHECK constraint |
| Full logo | `public.school_branding.logo_url` | `org:owner`, `org:principal`, `org:admin` | School initials | R2 public bucket, HTTPS enforced |
| Icon / favicon | `public.school_branding.icon_url` | `org:owner`, `org:principal`, `org:admin` | School initials | Square variant |

Three properties distinguish this section from the rest of the registry:

- **The theme is not cached in Redis.** It is resolved per request and emitted into the first HTML response. A cached theme would need invalidating on the same request path that renders it, and the query is a single row on a primary key.
- **It propagates beyond the web UI** — parent login screen, PDFs, and emails all resolve from this row. See `DESIGN_SYSTEM.md` → *Where the theme propagates*.
- **The AfriTech admin dashboard ignores it entirely** and is always ZSMS-branded (ADR-043).

**Not configurable within theming:** layout, navigation structure, typography, spacing, and the semantic colour mapping (green = paid, amber = due soon, coral = overdue). These are listed in *What Is Deliberately Not Configurable* below.

---

## What Is Deliberately Not Configurable

Making these configurable would create the ability to misconfigure the system into an unsafe or incoherent state. They are invariants, and changing them requires a code change and an ADR.

| Invariant | Why it stays fixed |
|---|---|
| Feature access resolution order | Revoke → grant → tier override → module subscription → tier matrix. A configurable order means a support agent can accidentally make a revoke lose to a grant. |
| RLS policy structure | Tenant isolation is a security boundary, not a business rule. |
| Session duration **ceiling** (30 days) | The value is stored in config so it can be lowered, but it may never be raised above 30 days. `SESSIONS.md` and SOC 2 CC6.1 both depend on that ceiling. Validation enforces it. |
| Soft-delete-only on financial and academic records | Regulatory retention requirement, not a preference. |
| Currency decimal precision | `NUMERIC(12,2)` is a schema decision; changing it is a migration. |
| Country configuration files | `packages/config/countries/*.ts` stays in code. Adding a country is a deliberate, reviewed, tested event — not a form submission. See `ADDING_COUNTRY.md`. |
| Behaviour score prohibited inputs | ADR-020 forbids gender, ethnicity, religion, and location as score inputs. Not configurable at any level. |
| Layout, navigation structure, typography, spacing | A school themes colours and a logo. Structure is what makes the product learnable by staff who move between schools and supportable by one team. ADR-043. |
| The semantic colour mapping | Green = paid, amber = due soon, coral = overdue, everywhere. A school that set "overdue" to green would be creating a misreading of money, not expressing a brand. ADR-043. |
| The WCAG AA minimum on a school palette | Enforced by CHECK constraint and refused at write time. There is no override, because the person who would exercise it is never the person who pays for it. ADR-043. |
| The AfriTech admin dashboard's theme | Always ZSMS. An operator working across forty schools, and impersonating inside them, needs one constant frame. ADR-043. |

---

## Resolution Pattern

All dynamic configuration resolves through a single accessor pattern. Application code never queries `afritech` tables directly.

```typescript
// packages/utils/config.ts

export async function getConfig<T>(
  key: string,
  scope: ConfigScope = { type: 'platform' }
): Promise<T> {
  const cacheKey = buildCacheKey(key, scope)

  // 1. Redis — the common path
  const cached = await redis.get(cacheKey)
  if (cached !== null) return JSON.parse(cached) as T

  // 2. Resolve from database in scope precedence order
  const value = await resolveFromDatabase<T>(key, scope)

  // 3. Cache with the TTL band for this key
  await redis.set(cacheKey, JSON.stringify(value), { ex: ttlFor(key) })

  return value
}
```

### Scope precedence

Configuration resolves from the most specific scope to the least. The first scope that provides a value wins.

```
School override        (afritech.school_feature_overrides, public.school_* tables)
        ↓ not set
Country default        (afritech.platform_settings WHERE country_code = 'ZM')
        ↓ not set
Platform default       (afritech.platform_settings WHERE country_code IS NULL)
        ↓ not set
Code fallback constant (last resort — logged as a warning)
```

The code fallback exists so that a missing configuration row degrades to a sane default rather than a 500 error. **Every fallback hit is logged at warning level to Sentry** — a fallback firing in production means a seed row is missing, and silence would hide that indefinitely.

### Feature access is a specialisation of this pattern

`schoolHasFeature()` documented in `PRICING.md` is the feature-flag specialisation of `getConfig()`. It exists separately because its resolution order includes revoke/grant semantics that generic config does not. Do not reimplement it.

---

## Caching Strategy

Configuration is read on nearly every authenticated request. Uncached, this would add three to four database round trips per request.

| Cache band | TTL | Applies to |
|---|---|---|
| Structural | 3,600s (1h) | Tier feature matrix, grading scales, term structure, score weights |
| Operational | 300s (5m) | School overrides, module subscriptions, rate limits, thresholds |
| Volatile | 60s | Exchange rates, promotional code validity |
| Never cached | — | Data completeness score (gating decision — always computed fresh) |

**Cache key naming.** `config:{scope_type}:{scope_id}:{key}` — for example `config:school:uuid-here:trial_length_days` or `config:platform:global:score_weights`. Full conventions in `CACHING_CDN.md`.

### Invalidation

Stale configuration in a database-driven pricing system means charging the wrong price. Invalidation is not optional and is not left to TTL expiry.

**Every write to a configuration table must invalidate its cache keys in the same request handler, immediately after the write succeeds and before the response is returned.**

| Write target | Keys invalidated |
|---|---|
| `afritech.subscription_tiers` | `config:platform:*:tier:*`, `tier_features:{tier}` |
| `afritech.tier_features` | `tier_features:{tier_name}` |
| `afritech.feature_flags` | `config:platform:global:features`, all `tier_features:*` |
| `afritech.school_feature_overrides` | `school_overrides:{school_id}`, `module_subs:{school_id}` |
| `afritech.platform_settings` | `config:platform:*:{key}`, `config:country:*:{key}` |
| `afritech.score_config` | `config:platform:global:score_*` |
| `public.school_grading_scales` | `config:school:{school_id}:grading_*` |
| `schools.subscription_tier` | `school:{school_id}`, `school_overrides:{school_id}` |

Wildcard invalidation uses Redis `SCAN` with pattern matching rather than `KEYS`, which blocks the server.

---

## Admin Panel Surface

All configuration in this registry is editable from **AfriTech Admin → Settings**, organised to match the registry sections above. School-scoped configuration (grading scales, term structure, notification templates) is editable by the school from **School Settings** at the permission level named in the Owner column.

Every configuration screen enforces the same four rules:

1. **Mandatory reason** on any change to a commercial or scoring parameter.
2. **Old and new values** written to `public.audit_logs`.
3. **Impact warning** when a change affects schools currently relying on the value — for example, removing a feature from a tier, or lowering a student limit below a school's current enrolment.
4. **Validation against invariants** — a session duration above 30 days, a completeness threshold above 100, or negative score weights are rejected at the API layer regardless of what the form submits.

---

## Business Rules

1. No price, threshold, weight, quota, duration, or rate listed in this registry may be hardcoded in application code. A literal matching a registry entry is a defect.
2. Every configuration table write invalidates its cache keys in the same request handler. TTL expiry is a safety net, never the invalidation mechanism.
3. Every change to a commercial or scoring parameter requires a mandatory reason and is written to `public.audit_logs` with old and new values.
4. Code fallback constants exist for every registry key so a missing row degrades gracefully. Every fallback hit logs a warning to Sentry.
5. Configuration values are validated against invariants at the API layer. Session duration may be lowered but never raised above 30 days; weights must sum to 100 where they represent a composite; thresholds must fall within their documented range.
6. Adding a new configurable parameter requires adding a row to this registry in the same change. A configuration key that is not registered here is undiscoverable and will be re-hardcoded by the next session.
7. The data completeness score is never served from cache when used for a gating decision. It is computed fresh on every AI feature page load, per ADR-029.
8. Country configuration files remain in code. Countries are added through `ADDING_COUNTRY.md`, not through the admin panel.

---

## Edge Cases and Error Handling

**Redis unavailable.** `getConfig()` falls through to the database on cache read failure and serves the request. Cache write failure is logged and swallowed — a caching outage degrades latency, never correctness. It must never produce a 500.

**Configuration row missing.** The code fallback constant is returned and a warning is sent to Sentry naming the missing key and scope. The request succeeds.

**Concurrent edits by two super admins.** Last write wins, and both writes appear in `audit_logs` with their reasons. The admin panel shows a warning if the underlying row changed after the form was loaded.

**Price changed mid-billing-cycle.** Per `PRICING.md`, price changes default to taking effect at the next billing cycle. Applying immediately is an explicit choice the admin must make.

**Weights that no longer sum to 100.** Rejected at the API layer before the write. A partially updated weight set would silently distort every behaviour score or completeness calculation that followed.

**Exchange rate stale.** The rate is manually maintained. If `updated_at` exceeds 30 days the admin dashboard shows a staleness warning. USD figures are secondary display only — no billing decision depends on a live rate.

---

## Integration Points

- `PRICING.md` — the pricing subset in full operational detail, including the admin panel tabs
- `CACHING_CDN.md` — Redis configuration, key conventions, invalidation mechanics
- `SUPERADMIN.md` — admin panel structure and per-role edit permissions
- `AUDIT.md` — the audit trail every configuration change writes to
- `BEHAVIOUR_SCORE.md`, `AI_DATA_REQUIREMENTS.md`, `SCHOOL_HEALTH_SCORES.md` — consumers of scoring and threshold configuration
- `RATE_LIMITS.md` — consumer of rate limit configuration
- `SESSIONS.md` — consumer of session duration, subject to the 30-day ceiling

---

## Security Considerations

Configuration tables in the `afritech` schema are writable only by `afritech:super_admin`, with the two exceptions named in the Owner column (`finance_officer` for exchange and tax rates, `loan_officer` for loan product parameters). No school-level role has write access to any `afritech` table under any permission grant.

Configuration reads are not tenant-scoped and must never carry tenant data. A configuration value is a price or a threshold — never a school name, a student record, or anything derived from one. Cache keys are namespaced by scope so a school-scoped value cannot collide with another school's.

The invariant validations described above are a security control, not a usability nicety. Without them, an admin panel bug or a compromised super admin session could extend sessions indefinitely or zero out a scoring safeguard.

---

## Known Limitations and Future Work

- The exchange rate is manually maintained. Fetching it from a public API on a schedule is a known improvement, noted also in `ZM.md`.
- There is no configuration versioning or point-in-time rollback. `audit_logs` records what changed and to what, but restoring a prior configuration set is a manual sequence of edits. A `config_snapshots` table would make rollback a single action.
- No staged or scheduled configuration changes. A price change takes effect on save (or next billing cycle); it cannot be scheduled for a future date and left to apply itself.
- ~~Promotional codes, tax rates, exchange rates, score config, and rate limit config are specified here but have no corresponding migration.~~ **Closed 2026-08-13.** All eight `afritech` tables this document specifies — `platform_settings`, `promo_codes`, `platform_products`, `commission_rates`, `exchange_rates`, `tax_rates`, `score_config`, `rate_limit_config` — are now defined as migrations `0061`–`0065` in `05 Core Database and API Reference/MIGRATIONS.md`, with full column definitions and the `afritech` deny-by-default RLS convention. They are **specified but not yet applied to any database**; application happens in Phase 0 of `BUILD_SEQUENCE.md`. Note the gap was three tables larger than originally recorded — `platform_settings`, `platform_products`, and `commission_rates` were also missing.
- No configuration diffing between environments. Detecting that staging and production have drifted apart requires manual comparison.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-08-13 | Initial complete draft | Dynamic-config-everything principle adopted in ADR-031 |
| 2026-08-13 | Registry sections defined across pricing, trials, financial, academic, loans, AI, and platform operations | Single discoverable list prevents re-hardcoding |
| 2026-08-13 | Documented deliberate non-configurables | Configurable security invariants are a liability, not a feature |
| 2026-08-13 | Flagged missing `afritech` tables for Phase 0 migrations | Registry specifies tables ahead of the schema — gap recorded rather than assumed |
| 2026-08-13 | **Migration gap closed** — all eight `afritech` tables now defined as migrations `0061`–`0065` | Registry is no longer ahead of the migration sequence; documentation only, not yet applied |
| 2026-08-13 | Gap scope corrected from five tables to eight | `platform_settings`, `platform_products`, and `commission_rates` were also absent from the sequence |
| 2026-08-16 | Added the **School Branding** registry section and four new non-configurables | Per-school theming (ADR-043) is school-scoped dynamic config; the registry had no theme, brand, or logo entry at all |
