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
import type { RenderedDocument } from './types'

export const A4 = { width: 595.28, height: 841.89 } as const
export const MARGIN = 48

export const INK = rgb(0.11, 0.12, 0.14)
export const MUTED = rgb(0.42, 0.45, 0.5)
export const RULE = rgb(0.85, 0.87, 0.9)

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

export function rule(doc: Doc, dy = 8): void {
  doc.y -= dy
  doc.page.drawLine({
    start: { x: MARGIN, y: doc.y },
    end: { x: A4.width - MARGIN, y: doc.y },
    thickness: 0.75,
    color: RULE,
  })
  doc.y -= dy
}

/** True when there is not enough room left for `needed` points. */
export function needsPage(doc: Doc, needed: number): boolean {
  return doc.y - needed < MARGIN + 40
}

export async function header(doc: Doc, school: { name: string; schoolCode: string; address?: string; logoBytes?: Uint8Array }, title: string): Promise<void> {
  if (school.logoBytes && school.logoBytes.length > 0) {
    try {
      // PNG first, JPEG on failure — schools upload whatever their designer
      // gave them, and a failed logo must not fail the document.
      const image = await doc.pdf.embedPng(school.logoBytes).catch(() => doc.pdf.embedJpg(school.logoBytes!))
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

  text(doc, school.name, { size: 16, bold: true })
  move(doc, 14)
  text(doc, school.schoolCode, { size: 9, color: MUTED })
  if (school.address) {
    move(doc, 11)
    text(doc, school.address, { size: 9, color: MUTED, maxWidth: 320 })
  }
  move(doc, 22)
  text(doc, title, { size: 13, bold: true })
  rule(doc, 10)
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
