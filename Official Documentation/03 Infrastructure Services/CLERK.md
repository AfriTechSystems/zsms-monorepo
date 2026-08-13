# CLERK.md — Clerk Authentication Infrastructure

## Related Documents

- `docs/modules/auth/AUTH.md` — complete authentication flows
- `docs/modules/auth/ROLES.md` — role definitions and Clerk role IDs
- `docs/modules/auth/SESSIONS.md` — session duration configuration
- `docs/modules/auth/IMPERSONATION.md` — actor token and impersonation setup
- `docs/modules/auth/PERMISSIONS.md` — permission grant system
- `docs/DATABASE.md` — staff_members, parents, schools tables synced from Clerk
- `docs/ENV.md` — Clerk environment variables
- `docs/infra/SUPABASE.md` — JWT template integration with Supabase RLS

---

## Purpose

This document covers the complete Clerk configuration required to power ZSMS authentication, multi-tenancy, role management, and impersonation. Every Claude Code session that builds any auth flow, role check, session handling, or impersonation feature must read this document alongside `docs/modules/auth/AUTH.md`.

---

## Overview

Clerk handles all identity and authentication for ZSMS. No credentials are stored in the ZSMS database. Clerk provides user accounts, email OTP login, Organisation-based multi-tenancy, role assignment, JWT issuance, webhook events, and actor token impersonation.

Three Clerk application instances are required — one per environment. Each instance has its own publishable key, secret key, and webhook signing secret.

---

## Clerk Application Instances

| Instance | Environment | Purpose |
|---|---|---|
| `zsms-development` | Local dev | Development and testing. Test mode enabled. |
| `zsms-staging` | Integration / UAT | Pre-production testing. Test mode enabled. |
| `zsms-production` | Production | Live schools and AfriTech team. |

**Test mode** in Clerk allows OTP delivery to be bypassed by using the fixed test code `424242`. This is essential for development — it means developers never need to receive real emails to test login flows.

---

## Organisation Structure

### The Two Organisation Types

**School Organisations** — one per school. Created programmatically during school onboarding via the Clerk API. The organisation slug follows the pattern `zm-lsk-0001` (lowercase version of the school ID). The organisation ID is stored in `public.schools.clerk_org_id`.

**AfriTech Internal Organisation** — exactly one, permanently reserved. Slug: `afritech-systems-admin`. All AfriTech team members (super admins, regional managers, support agents, loan officers, finance officers, developers) belong to this organisation with their respective AfriTech roles.

### Creating a School Organisation (Programmatic)

Called by the `school-onboard` Edge Function during school registration:

```typescript
import Clerk from '@clerk/clerk-sdk-node'

const client = new Clerk({ secretKey: Deno.env.get('CLERK_SECRET_KEY') })

const org = await client.organizations.createOrganization({
  name: schoolName,
  slug: schoolId.toLowerCase().replace(/-/g, '-'),
  createdBy: adminClerkUserId,
})

// Store the Clerk org ID in the schools table
await supabaseAdmin
  .from('schools')
  .update({ clerk_org_id: org.id })
  .eq('school_id', schoolId)
```

### Protecting the AfriTech Organisation

The school onboarding Edge Function validates that no school is assigned the reserved slug:

```typescript
const RESERVED_SLUGS = ['afritech-systems-admin', 'zsms-admin', 'zsms-platform']

if (RESERVED_SLUGS.includes(requestedSlug)) {
  throw new Error('This organisation name is reserved.')
}
```

---

## Roles Configuration

### School Domain Roles

Configured in Clerk Dashboard → Organisations → Roles. Create these roles exactly:

| Role Key | Display Name | Description |
|---|---|---|
| `org:owner` | School Owner | Full school access including billing |
| `org:principal` | Principal | Academic and operational leadership |
| `org:admin` | Administrator | Administrative operations |
| `org:accountant` | Accountant | Financial management |
| `org:teacher` | Teacher | Classroom and marking access |
| `org:parent` | Parent | Parent portal access |
| `org:student` | Student | Student portal read-only |

### AfriTech Internal Roles

Configured in the `afritech-systems-admin` organisation:

| Role Key | Display Name |
|---|---|
| `afritech:super_admin` | Super Administrator |
| `afritech:regional_manager` | Regional Manager |
| `afritech:support_agent` | Support Agent |
| `afritech:loan_officer` | Loan Operations Officer |
| `afritech:finance_officer` | Finance Officer |
| `afritech:developer` | Developer |

---

## JWT Template Configuration

The Clerk JWT template adds the organisation context (`o` claim) needed by Supabase RLS policies. This is configured in:

Clerk Dashboard → JWT Templates → Create new template → Name it `supabase`

```json
{
  "sub": "{{user.id}}",
  "email": "{{user.primary_email_address}}",
  "phone": "{{user.primary_phone_number}}",
  "o": {
    "id": "{{org.id}}",
    "rol": "{{org.role}}",
    "slg": "{{org.slug}}"
  },
  "act": "{{session.actor}}"
}
```

After creating the template, configure the Supabase integration in Clerk Dashboard → Integrations → Supabase. Select the `supabase` JWT template. Clerk will use this template for all JWT issuance for requests going to Supabase.

**Critical:** Without this template, `get_school_id()` returns null and all RLS policies deny access.

---

## Session Duration Configuration

Session durations are set in Clerk Dashboard → Sessions → Session lifetime. Since Clerk does not support per-role session durations natively, this is handled by configuring the maximum session lifetime to the longest duration needed (30 days — the ceiling for all end-user roles per SESSIONS.md) and managing shorter sessions for privileged roles through the application layer — checking session age on login and prompting re-authentication for roles that require shorter sessions.

**Practical implementation:** On every dashboard load for AfriTech internal team and school staff roles, the middleware checks `session.lastActiveAt`. If the session was last active more than 7 days ago, the user is redirected to re-authenticate regardless of the Clerk session still being technically valid. For all end-user roles (teachers, parents, students, alumni — 30 days), this check is skipped.

```typescript
// apps/web/middleware.ts
const SESSION_LIMITS = {
  'afritech:super_admin': 7,
  'org:owner': 7,
  'org:accountant': 7,
  'org:teacher': 90,
  'org:parent': 365,
  'org:student': 365,
}

function isSessionExpiredForRole(role: string, lastActiveAt: Date): boolean {
  const limitDays = SESSION_LIMITS[role] ?? 7
  const daysSinceActive = (Date.now() - lastActiveAt.getTime()) / (1000 * 60 * 60 * 24)
  return daysSinceActive > limitDays
}
```

---

## Webhook Configuration

Clerk sends webhook events to ZSMS when users are created, updated, or when organisation memberships change. These events sync Clerk data to the ZSMS database.

### Webhook Endpoint

URL: `https://zsms.co.zm/api/webhooks/clerk` (production)
URL: `https://staging.zsms.co.zm/api/webhooks/clerk` (staging)

Configure in Clerk Dashboard → Webhooks → Add endpoint.

### Events to Subscribe To

| Event | What ZSMS Does |
|---|---|
| `user.created` | Creates a record in `public.parents` or `public.staff_members` depending on role |
| `user.updated` | Updates the corresponding ZSMS profile record |
| `organizationMembership.created` | Creates `staff_members` record, sends welcome notification |
| `organizationMembership.updated` | Updates role in `staff_members`, logs in audit trail |
| `organizationMembership.deleted` | Deactivates staff record, sets `is_active = FALSE`, logs in audit trail |
| `organization.created` | Confirms school onboarding completion |
| `session.created` | Updates `last_login_at` on the relevant parent/staff record |

### Webhook Verification

Every Clerk webhook must be verified using the signing secret before processing:

```typescript
import { Webhook } from 'https://esm.sh/svix@1'

const webhook = new Webhook(Deno.env.get('CLERK_WEBHOOK_SIGNING_SECRET')!)

let event
try {
  event = webhook.verify(body, {
    'svix-id': req.headers.get('svix-id')!,
    'svix-timestamp': req.headers.get('svix-timestamp')!,
    'svix-signature': req.headers.get('svix-signature')!,
  })
} catch {
  return new Response('Invalid signature', { status: 401 })
}
```

---

## MFA Configuration

MFA is not enforced at the Clerk level — it is guided through in-app prompts. The Clerk configuration should:

- Allow TOTP (authenticator app) MFA to be enabled by users voluntarily
- Not require MFA for any role (enforcement is via in-app guidance only)
- Support Google Authenticator, Authy, and any TOTP-compatible app

In Clerk Dashboard → User & Authentication → Multi-factor → Enable TOTP. Set to "Optional" not "Required".

The in-app banner prompting MFA setup links to Clerk's hosted account page where users manage their security settings:

```typescript
import { useUser } from '@clerk/nextjs'

const { user } = useUser()
const mfaEnabled = user?.totpEnabled || user?.backupCodeEnabled

// Show banner if MFA not configured for privileged roles
const shouldShowMfaBanner = !mfaEnabled &&
  ['org:owner', 'afritech:super_admin'].includes(userRole)
```

---

## Email OTP Configuration

Email OTP is the primary verification method for first-time logins and account creation. Configured in Clerk Dashboard → User & Authentication → Email, Phone, Username.

**Enable:**
- Email address: On
- Email verification: Email code (OTP)
- Phone number: On (used as identity/lookup, not OTP delivery)
- SMS OTP: Off (cost reduction — email OTP only)

**OTP settings:**
- Code expiry: 10 minutes
- Code length: 6 digits
- Resend cooldown: 60 seconds
- Max attempts before lockout: 3
- Lockout duration: 15 minutes

**Test mode OTP code:** `424242` — works in development and staging Clerk instances only.

---

## Impersonation (Actor Tokens)

Actor tokens are created via the Clerk Backend API. Only callable server-side using the Clerk secret key.

```typescript
// Called from the AfriTech admin panel API route
import { clerkClient } from '@clerk/nextjs/server'

const actorToken = await clerkClient.actorTokens.createActorToken({
  userId: targetUserId,          // The user being impersonated
  actorId: adminClerkUserId,     // The real AfriTech staff member
  expiresInSeconds: 7200,        // 2-hour impersonation session
})

// Return the token to the frontend
// The frontend opens a new tab and uses this token to sign in as the impersonated user
```

Actor token creation is logged in `audit_logs` immediately before the token is returned. If the log write fails, the token is not returned.

---

## School Invitation Flow

When a school admin invites a staff member:

```typescript
const invitation = await clerkClient.organizations.createOrganizationInvitation({
  organizationId: clerkOrgId,
  emailAddress: staffEmail,
  role: 'org:teacher',            // The role being assigned
  redirectUrl: 'https://zsms.co.zm/accept-invitation',
  publicMetadata: {
    schoolId: schoolId,
    invitedBy: adminUserId,
  },
})
```

The invited user receives an email from Clerk with a link. On clicking, they are taken to the ZSMS invitation acceptance page where they complete account setup (name, optional phone number) and are added to the school's Clerk Organisation.

---

## Parent and Student Account Creation

Parent and student accounts are created by school admins, not by the users themselves. The flow:

```typescript
// Create the Clerk user account for a parent
const user = await clerkClient.users.createUser({
  emailAddress: [parentEmail],    // Optional — phone is the primary identity
  phoneNumber: [parentPhoneE164], // Required
  firstName: parentFirstName,
  lastName: parentLastName,
  skipPasswordRequirement: true,  // Passwordless — email/phone OTP only
  publicMetadata: {
    role: 'parent',
    schoolId: schoolId,
  },
})

// Add to the school's Clerk Organisation
await clerkClient.organizations.createOrganizationMembership({
  organizationId: clerkOrgId,
  userId: user.id,
  role: 'org:parent',
})
```

If no email is provided, the account is created with phone number only. The parent's first login uses phone number lookup — they enter their number, the system finds their account, and if email is present sends an OTP; if no email, the school admin activates the account directly.

---

## Business Rules

1. The `afritech-systems-admin` Clerk organisation slug is permanently reserved. No school can be assigned this slug.
2. JWT templates must be configured before any production deployment. Without the `supabase` JWT template, all RLS policies fail.
3. SMS OTP is disabled. Email OTP is the only OTP delivery method.
4. MFA is optional for all users, guided through in-app prompts for privileged roles.
5. Actor tokens for impersonation expire after 2 hours. They cannot be extended — a new token must be created.
6. Clerk webhook events are validated using the svix signing secret before any processing. Unverified webhooks are rejected with 401.
7. Parent and student accounts are created by school admins via the Clerk API. Self-registration is not available for these roles.

---

## Known Limitations and Future Work

- Clerk does not natively support per-role session durations. The middleware-based session age check is a workaround. If Clerk adds per-role session configuration, migrate to that native solution.
- Bulk user creation (importing 300 parents from a spreadsheet) hits Clerk API rate limits. The bulk import Edge Function creates users in batches of 10 with a 1-second delay between batches to stay within rate limits.
- WhatsApp OTP as an alternative to email OTP (for parents without email) is a planned future feature. Clerk supports WhatsApp OTP delivery via Twilio — enable when SMS budget allows.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 3 infrastructure documentation |
| 2026-04-26 | SMS OTP set to Off | Cost reduction — email OTP only confirmed |
| 2026-04-26 | MFA set to optional with in-app guidance | No forced MFA — guidance model confirmed |
| 2026-04-26 | Session duration middleware approach documented | Clerk limitation workaround for per-role sessions |
