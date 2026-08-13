# ADDING_COUNTRY.md — Country Expansion Playbook

## Related Documents

- `docs/ARCHITECTURE.md` — multi-country architecture overview
- `docs/CONVENTIONS.md` — school ID and naming conventions per country
- `docs/DATABASE.md` — country_code field on schools table
- `docs/ENV.md` — environment variables per country deployment
- `docs/infra/VERCEL.md` — new Vercel project per country
- `docs/infra/SUPABASE.md` — new Supabase project per country
- `docs/infra/CLERK.md` — Clerk organisation structure
- `docs/infra/META_API.md` — WhatsApp Business number per country
- `docs/countries/ZM.md` — Zambia as the reference implementation

---

## Purpose

This document is the complete step-by-step playbook for adding a new country to ZSMS. It is written so that any AfriTech team member — not just the CTO — can follow it and successfully launch ZSMS in a new country without any application code changes. Every step is ordered correctly. Do not skip steps or change the order.

---

## Overview

Adding a new country to ZSMS is a configuration and infrastructure exercise, not a development project. The application codebase is unchanged. What changes is a new country config file, a new Supabase database project, a new Vercel deployment, and country-specific service registrations.

The entire process takes 4 to 8 days of part-time work for a country with straightforward infrastructure (Botswana, Zimbabwe). It takes 1 to 3 weeks for countries requiring additional compliance work (South Africa — POPIA) or new payment gateway integrations (Kenya — M-Pesa).

---

## Pre-Expansion Checklist

Before starting any technical work, confirm:

- [ ] Country partner identified and signed (70/30 revenue share agreement)
- [ ] Local domain registered or in process (e.g. `bsms.co.bw`)
- [ ] WhatsApp Business account creation started for local number
- [ ] Local payment gateway account opened (or confirmed which gateway works in this country)
- [ ] Legal review completed — confirm ZSMS operates legally as a SaaS platform in this country
- [ ] Data residency requirements confirmed — which Supabase region applies
- [ ] Country partner has signed data processing agreement with AfriTech
- [ ] Pricing confirmed in local currency with co-founders

---

## Step 1 — Create the Country Configuration File

Create `packages/config/countries/[code].ts` where `[code]` is the ISO 3166-1 alpha-2 country code in lowercase.

Use `packages/config/countries/zm.ts` as the reference template. Every field must be populated. Do not leave any field as `null` or `undefined` — use sensible defaults if a value is not yet confirmed.

### Required Fields

```typescript
export const [CODE]_CONFIG = {
  // Identity
  code: 'BW',                          // ISO 3166-1 alpha-2 uppercase
  name: 'Botswana',                    // Full country name for display

  // Currency
  currency: {
    code: 'BWP',                       // ISO 4217 currency code
    symbol: 'P',                       // Currency symbol displayed in UI
    name: 'Botswana Pula',             // Full currency name
    decimals: 2,                       // Decimal places (almost always 2)
    usdRate: 13.50,                    // Approximate rate — updated periodically
  },

  // Phone
  phone: {
    countryCode: '+267',               // E.164 country prefix
    format: '7X XXX XXXX',            // Display format hint
    mobileNetworks: ['Orange', 'Mascom', 'beMobile'],
  },

  // Education system — see detailed guidance below
  education: { ... },

  // Academic calendar
  academicYear: {
    terms: 3,                          // Number of terms per year
    termNames: ['Term 1', 'Term 2', 'Term 3'],
    startMonth: 1,                     // January = 1, February = 2, etc.
    endMonth: 12,
  },

  // Grading systems available to schools in this country
  grading: {
    availableSystems: ['bgcse', 'percentage', 'custom'],
    defaultSystem: 'bgcse',
    systems: { ... },                  // Define each system — see ZM.md for structure
  },

  // Payment infrastructure
  paymentGateways: ['flutterwave', 'dpo', 'orange_money'],

  // Communication
  whatsAppSenderId: 'ZSMS_BW',        // Registered WhatsApp Business sender name
  whatsAppPhoneNumberId: '',           // From Meta dashboard — set after registration

  // Deployment
  domain: 'bsms.co.bw',
  appName: 'BSMS',                     // Country-specific app name if different

  // Data and compliance
  dataRegion: 'af-south-1',           // Supabase region — confirm for this country
  complianceLaw: 'Botswana Data Protection Act 2018',

  // School ID structure
  schoolIdPrefix: 'BW',
  cities: {
    'GAB': 'Gaborone',
    'FRA': 'Francistown',
    'MAU': 'Maun',
    'LOB': 'Lobatse',
    'PAL': 'Palapye',
  },

  // Subjects — reference list for this country's curriculum
  subjects: { ... },                   // See ZM.md for structure

  // Country partner
  partner: {
    name: 'Partner Company Name',
    contactEmail: 'partner@example.com',
    revenueSharePercent: 30,
  },
}
```

### Education System Configuration

The education system config requires the most care. Confirm with the country partner:

1. **What curriculum types are used?** National curriculum only, Cambridge, or hybrid?
2. **What are the grade levels called?** Grades, Forms, Standards, Years?
3. **How many years of primary and secondary education?**
4. **What examination bodies exist?** National + Cambridge? National only?
5. **What is the official grading scale?** Letter grades, percentage bands, divisions?

For each curriculum type supported, define:
- The grade level names in order
- The examination type at each level
- Which grading scale applies at each level

### Subjects Reference List

Populate `subjects` with the country's standard curriculum subjects. Separate primary and secondary lists. Mark which are typically core vs elective. This becomes the pre-populated suggestion list shown to schools during onboarding.

---

## Step 2 — Update the Country Index

Add the new country config to `packages/config/countries/index.ts`:

```typescript
// packages/config/countries/index.ts
import { ZM_CONFIG } from './zm'
import { BW_CONFIG } from './bw'    // Add this line

export const COUNTRY_CONFIGS = {
  ZM: ZM_CONFIG,
  BW: BW_CONFIG,                    // Add this line
}

export type CountryCode = keyof typeof COUNTRY_CONFIGS

export function getCountryConfig(code: CountryCode) {
  return COUNTRY_CONFIGS[code]
}
```

---

## Step 3 — Create the Supabase Project

1. Log into Supabase at supabase.com using the AfriTech company account
2. Click "New Project"
3. **Name:** `zsms-[country_code_lowercase]` — e.g. `zsms-bw`
4. **Database password:** Generate a strong password and store it in the AfriTech password manager immediately
5. **Region:** Select the region closest to the country that satisfies data residency requirements
6. **Plan:** Start on Free tier during setup. Upgrade to Pro before onboarding the first school.
7. Click "Create new project" — takes 2-3 minutes

### Apply Migrations

```bash
# Link to the new project
supabase link --project-ref [new-project-ref]

# Apply all migrations in order
supabase db push

# Verify all tables were created correctly
supabase db diff  # Should show no differences

# Generate TypeScript types (optional — types are already correct)
supabase gen types typescript --linked
```

### Configure Schema Exposure

In the new Supabase project dashboard:
- Navigate to Settings → API → Exposed schemas
- Ensure only `public` is listed
- Remove `private` and `afritech` if they appear

### Set Edge Function Secrets

```bash
# Set all required secrets for this country's Edge Functions
supabase secrets set --env-file .env.[country_code]

# Verify secrets are set
supabase secrets list
```

### Configure Realtime

Navigate to Database → Replication → Tables. Enable Realtime for:
- `report_generation_jobs`
- `payments`

---

## Step 4 — Set Up Railway Standby

Follow `docs/infra/RAILWAY.md` to create a Railway PostgreSQL project for the new country:
- **Project name:** `zsms-standby-[country_code_lowercase]`
- Set up logical replication from the new Supabase project
- Verify replication is working by checking `pg_last_xact_replay_timestamp()`

---

## Step 5 — Register WhatsApp Business Number

1. In Meta Business Manager, navigate to WhatsApp Manager → Phone Numbers
2. Add a new phone number for the new country
3. Use a local number in the country's format — this increases parent trust
4. Complete the phone number verification process
5. Register the WhatsApp Business sender name (e.g. "ZSMS Botswana")
6. Submit required message templates — use the same templates as Zambia, translated if needed
7. Note the `Phone Number ID` — this goes in the country environment variables

**Important:** Template approval takes 24-72 hours. Start this step early — it is often the longest waiting step.

---

## Step 6 — Configure Payment Gateways

For each payment gateway that operates in the new country:

1. Open an account with the gateway using the AfriTech business registration for that country (or via the country partner)
2. Complete business verification with the gateway
3. Obtain API credentials (API key, secret key, webhook secret)
4. Add the gateway to the `gateway_name` CHECK constraint in a new migration:

```sql
-- New migration: NNNN_add_[country]_gateways.sql
-- Only needed if a new gateway not already in the constraint is required
ALTER TABLE public.payment_gateways
  DROP CONSTRAINT payment_gateways_gateway_name_check;

ALTER TABLE public.payment_gateways
  ADD CONSTRAINT payment_gateways_gateway_name_check
  CHECK (gateway_name IN (
    'flutterwave', 'pawapay', 'dpo', 'pesapal',
    'airtel_money', 'mtn_momo', 'zanaco_zpay',
    'orange_money',      -- Added for Botswana
    'mpesa',             -- Added for Kenya (future)
    'ecocash',           -- Added for Zimbabwe (future)
    'other'
  ));
```

5. Apply this migration to all country Supabase projects (ZM, BW, etc.) — the constraint must be consistent across all databases

---

## Step 7 — Create the Vercel Project

1. Log into Vercel using the AfriTech account
2. Click "Add New Project"
3. Import from GitHub repository `AfriTechSystems/zsms-monorepo`
4. **Project name:** `zsms-[country_code_lowercase]` — e.g. `zsms-bw`
5. **Root directory:** `apps/web`
6. **Framework:** Next.js
7. **Build command:** `cd ../.. && npx turbo build --filter=web`

### Configure Environment Variables

Set all environment variables for this country deployment. Use the `.env.example` as the reference. Country-specific variables:

```bash
NEXT_PUBLIC_COUNTRY_CODE=BW
NEXT_PUBLIC_APP_URL=https://bsms.co.bw
NEXT_PUBLIC_APP_NAME=BSMS
NEXT_PUBLIC_SUPABASE_URL=https://zsms-bw-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=[bw project anon key]
SUPABASE_SERVICE_ROLE_KEY=[bw project service role key]
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=[production clerk key]
CLERK_SECRET_KEY=[production clerk secret]
META_WHATSAPP_PHONE_NUMBER_ID=[bw phone number id]
# ... all other variables with country-specific values
```

### Configure Branch Deployments

In Vercel project settings → Git:
- Production branch: `main`
- Preview branches: `integration` (deploys to `staging.bsms.co.bw`)

---

## Step 8 — Configure DNS

1. Point the country domain to Vercel:
   ```
   A record: @ → 76.76.21.21
   CNAME: www → cname.vercel-dns.com
   CNAME: staging → cname.vercel-dns.com
   ```
2. Add the domain in Vercel Dashboard → Project → Settings → Domains
3. Assign `staging.bsms.co.bw` to the `integration` branch
4. Vercel provisions SSL automatically — wait for green checkmark (usually under 5 minutes)

---

## Step 9 — Seed Reference Data

Every new country Supabase project needs the reference subjects table populated:

```sql
-- Run after migrations are applied
-- Insert country-specific reference subjects
INSERT INTO public.reference_subjects (country_code, subject_code, subject_name,
                                        level_type, is_core, curriculum_type)
VALUES
  ('BW', 'english', 'English Language', 'primary', true, 'national'),
  ('BW', 'mathematics', 'Mathematics', 'primary', true, 'national'),
  -- ... full subject list from the country config file
```

This data is defined in the country config file's `subjects` section and seeded via the migration or a seed script.

---

## Step 10 — Create the AfriTech Admin Account for This Country

1. In Clerk production dashboard, create a new user account for the country partner's primary contact
2. Add them to the `afritech-systems-admin` organisation with role `afritech:regional_manager`
3. In Supabase, create their scope assignment:
   ```sql
   INSERT INTO afritech.staff_scope_assignments
     (afritech_user_id, scope_type, country_code, granted_by)
   VALUES
     ('user_partner_clerk_id', 'country', 'BW', 'user_mwando_superadmin');
   ```
4. Send them their login credentials and the onboarding guide for country partners

---

## Step 11 — Test the Complete Flow

Before onboarding any school, run through the complete test checklist:

**Authentication:**
- [ ] School owner can register and log in
- [ ] Teacher can be invited and access their dashboard
- [ ] Parent can log in using phone number lookup
- [ ] Email OTP works (use Clerk test mode code `424242` in staging)

**Core modules:**
- [ ] Create a test school with the correct country configuration
- [ ] Configure grade structure using the new country's education system options
- [ ] Add a test student
- [ ] Record a test payment — verify the correct currency symbol displays
- [ ] Mark test attendance — verify WhatsApp notification sends (use a test number)
- [ ] Enter test marks — verify grade calculation uses the correct grading scale

**Payment gateways:**
- [ ] Configure the local payment gateway in test mode
- [ ] Submit a test payment — verify webhook is received and processed

**WhatsApp:**
- [ ] Verify approved templates are active for this country's WhatsApp number
- [ ] Send a test message — verify delivery

---

## Step 12 — Document the Country

Create `docs/countries/[CODE].md` following the same structure as `docs/countries/ZM.md`. This becomes the reference for every Claude Code session that builds features for this country.

Update `docs/CHANGELOG.md` with an entry documenting the country addition.

---

## Post-Launch Monitoring (First 30 Days)

- Monitor Sentry for country-specific errors (filter by `country_code` tag)
- Watch Supabase dashboard for unusual query patterns from the new region
- Check Railway replication lag daily for the first week
- Review WhatsApp delivery rates — lower rates may indicate number reputation issues
- Track onboarding completion rates in PostHog for the new country's schools

---

## Code Changes That May Be Required

Most country additions require zero code changes. The following scenarios require targeted code additions:

| Scenario | Code Change Required | Effort |
|---|---|---|
| New payment gateway not yet integrated | New case in `webhook-payment` Edge Function + migration for CHECK constraint | 1-2 days |
| Grading system that cannot be expressed as marks-to-letter mapping | New grading calculation variant in `packages/utils/grading.ts` | 1 day |
| More than 4 academic terms | Migration to update `term_number` CHECK constraint from `BETWEEN 1 AND 4` to `BETWEEN 1 AND 5` | 2 hours |
| Non-English subject names requiring different text search | New GIN index with appropriate language dictionary | 2 hours |
| Country-specific compliance requirement | Legal review + possible new consent flow | Varies |

---

## Business Rules

1. A new country Supabase project is always created fresh — never clone or copy from an existing project. Migrations are applied from scratch to ensure a clean, consistent state.
2. The country config file must be complete before any infrastructure is created. Missing fields in the config will cause runtime errors that are difficult to diagnose.
3. WhatsApp template approval must be complete before the country goes live. Do not launch without approved templates — outbound messaging will fail silently.
4. The country partner scope assignment in `afritech.staff_scope_assignments` must be created before they can access any school data.
5. Every country addition requires a corresponding `docs/countries/[CODE].md` file documenting the education system, grading scales, and any country-specific behaviour.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 4 country documentation |
