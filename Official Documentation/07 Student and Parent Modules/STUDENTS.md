# STUDENTS.md — Student Management

## Related Documents

- `docs/modules/students/STUDENT_ID.md` — ID format
- `docs/modules/students/BULK_IMPORT.md` — batch student import
- `docs/modules/students/PARENT_LINKING.md` — parent account linking
- `docs/modules/students/TRANSFER.md` — student transfer between schools
- `docs/DATABASE.md` — students, alumni_profiles tables
- `docs/RLS.md` — student access policies

---

## Purpose

This document defines the complete student lifecycle in ZSMS — enrollment, active management, graduation, and the alumni account model. Every Claude Code session building any student management feature must read this document.

---

## Student Lifecycle

```
Self-registration OR Bulk import
          ↓
     Active Student
  (alumni_status = NULL)
          ↓
   ┌──────┴──────┐
Graduate      Transfer
   ↓               ↓
alumni_status    alumni_status
= 'graduated'    = 'transferred'
   ↓               ↓
   └──────┬──────┘
    Alumni Profile
   (permanent access
    to historical data)
```

---

## Student Record

Core fields on `public.students`:

```sql
id                UUID PRIMARY KEY
school_id         UUID — tenant scope
student_id        TEXT — 'STU-ZM-LSK-0001-00042' (human-readable)
first_name        TEXT NOT NULL
last_name         TEXT NOT NULL
date_of_birth     DATE
gender            TEXT
grade_id          TEXT — current grade
class_id          TEXT — current class
is_boarding       BOOLEAN DEFAULT FALSE
enrolment_date    DATE
examination_number TEXT
-- ECZ/Cambridge candidate number — optional, set for Grade 6, Form 4, Form 6
alumni_status     TEXT CHECK (alumni_status IN ('active','graduated','transferred'))
-- NULL = currently enrolled
clerk_user_id     TEXT — set when student activates their own portal account
photo_url         TEXT — R2 path
is_deleted        BOOLEAN DEFAULT FALSE
created_at        TIMESTAMPTZ
updated_at        TIMESTAMPTZ
```

---

## Examination Number

`students.examination_number` is an optional field for the ECZ or Cambridge candidate registration number assigned to students for national examinations.

**When to set it:**
- Grade 6 students (ECZ Primary Leaving Examination)
- Form 4 / Grade 12 students (ECZ O-Level or Cambridge IGCSE)
- Form 6 students (ECZ A-Level or Cambridge A-Level)

**When it appears:**
- On generated report cards for examination classes
- In the marks entry screen alongside the student's name (so teachers can cross-reference physical mark sheets that use candidate numbers)
- On the student's profile page

**Not required for:** Grade 1-5, 7-11 students (internal assessment only). The field is always optional — schools that manage examination numbers externally can leave it blank.

---

## Graduation Flow

When a student completes their final year (e.g. Form 6 or Grade 12):

**Step 1 — Admin initiates graduation**

```
Students → Grade 12 / Form 6 → [Graduate Class]

Graduate all students in this class:
Academic year: 2026
Final grade: Form 6

This will:
✓ Mark all 38 students as 'graduated'
✓ Create alumni profiles for each student
✓ Send graduation notification to parents
✓ Prompt parents to opt in to AfriTech alumni benefits

[Graduate Class]   [Graduate individually instead]
```

**Step 2 — System processing**

```typescript
async function graduateStudent(studentId: string, academicYear: string): Promise<void> {
  // 1. Update student record
  await supabaseAdmin
    .from('students')
    .update({
      alumni_status: 'graduated',
      updated_at: new Date().toISOString(),
    })
    .eq('id', studentId)

  // 2. Get all linked parents
  const links = await getStudentParentLinks(studentId)

  for (const link of links) {
    // 3. Create alumni profile if not already exists
    await supabaseAdmin
      .from('alumni_profiles')
      .upsert({
        clerk_user_id: link.parent_user_id,
        original_student_ids: [studentId],  // appended if profile already exists
        original_school_ids: [link.school_id],
        graduation_year: parseInt(academicYear),
        last_grade_completed: student.grade_id,
        marketing_opt_in: false,  // always default FALSE
      }, {
        onConflict: 'clerk_user_id',
        // On conflict: append to original_student_ids array
      })

    // 4. Convert parent's Clerk role from org:parent to platform:alumni
    //    (done only when ALL their children have graduated)
    const hasActiveChildren = await checkParentHasActiveChildren(link.parent_user_id)
    if (!hasActiveChildren) {
      await convertToAlumniRole(link.parent_user_id)
    }
  }

  // 5. Send graduation WhatsApp notification
  await enqueueJob('send-whatsapp', {
    template_id: 'graduation_notification',
    school_id: student.school_id,
    student_id: studentId,
  })
}
```

**Step 3 — Marketing opt-in prompt**

After graduation notification, parents see a prompt in their portal:

```
Chanda has graduated! 🎓

Congratulations on Chanda's completion of Form 6.

Stay connected with AfriTech for:
✓ Scholarship opportunities for Zambian graduates
✓ University application guidance
✓ Study abroad programmes
✓ Career opportunities

☐ Yes, I'd like to receive opportunities from AfriTech
   (You can unsubscribe at any time)

[Continue to your account]
```

The checkbox is never pre-ticked. `parents.marketing_opt_in` is only set to TRUE if the parent explicitly checks the box.

---

## What Alumni Can Access

After graduation, parents (now `platform:alumni`) retain permanent read-only access:

| Data | Access | Notes |
|---|---|---|
| Report cards | ✅ Full history | PDF download via alumni portal |
| Payment receipts | ✅ Full history | PDF download |
| Fee statements | ✅ Full history | On-demand generation |
| Attendance records | ✅ Read only | Summary view |
| Exam results | ✅ Full history | All published results |
| Attendance certificates | ✅ On demand | For university/scholarship applications |
| Transfer letters | ✅ If applicable | Permanent document access |
| Current school data | ❌ No access | School operations are read-only post-graduation |
| Other students' data | ❌ Never | Only their own graduated children |

---

## Student Portal Access

Students can activate their own ZSMS portal account:

```
Student activates account:
→ Visit zsms.co.zm/portal/student
→ Enter student ID: STU-ZM-LSK-0001-00042
→ Clerk creates account, email OTP sent
→ Student portal activated (30-day session)

Student portal access:
✓ Own results (published only)
✓ Own timetable
✓ School announcements
✓ Own attendance summary
✗ Fee data (parent portal only)
✗ Other students' data
```

After graduation, the student's `org:student` session ends. If they want to access historical records, they use the alumni portal (`platform:alumni`).

---

## Student Grade Promotion

At the start of a new academic year, admins promote all students to the next grade:

```
Students → Year-End → Promote All Students

Academic year: 2026 → 2027

All students move up one grade:
  Grade 8A → Grade 9A
  Grade 9B → Grade 10B
  Form 5   → Form 6

Students in the final year will be graduated separately.

[Preview promotion]   [Run promotion]
```

This is a bulk UPDATE on the `students` table updating `grade_id` for all active non-graduating students.

---

## Business Rules

1. `examination_number` is optional for all grades. It should be set for examination classes (Grade 6, Form 4, Form 6) but ZSMS never blocks operations due to a missing examination number.
2. `alumni_status` is set to `'graduated'` or `'transferred'` by the graduation/transfer flow. It is never set manually by teachers or admins without going through the proper flow.
3. A parent retains their school role (`org:parent`) as long as they have at least one active (non-alumni) child. The switch to `platform:alumni` happens only when all their children have left the school.
4. `marketing_opt_in` is captured at graduation time and defaults to FALSE. It is never pre-ticked, pre-set, or defaulted to TRUE under any circumstances.
5. Alumni access to historical documents uses the same signed URL system as active parents. Signed URLs are generated fresh on each request — the documents are never deleted from R2 while the school account exists.
6. Student photos are deleted from R2 one year after the student's `alumni_status` is set — PII minimisation.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Student management reference |
| 2026-04-26 | Added examination_number field | ECZ/Cambridge candidate number requirement |
| 2026-04-26 | Added alumni status lifecycle | Graduated account model confirmed |
| 2026-04-26 | Added alumni data access table | What alumni can and cannot access |
| 2026-04-26 | Added marketing opt-in flow at graduation | Opt-in captured at graduation — never pre-ticked |
