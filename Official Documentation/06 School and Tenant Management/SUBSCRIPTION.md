# SUBSCRIPTION.md — School Subscription and Billing

## Related Documents

- `docs/modules/admin/PRICING.md` — dynamic pricing admin panel (super admin)
- `docs/modules/school/TRIAL.md` — 30-day free trial model
- `docs/DATABASE.md` — afritech.subscription_tiers, feature_flags, tier_features, school_feature_overrides, module_subscriptions
- `docs/modules/school/SCHOOL_CONFIG.md` — features configured post-subscription

---

## Implementation Status (2026-10-11)

**Tiers, the feature matrix and all seven add-ons are built.** 20 feature flags, 36
tier-feature rows, resolving through `school_has_feature()` in the fixed order: revoke
override → grant override → tier override → tier matrix.

**One add-on was priced and not enforced until `0245`.** API Read (K138) and API Write
(K275) had flags from the start; the key system built in `0241` checked neither, so any
school on any tier could use the API for nothing. Gated now at issue AND at verify — the
second matters, because without re-resolving on every call a cancelled add-on leaves the
key working forever, which makes a subscription a one-off purchase.

No key was revoked when the gate landed. A school already wired in is a commercial
conversation, and `/admin/costs` lists the mismatches so it can start from a list.

**Worth checking when a new add-on is priced:** a flag in `afritech.feature_flags` and a
price in this document are not the same as a gate in the code. `api_read` had both and
was free for a day.

---

## Purpose

This document defines the ZSMS subscription model — base tiers, feature add-ons, billing cycles, the dynamic pricing system, and how feature access is resolved. Every Claude Code session building anything related to billing, feature gating, or subscription management must read this document.

---

## Overview

ZSMS uses a base tier + feature add-on model. Schools pay a base monthly subscription for their tier and can purchase additional feature modules independently. All pricing is database-driven — AfriTech super admins change prices via the admin panel without code deployments.

---

## Base Subscription Tiers

Prices stored in `afritech.subscription_tiers` — editable by super admins.

| Tier | Monthly (ZMW) | Annual (ZMW) | Students | WhatsApp/month |
|---|---|---|---|---|
| Starter | K600 | K6,480 (10% off) | Up to 200 | 500 |
| Growth | K1,100 | K11,880 (10% off) | Up to 500 | 1,500 |
| Professional | K2,000 | K21,600 (10% off) | Up to 1,000 | 4,000 |
| Enterprise | K3,000 | K32,400 (10% off) | Unlimited | Unlimited |

USD equivalents are maintained alongside ZMW prices for multi-country pricing.

---

## Feature Matrix

Which features are included in each tier — managed in `afritech.tier_features`:

| Feature | Starter | Growth | Professional | Enterprise | Add-on Price |
|---|---|---|---|---|---|
| Core (students, fees, results, attendance) | ✅ | ✅ | ✅ | ✅ | Included |
| WhatsApp communication | ✅ | ✅ | ✅ | ✅ | Included |
| Per-absence WhatsApp alerts | ✅ | ✅ | ✅ | ✅ | Included |
| Timetable Builder | ☐ | ✅ | ✅ | ✅ | K100/month |
| Advanced Analytics (AI System 1) | ☐ | ✅ | ✅ | ✅ | K100/month |
| API Read Access | ☐ | ✅ | ✅ | ✅ | K138/month |
| Loan Module (Finance) | ☐ | ☐ | ✅ | ✅ | K275/month |
| Integrations (Connectors) | ☐ | ☐ | ✅ | ✅ | K200/month |
| API Write Access | ☐ | ☐ | ✅ | ✅ | K275/month |
| Custom Document Template | ☐ | ☐ | ✅ | ✅ | — (AfriTech-built only) |
| AI Assistant | ☐ | ☐ | ✅ | ✅ | K200/month |
| White Label Portal | ☐ | ☐ | ☐ | ✅ | K300/month |
| API Full Access | ☐ | ☐ | ☐ | ✅ | K550/month |
| Payroll Module (Phase 3) | ☐ | ☐ | ☐ | ☐ | K200/month |
| Inventory Module (Phase 3) | ☐ | ☐ | ☐ | ☐ | K150/month |

---

## Feature Add-Ons

Schools can purchase features not included in their tier as monthly add-ons. Tracked in `public.module_subscriptions`.

**Example:** A Starter school paying K600/month wants the timetable builder. They add the K100/month Timetable add-on — total K700/month — without upgrading to Growth.

**Available add-ons with pricing:**

| Add-on | Monthly | Who buys it |
|---|---|---|
| Timetable Builder | K100 | Starter schools needing timetable |
| Advanced Analytics | K100 | Starter/Growth wanting AI insights |
| Loan Module | K275 | Any tier wanting fee finance referral |
| Integrations | K200 | Any tier wanting accounting/CRM sync |
| API Read | K138 | Starter wanting read API |
| API Write | K275 | Growth wanting write API |
| AI Assistant | K200 | Growth wanting conversational AI |
| White Label | K300 | Professional wanting branded portal |

---

## Standalone Teacher Subscriptions

Teachers using the lesson planner B2C product independently. Managed via `public.standalone_teacher_accounts`.

| Plan | Price | Includes |
|---|---|---|
| Free Trial | K0 | 5 lesson plans (no time limit) |
| Monthly | K300/month | Unlimited lesson plans, quizzes, homework |
| Annual | K3,000/year | Same as monthly — 2 months free |

Standalone teacher subscriptions are entirely separate from school subscriptions. A teacher can have both a school subscription (org:teacher at their school) and a standalone account.

---

## Feature Access Resolution

When ZSMS checks whether a school can use a feature, it resolves access in this order:

```
1. Is the school's subscription active?
   → If no: check for extend_subscription or extend_trial override
   → If still no: access denied

2. Is there a REVOKE override for this feature?
   → If yes: access denied (super admin removed the feature)

3. Is there a GRANT override for this feature?
   → If yes: access granted (super admin gave the feature)

4. Is there a TIER OVERRIDE active?
   → If yes: use the override tier instead of the school's actual tier

5. Does the school have an active module_subscription for this feature?
   → If yes: access granted

6. Does the school's effective tier include this feature?
   → Check afritech.tier_features
   → If yes: access granted
   → If no: access denied
```

All results cached in Redis (5-minute TTL for overrides, 60-minute TTL for tier features).

---

## Super Admin Overrides

AfriTech super admins can apply per-school exceptions stored in `afritech.school_feature_overrides`:

| Override Type | Use Case | Example |
|---|---|---|
| `grant_feature` | Give access to feature not in their tier | Pilot school gets Professional features on Starter |
| `revoke_feature` | Remove a feature even if it's in their tier | School misusing the loan module |
| `extend_subscription` | Keep access after billing lapses | School awaiting payment processing |
| `extend_trial` | More time on trial | School needs 2 more weeks to evaluate |
| `tier_override` | Treat as different tier temporarily | "3 months free Professional" deal |

All overrides require a mandatory reason and are logged in the audit trail. Overrides can be time-limited (expires_at) or permanent (expires_at = NULL).

---

## Trial Model

- 30-day free trial on registration — no payment required
- All Growth tier features available during trial
- No credit card required to start
- Conversion to paid subscription at any point during or after trial
- After expiry: read-only access for 7 days, then suspended
- Trial can be extended by super admin via override system

---

## Billing Cycle

- Monthly: billed on the same date each month (registration date)
- Annual: billed once per year — 10% discount applied
- Currency: ZMW primary, USD for international schools
- Payment via Flutterwave (school connects their payment method)
- Failed payment: 7-day grace period before suspension
- Reactivation: pay outstanding balance to restore access

---

## Price Change Policy

When AfriTech changes a tier price via the admin panel:

- **New schools:** New price applies immediately
- **Existing schools:** Price applies at next billing cycle (default)
- **Immediate change:** Super admin can force immediate change with confirmation warning
- **Grandfathering:** Existing schools can be protected from price increases using a `grant_feature` or `tier_override` with an explicit expiry date

---

## Business Rules

1. All pricing is read from `afritech.subscription_tiers` and `afritech.tier_features` at runtime — never hardcoded in application code.
2. Feature access resolution always checks overrides before tier features. A revoke override beats a tier inclusion.
3. Trial schools have access to Growth tier features by default. This gives them a meaningful evaluation experience.
4. Module subscriptions are additive — they cannot replace a tier. A school must have an active base tier subscription before purchasing add-ons.
5. Standalone teacher subscriptions are entirely independent of school subscriptions and managed separately.
6. The AI Assistant and Advanced Analytics add-ons require the school's data completeness score to be >= 50% before insights are shown — subscription alone does not guarantee insights.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Complete rewrite — base tier + feature add-on model | Fixed-tier model replaced with dynamic database-driven pricing |
| 2026-04-26 | Added dynamic pricing via afritech schema tables | Super admins control pricing without code deployments |
| 2026-04-26 | Added feature override system | Per-school exceptions for pilots, deals, and support situations |
| 2026-04-26 | Added standalone teacher subscription | B2C lesson planner product separate from school subscriptions |
| 2026-04-26 | Added AI features to feature matrix | AI assistant and analytics as premium add-ons |
