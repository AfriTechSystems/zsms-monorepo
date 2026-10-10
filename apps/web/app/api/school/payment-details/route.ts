/**
 * GET/PATCH /api/school/payment-details — where the school wants to be paid.
 *
 * Spec: `Official Documentation/09 Fee and Financial Management/PAYMENTS.md`
 *
 * ## Why this exists
 *
 * `PAYMENTS.md` has a parent uploading proof of a payment they made by bank transfer or
 * mobile money, and until `0212` the schema held nowhere for a school to publish the
 * account to pay INTO. So a parent could record a claim while ZSMS could not tell them
 * the account number — they rang the school, which is the thing this product exists to
 * stop.
 *
 * ## Authorisation stays in the policies
 *
 * `management_write_payment_details` admits `org:owner`, `org:admin` and
 * `org:accountant`, and nothing else. This route adds no role check of its own: a check
 * here would be a second copy that drifts, and it is the copy a direct PostgREST call
 * skips. A teacher gets an empty result or a policy refusal from the database.
 *
 * Deactivating rather than deleting is the only removal offered. A closed account must
 * stop being shown to parents while the payments made into it keep their meaning.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const KINDS = ['bank_account', 'mobile_money', 'cash_office', 'gateway', 'other'] as const

export async function GET(): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    /*
      One literal `select`, never concatenated — PostgREST loses row-type inference when
      the column list is built from pieces, and the symptom is a `GenericStringError`
      that names nothing useful.

      Inactive rows are included here, unlike the parent view: a school needs to see what
      it has switched off in order to switch it back on.
    */
    const { data, error } = await client
      .from('school_payment_details')
      .select(
        'id, method_kind, label, bank_name, account_name, account_number, branch, swift_code, provider, phone_number, gateway_name, instructions, is_active, display_order',
      )
      .order('display_order', { ascending: true })

    if (error) return fromPostgrestError(error)

    const rows = data ?? []

    return ok({
      accounts: rows.map((a) => ({
        id: a.id,
        methodKind: a.method_kind,
        label: a.label,
        bankName: a.bank_name,
        accountName: a.account_name,
        accountNumber: a.account_number,
        branch: a.branch,
        swiftCode: a.swift_code,
        provider: a.provider,
        phoneNumber: a.phone_number,
        gatewayName: a.gateway_name,
        instructions: a.instructions,
        isActive: a.is_active,
        displayOrder: a.display_order,
      })),
      /*
        Whether a parent would currently be shown anything.

        Said explicitly because the consequence is invisible from this screen: with no
        active account, the parent fee page shows no "how to pay" card at all and a
        parent is back to telephoning the office.
      */
      visibleToParents: rows.filter((a) => a.is_active).length,
    })
  })
}

const patchSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('save'),
    /** Omitted creates; supplied updates that row. */
    id: z.string().uuid().optional(),
    methodKind: z.enum(KINDS),
    label: z.string().trim().min(1).max(120),

    bankName: z.string().trim().max(120).nullable().optional(),
    accountName: z.string().trim().max(160).nullable().optional(),
    accountNumber: z.string().trim().max(60).nullable().optional(),
    branch: z.string().trim().max(120).nullable().optional(),
    swiftCode: z.string().trim().max(20).nullable().optional(),

    provider: z.string().trim().max(60).nullable().optional(),
    phoneNumber: z.string().trim().max(30).nullable().optional(),

    gatewayName: z.string().trim().max(60).nullable().optional(),

    instructions: z.string().trim().max(600).nullable().optional(),
    displayOrder: z.number().int().min(0).max(999).optional(),
  }),
  /*
    Deactivation, not deletion.

    A closed bank account must stop appearing to parents while the payments recorded
    against it keep their meaning. There is no delete action at all.
  */
  z.object({
    action: z.literal('setActive'),
    id: z.string().uuid(),
    isActive: z.boolean(),
  }),
])

export async function PATCH(request: Request): Promise<Response> {
  return guard(async () => {
    const parsed = patchSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return fail('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    if (parsed.data.action === 'setActive') {
      const { error } = await client
        .from('school_payment_details')
        .update({ is_active: parsed.data.isActive, updated_at: new Date().toISOString() })
        .eq('id', parsed.data.id)

      if (error) return fromPostgrestError(error)
      return ok({
        message: parsed.data.isActive
          ? 'Parents can see this account again.'
          : 'Parents will no longer see this account. Payments already recorded against it are unchanged.',
      })
    }

    const v = parsed.data

    /*
      `school_id` is NOT taken from the body.

      It comes from the session via `current_school_uuid()`, and the policy's WITH CHECK
      enforces that independently. A caller supplying one could otherwise publish an
      account number into another school's fee page, which is the most valuable write in
      this entire schema.
    */
    const row = {
      method_kind: v.methodKind,
      label: v.label,
      bank_name: v.bankName ?? null,
      account_name: v.accountName ?? null,
      account_number: v.accountNumber ?? null,
      branch: v.branch ?? null,
      swift_code: v.swiftCode ?? null,
      provider: v.provider ?? null,
      phone_number: v.phoneNumber ?? null,
      gateway_name: v.gatewayName ?? null,
      instructions: v.instructions ?? null,
      display_order: v.displayOrder ?? 0,
      updated_at: new Date().toISOString(),
    }

    if (v.id) {
      const { error } = await client
        .from('school_payment_details')
        .update(row)
        .eq('id', v.id)

      if (error) return mapWriteError(error)
      return ok({ message: 'Account updated.' })
    }

    const { data, error } = await client
      .from('school_payment_details')
      .insert({ ...row, school_id: await resolveSchool(client) })
      .select('id')
      .maybeSingle()

    if (error) return mapWriteError(error)
    if (!data) {
      return fail(
        'FORBIDDEN',
        'That account could not be saved. Only an owner, administrator or accountant can change where fees are paid.',
      )
    }

    return ok({ id: data.id, message: 'Account added. Parents can see it now.' })
  })
}

/** The caller's own school, from the session. Never from the request body. */
async function resolveSchool(
  client: NonNullable<Awaited<ReturnType<typeof createUserClient>>>,
): Promise<string | null> {
  const { data } = await client.rpc('current_school_uuid')
  return (data as string | null) ?? null
}

/**
 * Turns the database's refusals into something a bursar can act on.
 *
 * The usability CHECK from `0212` is the one worth translating: its raw message names a
 * constraint, and the person reading it needs to know which field they left blank.
 */
function mapWriteError(error: { code?: string; message: string }): Response {
  if (error.code === '23514') {
    return fail(
      'VALIDATION_ERROR',
      'That account is missing the detail a parent would need — an account number for a bank, or a phone number for mobile money.',
    )
  }
  if (error.code === '42501') {
    return fail(
      'FORBIDDEN',
      'Only an owner, administrator or accountant can change where fees are paid.',
    )
  }
  return fromPostgrestError(error)
}
