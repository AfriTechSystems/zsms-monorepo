# TRANSFER.md — Student Transfer

## Related Documents

- `docs/modules/students/STUDENTS.md` — student lifecycle
- `docs/modules/students/PARENT_LINKING.md` — parent account persistence
- `docs/modules/documents/STORAGE.md` — transfer letter storage in R2
- `docs/DATABASE.md` — students.alumni_status, student_parent_links

---

## Implementation Status (2026-10-11)

**Built end to end, including the letter.**

The external transfer and withdrawal flow lives on the pupil's own page —
`/school/[code]/students/[id]`, exactly where this document says — calling
`transfer_student()` through `POST /api/school/students/year-end`.

**The transfer letter was the gap, and it is closed.** `transfer_letter` had been an
allowed `doc_type` since `0087`, a type in `packages/documents`, and listed in
`/api/documents` — and nothing ever rendered one. A school transferring a pupil had no
letter for the family, which is the one physical artefact a transfer produces.

- `renderTransferLetter()` produces it to the contents specified below.
- `0246` adds `worker_transfer_letter_context()` and `next_transfer_reference()`.
- The job is **queued**, not rendered in the request, so the pupil's status still changes
  when R2 is briefly unavailable — the status must not fail; the letter is retryable.
- Stored at `{school_id}/documents/transfers/{reference}.pdf`, as specified, because a
  registrar may be handed a signed URL years later and a path that moved between releases
  is a link that stopped working for the document people keep longest.
- The checkbox is ticked by default, as recommended here.

The reference counts letters already issued rather than using a sequence: a sequence
would also number transfers whose letter failed to render, so the reference would drift
from the letters that exist.

**Alumni access after transfer is built** — `0239` keys pupil access on
`students.clerk_user_id` and never on the organisation claim, so a transferred pupil
keeps reading their own history. See ADR-046.

**Not built:** the marketing opt-in prompt at transfer. `parents.marketing_opt_in`
exists and defaults FALSE (`0229`); the prompt described below is a screen nobody has
written yet.

---

## Purpose

This document defines the student transfer flow — how a student moves from one school to another, what happens to their historical data at the origin school, and how parents and students retain permanent read-only alumni access after transfer.

---

## Transfer Types

| Type | Description |
|---|---|
| Internal transfer | Student moves between classes at the same school |
| External transfer | Student leaves the school entirely (to another school or unknown destination) |
| Withdrawal | Student leaves ZSMS entirely (homeschooling, moved country, etc.) |

This document covers **external transfers** and withdrawals. Internal transfers are a simple class reassignment with no special processing.

---

## Initiating an External Transfer

**Location:** Students → [Student Name] → Transfer Student

```
Transfer: Chanda Bwalya (STU-ZM-LSK-0001-00042)

Transfer type:
● Transfer to another school
○ Withdrawal (no destination school)

Destination school (if known):
[Heritage Academy]   or   [Unknown / Not specified]

Transfer date: [15 Sep 2026]
Reason (internal only, not shown to parents):
[Family relocated]

Generate transfer letter: ☑ (recommended)

This will:
✓ Mark Chanda as 'transferred' (alumni_status = 'transferred')
✓ Generate a transfer letter PDF
✓ Create an alumni profile for Chanda's parents
✓ Prompt parents to opt in to AfriTech alumni benefits
✓ Start the 30-day grace period for parent access

[Complete Transfer]   [Cancel]
```

---

## Transfer Processing

```typescript
async function processExternalTransfer(
  studentId: string,
  transferDate: string,
  destinationSchool: string | null,
  reason: string
): Promise<void> {

  const student = await getStudent(studentId)

  // 1. Update student record
  await supabaseAdmin
    .from('students')
    .update({
      alumni_status: 'transferred',
      updated_at: new Date().toISOString(),
    })
    .eq('id', studentId)

  // 2. Generate transfer reference
  const transferRef = generateTransferReference(student.school_id)
  // Format: TRF-ZM-LSK-0001-00042-2026

  // 3. Generate transfer letter PDF
  const transferLetterKey = await generateTransferLetter({
    student,
    transferDate,
    destinationSchool,
    transferRef,
  })

  // 4. Get all linked parents
  const parentLinks = await getStudentParentLinks(studentId)

  for (const link of parentLinks) {
    // 5. Create alumni profile (upsert — parent may already have one from another child)
    await upsertAlumniProfile({
      clerk_user_id: link.parent_user_id,
      studentId: studentId,
      schoolId: student.school_id,
      lastGradeCompleted: student.grade_id,
    })

    // 6. Start grace period on the parent link
    await supabaseAdmin
      .from('student_parent_links')
      .update({
        is_active: false,
        grace_period_ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        // 30 days grace
      })
      .eq('student_id', studentId)
      .eq('parent_user_id', link.parent_user_id)

    // 7. Check if parent has other active children at this school
    const hasActiveChildren = await checkParentHasActiveChildren(
      link.parent_user_id,
      student.school_id
    )

    if (!hasActiveChildren) {
      // No more active children — convert to alumni role
      await convertToAlumniRole(link.parent_user_id, student.school_id)
    }
    // If they have other active children, org:parent role is retained
  }

  // 8. Notify parents with transfer letter
  await enqueueJob('send-whatsapp', {
    template_id: 'student_transfer_notification',
    school_id: student.school_id,
    variables: [student.first_name, destinationSchool ?? 'another school', transferRef],
  })

  // 9. Show marketing opt-in prompt in parent portal
  await createAlumniOptInPrompt(parentLinks.map(l => l.parent_user_id))
}
```

---

## Marketing Opt-In at Transfer

After receiving the transfer notification, parents see a prompt in their portal (same as graduation flow):

```
Chanda has been transferred.

Thank you for being part of our school community.
Chanda's complete academic records remain available in your account.

Stay connected with AfriTech for:
✓ Scholarship opportunities
✓ Educational resources
✓ Community updates

☐ Yes, I'd like to receive opportunities from AfriTech
   (Maximum 4 messages per month — unsubscribe anytime)

[Continue to my account]
```

The checkbox is never pre-ticked. `parents.marketing_opt_in` is set to TRUE only if the parent explicitly checks the box and clicks continue.

---

## Alumni Access After Transfer

After transfer, the parent retains permanent read-only access to the transferred student's historical records at the origin school:

| Data | Access | Notes |
|---|---|---|
| All previous report cards | ✅ Permanent | Download from alumni portal |
| All payment receipts | ✅ Permanent | Financial records |
| Fee statements | ✅ Permanent | On-demand generation |
| Attendance history | ✅ Permanent | Full historical record |
| Transfer letter | ✅ Permanent | 30-day signed URL, regenerable |
| Attendance certificate | ✅ On demand | For new school enrollment |
| Current school data | ❌ After grace period | 30 days then read-only historical only |

The 30-day grace period gives parents time to download any documents they need for the student's enrollment at the new school.

---

## Transfer Letter Contents

The transfer letter is a formal PDF document confirming:
- Student's full name and student ID
- School name and Ministry of Education registration number
- Date of enrollment and date of transfer
- Final grade level completed
- Principal's name and signature line
- School stamp area
- Transfer reference number

Generated using `@react-pdf/renderer` in the document templates system. Stored in R2:
```
zsms-public-zm/{school_id}/documents/transfers/{transfer_reference}.pdf
```
Signed URL expiry: 30 days (parent may need to present it at the new school).

---

## Historical Access at Origin School

The origin school (the school the student left) retains all student records permanently. Admins and principals at the origin school can still view the transferred student's full history for audit, reporting, and in case of disputes.

The student's record is **never deleted** — only marked `alumni_status = 'transferred'`. It remains fully queryable by the school's staff.

---

## Arrival at a New ZSMS School

If the transferred student enrolls at another ZSMS school:
- A new student record is created at the new school (new student ID)
- The old student record at the origin school remains intact
- There is no automatic data transfer between schools
- The parent can share documents (report cards, certificates) manually
- Future consideration (Phase 3): a formal ZSMS-to-ZSMS student record transfer with consent

---

## Business Rules

1. External transfers set `alumni_status = 'transferred'` — they do not delete the student record.
2. The 30-day grace period starts immediately on transfer completion. Parent access to current school data (new records created after transfer date) ends after grace period.
3. Historical records (all data created before transfer date) remain accessible to the parent permanently via the alumni portal.
4. `marketing_opt_in` is prompted at transfer but never pre-ticked. Default is always FALSE.
5. If a parent has other active children at the same school, their `org:parent` role is retained. The alumni access is added in addition to, not instead of, their existing parent access.
6. The transfer letter PDF is stored permanently in R2 — it is never deleted. Fresh signed URLs can be generated years later for alumni portal access.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Student transfer reference |
| 2026-04-26 | Added alumni historical access after transfer | Graduated account model — transfers same as graduation |
| 2026-04-26 | Added marketing opt-in at transfer flow | AfriTech alumni marketing opt-in captured at departure |
| 2026-04-26 | Clarified parent role retention with other active children | Parent keeps org:parent if other children still enrolled |
