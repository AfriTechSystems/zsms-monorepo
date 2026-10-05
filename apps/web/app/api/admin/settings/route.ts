/**
 * GET/PATCH /api/admin/settings — every platform-wide switch, in one place.
 *
 * Spec: `Official Documentation/15 Super Admin and Platform/SUPERADMIN.md`,
 *       `Official Documentation/01 Foundation Layer/DYNAMIC_CONFIG.md`, ADR-031
 *
 * ## Why this replaces a function per toggle
 *
 * `0210` added `admin_set_ai_generation()` for one key. That does not generalise — the
 * next switch gets another function and another route, and the toggles end up scattered
 * across the admin area, which is the thing this consolidates.
 *
 * `admin_platform_settings()` and `admin_set_platform_setting()` (`0216`) are the generic
 * pair. A new setting arrives by migration, with its description and default written
 * down, and appears here without any code change.
 *
 * ## Validation lives here, not in the database
 *
 * The database refuses an unknown key, a blank value and a blank reason. What it cannot
 * know is that `ai_assistant_daily_user_limit` is a positive integer and
 * `ai_live_generation` is a boolean — `platform_settings.value` is TEXT, deliberately, so
 * one table serves every kind of setting.
 *
 * So the per-key shape is asserted here. A setting with no entry in `SHAPES` is still
 * editable as free text: refusing to show a setting because this file has not been
 * updated would make a migration's work invisible.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

/**
 * What each known setting is allowed to be, and how to describe it to a person.
 *
 * `kind` drives the control the screen renders. Anything not listed here is a text
 * field, which is the honest fallback for a setting added by a migration this file has
 * not caught up with.
 */
const SHAPES: Record<
  string,
  { kind: 'boolean' | 'integer'; label: string; min?: number; max?: number; group: string }
> = {
  ai_live_generation: {
    kind: 'boolean',
    label: 'Live AI generation',
    group: 'AI',
  },
  ai_assistant_daily_school_limit: {
    kind: 'integer',
    label: 'Assistant interactions per school per day',
    min: 1,
    max: 100_000,
    group: 'AI',
  },
  ai_assistant_daily_user_limit: {
    kind: 'integer',
    label: 'Assistant interactions per person per day',
    min: 1,
    max: 10_000,
    group: 'AI',
  },
  erasure_grace_days: {
    kind: 'integer',
    label: 'Days before an erasure request is actioned',
    min: 0,
    max: 90,
    group: 'Data protection',
  },
  financial_retention_years: {
    kind: 'integer',
    label: 'Years financial records are kept after erasure',
    min: 1,
    max: 20,
    group: 'Data protection',
  },
}

export async function GET(): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    /*
      The function performs the AfriTech check itself and raises 42501 for anybody else,
      which `fromPostgrestError` renders as FORBIDDEN. Not re-checked here: one rule,
      one place, and a route-level copy is the one a direct PostgREST call skips.
    */
    const { data, error } = await client.rpc('admin_platform_settings')
    if (error) return fromPostgrestError(error)

    const rows = (data ?? []) as Array<{
      out_key: string
      out_value: string
      out_description: string
      out_updated_by: string | null
      out_updated_at: string | null
    }>

    return ok({
      settings: rows.map((s) => {
        const shape = SHAPES[s.out_key]
        return {
          key: s.out_key,
          value: s.out_value,
          description: s.out_description,
          updatedBy: s.out_updated_by,
          updatedAt: s.out_updated_at,
          // `text` for anything this file has not caught up with — see the header.
          kind: shape?.kind ?? 'text',
          label: shape?.label ?? s.out_key,
          group: shape?.group ?? 'Other',
          min: shape?.min ?? null,
          max: shape?.max ?? null,
        }
      }),
      /*
        The deployment's veto on AI, which no setting can override.

        Stated alongside the settings because otherwise somebody switches live
        generation on, sees nothing change, and has no way to discover that
        `AI_GENERATOR=off` is set here.
      */
      aiEnvironmentForbids: process.env.AI_GENERATOR?.trim().toLowerCase() === 'off',
      providerKeys: {
        openai: Boolean(process.env.OPENAI_API_KEY?.trim()),
        anthropic: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
      },
    })
  })
}

const patchSchema = z.object({
  key: z.string().trim().min(1).max(80),
  value: z.string().trim().min(1).max(500),
  reason: z.string().trim().min(8, 'Give a reason — at least a few words.').max(500),
})

export async function PATCH(request: Request): Promise<Response> {
  return guard(async () => {
    const parsed = patchSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return fail('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.')
    }

    const { key, value, reason } = parsed.data
    const shape = SHAPES[key]

    /*
      Shape checking, which the database cannot do: `value` is TEXT so one table can
      serve every kind of setting.

      An unknown key is NOT refused here — the database refuses it, with a message
      naming the fact that new settings arrive by migration.
    */
    if (shape?.kind === 'boolean' && value !== 'true' && value !== 'false') {
      return fail('VALIDATION_ERROR', `${shape.label} must be true or false.`)
    }

    if (shape?.kind === 'integer') {
      const n = Number(value)
      if (!Number.isInteger(n)) {
        return fail('VALIDATION_ERROR', `${shape.label} must be a whole number.`)
      }
      if (shape.min !== undefined && n < shape.min) {
        return fail('VALIDATION_ERROR', `${shape.label} cannot be below ${shape.min}.`)
      }
      if (shape.max !== undefined && n > shape.max) {
        return fail('VALIDATION_ERROR', `${shape.label} cannot be above ${shape.max}.`)
      }
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client.rpc('admin_set_platform_setting', {
      p_key: key,
      p_value: value,
      p_reason: reason,
    })
    if (error) return fromPostgrestError(error)

    return ok({
      key,
      value: (data as string | null) ?? value,
      /*
        Said on the way back rather than only on the next GET.

        Somebody switching AI on while the deployment forbids it must learn that from
        the action they just took, not by wondering why nothing changed.
      */
      warning:
        key === 'ai_live_generation' && value === 'true'
          ? process.env.AI_GENERATOR?.trim().toLowerCase() === 'off'
            ? 'Saved, but this deployment sets AI_GENERATOR=off, so generation stays off here.'
            : !process.env.OPENAI_API_KEY?.trim() && !process.env.ANTHROPIC_API_KEY?.trim()
              ? 'Saved, but no provider API key is configured, so every generation falls back to the template.'
              : null
          : null,
    })
  })
}
