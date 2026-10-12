/**
 * The signed-in school user, their school, and its ceiling — resolved once per
 * server render.
 *
 * Spec: `Official Documentation/06 School and Tenant Module/SCHOOL.md`
 *       `Official Documentation/01 Foundation Layer/RLS.md`
 *       `Official Documentation/03 Infrastructure Services/CLERK.md`
 *
 * ## The URL segment is checked, and a mismatch is 404
 *
 * `/school/[schoolCode]/…` carries the school in the path, per CLAUDE.md. That
 * segment is **not** what scopes the data — the JWT's `o.id` claim is, through
 * `current_school_uuid()` in every policy. So the segment can only ever agree or
 * disagree with the session, and this file makes a disagreement a **404**.
 *
 * 404 rather than 403, deliberately. Answering "forbidden" for
 * `/school/zm-ndl-0002/students` confirms that `ZM-NDL-0002` is a school on this
 * platform, which is a fact about another tenant. Not-found is the same answer a
 * typo gets, and it discloses nothing.
 *
 * The segment is the lowercase school code — `zm-lsk-0001` — which is also the
 * Clerk organisation slug (`CLERK.md`, *Creating a School Organisation*) and
 * also what `school_branding_by_slug()` takes. One identifier, three consumers,
 * no mapping table.
 */

import { cache } from 'react'
import { notFound, redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAuthProvider, type Role } from '@zsms/auth-provider'
import { resolveTheme, type ResolvedTheme } from '@zsms/design-tokens'

import { createUserClient } from './supabase'
import { loadSchoolBranding } from './theme'
import { isPortalRole } from './roles'

export interface SchoolCapacity {
  studentLimit: number | null
  isUnlimited: boolean
  /** Where the ceiling came from: school_override | tier_override | tier | … */
  source: string
  currentCount: number
  remaining: number | null
  atCapacity: boolean
}

export interface SchoolRecord {
  id: string
  schoolCode: string
  name: string
  status: string
  subscriptionTier: string
  type: string
  level: string
  financeModuleEnabled: boolean
  whatsappEnabled: boolean
  /** Beside the name in the sidebar. Null is the common case and renders nothing. */
  logoUrl: string | null
  /** A decorative stripe at the top of the sidebar. Never behind text. */
  accentColor: string | null
}

export interface SchoolSession {
  userId: string
  role: Role
  /** Lowercase school code — the URL segment and the Clerk org slug. */
  slug: string
  school: SchoolRecord
  capacity: SchoolCapacity | null
  /**
   * The school's resolved palette.
   *
   * Resolved here rather than by the layout so branding and capacity are fetched
   * in ONE round trip together instead of two in sequence. Both depend only on
   * the school id, so there was never a reason to wait for one before asking for
   * the other.
   */
  theme: ResolvedTheme
  isImpersonating: boolean
  client: SupabaseClient
}

/**
 * Reads the raw capacity row into the shape the screens use.
 *
 * Exported because the API routes need the same mapping and a second
 * hand-written copy is how `is_unlimited` gets dropped on one screen.
 */
export function toCapacity(row: unknown): SchoolCapacity | null {
  const r = (Array.isArray(row) ? row[0] : row) as
    | {
        student_limit: number | null
        is_unlimited: boolean
        source: string
        current_count: number
        remaining: number | null
        at_capacity: boolean
      }
    | null
    | undefined

  if (!r) return null

  return {
    studentLimit: r.student_limit,
    isUnlimited: r.is_unlimited,
    source: r.source,
    currentCount: r.current_count,
    remaining: r.remaining,
    atCapacity: r.at_capacity,
  }
}

/** How the ceiling reads in a sentence. Never "of null", never "of 0" for uncapped. */
export function capacityLabel(capacity: SchoolCapacity | null): string {
  if (!capacity) return '—'
  if (capacity.isUnlimited) return 'no limit'
  return String(capacity.studentLimit ?? 0)
}

/**
 * Resolves the school session for a server component, or ends the render.
 *
 * Three exits, each deliberate:
 *   - no session          → sign in, carrying the path back
 *   - not a school role   → 404 (a parent or platform account has no shell here)
 *   - slug ≠ session org  → 404 (see the header)
 *
 * ## Wrapped in `cache()`, and why that is not an optimisation detail
 *
 * A layout and the page inside it are separate server components, and both want
 * the school. Without memoisation each resolution is a fresh set of round trips
 * — the work doubles for no reason, and worse, the two could in principle
 * disagree if a row changed between them. React's `cache()` scopes one result to
 * one request, so every component in the tree sees the same school resolved once.
 *
 * ## The lookups that can be parallel, are
 *
 * The school row has to come first: capacity and branding are both keyed on its
 * id. But those two do not depend on each other, so they run together. Measured
 * on a warm dev server against `zsms-dev` in eu-west-1, that removes one full
 * round trip from every school page — the difference between three sequential
 * waits and two.
 */
export const requireSchoolSession = cache(async function requireSchoolSession(
  slug: string,
): Promise<SchoolSession> {
  const session = await getAuthProvider().getSessionUser()
  if (!session) redirect(`/sign-in?redirect_url=/school/${encodeURIComponent(slug)}`)

  if (!session.organisationSlug || !isPortalRole(session.role)) notFound()

  // The comparison that makes the URL honest. Case-normalised because a link
  // typed in capitals is a typo, not a different school.
  if (session.organisationSlug.toLowerCase() !== slug.toLowerCase()) notFound()

  const client = await createUserClient()
  if (!client) redirect(`/sign-in?redirect_url=/school/${encodeURIComponent(slug)}`)

  // No `.eq()` on school_id: RLS already restricts this to the caller's own
  // school row, so the policy IS the filter (see school-context.ts).
  // `.limit(2)`, not `.maybeSingle()`. An AfriTech operator's policy matches
  // every school, so `maybeSingle()` would raise rather than return — and the
  // slug check above already sent them away, but a route reached another way
  // must not depend on that having happened.
  const { data: schools } = await client
    .from('schools')
    .select(
      'id, school_id, name, status, subscription_tier, type, level, finance_module_enabled, whatsapp_enabled, logo_url',
    )
    .limit(2)

  // A session whose org resolves to no readable school row is a school that has
  // been terminated, or a Clerk org with no `clerk_org_id` match. Neither is a
  // shell worth rendering.
  const school = schools?.[0]
  if (!school || schools.length !== 1) notFound()

  // Independent of each other, dependent only on the school id. Sequential
  // awaits here were costing a whole round trip on every page in the portal.
  const [capacityResult, branding] = await Promise.all([
    client.rpc('school_student_capacity', { p_school_id: school.id as string }),
    loadSchoolBranding(client, school.id as string),
  ])

  return {
    userId: session.userId,
    role: session.role as Role,
    slug: slug.toLowerCase(),
    school: {
      id: school.id as string,
      schoolCode: school.school_id as string,
      name: school.name as string,
      status: school.status as string,
      subscriptionTier: school.subscription_tier as string,
      type: school.type as string,
      level: school.level as string,
      financeModuleEnabled: school.finance_module_enabled as boolean,
      // Shown beside the name in the sidebar. Null is the common case and renders
      // nothing there — the place to notice a missing logo is the settings screen,
      // where there is something to do about it.
      logoUrl: (school.logo_url as string | null) ?? null,
      whatsappEnabled: school.whatsapp_enabled as boolean,
      /*
        The school's own colour, for a decorative stripe in the sidebar.

        The RAW anchor colour, not a resolved token: it is used only as a stripe with
        nothing on it, so it needs no contrast treatment — and `school_branding`
        already CHECK-constrains it to 4.5:1 against a light background, which is a
        guarantee about ink rather than about this.
      */
      accentColor: ((branding as { anchor_color?: string | null } | null)?.anchor_color) ?? null,
    },
    capacity: toCapacity(capacityResult.data),
    theme: resolveTheme(branding),
    isImpersonating: session.isImpersonating,
    client,
  }
})
