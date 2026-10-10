/**
 * WCAG 2.1 contrast arithmetic.
 *
 * Spec: `Official Documentation/16 Testing and Launch/` accessibility baseline —
 * WCAG 2.1 Level AA.
 *
 * This module is the guardrail behind per-school theming. A school picks its own
 * brand colours, and without a check it can pick a pale yellow that renders its
 * own fee balances unreadable. The check is arithmetic, not opinion: relative
 * luminance per WCAG, and the same 4.5:1 / 3:1 thresholds a manual audit uses.
 *
 * No dependencies on purpose — this runs in three places (the browser, the
 * Next.js server validating a theme on save, and the PDF renderer) and must
 * behave identically in all of them.
 */

/** WCAG AA thresholds. */
export const AA_NORMAL_TEXT = 4.5
/** Large text is ≥18.66px bold or ≥24px regular. */
export const AA_LARGE_TEXT = 3
/** Non-text UI: control borders, focus rings, icons carrying meaning. */
export const AA_UI_COMPONENT = 3

export interface Rgb {
  r: number
  g: number
  b: number
}

/**
 * Parses `#RGB`, `#RRGGBB`, or the same without the hash.
 * Returns null rather than throwing — this parses user input.
 */
export function parseHex(value: string): Rgb | null {
  if (typeof value !== 'string') return null
  const hex = value.trim().replace(/^#/, '')

  if (hex.length === 3) {
    if (!/^[0-9a-f]{3}$/i.test(hex)) return null
    const [r, g, b] = [...hex].map((c) => parseInt(c + c, 16))
    return { r: r as number, g: g as number, b: b as number }
  }

  if (hex.length === 6) {
    if (!/^[0-9a-f]{6}$/i.test(hex)) return null
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    }
  }

  return null
}

export function toHex({ r, g, b }: Rgb): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

/** WCAG relative luminance. */
export function relativeLuminance(color: string | Rgb): number {
  const rgb = typeof color === 'string' ? parseHex(color) : color
  if (!rgb) return 0

  const channel = (v: number): number => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }

  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
}

/**
 * Contrast ratio between two colours, 1:1 to 21:1.
 *
 * Order-independent by definition, so `contrastRatio(fg, bg)` and
 * `contrastRatio(bg, fg)` agree — a detail worth stating because reviewers
 * routinely assume the first argument must be the foreground.
 */
export function contrastRatio(a: string | Rgb, b: string | Rgb): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

export function meetsAA(fg: string, bg: string, level: 'normal' | 'large' | 'ui' = 'normal'): boolean {
  const threshold =
    level === 'normal' ? AA_NORMAL_TEXT : level === 'large' ? AA_LARGE_TEXT : AA_UI_COMPONENT
  return contrastRatio(fg, bg) >= threshold
}

/** Whichever of black/white reads better on the given background. */
export function readableTextOn(background: string, dark = '#111827', light = '#FFFFFF'): string {
  return contrastRatio(dark, background) >= contrastRatio(light, background) ? dark : light
}
