# AI_DATA_REQUIREMENTS.md — AI Data Requirements

## Related Documents

- `docs/modules/ai/AI_OVERVIEW.md` — four-system AI architecture
- `docs/modules/ai/ANALYTICS_INTELLIGENCE.md` — data completeness score calculation
- `docs/modules/ai/AI_ASSISTANT.md` — assistant data dependencies
- `docs/modules/ai/LESSON_PLANNER.md` — lesson planner knowledge base requirements
- `docs/modules/admin/ONBOARDING.md` — onboarding checklist includes data quality

---

## Purpose

This document defines what data must exist and at what completeness level before each AI feature activates. It also defines the data completeness scoring system and how schools are guided to improve their data quality.

---

## Why Data Quality Is the Central AI Constraint

The most common failure mode for educational AI is generating confident-sounding insights from incomplete data. A principal who receives an AI report saying "Grade 9A has excellent attendance" when only 3 of 5 teachers have been marking attendance will lose trust in the entire system.

ZSMS AI prevents this explicitly:
- Every insight shows the data completeness score used to generate it
- Insights from incomplete data are flagged visually
- Schools below minimum threshold see data improvement guidance, not misleading insights

---

## Data Requirements by AI Feature

### System 1 — Smart Analytics

| Insight Type | Minimum Data Required | Minimum Completeness |
|---|---|---|
| Class performance overview | Marks entered for current term | 60% marks completeness |
| Attendance heatmap | Attendance marked this month | 70% attendance completeness |
| At-risk student flags | Both marks AND attendance | 70% both combined |
| Fee collection rate | Fee records generated | No gate — fee data is binary |
| Term-over-term comparison | Data from 2 consecutive terms | 60% for both terms |

### System 2 — AI Assistant

The assistant responds to any question but flags data gaps:

```
Low completeness response example:

"Grade 9A has 3 students scoring below 50% based on the marks entered so far.
Note: Marks are only 45% complete for this term — 4 subjects still have no
marks entered. The at-risk list may be incomplete."
```

The assistant never refuses to respond due to low completeness. It always answers with what data is available and is explicit about gaps.

### System 3 — Lesson Planner

The lesson planner has NO dependency on school data completeness. It relies on the AfriTech curriculum knowledge base — not the school's operational data. A school with 0% data completeness can still use the lesson planner.

**Knowledge base requirements:**
- Curriculum type selected by teacher (ECZ, Cambridge, etc.)
- Subject and grade level specified
- Relevant content exists in the knowledge_base table for that curriculum/subject/grade

### System 4 — Predictive Intelligence (Phase 4)

Minimum requirements before any predictive model is built:

- 18+ months of consistent ZSMS data (not just registered — actively used)
- 50+ schools contributing data
- Marks completeness >= 80% across contributing schools
- Attendance completeness >= 80% across contributing schools
- At least 2 complete academic years (not just terms) to detect year patterns
- Do not start Phase 4 without a data scientist reviewing the dataset

---

## The Data Completeness Score

Calculated on demand for every school that has AI features enabled.

### Calculation

```typescript
interface DataCompletenessScore {
  attendance_completeness: number    // 0-100
  marks_completeness: number         // 0-100
  parent_link_completeness: number   // 0-100
  overall_score: number              // Weighted composite
  ai_insights_unlocked: boolean      // overall_score >= 70
  limited_insights: boolean          // overall_score >= 50 but < 70
  missing_items: MissingDataItem[]
}

// Weights
const WEIGHTS = {
  attendance: 0.40,
  marks: 0.40,
  parent_links: 0.20,
}

// Attendance completeness
// = (days with attendance marked for ALL active classes) / (total school days this term)
// A day counts as marked only if EVERY active class has at least one attendance record

// Marks completeness
// = (exam_results rows filled) / (expected rows: students × subjects × current term)

// Parent link completeness
// = (students with at least one active linked parent) / (total active students)
```

### Thresholds and Gating

| Overall Score | Status | AI Features Available |
|---|---|---|
| >= 70% | Full | All analytics, early warning, AI assistant with full confidence |
| 50-69% | Limited | Analytics with data quality warnings on every insight |
| < 50% | Locked | Data improvement guidance only — no insights shown |

### Missing Items Detail

When completeness is below threshold, specific missing items are listed:

```typescript
interface MissingDataItem {
  category: 'attendance' | 'marks' | 'parent_links'
  description: string
  affected_count: number
  action_url: string  // Deep link to fix the issue
}

// Examples:
[
  {
    category: 'attendance',
    description: 'Grade 8B attendance not marked for 12 school days this term',
    affected_count: 12,
    action_url: '/attendance/grade_8b'
  },
  {
    category: 'marks',
    description: 'Mathematics marks not entered for 3 classes (Grade 9A, 9B, 10A)',
    affected_count: 3,
    action_url: '/results/enter-marks'
  },
  {
    category: 'parent_links',
    description: '23 students have no linked parent account',
    affected_count: 23,
    action_url: '/students/unlinked-parents'
  }
]
```

---

## Data Quality UI

### School Admin View — AI & Insights Panel

When analytics features are enabled but completeness is low:

```
AI Insights — Sunrise Academy

Data Completeness: 58% (Limited Insights)

To unlock full AI insights, improve data completeness to 70%.

Attendance: 71% ✅
  Grade 8B is missing attendance records for 12 days.
  [Mark attendance for Grade 8B →]

Marks: 45% ⚠️
  Mathematics marks not entered for Grade 9A, 9B, 10A.
  Results for Biology not entered for any class.
  [Enter outstanding marks →]

Parent Links: 78% ✅
  23 students have no linked parent.
  [View unlinked students →]

[View limited insights anyway]
```

The "View limited insights anyway" option shows analytics with prominent orange warning banners on every chart and insight.

---

## Coaching Schools to Improve Data Quality

Data quality improvement is an AfriTech responsibility, not just a technical gate.

### Automated Coaching (Weekly Email)

Schools with completeness below 70% receive a weekly email:

```
Subject: Improve your ZSMS data quality to unlock AI insights

Hi [School Name] Team,

Your current data completeness score is 58%.
Unlock AI-powered insights by completing these steps:

1. Mark Grade 8B attendance (12 missing days)
   → Takes about 5 minutes
   [Mark attendance →]

2. Enter Mathematics marks for Grade 9A and 9B
   → Ask your Mathematics teacher to log in and enter marks
   [Enter marks →]

Reaching 70% will unlock:
✓ At-risk student detection
✓ Class performance trends
✓ AI assistant for your school

[View your data quality dashboard →]
```

### Onboarding Checklist Integration

Data quality is part of the onboarding checklist:

```typescript
// New checklist item added post-onboarding
{
  item_key: 'first_attendance_week',
  description: 'All classes have attendance marked for the first full school week',
  weight: 8,
  // Part of the 60% "important" category
}
```

### AfriTech Monitoring

The AfriTech admin panel shows data completeness for all schools:

```
Admin → Platform → Data Quality

Schools with AI features enabled: 23

Completeness distribution:
>= 70% (Full insights): 14 schools (61%)
50-69% (Limited):        6 schools (26%)
< 50% (Locked):          3 schools (13%)

Schools declining in completeness (last 30 days):
  Heritage Academy: 75% → 58% (Grade 10 teacher not marking attendance)
  [Contact school →]
```

AfriTech regional managers are alerted when a school's completeness drops below 60% so they can proactively reach out.

---

## Subject Matter Experts and Knowledge Base Quality

For the lesson planner (System 3), data quality means knowledge base quality — not school operational data.

### Knowledge Base Quality Signals

| Signal | Measurement | Target |
|---|---|---|
| Similarity score average | Mean cosine similarity of retrieved chunks | >= 0.75 |
| Teacher rating of generated plans | 1-5 star rating per generated plan | >= 4.0 |
| Topics with no relevant chunks | Queries returning 0 results above threshold | 0% for core topics |
| Knowledge base freshness | Age of content vs current syllabus version | < 1 year old |

### Knowledge Base Gaps

When a teacher requests a lesson plan for a topic with insufficient knowledge base coverage:

```
Lesson Plan Generated — Limited Curriculum Data

This lesson plan was generated with limited curriculum-specific content.
The ECZ Grade 11 Further Mathematics syllabus is not yet in our knowledge base.

The plan uses general Mathematics principles and may not perfectly align
with the specific ECZ Grade 11 Further Mathematics objectives.

AfriTech is expanding the knowledge base to include Further Mathematics.
Expected: Q3 2027.

[Rate this plan]  [Request knowledge base expansion for this topic →]
```

Teacher feedback via the rating system and expansion requests directly informs AfriTech's knowledge base content priorities.

---

## Business Rules

1. The data completeness score is calculated fresh on every AI feature page load — never served from a stale cache for gating decisions.
2. Schools cannot override their own data completeness score — it is calculated from actual data records, not self-reported.
3. The lesson planner knowledge base has no school-level data dependency. A brand new school can use the lesson planner immediately.
4. Phase 4 predictive intelligence is not built until the platform-wide minimum data requirements are met. Individual schools with good data do not unlock Phase 4 early.
5. AfriTech is alerted (via platform metrics) when more than 20% of AI-enabled schools drop below 60% completeness — this signals a product problem, not just a school compliance problem.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | AI module — data quality is the central constraint |
| 2026-04-26 | Lesson planner has no school data dependency | RAG from knowledge base only — independent of school operations |
| 2026-04-26 | Phase 4 minimum requirements defined | Prevents premature ML development on insufficient data |
