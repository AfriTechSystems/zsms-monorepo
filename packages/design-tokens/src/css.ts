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
import { RADIUS, SHADOW, TYPOGRAPHY, type ThemeTokens } from './tokens'

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

    '--zsms-success': c.success[600],
    '--zsms-success-tint': c.success[100],
    '--zsms-success-text': c.success[700],
    '--zsms-warning': c.warning[600],
    '--zsms-warning-tint': c.warning[100],
    '--zsms-warning-text': c.warning[700],
    '--zsms-danger': c.danger[600],
    '--zsms-danger-tint': c.danger[100],
    '--zsms-danger-text': c.danger[700],
    '--zsms-accent-tint': c.accent[100],
    '--zsms-accent-text': c.accent[700],

    '--zsms-primary-fill': c.primary[500],
    '--zsms-primary-tint': c.primary[100],
    '--zsms-primary-text': c.primary[700],
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
 */
export function themeToStyleSheet(theme: ResolvedTheme, selector = ':root'): string {
  return [
    `${selector} {`,
    declarations({ ...staticVars, ...themeVars(theme.light) }),
    `}`,
    ``,
    `${selector}[data-theme="dark"] {`,
    declarations(themeVars(theme.dark)),
    `}`,
    ``,
    `/* No-JS fallback only. The script resolves 'system' to an explicit value. */`,
    `@media (prefers-color-scheme: dark) {`,
    `  ${selector}:not([data-theme]) {`,
    declarations(themeVars(theme.dark), '    '),
    `  }`,
    `}`,
  ].join('\n')
}
