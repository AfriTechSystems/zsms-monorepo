/**
 * GET /api/admin/costs — per-school cost drivers.
 *
 * Spec: `03 Infrastructure Services/COST_MANAGEMENT.md`
 *
 * ## Drivers, not bills
 *
 * COST_MANAGEMENT.md lists nine billed services. ZSMS can read none of them — they are
 * external accounts with their own credentials — so this reports what each school
 * CONSUMES, which is what the document calls unit economics and what you need before any
 * threshold can be set sensibly.
 *
 * Showing a made-up money figure would be worse than showing none: somebody would price
 * a tier off it.
 */

import { createUserClient } from '../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const url = new URL(request.url)
    const raw = Number(url.searchParams.get('days') ?? '30')
    // Clamped rather than validated-and-refused: a silly number is a typo, not an attack.
    const days = Number.isFinite(raw) ? Math.min(365, Math.max(1, Math.trunc(raw))) : 30

    const { data, error } = await client.rpc('admin_school_cost_drivers', {
      p_since_days: days,
    })

    if (error) {
      if (error.code === '42501') {
        return fail('FORBIDDEN', 'Your AfriTech role does not include revenue data.')
      }
      return fromPostgrestError(error)
    }

    type Row = {
      out_school_id: string
      out_school_name: string
      out_school_code: string
      out_status: string
      out_tier: string
      out_active_pupils: number
      out_staff: number
      out_ai_credits_spent: number
      out_messages_used: number
      out_message_quota: number | null
      out_documents: number
      out_api_calls: number
    }

    const rows = (data ?? []) as Row[]

    const schools = rows.map((r) => ({
      id: r.out_school_id,
      name: r.out_school_name,
      code: r.out_school_code,
      status: r.out_status,
      tier: r.out_tier,
      pupils: Number(r.out_active_pupils),
      staff: Number(r.out_staff),
      aiCreditsSpent: Number(r.out_ai_credits_spent),
      messagesUsed: Number(r.out_messages_used),
      messageQuota: r.out_message_quota,
      documents: Number(r.out_documents),
      writes: Number(r.out_api_calls),
    }))

    const totalPupils = schools.reduce((n, s) => n + s.pupils, 0)

    return ok({
      days,
      schools,
      totals: {
        schools: schools.length,
        pupils: totalPupils,
        staff: schools.reduce((n, s) => n + s.staff, 0),
        aiCreditsSpent: schools.reduce((n, s) => n + s.aiCreditsSpent, 0),
        messagesUsed: schools.reduce((n, s) => n + s.messagesUsed, 0),
        documents: schools.reduce((n, s) => n + s.documents, 0),
      },
      /*
        The services ZSMS is billed for and cannot read, named so the screen can say
        what is missing rather than implying this page is the whole picture.
      */
      externalServices: [
        'Vercel',
        'Supabase',
        'Cloudflare R2',
        'Cloudflare WAF/CDN',
        'Upstash Redis',
        'Railway',
        'Clerk',
        'Anthropic / OpenAI',
      ],
    })
  })
}
