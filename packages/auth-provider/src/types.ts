/**
 * Authentication abstraction — type contract.
 *
 * Roles are canonical per `02 Authentication and Identity/ROLES.md`.
 * These values must match the strings the RLS helper `get_user_role()`
 * reads from the JWT `o.rol` claim (migration 0001).
 */

/** School-scoped Clerk organisation roles. All eight per ROLES.md. */
export const ORG_ROLES = [
  'org:owner',
  'org:principal',
  'org:admin',
  'org:accountant',
  'org:teacher',
  'org:staff', // base role for custom-role holders — zero default access (ADR-012)
  'org:parent',
  'org:student',
] as const

/** Platform-level roles with no school affiliation. */
export const PLATFORM_ROLES = [
  'afritech:super_admin',
  'afritech:regional_manager',
  'afritech:support_agent',
  'afritech:loan_officer',
  'afritech:finance_officer',
  'afritech:developer',
  'platform:teacher',
  'platform:alumni',
] as const

export type OrgRole = (typeof ORG_ROLES)[number]
export type PlatformRole = (typeof PLATFORM_ROLES)[number]
export type Role = OrgRole | PlatformRole

export function isOrgRole(value: string): value is OrgRole {
  return (ORG_ROLES as readonly string[]).includes(value)
}

export function isPlatformRole(value: string): value is PlatformRole {
  return (PLATFORM_ROLES as readonly string[]).includes(value)
}

/**
 * JWT claim shape consumed by the RLS helpers in migration 0001.
 * Field names mirror Clerk's compact org claim so the mapping is inspectable.
 */
export interface JwtClaims {
  /** Clerk user ID. */
  sub: string
  /** Organisation claim — absent for platform-level accounts. */
  o?: {
    /** Clerk org ID. Equals schools.clerk_org_id. Read by get_school_id(). */
    id: string
    /** Org slug. 'afritech-systems-admin' drives is_afritech_admin(). */
    slg: string
    /** Role within the org. Read by get_user_role(). */
    rol: string
  }
  /** Actor claim — present only during impersonation. Read by get_actor_id(). */
  act?: { sub: string }
}

export interface SessionUser {
  userId: string
  email: string | null
  /** Clerk org ID — the tenant key. NULL for platform-level accounts. */
  organisationId: string | null
  organisationSlug: string | null
  role: Role | 'none'
  /** True when an AfriTech admin is impersonating this user (IMPERSONATION.md). */
  isImpersonating: boolean
  /** The real actor during impersonation, otherwise null. */
  actorUserId: string | null
}

export type AuthProviderName = 'clerk' | 'keycloak'

export interface AuthProvider {
  readonly name: AuthProviderName

  /** Resolves the current session, or null when unauthenticated. */
  getSessionUser(): Promise<SessionUser | null>

  /** Verifies a raw bearer token and returns its claims. Throws if invalid. */
  verifyToken(token: string): Promise<JwtClaims>

  /** The raw JWT to forward to Supabase as the Authorization header. */
  getSupabaseToken(): Promise<string | null>
}
