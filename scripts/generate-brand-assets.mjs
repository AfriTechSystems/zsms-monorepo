/**
 * Generates every ZSMS brand raster from the single supplied logo.
 *
 * Run: `npm run brand:assets`
 *
 * **Why this is a script and not a one-off.** The source logo will be replaced
 * at some point — a redraw, a tweak to the wordmark — and when it is, eleven
 * derived files have to move with it. A folder of hand-cropped PNGs is a folder
 * that silently goes stale; this file makes regeneration a single command and
 * records the crop geometry as data rather than as something someone did once in
 * an image editor.
 *
 * **What the source is.** `zsms-logo.png`, 1777×885 RGBA. It is a *stacked*
 * lockup — the emblem above the ZSMS wordmark — with a 17px band of empty rows
 * separating them and a wide transparent margin either side. Those margins are
 * why nothing here uses the file as-is: dropped into a 40px-tall PDF header the
 * artwork would render at roughly half the height it should, because a third of
 * the image is nothing.
 *
 * The geometry below was measured from the alpha channel, not eyeballed. If the
 * source is replaced, re-measure rather than assuming these still hold — the
 * `verify` step at the end will catch a crop that has drifted onto ink, but not
 * one that has drifted into empty space.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import sharp from 'sharp'

const SRC = 'apps/web/public/brand/zsms-logo.png'
const BRAND = 'apps/web/public/brand'
const APP = 'apps/web/app'
const DOCS = 'packages/documents/src/assets'
const MOBILE = 'apps/mobile/assets'

/**
 * Measured content geometry of the source file, in source pixels.
 *
 * `mark` is the emblem alone — graduation cap, reader, open book. It is what
 * becomes the square icon: the full lockup shrunk to 32px is an unreadable
 * smudge, because the wordmark is 207px of a 885px image and disappears first.
 */
const GEOMETRY = {
  full: { left: 363, top: 10, width: 1052, height: 861 },
  mark: { left: 591, top: 10, width: 592, height: 637 },
}

/** Square icons need breathing room or they read as cropped at small sizes. */
const ICON_PADDING = 0.08

/**
 * Palette-quantised PNG for everything the browser downloads.
 *
 * The source is a gradient-heavy render, which is the worst case for PNG's
 * lossless filters — the trimmed lockup is 429 KB as truecolour and 43 KB
 * quantised to 256 colours, with no visible difference at the sizes it is
 * rendered. On a parent's phone in Lusaka that is the whole point: the splash
 * screen exists to make the wait feel shorter, and a 429 KB logo would be the
 * thing being waited for.
 */
const WEB_PNG = { compressionLevel: 9, palette: true, quality: 90, colours: 256 }

/**
 * Truecolour, for the PDF renderer.
 *
 * `pdf-lib` decodes the PNG itself rather than passing it through, and its
 * decoder is happiest with straightforward RGBA. A receipt is not worth a
 * decoder edge case to save a few kilobytes that never travel over a network —
 * the file is embedded server-side.
 */
const PDF_PNG = { compressionLevel: 9, palette: false }

function out(path, buffer) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, buffer)
  console.log(`  ${path}  ${(buffer.length / 1024).toFixed(1)} KB`)
}

/** The emblem, centred on a transparent square. */
async function squareMark(size, options = WEB_PNG) {
  /*
    `padding` overrides the default inset, and `flatten` paints an opaque background.

    Both exist for the Expo icons: Android masks its adaptive foreground to a circle,
    so that one needs more inset than a web favicon, and iOS composites nothing behind
    an icon, so a transparent one renders black on a dark home screen.
  */
  const pad = options.padding ?? ICON_PADDING
  const inner = Math.round(size * (1 - pad * 2))
  const mark = await sharp(SRC)
    .extract(GEOMETRY.mark)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer()

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: mark, gravity: 'center' }])
    /*
      `flatten` before `png`, not after: flattening replaces the alpha channel with a
      solid colour, and doing it the other way round encodes the transparency first
      and then has nothing left to flatten.

      `padding` and `flatten` are this function's own options, so they are stripped
      before the rest reaches sharp — passing an unknown key to `.png()` throws.
    */
    .flatten(options.flatten ? { background: options.flatten } : false)
    .png(pngOptions(options))
    .toBuffer()
}

/** sharp's `.png()` options only — ours are removed. */
function pngOptions({ padding: _p, flatten: _f, ...rest }) {
  return rest
}

/** The full stacked lockup, trimmed of dead margin, at a given width. */
async function lockup(width, options = WEB_PNG) {
  return sharp(SRC).extract(GEOMETRY.full).resize({ width }).png(options).toBuffer()
}

async function main() {
  const meta = await sharp(SRC).metadata()
  if (meta.width !== 1777 || meta.height !== 885) {
    console.warn(
      `\n!! ${SRC} is ${meta.width}x${meta.height}, not 1777x885.\n` +
        `   GEOMETRY above was measured against the original and is now wrong.\n` +
        `   Re-measure the alpha bounding boxes before trusting these outputs.\n`,
    )
  }

  console.log('\nLockups (trimmed):')
  // 640 covers the splash at 2x on a phone, where it renders around 260px wide.
  // 240 for PDF headers: the header draws the logo 40pt tall, so 240px is
  // already generous for print, and every receipt embeds its own copy.
  out(join(BRAND, 'zsms-lockup.png'), await lockup(640))
  const pdfLockup = await lockup(240, PDF_PNG)
  out(join(BRAND, 'zsms-lockup-pdf.png'), pdfLockup)
  // The same bytes ship inside @zsms/documents, so a Railway worker rendering a
  // receipt has the mark without reaching for the web app's public folder.
  out(join(DOCS, 'zsms-lockup-pdf.png'), pdfLockup)

  console.log('\nSquare icons:')
  for (const size of [512, 192, 180, 48, 32, 16]) {
    out(join(BRAND, `zsms-icon-${size}.png`), await squareMark(size))
  }

  // Next.js App Router file conventions. `app/icon.png` and `app/apple-icon.png`
  // are picked up automatically and the <link> tags are generated — no
  // hand-written head markup to fall out of step with the files.
  console.log('\nApp Router icon conventions:')
  // 256 rather than 512: a favicon is never rendered above 180 and the file is
  // fetched on every cold page load.
  out(join(APP, 'icon.png'), await squareMark(256))
  out(join(APP, 'apple-icon.png'), await squareMark(180))

  /*
    The Expo app's icons.

    Generated here rather than hand-copied for the reason this whole script exists:
    the source logo will be redrawn one day, and a PNG somebody dragged into
    `apps/mobile/assets` once would silently keep showing the old mark on every
    installed phone.

    Three files, because Android and iOS want different things:

      * `icon.png`      — 1024, the iOS icon and the Expo fallback. Opaque, because
                          iOS composites nothing behind it and a transparent icon
                          renders black on a dark home screen.
      * `adaptive-icon.png` — 1024 foreground for Android's adaptive icon, which is
                          masked to whatever shape the launcher uses. Transparent,
                          and the mark is drawn SMALLER: Android crops to a circle on
                          most launchers, so artwork near the corners is cut off.
      * `splash.png`    — the mark on its own, shown while the JS bundle loads.
  */
  console.log('')
  console.log('Expo app icons:')
  // Opaque white behind the mark. The brand blue would fight every school's own
  // colour on a home screen full of other apps.
  out(join(MOBILE, 'icon.png'), await squareMark(1024, { ...WEB_PNG, flatten: '#FFFFFF' }))
  out(join(MOBILE, 'adaptive-icon.png'), await squareMark(1024, { ...WEB_PNG, padding: 0.28 }))
  out(join(MOBILE, 'splash.png'), await squareMark(512))

  // Verify: the icon crop must not have clipped ink at the edges, which is what
  // a stale GEOMETRY looks like in practice.
  const edge = await sharp(SRC).extract(GEOMETRY.mark).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { data, info } = edge
  const opaqueOnEdge = (() => {
    const { width: w, height: h, channels: c } = info
    let n = 0
    for (let x = 0; x < w; x += 1) {
      if (data[(0 * w + x) * c + 3] > 16) n += 1
      if (data[((h - 1) * w + x) * c + 3] > 16) n += 1
    }
    for (let y = 0; y < h; y += 1) {
      if (data[(y * w + 0) * c + 3] > 16) n += 1
      if (data[(y * w + (w - 1)) * c + 3] > 16) n += 1
    }
    return n
  })()

  console.log(`\nCrop check: ${opaqueOnEdge} opaque pixels on the mark's border.`)
  if (opaqueOnEdge > (info.width + info.height) * 0.5) {
    throw new Error(
      'generate-brand-assets: the mark crop is clipping artwork — GEOMETRY.mark is wrong for this source file',
    )
  }
  console.log('Done.\n')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
