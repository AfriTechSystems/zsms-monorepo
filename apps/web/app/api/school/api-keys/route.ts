/**
 * GET/POST/PATCH /api/school/api-keys — a school manages its own integration keys.
 *
 * Spec: `03 Infrastructure Services/API_INTEGRATION.md`
 *
 * ## The plaintext key exists for one response and then never again
 *
 * It is generated here, hashed, and only the hash is sent to the database. The
 * plaintext goes back in this one response and is never retrievable — not by the
 * school, not by AfriTech, not from a backup. If it is lost, issue another and revoke
 * the old one.
 *
 * ## Why there is no role check in this file
 *
 * `issue_api_key()` and `revoke_api_key()` refuse anyone who is not `org:owner` —
 * narrower than most of the product, because a key acts as the school with no name
 * attached and that is an ownership decision rather than an administrative one.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { generateApiKey } from '../../../../lib/api-key-auth'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const SCOPES = [
  'students:read',
  'students:write',
  'fees:read',
  'fees:write',
  'attendance:read',
  'attendance:write',
  'results:read',
  'communication:send',
  'loans:read',
  'loans:write',
  'webhooks:receive',
] as const

/**
 * Which scopes a key can currently DO anything with.
 *
 * `0241` admits all eleven so a key is ready when the endpoints land, but only five
 * have a `/api/v1` resource behind them today. Saying so stops a school granting
 * `loans:write` and wondering why nothing happens.
 */
const IMPLEMENTED: string[] = [
  'students:read',
  'fees:read',
  'attendance:read',
  'results:read',
]

export async function GET(): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const [keys, usage] = await Promise.all([
      client
        .from('school_api_keys')
        .select(
          'id, name, key_prefix, scopes, rate_limit_rpm, is_active, last_used_at, expires_at, revoked_at, created_at',
        )
        .order('created_at', { ascending: false }),
      client
        .from('api_key_usage')
        .select('api_key_id, status_code, created_at')
        .order('created_at', { ascending: false })
        .limit(500),
    ])

    if (keys.error) {
      if (keys.error.code === '42501') {
        return fail('FORBIDDEN', 'Only the school owner can see API keys.')
      }
      return fromPostgrestError(keys.error)
    }

    const rows = usage.error ? [] : (usage.data ?? [])

    return ok({
      keys: (keys.data ?? []).map((k) => {
        const mine = rows.filter((u) => u.api_key_id === k.id)
        return {
          id: k.id,
          name: k.name,
          prefix: k.key_prefix,
          scopes: k.scopes,
          rateLimitRpm: k.rate_limit_rpm,
          isActive: k.is_active,
          lastUsedAt: k.last_used_at,
          expiresAt: k.expires_at,
          revokedAt: k.revoked_at,
          createdAt: k.created_at,
          recentCalls: mine.length,
          /*
            Refusals surfaced separately. A run of 403s is the clearest sign a key
            has been stolen and is being probed, and it is exactly what a count of
            successful calls hides.
          */
          recentRefusals: mine.filter((u) => u.status_code === 403 || u.status_code === 401)
            .length,
        }
      }),
      scopes: SCOPES,
      implementedScopes: IMPLEMENTED,
      usageLoaded: !usage.error,
    })
  })
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  scopes: z.array(z.enum(SCOPES)).min(1, 'Choose at least one scope.'),
  expiresInDays: z.number().int().min(1).max(730).nullable().optional(),
  rateLimitRpm: z.number().int().min(1).max(6000).optional(),
})

export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const parsed = createSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return fail('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const v = parsed.data
    const key = await generateApiKey()

    const { data, error } = await client.rpc('issue_api_key', {
      p_name: v.name,
      // Only the hash crosses this boundary. The plaintext never reaches the database.
      p_key_hash: key.hash,
      p_key_prefix: key.prefix,
      p_scopes: v.scopes,
      p_expires_at:
        v.expiresInDays != null
          ? new Date(Date.now() + v.expiresInDays * 86_400_000).toISOString()
          : null,
      p_rate_limit: v.rateLimitRpm ?? 60,
    })

    if (error) {
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      if (error.code === '22023') return fail('VALIDATION_ERROR', error.message)
      if (error.code === '23505') {
        return fail('CONFLICT', 'A key with that name already exists at this school.')
      }
      return fromPostgrestError(error)
    }

    return ok({
      id: data as string,
      /*
        The one and only time this value exists outside the integrator's own system.
        The screen must make that unmistakable.
      */
      plaintext: key.plaintext,
      prefix: key.prefix,
      message:
        'Copy this key now. It cannot be shown again — if it is lost, issue a new one and revoke this.',
    })
  })
}

const revokeSchema = z.object({ id: z.string().uuid() })

export async function PATCH(request: Request): Promise<Response> {
  return guard(async () => {
    const parsed = revokeSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return fail('VALIDATION_ERROR', 'A key id is required.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { error } = await client.rpc('revoke_api_key', { p_key_id: parsed.data.id })

    if (error) {
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      if (error.code === '22023') return fail('VALIDATION_ERROR', error.message)
      return fromPostgrestError(error)
    }

    return ok({ message: 'Revoked. Calls using it stop immediately.' })
  })
}
