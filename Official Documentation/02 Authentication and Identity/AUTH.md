# AUTH.md — Authentication Reference

## Related Documents

- `docs/modules/auth/ROLES.md` — all role definitions
- `docs/modules/auth/SESSIONS.md` — session durations per role
- `docs/modules/auth/PERMISSIONS.md` — permission grant system
- `docs/modules/auth/IMPERSONATION.md` — AfriTech team impersonation
- `docs/modules/school/TEACHER_PORTAL.md` — standalone teacher auth flow
- `docs/DATABASE.md` — standalone_teacher_accounts, alumni_profiles

---

## Purpose

This document defines the complete ZSMS authentication model — how every user type logs in, how JWTs are structured, how session contexts are determined, and how the platform handles multi-role users. Every Claude Code session building any authenticated feature must read this document.

---

## Authentication Provider

ZSMS uses Clerk for all authentication. Email OTP is the only login method — SMS OTP is disabled (cost and reliability in Zambia).

No passwords. No social login. Email-only OTP for all user types.

---

## User Types and Login Entry Points

| User Type | Entry Point | Clerk Role | Account Location |
|---|---|---|---|
| School owner/staff | zsms.co.zm/login | org:* | Clerk org member |
| Parent | zsms.co.zm/portal/login | org:parent | Clerk org member |
| Student | zsms.co.zm/portal/login | org:student | Clerk org member |
| Standalone teacher | zsms.co.zm/teacher/login | platform:teacher | No org |
| Alumni | zsms.co.zm/alumni/login | platform:alumni | No org (or former org) |
| AfriTech staff | zsms.co.zm/admin/login | afritech:* | AfriTech Clerk org |

---

## JWT Structure

Every Clerk JWT contains these claims used by ZSMS:

```typescript
interface ZsmsJwtClaims {
  sub: string              // Clerk user ID — primary identifier
  org_id?: string          // Clerk org ID (school) — present for school users
  org_role?: string        // 'org:owner' | 'org:teacher' | 'org:parent' etc.
  org_slug?: string        // School's Clerk org slug
  metadata: {
    school_id?: string     // ZSMS school UUID — set in Clerk user metadata
    platform_roles?: string[]  // ['platform:teacher'] | ['platform:alumni']
    country_code?: string  // 'ZM'
  }
}
```

Supabase RLS helper functions extract these claims:

```sql
CREATE OR REPLACE FUNCTION get_school_id() RETURNS uuid AS $$
  SELECT COALESCE(
    current_setting('request.jwt.claims', true)::jsonb
      -> 'user_metadata' ->> 'school_id',
    current_setting('request.jwt.claims', true)::jsonb
      -> 'app_metadata' ->> 'school_id'
  )::uuid
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION get_user_role() RETURNS text AS $$
  SELECT current_setting('request.jwt.claims', true)::jsonb ->> 'org_role'
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION get_user_id() RETURNS text AS $$
  SELECT current_setting('request.jwt.claims', true)::jsonb ->> 'sub'
$$ LANGUAGE sql STABLE;
```

---

## Login Flow — School Users (Staff and Parents)

```
1. User visits zsms.co.zm/login
2. Enters email address
3. Clerk sends OTP to email
4. User enters OTP → verified
5. Clerk issues JWT with org_id and org_role
6. ZSMS middleware checks JWT → extracts school context
7. Routes to appropriate dashboard based on role
```

---

## Login Flow — Parent/Student Phone Discovery

Parents and students log in using their phone number (not email) because many parents registered via phone during student import:

```
1. User visits zsms.co.zm/portal/login
2. Enters phone number (+260977123456)
3. ZSMS looks up Clerk account by phone
4. Sends OTP to email on file (not SMS — email is reliable)
5. User enters OTP → verified
6. If multiple children across multiple schools:
   → Role selector shown: "Which school are you logging in for?"
```

---

## Role Selector — Multi-School and Multi-Role Users

When a user has multiple roles (parent at two schools, or a linked standalone teacher):

```
Welcome back, John Banda!
You have access to multiple contexts.

Choose where to go:

🏫 Sunrise Academy       → School Dashboard (org:teacher)
🏫 Heritage Academy      → School Dashboard (org:teacher)
🛠️ My Teacher Tools      → Teacher Hub (platform:teacher)

[Remember my choice for 30 days]
```

The selected context determines which dashboard loads. The choice is remembered in `localStorage` and the navigation always allows switching.

---

## Student Login Flow

Students log in via the student portal using their student ID or email:

```
1. Student visits zsms.co.zm/portal/student
2. Enters student ID (STU-ZM-LSK-0001-00042) or email
3. OTP sent to linked email address
4. Session issued — 30-day duration (SESSIONS.md, revised 2026-06-23)
5. Access: own results, timetable, announcements, attendance summary
```

---

## Standalone Teacher Login Flow

```
1. Teacher visits zsms.co.zm/teacher
2. Enters email
3. OTP sent → verified
4. Clerk checks: does this account have org membership?
   → No: routes to /teacher (Teacher Hub only)
   → Yes: shows role selector (Teacher Hub + school contexts)
```

---

## Alumni Login Flow

Graduated students and parents of graduated students:

```
1. Visits zsms.co.zm/alumni
2. Enters email or phone
3. OTP sent → verified
4. System checks alumni_profiles for their Clerk user ID
5. Session issued — indefinite duration (alumni access never expires)
6. Access: historical records only (read-only)
   - Report cards from their enrolled period
   - Attendance certificates
   - Fee receipts
   - No access to current school operational data
```

---

## Account Linking — Standalone Teacher to School

When a standalone teacher accepts a school invitation:

```typescript
async function linkTeacherToSchool(
  clerkUserId: string,
  schoolId: string,
  invitationToken: string
): Promise<void> {
  // 1. Verify invitation token
  const invitation = await verifyInvitation(invitationToken)

  // 2. Add org:teacher membership in Clerk
  await clerkClient.organizations.createOrganizationMembership({
    organizationId: invitation.clerkOrgId,
    userId: clerkUserId,
    role: 'org:teacher',
  })

  // 3. Update standalone_teacher_accounts
  await supabaseAdmin
    .from('standalone_teacher_accounts')
    .update({ linked_school_id: schoolId })
    .eq('clerk_user_id', clerkUserId)

  // 4. Create staff_members row for school scope
  await supabaseAdmin.from('staff_members').insert({
    school_id: schoolId,
    clerk_user_id: clerkUserId,
    // ... other staff fields from invitation
  })

  // 5. Update Clerk user metadata with school_id
  await clerkClient.users.updateUserMetadata(clerkUserId, {
    publicMetadata: {
      school_ids: [...existingSchoolIds, schoolId],
    }
  })
}
```

After linking, the teacher's existing lesson plans remain — they are queried by `clerk_user_id` which has not changed.

---

## AfriTech Staff Authentication

AfriTech staff log in at `zsms.co.zm/admin`. They are members of the AfriTech Clerk organisation with `afritech:*` roles. The admin panel is invisible to non-AfriTech users — no link or button reveals its existence.

Developer production access requires a time-limited grant (max 4 hours) approved by a super admin via the admin panel.

---

## Business Rules

1. Email OTP is the only login method. No passwords, no social login, no SMS OTP.
2. Every authenticated request includes a Clerk JWT. Requests without a valid JWT are rejected at the middleware layer before reaching any API route or Edge Function.
3. Session durations are role-specific — see SESSIONS.md for the complete table.
4. The role selector is shown whenever a user has more than one active context. Single-context users bypass it.
5. Standalone teacher accounts are not org members. Their JWT has no `org_id` — only `platform:teacher` in metadata. ZSMS middleware routes them to the Teacher Hub.
6. Alumni accounts have indefinite sessions — they may need to access historical records years after graduation for university applications or scholarship submissions.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Pre-development auth reference |
| 2026-04-26 | Added standalone teacher login flow | Teacher Hub B2C product |
| 2026-04-26 | Added alumni login flow with indefinite sessions | Graduated account model |
| 2026-04-26 | Added account linking flow | Standalone → school-linked teacher transition |
| 2026-04-26 | Added role selector for multi-context users | Linked teachers need context switching |
| 2026-04-26 | Added student 365-day session | Students log in infrequently |
| 2026-08-13 | Corrected student session from 365 days to 30 days | Reconciled with the 2026-06-23 revision in SESSIONS.md |
