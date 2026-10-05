/**
 * GET/PATCH /api/admin/ai — the platform switch for live AI generation.
 *
 * Spec: `Official Documentation/18 AI Module/AI_OVERVIEW.md`
 *       `Official Documentation/15 Super Admin and Platform/SUPERADMIN.md`
 *
 * ## Why a switch in the product rather than an environment variable
 *
 * `AI_GENERATOR` was a DEPLOYMENT setting: turning the model on or off meant editing a
 * variable and redeploying. That is the wrong grain for a control whose purpose is
 * operational — "stop spending money right now" should not wait for a build, and
 * neither should "the curriculum importer needs the model for ten minutes".
 *
 * It was also invisible. Nothing in the product said whether AI was on, so the answer
 * lived in a file one person could read. Migration `0210` moves it to
 * `afritech.platform_settings` with an audited setter.
 *
 * The variable survives as a CEILING: `AI_GENERATOR=off` forces generation off whatever
 * this says, so an instance that must never call a model cannot be switched on from a
 * web page by somebody unsure which environment they are looking at.
 *
 * ## The reason is required, and that is deliberate
 *
 * `admin_set_ai_generation()` refuses a blank one. The question asked three months later
 * is never "was it on" but "why was it turned on", and an audit row without a reason
 * cannot answer that. The screen therefore cannot offer a bare toggle.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

/** Whether the deployment forbids live generation regardless of the toggle. */
function environmentForbids(): boolean {
  return process.env.AI_GENERATOR?.trim().toLowerCase() === 'off'
}

/**
 * Which providers have a key at all.
 *
 * Reported as booleans, never as values. A key is a secret and this response reaches a
 * browser — but whether one EXISTS is exactly what an administrator needs to know before
 * turning the switch on, because the switch is useless without one and the failure
 * otherwise appears as a generation that silently falls back to the scaffold.
 */
function providerKeys(): { openai: boolean; anthropic: boolean } {
  return {
    openai: Boolean(process.env.OPENAI_API_KEY?.trim()),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
  }
}

export async function GET(): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    /*
      The function performs the AfriTech check itself and raises 42501 for anybody else,
      which `fromPostgrestError` renders as FORBIDDEN. Not re-checked here: one rule, one
      place, and a route-level copy is the one that can be bypassed by calling PostgREST
      directly.
    */
    const { data, error } = await client.rpc('admin_ai_generation_status')
    if (error) return fromPostgrestError(error)

    const row = (
      (data ?? []) as Array<{
        out_enabled: boolean
        out_updated_by: string | null
        out_updated_at: string | null
        out_description: string | null
      }>
    )[0]

    const keys = providerKeys()

    return ok({
      enabled: row?.out_enabled ?? false,
      updatedBy: row?.out_updated_by ?? null,
      updatedAt: row?.out_updated_at ?? null,
      description: row?.out_description ?? null,
      /*
        The environment's veto, stated separately from the toggle.

        Without this an administrator switches it on, sees nothing change, and has no way
        to discover that the deployment forbids it — which is the same class of silent
        no-op the variable caused in the first place.
      */
      environmentForbids: environmentForbids(),
      providerKeys: keys,
      /** What the system will ACTUALLY do, which is what the screen should lead with. */
      effective: (row?.out_enabled ?? false) && !environmentForbids(),
    })
  })
}

const patchSchema = z.object({
  enabled: z.boolean(),
  /*
    Required, and long enough to be a sentence rather than a keystroke.

    `admin_set_ai_generation()` refuses a blank reason; this refuses "x" as well, because
    a one-character reason satisfies the database and answers nothing.
  */
  reason: z.string().trim().min(8, 'Give a reason — at least a few words.').max(500),
})

export async function PATCH(request: Request): Promise<Response> {
  return guard(async () => {
    const parsed = patchSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return fail('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client.rpc('admin_set_ai_generation', {
      p_enabled: parsed.data.enabled,
      p_reason: parsed.data.reason,
    })
    if (error) return fromPostgrestError(error)

    const enabled = data === true

    return ok({
      enabled,
      effective: enabled && !environmentForbids(),
      /*
        Said on the way back, not only on the next GET.

        Somebody who turns it on while the deployment forbids it, or with no provider key,
        must learn that from the action they just took rather than by wondering why
        nothing changed.
      */
      warning:
        enabled && environmentForbids()
          ? 'Switched on, but this deployment sets AI_GENERATOR=off, so generation stays off here.'
          : enabled && !providerKeys().openai && !providerKeys().anthropic
            ? 'Switched on, but no provider API key is configured, so every generation will fall back to the template.'
            : null,
    })
  })
}
