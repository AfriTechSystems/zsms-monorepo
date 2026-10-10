# PUBLIC_DIRECTORY.md — Public School Directory

## Related Documents

- `docs/modules/school/SCHOOL_SETUP.md` — when schools appear in the directory
- `docs/modules/auth/AUTH.md` — parent login flow using school ID from directory
- `docs/api/ENDPOINTS.md` — GET /api/schools/search and GET /api/students/lookup
- `docs/api/RATE_LIMITS.md` — rate limits on public routes
- `docs/DATABASE.md` — schools table public fields

---

## Purpose

This document defines the public school directory — what it shows, how it works, how the school ID is surfaced for parent login, and how the directory supports the parent login flow. This page is unauthenticated and accessible to anyone.

---

## Overview

The public school directory at `zsms.co.zm/schools` allows anyone to search for schools on the ZSMS platform. Its primary purpose is to help parents find their child's school and copy the school ID needed for the parent login flow. A secondary benefit is social proof — schools visible in the directory signal to other school owners that ZSMS is actively used in their city.

No authentication is required. No sensitive data is exposed. The page is rate-limited to prevent scraping.

---

## What Is Shown Publicly

| Field | Shown | Notes |
|---|---|---|
| School name | ✅ | Full display name |
| City | ✅ | City name from country config |
| Province | ✅ | Province name |
| School type | ✅ | Day / Boarding / Both |
| School level | ✅ | Primary / Secondary / Combined etc |
| School ID | ✅ | Prominently displayed with copy button |
| Status badge | ✅ | Active / Trial (trial badge shown) |
| Logo | ✅ | If uploaded — school logo thumbnail |

| Field | NOT Shown | Reason |
|---|---|---|
| Contact phone | ❌ | Privacy — prevents unsolicited calls |
| Contact email | ❌ | Privacy — prevents spam |
| Owner name | ❌ | Privacy |
| Student count | ❌ | Competitive sensitivity |
| Fee amounts | ❌ | Commercial sensitivity |
| Staff list | ❌ | Privacy |
| Financial data | ❌ | Privacy |
| Subscription tier | ❌ | Commercial sensitivity |

---

## Directory Search

**URL:** `GET /api/schools/search`

**Search filters:**
- Text search: school name (partial match, case-insensitive)
- City: dropdown from country config cities
- Province: dropdown from country config provinces
- Type: Day / Boarding / Both
- Level: Pre-school / Primary / Secondary / Combined / A-Level

**Search behaviour:**
- Text search triggers after 2 characters typed — debounced 300ms
- Empty search shows all active schools in the country, paginated (20 per page)
- Results ordered by: city relevance first, then alphabetical by name
- Trial schools appear with a "Trial" badge — fully searchable
- Suspended and terminated schools do not appear

**Query:**
```sql
SELECT
  school_id, name, city_code, type, level,
  logo_url, status, country_code
FROM public.schools
WHERE country_code = $country_code
  AND status IN ('active', 'trial')
  AND ($search = '' OR name ILIKE '%' || $search || '%')
  AND ($city = '' OR city_code = $city)
  AND ($type = '' OR type = $type)
  AND ($level = '' OR level = $level)
ORDER BY
  CASE WHEN city_code = $user_city THEN 0 ELSE 1 END,
  name ASC
LIMIT 20 OFFSET $offset;
```

---

## School ID Display and Copy

The School ID is the most important element on the school card. It is displayed prominently and has a one-tap copy button.

**Visual design:**
```
┌─────────────────────────────────────┐
│  🏫  Sunrise Academy                │
│      Lusaka · Primary · Day         │
│                                     │
│  School ID:  ZM-LSK-0001  [Copy]   │
│                                     │
│  [I'm a parent here →]             │
└─────────────────────────────────────┘
```

**Copy button behaviour:**
- Tapping "Copy" copies `ZM-LSK-0001` to the clipboard
- Button label changes to "Copied ✓" for 2 seconds then reverts
- On mobile: native share sheet option offered alongside copy

---

## Parent Login Flow from Directory

The "I'm a parent here" button is the critical call to action that connects the directory to the auth flow.

```
1. Parent searches for "Sunrise Academy" in the directory
2. Finds the school — sees school ID: ZM-LSK-0001
3. Clicks "I'm a parent here"
4. Redirected to /sign-in?school_id=ZM-LSK-0001
5. Login page loads with school context pre-filled:
   "Log in to Sunrise Academy"
6. Parent enters their phone number
7. System checks if phone is registered as a parent at ZM-LSK-0001
8. If registered: email OTP sent to their registered email (or admin activates directly)
9. If not registered: "Your number is not registered at this school.
   Contact Sunrise Academy to be added."
10. Parent completes login — sees their child's portal
```

**Student ID alternative path:**
If a parent has their child's student ID but does not know the school name:

```
1. Parent visits zsms.co.zm
2. Clicks "Login with Student ID"
3. Enters: STU-ZM-LSK-0001-00042
4. System queries: SELECT school_id FROM students WHERE student_id = $id
5. Returns: school found — Sunrise Academy
6. Login continues as step 5 above
```

This path is documented in full in `docs/modules/auth/AUTH.md` — Flow 4, Path C.

---

## School Profile Page

Each school has a public profile page at `/schools/[schoolId]`.

**URL example:** `zsms.co.zm/schools/ZM-LSK-0001`

**Contents:**
- School name and logo
- City, province, type, level
- School ID prominently shown with copy button
- "I'm a parent here" login button
- "Is your child at this school?" prompt for parents who are not yet registered
- No contact details, no staff list, no financial information

**SEO:** These pages are statically generated with appropriate meta tags so they appear in search results when someone searches for a school by name. This is organic marketing — parents searching for a school online may find the ZSMS profile page.

---

## Rate Limiting

Public directory routes are rate-limited per IP address to prevent scraping:

| Endpoint | Limit | Window |
|---|---|---|
| `GET /api/schools/search` | 30 requests | 1 minute |
| `GET /api/schools/[schoolId]/public` | 30 requests | 1 minute |
| `GET /api/students/lookup` | 10 requests | 1 minute |

The student ID lookup is stricter (10 requests/minute) to prevent enumeration of valid student IDs. Even at the limit, a legitimate parent would never need more than 1-2 lookups.

---

## What Is Built, and Where It Differs From The Above

*Added 2026-09-30, when the directory was implemented. Everything above was written pre-development.*

Built: `/schools` (search), `/schools/[code]` (profile, server-rendered for SEO), `/for-schools`, the
four-door homepage at `/`, and the school's own control at
`/school/[code]/settings/public-profile`. Behind them: `public.school_public_profiles`,
`public.school_verified_metrics()`, and two SECURITY DEFINER functions granted to `anon` —
`search_schools()` and `school_public_profile()` (migration `0155`).

### The public read path is two functions, not a policy

`public.schools` keeps its RLS with no `anon` policy. RLS decides which **rows** a caller sees, and
what a public directory needs is a restriction on **columns** — so the disclosure boundary is the
`RETURNS TABLE` list of those two functions. A single `GRANT SELECT ON public.schools TO anon` would
publish owner emails and trial end dates. `0156` asserts that `anon` holds EXECUTE on exactly the
functions intended and nothing beneath them.

### Verified metrics, added to the "shown" list

Not in the original table. A school may publish, each behind its own switch:

| Field | Verified? | Note |
|---|---|---|
| Pupils per teacher | ✅ computed | Teachers counted from `teacher_assignments`, **not** `staff_members` — a staff list includes the bursar, the matron and the driver, and counting them would flatter every school with a large office |
| Average class size | ✅ computed | Over classes that have pupils in them |
| Fee band | ❌ school's claim | See below |

**The raw counts are never published.** `school_verified_metrics()` returns pupil, teacher and class
counts and is **not** granted to `anon`, because publishing a teacher count beside a 1:22 ratio lets
anybody multiply and recover the roll — the number this document withholds as competitively sensitive,
reconstructed from two published ones. The school's own settings screen is the only place the counts
appear.

### Fees: amends the "NOT shown" table

Decided 2026-09-30. A school may publish a **stated band** ("K1,500–3,000 a term"), and parents can
filter on it — affordability is the thing parents actually search on. It is **not derived from
`fee_structures`**: a derived figure would leak the real fee table, and would also be wrong, since a
term's structure carries optional lines many parents never pay. Labelled as the school's own
statement, not badged as verified.

### No ranking, and the reason is worth keeping

The obvious thing to publish is the school health score. It must not be. `SCHOOL_HEALTH_SCORES.md`
answers *"is this school genuinely using ZSMS?"* from attendance-marking compliance, marks-entry
completion, staff logins, **fee collection rate** and payment verification speed. Published, that
would rank a good school badly for a slow bursar, broadcast how many of each school's parents are in
arrears, and hand every school outside the top three a reason to churn.

What a competitor cannot copy is not a score — it is that ZSMS can say a figure was computed from the
school's live records. That makes the badge something a school wants rather than fears, and leaves the
health score pointing inward where it belongs.

### Absence is never a no

A facility filter narrows to a **confirmed yes**. A school that has not answered whether it has
boarding is not excluded by a boarding filter, because otherwise the directory quietly becomes a
form-completeness contest and penalises schools in search for not having filled one in.

### `pending_verification` is excluded, as business rule 1 says

And the reason is stronger than the rule: AfriTech has not confirmed the school exists, so listing it
would lend ZSMS's name to that claim.

### Rate limiting is NOT implemented

The limits below need Upstash Redis, which does not exist (`CREDENTIALS_CHECKLIST.md`). What stands in
for it: the page size is capped **inside the SQL function** so a hand-rolled request cannot raise it,
and both endpoints send `Cache-Control: public, s-maxage=300, stale-while-revalidate=600` so repeated
traffic is served at the edge and never reaches Postgres. The real mitigation is that nothing sensitive
is behind them — a scraper gets a list of school names and towns, which is a list of schools.

**The student-ID lookup is deliberately not built.** At 10 requests a minute it is safe; with no
limiter at all it is an enumeration oracle for valid pupil identifiers, which is a different category
of thing to leave open. It waits for Redis.

### An unlisted school renders `noindex`, not a 404

`notFound()` is thrown from an async server component that awaits a fetch, so the response has already
begun streaming and Next cannot retract the 200 it committed — measured on a clean dev server, the
not-found UI renders with HTTP 200. The protection against a crawler indexing a stale or mistyped
school URL is therefore `robots: { index: false }` in `generateMetadata`, not the status line. Worth
knowing before somebody "fixes" the status and assumes the SEO problem is handled.

The page itself says *"that school is not listed"* rather than *"no such school"*, because the same
page covers a suspended school and a wrong guess there is one a parent might repeat.

### A profile returns NOT_FOUND for three different reasons

No such school, suspended or terminated, and awaiting verification all report identically.
Distinguishing them would make the endpoint a status oracle — anyone could learn that a named school
had been suspended, which is commercially damaging information about a customer.

---

## Business Rules

1. Only schools with status `active` or `trial` appear in the directory. Suspended, terminated, and pending_verification schools are not listed.
2. The school ID is always shown — it is a public identifier, not sensitive information.
3. Contact details (phone, email, owner name) are never shown in the public directory regardless of school settings.
4. Trial schools appear with a visible "Trial" status badge — parents can see the school is on ZSMS and use the parent login flow normally.
5. The student ID lookup endpoint returns only the school name and ID — never any student personal data.
6. Schools cannot opt out of the public directory while their status is active. The directory listing is a platform feature, not an optional one.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 6 school module documentation |
| 2026-09-30 | Implemented; verified metrics and an opt-in fee band added; no ranking | Built in `0155`/`0156`. Pupils-per-teacher and average class size are computed and publishable per switch; the raw counts stay private because a count beside a ratio reconstructs the roll. Fee band amends the NOT-shown table as the school's stated range. Ranking rejected — the only score ZSMS could publish measures software usage, not school quality. Rate limiting and the student-ID lookup both wait for Redis. |
