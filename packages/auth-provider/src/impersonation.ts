/**
 * Impersonation — minting and revoking actor tokens.
 *
 * Spec: `02 Authentication and Identity/IMPERSONATION.md`
 *
 * ## Why this is in `auth-provider` and not in the route
 *
 * ADR-032: nothing outside this package imports Clerk. Keycloak is the swap for
 * self-hosted deployments, and it has its own notion of token exchange — so the route
 * asks for "a way to act as this user" and this module decides how.
 *
 * ## What an actor token actually is
 *
 * Clerk mints a short-lived ticket. When it is redeemed, the resulting session JWT has
 * `sub` = the impersonated user and `act.sub` = the real operator. That is exactly what
 * migration `0001`'s `is_impersonation_session()` and `get_actor_id()` read.
 *
 * The important consequence: **RLS evaluates as the impersonated user.** The operator
 * sees precisely what that user sees — no more, which is the point — while every write is
 * attributable to the operator through `act`.
 *
 * ## The safety model is the trail, not a restriction
 *
 * IMPERSONATION.md is explicit that writes are not blocked for a super admin: "The safety
 * mechanism is the audit trail, not access restriction... it creates accountability
 * rather than just preventing action." Blocking writes would mean support could not fix
 * the thing the customer rang about.
 */

import { createClerkClient } from '@clerk/backend'

let cached: ReturnType<typeof createClerkClient> | null = null

function client(): ReturnType<typeof createClerkClient> {
  if (cached) return cached
  const secretKey = process.env['CLERK_SECRET_KEY']
  if (!secretKey) {
    throw new Error(
      'CLERK_SECRET_KEY is not set. Impersonation needs the Backend API — see ENV.md.',
    )
  }
  cached = createClerkClient({ secretKey })
  return cached
}

export interface ActorTokenResult {
  /** Clerk's token id, kept so the session can be revoked centrally. */
  id: string
  /** The URL the operator opens to enter the session. Single use. */
  url: string
  expiresAt: Date
}

/**
 * Two hours, which IMPERSONATION.md recommends.
 *
 * It matters because of the failure the document names: if the operator closes the tab
 * without clicking "End Impersonation", nothing ends the session except this expiry. A
 * long-lived actor token is an unattended open door into a customer's data.
 */
const DEFAULT_LIFETIME_SECONDS = 2 * 60 * 60

/**
 * Mints a token letting `actorUserId` act as `targetUserId`.
 *
 * Does **no** authorisation of its own — `begin_impersonation_session()` enforces the
 * `impersonate` capability, and the route calls it. One rule, one place.
 */
export async function createActorToken(params: {
  targetUserId: string
  actorUserId: string
  lifetimeSeconds?: number
}): Promise<ActorTokenResult> {
  const lifetime = params.lifetimeSeconds ?? DEFAULT_LIFETIME_SECONDS

  const token = await client().actorTokens.create({
    userId: params.targetUserId,
    /*
      `actor` becomes the `act` claim on the resulting session. Clerk passes the
      object through, so `sub` here is what `get_actor_id()` reads in SQL.
    */
    actor: { sub: params.actorUserId },
    expiresInSeconds: lifetime,
  })

  const raw = token as unknown as { id: string; token?: string; url?: string }

  /*
    Clerk returns a ticket rather than a URL on some SDK versions. Building the
    sign-in URL from it is the documented redemption path, and doing it here keeps the
    route from knowing anything about Clerk's shape.
  */
  const url =
    raw.url ??
    `${process.env['NEXT_PUBLIC_ZSMS_URL'] ?? ''}/sign-in?__clerk_ticket=${raw.token ?? ''}`

  return {
    id: raw.id,
    url,
    expiresAt: new Date(Date.now() + lifetime * 1000),
  }
}

/**
 * Revokes a token that has not been redeemed.
 *
 * Only useful before redemption — once a session exists, ending it is Clerk's session
 * revocation, not the token's. Called when `begin_impersonation_session()` refuses after
 * the token was already minted, so a usable ticket is never left lying around.
 */
export async function revokeActorToken(tokenId: string): Promise<void> {
  await client().actorTokens.revoke(tokenId)
}
