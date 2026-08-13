# BULK_GENERATION.md — Bulk Report Card Generation

## Related Documents

- `docs/modules/results/RESULTS.md` — marks that must be complete before generation
- `docs/modules/results/REPORT_CARDS.md` — report card design and template
- `docs/modules/results/PUBLISHING.md` — publishing triggers generation option
- `docs/infra/QSTASH.md` — batch job queue for parallel generation
- `docs/infra/R2.md` — PDF storage paths and signed URLs
- `docs/infra/SUPABASE.md` — Realtime subscription for progress updates
- `docs/api/EDGE_FUNCTIONS.md` — generate-report-card Edge Function
- `docs/DATABASE.md` — report_generation_jobs table

---

## Purpose

This document defines the complete bulk report card PDF generation system — the pre-generation validation, the queued batch job architecture, how progress is tracked and broadcast in real time, what happens when individual batches fail, and how the completed run triggers parent distribution. Every Claude Code session building the bulk generation feature must read this document.

---

## Overview

Bulk generation is the most computationally intensive operation in ZSMS. A school with 400 students generates 400 PDFs simultaneously across multiple parallel queued batch jobs. The principal triggers the generation, watches a live progress counter, and when complete can trigger WhatsApp distribution to all parents. The design ensures the principal's browser never times out, other school operations are unaffected, and a failed batch does not fail the entire generation run.

---

## Pre-Generation Validation

Before any PDF is generated, a completeness check runs against all marks for the term and class selection.

**Location:** Results → [Term] → Generate Report Cards

```
Pre-Generation Check — Term 2, 2026

Checking 412 students across 12 classes...

✅ Grade 7A:   All 38 subjects × students complete
✅ Grade 7B:   All 38 subjects × students complete
✅ Grade 8A:   All 40 subjects × students complete
✅ Grade 8B:   All 40 subjects × students complete
✅ Grade 9A:   All 38 subjects × students complete
⚠️ Grade 9B:   3 students missing Chemistry marks
   Missing: Chanda Bwalya, Peter Banda, Mary Phiri
✅ Form 1A:   All 35 subjects × students complete
✅ Form 1B:   All 35 subjects × students complete
...

Issues found: 3 students with missing marks in Grade 9B

[Fix issues first]   [Generate anyway — skip affected students]
```

**"Fix issues first"** — Returns the principal to marks entry for Grade 9B Chemistry.

**"Generate anyway"** — Generates report cards for all students except those with missing marks. The 3 skipped students are listed in the post-generation summary and the principal can regenerate their cards individually after the marks are entered.

This validation query runs server-side:

```typescript
// POST /api/reports/generate — pre-validation step
async function validateMarksCompleteness(
  schoolId: string,
  academicYear: string,
  termNumber: number
): Promise<ValidationResult> {
  const { data: issues } = await supabase.rpc('check_marks_completeness', {
    p_school_id: schoolId,
    p_academic_year: academicYear,
    p_term_number: termNumber,
  })
  return { hasIssues: issues.length > 0, issues }
}
```

---

## Generation Architecture

### Batch Size

Each queued batch job processes **30–35 students**. This batch size is determined by:
- Edge Function memory limit (512MB) — a batch of 35 PDFs with student photos fits comfortably
- Edge Function timeout (50 seconds) — 35 PDFs at ~1.5 seconds each = ~52 seconds (tight but manageable with efficient rendering)
- Optimal parallelism — smaller batches mean more parallel jobs but more per-job overhead

```typescript
const BATCH_SIZE = 35

async function queueGenerationBatches(
  schoolId: string,
  runId: string,
  studentIds: string[],
  academicYear: string,
  termNumber: number
): Promise<number> {
  const batches = chunk(studentIds, BATCH_SIZE)
  let jobsQueued = 0

  for (const batch of batches) {
    // Create tracking row
    await supabase.from('report_generation_jobs').insert({
      school_id: schoolId,
      run_id: runId,
      class_id: 'batch',
      academic_year: academicYear,
      term_number: termNumber,
      total_students: batch.length,
      completed_students: 0,
      status: 'queued',
    })

    // Queue queued job
    await enqueueJob('generate-report-card', {
      school_id: schoolId,
      run_id: runId,
      student_ids: batch,
      academic_year: academicYear,
      term_number: termNumber,
    })

    jobsQueued++
  }

  return jobsQueued
}
```

### Parallel Execution

For a school with 420 students:
- 420 ÷ 35 = 12 batch jobs
- All 12 jobs enqueued simultaneously
- The queue delivers them to 12 worker instances running in parallel
- Total wall-clock time ≈ time for the slowest single batch (~60-90 seconds)
- NOT 12 × 90 seconds = the batches run concurrently, not sequentially

This is the critical insight to communicate to principals:
```
"Generating 420 report cards...
 This typically takes 60–90 seconds regardless of school size."
```

---

## Progress Tracking with Supabase Realtime

The principal's browser subscribes to changes on `report_generation_jobs` for the current `run_id`. As each batch completes and updates its `completed_students` count, the frontend receives the update via WebSocket and updates the progress bar.

### Frontend Subscription

```typescript
// apps/web/app/(dashboard)/results/generate/page.tsx
const [progress, setProgress] = useState({ completed: 0, total: totalStudents })

useEffect(() => {
  const subscription = supabase
    .channel(`generation-${runId}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'report_generation_jobs',
      filter: `run_id=eq.${runId}`,
    }, (payload) => {
      setProgress(prev => ({
        ...prev,
        completed: prev.completed + payload.new.completed_students - payload.old.completed_students,
      }))
    })
    .subscribe()

  return () => supabase.removeChannel(subscription)
}, [runId])
```

### Principal's Progress View

```
Generating Report Cards — Term 2, 2026
━━━━━━━━━━━━━━━━━━━━━━━━━━━░░░░░░░░░   247 of 420 complete (58%)
                                        Estimated time remaining: 35 seconds

Running: 12 batches in parallel

You can close this window — generation continues in the background.
You'll receive a notification when complete.
```

The "You can close this window" message is important — the principal does not need to keep the browser open. Generation continues regardless. If they close the browser and return later, the progress page reloads the current status from `report_generation_jobs`.

---

## The `generate-report-card` Edge Function

Each batch job processes its assigned students sequentially within the Edge Function:

```typescript
// supabase/functions/generate-report-card/index.ts
for (const studentId of studentIds) {
  try {
    // 1. Fetch all data for this student
    const [student, results, attendance, template, school] = await Promise.all([
      getStudent(studentId),
      getTermResults(studentId, academicYear, termNumber),
      getTermAttendance(studentId, academicYear, termNumber),
      getDocumentTemplate(schoolId, 'report_card'),
      getSchool(schoolId),
    ])

    // 2. Calculate grades (from stored values — already calculated on marks entry)
    const gradingScale = await resolveGradingScale(schoolId, student.level_type)
    const classPosition = await getClassPosition(studentId, classId, academicYear, termNumber)

    // 3. Fetch school logo (with short-lived signed URL for rendering)
    const logoDataUrl = school.logo_url
      ? await fetchLogoAsDataUrl(school.logo_url)
      : null

    // 4. Render PDF
    const pdfBuffer = await renderReportCardPdf({
      school,
      student,
      results,
      attendance,
      classPosition,
      template,
      logoDataUrl,
      academicYear,
      termNumber,
    })

    // 5. Upload to R2
    const r2Key = `${school.school_id}/reports/${academicYear}/term${termNumber}/${student.class_id}/${studentId}.pdf`
    await uploadToR2(R2_PUBLIC_BUCKET, r2Key, pdfBuffer)

    // 6. Update exam_results with pdf_url reference
    await supabaseAdmin
      .from('exam_results')
      .update({ report_card_url: r2Key })
      .eq('student_id', studentId)
      .eq('academic_year', academicYear)
      .eq('term_number', termNumber)

    // 7. Increment progress counter (triggers Realtime update)
    await supabaseAdmin
      .from('report_generation_jobs')
      .update({
        completed_students: supabase.raw('completed_students + 1'),
        status: 'processing',
      })
      .eq('run_id', runId)
      .eq('class_id', student.class_id)

  } catch (studentError) {
    // Log individual student failure but continue with next student
    console.error(`Failed to generate for student ${studentId}:`, studentError)
    failedStudents.push({ studentId, error: studentError.message })
  }
}
```

**Per-student error isolation:** If one student's PDF fails (e.g. corrupted photo causing a rendering error), the batch continues for all other students. The failed student is logged and appears in the post-generation summary for manual retry.

---

## Batch Failure Handling

If an entire batch job fails (Edge Function timeout, R2 connection error, memory overflow):

```
Generation Summary — Term 2, 2026

✅ 395 report cards generated successfully
❌   25 students failed (Grade 9B batch — timeout error)

Failed students:
  [List of 25 student names with error details]

[Retry failed students]   [Download error report]
```

The "Retry failed students" button re-queues only the failed students as a new batch. The `run_id` remains the same — their progress adds to the original run's counter.

**Why batches can fail:**
- Edge Function timeout (50 seconds) — a batch with many students who have large photo files
- R2 connection timeout — transient Cloudflare outage
- Memory limit — unusual edge case with very complex template

**Prevention:**
- Student photos are compressed to under 200KB before storage — prevents memory issues
- Logo is fetched as a data URL before the PDF loop — one fetch for the whole batch
- `marks_total` is validated — prevents division-by-zero in percentage calculation

---

## Post-Generation: Parent Distribution

When generation completes, the principal sees:

```
✅ 420 report cards generated successfully

What would you like to do next?

[📱 Send report cards to all parents via WhatsApp]   ← uses school quota
[📧 Send to parents with email addresses]             ← free
[↓ Download all as ZIP]                               ← for school records
[Done — parents can access from portal]               ← no action needed
```

**WhatsApp distribution:** Queues 420 WhatsApp jobs with rate limiting (60 messages/minute per Meta limits). Consumes from school's monthly quota. A 420-message batch at the Starter tier (500/month) would use 84% of the monthly quota — the system warns the principal before they confirm.

**Email distribution:** Sends to all parents with email addresses. Free via Resend. No quota impact.

**Portal access:** Report cards are available in the parent portal immediately after generation, even without any WhatsApp or email notification. Parents who check the portal regularly will find their child's report card without needing to receive a message.

---

## Business Rules

1. Pre-generation validation is mandatory — it runs automatically when the principal navigates to generate. Skipping it (generating with missing marks) is allowed but requires explicit confirmation.
2. Each batch job processes 30–35 students. Batch size is fixed in the Edge Function — not configurable per school.
3. Individual student failures within a batch do not fail the whole batch. Other students in the batch continue generating.
4. A failed entire batch is retried independently without affecting successfully generated batches.
5. The `run_id` connects all batch jobs for one generation run. Progress counters aggregate across all jobs with the same `run_id`.
6. Report cards are stored in R2 immediately after generation. The parent portal shows download links as each individual report card is generated — parents of students in early batches can download before the full run completes.
7. WhatsApp distribution after generation is optional. Parents can always access report cards from the portal.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 11 results module documentation |
| 2026-04-26 | Confirmed parallel batch architecture | Key to explaining 60-90 second total time |
| 2026-04-26 | Added per-student error isolation | Individual failures should not block entire batch |
| 2026-04-26 | Added WhatsApp quota warning on distribution | Schools need to know before consuming 84% of quota |
