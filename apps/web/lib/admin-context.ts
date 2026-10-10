/**
 * AfriTech platform-admin identity for the `/api/admin/*` routes.
 *
 * Spec: `Official Documentation/15 Super Admin and Platform/SUPERADMIN.md`
 *       `Official Documentation/02 Authentication and Identity/AUTH.md`
 *
 * ## The check here is a courtesy, not the boundary
 *
 * Every admin route already goes through `createUserClient()`, so every query it
 * issues is scoped by RLS — an ordinary school user hitting `/api/admin/schools`
 * gets their own school back and nothing else, because
 * `afritech_admin_all_schools` does not match them. **The data boundary is the
 * policy, and it holds whether or not this file is imported.**
 *
 * What this adds is an honest 403 instead of a confusingly empty 200. A school
 * accountant who follows a stale link should be told they are not permitted,
 * not shown a platform dashboard that has silently collapsed to one row and
 * reads as "the platform has one school and no revenue".
 *
 * Stating that plainly matters, because the opposite mistake is the common one:
 * a route that checks a role in application code and then queries with elevated
 * rights has moved the boundary into a place no policy test covers.
 */

import { getAuthProvider } from '@zsms/auth-provider'

/** The reserved Clerk organisation slug. Nothing else is a platform admin. */
export const AFRITECH_ORG_SLUG = 'afritech-systems-admin'

export interface AdminContext {
  /** Clerk user ID of the operator. Written to every audited action. */
  userId: string
  orgSlug: string
  /** True when this operator is currently impersonating a school user. */
  isImpersonating: boolean
}

/**
 * Returns the calling operator, or null if they are not an AfriTech admin.
 *
 * Reads the organisation slug — the same claim `is_afritech_admin()` reads in
 * the database — so application code and policy cannot disagree about who an
 * admin is.
 */
export async function resolveAdminContext(): Promise<AdminContext | null> {
  const session = await getAuthProvider().getSessionUser()
  if (!session) return null

  if (session.organisationSlug !== AFRITECH_ORG_SLUG) return null

  return {
    userId: session.userId,
    orgSlug: session.organisationSlug,
    isImpersonating: session.isImpersonating,
  }
}
