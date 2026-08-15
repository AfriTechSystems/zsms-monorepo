# INVITATIONS.md — Staff Invitations and Self-Registration

## Related Documents

- `docs/modules/staff/STAFF.md` — staff entity reference
- `docs/modules/staff/ASSIGNMENTS.md` — class and subject assignment after joining
- `docs/modules/auth/AUTH.md` — staff login flows
- `docs/modules/auth/ROLES.md` — role definitions
- `docs/infra/CLERK.md` — Clerk invitation API
- `docs/DATABASE.md` — staff_members, staff_requests tables
- `docs/api/ENDPOINTS.md` — staff invitation and approval routes

---

## Purpose

This document defines every path by which a staff member joins a school on ZSMS — admin-initiated invitations, staff self-registration with approval, and bulk invitation during school onboarding. Every Claude Code session building staff onboarding features must read this document.

---

## Overview

Staff join a school through two paths. Admin-initiated invitations are the preferred path — the admin controls exactly who gets access and what role they receive. Self-registration with approval provides a fallback for staff who find ZSMS independently or who want to request access without waiting for the admin to invite them. Both paths result in the staff member becoming a Clerk Organisation member with the assigned role and a corresponding `staff_members` row in the database.

---

## Path 1 — Admin-Initiated Invitation

The school admin, principal, or owner invites a staff member directly. This is the primary onboarding path during school setup.

### Single Invitation Flow

```
1. Admin opens Staff → Add Staff Member
2. Fills invitation form:
   - Email address (required — invitation is email-based)
   - First name (required — pre-fills the invitation email)
   - Last name (required)
   - Role: [dropdown]
     Standard roles: Teacher, Admin, Accountant, Principal
     Custom roles: [school's configured custom roles listed below]
   - Phone number (optional — added to staff profile)
   - Department (optional)
   - For org:teacher role: class and subject pre-assignment (optional)
     "Would you like to assign classes and subjects now or later?"
3. Admin clicks Send Invitation
4. System calls Clerk API: createOrganizationInvitation()
5. Clerk sends invitation email to the staff member
6. staff_members row created with is_active = FALSE (pending acceptance)
7. Admin sees invitation in Pending Invitations list with expiry date
```

**Invitation email content (sent by Clerk with ZSMS branding):**
```
Subject: You've been invited to join [School Name] on ZSMS

[Admin First Name] has invited you to join [School Name] on ZSMS —
Zambia's school management platform.

Your role: [Role Name]

Click below to accept your invitation and set up your account.
The invitation expires in 7 days.

[Accept Invitation →]

If you already have a ZSMS account, this invitation will be added
to your existing account automatically.
```

### Acceptance Flow — New User

```
1. Staff member clicks invitation link in email
2. Directed to ZSMS sign-up page with invitation context pre-filled
3. Enters name (pre-filled from invitation), creates account with email OTP
4. Clerk adds them to the school Organisation with the invited role
5. ZSMS webhook fires: organizationMembership.created
6. staff_members row updated: is_active = TRUE, clerk_user_id populated
7. Staff member redirected to their role-appropriate dashboard
8. Welcome screen shown: "Welcome to [School Name]. Here's how to get started."
```

### Acceptance Flow — Existing ZSMS User

```
1. Staff member clicks invitation link
2. Clerk detects they already have a ZSMS account (email match)
3. Prompted to log in with their existing credentials
4. After login, invitation is auto-accepted — added to new school Organisation
5. They can now switch between their schools using OrganisationSwitcher
6. ZSMS webhook fires, staff_members row created for this school
```

### Expired Invitations

Clerk invitations expire after 7 days by default. If a staff member does not accept within 7 days:
- Invitation appears in admin panel as "Expired"
- Admin can click "Resend" to send a fresh invitation
- The original invitation is revoked and a new one is created
- No data is lost — the pending staff_members row is updated

---

## Path 2 — Staff Self-Registration with Admin Approval

Staff members who find ZSMS independently or are directed to register by a colleague.

### Self-Registration Flow

```
1. Staff member visits zsms.co.zm/join
2. Enters the school's School ID: ZM-LSK-0001
   (Found in the public directory or provided by the school)
3. School is found and displayed: "Sunrise Academy, Lusaka"
4. Fills registration form:
   Required:
   - First name, last name
   - Phone number or email
   - Role requested: [dropdown — Teacher, Admin, Accountant, Other]
   Optional:
   - Subjects they can teach (for teacher role)
   - Department
   - Message to admin: "I teach Mathematics and have been told to register here"

5. Clicks Request Access
6. Clerk creates user account (email OTP verification)
7. staff_requests row created:
   { school_id, clerk_user_id, role_requested, subjects, message, status: 'pending' }
8. Admin sees "New Staff Request" notification in Staff → Pending Requests
9. Staff member receives confirmation:
   "Your request to join Sunrise Academy has been sent. The school admin will review
   your request and you'll be notified by email when a decision is made."
```

### Admin Review of Self-Registration Requests

Admin opens Staff → Pending Requests. Sees a list of pending requests with:
- Name, phone, email
- Role requested
- Subjects listed
- Message from the applicant
- Time since request was submitted

For each request, admin can:

**Approve:**
```
Admin clicks Approve
→ Selects the actual role to assign (may differ from requested)
→ Optionally assigns classes and subjects immediately
→ Clicks Confirm Approval
→ Clerk API: createOrganizationMembership(orgId, userId, role)
→ staff_requests.status = 'approved'
→ staff_members row created with is_active = TRUE
→ Staff member receives email: "Your request to join Sunrise Academy has been approved.
   Log in at zsms.co.zm to get started."
→ Audit log entry written
```

**Reject:**
```
Admin clicks Reject
→ Optional rejection reason (shown to the staff member)
→ Confirms rejection
→ staff_requests.status = 'rejected'
→ Staff member receives email: "Your request to join Sunrise Academy was not approved.
   [Reason if provided]. Please contact the school directly if you have questions."
→ Clerk user account remains — they can request to join other schools
```

### Pending Request Expiry

Self-registration requests that are not actioned within 14 days are automatically moved to "Expired" status by the daily cron job. The staff member can submit a new request if still needed.

---

## Bulk Invitation — School Onboarding

During initial school setup, the admin may need to invite 20-30 teachers at once. Bulk invitation avoids sending individual invitations manually.

### Bulk Invitation Flow

```
1. Admin opens Staff → Bulk Invite
2. Downloads the invitation template (CSV):
   Columns: email, first_name, last_name, role, department, phone
3. Fills in the template with all staff details
4. Uploads the completed CSV
5. Preview shown: list of staff to be invited with their roles
6. Admin confirms — invitations sent to all valid emails
7. Invalid emails flagged with error (not sent)
8. Progress shown: "Sending invitations... 18 of 23 sent"
```

**Rate limiting on bulk invitation:**
Clerk's invitation API is called at a rate of 5 invitations per second to avoid rate limit errors. A school inviting 30 teachers takes approximately 6 seconds — shown as a progress bar.

**Duplicate detection:**
If an email address in the bulk upload is already a member of this school's Organisation, the row is skipped with a "Already a member" flag. No duplicate invitation is sent.

---

## Role Assignment During Invitation

### Standard Role Assignment

When inviting a standard role staff member, the admin selects from the predefined Clerk roles:

| Role | When to Use |
|---|---|
| Teacher | Teaching staff who mark attendance and enter marks |
| Admin | Administrative staff managing students and timetable |
| Accountant | Financial staff managing fees and payments |
| Principal | Academic leader with results and staff management access |

### Custom Role Assignment

When inviting a custom role staff member (e.g. Head of Boarding):

```
1. Admin selects "Custom Role" in the role dropdown
2. List of school's configured custom roles appears:
   - Head of Boarding
   - Dormitory Matron
   - School Nurse
   [+ Create New Role] — opens custom role configuration
3. Admin selects the appropriate custom role
4. Staff member's Clerk invitation specifies org:staff as the Clerk role
5. staff_members.custom_role_id is set to the selected custom role
6. On acceptance, the staff member's permissions are loaded from school_custom_roles
```

---

## Staff Profile Completion After Joining

After a staff member accepts their invitation, they are prompted to complete their profile on first login:

```
Welcome to Sunrise Academy! 👋
Complete your profile to get started.

[Photo Upload — optional]
Phone number: [field — optional]
Location (City/Province): [dropdown — optional]
Qualifications: [text field — optional]

[Complete Profile]   [Skip for now]
```

All fields are optional — the staff member can skip entirely. The completion prompt appears once on first login and is dismissible. They can complete or update their profile at any time from Profile → Settings.

---

## Removing a Staff Member

When a staff member leaves the school:

```
Admin opens Staff → [Staff Name] → Actions → Remove from School

Confirmation:
"Removing [Name] will:
 - Remove their access to this school immediately
 - Preserve all records they have created (attendance, marks, etc.)
 - Not delete their ZSMS account (they may work at other schools)

Are you sure?"

Admin confirms →
→ Clerk API: deleteOrganizationMembership(orgId, userId)
→ staff_members.is_active = FALSE
→ teacher_assignments deactivated (is_active = FALSE) for this staff member at this school
→ Any active staff_permission_grants for this user at this school deactivated
→ staff_requests for this user at this school archived
→ Parent notification if they were a class teacher:
  "Your child's class teacher has changed. Check with the school for updates."
→ Audit log entry written
```

**What happens to their historical records:**
All attendance records, exam results, and other data created by this staff member remain intact. The records reference their Clerk user ID — this is preserved even after their school membership is removed. School admins and AfriTech can always trace who created which records through the audit log.

---

## Business Rules

1. Only `org:owner`, `org:principal`, and `org:admin` roles can initiate staff invitations. Teachers and custom role staff cannot invite other staff members.
2. Admin-initiated invitations always take precedence over self-registration requests — if a staff member has a pending self-registration request when the admin sends an invitation, the invitation is processed immediately and the request is marked approved.
3. The role assigned in the invitation is the minimum — the admin can always grant additional permissions via the permission grant system after the staff member joins.
4. Bulk invitation CSV files must not contain sensitive data beyond email, name, role, department, and phone. The file is not stored after processing.
5. Removing a staff member from the school does not affect their ZSMS account or their membership at other schools.
6. A staff member with a pending invitation (not yet accepted) does not have access to the school. Access begins only after invitation acceptance and Clerk membership confirmation.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 8 staff module documentation |
| 2026-04-26 | Added custom role assignment flow | Custom roles feature confirmed |
| 2026-04-26 | Added bulk invitation for school onboarding | High-friction onboarding step that needs dedicated flow |
