/**
 * Tokens → CSS custom properties.
 *
 * The web app never imports a token object into a component. It reads CSS
 * variables, which are written once on `<html>` by the server-rendered layout.
 * That is what makes per-school theming free at runtime: the school's colours
 * arrive in the first HTML response, so there is no flash of ZSMS blue before a
 * school's own blue loads, and no client-side theme fetch.
 *
 * Variable naming matches shadcn/ui's convention (`--background`, `--primary`,
 * `--primary-foreground`, …) so stock shadcn components inherit the theme
 * without modification, with ZSMS-specific additions namespaced `--zsms-*`.
 */

import type { ResolvedTheme } from './theme'
import {
  MOBILE_MAX_WIDTH,
  RADIUS,
  SHADOW,
  SIZING,
  TYPOGRAPHY,
  type ThemeTokens,
} from './tokens'

const rem = (px: number): string => `${px / 16}rem`

/**
 * Type scale and layout sizing as variables.
 *
 * Tailwind's `fontSize` and spacing utilities compile to static values, so the
 * only way to make one class correct at two widths is to have the class point at
 * a variable and move the variable. `text-3xl` resolves to
 * `var(--zsms-fs-3xl)` and shrinks below 480px without a single responsive
 * modifier in a component.
 */
function sizingVars(scale: 'base' | 'mobile'): Record<string, string> {
  const vars: Record<string, string> = {}

  for (const [name, v] of Object.entries(TYPOGRAPHY.size)) {
    const override = scale === 'mobile'
      ? (TYPOGRAPHY.mobileSize as Record<string, { size: number; lineHeight: number }>)[name]
      : undefined
    const chosen = override ?? v
    vars[`--zsms-fs-${name}`] = rem(chosen.size)
    vars[`--zsms-lh-${name}`] = rem(chosen.lineHeight)
  }

  const s = SIZING[scale]
  vars['--zsms-card-padding'] = `${s.cardPadding}px`
  vars['--zsms-card-gap'] = `${s.cardGap}px`
  vars['--zsms-stack-gap'] = `${s.stackGap}px`
  vars['--zsms-section-gap'] = `${s.sectionGap}px`
  vars['--zsms-page-gutter'] = `${s.pageGutter}px`
  vars['--zsms-tap-target'] = `${s.tapTarget}px`

  return vars
}

/**
 * shadcn expects `--primary` to be a colour a foreground sits on. We map the
 * *600* step there, not 500, because that step is the one that clears 4.5:1
 * against white — a solid button with a white label is the single most common
 * component in the product and it must pass AA.
 */
function themeVars(theme: ThemeTokens): Record<string, string> {
  const { colors: c, surface: s } = theme

  return {
    '--background': s.background,
    '--foreground': s.text,
    '--card': s.surface,
    '--card-foreground': s.text,
    '--popover': s.surface,
    '--popover-foreground': s.text,

    '--primary': c.primary[600],
    '--primary-foreground': s.textOnFill,
    '--secondary': s.surfaceSunken,
    '--secondary-foreground': s.text,

    '--muted': s.surfaceSunken,
    '--muted-foreground': s.textMuted,
    '--accent': c.accent[600],
    '--accent-foreground': s.textOnFill,

    '--destructive': c.danger[600],
    '--destructive-foreground': s.textOnFill,

    '--border': s.border,
    '--input': s.borderStrong,
    '--ring': s.focusRing,

    // ZSMS additions. Namespaced so a shadcn upgrade cannot collide with them.
    '--zsms-anchor': c.anchor[500],
    '--zsms-anchor-strong': c.anchor[700],
    '--zsms-anchor-foreground': s.textOnAnchor,
    '--zsms-surface-sunken': s.surfaceSunken,
    '--zsms-text-subtle': s.textSubtle,

    // Every hue is exposed as the same three roles, so a component picks a
    // *meaning* and gets a consistent triple rather than choosing shades:
    //
    //   --zsms-<hue>-tint   pale chip background   (stat cards, badges, banners)
    //   --zsms-<hue>-fill   saturated mark  (icons, dots, bar segments — guaranteed ≥3:1 on its tint)
    //   --zsms-<hue>-text   text and emphasis on that tint (≥4.5:1)
    //
    // The uniformity is the point. Six hues each offering a different subset is
    // how a "soft tint" pattern degrades into per-screen colour picking.
    '--zsms-success': c.success[600],
    '--zsms-success-tint': c.success[100],
    '--zsms-success-fill': c.success.mark,
    '--zsms-success-text': c.success[700],

    '--zsms-warning': c.warning[600],
    '--zsms-warning-tint': c.warning[100],
    '--zsms-warning-fill': c.warning.mark,
    '--zsms-warning-text': c.warning[700],

    '--zsms-danger': c.danger[600],
    '--zsms-danger-tint': c.danger[100],
    '--zsms-danger-fill': c.danger.mark,
    '--zsms-danger-text': c.danger[700],

    '--zsms-accent': c.accent[600],
    '--zsms-accent-tint': c.accent[100],
    '--zsms-accent-fill': c.accent.mark,
    '--zsms-accent-text': c.accent[700],

    '--zsms-primary-tint': c.primary[100],
    '--zsms-primary-fill': c.primary.mark,
    '--zsms-primary-text': c.primary[700],

    // The sixth chip. Derived from the anchor rather than added as a seventh
    // brand hue — a low-saturation navy tint IS lavender-grey, so the neutral
    // chip in the set comes free and stays in the same hue family as the ink.
    '--zsms-neutral-tint': c.anchor[100],
    '--zsms-neutral-fill': c.anchor.mark,
    '--zsms-neutral-text': c.anchor[700],
  }
}

const staticVars: Record<string, string> = {
  '--radius': `${RADIUS.lg}px`,
  '--zsms-radius-sm': `${RADIUS.sm}px`,
  '--zsms-radius-md': `${RADIUS.md}px`,
  '--zsms-radius-xl': `${RADIUS.xl}px`,
  '--zsms-shadow-sm': SHADOW.sm,
  '--zsms-shadow-md': SHADOW.md,
  '--zsms-shadow-lg': SHADOW.lg,
  '--zsms-font-sans': TYPOGRAPHY.fontFamily.sans,
  ...sizingVars('base'),
}

function declarations(vars: Record<string, string>, indent = '  '): string {
  return Object.entries(vars)
    .map(([k, v]) => `${indent}${k}: ${v};`)
    .join('\n')
}

/**
 * Inline `style` object for the `<html>` element — the light theme plus the
 * static scale. Dark mode is handled by the stylesheet, not here.
 */
export function themeToStyleObject(theme: ResolvedTheme): Record<string, string> {
  return { ...staticVars, ...themeVars(theme.light) }
}

/**
 * A `<style>` block carrying both modes for one school.
 *
 * Emitted server-side into the document head.
 *
 * **`data-theme` is the single switch**, and that is a deliberate constraint
 * rather than a style preference. Tailwind's `dark:` utilities need a selector
 * they can compile against, so if these variables flipped on a media query
 * while Tailwind flipped on an attribute, the two would disagree for any user
 * on "system" — variables dark, utilities light. One mechanism, resolved to an
 * explicit value by the pre-paint script, keeps them in step.
 *
 * The media query is kept only as a no-JavaScript fallback, scoped to
 * `:not([data-theme])` so it never fights an explicit choice.
 *
 * The dark block is written as a bare `[data-theme="dark"]` rather than
 * `:root[data-theme="dark"]`, so it matches **any** element carrying the
 * attribute, not only the document root. Two things fall out of that: a dark
 * panel can be embedded in a light page (the design preview shows both modes
 * side by side, which is the only way to tell whether they are one design or
 * two), and it lines up with Tailwind's `dark:` variant, which is configured as
 * `[data-theme="dark"] &` and has always matched nested elements. The two
 * mechanisms disagreeing about scope is the same class of bug as them
 * disagreeing about which mode is active.
 *
 * Specificity is unchanged — `[data-theme="dark"]` and `:root` are both (0,1,0),
 * and this block comes second, so it still wins on the root element.
 */
export function themeToStyleSheet(theme: ResolvedTheme, selector = ':root'): string {
  return [
    `${selector} {`,
    declarations({ ...staticVars, ...themeVars(theme.light) }),
    `}`,
    ``,
    `[data-theme="dark"] {`,
    declarations(themeVars(theme.dark)),
    `}`,
    ``,
    `/* Re-declared so a light panel nested inside a dark page resolves. Without`,
    `   this, [data-theme="light"] has no rule and simply inherits the dark vars. */`,
    `[data-theme="light"] {`,
    declarations(themeVars(theme.light)),
    `}`,
    ``,
    `/* No-JS fallback only. The script resolves 'system' to an explicit value. */`,
    `@media (prefers-color-scheme: dark) {`,
    `  ${selector}:not([data-theme]) {`,
    declarations(themeVars(theme.dark), '    '),
    `  }`,
    `}`,
    ``,
    `/* Small screens. Headings and chrome tighten; body text and tap targets do not. */`,
    `@media (max-width: ${MOBILE_MAX_WIDTH}px) {`,
    `  ${selector} {`,
    declarations(sizingVars('mobile'), '    '),
    `  }`,
    `}`,
  ].join('\n')
}
