# ZSMS brand assets — drop the official logo files here

This folder holds **AfriTech's own ZSMS marks**, not any school's. School logos are
uploaded by the school and live in the Cloudflare R2 public bucket, referenced by
`public.school_branding.logo_url` and `icon_url` — never in the repository.

Files are served from `/brand/…`, so `zsms-logo.svg` is reachable at
`https://<host>/brand/zsms-logo.svg`.

## Expected files

| Filename | What it is | Used by |
|---|---|---|
| `zsms-logo.svg` | Full wordmark, horizontal lockup. Preferred format. | Marketing header, AfriTech admin dashboard, the default when a school has set no logo |
| `zsms-logo.png` | Same lockup, raster fallback. **Transparent background**, ≥ 600px wide. | PDF headers — pdf-lib embeds PNG/JPEG, not SVG |
| `zsms-icon.svg` | Square mark only, no wordmark. | Collapsed navigation, avatar slots |
| `zsms-icon.png` | Square mark, 512×512, transparent. | Favicon generation, PDF corner mark |

Only `zsms-logo.svg` is required to start. The rest can follow.

## What matters about the files

- **Transparent background.** The mark sits on white, on the navy header, and on
  paper. A baked-in white box shows on two of those three.
- **The PNGs are not optional if the logo should appear on PDFs.** `pdf-lib` draws
  raster images; it does not rasterise SVG. Receipts and report cards will simply
  omit the logo until a PNG exists.
- **The icon must be legible at 24px.** If the square mark is the full logo scaled
  down, it will not be. It should be a genuinely separate, simplified mark.
- Keep the filenames exactly as above — they are referenced by path, and a rename
  is a silent 404 rather than an error.

## Related

- `Official Documentation/01 Foundation Layer/DESIGN_SYSTEM.md` — the palette derived
  from this logo, and the per-school theming rules
- `apps/web/components/brand/school-logo.tsx` — the renderer, including the
  initials fallback used when no logo is available
