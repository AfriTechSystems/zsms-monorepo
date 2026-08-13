# PLATFORM_METRICS.md — Platform Metrics and Analytics

## Related Documents

- `docs/modules/admin/SUPERADMIN.md` — admin panel where metrics are displayed
- `docs/modules/admin/ONBOARDING.md` — onboarding metrics tracked here
- `docs/infra/POSTHOG.md` — product analytics alongside internal metrics
- `docs/infra/QSTASH.md` — nightly metrics calculation cron job
- `docs/DATABASE.md` — afritech.platform_metrics table
- `docs/modules/school/SUBSCRIPTION.md` — subscription data feeding revenue metrics

---

## Purpose

This document defines every platform metric that AfriTech tracks internally — how each is calculated, which database tables it draws from, how it is cached for performance, and which dashboard it appears on. Every Claude Code session building the AfriTech metrics dashboard must read this document.

---

## Overview

Platform metrics answer the business questions that matter to AfriTech as a company. They are different from school-level metrics (which schools use to manage their operations) and PostHog events (which track product usage patterns). Platform metrics track the health of AfriTech's business — revenue, growth, retention, and the loan portfolio.

Metrics are calculated by a nightly queue cron job and cached in `afritech.platform_metrics`. The dashboard reads cached values for trends and historical analysis, and live database queries for current-state counters.

---

## Metrics Storage Schema

```sql
CREATE TABLE afritech.platform_metrics (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  metric_date     DATE NOT NULL,           -- The date this snapshot was taken
  country_code    TEXT NOT NULL DEFAULT 'ZM',
  metric_name     TEXT NOT NULL,
  metric_value    NUMERIC NOT NULL,
  metric_metadata JSONB,                   -- Breakdown data for drilldown
  calculated_at   TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(metric_date, country_code, metric_name)
);

CREATE INDEX idx_platform_metrics_date ON afritech.platform_metrics(metric_date DESC, metric_name);
```

---

## Revenue Metrics

### Monthly Recurring Revenue (MRR)

**Definition:** Total subscription revenue expected in the current calendar month from all active schools.

**Calculation:**
```sql
SELECT
  SUM(
    CASE subscription_tier
      WHEN 'starter'      THEN 600
      WHEN 'growth'       THEN 1100
      WHEN 'professional' THEN 2000
      WHEN 'enterprise'   THEN 3000
      ELSE 0
    END
  ) +
  COALESCE((
    SELECT SUM(billing_amount)
    FROM public.module_subscriptions
    WHERE status = 'active'
  ), 0) AS mrr_zmw
FROM public.schools
WHERE status = 'active'
  AND country_code = 'ZM';
```

**Displayed as:** K[amount] / month (ZMW primary, USD secondary)
**Dashboard location:** Finance → MRR/ARR
**Roles:** `afritech:super_admin`, `afritech:finance_officer`

---

### Annual Recurring Revenue (ARR)

**Definition:** MRR × 12. Represents the annualised value of current subscriptions.

**Displayed alongside:** Rolling 12-month actual revenue (what AfriTech has actually collected vs ARR target)

---

### Revenue by Tier

```sql
SELECT
  subscription_tier,
  COUNT(*) as school_count,
  COUNT(*) * (
    CASE subscription_tier
      WHEN 'starter'      THEN 600
      WHEN 'growth'       THEN 1100
      WHEN 'professional' THEN 2000
      WHEN 'enterprise'   THEN 3000
    END
  ) as tier_mrr
FROM public.schools
WHERE status = 'active'
GROUP BY subscription_tier;
```

**Chart type:** Stacked bar showing school count and MRR contribution per tier
**Purpose:** Understand which tier drives revenue — if 80% of MRR comes from 20% of schools (Professional/Enterprise), that shapes sales strategy

---

### Net Revenue Retention (NRR)

**Definition:** Of schools that were paying 12 months ago, how much are they paying today (accounting for upgrades, downgrades, and churn)?

**Calculation:**
```
NRR = (Revenue from cohort today) / (Revenue from cohort 12 months ago) × 100%
```

- NRR > 100%: Schools are upgrading faster than churning (ideal)
- NRR = 100%: Upgrades and churns are balanced
- NRR < 100%: Churn is outpacing upgrades

**Target:** NRR > 110% by end of Year 2

---

### Loan Commission Revenue

```sql
SELECT
  DATE_TRUNC('month', created_at) as month,
  SUM(commission_amount) as commission_earned,
  COUNT(*) as loans_originated,
  AVG(disbursed_amount) as avg_loan_size
FROM afritech.loan_commissions
WHERE status IN ('invoiced', 'received')
GROUP BY DATE_TRUNC('month', created_at)
ORDER BY month DESC;
```

**Dashboard location:** Finance → Commissions (loan_officer and finance_officer)

---

## Growth Metrics

### Total Schools by Status

```sql
SELECT
  status,
  COUNT(*) as count,
  country_code
FROM public.schools
GROUP BY status, country_code;
```

**Breakdown shown:**
- Active (paying subscribers)
- Trial (in 30-day trial)
- Trial Expired (lapsed without subscribing)
- Pending Verification (manually onboarded, awaiting activation)
- Suspended (subscription lapsed)

---

### Trial Conversion Rate

**Definition:** Of all schools that started a trial in a given month, what percentage converted to a paid subscription within 60 days?

```sql
-- Trials started in August 2026
WITH august_trials AS (
  SELECT id, trial_ends_at, status, subscription_tier
  FROM public.schools
  WHERE status != 'pending_verification'
    AND trial_ends_at BETWEEN '2026-08-01' AND '2026-08-31'
),
conversions AS (
  SELECT school_id, MIN(created_at) as first_payment_at
  FROM public.billing_events  -- AfriTech's subscription payment table
  WHERE created_at <= '2026-10-31'  -- 60-day window
  GROUP BY school_id
)
SELECT
  COUNT(t.id) as trials_started,
  COUNT(c.school_id) as converted,
  ROUND(COUNT(c.school_id)::numeric / COUNT(t.id) * 100, 1) as conversion_rate
FROM august_trials t
LEFT JOIN conversions c ON c.school_id = t.id;
```

**Target:** 40% trial-to-paid conversion rate by Q2 2027
**Dashboard location:** Platform → Metrics → Conversion Funnel

---

### Time to Convert

**Definition:** Average number of days from trial start to first subscription payment.

**Why it matters:** Shorter time to convert = better onboarding effectiveness. If average time-to-convert is 22 days, the AfriTech outreach call on day 1 and follow-up on day 7 are working. If it stretches to 28 days, schools are converting at the last moment (desperation, not delight).

---

### Monthly Active Schools

**Definition:** Schools with at least one user login AND at least one data write (attendance, payment, marks entry) in the past 30 days.

```sql
SELECT COUNT(DISTINCT school_id) as active_schools
FROM public.audit_logs
WHERE created_at >= NOW() - INTERVAL '30 days'
  AND action NOT IN ('login', 'view')  -- Exclude read-only activity
  AND school_id IS NOT NULL;
```

**Distinction from "active subscription":** A school can have an active subscription but not actually use ZSMS. Monthly active schools measures genuine engagement.

---

### Churn Rate

**Definition:** Monthly churn = schools that let their subscription lapse in a given month / total paying schools at the start of that month.

**Target:** Monthly churn < 3% (annual churn < 30%, improving to < 20% by Year 2)

---

## Onboarding Metrics

### Average Onboarding Completion by Day

For all schools registered in the last 90 days, what is the average checklist completion percentage at each day post-registration?

```sql
SELECT
  EXTRACT(DAY FROM NOW() - s.created_at)::INT as days_since_registration,
  AVG(
    (SELECT COUNT(*) * 100.0 / NULLIF(COUNT(*), 0)
     FROM public.onboarding_checklists oc
     WHERE oc.school_id = s.id AND oc.is_complete = TRUE)
  ) as avg_completion_pct
FROM public.schools s
WHERE s.created_at >= NOW() - INTERVAL '90 days'
GROUP BY 1
ORDER BY 1;
```

**Chart type:** Line chart showing completion curve over first 30 days
**Purpose:** Identify where schools stall (e.g. if completion plateaus at 45% around day 5, that is where the onboarding call is not being made effectively)

---

### Most Common Incomplete Checklist Items

```sql
SELECT
  item_key,
  COUNT(*) FILTER (WHERE is_complete = FALSE) as incomplete_count,
  COUNT(*) as total_count,
  ROUND(COUNT(*) FILTER (WHERE is_complete = FALSE) * 100.0 / COUNT(*), 1) as incomplete_pct
FROM public.onboarding_checklists oc
JOIN public.schools s ON s.id = oc.school_id
WHERE s.status IN ('trial', 'active')
GROUP BY item_key
ORDER BY incomplete_pct DESC;
```

**Purpose:** Shows which steps are hardest for schools to complete. If `payment_gateway` is 78% incomplete, AfriTech should improve that onboarding step or make gateway setup simpler.

---

## Communication Metrics

### WhatsApp Message Volume by School Tier

```sql
SELECT
  s.subscription_tier,
  DATE_TRUNC('month', ml.created_at) as month,
  COUNT(*) as messages_sent,
  COUNT(*) FILTER (WHERE ml.status = 'delivered') as delivered,
  COUNT(*) FILTER (WHERE ml.status = 'read') as read,
  COUNT(*) FILTER (WHERE ml.status = 'failed') as failed
FROM public.message_log ml
JOIN public.schools s ON s.id = ml.school_id
WHERE ml.channel = 'whatsapp'
GROUP BY s.subscription_tier, DATE_TRUNC('month', ml.created_at)
ORDER BY month DESC;
```

**Purpose:** Understand quota utilisation by tier — if Starter schools are hitting quota limits consistently, the Starter quota (500/month) may need to be reconsidered.

---

## Loan Module Metrics

### Loan Portfolio Overview

```sql
SELECT
  COUNT(*) FILTER (WHERE status = 'submitted') as pending_review,
  COUNT(*) FILTER (WHERE status IN ('under_review', 'approved')) as in_progress,
  COUNT(*) FILTER (WHERE status = 'disbursed') as disbursed,
  COUNT(*) FILTER (WHERE status = 'fully_repaid') as repaid,
  COUNT(*) FILTER (WHERE status = 'declined') as declined,
  SUM(amount_requested) FILTER (WHERE status = 'disbursed') as total_disbursed,
  AVG(behaviour_score) as avg_behaviour_score
FROM private.loan_applications;
```

**Dashboard location:** Loans → Applications (loan_officer)

---

### Commission Pipeline

```sql
SELECT
  status,
  COUNT(*) as count,
  SUM(commission_amount) as total_zmw
FROM afritech.loan_commissions
GROUP BY status;
-- pending: earned but not invoiced
-- invoiced: invoice sent to lender
-- received: payment confirmed
-- disputed: lender disputes the commission
```

---

## Alumni Marketing Metrics

```sql
SELECT
  COUNT(*) FILTER (WHERE marketing_opt_in = TRUE) as opted_in,
  COUNT(*) FILTER (WHERE marketing_opt_in = FALSE) as opted_out,
  COUNT(*) FILTER (WHERE marketing_opt_in = TRUE AND
    id IN (SELECT parent_id FROM student_parent_links WHERE
           student_id IN (SELECT id FROM students WHERE status = 'graduated')))
    as alumni_opted_in
FROM public.parents;
```

**Dashboard location:** Alumni → Opted-In Users (super_admin)

---

## Nightly Metrics Calculation

The `calculate-platform-metrics` Edge Function runs daily at 02:00 UTC via queue cron:

```typescript
// calculate-platform-metrics Edge Function
async function calculateNightlyMetrics(date: string, countryCode: string) {
  const metrics = [
    { name: 'mrr_zmw',                value: await calculateMRR(countryCode) },
    { name: 'arr_zmw',                value: await calculateMRR(countryCode) * 12 },
    { name: 'active_schools',         value: await countActiveSchools(countryCode) },
    { name: 'trial_schools',          value: await countTrialSchools(countryCode) },
    { name: 'monthly_churn_rate',     value: await calculateChurnRate(countryCode) },
    { name: 'trial_conversion_rate',  value: await calculateTrialConversionRate(countryCode) },
    { name: 'avg_onboarding_pct',     value: await calculateAvgOnboardingCompletion(countryCode) },
    { name: 'loans_disbursed_month',  value: await countLoansDisburvedThisMonth() },
    { name: 'commission_pending_zmw', value: await calculatePendingCommission() },
    { name: 'alumni_opted_in',        value: await countAlumniOptedIn(countryCode) },
    { name: 'whatsapp_volume_month',  value: await countWhatsAppThisMonth(countryCode) },
  ]

  // Upsert all metrics for today
  await supabaseAdmin
    .from('afritech.platform_metrics')
    .upsert(
      metrics.map(m => ({
        metric_date: date,
        country_code: countryCode,
        metric_name: m.name,
        metric_value: m.value,
        calculated_at: new Date().toISOString(),
      })),
      { onConflict: 'metric_date,country_code,metric_name' }
    )
}
```

---

## Live vs Cached Metrics

| Metric | Source | Refresh Rate |
|---|---|---|
| Current MRR | Live query | Per page load |
| Active schools right now | Live query | Per page load |
| MRR trend (last 12 months) | Cached | Nightly |
| Trial conversion rate | Cached | Nightly |
| Onboarding completion curve | Cached | Nightly |
| Loan portfolio | Live query | Per page load |
| Commission pipeline | Live query | Per page load |
| WhatsApp volume trend | Cached | Nightly |

---

## Business Rules

1. Platform metrics are visible only to `afritech:super_admin` and `afritech:finance_officer`. School-level users cannot access any platform metric.
2. Nightly metrics are calculated at 02:00 UTC — after the business day in Zambia (CAT = UTC+2, so 04:00 Lusaka time). This ensures end-of-day data is captured.
3. Revenue metrics use ZMW as primary currency. USD equivalent is shown as secondary using the country config exchange rate.
4. Churn is calculated as schools that moved from `active` to `suspended` in the period divided by total active schools at the start of the period.
5. The alumni opted-in count is a key metric for the future marketing revenue stream — it represents the addressable audience for promotional content.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 15 admin module documentation |
| 2026-04-26 | Added loan portfolio and commission metrics | Loan module confirmed |
| 2026-04-26 | Added alumni marketing metrics | Graduated account model confirmed |
| 2026-04-26 | Added live vs cached distinction | Decision 2 confirmed — both live and cached |
