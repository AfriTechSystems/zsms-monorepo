/**
 * Clerk implementation of AuthProvider.
 *
 * THIS IS THE ONLY FILE IN THE MONOREPO PERMITTED TO IMPORT `@clerk/*`.
 * See ARCHITECTURE.md and ADR-032.
 *
 * Phase 0 status: interface-complete, dependency not yet installed. Clerk is
 * imported dynamically so the scaffold type-checks and builds without it.
 */

import {
  isOrgRole,
  isPlatformRole,
  type AuthProvider,
  type AuthProviderName,
  type JwtClaims,
  type Role,
  type SessionUser,
} from './types'

interface ClerkAuthLike {
  userId: string | null
  orgId: string | null
  orgSlug: string | null
  orgRole: string | null
  actor: { sub: string } | null
  getToken(opts?: { template?: string }): Promise<string | null>
  sessionClaims: Record<string, unknown> | null
}

export class ClerkAuthProvider implements AuthProvider {
  readonly name: AuthProviderName = 'clerk'

  private async clerkAuth(): Promise<ClerkAuthLike> {
    // TODO(Phase 0): install `@clerk/nextjs` and replace with a static import.
    const mod = (await import('@clerk/nextjs/server')) as unknown as {
      auth: () => Promise<ClerkAuthLike>
    }
    return mod.auth()
  }

  async getSessionUser(): Promise<SessionUser | null> {
    const auth = await this.clerkAuth()
    if (!auth.userId) return null

    const rawRole = auth.orgRole ?? null
    const role: Role | 'none' =
      rawRole && (isOrgRole(rawRole) || isPlatformRole(rawRole)) ? (rawRole as Role) : 'none'

    const claims = auth.sessionClaims ?? {}
    const email = typeof claims['email'] === 'string' ? claims['email'] : null

    return {
      userId: auth.userId,
      email,
      organisationId: auth.orgId,
      organisationSlug: auth.orgSlug,
      role,
      isImpersonating: auth.actor !== null,
      actorUserId: auth.actor?.sub ?? null,
    }
  }

  async verifyToken(token: string): Promise<JwtClaims> {
    // TODO(Phase 0): install `@clerk/backend` and replace with a static import.
    const { verifyToken } = (await import('@clerk/backend')) as unknown as {
      verifyToken: (t: string, o: { secretKey: string }) => Promise<JwtClaims>
    }

    const secretKey = process.env['CLERK_SECRET_KEY']
    if (!secretKey) throw new Error('CLERK_SECRET_KEY is not set.')

    return verifyToken(token, { secretKey })
  }

  async getSupabaseToken(): Promise<string | null> {
    const auth = await this.clerkAuth()
    // The 'supabase' JWT template shapes the o/act claims the RLS helpers read.
    return auth.getToken({ template: 'supabase' })
  }
}
