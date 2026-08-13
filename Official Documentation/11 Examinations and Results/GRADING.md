# GRADING.md — Grading Calculation and Scale Reference

## Related Documents

- `docs/modules/results/RESULTS.md` — marks entry that triggers grade calculation
- `docs/modules/results/REPORT_CARDS.md` — grade display on report cards
- `docs/modules/results/PUBLISHING.md` — grade lock on publication
- `docs/modules/school/SCHOOL_CONFIG.md` — grading scale configuration per school
- `docs/countries/ZM.md` — Zambia ECZ and Cambridge grading scales
- `docs/DATABASE.md` — school_grading_scales table
- `docs/CONVENTIONS.md` — packages/utils/grading.ts utility

---

## Purpose

This document defines how raw marks are converted to grade letters, grade points, and aggregates using the school's configured grading scale. It covers all supported systems — ECZ percentage, Cambridge O-Level, Cambridge A-Level, and custom scales — and the edge cases that arise when a school uses multiple systems simultaneously. Every Claude Code session implementing grade calculation must read this document.

---

## Overview

Grade calculation is a pure function: given a mark, a total, and a grading scale configuration, the output is a grade letter, a grade point value, and a pass/fail indicator. This function lives in `packages/utils/grading.ts` and is used everywhere grades are calculated — in the mobile app for real-time display, in the server for stored grade values, and in report card generation.

The key design principle: **the application never hardcodes grading boundaries**. All boundaries come from the school's `school_grading_scales` table. This means adding a new grading system requires only a new database row — no code changes.

---

## The Grading Calculation Function

```typescript
// packages/utils/grading.ts

export interface GradeBand {
  letter: string          // 'A', 'B', 'C', 'A*', 'U' etc.
  descriptor: string      // 'Distinction', 'Merit', 'Pass' etc.
  min_percentage: number  // Minimum percentage for this grade (inclusive)
  max_percentage: number  // Maximum percentage for this grade (inclusive)
  points: number          // Grade point value for aggregate calculation
  is_passing: boolean     // Whether this grade counts as a pass
}

export interface GradingResult {
  grade_letter: string
  grade_points: number
  percentage: number
  is_passing: boolean
  descriptor: string
}

export function calculateGrade(
  marks_obtained: number,
  marks_total: number,
  gradeBands: GradeBand[]
): GradingResult {
  const percentage = (marks_obtained / marks_total) * 100
  const roundedPercentage = Math.round(percentage * 100) / 100  // 2 decimal places

  // Find matching grade band (bands sorted min→max, find first match from top)
  const band = gradeBands
    .sort((a, b) => b.min_percentage - a.min_percentage)
    .find(b => roundedPercentage >= b.min_percentage)

  if (!band) {
    // Below all bands — use the lowest band (fail)
    const lowestBand = gradeBands.reduce((prev, curr) =>
      curr.min_percentage < prev.min_percentage ? curr : prev
    )
    return {
      grade_letter: lowestBand.letter,
      grade_points: lowestBand.points,
      percentage: roundedPercentage,
      is_passing: lowestBand.is_passing,
      descriptor: lowestBand.descriptor,
    }
  }

  return {
    grade_letter: band.letter,
    grade_points: band.points,
    percentage: roundedPercentage,
    is_passing: band.is_passing,
    descriptor: band.descriptor,
  }
}
```

---

## Supported Grading Systems

### ECZ Percentage (Traditional Zambia)

Used by schools operating under the Examination Council of Zambia traditional system.

```typescript
const ECZ_PERCENTAGE_BANDS: GradeBand[] = [
  { letter: 'A', descriptor: 'Distinction', min_percentage: 80, max_percentage: 100, points: 1, is_passing: true },
  { letter: 'B', descriptor: 'Merit',       min_percentage: 65, max_percentage: 79,  points: 2, is_passing: true },
  { letter: 'C', descriptor: 'Credit',      min_percentage: 50, max_percentage: 64,  points: 3, is_passing: true },
  { letter: 'D', descriptor: 'Pass',        min_percentage: 40, max_percentage: 49,  points: 4, is_passing: true },
  { letter: 'E', descriptor: 'Weak Pass',   min_percentage: 30, max_percentage: 39,  points: 5, is_passing: false },
  { letter: 'F', descriptor: 'Fail',        min_percentage: 0,  max_percentage: 29,  points: 6, is_passing: false },
]
```

**Points system:** Lower aggregate = better performance (ECZ convention). Grade A = 1 point, F = 6 points. A student with all A grades has an aggregate of [number of subjects] × 1 = [number of subjects] points — the lowest possible aggregate.

**Credit count:** For ECZ O-Level students (Form 4), the credit count is the number of subjects with grade C or above. University entrance requires a minimum number of credits in specified subjects. The credit count is calculated and displayed on report cards:

```typescript
export function calculateCreditCount(results: GradingResult[]): number {
  return results.filter(r => r.is_passing && r.grade_points <= 3).length
  // Points 1 (A), 2 (B), 3 (C) = credit or above
}
```

---

### Cambridge O-Level (Forms 1–4)

Used by schools offering Cambridge International examinations.

```typescript
const CAMBRIDGE_O_LEVEL_BANDS: GradeBand[] = [
  { letter: 'A*', descriptor: 'Exceptional',   min_percentage: 90, max_percentage: 100, points: 1, is_passing: true },
  { letter: 'A',  descriptor: 'Excellent',     min_percentage: 80, max_percentage: 89,  points: 2, is_passing: true },
  { letter: 'B',  descriptor: 'Very Good',     min_percentage: 70, max_percentage: 79,  points: 3, is_passing: true },
  { letter: 'C',  descriptor: 'Good',          min_percentage: 60, max_percentage: 69,  points: 4, is_passing: true },
  { letter: 'D',  descriptor: 'Satisfactory',  min_percentage: 50, max_percentage: 59,  points: 5, is_passing: true },
  { letter: 'E',  descriptor: 'Minimum Pass',  min_percentage: 40, max_percentage: 49,  points: 6, is_passing: true },
  { letter: 'U',  descriptor: 'Ungraded',      min_percentage: 0,  max_percentage: 39,  points: 7, is_passing: false },
]
```

**Note on Cambridge grade boundaries:** Real Cambridge examinations set grade boundaries after each examination sitting based on cohort performance — they are not fixed percentages. The bands above are indicative defaults for internal school assessments. Schools running actual Cambridge examinations import their official results separately — ZSMS does not calculate Cambridge examination grades, only internal assessment grades.

---

### Cambridge A-Level (Forms 5–6)

```typescript
const CAMBRIDGE_A_LEVEL_BANDS: GradeBand[] = [
  { letter: 'A*', descriptor: 'Outstanding',   min_percentage: 90, max_percentage: 100, points: 1, is_passing: true },
  { letter: 'A',  descriptor: 'Excellent',     min_percentage: 80, max_percentage: 89,  points: 2, is_passing: true },
  { letter: 'B',  descriptor: 'Very Good',     min_percentage: 70, max_percentage: 79,  points: 3, is_passing: true },
  { letter: 'C',  descriptor: 'Good',          min_percentage: 60, max_percentage: 69,  points: 4, is_passing: true },
  { letter: 'D',  descriptor: 'Satisfactory',  min_percentage: 50, max_percentage: 59,  points: 5, is_passing: true },
  { letter: 'E',  descriptor: 'Pass',          min_percentage: 40, max_percentage: 49,  points: 6, is_passing: true },
  { letter: 'U',  descriptor: 'Ungraded',      min_percentage: 0,  max_percentage: 39,  points: 7, is_passing: false },
]
```

---

### Custom Grading Scale

Schools define their own bands in the grading scale configuration. Any number of bands with any boundaries. Requirements:
- Bands must be contiguous (no gaps between max of one band and min of next)
- At least one passing band
- At least one failing band
- All percentages between 0 and 100

Validation runs when the custom scale is saved:

```typescript
export function validateGradingScale(bands: GradeBand[]): string[] {
  const errors: string[] = []

  // Check for gaps
  const sorted = bands.sort((a, b) => a.min_percentage - b.min_percentage)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].min_percentage !== sorted[i-1].max_percentage + 1) {
      errors.push(`Gap between ${sorted[i-1].letter} and ${sorted[i].letter}`)
    }
  }

  // Check for overlaps
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].min_percentage <= sorted[i-1].max_percentage) {
      errors.push(`Overlap between ${sorted[i-1].letter} and ${sorted[i].letter}`)
    }
  }

  // Must have at least one passing and one failing grade
  const hasPassing = bands.some(b => b.is_passing)
  const hasFailing = bands.some(b => !b.is_passing)
  if (!hasPassing) errors.push('At least one passing grade is required')
  if (!hasFailing) errors.push('At least one failing grade is required')

  return errors
}
```

---

## Resolving Which Scale to Use

A school may use different grading systems for different level groups. The resolution order is:

1. **Subject-level override:** If `school_subjects.grading_scale_id` is set for this subject, use that scale
2. **Level-type default:** Look up the school's grading scale for the student's `level_type` (primary / junior_secondary / senior_secondary / a_level) in `school_academic_config`
3. **School default:** Use the school's default grading scale

```typescript
async function resolveGradingScale(
  schoolId: string,
  subjectCode: string,
  levelType: string
): Promise<GradeBand[]> {
  // 1. Check subject-level override
  const { data: subject } = await supabase
    .from('school_subjects')
    .select('grading_scale_id')
    .eq('school_id', schoolId)
    .eq('subject_code', subjectCode)
    .single()

  if (subject?.grading_scale_id) {
    return getGradingScaleBands(subject.grading_scale_id)
  }

  // 2. Level-type default from academic config
  const { data: config } = await supabase
    .from('school_academic_config')
    .select('grading_config')
    .eq('school_id', schoolId)
    .single()

  const levelScale = config?.grading_config?.[levelType]
  if (levelScale) {
    return getGradingScaleBands(levelScale)
  }

  // 3. School default
  const { data: scale } = await supabase
    .from('school_grading_scales')
    .select('grade_bands')
    .eq('school_id', schoolId)
    .eq('is_default', true)
    .single()

  return scale.grade_bands
}
```

---

## Aggregate Calculation

The aggregate is the sum of grade points across all subjects for a student in a term.

**ECZ convention (lower = better):**
```typescript
export function calculateAggregate(results: GradingResult[]): number {
  return results.reduce((sum, r) => sum + r.grade_points, 0)
}
// Student with all A grades (6 subjects): 1×6 = 6 (excellent)
// Student with all F grades (6 subjects): 6×6 = 36 (poor)
```

**Some Cambridge schools use higher = better (percentage-based):**
This is configured in the grading scale with `aggregate_direction: 'ascending' | 'descending'`. Ascending = higher aggregate is better (percentage total). Descending = lower aggregate is better (points total). The position ranking algorithm reads this config.

---

## Grade Override

A teacher can manually override a calculated grade with a reason. Used for:
- Coursework-based subjects where the final grade is not purely percentage-based
- Practical assessments that cannot be reduced to a single percentage
- Exceptional circumstances approved by the principal

```
Teacher opens marks entry for a student → clicks grade letter → "Override grade"
Override grade: [A* / A / B / C / D / E / U / F]
Reason (required): "Practical assessment — distinction awarded"
[Save override]
```

Overridden grades are visually marked on the marks entry screen and on the report card with an asterisk or footnote. The override and reason are stored in `exam_results.grade_override` and `exam_results.grade_override_reason`.

---

## Business Rules

1. Grade calculation is always derived from `(marks_obtained / marks_total) × 100` mapped against the school's configured grading scale. No hardcoded grade boundaries exist in application code.
2. When `marks_total` is changed after marks have been entered, all grade letters for that subject are automatically recalculated on the next marks save.
3. Grade overrides require a mandatory reason. Overridden grades are flagged visually in all views.
4. The credit count (C and above) is calculated and displayed only for ECZ O-Level students (Form 4 or Grade 10 where the school uses ECZ). It does not appear for primary students or A-Level students.
5. Aggregate calculation direction (ascending or descending) is configured per school per grading scale. The position ranking algorithm reads this configuration — it never assumes ECZ convention universally.
6. Custom grading scale validation runs on save — gaps, overlaps, and missing pass/fail bands are all rejected with specific error messages.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 11 results module documentation |
| 2026-04-26 | No hardcoded boundaries — all from database | School config flexibility confirmed |
| 2026-04-26 | Added grade override feature | Practical and coursework assessment requirement |
| 2026-04-26 | Added aggregate direction config | Some Cambridge schools use higher-is-better |
