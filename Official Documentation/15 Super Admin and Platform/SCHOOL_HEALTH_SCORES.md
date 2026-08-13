# SCHOOL_HEALTH_SCORES.md — School Health Scoring System

## Related Documents

- `docs/modules/admin/ANALYTICS_STRATEGY.md` — analytics architecture
- `docs/modules/admin/BUSINESS_INTELLIGENCE.md` — BIS dashboards
- `docs/modules/admin/PLATFORM_METRICS.md` — platform-wide metrics
- `docs/modules/admin/SUPERADMIN.md` — health score display in admin panel
- `docs/DATABASE.md` — afritech.school_health_scores table
- `docs/api/EDGE_FUNCTIONS.md` — calculate-school-health-scores cron

---

## Purpose

This document defines the school health scoring system — the composite score calculated nightly for every active school that powers AfriTech's proactive customer success operations. Every Claude Code session building the health score calculation or admin health dashboard must read this document.

---

## Overview

The school health score is AfriTech's most operationally important internal metric. It answers the question: "Is this school genuinely using ZSMS and getting value from it?" A school can have an active subscription and still be at risk of churning if they are not actually using the platform. The health score detects this before the school churns.

**The business case:** Schools that drop from a healthy score to a critical score in two weeks are not going to renew. AfriTech's regional managers see this and call the school before the renewal date. One saved school at K1,100/month is worth K13,200/year — the health score system pays for itself with the first prevented churn.

---

## Score Components

The health score is a composite of three dimensions, each calculated independently:

### Dimension 1 — Operational Health (40% weight)

Measures whether school staff are actually using ZSMS for their daily operations.

```typescript
interface OperationalHealth {
  // Attendance compliance (most important operational signal)
  attendance_compliance_rate: number
  // = (school days with ALL active classes marked) / (total school days this month)
  // A school where only some teachers mark attendance scores lower than full compliance
  // Target: >= 80%

  // Marks entry compliance
  marks_completion_rate: number
  // = (exam_result rows filled) / (expected rows: students × subjects × current term)
  // Target: >= 70% by end of term

  // Staff engagement
  active_teacher_rate: number
  // = (teachers who logged in at least once this week) / (total active teachers)
  // Target: >= 70%

  // Data recency
  last_data_entry_days_ago: number
  // Days since any school user entered data (attendance, marks, payment)
  // Alert threshold: > 7 days
}

function scoreOperationalHealth(data: OperationalHealth): number {
  let score = 0

  // Attendance compliance (50% of operational score)
  if (data.attendance_compliance_rate >= 0.90)      score += 50
  else if (data.attendance_compliance_rate >= 0.75) score += 38
  else if (data.attendance_compliance_rate >= 0.50) score += 25
  else if (data.attendance_compliance_rate >= 0.25) score += 10
  else                                               score += 0

  // Marks completion (30% of operational score)
  if (data.marks_completion_rate >= 0.90)      score += 30
  else if (data.marks_completion_rate >= 0.70) score += 22
  else if (data.marks_completion_rate >= 0.50) score += 15
  else if (data.marks_completion_rate >= 0.25) score += 7
  else                                          score += 0

  // Staff engagement (20% of operational score)
  if (data.active_teacher_rate >= 0.80)      score += 20
  else if (data.active_teacher_rate >= 0.60) score += 15
  else if (data.active_teacher_rate >= 0.40) score += 10
  else if (data.active_teacher_rate >= 0.20) score += 5
  else                                        score += 0

  // Penalty for stale data
  if (data.last_data_entry_days_ago > 14) score = Math.round(score * 0.5)
  else if (data.last_data_entry_days_ago > 7) score = Math.round(score * 0.75)

  return Math.min(100, score)
}
```

### Dimension 2 — Financial Health (30% weight)

Measures whether the school is using ZSMS effectively for fee management.

```typescript
interface FinancialHealth {
  fee_collection_rate: number
  // = (amount paid) / (amount due) for current term
  // Target: >= 70% by mid-term, >= 85% by end of term

  payment_verification_speed_hours: number
  // Average hours from payment submission to verification
  // Target: < 24 hours (fast verification = accountant is engaged)

  overdue_fee_rate: number
  // = (fee records past due date and unpaid) / (total fee records)
  // Target: < 30%

  fee_records_generated: boolean
  // Has the school generated fee records for the current term?
  // FALSE = school is not using the fee module at all
}

function scoreFinancialHealth(data: FinancialHealth): number {
  let score = 0

  if (!data.fee_records_generated) return 0  // Not using fees = 0

  // Collection rate (50% of financial score)
  if (data.fee_collection_rate >= 0.85)      score += 50
  else if (data.fee_collection_rate >= 0.70) score += 38
  else if (data.fee_collection_rate >= 0.50) score += 25
  else if (data.fee_collection_rate >= 0.30) score += 12
  else                                        score += 5

  // Verification speed (30% of financial score)
  if (data.payment_verification_speed_hours <= 4)  score += 30
  else if (data.payment_verification_speed_hours <= 24) score += 22
  else if (data.payment_verification_speed_hours <= 48) score += 12
  else                                               score += 0

  // Overdue rate (20% of financial score — lower is better)
  if (data.overdue_fee_rate <= 0.10)      score += 20
  else if (data.overdue_fee_rate <= 0.20) score += 15
  else if (data.overdue_fee_rate <= 0.30) score += 8
  else                                     score += 0

  return Math.min(100, score)
}
```

### Dimension 3 — Engagement Health (30% weight)

Measures leadership commitment and parent activation.

```typescript
interface EngagementHealth {
  owner_logins_last_7_days: number
  // Target: >= 3 logins per week (owner is checking the school)

  parent_activation_rate: number
  // = (parents who have logged in at least once) / (total linked parents)
  // Target: >= 60%

  whatsapp_messages_sent_this_month: number
  // A school sending 0 WhatsApp messages is not communicating with parents
  // Target: >= 50 messages (school is using the communication features)

  announcement_sent_this_term: boolean
  // Has the school sent at least one announcement this term?
}

function scoreEngagementHealth(data: EngagementHealth): number {
  let score = 0

  // Owner engagement (40% of engagement score)
  if (data.owner_logins_last_7_days >= 5)      score += 40
  else if (data.owner_logins_last_7_days >= 3) score += 30
  else if (data.owner_logins_last_7_days >= 1) score += 15
  else                                          score += 0

  // Parent activation (40% of engagement score)
  if (data.parent_activation_rate >= 0.80)      score += 40
  else if (data.parent_activation_rate >= 0.60) score += 30
  else if (data.parent_activation_rate >= 0.40) score += 20
  else if (data.parent_activation_rate >= 0.20) score += 10
  else                                           score += 0

  // Communication usage (20% of engagement score)
  if (data.whatsapp_messages_sent_this_month >= 100) score += 20
  else if (data.whatsapp_messages_sent_this_month >= 50) score += 15
  else if (data.whatsapp_messages_sent_this_month >= 10) score += 8
  else if (data.announcement_sent_this_term)             score += 5
  else                                                    score += 0

  return Math.min(100, score)
}
```

---

## Composite Score Calculation

```typescript
function calculateSchoolHealthScore(
  operational: number,
  financial: number,
  engagement: number
): { score: number; band: string } {
  const composite = Math.round(
    operational * 0.40 +
    financial   * 0.30 +
    engagement  * 0.30
  )

  const band =
    composite >= 80 ? 'excellent' :
    composite >= 65 ? 'good' :
    composite >= 45 ? 'at_risk' :
    'critical'

  return { score: composite, band }
}
```

---

## Score Bands and Actions

| Band | Score | What It Means | AfriTech Action |
|---|---|---|---|
| 🟢 Excellent | 80-100 | School fully engaged, data complete, parents active | Quarterly check-in |
| 🟡 Good | 65-79 | Generally healthy, minor gaps | Monthly touch |
| 🟠 At Risk | 45-64 | Significant usage gaps, churn risk | Proactive outreach this week |
| 🔴 Critical | 0-44 | Minimal usage, high churn probability | Call today |

---

## Weekly Score Change Tracking

The score change over 7 days is as important as the current score:

```
School A: Score 72 (Good) — down from 85 last week (-13)
→ Flag for immediate review even though current score is "Good"
→ A 13-point drop in one week signals a specific problem

School B: Score 52 (At Risk) — up from 41 last week (+11)
→ Positive trend — outreach is working, monitor closely
```

---

## Churn Probability Rules (Phase 1 — Rules Based)

```typescript
function calculateChurnRisk(
  healthScore: number,
  scoreChange7Days: number,
  signals: ChurnSignals
): 'low' | 'medium' | 'high' | 'critical' {

  // Critical signals — any one triggers critical risk
  if (signals.subscriptionPaymentFailed) return 'critical'
  if (signals.noOwnerLogin14Days) return 'critical'
  if (signals.noAttendanceMarked7Days && healthScore < 50) return 'critical'

  // Score-based risk
  if (healthScore < 30) return 'critical'
  if (healthScore < 45) return 'high'
  if (healthScore < 60) return 'medium'

  // Declining trend override
  if (scoreChange7Days < -20) return 'high'
  if (scoreChange7Days < -10 && healthScore < 70) return 'medium'

  return 'low'
}
```

---

## Nightly Calculation Edge Function

The `calculate-school-health-scores` Edge Function runs every night at 03:00 UTC:

```typescript
async function calculateAllSchoolHealthScores() {
  const schools = await getAllActiveSchools()

  for (const school of schools) {
    const [operational, financial, engagement] = await Promise.all([
      calculateOperationalHealth(school.id),
      calculateFinancialHealth(school.id),
      calculateEngagementHealth(school.id),
    ])

    const opScore = scoreOperationalHealth(operational)
    const finScore = scoreFinancialHealth(financial)
    const engScore = scoreEngagementHealth(engagement)
    const { score, band } = calculateSchoolHealthScore(opScore, finScore, engScore)

    // Get previous score for change tracking
    const previousScore = await getPreviousHealthScore(school.id, 7)
    const scoreChange = previousScore ? score - previousScore : 0

    const churnRisk = calculateChurnRisk(score, scoreChange, await getChurnSignals(school.id))

    await supabaseAdmin.from('afritech.school_health_scores').upsert({
      school_id: school.id,
      calculated_date: today,
      attendance_compliance_rate: operational.attendance_compliance_rate,
      marks_completion_rate: operational.marks_completion_rate,
      active_teacher_rate: operational.active_teacher_rate,
      fee_collection_rate: financial.fee_collection_rate,
      owner_login_frequency: engagement.owner_logins_last_7_days,
      parent_activation_rate: engagement.parent_activation_rate,
      health_score: score,
      health_band: band,
      score_change_7_days: scoreChange,
      churn_risk_probability: churnRiskToNumber(churnRisk),
    }, { onConflict: 'school_id,calculated_date' })

    // Write churn risk signals
    if (churnRisk !== 'low') {
      await writeChurnRiskSignal(school.id, churnRisk, await getChurnSignals(school.id))
    }
  }
}
```

---

## Business Rules

1. Health scores are calculated nightly — they reflect the school's state as of the previous calendar day.
2. Schools in trial are scored the same as active schools — their health score determines onboarding intervention priority.
3. Schools with no students and no staff (just registered, not configured) get a score of 0 until they complete basic setup.
4. The health score is internal to AfriTech — it is never shown to schools. Schools see only their onboarding completion percentage.
5. A critical health score triggers an automatic task in AfriTech's admin panel for the assigned regional manager.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-06-23 | Initial complete draft | School health scoring system confirmed |
| 2026-06-23 | Three-dimension scoring model | Operational + Financial + Engagement covers all churn factors |
| 2026-06-23 | Rules-based churn probability for Phase 1 | ML Phase 4 — rules sufficient for launch |
