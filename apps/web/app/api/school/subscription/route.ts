/**
 * GET /api/school/subscription — what this school is on, and what it has been billed.
 *
 * Spec: `Official Documentation/17 Integration and Pricing/PRICING.md`
 *       migrations `0124`–`0126`
 *
 * ## A school can see its own bill, without the `afritech` schema being reachable
 *
 * `afritech` is deliberately off PostgREST (0097/0098), so there is no policy that
 * would let a school read `afritech.invoices`. `my_school_invoices()` is a
 * SECURITY DEFINER function scoped to the caller's own school and to management
 * roles inside it — the same pattern the admin dashboard uses in the other
 * direction. A school seeing what it is charged is not a concession; it is the
 * minimum a paying customer is owed.
 *
 * Drafts are excluded by that function. Sending somebody a bill you have not issued
 * invites an argument about a figure you were still checking.
 *
 * ## The current charge is shown as a projection, and labelled as one
 *
 * `school_subscription_charge()` resolves what the school WOULD be billed on today's
 * roll. On a per-student plan that figure moves as pupils enrol, so it is presented
 * as an estimate for the current period rather than as an amount owed. Showing it as
 * a bill would have a school reconcile against a number that changes.
 */

import { createUserClient } from '../../../../lib/supabase'
import { resolveFeeCaller as resolveSchoolCaller } from '../../../../lib/fee-context'
import { resolveSchoolContext } from '../../../../lib/school-context'
import { can } from '../../../../lib/roles'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  return guard(async () => {
    const caller = await resolveSchoolCaller()
    if (!caller.ok) return caller.response

    // Same roles `my_school_invoices()` admits. Checked here too so the refusal is a
    // sentence rather than an empty list that looks like "no bills yet".
    if (!can(caller.role, 'fees:read')) {
      return fail(
        'FORBIDDEN',
        'Only the school owner, head teacher and accountant can see the subscription.',
      )
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const school = await resolveSchoolContext(client)
    if (!school) return fail('FORBIDDEN', 'This session is not associated with a school.')

    const [invoices, charge, capacity] = await Promise.all([
      client.rpc('my_school_invoices'),
      client.rpc('school_subscription_charge', { p_school_id: school.uuid, p_currency: 'ZMW' }),
      client.rpc('school_student_capacity', { p_school_id: school.uuid }),
    ])

    if (invoices.error) return fromPostgrestError(invoices.error)

    const rows = (invoices.data ?? []) as unknown as Array<Record<string, unknown>>
    const c = ((charge.data ?? []) as unknown as Array<Record<string, unknown>>)[0] ?? null
    const cap = ((capacity.data ?? []) as unknown as Array<Record<string, unknown>>)[0] ?? null

    const num = (v: unknown): number => {
      const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : 0
      return Number.isFinite(n) ? n : 0
    }

    return ok({
      invoices: rows.map((r) => ({
        id: r['out_id'],
        number: r['out_invoice_number'],
        periodStart: r['out_period_start'],
        periodEnd: r['out_period_end'],
        currency: r['out_currency'],
        tier: r['out_tier_name'],
        pricingModel: r['out_pricing_model'],
        studentCount: r['out_student_count'],
        unitPrice: r['out_unit_price'],
        subtotal: r['out_subtotal'],
        taxAmount: r['out_tax_amount'],
        total: r['out_total'],
        amountPaid: r['out_amount_paid'],
        status: r['out_status'],
        issuedAt: r['out_issued_at'],
        dueAt: r['out_due_at'],
      })),
      outstanding: rows
        .filter((r) => r['out_status'] !== 'paid' && r['out_status'] !== 'void')
        .reduce((t, r) => t + num(r['out_total']) - num(r['out_amount_paid']), 0),
      // A projection, and the screen says so.
      currentCharge: c
        ? {
            tier: c['out_tier'],
            pricingModel: c['out_pricing_model'],
            studentCount: c['out_student_count'],
            unitPrice: c['out_unit_price'],
            amount: c['out_amount'],
            currency: c['out_currency'],
            // Non-null when the charge could NOT be resolved — a band gap or a tier
            // with no price row. Surfaced so a school can raise it rather than
            // discovering a missing invoice.
            problem: c['out_reason'],
          }
        : null,
      capacity: cap
        ? {
            limit: cap['student_limit'],
            isUnlimited: cap['is_unlimited'],
            source: cap['source'],
            currentCount: cap['current_count'],
          }
        : null,
    })
  })
}
