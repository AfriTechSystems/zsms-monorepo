# PRICING.md — Dynamic Pricing and Subscription Management

## Related Documents

- `docs/modules/admin/SUPERADMIN.md` — admin panel where pricing is managed
- `docs/modules/school/SUBSCRIPTION.md` — school-facing subscription documentation
- `docs/modules/school/TRIAL.md` — trial model that overrides interact with
- `docs/DATABASE.md` — afritech.subscription_tiers, feature_flags, tier_features, school_feature_overrides
- `docs/infra/QSTASH.md` — override expiry cron job
- `docs/api/ERROR_CODES.md` — TRIAL_EXPIRED, SCHOOL_SUSPENDED, MODULE_NOT_SUBSCRIBED

---

## Purpose

This document defines the dynamic pricing system — how AfriTech super admins edit subscription tier prices, configure which features are included in each tier, create per-school access overrides, and extend subscriptions. Every Claude Code session building any feature access check, pricing display, or subscription management UI must read this document.

---

## Overview

ZSMS pricing is entirely database-driven. No tier prices, feature inclusions, or access rules are hardcoded in application code. AfriTech super admins can change a tier price, toggle a feature into or out of a tier, or grant a school access to any feature — all from the admin panel — without any code deployment.

This is the operational model: the database is the source of truth, Redis is the performance cache, and the application reads from cache.

---

## Database Schema

### `afritech.subscription_tiers`

The canonical pricing table. One row per tier. AfriTech super admins edit these rows.

```sql
CREATE TABLE afritech.subscription_tiers (
  tier_name           TEXT PRIMARY KEY,
  -- 'starter' | 'growth' | 'professional' | 'enterprise'
  display_name        TEXT NOT NULL,
  tagline             TEXT,
  -- E.g. "For schools up to 200 students"
  monthly_price_zmw   NUMERIC(10,2) NOT NULL,
  monthly_price_usd   NUMERIC(10,2) NOT NULL,
  annual_price_zmw    NUMERIC(10,2) NOT NULL,  -- Pre-calculated with discount
  annual_price_usd    NUMERIC(10,2) NOT NULL,
  annual_discount_pct NUMERIC(5,2) DEFAULT 10.00,
  -- Percentage discount for annual payment — default 10%
  student_limit       INT,
  -- NULL = unlimited
  whatsapp_quota      INT NOT NULL,
  -- Monthly WhatsApp messages included
  description         TEXT,
  -- Used on the public pricing page
  is_active           BOOLEAN DEFAULT TRUE,
  is_publicly_listed  BOOLEAN DEFAULT TRUE,
  -- FALSE for hidden enterprise tier (quote-based)
  display_order       INT NOT NULL,
  updated_by          TEXT NOT NULL,
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
```

### `afritech.feature_flags`

Every toggleable feature in ZSMS. Adding a new feature to ZSMS means adding a row here.

```sql
CREATE TABLE afritech.feature_flags (
  feature_key             TEXT PRIMARY KEY,
  display_name            TEXT NOT NULL,
  description             TEXT,
  category                TEXT NOT NULL
                          CHECK (category IN (
                            'core',          -- Always included, cannot be removed
                            'academic',      -- Timetable, results enhancements
                            'financial',     -- Loan module, advanced fee tools
                            'communication', -- Per-absence alerts, WhatsApp extras
                            'integration',   -- CRM, accounting connectors
                            'api',           -- External API access
                            'document',      -- Custom templates, branding
                            'analytics',     -- Advanced dashboards
                            'enterprise'     -- White label, dedicated support
                          )),
  monthly_addon_price_zmw NUMERIC(10,2),
  monthly_addon_price_usd NUMERIC(10,2),
  is_available_as_addon   BOOLEAN DEFAULT TRUE,
  is_active               BOOLEAN DEFAULT TRUE,
  display_order           INT,
  updated_by              TEXT NOT NULL,
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- Seed data — all feature flags
INSERT INTO afritech.feature_flags (feature_key, display_name, category, monthly_addon_price_zmw, is_available_as_addon, display_order, updated_by) VALUES
  ('timetable',           'Timetable Builder',          'academic',      100.00, TRUE,  1,  'system'),
  ('loan_module',         'Finance (Loan Referral)',     'financial',     275.00, TRUE,  2,  'system'),
  ('integrations',        'Accounting & CRM Connectors','integration',   200.00, TRUE,  3,  'system'),
  ('api_read',            'API Read Access',             'api',           138.00, TRUE,  4,  'system'),
  ('api_write',           'API Write Access',            'api',           275.00, TRUE,  5,  'system'),
  ('api_full',            'Full API Access',             'api',           550.00, TRUE,  6,  'system'),
  ('custom_template',     'Custom Document Template',   'document',      NULL,   FALSE, 7,  'system'),
  ('advanced_analytics',  'Advanced Analytics',          'analytics',     100.00, TRUE,  8,  'system'),
  ('per_absence_alerts',  'Per-Absence WhatsApp Alerts','communication', NULL,   FALSE, 9,  'system'),
  ('white_label',         'White Label Portal',          'enterprise',    300.00, TRUE,  10, 'system'),
  ('payroll',             'Payroll Module (Phase 3)',    'financial',     200.00, TRUE,  11, 'system'),
  ('inventory',           'Inventory Module (Phase 3)', 'financial',     150.00, TRUE,  12, 'system'),
  ('marketplace',         'Marketplace Access (Phase 3)','financial',    NULL,   FALSE, 13, 'system');
```

### `afritech.tier_features`

The feature matrix — which features are included in each tier. A super admin toggling a cell here immediately affects all schools on that tier.

```sql
CREATE TABLE afritech.tier_features (
  tier_name   TEXT NOT NULL,
  feature_key TEXT NOT NULL,
  is_included BOOLEAN DEFAULT TRUE,
  updated_by  TEXT NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (tier_name, feature_key)
);

-- Default feature matrix
INSERT INTO afritech.tier_features (tier_name, feature_key, is_included, updated_by) VALUES
  -- Starter (base features only)
  ('starter', 'timetable',          FALSE, 'system'),
  ('starter', 'loan_module',        FALSE, 'system'),
  ('starter', 'integrations',       FALSE, 'system'),
  ('starter', 'api_read',           FALSE, 'system'),
  ('starter', 'custom_template',    FALSE, 'system'),
  ('starter', 'advanced_analytics', FALSE, 'system'),
  ('starter', 'white_label',        FALSE, 'system'),
  ('starter', 'per_absence_alerts', TRUE,  'system'),

  -- Growth
  ('growth', 'timetable',           TRUE,  'system'),
  ('growth', 'loan_module',         FALSE, 'system'),
  ('growth', 'integrations',        FALSE, 'system'),
  ('growth', 'api_read',            TRUE,  'system'),
  ('growth', 'custom_template',     FALSE, 'system'),
  ('growth', 'advanced_analytics',  TRUE,  'system'),
  ('growth', 'white_label',         FALSE, 'system'),
  ('growth', 'per_absence_alerts',  TRUE,  'system'),

  -- Professional
  ('professional', 'timetable',           TRUE,  'system'),
  ('professional', 'loan_module',         TRUE,  'system'),
  ('professional', 'integrations',        TRUE,  'system'),
  ('professional', 'api_read',            TRUE,  'system'),
  ('professional', 'api_write',           TRUE,  'system'),
  ('professional', 'custom_template',     TRUE,  'system'),
  ('professional', 'advanced_analytics',  TRUE,  'system'),
  ('professional', 'white_label',         FALSE, 'system'),
  ('professional', 'per_absence_alerts',  TRUE,  'system'),

  -- Enterprise (everything)
  ('enterprise', 'timetable',           TRUE, 'system'),
  ('enterprise', 'loan_module',         TRUE, 'system'),
  ('enterprise', 'integrations',        TRUE, 'system'),
  ('enterprise', 'api_read',            TRUE, 'system'),
  ('enterprise', 'api_write',           TRUE, 'system'),
  ('enterprise', 'api_full',            TRUE, 'system'),
  ('enterprise', 'custom_template',     TRUE, 'system'),
  ('enterprise', 'advanced_analytics',  TRUE, 'system'),
  ('enterprise', 'white_label',         TRUE, 'system'),
  ('enterprise', 'per_absence_alerts',  TRUE, 'system');
```

### `afritech.school_feature_overrides`

Per-school access overrides. The super admin's tool for exceptions.

```sql
CREATE TABLE afritech.school_feature_overrides (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id       UUID NOT NULL REFERENCES public.schools(id),
  override_type   TEXT NOT NULL
                  CHECK (override_type IN (
                    'grant_feature',        -- Access to feature not in tier
                    'revoke_feature',       -- Remove feature even if in tier
                    'extend_subscription',  -- Keep access after billing lapses
                    'extend_trial',         -- More time on trial
                    'tier_override'         -- Treat school as a different tier
                  )),
  feature_key     TEXT,
  -- Required for grant_feature and revoke_feature
  -- NULL for subscription, trial, and tier overrides
  override_value  TEXT,
  -- For tier_override: 'professional' | 'enterprise' etc.
  -- For extend_subscription / extend_trial: ISO date string for new expiry
  -- For grant/revoke: NULL (the override_type is self-descriptive)
  expires_at      TIMESTAMPTZ,
  -- NULL = permanent until manually revoked
  reason          TEXT NOT NULL,
  ticket_ref      TEXT,
  granted_by      TEXT NOT NULL,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  revoked_at      TIMESTAMPTZ,
  revoked_by      TEXT
);

CREATE INDEX idx_overrides_school_active
  ON afritech.school_feature_overrides(school_id, is_active)
  WHERE is_active = TRUE;

CREATE INDEX idx_overrides_expiry
  ON afritech.school_feature_overrides(expires_at)
  WHERE is_active = TRUE AND expires_at IS NOT NULL;
```

---

## Feature Access Resolution

The `schoolHasFeature()` function is called by every API route and Edge Function that gates behind a feature flag. It resolves access in strict priority order.

```typescript
// packages/utils/featureAccess.ts

export async function schoolHasFeature(
  schoolId: string,
  featureKey: string,
  skipCache = false
): Promise<boolean> {

  // 1. Get school record
  const school = await getSchoolFromCache(schoolId)

  // 2. Check subscription status — is the school eligible for any feature?
  const baseEligible = await isSchoolSubscriptionActive(school, schoolId)
  if (!baseEligible) return false

  // 3. Check REVOKE override (super admin removed this feature)
  const revokeOverride = await getActiveOverride(
    schoolId, 'revoke_feature', featureKey
  )
  if (revokeOverride) return false

  // 4. Check GRANT override (super admin gave this feature)
  const grantOverride = await getActiveOverride(
    schoolId, 'grant_feature', featureKey
  )
  if (grantOverride) return true

  // 5. Check tier override (school treated as different tier)
  const tierOverride = await getActiveOverride(schoolId, 'tier_override')
  const effectiveTier = tierOverride?.override_value ?? school.subscription_tier

  // 6. Check module subscription (school purchased this as add-on)
  const cacheKey = `module_subs:${schoolId}`
  const moduleSubscriptions = await getCachedOrFetch(cacheKey, () =>
    getActiveModuleSubscriptions(schoolId)
  )
  if (moduleSubscriptions.includes(featureKey)) return true

  // 7. Check tier features matrix (from cache — not live DB query on every call)
  const cacheKey2 = `tier_features:${effectiveTier}`
  const tierFeatures = await getCachedOrFetch(cacheKey2, () =>
    getTierFeatures(effectiveTier),
    { ttl: 3600 }  // Cache tier features for 1 hour
  )
  return tierFeatures[featureKey]?.is_included === true
}

async function isSchoolSubscriptionActive(
  school: School,
  schoolId: string
): Promise<boolean> {
  // Active or trial with time remaining
  if (school.status === 'active') return true
  if (school.status === 'trial' && new Date(school.trial_ends_at) > new Date()) return true

  // Check for subscription extension override
  const extensionOverride = await getActiveOverride(schoolId, 'extend_subscription')
  if (extensionOverride) {
    const newExpiry = new Date(extensionOverride.override_value)
    return newExpiry > new Date()
  }

  // Check for trial extension
  const trialExtension = await getActiveOverride(schoolId, 'extend_trial')
  if (trialExtension && school.status === 'trial') {
    const newExpiry = new Date(trialExtension.override_value)
    return newExpiry > new Date()
  }

  return false
}
```

---

## Cache Strategy

Feature access checks happen on every authenticated API request. Without caching this would be 3-4 database queries per request — unacceptable latency.

```typescript
// Cache TTLs:
const CACHE_TTL = {
  tierFeatures:       3600,  // 1 hour — changes infrequently
  schoolOverrides:     300,  // 5 minutes — changes occasionally
  moduleSubscriptions: 300,  // 5 minutes
}

// Cache invalidation triggers:
// 1. Any write to afritech.tier_features:
//    → DELETE cache key 'tier_features:{tier_name}'
// 2. Any write to afritech.school_feature_overrides:
//    → DELETE cache key 'school_overrides:{school_id}'
//    → DELETE cache key 'module_subs:{school_id}'
// 3. Any change to schools.subscription_tier:
//    → DELETE cache key 'school:{school_id}'

// Invalidation is triggered by the API route or Edge Function
// immediately after any write to these tables
```

---

## Pricing Admin Panel

**Location:** AfriTech Admin → Settings → Pricing

Only accessible to `afritech:super_admin`.

### Tab 1 — Subscription Tiers

Displays all tiers with inline editing:

```
Tier          Monthly (ZMW)  Monthly (USD)  Annual (ZMW)  Students  WhatsApp  Actions
──────────────────────────────────────────────────────────────────────────────────────
Starter       K600           $22            K6,480        200       500       [Edit]
Growth        K1,100         $40            K11,880       500       1,500     [Edit]
Professional  K2,000         $73            K21,600       1,000     4,000     [Edit]
Enterprise    K3,000         $109           K32,400       ∞         ∞         [Edit]
```

When clicking Edit:
```
Edit: Growth Tier
Monthly price (ZMW): [K1,100]
Monthly price (USD): [$40]
Annual discount: [10]%
Annual price (ZMW): [K11,880] ← auto-calculated
Student limit: [500]
WhatsApp quota: [1,500]

Price change applies to:
○ All existing schools immediately
● Existing schools at next billing cycle (recommended)
● New schools immediately, existing at next cycle

[Save changes]  ← writes to afritech.subscription_tiers, invalidates cache
```

Every price change is logged in `public.audit_logs` with old and new values.

### Tab 2 — Feature Matrix

A visual toggle grid:

```
Feature                       Starter  Growth  Professional  Enterprise  Add-on
────────────────────────────────────────────────────────────────────────────────
Timetable Builder             [☐]      [✅]     [✅]          [✅]        K100/mo
Loan Module                   [☐]      [☐]      [✅]          [✅]        K275/mo
Integrations                  [☐]      [☐]      [✅]          [✅]        K200/mo
API Read Access               [☐]      [✅]     [✅]          [✅]        K138/mo
API Write Access              [☐]      [☐]      [✅]          [✅]        K275/mo
Custom Document Template      [☐]      [☐]      [✅]          [✅]        —
Advanced Analytics            [☐]      [✅]     [✅]          [✅]        K100/mo
Per-Absence WhatsApp Alerts   [✅]     [✅]     [✅]          [✅]        —
White Label Portal            [☐]      [☐]      [☐]          [✅]        K300/mo
Payroll (Phase 3)             [☐]      [☐]      [☐]          [☐]        K200/mo
```

Each toggle click immediately updates `afritech.tier_features` and invalidates the cache for that tier.

**Warning shown before toggling a feature OUT of a tier that currently has schools:**
```
⚠️ 47 schools on the Growth tier currently use Timetable Builder.
   Removing this feature will break access for those schools immediately.
   
   Recommended: Keep this change for new schools only, and grandfather
   existing Growth schools with an individual override.
   
   [Remove immediately]   [Cancel]
```

### Tab 3 — School Overrides

A searchable list of all active overrides across all schools with the ability to add new ones:

```
[+ Add Override]

Search overrides: [search field]

Active Overrides (12 total):
School                    Override Type         Feature/Value              Expires      Granted By
──────────────────────────────────────────────────────────────────────────────────────────────────
Sunrise Academy           Tier Override         Professional               Dec 31 2026  Mwando
Rainbow Academy           Extend Subscription   Until Oct 31 2026          Oct 31 2026  Julius
Heritage School           Grant Feature         loan_module                Never        Mwando
Horizon School            Extend Trial          Until Oct 15 2026          Oct 15 2026  Julius

[Revoke]  [Edit]  [View audit trail]
```

---

## Override Expiry Cron Job

The `check-override-expiry` Edge Function runs daily alongside the trial expiry check:

```typescript
// Find overrides that have expired
const expiredOverrides = await supabaseAdmin
  .from('afritech.school_feature_overrides')
  .select('id, school_id, override_type, feature_key')
  .eq('is_active', true)
  .lt('expires_at', new Date().toISOString())

for (const override of expiredOverrides) {
  // Deactivate the override
  await supabaseAdmin
    .from('afritech.school_feature_overrides')
    .update({ is_active: false, revoked_at: new Date().toISOString() })
    .eq('id', override.id)

  // Invalidate cache for this school
  await invalidateCache(`school_overrides:${override.school_id}`)

  // Notify school owner if the override was meaningful
  if (override.override_type === 'extend_subscription' ||
      override.override_type === 'tier_override') {
    await enqueueJob('send-email', {
      template: 'access_override_expired',
      school_id: override.school_id,
    })
  }

  // Log in audit trail
  await writeAuditLog({
    action: 'override_expired',
    school_id: override.school_id,
    metadata: { override_type: override.override_type, feature_key: override.feature_key }
  })
}
```

---

## How the Pricing Page Uses This Data

The public pricing page at `zsms.co.zm/pricing` reads from the `afritech.subscription_tiers` and `afritech.tier_features` tables. When a super admin changes a price, the pricing page updates automatically (via ISR with 5-minute revalidation in Next.js).

```typescript
// apps/web/app/pricing/page.tsx
export const revalidate = 300  // Revalidate every 5 minutes

async function PricingPage() {
  const [tiers, features] = await Promise.all([
    supabaseAdmin.from('afritech.subscription_tiers')
      .select('*').eq('is_publicly_listed', true).order('display_order'),
    supabaseAdmin.from('afritech.feature_flags')
      .select('*').eq('is_active', true).order('display_order'),
    supabaseAdmin.from('afritech.tier_features').select('*')
  ])
  // Render pricing table from this data
}
```

---

## Business Rules

1. Only `afritech:super_admin` can modify pricing tables and feature flags. No other role has write access to the `afritech` schema pricing tables.
2. Every change to `afritech.subscription_tiers`, `afritech.feature_flags`, and `afritech.tier_features` is logged in `public.audit_logs` with old and new values.
3. Price changes for existing schools default to "next billing cycle" to avoid unexpected charges. Super admin must explicitly choose "immediately" for real-time price changes.
4. Removing a feature from a tier shows a warning if schools actively using that feature are affected. The super admin must confirm they understand the impact.
5. All school overrides require a mandatory reason. Overrides without reasons are rejected.
6. Override expiry is checked daily by the cron job. Expired overrides are deactivated and cache is invalidated automatically.
7. The feature access resolution order is fixed: revoke override → grant override → tier override → module subscription → tier features. This order cannot be changed via configuration.
8. `core` category features (basic student management, attendance, results, fees) cannot be added to the feature_flags table as toggleable — they are always included for all active subscriptions regardless of tier.

---

## School Network Pricing — Open

A **School Network** (migrations `0119`–`0123`) is one owner running several
separately-onboarded schools, with a single aggregated dashboard. Some networks are
expected to reach 100 schools.

**Today every school in a network is priced and counted independently.** Each carries
its own `subscription_tier`, its own student ceiling and its own WhatsApp quota.
`school_networks.billing_mode` records the intent — `per_school` (the default, and
current behaviour) or `consolidated` — and **nothing reads it yet**.

That is not an oversight in the network feature. **ZSMS has no invoicing at all:**
`afritech.subscription_tiers` is a price list, `schools.subscription_tier` is a
column, and no code anywhere generates an invoice or collects money from a school.
There is nothing to consolidate until billing exists.

Two decisions are therefore open, and both are commercial rather than technical:

| Question | Why it matters |
|---|---|
| Does a 100-school network pay 100 × tier? | A network is the customer a volume discount exists for. Charging full rate per school is defensible but will be negotiated, and the negotiation will happen whether or not the system supports it. |
| Is quota pooled or per school? | A 100-school network with per-school WhatsApp quotas has 100 separate allowances it cannot move between schools. Pooling is what an owner will expect; it is also a change to `consume_message_quota()`, which is per-school today. |

**Recommendation when billing is built:** price on the network where `billing_mode`
is `consolidated`, sum the student ceilings rather than enforcing each school's
separately, and pool the WhatsApp quota. Whether a discount applies, and how much,
is a pricing decision this document should record once it is taken — not something
the schema should imply.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Dynamic pricing and override system confirmed |
| 2026-04-26 | Added feature_flags seed data | All current toggleable features defined |
| 2026-04-26 | Added tier_features default matrix | Current feature-to-tier mapping confirmed |
| 2026-04-26 | Added cache invalidation strategy | Performance requirement for feature access checks |
