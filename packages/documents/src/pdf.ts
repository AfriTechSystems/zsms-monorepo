/**
 * PDF rendering primitives.
 *
 * Spec: `Official Documentation/13 Document and PDF System/PDF_GENERATION.md`
 *
 * `pdf-lib` rather than a headless browser: `PDF_GENERATION.md` requires 400
 * report cards in under 90 seconds, and launching Chromium per document cannot
 * reach that. pdf-lib draws directly, so a batch reuses one font load and one
 * logo embed across every page — which is the specific requirement that a
 * browser-based renderer fails.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { zsmsLogoBytes } from './branding'
import type { RenderedDocument } from './types'

export const A4 = { width: 595.28, height: 841.89 } as const
export const MARGIN = 48

export const INK = rgb(0.11, 0.12, 0.14)
export const MUTED = rgb(0.42, 0.45, 0.5)
export const RULE = rgb(0.85, 0.87, 0.9)

/** ZSMS navy `#1E2A3F` — the anchor colour a school has not overridden. */
export const BRAND_DEFAULT = rgb(0x1e / 255, 0x2a / 255, 0x3f / 255)

/**
 * `#RRGGBB` → pdf-lib colour, falling back rather than throwing.
 *
 * Bad data reaching a renderer means the 0092 constraints were bypassed. A
 * receipt is proof of payment; it must still print.
 */
export function brandColor(hex: string | undefined, fallback = BRAND_DEFAULT): ReturnType<typeof rgb> {
  if (!hex || !/^#[0-9A-Fa-f]{6}$/.test(hex)) return fallback
  const n = parseInt(hex.slice(1), 16)
  return rgb(((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255)
}

export interface Doc {
  pdf: PDFDocument
  page: PDFPage
  font: PDFFont
  bold: PDFFont
  /** Current vertical cursor, measured from the top. */
  y: number
}

export async function newDocument(): Promise<Doc> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const page = pdf.addPage([A4.width, A4.height])
  return { pdf, page, font, bold, y: A4.height - MARGIN }
}

/** Adds a page and resets the cursor. Used when a table outruns the sheet. */
export function newPage(doc: Doc): void {
  doc.page = doc.pdf.addPage([A4.width, A4.height])
  doc.y = A4.height - MARGIN
}

export function text(
  doc: Doc,
  value: string,
  opts: { x?: number; size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; maxWidth?: number } = {},
): void {
  const size = opts.size ?? 10
  const font = opts.bold ? doc.bold : doc.font
  let out = value

  // Truncate rather than overflow into the next column. A receipt with a name
  // running across the amount is worse than a name ending in an ellipsis.
  if (opts.maxWidth) {
    while (out.length > 1 && font.widthOfTextAtSize(out, size) > opts.maxWidth) {
      out = out.slice(0, -1)
    }
    if (out !== value && out.length > 1) out = `${out.slice(0, -1)}…`
  }

  doc.page.drawText(out, {
    x: opts.x ?? MARGIN,
    y: doc.y,
    size,
    font,
    color: opts.color ?? INK,
  })
}

/**
 * Wrapped, paginating body text — the counterpart to `text()`, which truncates.
 *
 * Truncation is correct for a receipt: a payer's name running across the amount column is worse
 * than one ending in an ellipsis. It is wrong for a lesson plan, where the words ARE the document
 * and a clipped learning outcome is a wrong learning outcome.
 *
 * Breaking on spaces means a very long unbroken token (a URL, say) still overflows rather than
 * being chopped mid-word. That is the better failure: a visibly overflowing URL is obviously
 * wrong, while a silently chopped one looks like a real address and is not.
 */
const NEWLINE = '\n'

export function paragraph(
  doc: Doc,
  value: string,
  opts: {
    x?: number
    size?: number
    bold?: boolean
    color?: ReturnType<typeof rgb>
    width?: number
    leading?: number
  } = {},
): void {
  const size = opts.size ?? 10
  const font = opts.bold ? doc.bold : doc.font
  const x = opts.x ?? MARGIN
  const width = opts.width ?? A4.width - MARGIN * 2 - (x - MARGIN)
  const leading = opts.leading ?? size * 1.45

  const lines: string[] = []
  // Explicit newline rather than a literal, so a generator emitting multi-line prose keeps its
  // paragraph breaks instead of having them collapsed into one run of words.
  for (const rawLine of value.split(NEWLINE)) {
    let current = ''
    for (const word of rawLine.split(/\s+/)) {
      if (word === '') continue
      const candidate = current === '' ? word : `${current} ${word}`
      if (font.widthOfTextAtSize(candidate, size) > width && current !== '') {
        lines.push(current)
        current = word
      } else {
        current = candidate
      }
    }
    lines.push(current)
  }

  for (const line of lines) {
    // Checked per LINE, not per paragraph: a long paragraph starting near the foot of a page must
    // break across it rather than run off the bottom.
    if (needsPage(doc, leading)) newPage(doc)
    doc.page.drawText(line, { x, y: doc.y, size, font, color: opts.color ?? INK })
    doc.y -= leading
  }
}

/** A bulleted list. The bullet hangs, so wrapped lines align under the text rather than the dot. */
export function bullets(
  doc: Doc,
  items: string[],
  opts: { x?: number; size?: number; width?: number } = {},
): void {
  const x = opts.x ?? MARGIN
  const size = opts.size ?? 10
  for (const item of items) {
    if (needsPage(doc, size * 1.45)) newPage(doc)
    doc.page.drawText('•', { x, y: doc.y, size, font: doc.font, color: MUTED })
    paragraph(doc, item, {
      x: x + 14,
      size,
      width: (opts.width ?? A4.width - MARGIN * 2) - 14,
    })
    move(doc, 2)
  }
}

/** Right-aligns at `right`. Money columns must align on the decimal, and a
 *  left-drawn amount column does not. */
export function textRight(
  doc: Doc,
  value: string,
  right: number,
  opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb> } = {},
): void {
  const size = opts.size ?? 10
  const font = opts.bold ? doc.bold : doc.font
  const width = font.widthOfTextAtSize(value, size)
  doc.page.drawText(value, {
    x: right - width,
    y: doc.y,
    size,
    font,
    color: opts.color ?? INK,
  })
}

export function move(doc: Doc, dy: number): void {
  doc.y -= dy
}

export function rule(doc: Doc, dy = 8, color = RULE, thickness = 0.75): void {
  doc.y -= dy
  doc.page.drawLine({
    start: { x: MARGIN, y: doc.y },
    end: { x: A4.width - MARGIN, y: doc.y },
    thickness,
    color,
  })
  doc.y -= dy
}

/** True when there is not enough room left for `needed` points. */
export function needsPage(doc: Doc, needed: number): boolean {
  return doc.y - needed < MARGIN + 40
}

export async function header(
  doc: Doc,
  school: {
    name: string
    schoolCode: string
    address?: string
    logoBytes?: Uint8Array
    anchorColor?: string
  },
  title: string,
): Promise<void> {
  // The school's colour is applied to the name and the rule beneath the title —
  // the two marks that say whose document this is — and nowhere else. Body text
  // and money stay INK: a themed amount column would trade legibility for brand,
  // and this is the page a parent reads to check what they paid.
  const brand = brandColor(school.anchorColor)

  // A school that has not uploaded a logo still gets a mark. An empty header on
  // a payment receipt reads as a draft rather than as a record of money
  // received, which is the one impression this document must not give.
  const logo = school.logoBytes && school.logoBytes.length > 0 ? school.logoBytes : zsmsLogoBytes()

  if (logo && logo.length > 0) {
    try {
      // PNG first, JPEG on failure — schools upload whatever their designer
      // gave them, and a failed logo must not fail the document.
      const image = await doc.pdf.embedPng(logo).catch(() => doc.pdf.embedJpg(logo))
      const dims = image.scale(40 / image.height)
      doc.page.drawImage(image, {
        x: A4.width - MARGIN - dims.width,
        y: doc.y - dims.height + 10,
        width: dims.width,
        height: dims.height,
      })
    } catch {
      // Ignore — a missing or corrupt logo is cosmetic.
    }
  }

  text(doc, school.name, { size: 16, bold: true, color: brand })
  move(doc, 14)
  text(doc, school.schoolCode, { size: 9, color: MUTED })
  if (school.address) {
    move(doc, 11)
    text(doc, school.address, { size: 9, color: MUTED, maxWidth: 320 })
  }
  move(doc, 22)
  text(doc, title, { size: 13, bold: true })
  rule(doc, 10, brand, 1.25)
}

export function footer(doc: Doc, note: string): void {
  const pages = doc.pdf.getPages()
  pages.forEach((p, i) => {
    p.drawText(`${note}   ·   Page ${i + 1} of ${pages.length}`, {
      x: MARGIN,
      y: MARGIN - 18,
      size: 7.5,
      font: doc.font,
      color: MUTED,
    })
  })
}

export async function finish(doc: Doc, filename: string): Promise<RenderedDocument> {
  const bytes = await doc.pdf.save()
  return { bytes, contentType: 'application/pdf', suggestedFilename: filename }
}
