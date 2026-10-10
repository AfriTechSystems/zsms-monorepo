/**
 * The mobile palette, taken from the same source as the web.
 *
 * Spec: `Official Documentation/01 Foundation Layer/DESIGN_SYSTEM.md`
 *
 * ## One source, two renderers
 *
 * `@zsms/design-tokens` produces plain objects — hex strings, numbers — and only
 * `css.ts` turns them into custom properties. That separation is what lets React Native
 * consume the identical palette rather than a second set of values that drift apart the
 * first time somebody adjusts a brand colour.
 *
 * A school's own colours resolve through `resolveTheme()` exactly as they do on the web,
 * so a school that has set its palette sees it on a teacher's phone too.
 *
 * ## Why these are flat objects rather than a styling library
 *
 * No NativeWind, no styled-components. React Native's `StyleSheet` is already the
 * platform's styling system, and adding a Tailwind-alike would mean a second mental model
 * for colour, a build step, and a class-name string that cannot be type-checked. The web
 * uses Tailwind because the web has cascade and specificity to manage; React Native has
 * neither.
 */

import { resolveTheme } from '@zsms/design-tokens'

/** The product's own palette when no school branding applies. */
const base = resolveTheme(null)

export type Scheme = 'light' | 'dark'

export interface Palette {
  background: string
  surface: string
  surfaceSunken: string
  text: string
  textMuted: string
  textSubtle: string
  border: string
  borderStrong: string

  primary: string
  primaryTint: string
  primaryText: string
  primaryMark: string
  onPrimary: string

  success: string
  successTint: string
  successText: string

  warning: string
  warningTint: string
  warningText: string

  danger: string
  dangerTint: string
  dangerText: string
}

/**
 * Pulled out by name rather than spread, so a change to the token package's shape is a
 * type error here instead of a screen rendering transparent.
 */
function paletteFor(scheme: Scheme): Palette {
  const t = scheme === 'dark' ? base.dark : base.light
  return {
    background: t.surface.background,
    surface: t.surface.surface,
    surfaceSunken: t.surface.surfaceSunken,
    text: t.surface.text,
    textMuted: t.surface.textMuted,
    textSubtle: t.surface.textSubtle,
    border: t.surface.border,
    borderStrong: t.surface.borderStrong,

    /*
      `600` fills, `700` writes, `mark` draws, `100` tints.

      Not interchangeable, and the scale's own comments say why: `mark` is the step
      that clears 3:1 against this hue's `100` tint, which is the ground a status dot
      or an icon actually sits on. Using `500` there — the brand colour exactly as
      specified — fails that contrast for amber.
    */
    primary: t.colors.primary[600],
    primaryTint: t.colors.primary[100],
    primaryText: t.colors.primary[700],
    primaryMark: t.colors.primary.mark,

    // Text on a filled button. In dark mode the fill is LIGHTENED to clear AA, so the
    // label turns dark — which is why this comes from the theme rather than being
    // hardcoded white.
    onPrimary: t.surface.textOnFill,

    success: t.colors.success.mark,
    successTint: t.colors.success[100],
    successText: t.colors.success[700],

    warning: t.colors.warning.mark,
    warningTint: t.colors.warning[100],
    warningText: t.colors.warning[700],

    danger: t.colors.danger.mark,
    dangerTint: t.colors.danger[100],
    dangerText: t.colors.danger[700],
  }
}

export const LIGHT = paletteFor('light')
export const DARK = paletteFor('dark')

/**
 * Spacing, in the same rhythm as the web.
 *
 * Named by role rather than by size: `card` is the padding inside a card, whatever that
 * happens to measure. Renaming a number is how two surfaces end up a pixel apart.
 */
export const SPACE = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  /** Inside a card. */
  card: 16,
  /** Between stacked elements in a group. */
  stack: 12,
  /** Between cards. */
  cards: 16,
  /** The screen's side margin. */
  gutter: 16,
} as const

export const RADIUS = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 999,
} as const

/**
 * The minimum tappable size.
 *
 * 48 rather than Apple's 44: this app is used one-handed, outdoors, by a teacher holding a
 * register in the other hand, and a missed tap on an attendance mark is a wrong record
 * rather than a nuisance.
 */
export const TAP = 48

export const TYPE = {
  display: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.4 },
  title: { fontSize: 20, fontWeight: '600' as const, letterSpacing: -0.2 },
  heading: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  label: { fontSize: 13, fontWeight: '500' as const },
  caption: { fontSize: 12, fontWeight: '400' as const },
} as const

/**
 * Figures, so columns of numbers line up.
 *
 * Outside the `as const` object on purpose: that would freeze `fontVariant` into a
 * readonly tuple, and React Native's `TextStyle` requires a mutable `FontVariant[]` —
 * a type error at every use site rather than here.
 */
export const NUMERIC = {
  fontSize: 15,
  fontWeight: '600',
  fontVariant: ['tabular-nums'],
} satisfies import('react-native').TextStyle
