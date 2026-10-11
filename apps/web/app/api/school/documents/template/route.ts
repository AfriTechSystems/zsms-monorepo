/**
 * GET/PUT/PATCH /api/school/documents/template — how a school's documents look and read.
 *
 * Spec: `13 Document and PDF System/CUSTOMISATION.md` steps 2–6,
 *       `13 Document and PDF System/TEMPLATE_SYSTEM.md`
 *
 * ## Three verbs, because they are written at different times
 *
 * - **GET** returns the branding (colours, logo) and the template config together,
 *   because a school thinks of them as one screen even though they are two tables.
 * - **PUT** sets the content switches and the layout variant. Done once a year.
 * - **PATCH** writes the principal's comment for ONE term. Done every term.
 *
 * Separating the last two is not tidiness. The switches and the comment are written
 * months apart by the same person, and making them resend the whole config to add a
 * paragraph is how a switch gets clobbered.
 *
 * ## The colours were unreachable
 *
 * `school_branding.anchor_color` and `.primary_color` have existed since `0092`, each
 * with a `wcag_contrast_ratio()` CHECK, so a school physically cannot set a brand colour
 * that fails contrast on a report card a parent has to read. **Nothing could set them.**
 * The settings page edits the logo URL and stops there.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok } from '../../../../../lib/api-response'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const [template, branding] = await Promise.all([
      client.rpc('my_document_template', { p_doc_type: 'report_card' }).maybeSingle(),
      // RLS scopes this to the caller's school, so no filter is written here.
      client
        .from('school_branding')
        .select('anchor_color, primary_color, logo_url, icon_url')
        .maybeSingle(),
    ])

    if (template.error) {
      if (template.error.code === '42501') return fail('FORBIDDEN', template.error.message)
      return fromPostgrestError(template.error)
    }

    const row = template.data as {
      out_level: string
      out_layout_variant: string | null
      out_config: Record<string, unknown>
      out_configured: boolean
      out_can_use_layouts: boolean
    } | null

    const config = (row?.out_config ?? {}) as Record<string, unknown>

    return ok({
      level: row?.out_level ?? 'branding',
      layoutVariant: row?.out_layout_variant ?? null,
      isConfigured: row?.out_configured ?? false,
      // So the screen can offer the variants or explain why it cannot, rather than
      // showing a control that fails on save.
      canUseLayouts: row?.out_can_use_layouts ?? false,
      /*
        Defaults chosen to match what the renderer already does when a school has no
        config at all, so opening this screen and saving without changes cannot alter
        a single report card.
      */
      content: {
        showPosition: config['show_position'] !== false,
        showClassAverage: config['show_class_average'] !== false,
        showAttendance: config['show_attendance'] !== false,
        showComments: config['show_comments'] !== false,
        acknowledgementRequired: config['acknowledgement_required'] === true,
      },
      principalComments: (config['principal_comments'] ?? {}) as Record<string, string>,
      // A branding read that fails must not fail the page; the switches still work.
      branding: branding.error
        ? null
        : {
            anchorColor: branding.data?.anchor_color ?? null,
            primaryColor: branding.data?.primary_color ?? null,
            logoUrl: branding.data?.logo_url ?? null,
            iconUrl: branding.data?.icon_url ?? null,
          },
    })
  })
}

const hex = z
  .string()
  .trim()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'A colour must be a six-digit hex code like #1D4ED8.')

const putSchema = z.object({
  content: z.object({
    showPosition: z.boolean(),
    showClassAverage: z.boolean(),
    showAttendance: z.boolean(),
    showComments: z.boolean(),
    acknowledgementRequired: z.boolean(),
  }),
  layoutVariant: z.enum(['classic', 'modern', 'compact', 'detailed']).nullable().optional(),
  // Branding rides along because it is one screen to the user. Empty string clears.
  anchorColor: z.union([hex, z.literal('')]).optional(),
  primaryColor: z.union([hex, z.literal('')]).optional(),
  /*
    No logo here, deliberately. `worker_school_branding()` reads
    `COALESCE(b.logo_url, s.logo_url)`, so the logo the existing school settings
    screen writes already reaches every PDF. A second editor for the same picture
    would be two copies of one decision, and the unused one drifts.
  */
})

export async function PUT(request: Request): Promise<Response> {
  return guard(async () => {
    const parsed = putSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return fail('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const v = parsed.data

    const { error } = await client.rpc('set_document_template', {
      p_doc_type: 'report_card',
      // snake_case keys: the config is read in SQL by the renderer, which follows
      // database naming rather than TypeScript's.
      p_config: {
        show_position: v.content.showPosition,
        show_class_average: v.content.showClassAverage,
        show_attendance: v.content.showAttendance,
        show_comments: v.content.showComments,
        acknowledgement_required: v.content.acknowledgementRequired,
      },
      p_layout_variant: v.layoutVariant ?? null,
    })

    if (error) {
      // `22023` is the tier refusal, which names the Growth tier in its message.
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      if (error.code === '22023') return fail('VALIDATION_ERROR', error.message)
      return fromPostgrestError(error)
    }

    /*
      Colours second, through `set_school_branding_colours()` (`0259`), which
      resolves the school from the session — the row is keyed by `school_id`, and an
      upsert from here would need that id either passed in the request (where a
      caller could change it) or fetched first.

      Reported separately on failure rather than losing the switches that already
      saved: these are two independent writes, not one transaction.
    */
    if (v.anchorColor !== undefined || v.primaryColor !== undefined) {
      const brand = await client.rpc('set_school_branding_colours', {
        p_anchor_color: v.anchorColor ?? '',
        p_primary_color: v.primaryColor ?? '',
      })

      if (brand.error) {
        if (brand.error.code === '42501') return fail('FORBIDDEN', brand.error.message)
        /*
          `23514` is the contrast CHECK from `0092`. Named explicitly, because
          "constraint violation" tells a head teacher nothing and the real reason —
          this colour is too pale to read on a report card — is something they can
          act on.
        */
        if (brand.error.code === '23514') {
          return fail(
            'VALIDATION_ERROR',
            'That colour does not have enough contrast to be readable on a report card. Choose a darker shade.',
          )
        }
        return fail(
          'VALIDATION_ERROR',
          `The content settings were saved, but the colours were not: ${brand.error.message}`,
        )
      }
    }

    return ok({ message: 'Saved. New report cards will use these settings.' })
  })
}

const patchSchema = z.object({
  academicYear: z.string().trim().regex(/^\d{4}$/, 'Give the academic year as four digits.'),
  termNumber: z.number().int().min(1).max(3),
  // Empty clears the comment for that term, which is how a head removes one.
  comment: z.string().trim().max(2000),
})

export async function PATCH(request: Request): Promise<Response> {
  return guard(async () => {
    const parsed = patchSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return fail('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const v = parsed.data

    const { error } = await client.rpc('set_principal_comment', {
      p_academic_year: v.academicYear,
      p_term_number: v.termNumber,
      p_comment: v.comment,
    })

    if (error) {
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      if (error.code === '22023') return fail('VALIDATION_ERROR', error.message)
      return fromPostgrestError(error)
    }

    return ok({
      message: v.comment
        ? `Saved. This appears on every report card for term ${v.termNumber}.`
        : `Removed. Term ${v.termNumber} report cards will carry no principal's comment.`,
    })
  })
}
