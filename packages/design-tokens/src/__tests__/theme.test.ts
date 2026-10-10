/**
 * Design-token tests.
 *
 * These are accessibility assertions, not snapshot tests. The question they
 * answer is "can a person read this", and the answer is arithmetic, so it can be
 * asserted rather than eyeballed in review.
 *
 * Run: npx tsx packages/design-tokens/src/__tests__/theme.test.ts
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { contrastRatio, meetsAA, parseHex, readableTextOn } from '../contrast'
import { deriveScale } from '../scale'
import { BRAND, ZSMS_DARK, ZSMS_LIGHT } from '../tokens'
import { auditTheme, PAGE_GROUND, resolveTheme, schoolInitials, validateTheme } from '../theme'

// ---------------------------------------------------------------------------
// Contrast arithmetic
// ---------------------------------------------------------------------------

test('contrast: known reference values', () => {
  // Black on white is the definitional maximum.
  assert.equal(Math.round(contrastRatio('#000000', '#FFFFFF')), 21)
  assert.equal(contrastRatio('#FFFFFF', '#FFFFFF'), 1)
  // Order does not matter.
  assert.equal(
    contrastRatio('#2B3A55', '#FFFFFF').toFixed(4),
    contrastRatio('#FFFFFF', '#2B3A55').toFixed(4),
  )
})

test('contrast: parses shorthand, full, and hashless hex; rejects junk', () => {
  assert.deepEqual(parseHex('#FFF'), { r: 255, g: 255, b: 255 })
  assert.deepEqual(parseHex('2B3A55'), { r: 43, g: 58, b: 85 })
  assert.equal(parseHex('not-a-colour'), null)
  assert.equal(parseHex('#12345'), null)
  assert.equal(parseHex(''), null)
})

test('contrast: the brand palette is measured, not assumed', () => {
  // This test documents WHY scale derivation exists. If someone "simplifies"
  // the scale away and uses flat brand hexes, these numbers are the reason it
  // will fail an audit.
  assert.ok(contrastRatio(BRAND.navy, '#FFFFFF') > 4.5, 'navy is safe as text')
  assert.ok(contrastRatio(BRAND.blue, '#FFFFFF') < 4.5, 'brand blue alone FAILS AA as text')
  assert.ok(contrastRatio(BRAND.amber, '#FFFFFF') < 3, 'brand amber fails even the 3:1 UI bar')
})

// ---------------------------------------------------------------------------
// Scale derivation
// ---------------------------------------------------------------------------

test('scale: step 500 is the brand colour, untouched', () => {
  for (const hex of Object.values(BRAND)) {
    assert.equal(deriveScale(hex)[500], hex.toUpperCase(), `${hex} survives derivation`)
  }
})

test('scale: step 600 clears AA against white for every brand hue', () => {
  for (const [name, hex] of Object.entries(BRAND)) {
    const scale = deriveScale(hex)
    const ratio = contrastRatio(scale[600], '#FFFFFF')
    assert.ok(ratio >= 4.5, `${name}-600 (${scale[600]}) is ${ratio.toFixed(2)}:1, needs 4.5`)
  }
})

test('scale: tints carry their own 700 text at AA', () => {
  for (const [name, hex] of Object.entries(BRAND)) {
    const s = deriveScale(hex)
    const ratio = contrastRatio(s[700], s[100])
    assert.ok(ratio >= 4.5, `${name}-700 on ${name}-100 is ${ratio.toFixed(2)}:1, needs 4.5`)
  }
})

test('scale: rejects invalid input rather than silently returning grey', () => {
  assert.throws(() => deriveScale('rebeccapurple'), /not a valid hex/)
})

// ---------------------------------------------------------------------------
// The themes as rendered
// ---------------------------------------------------------------------------

test('theme: every pairing in the default LIGHT theme meets WCAG AA', () => {
  const failures = auditTheme(ZSMS_LIGHT).filter((r) => !r.ok)
  assert.deepEqual(
    failures.map((f) => `${f.pair} = ${f.ratio.toFixed(2)}:1`),
    [],
  )
})

test('theme: every pairing in the default DARK theme meets WCAG AA', () => {
  const failures = auditTheme(ZSMS_DARK).filter((r) => !r.ok)
  assert.deepEqual(
    failures.map((f) => `${f.pair} = ${f.ratio.toFixed(2)}:1`),
    [],
  )
})

test('theme: amber never ends up with white text on it', () => {
  // The rule that must hold no matter how the scale changes: whatever colour
  // sits on a warning surface is chosen by measurement.
  const warn = ZSMS_LIGHT.colors.warning
  assert.equal(readableTextOn(warn[500]), '#111827', 'dark text wins on amber')
  assert.ok(!meetsAA('#FFFFFF', warn[500]), 'white on amber does not pass — never use it')
})

// ---------------------------------------------------------------------------
// Per-school theming
// ---------------------------------------------------------------------------

test('school theme: a school setting nothing gets stock ZSMS', () => {
  const t = resolveTheme(null)
  assert.equal(t.isDefault, true)
  assert.equal(t.light.colors.anchor[500], BRAND.navy)
  assert.equal(t.light.colors.primary[500], BRAND.blue)
})

test('school theme: a custom palette still passes the full audit', () => {
  // A deep maroon and a forest green — plausible school colours, nothing like
  // the ZSMS defaults.
  const t = resolveTheme({
    anchorColor: '#5B1A1A',
    primaryColor: '#1F6F3F',
    schoolName: 'Kabulonga Girls Secondary School',
  })

  for (const mode of ['light', 'dark'] as const) {
    const failures = auditTheme(t[mode]).filter((r) => !r.ok)
    assert.deepEqual(failures.map((f) => `${mode}: ${f.pair} = ${f.ratio.toFixed(2)}:1`), [])
  }
})

test('school theme: the focus ring stays visible for a dark brand colour in dark mode', () => {
  // Regression. A forest-green primary produced a 2.82:1 ring against the
  // dark-mode background when the ring was hard-wired to step 500. A keyboard
  // user loses their position entirely, and it is invisible in light mode
  // testing — nobody would have found it by looking.
  const t = resolveTheme({ anchorColor: '#5B1A1A', primaryColor: '#1F6F3F' })

  for (const mode of ['light', 'dark'] as const) {
    const ring = t[mode].surface.focusRing
    const bg = t[mode].surface.background
    const ratio = contrastRatio(ring, bg)
    assert.ok(ratio >= 3, `${mode} ring ${ring} on ${bg} is ${ratio.toFixed(2)}:1, needs 3`)
  }
})

test('school theme: semantic colours are NOT themeable', () => {
  const t = resolveTheme({ anchorColor: '#5B1A1A', primaryColor: '#1F6F3F' })
  // Green still means paid, coral still means overdue, whatever the school picked.
  assert.equal(t.light.colors.success[500], BRAND.green)
  assert.equal(t.light.colors.danger[500], BRAND.coral)
  assert.equal(t.light.colors.warning[500], BRAND.amber)
})

test('school theme: partial configuration falls back field by field', () => {
  const t = resolveTheme({ logoUrl: 'https://cdn.example/logo.png', schoolName: 'Alpha Academy' })
  assert.equal(t.light.colors.anchor[500], BRAND.navy, 'unset colour falls back')
  assert.equal(t.logoUrl, 'https://cdn.example/logo.png', 'set logo is kept')
  assert.equal(t.isDefault, false, 'a logo alone means it is no longer stock')
})

test('school theme: corrupt stored colour degrades to default instead of throwing', () => {
  // Bad data here means validation was bypassed. A parent checking a fee balance
  // should still get a page.
  const t = resolveTheme({ anchorColor: 'periwinkle', primaryColor: '#3A8DDE' })
  assert.equal(t.light.colors.anchor[500], BRAND.navy)
})

// ---------------------------------------------------------------------------
// The guardrail
// ---------------------------------------------------------------------------

test('guardrail: an unreadable anchor colour is refused', () => {
  const result = validateTheme({ anchorColor: '#FFF9C4' }) // pale yellow
  assert.equal(result.valid, false)
  assert.equal(result.violations[0]?.field, 'anchorColor')
  assert.match(result.violations[0]?.message ?? '', /too light to read as text/)
  // Measured against the page, not white. A near-miss anchor would pass the
  // easier ground and fail where it is actually drawn.
  assert.equal(result.violations[0]?.against, PAGE_GROUND)
})

test('guardrail: thresholds are measured against the page, not white', () => {
  // 4.51:1 on white, 4.07:1 on the page ground. Passes the old check and fails
  // the one that matters — this is the exact class of colour the move to a
  // tinted page put at risk, so it is pinned rather than left to reasoning.
  const borderline = '#6E7690'
  assert.ok(contrastRatio(borderline, '#FFFFFF') >= 4.5)
  assert.ok(contrastRatio(borderline, PAGE_GROUND) < 4.5)
  assert.equal(validateTheme({ anchorColor: borderline }).valid, false)
})

test('guardrail: a washed-out button colour is refused', () => {
  const result = validateTheme({ primaryColor: '#E8F4FF' })
  assert.equal(result.valid, false)
  assert.match(result.violations[0]?.message ?? '', /too pale for buttons/)
})

test('guardrail: malformed input is refused with a usable message', () => {
  const result = validateTheme({ anchorColor: 'dark blue' })
  assert.equal(result.valid, false)
  assert.match(result.violations[0]?.message ?? '', /not a valid hex colour/)
})

test('guardrail: the ZSMS defaults pass their own check', () => {
  assert.equal(validateTheme({ anchorColor: BRAND.navy, primaryColor: BRAND.blue }).valid, true)
})

test('guardrail: unset fields are not violations', () => {
  assert.equal(validateTheme({}).valid, true)
  assert.equal(validateTheme({ anchorColor: null, primaryColor: undefined }).valid, true)
})

// ---------------------------------------------------------------------------
// Logo fallback
// ---------------------------------------------------------------------------

test('initials: drops stopwords so the letters are the recognisable ones', () => {
  assert.equal(schoolInitials('The Lusaka Academy of Science'), 'LS')
  assert.equal(schoolInitials('Kabulonga Girls Secondary School'), 'KGS')
  assert.equal(schoolInitials('St. Mary’s'), 'SM')
})

test('initials: single-word and edge-case names still produce something', () => {
  assert.equal(schoolInitials('Chipata'), 'CH')
  assert.equal(schoolInitials('The School'), 'TS', 'all-stopword names fall back to raw words')
  assert.equal(schoolInitials(''), 'ZS')
  assert.equal(schoolInitials(null), 'ZS')
  assert.equal(schoolInitials('   '), 'ZS')
})

test('initials: never exceeds three characters', () => {
  const long = schoolInitials('Northern Province Community Development Trust School')
  assert.ok(long.length <= 3, `got '${long}'`)
})
