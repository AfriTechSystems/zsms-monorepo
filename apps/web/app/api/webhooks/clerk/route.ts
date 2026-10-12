/**
 * POST /api/webhooks/clerk — Clerk user and organisation events.
 *
 * Spec: `05 Core Database and API Reference/WEBHOOKS.md` → *Clerk User and Organisation
 *       Events*, ADR-044 (webhooks are Next.js routes, not Edge Functions)
 *
 * ## The first webhook ZSMS has ever had
 *
 * WEBHOOKS.md specifies ten inbound webhooks — Clerk, seven payment gateways, Meta, and
 * lending partners. None existed. This one is first because it is the only one not
 * blocked on an account that does not exist: Clerk is already the auth provider, and all
 * that is needed is the signing secret.
 *
 * ## What it is actually for
 *
 * Clerk owns identity; ZSMS owns the school record. They drift. A teacher changes their
 * email in Clerk and `staff_members.email` still says the old one — so the school
 * directory is wrong, and nobody finds out until somebody tries to use it.
 *
 * This keeps the ZSMS side in step. It deliberately does NOT create records: a
 * `user.created` event is somebody signing up, which is `/welcome`'s business, and a
 * webhook that enrols people would be a second provisioning path competing with the one
 * that has the rules in it.
 *
 * ## Order of operations, and why it is this way
 *
 * Verify, then claim, then act. Verifying first means an unsigned request never reaches
 * the database. Claiming before acting means a retry is refused before the work repeats
 * — and since Clerk retries on any non-2xx, the handler returns **200 even when it
 * cannot act**, with the reason recorded. A sender retrying forever against a decision
 * ZSMS has already made is a retry storm, not resilience.
 */

import { NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { verifySvixSignature } from '../../../../lib/webhook-verify'

export const dynamic = 'force-dynamic'

/** Answer every outcome the same way. See the header. */
function ack(status: string, detail?: string): NextResponse {
  return NextResponse.json({ received: true, status, detail }, { status: 200 })
}

/*
  Returns the loose `SupabaseClient`, matching `lib/supabase.ts`.

  `ReturnType<typeof createClient>` resolves to a narrower generic than the value
  actually produced here, so passing the client to `handle()` failed to type-check
  against its own creator — the inference disagreeing with itself rather than anything
  being wrong with the client.
*/
function serviceClient(): SupabaseClient | null {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) return null
  // A webhook has no session by definition — the signature is the authentication.
  return createClient(url, key, { auth: { persistSession: false } })
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env['CLERK_WEBHOOK_SECRET']

  if (!secret) {
    /*
      401, not 200.

      Everywhere else this handler acknowledges rather than asking for a retry — but an
      unconfigured secret means ZSMS cannot verify anything, and acknowledging would
      tell Clerk the event was handled when it was discarded. Better that deliveries
      queue up at Clerk's end until somebody sets the secret.
    */
    return NextResponse.json(
      { error: 'CLERK_WEBHOOK_SECRET is not configured.', code: 'SERVER_ERROR' },
      { status: 401 },
    )
  }

  /*
    The RAW body, read before anything parses it.

    The signature is over the exact bytes. Parsing to JSON and re-serialising changes
    key order and whitespace, and the signature then never matches — the single most
    common way a correct webhook implementation fails.
  */
  const rawBody = await request.text()

  const verification = await verifySvixSignature({
    rawBody,
    signingSecret: secret,
    svixId: request.headers.get('svix-id'),
    svixTimestamp: request.headers.get('svix-timestamp'),
    svixSignature: request.headers.get('svix-signature'),
  })

  if (!verification.valid) {
    /*
      The reason is logged and NOT returned. "Timestamp outside tolerance" and "no
      signature matched" tell an attacker which half of their forgery is wrong, which
      is exactly the feedback loop a public endpoint must not provide.
    */
    console.warn('[webhook/clerk] rejected:', verification.reason)
    return NextResponse.json(
      { error: 'Invalid signature.', code: 'WEBHOOK_SIGNATURE_INVALID' },
      { status: 401 },
    )
  }

  let event: { type?: string; data?: Record<string, unknown> }
  try {
    event = JSON.parse(rawBody)
  } catch {
    return ack('ignored', 'body was not JSON')
  }

  const db = serviceClient()
  if (!db) return ack('ignored', 'no database connection configured')

  // Svix's own delivery id is the idempotency key — ZSMS must not invent one, because
  // an invented id differs on every retry and defeats the whole mechanism.
  const eventId = request.headers.get('svix-id')!

  const { data: claim } = await db
    .rpc('claim_webhook_event', {
      p_provider: 'clerk',
      p_event_id: eventId,
      p_event_type: event.type ?? null,
      p_payload: event as unknown as Record<string, unknown>,
    })
    .maybeSingle()

  const row = claim as { out_id: string; out_is_duplicate: boolean } | null

  if (!row) return ack('ignored', 'could not record the delivery')
  if (row.out_is_duplicate) return ack('duplicate', 'already processed')

  try {
    const handled = await handle(db, event)
    await db.rpc('complete_webhook_event', {
      p_id: row.out_id,
      p_status: handled.status,
      p_error: handled.detail ?? null,
      p_school_id: null,
    })
    return ack(handled.status, handled.detail)
  } catch (error) {
    await db.rpc('complete_webhook_event', {
      p_id: row.out_id,
      p_status: 'failed',
      p_error: error instanceof Error ? error.message : 'unknown',
      p_school_id: null,
    })
    /*
      Still 200. The delivery is recorded as failed and is visible in
      `webhook_events`; asking Clerk to retry would repeat a failure that is ZSMS's to
      fix, not Clerk's to resend.
    */
    return ack('failed', 'recorded for investigation')
  }
}

interface Outcome {
  status: 'processed' | 'ignored' | 'failed'
  detail?: string
}

/**
 * What ZSMS actually does with each event.
 *
 * Deliberately short. Only events where Clerk holds the newer truth and ZSMS holds a
 * stale copy are acted on; everything else is recorded and ignored, which is a real
 * outcome rather than a gap.
 */
async function handle(
  db: SupabaseClient,
  event: { type?: string; data?: Record<string, unknown> },
): Promise<Outcome> {
  const data = event.data ?? {}
  const userId = typeof data['id'] === 'string' ? data['id'] : null

  switch (event.type) {
    case 'user.updated': {
      if (!userId) return { status: 'ignored', detail: 'no user id' }

      const emails = data['email_addresses']
      const email =
        Array.isArray(emails) && emails.length > 0
          ? ((emails[0] as { email_address?: string }).email_address ?? null)
          : null

      if (!email) return { status: 'ignored', detail: 'no email on the event' }

      /*
        Both tables, because one Clerk account can be a member of staff at one school
        and a parent at another — in a small town that is an ordinary Tuesday. Updating
        only one would leave the other stale and the drift invisible.

        `parents.email` is NOT what links a parent to their children: `claim_parent_links()`
        matches on the VERIFIED address in the JWT. So this corrects the school's
        directory without touching anybody's access.
      */
      const staff = await db
        .from('staff_members')
        .update({ email, updated_at: new Date().toISOString() })
        .eq('clerk_user_id', userId)
        .select('id')

      const parents = await db
        .from('parents')
        .update({ email, updated_at: new Date().toISOString() })
        .eq('clerk_user_id', userId)
        .select('id')

      const touched = (staff.data?.length ?? 0) + (parents.data?.length ?? 0)

      return touched > 0
        ? { status: 'processed', detail: `email synced on ${touched} record(s)` }
        : { status: 'ignored', detail: 'no ZSMS record for that user' }
    }

    case 'organizationMembership.deleted': {
      /*
        Somebody removed from a school's Clerk organisation. Their staff record is
        deactivated, never deleted — `is_active = false` keeps the employment history,
        the audit trail and every mark they ever entered attributable.
      */
      const publicUserData = data['public_user_data'] as { user_id?: string } | undefined
      const removedUser = publicUserData?.user_id
      if (!removedUser) return { status: 'ignored', detail: 'no user id on the event' }

      const result = await db
        .from('staff_members')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('clerk_user_id', removedUser)
        .select('id')

      return (result.data?.length ?? 0) > 0
        ? { status: 'processed', detail: 'staff record deactivated' }
        : { status: 'ignored', detail: 'no staff record for that user' }
    }

    default:
      /*
        Recorded and ignored, which is not the same as dropped. `user.created` is
        deliberately here: signing up is `/welcome`'s business, and a webhook that
        enrolled people would be a second provisioning path competing with the one that
        has the rules in it.
      */
      return { status: 'ignored', detail: `no handler for ${event.type ?? 'unknown'}` }
  }
}
