/**
 * GET /api/school/integrations/sage50 — a Sage 50 batch import CSV.
 *
 * Spec: `17 Integration and Pricing/ACCOUNTING_CONNECTORS.md` → *Connector 1 —
 *       Sage 50 (Desktop) — CSV Export*
 *
 * ## Why this connector works today and the others do not
 *
 * Every other integration in folder 17 waits on a credential: Sage Business Cloud and
 * Xero need OAuth, QuickBooks needs an app, HubSpot needs a key, and a custom webhook
 * needs a signing secret that cannot be stored while `FIELD_ENCRYPTION_KEY` is unset.
 *
 * Sage 50 needs nothing. It is a desktop application with no cloud API, so the
 * integration is a file the accountant downloads and imports through Sage's batch
 * feature — and ACCOUNTING_CONNECTORS.md notes Sage 50 Pastel is the most common
 * accounting software in Zambian private schools.
 *
 * ## The CSV is built here, not in SQL
 *
 * Sage's column order, its `DD/MM/YYYY` dates and its `SA` type code are facts about
 * Sage, not about a payment. `sage50_export_rows()` returns the rows; this turns them
 * into the shape one particular desktop application expects.
 *
 * ## Nominal codes come from the school's own configuration
 *
 * A Zambian school's chart of accounts is its own. The default is 4000 because that is
 * what the document uses as an example, and `nominal_code_by_fee_label` overrides per fee
 * type — so a school that books boarding to 4002 says so once rather than editing every
 * export.
 */

import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { createUserClient } from '../../../../../lib/supabase'
import { fail, fromPostgrestError, guard } from '../../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const query = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Give the start date as YYYY-MM-DD.'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Give the end date as YYYY-MM-DD.'),
})

interface Sage50Config {
  default_nominal_code?: string
  nominal_code_by_fee_label?: Record<string, string>
  date_format?: 'DD/MM/YYYY' | 'MM/DD/YYYY'
  include_student_name?: boolean
  tax_code?: string
}

/**
 * RFC 4180 quoting.
 *
 * A Zambian pupil's name can carry an apostrophe and a fee label can carry a comma, and
 * either unescaped shifts every subsequent column — which Sage imports without complaint
 * and the accountant discovers at reconciliation.
 */
function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function formatDate(iso: string, format: string): string {
  const [y, m, d] = iso.split('-')
  return format === 'MM/DD/YYYY' ? `${m}/${d}/${y}` : `${d}/${m}/${y}`
}

export async function GET(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const parsed = query.safeParse(Object.fromEntries(request.nextUrl.searchParams))
    if (!parsed.success) {
      return fail('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid date range.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    /*
      The school's configuration, if it has any. RLS scopes the read, and a missing
      row is the ordinary case — a school that has never opened the integrations
      screen still gets a usable export against the default nominal code.
    */
    const settings = await client
      .from('school_integrations')
      .select('config, is_active, is_paused')
      .eq('integration_type', 'sage_50_export')
      .maybeSingle()

    const config = (settings.data?.config ?? {}) as Sage50Config
    const dateFormat = config.date_format ?? 'DD/MM/YYYY'
    const taxCode = config.tax_code ?? 'T0'
    const defaultCode = config.default_nominal_code ?? '4000'
    const byLabel = config.nominal_code_by_fee_label ?? {}
    const includeName = config.include_student_name !== false

    const { data, error } = await client.rpc('sage50_export_rows', {
      p_from: parsed.data.from,
      p_to: parsed.data.to,
    })

    if (error) {
      // The function's own refusals, which are the enforcement.
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      if (error.code === '22023') return fail('VALIDATION_ERROR', error.message)
      return fromPostgrestError(error)
    }

    const rows = (data ?? []) as Array<{
      out_receipt_number: string | null
      out_paid_at: string
      out_student_name: string
      out_fee_label: string
      out_term_number: number | null
      out_amount: string
    }>

    /*
      The header Sage 50's Nominal Ledger batch import expects, verbatim from
      ACCOUNTING_CONNECTORS.md. Sage matches on these names, so this is not a place
      to tidy the capitalisation.
    */
    const lines = ['Type,Account,Date,Reference,Description,Net Amount,Tax Code,Tax Amount']

    for (const r of rows) {
      const description = [
        includeName ? r.out_student_name : null,
        r.out_fee_label,
        r.out_term_number ? `Term ${r.out_term_number}` : null,
      ]
        .filter(Boolean)
        .join(' - ')

      lines.push(
        [
          // SA = Sales Receipt. Money received, which is all this export carries.
          'SA',
          csvCell(byLabel[r.out_fee_label] ?? defaultCode),
          formatDate(r.out_paid_at, dateFormat),
          /*
            The receipt number is the link between the two systems. A verified
            payment always has one — `payments` has a CHECK enforcing it — so an
            empty reference here would mean something is wrong upstream rather than
            that this row is unremarkable.
          */
          csvCell(r.out_receipt_number ?? ''),
          csvCell(description),
          Number(r.out_amount).toFixed(2),
          csvCell(taxCode),
          // Zero-rated: school fees are VAT exempt in Zambia.
          '0.00',
        ].join(','),
      )
    }

    /*
      `\r\n` and a UTF-8 BOM.

      Sage 50 is a Windows desktop application. Without the BOM it reads the file in
      the system codepage and a name like "Mwaanga Bwalya" survives while one with a
      diacritic does not; without CRLF some Sage versions treat the whole file as one
      line. Both are one-character fixes for a failure that looks like corrupt data.
    */
    const csv = '﻿' + lines.join('\r\n') + '\r\n'

    const filename = `sage50-${parsed.data.from}-to-${parsed.data.to}.csv`

    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        // The count, so a screen can say what it downloaded without parsing the file.
        'X-ZSMS-Row-Count': String(rows.length),
        'Cache-Control': 'no-store',
      },
    })
  })
}
