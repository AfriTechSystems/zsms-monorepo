/**
 * Per-school theming — resolution, validation, and logo fallback.
 *
 * Spec: `Official Documentation/01 Foundation Layer/DYNAMIC_CONFIG.md`
 *       — theme is school-scoped dynamic configuration, ZSMS default as fallback.
 *
 * Three rules shape this file:
 *
 *  1. **Colours and logo only.** A school cannot move the navigation, rename a
 *     column, or change a layout. Structure is what makes the product learnable
 *     by staff who use it daily and support answerable by one team.
 *  2. **The AfriTech admin dashboard is never themed.** It is ZSMS's own tool,
 *     and an operator working across forty schools needs one constant frame —
 *     particularly during impersonation, where "whose system am I in" must
 *     never be ambiguous.
 *  3. **An unreadable theme is refused, not warned about.** See `validateTheme`.
 */

import { contrastRatio, meetsAA, parseHex } from './contrast'
import { BRAND, buildDarkTheme, buildLightTheme, NEUTRAL, type ThemeTokens } from './tokens'

/**
 * What a school stores. Deliberately small.
 *
 * A school picks its two identity colours — the anchor it uses for headers and
 * the action colour for buttons. Semantic colours (paid/overdue/due-soon) are
 * NOT themeable: green-means-paid is a comprehension aid, and a school that set
 * "overdue" to green would be creating a misreading of money, not expressing a
 * brand.
 */
export interface SchoolBrandingInput {
  /** Header, navigation, primary text. Defaults to ZSMS navy. */
  anchorColor?: string | null
  /** Buttons, links, active states. Defaults to ZSMS blue. */
  primaryColor?: string | null
  /** Full logo — wordmark. R2 public bucket URL. */
  logoUrl?: string | null
  /** Square mark for favicons and collapsed navigation. R2 public bucket URL. */
  iconUrl?: string | null
  /** For the initials fallback when no logo is set. */
  schoolName?: string | null
}

export interface ResolvedTheme {
  light: ThemeTokens
  dark: ThemeTokens
  logoUrl: string | null
  iconUrl: string | null
  /** Rendered when `logoUrl` is null. Never empty. */
  initials: string
  /** True when the school has set nothing and this is stock ZSMS. */
  isDefault: boolean
}

// ---------------------------------------------------------------------------
// Validation — the guardrail
// ---------------------------------------------------------------------------

export interface ThemeViolation {
  field: 'anchorColor' | 'primaryColor'
  color: string
  /** What it was measured against. */
  against: string
  ratio: number
  required: number
  message: string
}

export interface ThemeValidationResult {
  valid: boolean
  violations: ThemeViolation[]
}

/**
 * Refuses a palette that cannot be read.
 *
 * The check is on the *derived* steps, not the raw input, because that is what
 * users actually see. A school may enter a pale sky blue: step 500 stays exactly
 * that colour on fills, and step 600 is darkened for text, so the input is
 * usually acceptable. What cannot be rescued is a colour so pale that even the
 * derived text step lands on a surface it cannot clear — and, separately, an
 * anchor so light that white navigation text disappears against it.
 *
 * **Refused, not warned.** A warning here would be dismissed by whoever is
 * setting up the school at 9pm the night before launch, and the people who then
 * cannot read their fee balance are parents who never chose the colour.
 */
export function validateTheme(input: SchoolBrandingInput): ThemeValidationResult {
  const violations: ThemeViolation[] = []

  const check = (field: 'anchorColor' | 'primaryColor', value: string | null | undefined): void => {
    if (!value) return

    if (!parseHex(value)) {
      violations.push({
        field,
        color: String(value),
        against: '—',
        ratio: 0,
        required: 0,
        message: `'${String(value)}' is not a valid hex colour. Use a value like #2B3A55.`,
      })
      return
    }

    if (field === 'anchorColor') {
      // The anchor fills the header and side navigation with white text on it.
      // That is normal-size text, so 4.5:1 is the bar.
      const ratio = contrastRatio('#FFFFFF', value)
      if (ratio < 4.5) {
        violations.push({
          field,
          color: value,
          against: '#FFFFFF',
          ratio,
          required: 4.5,
          message:
            `This colour is too light for the header — white navigation text on it measures ` +
            `${ratio.toFixed(2)}:1, below the ${(4.5).toFixed(1)}:1 minimum. Choose a deeper shade.`,
        })
      }
      return
    }

    // The primary colour must work as a 3:1 UI fill. Its text-bearing step is
    // derived by darkening, which always succeeds, so the only unrecoverable
    // case is a fill so pale its own button edge vanishes against the page.
    const ratio = contrastRatio(value, NEUTRAL[0])
    if (ratio < 3) {
      violations.push({
        field,
        color: value,
        against: NEUTRAL[0],
        ratio,
        required: 3,
        message:
          `This colour is too pale for buttons — against a white page it measures ` +
          `${ratio.toFixed(2)}:1, below the 3:1 minimum, so the button edge would be ` +
          `invisible. Choose a stronger shade.`,
      })
    }
  }

  check('anchorColor', input.anchorColor)
  check('primaryColor', input.primaryColor)

  return { valid: violations.length === 0, violations }
}

/**
 * Post-resolution audit used by tests and by the theme preview.
 *
 * `validateTheme` gates what a school may save. This asserts the *result* is
 * sound — every foreground/background pairing the UI actually renders. It is
 * what proves the derivation in `scale.ts` does its job rather than asserting it.
 */
export function auditTheme(theme: ThemeTokens): Array<{ pair: string; ratio: number; ok: boolean }> {
  const s = theme.surface
  const c = theme.colors

  const pairs: Array<[string, string, string, 'normal' | 'ui']> = [
    ['body text on background', s.text, s.background, 'normal'],
    ['muted text on background', s.textMuted, s.background, 'normal'],
    ['subtle text on surface', s.textSubtle, s.surface, 'normal'],
    ['label on primary button', s.textOnFill, c.primary[600], 'normal'],
    ['label on danger button', s.textOnFill, c.danger[600], 'normal'],
    ['text on anchor header', s.textOnAnchor, c.anchor[500], 'normal'],
    ['primary link on background', c.primary[600], s.background, 'normal'],
    ['success text on success tint', c.success[700], c.success[100], 'normal'],
    ['warning text on warning tint', c.warning[700], c.warning[100], 'normal'],
    ['danger text on danger tint', c.danger[700], c.danger[100], 'normal'],
    // Control boundaries only. `surface.border` is decorative and exempt from
    // 1.4.11 — auditing it at 3:1 would demand a harsh grey box around every
    // card, which is a worse product and not what the criterion asks for.
    ['input boundary against surface', s.borderStrong, s.surface, 'ui'],
    ['input boundary against background', s.borderStrong, s.background, 'ui'],
    ['focus ring against background', s.focusRing, s.background, 'ui'],
    ['focus ring against surface', s.focusRing, s.surface, 'ui'],
  ]

  return pairs.map(([pair, fg, bg, level]) => ({
    pair,
    ratio: contrastRatio(fg, bg),
    ok: meetsAA(fg, bg, level),
  }))
}

// ---------------------------------------------------------------------------
// Logo fallback
// ---------------------------------------------------------------------------

/**
 * Initials for a school with no logo.
 *
 * Stopwords are dropped so "The Lusaka Academy of Science" gives LAS rather than
 * TLA — the letters a parent would recognise. Capped at three because four
 * squeezed into a 32px avatar is illegible, which defeats the purpose.
 */
const STOPWORDS = new Set([
  'the', 'of', 'and', 'for', 'a', 'an', 'de', 'la', 'at', 'in', 'on',
  'school', 'schools', 'academy', 'college', 'institute', 'centre', 'center',
])

export function schoolInitials(name: string | null | undefined): string {
  if (!name || !name.trim()) return 'ZS'

  const words = name
    .trim()
    .split(/[\s\-–—]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)

  const significant = words.filter((w) => !STOPWORDS.has(w.toLowerCase()))
  // If every word was a stopword ("The School"), fall back to the raw words
  // rather than returning nothing.
  const source = significant.length > 0 ? significant : words

  if (source.length === 1) {
    return (source[0] as string).slice(0, 2).toUpperCase()
  }

  return source
    .slice(0, 3)
    .map((w) => (w[0] as string).toUpperCase())
    .join('')
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolves a school's stored branding into a complete theme.
 *
 * Every field independently falls back to the ZSMS default, so a school that
 * sets only a logo keeps ZSMS colours, and a school that sets only colours gets
 * its initials in its own navy. Partial configuration is the normal state during
 * onboarding, not an error.
 *
 * An invalid stored colour falls back rather than throwing. Bad data reaching
 * this point means validation was bypassed — but a parent trying to check a fee
 * balance should see a stock-themed page, not a 500.
 */
export function resolveTheme(input: SchoolBrandingInput | null | undefined): ResolvedTheme {
  const safe = (value: string | null | undefined, fallback: string): string =>
    value && parseHex(value) ? value : fallback

  const anchor = safe(input?.anchorColor, BRAND.navy)
  const primary = safe(input?.primaryColor, BRAND.blue)

  const brand = {
    ...BRAND,
    navy: anchor,
    blue: primary,
  }

  const isDefault =
    anchor === BRAND.navy && primary === BRAND.blue && !input?.logoUrl && !input?.iconUrl

  return {
    light: buildLightTheme(brand),
    dark: buildDarkTheme(brand),
    logoUrl: input?.logoUrl ?? null,
    iconUrl: input?.iconUrl ?? null,
    initials: schoolInitials(input?.schoolName),
    isDefault,
  }
}
