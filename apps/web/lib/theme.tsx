/**
 * Server-side theme resolution.
 *
 * Spec: `DYNAMIC_CONFIG.md` — school branding is school-scoped configuration
 *       with the ZSMS default as fallback.
 *
 * The theme is resolved on the server and emitted as CSS custom properties in
 * the first response. No client-side theme fetch, no flash of the wrong brand,
 * and no JavaScript required to render a school's colours — which matters on the
 * parent portal, where a phone on a slow connection is the normal case.
 */

import type { JSX } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  resolveTheme,
  themeToStyleSheet,
  type ResolvedTheme,
  type SchoolBrandingInput,
} from '@zsms/design-tokens'

/**
 * Loads a school's branding.
 *
 * Returns the ZSMS default on any failure. A school portal that 500s because a
 * logo URL is malformed would be a self-inflicted outage, and branding is the
 * least important thing on the page.
 */
export async function loadSchoolBranding(
  client: SupabaseClient,
  schoolUuid: string | null,
): Promise<SchoolBrandingInput | null> {
  if (!schoolUuid) return null

  const { data, error } = await client
    .from('school_branding')
    .select('anchor_color, primary_color, logo_url, icon_url, schools(name)')
    .eq('school_id', schoolUuid)
    .maybeSingle()

  if (error || !data) return null

  const school = data.schools as unknown as { name?: string } | null

  return {
    anchorColor: data.anchor_color,
    primaryColor: data.primary_color,
    logoUrl: data.logo_url,
    iconUrl: data.icon_url,
    schoolName: school?.name ?? null,
  }
}

/**
 * Loads branding for a school nobody is signed in to yet.
 *
 * The parent login screen has to be the school's before there is a session to
 * scope it with — a parent who lands on a generic page is a parent who is not
 * sure they are in the right place. RLS has nothing to resolve at that point,
 * so this goes through `school_branding_by_slug()`, a `SECURITY DEFINER`
 * function granted to `anon` that returns one school's name, colours, and logo
 * and nothing else (migration 0092).
 *
 * The slug is `lower(schools.school_id)` — `zm-lsk-0001` — the same value Clerk
 * uses as the organisation slug, so the URL carries no new identifier.
 */
export async function loadSchoolBrandingBySlug(
  client: SupabaseClient,
  slug: string | null,
): Promise<SchoolBrandingInput | null> {
  if (!slug) return null

  const { data, error } = await client.rpc('school_branding_by_slug', { p_slug: slug })

  if (error || !data) return null

  return data as SchoolBrandingInput
}

/**
 * The AfriTech admin dashboard is never themed.
 *
 * An operator moves between forty schools in a session and impersonates users
 * inside them. If the platform's own tooling adopted each school's colours,
 * "am I in AfriTech admin or inside a school" would become a question answered
 * by reading the URL — exactly when getting it wrong is most costly.
 */
export function platformTheme(): ResolvedTheme {
  return resolveTheme(null)
}

/**
 * Emits the resolved theme as a `<style>` element.
 *
 * Rendered inside `<head>`. `dangerouslySetInnerHTML` is required for a style
 * element and is safe here: every value originates from
 * `@zsms/design-tokens`, which only ever returns hex strings it generated
 * itself — a stored colour that is not valid hex is discarded by `resolveTheme`
 * rather than passed through. No school-supplied string reaches this output.
 */
export function ThemeStyle({ theme }: { theme: ResolvedTheme }): JSX.Element {
  return (
    <style
      id="zsms-theme"
       
      dangerouslySetInnerHTML={{ __html: themeToStyleSheet(theme) }}
    />
  )
}
