/**
 * Deriving an accessible scale from a single brand colour.
 *
 * This exists because of a measurement, not a preference. Checked against
 * white, the ZSMS brand palette reads:
 *
 * | Colour            | vs white | AA text (4.5) | AA UI (3.0) |
 * |-------------------|----------|---------------|-------------|
 * | Navy   `#2B3A55`  | 11.42    | pass          | pass        |
 * | Blue   `#3A8DDE`  |  3.47    | **fail**      | pass        |
 * | Green  `#4A9B4F`  |  3.45    | **fail**      | pass        |
 * | Coral  `#E15A44`  |  3.65    | **fail**      | pass        |
 * | Teal   `#1BA0B0`  |  3.13    | **fail**      | pass        |
 * | Amber  `#F5A623`  |  2.03    | **fail**      | **fail**    |
 *
 * Only navy is safe as text. Used flat, the brand blue would fail AA both as a
 * link on white and as white label text on a blue button — the two most common
 * things a button colour does.
 *
 * The fix is standard and not a compromise of the brand: each hue becomes a
 * scale. The brand hex stays exactly as given at step 500 and is used where 3:1
 * is the correct bar (fills, borders, chart series, focus rings). Step 600 is
 * darkened until it clears 4.5:1 against white, and carries text and solid
 * buttons. Step 100 is a tint for status chips, which pair with 700 text.
 *
 * The brand is preserved where the eye reads colour — large fills — and adjusted
 * only where the eye reads letterforms.
 */

import { contrastRatio, parseHex, toHex, type Rgb } from './contrast'

export interface ColorScale {
  /** Tint. Chip and banner backgrounds. Pair with `text`. */
  50: string
  100: string
  /** Borders and dividers in this hue. */
  200: string
  /** The brand colour exactly as specified. Fills, ≥3:1 surfaces. */
  500: string
  /** AA against white. Solid buttons with white labels, links, icons. */
  600: string
  /** Hover/pressed for 600, and text on a 50/100 tint. */
  700: string
  /** Deep — dark-mode text on dark surfaces uses the light end instead. */
  800: string
}

interface Hsl {
  h: number
  s: number
  l: number
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2

  if (max === min) return { h: 0, s: 0, l }

  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number

  switch (max) {
    case rn:
      h = (gn - bn) / d + (gn < bn ? 6 : 0)
      break
    case gn:
      h = (bn - rn) / d + 2
      break
    default:
      h = (rn - gn) / d + 4
  }

  return { h: h / 6, s, l }
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  if (s === 0) {
    const v = l * 255
    return { r: v, g: v, b: v }
  }

  const hue = (p: number, q: number, t: number): number => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q

  return {
    r: hue(p, q, h + 1 / 3) * 255,
    g: hue(p, q, h) * 255,
    b: hue(p, q, h - 1 / 3) * 255,
  }
}

function withLightness(hex: string, lightness: number): string {
  const rgb = parseHex(hex)
  if (!rgb) return hex
  const hsl = rgbToHsl(rgb)
  return toHex(hslToRgb({ ...hsl, l: Math.max(0, Math.min(1, lightness)) }))
}

/**
 * Darkens `hex` in small steps until it clears `target` against white.
 *
 * Steps rather than solving directly because luminance is not linear in HSL
 * lightness, and a 0.5% step lands within a hair of the threshold while keeping
 * the hue visibly the original. Bounded so a pathological input terminates.
 */
function darkenUntilContrast(hex: string, target: number, against = '#FFFFFF'): string {
  const rgb = parseHex(hex)
  if (!rgb) return hex

  const hsl = rgbToHsl(rgb)
  let lightness = hsl.l

  for (let i = 0; i < 200 && lightness > 0; i += 1) {
    const candidate = toHex(hslToRgb({ ...hsl, l: lightness }))
    if (contrastRatio(candidate, against) >= target) return candidate
    lightness -= 0.005
  }

  return '#000000'
}

/**
 * Builds a full scale from one brand hex.
 *
 * Step 500 is returned unchanged — a school that enters `#3A8DDE` sees exactly
 * that colour on its buttons and header. The derived steps carry the text.
 */
export function deriveScale(brandHex: string): ColorScale {
  const rgb = parseHex(brandHex)
  if (!rgb) throw new Error(`deriveScale: '${brandHex}' is not a valid hex colour`)

  const { l } = rgbToHsl(rgb)

  return {
    50: withLightness(brandHex, Math.max(l, 0.96)),
    100: withLightness(brandHex, Math.max(l, 0.92)),
    200: withLightness(brandHex, Math.max(l, 0.84)),
    500: toHex(rgb),
    600: darkenUntilContrast(brandHex, 4.5),
    700: darkenUntilContrast(brandHex, 7),
    800: darkenUntilContrast(brandHex, 10),
  }
}

/**
 * The dark-mode counterpart.
 *
 * Dark mode is not the light scale inverted. On a dark surface the *light* end
 * of a hue carries text, and a colour that passed 4.5:1 on white can fail badly
 * on `#151A24`. So the step used for text is lightened until it clears AA
 * against the dark surface it will actually sit on.
 */
export function deriveDarkScale(brandHex: string, surface: string): ColorScale {
  const rgb = parseHex(brandHex)
  if (!rgb) throw new Error(`deriveDarkScale: '${brandHex}' is not a valid hex colour`)

  const hsl = rgbToHsl(rgb)

  const lightenUntil = (target: number): string => {
    let lightness = hsl.l
    for (let i = 0; i < 200 && lightness < 1; i += 1) {
      const candidate = toHex(hslToRgb({ ...hsl, l: lightness }))
      if (contrastRatio(candidate, surface) >= target) return candidate
      lightness += 0.005
    }
    return '#FFFFFF'
  }

  return {
    // On dark, the "tint" is a low-lightness wash the eye reads as a coloured
    // panel rather than a pale chip.
    50: withLightness(brandHex, 0.12),
    100: withLightness(brandHex, 0.16),
    200: withLightness(brandHex, 0.24),
    500: toHex(rgb),
    600: lightenUntil(4.5),
    700: lightenUntil(7),
    800: lightenUntil(10),
  }
}
