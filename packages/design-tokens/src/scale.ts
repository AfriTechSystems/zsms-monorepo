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
  /** The brand colour exactly as specified. Large decorative fills, swatches. */
  500: string
  /**
   * The saturated step for **icons, status dots, and bar segments** — anything
   * small that carries meaning by colour.
   *
   * Not the same as `500`, and the difference is not cosmetic. WCAG 1.4.11 asks
   * 3:1 of a graphical object against what surrounds it, and the ground these
   * marks sit on is this hue's own `100` tint — the tightest pairing in the
   * system. Measured flat, the brand hues do not all clear it: blue lands at
   * 2.93, teal at 2.79, and amber at **1.80**, which is a status dot nobody can
   * see on the chip it is meant to label.
   *
   * So this step is derived to guarantee the bar, exactly as `600` is derived to
   * guarantee text. For hues that already pass it is indistinguishable from
   * `500`; for amber it is visibly deeper, which is the honest consequence of
   * amber being a pale colour rather than a fault in the design.
   */
  mark: string
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

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n))

/**
 * Re-lightens a hue, optionally damping its saturation.
 *
 * The saturation argument is what separates a *soft tint* from a pastel. Raising
 * lightness alone keeps the original saturation, and a fully saturated colour at
 * 93% lightness reads as sherbet — cheerful, and wrong for a page a bursar looks
 * at for six hours. Pulling saturation down as lightness rises produces the
 * chalky, slightly greyed tint the reference aesthetic uses, and it is the single
 * adjustment that most changes how "designed" the result looks.
 */
function adjust(hex: string, lightness: number, saturationScale = 1): string {
  const rgb = parseHex(hex)
  if (!rgb) return hex
  const hsl = rgbToHsl(rgb)
  return toHex(
    hslToRgb({ h: hsl.h, s: clamp01(hsl.s * saturationScale), l: clamp01(lightness) }),
  )
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
 * that colour on its buttons and chips. The derived steps carry the text.
 *
 * **`ground` is the lightest-but-one surface the text steps must survive, and it
 * is not white.** The page is a soft lavender-grey, so a link derived to clear
 * 4.5:1 against `#FFFFFF` lands at 4.15:1 once it is drawn on the page — passing
 * the test it was given and failing the one that matters. Deriving against the
 * page instead is very slightly darker everywhere and correct on both grounds.
 * The audit caught this the moment the page stopped being white, which is the
 * argument for auditing rather than reasoning.
 */
export function deriveScale(brandHex: string, ground = '#FFFFFF'): ColorScale {
  const rgb = parseHex(brandHex)
  if (!rgb) throw new Error(`deriveScale: '${brandHex}' is not a valid hex colour`)

  const { l } = rgbToHsl(rgb)

  // Tints are progressively desaturated as they lighten. See `adjust()`.
  const tint100 = adjust(brandHex, Math.max(l, 0.93), 0.76)

  return {
    50: adjust(brandHex, Math.max(l, 0.965), 0.7),
    100: tint100,
    200: adjust(brandHex, Math.max(l, 0.86), 0.84),
    500: toHex(rgb),
    // Against the tint, which is a tighter ground than either the page or a
    // card — so a mark that clears its own chip clears everywhere it is used.
    mark: darkenUntilContrast(brandHex, 3, tint100),
    600: darkenUntilContrast(brandHex, 4.5, ground),
    700: darkenUntilContrast(brandHex, 7, ground),
    800: darkenUntilContrast(brandHex, 10, ground),
  }
}

/**
 * The dark-mode counterpart.
 *
 * Dark mode is not the light scale inverted. On a dark surface the *light* end
 * of a hue carries text, and a colour that passed 4.5:1 on white can fail badly
 * on a charcoal ground. So the step used for text is lightened until it clears
 * AA against the dark surface it will actually sit on.
 *
 * **Every step is also desaturated.** A fully saturated hue on charcoal does not
 * read as brighter, it reads as *vibrating* — the eye cannot settle on the edge
 * between a neon accent and a near-black ground, and on a long shift that is
 * fatigue rather than emphasis. Pulling saturation back lets the colour glow
 * against the dark instead of fighting it, and it is the reason a dark theme
 * built by inverting a light one always looks harsher than one derived for the
 * ground it sits on.
 *
 * The damping is applied inside the search loop, not after it, so the returned
 * step is the *desaturated* colour that was measured — desaturating afterwards
 * would silently move it back below the threshold it was chosen to clear.
 */
export function deriveDarkScale(brandHex: string, surface: string): ColorScale {
  const rgb = parseHex(brandHex)
  if (!rgb) throw new Error(`deriveDarkScale: '${brandHex}' is not a valid hex colour`)

  const hsl = rgbToHsl(rgb)

  /** Saturation retained on text-bearing steps. */
  const DAMP = 0.82

  const lightenUntil = (target: number, against = surface): string => {
    let lightness = hsl.l
    for (let i = 0; i < 200 && lightness < 1; i += 1) {
      const candidate = toHex(
        hslToRgb({ h: hsl.h, s: clamp01(hsl.s * DAMP), l: lightness }),
      )
      if (contrastRatio(candidate, against) >= target) return candidate
      lightness += 0.005
    }
    return '#FFFFFF'
  }

  // On dark, a "tint" is a low-lightness wash the eye reads as a tinted panel
  // rather than a pale chip. Heavily desaturated so a row of six of them stays
  // a set of quiet panels rather than a row of stained glass.
  const tint100 = adjust(brandHex, 0.17, 0.55)

  return {
    50: adjust(brandHex, 0.13, 0.5),
    100: tint100,
    200: adjust(brandHex, 0.26, 0.65),
    500: adjust(brandHex, hsl.l, 0.88),
    // Lightened, not darkened, and measured against the dark tint. The naive
    // choice — reusing step 500 — puts a dark navy dot on a dark navy panel at
    // 1.03:1 for the anchor hue, which is simply not there.
    mark: lightenUntil(3, tint100),
    600: lightenUntil(4.5),
    700: lightenUntil(7),
    800: lightenUntil(10),
  }
}
