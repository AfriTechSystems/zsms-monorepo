/**
 * Unit tests for the one breakpoint.
 *
 * Spec: `Official Documentation/01 Foundation Layer/DESIGN_SYSTEM.md`
 *       `.claude/skills/zsms-ui/SKILL.md` → *tokens*
 *
 * ## What went wrong, and why a comment was not enough
 *
 * ZSMS divides the viewport twice, in two places that never knew about each other:
 *
 *  1. **The token layer.** `themeToStyleSheet()` emits one
 *     `@media (max-width: MOBILE_MAX_WIDTH)` block that swaps `--zsms-fs-*`,
 *     `--zsms-card-padding`, `--zsms-page-gutter` and the rest. That is why `p-card`
 *     and `text-3xl` are each a single class that is correct at 375px and at 1440px,
 *     with no responsive modifier anywhere in a component.
 *  2. **Tailwind's `sm:` prefix**, used in 22 component files for structural changes —
 *     `data-table.tsx` renders a real `<table>` from `sm` up and one card per row
 *     below it; `app-shell.tsx` switches between the sidebar and the mobile drawer.
 *
 * `MOBILE_MAX_WIDTH` was 480. Tailwind's `sm` was its stock 640px default, which this
 * repository never declared and therefore never reconciled. **Between 480px and 640px
 * a screen got desktop type and padding inside a mobile layout** — the 20px card
 * padding, the 24px gutter and full-size headings, wrapped around a card stack. Most
 * phones held in landscape and the narrow half of a split-screen tablet live in that
 * band.
 *
 * Nothing failed. Nothing could fail: the two systems are a TypeScript constant and a
 * framework default, and no build step compares them. A comment in each file saying
 * "keep these in step" is the thing that gets read after the bug, not before it — so
 * the invariant is executable instead, the way `0270` and `0272` make their catalogue
 * invariants executable rather than noted.
 *
 * `tailwind.config.ts` now imports `BREAKPOINT_SM`, so the agreement is structural and
 * these tests should be impossible to fail. They are here for the case where somebody
 * replaces the import with a literal — the change that looks harmless and whose symptom
 * is a band of widths nobody is testing at.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { BREAKPOINT_SM, MOBILE_MAX_WIDTH, resolveTheme, SIZING, themeToStyleSheet } from '@zsms/design-tokens'

import tailwindConfig from '../tailwind.config'

/** `theme.extend.screens.sm`, however Tailwind's types describe it. */
function tailwindSm(): string {
  const screens = (tailwindConfig.theme?.extend as Record<string, unknown> | undefined)?.[
    'screens'
  ] as Record<string, string> | undefined

  assert.ok(screens, 'tailwind.config.ts declares no screens — `sm` would silently inherit 640px')
  assert.ok(screens['sm'], 'tailwind.config.ts declares screens but not `sm`')
  return screens['sm'] as string
}

test('Tailwind `sm` is exactly the token breakpoint', () => {
  assert.equal(
    tailwindSm(),
    `${BREAKPOINT_SM}px`,
    'Tailwind switches layout at a width where the token layer has not switched type and spacing. ' +
      'That is the 480-vs-640 bug: desktop padding inside a mobile layout.',
  )
})

test('the mobile media query stops just below the Tailwind breakpoint', () => {
  /*
    Not equal to BREAKPOINT_SM. Tailwind's `sm:` compiles to `min-width: 640px`, so a
    `max-width: 640px` here would make both apply at exactly 640px — mobile tokens
    inside a desktop layout, the same bug one pixel wide.
  */
  assert.ok(
    MOBILE_MAX_WIDTH < BREAKPOINT_SM,
    'the mobile row would apply at the same width as the desktop layout',
  )
  assert.ok(
    BREAKPOINT_SM - MOBILE_MAX_WIDTH < 1,
    'there is a gap of a whole pixel or more where neither the mobile nor the base row applies',
  )
})

test('the emitted stylesheet carries that exact bound', () => {
  // The constant is only worth anything if it reaches the CSS, which is the artefact
  // a browser actually reads.
  // `themeToStyleSheet` takes a ResolvedTheme (a light/dark pair), not a single
  // ThemeTokens. `resolveTheme(null)` is the ZSMS default, which is what an unbranded
  // school gets served.
  const css = themeToStyleSheet(resolveTheme(null), ':root')
  assert.ok(
    css.includes(`@media (max-width: ${MOBILE_MAX_WIDTH}px)`),
    'themeToStyleSheet() is not emitting the mobile block at MOBILE_MAX_WIDTH',
  )
})

test('the two sizing rows actually differ, or the breakpoint is decoration', () => {
  // A regression that made `mobile` equal `base` would leave every test above passing
  // while the responsive token layer did nothing at all.
  const differing = (Object.keys(SIZING.base) as Array<keyof typeof SIZING.base>).filter(
    (k) => SIZING.base[k] !== SIZING.mobile[k],
  )
  assert.ok(differing.length > 0, 'SIZING.mobile is identical to SIZING.base')

  // Tap targets are the deliberate exception: 44px at every width, because a finger
  // does not get smaller on a small screen.
  assert.equal(
    SIZING.mobile.tapTarget,
    SIZING.base.tapTarget,
    'the tap target must not shrink on mobile — see DESIGN_SYSTEM.md',
  )
})
