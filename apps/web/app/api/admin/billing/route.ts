/**
 * GET  /api/admin/billing — invoices, and what each school would be charged now.
 * POST /api/admin/billing — run billing, issue, record a payment, void.
 *
 * Spec: `Official Documentation/17 Integration and Pricing/PRICING.md`
 *       migrations `0124`–`0126`
 *
 * ## The run reports failures by name, and the screen must show them
 *
 * `run_billing()` catches a per-school error so one school's configuration gap does
 * not abort the whole month — but it returns those schools in `problems`, and this
 * route passes them through untouched. A billing run that quietly skipped four
 * schools is a month of revenue nobody notices is missing.
 *
 * ## Nothing here computes money
 *
 * Every figure comes from a database function. The route validates, dispatches and
 * renders. Re-deriving a total in TypeScript would create a second arithmetic that
 * could disagree with the invoice actually stored.
 */

import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { resolveAdminContext } from '../../../../lib/admin-context'
import { fail, fromPostgrestError, guard, ok, validationFailed } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('run_billing'),
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    currency: z.enum(['ZMW', 'USD']).optional(),
    // Percent, not a fraction. 16 means 16%.
    taxRate: z.number().min(0).max(100).optional(),
  }),
  z.object({
    action: z.literal('generate_one'),
    schoolId: z.string().uuid(),
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    currency: z.enum(['ZMW', 'USD']).optional(),
    taxRate: z.number().min(0).max(100).optional(),
  }),
  z.object({ action: z.literal('issue'), invoiceId: z.string().uuid() }),
  z.object({
    action: z.literal('record_payment'),
    invoiceId: z.string().uuid(),
    amount: z
      .number()
      .positive()
      .refine((v) => Math.round(v * 100) === v * 100, { message: 'At most two decimal places' }),
    // No `gateway` here: a gateway payment is confirmed by a webhook, not typed in
    // by an operator. Offering it would let somebody assert a charge nobody made.
    method: z.enum(['bank_transfer', 'mobile_money', 'cash', 'cheque']),
    reference: z.string().trim().max(120).optional(),
    notes: z.string().trim().max(500).optional(),
  }),
  z.object({
    action: z.literal('void'),
    invoiceId: z.string().uuid(),
    reason: z.string().trim().min(3).max(300),
  }),
])

export async function GET(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const admin = await resolveAdminContext()
    if (!admin) {
      return fail('FORBIDDEN', 'This area is restricted to AfriTech platform administrators.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const status = request.nextUrl.searchParams.get('status')

    let query = client
      .from('invoices')
      .select(
        'id, invoice_number, school_id, period_start, period_end, currency, tier_name, ' +
          'pricing_model, student_count, unit_price, subtotal, tax_rate, tax_amount, ' +
          'total, amount_paid, status, issued_at, due_at',
      )
      .order('period_start', { ascending: false })
      .limit(300)

    if (status) query = query.eq('status', status)

    const [invoices, schools] = await Promise.all([
      query,
      client
        .from('schools')
        .select('id, school_id, name, subscription_tier, status')
        .eq('status', 'active')
        .order('name', { ascending: true }),
    ])

    if (invoices.error) return fromPostgrestError(invoices.error)

    const rows = (invoices.data ?? []) as unknown as Array<Record<string, unknown>>
    const num = (v: unknown): number => {
      const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : 0
      return Number.isFinite(n) ? n : 0
    }

    const live = rows.filter((r) => r['status'] !== 'void')

    return ok({
      invoices: rows,
      schools: schools.data ?? [],
      totals: {
        billed: live.reduce((t, r) => t + num(r['total']), 0),
        collected: live.reduce((t, r) => t + num(r['amount_paid']), 0),
        outstanding: live.reduce((t, r) => t + num(r['total']) - num(r['amount_paid']), 0),
        drafts: rows.filter((r) => r['status'] === 'draft').length,
        overdue: rows.filter(
          (r) =>
            ['issued', 'part_paid'].includes(String(r['status'])) &&
            r['due_at'] !== null &&
            new Date(String(r['due_at'])) < new Date(),
        ).length,
      },
    })
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const admin = await resolveAdminContext()
    if (!admin) {
      return fail('FORBIDDEN', 'This area is restricted to AfriTech platform administrators.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    let raw: unknown
    try {
      raw = await request.json()
    } catch {
      return fail('VALIDATION_ERROR', 'Request body must be valid JSON.')
    }

    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) return validationFailed(parsed.error)
    const body = parsed.data

    switch (body.action) {
      case 'run_billing': {
        const { data, error } = await client.rpc('run_billing', {
          p_period_start: body.periodStart,
          p_period_end: body.periodEnd,
          p_currency: body.currency ?? 'ZMW',
          p_tax_rate: body.taxRate ?? 0,
        })
        if (error) {
          if (error.code === '42501') return fail('FORBIDDEN', error.message)
          return fromPostgrestError(error)
        }
        const r = ((data ?? []) as Array<Record<string, unknown>>)[0]
        return ok({
          created: r?.['out_created'] ?? 0,
          skipped: r?.['out_skipped'] ?? 0,
          failed: r?.['out_failed'] ?? 0,
          // Passed through untouched. A run that silently skipped schools is a month
          // of revenue nobody notices is missing.
          problems: r?.['out_problems'] ?? [],
        })
      }

      case 'generate_one': {
        const { data, error } = await client.rpc('generate_school_invoice', {
          p_school_id: body.schoolId,
          p_period_start: body.periodStart,
          p_period_end: body.periodEnd,
          p_currency: body.currency ?? 'ZMW',
          p_tax_rate: body.taxRate ?? 0,
        })
        if (error) {
          if (error.code === '42501') return fail('FORBIDDEN', error.message)
          if (error.code === '23505') {
            return fail('CONFLICT', 'That school already has an invoice for this period.')
          }
          // 23514 is the resolver refusing — a band gap or a missing price row. Its
          // own sentence names the school's actual problem.
          if (error.code === '23514') return fail('VALIDATION_ERROR', error.message)
          return fromPostgrestError(error)
        }
        return ok({ invoice: data })
      }

      case 'issue': {
        const { data, error } = await client.rpc('issue_invoice', { p_invoice_id: body.invoiceId })
        if (error) {
          if (error.code === '42501') return fail('FORBIDDEN', error.message)
          if (error.code === 'P0002') return fail('CONFLICT', error.message)
          return fromPostgrestError(error)
        }
        return ok({ invoice: data })
      }

      case 'record_payment': {
        const { data, error } = await client.rpc('record_invoice_payment', {
          p_invoice_id: body.invoiceId,
          p_amount: body.amount,
          p_method: body.method,
          p_reference: body.reference ?? null,
          p_notes: body.notes ?? null,
        })
        if (error) {
          if (error.code === '42501') return fail('FORBIDDEN', error.message)
          if (error.code === '23514' || error.code === 'P0002') {
            return fail('CONFLICT', error.message)
          }
          return fromPostgrestError(error)
        }
        return ok({ payment: data })
      }

      case 'void': {
        const { data, error } = await client.rpc('void_invoice', {
          p_invoice_id: body.invoiceId,
          p_reason: body.reason,
        })
        if (error) {
          if (error.code === '42501') return fail('FORBIDDEN', error.message)
          if (error.code === '23514') return fail('CONFLICT', error.message)
          return fromPostgrestError(error)
        }
        return ok({ invoice: data })
      }
    }
  })
}
