/**
 * GET/PATCH /api/school/integrations — accounting and CRM connections (ADR-023).
 *
 * Spec: `01 Foundation Layer/DECISIONS.md` → ADR-023,
 *       `17 Integration and Pricing/INTEGRATIONS.md`
 *
 * ## Tier 1 only, and the screen says so
 *
 * ADR-023 has three tiers. This is the first: a school records which system it wants
 * connected and which events it wants sent. The **dispatcher is not built**, so nothing
 * is delivered yet — and that is stated on the screen rather than left for a bursar to
 * discover at year end when Sage has nothing in it.
 *
 * ## Credentials cannot be saved, by design
 *
 * `FIELD_ENCRYPTION_KEY` is unset, so there is nothing to encrypt a token with. The
 * column's CHECK refuses anything not already encrypted, so this route does not accept a
 * credential at all. A route that took one and stored it "for now" is how a school's
 * QuickBooks token ends up in plaintext in every backup.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

/** ADR-023's three tiers, as the schema's CHECK admits them. */
const TYPES = [
  'sage_50_export',
  'sage_business_cloud',
  'quickbooks',
  'xero',
  'google_sheets',
  'hubspot',
  'custom_webhook',
] as const

/**
 * The events a school can subscribe to.
 *
 * Deliberately a closed list: a free-text event name would be accepted, stored, and
 * never fire, which looks exactly like a working integration until somebody checks.
 */
const EVENTS = [
  'payment.verified',
  'payment.recorded',
  'invoice.generated',
  'student.enrolled',
  'student.withdrawn',
  'results.published',
] as const

export async function GET(): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client
      .from('school_integrations')
      .select(
        'id, integration_type, display_name, is_active, is_paused, pause_reason, events_subscribed, last_sync_at, last_sync_status, last_error, credentials_enc',
      )
      .order('display_name')

    if (error) return fromPostgrestError(error)

    return ok({
      integrations: (data ?? []).map((row) => ({
        id: row.id,
        type: row.integration_type,
        name: row.display_name,
        isActive: row.is_active,
        isPaused: row.is_paused,
        pauseReason: row.pause_reason,
        events: row.events_subscribed,
        lastSyncAt: row.last_sync_at,
        lastSyncStatus: row.last_sync_status,
        lastError: row.last_error,
        // Whether a credential exists — never the credential.
        hasCredentials: Boolean(row.credentials_enc),
      })),
      types: TYPES,
      events: EVENTS,
      /*
        Stated as data rather than hardcoded in the screen, so when the dispatcher
        ships the notice disappears everywhere at once.
      */
      dispatchReady: false,
    })
  })
}

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('save'),
    id: z.string().uuid().optional(),
    type: z.enum(TYPES),
    name: z.string().trim().min(1).max(80),
    events: z.array(z.enum(EVENTS)).max(EVENTS.length),
  }),
  z.object({
    action: z.literal('setActive'),
    id: z.string().uuid(),
    isActive: z.boolean(),
  }),
])

export async function PATCH(request: Request): Promise<Response> {
  return guard(async () => {
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return fail('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const v = parsed.data

    if (v.action === 'setActive') {
      const { error } = await client
        .from('school_integrations')
        .update({ is_active: v.isActive, updated_at: new Date().toISOString() })
        .eq('id', v.id)

      if (error) return mapError(error)
      return ok({ message: v.isActive ? 'Connection switched on.' : 'Connection switched off.' })
    }

    if (v.id) {
      const { error } = await client
        .from('school_integrations')
        .update({
          display_name: v.name,
          events_subscribed: v.events,
          updated_at: new Date().toISOString(),
        })
        .eq('id', v.id)

      if (error) return mapError(error)
      return ok({ message: 'Connection updated.' })
    }

    // The school comes from the session; the policy's WITH CHECK enforces it again.
    const school = await client.rpc('current_school_uuid')
    const schoolId = (school.data as string | null) ?? null
    if (!schoolId) return fail('FORBIDDEN', 'No school is available to this session.')

    const who = await client.rpc('get_user_id')

    const { data, error } = await client
      .from('school_integrations')
      .insert({
        school_id: schoolId,
        integration_type: v.type,
        display_name: v.name,
        events_subscribed: v.events,
        created_by: (who.data as string | null) ?? 'unknown',
      })
      .select('id')
      .maybeSingle()

    if (error) return mapError(error)
    if (!data) {
      return fail(
        'FORBIDDEN',
        'Only the owner, principal or accountant can set up a connection.',
      )
    }

    return ok({ id: data.id, message: 'Connection created.' })
  })
}

function mapError(error: { code?: string; message: string }): Response {
  if (error.code === '23505') {
    return fail(
      'CONFLICT',
      'That system is already connected. Edit the existing connection instead — two would post everything twice.',
    )
  }
  if (error.code === '23514') {
    return fail('VALIDATION_ERROR', 'ZSMS cannot store that value.')
  }
  if (error.code === '42501') {
    return fail('FORBIDDEN', 'Only the owner, principal or accountant can change connections.')
  }
  return fromPostgrestError(error)
}
