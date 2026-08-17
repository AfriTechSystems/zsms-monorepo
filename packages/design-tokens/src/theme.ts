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
 * The ground both guardrail thresholds are measured against.
 *
 * Exported because the CHECK constraints in migration `0094` measure against
 * this exact value, and the two enforcement points must not drift. If the page
 * ground ever changes, this constant, `NEUTRAL[100]`, and that migration move
 * together or the database and the API start disagreeing about which palettes
 * are acceptable.
 */
export const PAGE_GROUND = NEUTRAL[100]

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
      // The anchor's main job is INK — body text, headings, navigation labels —
      // drawn on the page, which is a soft lavender-grey rather than white. So
      // the page is what it must clear at 4.5:1, and measuring against white
      // would be measuring the easier of the two grounds. This also subsumes the
      // rarer case of white text on a solid anchor panel: white is lighter than
      // the page, so anything readable on the page is readable there too.
      const ratio = contrastRatio(PAGE_GROUND, value)
      if (ratio < 4.5) {
        violations.push({
          field,
          color: value,
          against: PAGE_GROUND,
          ratio,
          required: 4.5,
          message:
            `This colour is too light to read as text — on the page background it measures ` +
            `${ratio.toFixed(2)}:1, below the ${(4.5).toFixed(1)}:1 minimum. Choose a deeper shade.`,
        })
      }
      return
    }

    // The primary colour must work as a 3:1 UI fill. Its text-bearing step is
    // derived by darkening, which always succeeds, so the only unrecoverable
    // case is a fill so pale its own button edge vanishes. Measured against the
    // page for the same reason as the anchor: it is the darker of the two
    // grounds a button or chip is drawn on, and therefore the binding one.
    const ratio = contrastRatio(value, PAGE_GROUND)
    if (ratio < 3) {
      violations.push({
        field,
        color: value,
        against: PAGE_GROUND,
        ratio,
        required: 3,
        message:
          `This colour is too pale for buttons — against the page background it measures ` +
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
    ['body text on page', s.text, s.background, 'normal'],
    ['body text on card', s.text, s.surface, 'normal'],
    ['muted text on page', s.textMuted, s.background, 'normal'],
    ['subtle text on card', s.textSubtle, s.surface, 'normal'],
    // The page is a tinted ground, not white, so subtle text has *less* to work
    // with there than on a card. Audited separately because it is the pairing
    // the tinted-page decision put at risk.
    ['subtle text on page', s.textSubtle, s.background, 'normal'],
    ['label on primary button', s.textOnFill, c.primary[600], 'normal'],
    ['label on danger button', s.textOnFill, c.danger[600], 'normal'],
    ['text on anchor surface', s.textOnAnchor, c.anchor[500], 'normal'],
    ['primary link on page', c.primary[600], s.background, 'normal'],
    // The soft-tint chips. Each is a stat-card or badge background with its own
    // hue's text on top — the pattern the interface leans on hardest, so every
    // one of the six is measured rather than the three that used to be.
    ['success text on success tint', c.success[700], c.success[100], 'normal'],
    ['warning text on warning tint', c.warning[700], c.warning[100], 'normal'],
    ['danger text on danger tint', c.danger[700], c.danger[100], 'normal'],
    ['primary text on primary tint', c.primary[700], c.primary[100], 'normal'],
    ['accent text on accent tint', c.accent[700], c.accent[100], 'normal'],
    ['anchor text on anchor tint', c.anchor[700], c.anchor[100], 'normal'],
    // Control boundaries only. `surface.border` is decorative and exempt from
    // 1.4.11 — auditing it at 3:1 would demand a harsh grey box around every
    // card, which is a worse product and not what the criterion asks for.
    ['input boundary against card', s.borderStrong, s.surface, 'ui'],
    ['input boundary against page', s.borderStrong, s.background, 'ui'],
    ['focus ring against page', s.focusRing, s.background, 'ui'],
    ['focus ring against card', s.focusRing, s.surface, 'ui'],
    // Saturated marks — icon, status dot, bar segment — on their own tint.
    // Non-text, so 3:1. All six are audited rather than a sample: this is the
    // tightest pairing in the system, and it is where a pale tint stops carrying
    // information and becomes decoration. Flat brand hues fail it (amber at
    // 1.80), which is why `mark` is derived rather than being step 500.
    ['success mark on success tint', c.success.mark, c.success[100], 'ui'],
    ['warning mark on warning tint', c.warning.mark, c.warning[100], 'ui'],
    ['danger mark on danger tint', c.danger.mark, c.danger[100], 'ui'],
    ['primary mark on primary tint', c.primary.mark, c.primary[100], 'ui'],
    ['accent mark on accent tint', c.accent.mark, c.accent[100], 'ui'],
    ['neutral mark on neutral tint', c.anchor.mark, c.anchor[100], 'ui'],
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
