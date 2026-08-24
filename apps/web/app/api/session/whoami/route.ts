/**
 * GET /api/session/whoami — what this session looks like to the app, and to the
 * database, side by side.
 *
 * Spec: `Official Documentation/02 Authentication and Identity/AUTH.md`
 *       `Official Documentation/03 Infrastructure Services/CLERK.md` — session token
 *
 * ## Why the two halves are shown separately
 *
 * ZSMS reads identity from two places that are *not* the same thing, and it is
 * entirely possible for them to disagree:
 *
 *   - **The app layer** reads Clerk's server SDK — `auth().orgRole`. That is what
 *     decides which nav links render and which buttons appear.
 *   - **The database** reads the `o.rol` claim inside the Supabase JWT, through
 *     `get_user_role()`. That is what every RLS policy actually enforces.
 *
 * The first comes from Clerk's API; the second comes from the **session token
 * template** configured in the Clerk dashboard. If that template emits `admin`
 * where the policies expect `org:admin`, the portal renders an Administrator's
 * interface and the database refuses an Administrator's writes — which presents
 * as "I am an admin and it says I do not have permission", with nothing in
 * either layer looking wrong on its own.
 *
 * This route makes that disagreement visible in one response instead of
 * inferrable from two failures.
 *
 * ## What it does not return
 *
 * Never the token itself, never its signature. Only the identity claims, and
 * only the caller's own — there is no parameter to ask about anyone else. A
 * session inspecting itself discloses nothing it did not already possess.
 */

import { getAuthProvider } from '@zsms/auth-provider'

import { createUserClient } from '../../../../lib/supabase'
import { ORG_ROLES } from '@zsms/auth-provider'
import { fail, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

/**
 * Reads a JWT's payload without verifying it.
 *
 * Safe here and nowhere else: this token was just minted for this caller by the
 * provider, and the decoded values are returned only to that same caller. It is
 * never used to make an access decision — Supabase verifies the signature
 * itself, and the policies read the claims from the verified copy.
 */
function decodePayload(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1]
  if (!part) return null
  try {
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

export async function GET(): Promise<Response> {
  return guard(async () => {
    const provider = getAuthProvider()
    const session = await provider.getSessionUser()
    if (!session) return fail('UNAUTHORIZED', 'Not signed in.')

    const token = await provider.getSupabaseToken()
    const claims = token ? decodePayload(token) : null
    const org = (claims?.['o'] ?? null) as Record<string, unknown> | null

    const dbRole = typeof org?.['rol'] === 'string' ? (org['rol'] as string) : null
    const dbOrgId = typeof org?.['id'] === 'string' ? (org['id'] as string) : null

    // The one question this route exists to answer.
    //
    // Normalised the same way `get_user_role()` does since 0105: Clerk's v2
    // token carries the BARE role in `o.rol` ("admin"), and the database adds
    // the `org:` prefix when the claim has no namespace of its own. This must
    // mirror that exactly — a diagnostic that disagrees with the function it
    // describes is worse than no diagnostic.
    const normalised =
      dbRole === null ? null : dbRole.includes(':') ? dbRole : `org:${dbRole}`
    const roleRecognised = normalised !== null && (ORG_ROLES as readonly string[]).includes(normalised)

    // And whether the org claim actually resolves to a school row. A token with
    // a valid role but an org id no school carries fails every policy just as
    // completely, and for a different reason.
    let schoolMatched: string | null = null
    if (dbOrgId) {
      const client = await createUserClient()
      const { data } = (await client
        ?.from('schools')
        .select('school_id')
        .eq('clerk_org_id', dbOrgId)
        .limit(1)) ?? { data: null }
      schoolMatched = (data?.[0]?.school_id as string | undefined) ?? null
    }

    return ok({
      app: {
        userId: session.userId,
        organisationId: session.organisationId,
        organisationSlug: session.organisationSlug,
        role: session.role,
        isImpersonating: session.isImpersonating,
      },
      database: {
        // `sub`, `o.*` and `act` are the only claims any RLS helper reads.
        sub: claims?.['sub'] ?? null,
        orgId: dbOrgId,
        orgSlug: org?.['slg'] ?? null,
        orgRoleClaim: dbRole,
        orgRoleAsPoliciesSeeIt: normalised,
        hasActorClaim: claims?.['act'] !== undefined,
        // PostgREST treats a token without this as anonymous, whatever else it
        // carries — a separate failure with identical symptoms.
        role: claims?.['role'] ?? null,
      },
      diagnosis: {
        roleRecognised,
        expectedRoles: ORG_ROLES,
        schoolMatched,
        note: roleRecognised
          ? schoolMatched
            ? 'Claims look correct. A refused write is a role that genuinely lacks the permission.'
            : 'The role is valid but o.id matches no school. current_school_uuid() is NULL, so every school-scoped policy refuses.'
          : `The database resolves the role to "${normalised ?? 'none'}", which no ZSMS policy grants. Clerk's built-in "member" lands here: only owner, principal, admin, accountant, teacher, and staff are ZSMS roles. Create the ZSMS roles in the Clerk dashboard and assign one.`,
      },
    })
  })
}
