# ANALYTICS_INTELLIGENCE.md — Smart Analytics and Early Warning System

## Related Documents

- `docs/modules/ai/AI_OVERVIEW.md` — four-system AI architecture
- `docs/modules/ai/AI_DATA_REQUIREMENTS.md` — data completeness gate
- `docs/modules/ai/AI_ASSISTANT.md` — assistant that narrates analytics data
- `docs/DATABASE.md` — tables that feed analytics queries
- `docs/modules/admin/PLATFORM_METRICS.md` — AfriTech-level analytics

---

## Implementation Status (2026-10-11)

**Built, and deliberately the only AI system with no model in it.**

Smart Analytics is SQL — `school_data_completeness()`, `curriculum_coverage()`, the health
score functions, `admin_ai_usage_breakdown()` and `admin_ai_usage_distribution()`. No LLM,
no credits, no latency, and nothing to hallucinate.

That is the right separation and worth defending: a figure on a dashboard that a model
produced cannot be audited, and a head teacher acting on "attendance is down 12%" needs
that to be arithmetic.

**The completeness gate is implemented as specified** — ≥70% full, 50–69% limited,
<50% locked — and it gates systems 1 and 2 rather than being advisory. A school that has
entered three weeks of attendance and no marks genuinely cannot support analysis, and
saying so is better than producing confident nonsense from a tenth of a term.

**AfriTech sees aggregates only.** `0169` asserts that no `admin_ai_*` function returns a
user identifier — so AfriTech can see that a school spent 400 credits without seeing
which teacher asked what. That assertion is the control; without it the privacy claim is
a convention.

---

## Purpose

This document defines the smart analytics and early warning system — the statistical intelligence layer that forms the foundation of all AI insights in ZSMS. These are SQL-based aggregations and rules, not LLM calls. Fast, cheap, and highly valuable. Every Claude Code session building any analytics or insights feature must read this document.

---

## Overview

Most of what educational AI vendors call "AI" is actually statistical analysis on structured data. The truly valuable insights — "Chanda's attendance has dropped 20% this month" or "Grade 9A is performing 15% below last term" — come from well-designed SQL queries and threshold rules, not language models.

The analytics layer is:
- **System 1** of the ZSMS AI four-system architecture
- Built entirely on existing ZSMS data (no new data collection required)
- Gated behind the data completeness score
- The data source that the AI assistant (System 2) narrates

---

## Data Completeness Score

Every analytics feature checks the data completeness score before displaying insights. Calculated on demand (not cached for accuracy):

```sql
-- Attendance completeness: % of school days this term where all classes have attendance
WITH school_days AS (
  SELECT COUNT(DISTINCT attendance_date) as days_with_any_attendance
  FROM attendance_records
  WHERE school_id = $school_id
    AND attendance_date BETWEEN $term_start AND NOW()::date
),
expected_days AS (
  SELECT COUNT(*) as total_school_days
  FROM generate_series($term_start::date, NOW()::date, '1 day'::interval) as d
  WHERE EXTRACT(DOW FROM d) BETWEEN 1 AND 5  -- Weekdays only
),
class_count AS (
  SELECT COUNT(DISTINCT class_id) as total_classes
  FROM students
  WHERE school_id = $school_id AND is_deleted = FALSE
  GROUP BY school_id
)
SELECT
  ROUND(
    (school_days.days_with_any_attendance::float / expected_days.total_school_days) * 100
  ) as attendance_completeness
FROM school_days, expected_days;

-- Marks completeness: % of expected exam result rows that have been filled
-- (students × subjects × current term)
SELECT
  ROUND(
    COUNT(er.id)::float /
    (COUNT(DISTINCT s.id) * COUNT(DISTINCT sub.subject_code)) * 100
  ) as marks_completeness
FROM students s
CROSS JOIN school_subjects sub
LEFT JOIN exam_results er
  ON er.student_id = s.id
  AND er.subject_code = sub.subject_code
  AND er.academic_year = $year
  AND er.term_number = $term
WHERE s.school_id = $school_id
  AND s.is_deleted = FALSE
  AND sub.school_id = $school_id;
```

**Completeness score composite:**
```typescript
function calculateCompletenessScore(
  attendanceCompleteness: number,
  marksCompleteness: number,
  parentLinkCompleteness: number
): DataCompletenessScore {
  const overall = Math.round(
    attendanceCompleteness * 0.40 +
    marksCompleteness     * 0.40 +
    parentLinkCompleteness * 0.20
  )

  return {
    attendance_completeness: attendanceCompleteness,
    marks_completeness: marksCompleteness,
    parent_link_completeness: parentLinkCompleteness,
    overall_score: overall,
    ai_insights_unlocked: overall >= 70,
    missing_items: buildMissingItemsList(attendanceCompleteness, marksCompleteness, parentLinkCompleteness)
  }
}
```

---

## Student Performance Analytics

### Class Performance Overview

```sql
-- Class average per subject, current term vs last term
SELECT
  er.subject_code,
  ss.subject_name,
  ROUND(AVG(er.marks_percentage)::numeric, 1) as current_avg,
  ROUND(LAG(AVG(er.marks_percentage))
    OVER (PARTITION BY er.subject_code ORDER BY er.term_number)::numeric, 1) as prev_avg,
  ROUND(AVG(er.marks_percentage) -
    LAG(AVG(er.marks_percentage)) OVER (PARTITION BY er.subject_code ORDER BY er.term_number), 1)
    as change
FROM exam_results er
JOIN school_subjects ss ON ss.subject_code = er.subject_code
WHERE er.school_id = $school_id
  AND er.class_id = $class_id
  AND er.academic_year = $year
  AND er.term_number IN ($term, $term - 1)
GROUP BY er.subject_code, ss.subject_name, er.term_number
ORDER BY ss.subject_name;
```

### At-Risk Student Detection

A student is flagged as at-risk when they meet one or more of these threshold conditions:

```typescript
interface AtRiskThresholds {
  marks_below_percent: number      // Default: 50 — overall average below this
  marks_decline_percent: number    // Default: 15 — drop from last term
  subjects_failing: number         // Default: 3 — number of subjects below pass mark
  absences_this_month: number      // Default: 5 — unexcused absences
  combined_flag: boolean           // TRUE: flag if BOTH marks AND attendance poor
}
```

```sql
-- At-risk students: low marks AND attendance issues
WITH student_marks AS (
  SELECT
    student_id,
    ROUND(AVG(marks_percentage)::numeric, 1) as avg_marks,
    COUNT(*) FILTER (WHERE marks_percentage < 50) as subjects_failing
  FROM exam_results
  WHERE school_id = $school_id
    AND academic_year = $year
    AND term_number = $term
  GROUP BY student_id
),
student_attendance AS (
  SELECT
    student_id,
    COUNT(*) FILTER (WHERE status = 'absent' AND attendance_date >= date_trunc('month', NOW()))
      as absences_this_month
  FROM attendance_records
  WHERE school_id = $school_id
  GROUP BY student_id
)
SELECT
  s.id, s.first_name, s.last_name, s.class_id,
  sm.avg_marks,
  sm.subjects_failing,
  sa.absences_this_month,
  -- Risk level
  CASE
    WHEN sm.avg_marks < 40 AND sa.absences_this_month >= 5 THEN 'critical'
    WHEN sm.avg_marks < 50 AND sa.absences_this_month >= 3 THEN 'high'
    WHEN sm.avg_marks < 50 OR sa.absences_this_month >= 5  THEN 'medium'
    ELSE 'low'
  END as risk_level
FROM students s
JOIN student_marks sm ON sm.student_id = s.id
JOIN student_attendance sa ON sa.student_id = s.id
WHERE s.school_id = $school_id
  AND s.is_deleted = FALSE
  AND (sm.avg_marks < $marks_threshold OR sa.absences_this_month >= $absence_threshold)
ORDER BY
  CASE WHEN sm.avg_marks < 40 AND sa.absences_this_month >= 5 THEN 1
       WHEN sm.avg_marks < 50 AND sa.absences_this_month >= 3 THEN 2
       ELSE 3 END,
  sm.avg_marks ASC;
```

### Performance Trend (Student Level)

```sql
-- A student's marks trajectory across the last 4 terms
SELECT
  term_number,
  academic_year,
  subject_code,
  marks_percentage,
  ROUND(AVG(marks_percentage) OVER (
    PARTITION BY student_id
    ORDER BY academic_year, term_number
    ROWS BETWEEN 3 PRECEDING AND CURRENT ROW
  )::numeric, 1) as rolling_avg
FROM exam_results
WHERE school_id = $school_id
  AND student_id = $student_id
ORDER BY academic_year DESC, term_number DESC
LIMIT 40;  -- Last 4 terms × 10 subjects max
```

---

## Attendance Analytics

### Monthly Attendance Heatmap Data

```sql
-- Per-student attendance per day for the current month
SELECT
  ar.student_id,
  s.first_name,
  s.last_name,
  ar.attendance_date,
  ar.status,  -- present / absent / late / excused
  ar.reason
FROM attendance_records ar
JOIN students s ON s.id = ar.student_id
WHERE ar.school_id = $school_id
  AND ar.class_id = $class_id
  AND ar.attendance_date >= date_trunc('month', NOW())
ORDER BY ar.attendance_date, s.last_name;
```

### Class Attendance Rate Ranking

```sql
-- Which classes have the best and worst attendance this term?
SELECT
  class_id,
  COUNT(*) FILTER (WHERE status = 'present') as present_count,
  COUNT(*) as total_records,
  ROUND(
    COUNT(*) FILTER (WHERE status = 'present')::float / COUNT(*) * 100, 1
  ) as attendance_rate
FROM attendance_records
WHERE school_id = $school_id
  AND attendance_date BETWEEN $term_start AND NOW()
GROUP BY class_id
ORDER BY attendance_rate DESC;
```

---

## Fee Collection Intelligence

### Fee Collection Rate

```sql
-- Term fee collection rate — how much of what's owed has been collected?
SELECT
  COUNT(*) FILTER (WHERE status = 'paid') as paid_count,
  COUNT(*) FILTER (WHERE status = 'partial') as partial_count,
  COUNT(*) FILTER (WHERE status IN ('unpaid','overdue')) as unpaid_count,
  COUNT(*) as total_count,
  SUM(amount_due) as total_due,
  SUM(amount_paid) as total_collected,
  ROUND(SUM(amount_paid) / NULLIF(SUM(amount_due), 0) * 100, 1) as collection_rate_pct
FROM fee_records
WHERE school_id = $school_id
  AND academic_year = $year
  AND term_number = $term
  AND is_deleted = FALSE;
```

### Fee Risk Scoring (Admin Only)

Identifies families at risk of non-payment based on historical patterns:

```sql
-- Parents with 3+ late payments in the last 12 months
SELECT
  p.id,
  p.full_name,
  p.phone_e164,
  COUNT(fr.id) as overdue_fee_count,
  SUM(fr.amount_due - fr.amount_paid) as outstanding_total
FROM parents p
JOIN student_parent_links spl ON spl.parent_user_id = p.clerk_user_id
JOIN fee_records fr ON fr.student_id = spl.student_id
WHERE fr.school_id = $school_id
  AND fr.status IN ('unpaid', 'partial', 'overdue')
  AND fr.due_date < NOW()
GROUP BY p.id, p.full_name, p.phone_e164
HAVING COUNT(fr.id) >= 2
ORDER BY outstanding_total DESC;
```

---

## Early Warning System — Configurable Rules

The early warning system is configurable per school. Admins set thresholds; the system flags students when thresholds are crossed.

### Warning Rule Configuration

```typescript
interface EarlyWarningConfig {
  // Marks-based rules
  overall_average_below: number      // Default: 50%
  subject_average_below: number      // Default: 40% — flag if any single subject below this
  term_over_term_decline: number     // Default: 15% drop triggers flag

  // Attendance-based rules
  monthly_absences_exceed: number    // Default: 5 unexcused absences
  consecutive_absences: number       // Default: 3 consecutive days triggers immediate alert

  // Combined rules
  combined_marks_and_attendance: boolean  // Flag if BOTH marks AND attendance poor

  // Notification behaviour
  notify_class_teacher: boolean      // Default: TRUE
  notify_principal: boolean          // Default: FALSE (only for critical flags)
  notify_parent: boolean             // Default: FALSE (admin decides)
}
```

### Warning Dashboard — Principal View

```
Early Warning Dashboard — Sunrise Academy
Term 2, 2026

CRITICAL (2 students)
━━━━━━━━━━━━━━━━━━━━
Chanda Bwalya · Grade 9A
  Marks: 38% average · 5 subjects below 50%
  Attendance: 7 absences this month
  [View student]  [Contact parent]  [Assign intervention]

Peter Banda · Grade 10A
  Marks: 41% average · 4 subjects below 50%
  Attendance: 4 absences this month
  [View student]  [Contact parent]

HIGH RISK (5 students)
━━━━━━━━━━━━━━━━━━━━
[collapsed — click to expand]

MEDIUM RISK (8 students)
━━━━━━━━━━━━━━━━━━━━
[collapsed — click to expand]

Data completeness: 82% ✅
Last updated: Today at 08:00am
```

---

## Analytics Dashboard Structure

### Teacher Analytics

- Class performance overview (subject averages, vs last term)
- At-risk students in my classes
- Attendance heatmap for my classes
- Marks entry completeness (which students still missing marks)

### Principal Analytics

- School-wide performance overview
- Early warning dashboard (all risk levels)
- Class performance comparison
- Fee collection rate
- Staff marks entry compliance

### Owner Analytics

- All principal analytics plus financial overview
- Subscription and student count trends
- Year-over-year comparison

---

## Business Rules

1. All analytics queries use the RLS-enforced service role pattern — teachers only see their classes, parents only see their children.
2. Analytics are displayed only when data completeness score >= 50%. Below 50%, only the data quality improvement guide is shown.
3. The at-risk threshold values are configurable per school in Settings → AI & Insights. Defaults apply if not configured.
4. The early warning dashboard refreshes daily at 06:00 Lusaka time (via queue cron) so principals see current data when they arrive at school.
5. Analytics data is never sent to external systems without explicit school configuration. It does not flow through WhatsApp or email unless the school configures early warning notifications.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | AI module — System 1 analytics layer |
| 2026-04-26 | Configurable thresholds per school | Different schools have different standards |
| 2026-04-26 | Data completeness gate on all analytics | Bad data produces misleading insights |
