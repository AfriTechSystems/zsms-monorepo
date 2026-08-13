/**
 * Authentication abstraction — the ONLY module permitted to import Clerk.
 *
 * Spec: `Official Documentation/03 Infrastructure Services/CLERK.md`
 *       `Official Documentation/02 Authentication and Identity/AUTH.md`
 * Decision: ADR-003 (Clerk), ADR-022 / ADR-032 (Keycloak swap for Tier 2).
 *
 * ARCHITECTURE.md: "No other package imports Clerk directly." That rule is
 * what makes the Keycloak swap for self-hosted deployments a configuration
 * change rather than a refactor. A single direct `@clerk/*` import anywhere
 * else silently converts it back into a refactor.
 */

import { ClerkAuthProvider } from './clerk-provider.js'
import type { AuthProvider, AuthProviderName } from './types.js'

let instance: AuthProvider | null = null

function resolveProvider(): AuthProviderName {
  const configured = process.env['AUTH_PROVIDER']?.trim().toLowerCase()

  if (!configured) return 'clerk'
  if (configured === 'clerk') return 'clerk'
  if (configured === 'keycloak') {
    throw new Error(
      'AUTH_PROVIDER=keycloak is not implemented. The Keycloak provider is ' +
        'required for Tier 2 self-hosted deployments (ADR-032) and lands with ' +
        'the first such deployment. See DEPLOYMENT_TOPOLOGY.md.',
    )
  }

  throw new Error(`Invalid AUTH_PROVIDER: "${configured}". Expected "clerk".`)
}

export function getAuthProvider(): AuthProvider {
  if (instance) return instance
  resolveProvider()
  instance = new ClerkAuthProvider()
  return instance
}

/** Test-only. */
export function __resetAuthProviderForTests(): void {
  instance = null
}

export {
  ORG_ROLES,
  PLATFORM_ROLES,
  isOrgRole,
  isPlatformRole,
  type AuthProvider,
  type AuthProviderName,
  type OrgRole,
  type PlatformRole,
  type Role,
  type SessionUser,
  type JwtClaims,
} from './types.js'
