/**
 * Branded HTML wrapper for transactional email.
 *
 * Spec: `12 Communication System/TEMPLATES.md`, `01 Foundation Layer/DESIGN_SYSTEM.md`
 *
 * Until now email went out as bare text. That is fine for deliverability and
 * terrible for trust: a fee reminder with no school name, no mark, and no colour
 * is indistinguishable from a phishing attempt, and it is asking a parent for
 * money. This wraps the rendered template body in the school's own identity.
 *
 * ## Email HTML is not web HTML, and the differences drive every choice here
 *
 * - **No CSS custom properties.** Gmail, Outlook, and most clients strip
 *   `<style>` blocks or ignore `var()`. Every colour is inlined as a literal
 *   hex, resolved from `@zsms/design-tokens` at send time — which is exactly why
 *   the token package is dependency-free and returns plain strings.
 * - **Tables, not flexbox.** Outlook renders through Word's engine. A `div` with
 *   `display:flex` collapses; a table does not.
 * - **The logo is an absolute URL.** A relative path has no meaning in a mail
 *   client, and images are commonly blocked — so the mark carries `alt` text
 *   with the school's name, and the layout does not depend on it loading.
 * - **A plain-text alternative is always produced.** Multipart is a deliverability
 *   signal, and a parent on a feature phone may only ever see the text part.
 *
 * ## What it does not do
 *
 * No tracking pixel, no click wrapping. This product emails people about their
 * children's fees; adding surveillance to that would be a poor trade for an open
 * rate, and it would need a lawful basis under the ZDPA that we do not have.
 */

import { resolveTheme, type SchoolBrandingInput } from '@zsms/design-tokens'

export interface EmailBranding extends SchoolBrandingInput {
  /** Shown under the mark and in the footer. Falls back to "ZSMS". */
  schoolName?: string | null
}

export interface BrandedEmail {
  html: string
  text: string
}

/**
 * Absolute base for image URLs.
 *
 * Set `ZSMS_PUBLIC_URL` in the worker environment. Falling back to the
 * production host rather than to `localhost` is deliberate: an unset variable in
 * a Railway deployment should still send a working email, whereas a localhost
 * URL renders as a broken image in every inbox that receives it.
 */
function publicBase(): string {
  return (process.env['ZSMS_PUBLIC_URL'] ?? 'https://zsms.co.zm').replace(/\/$/, '')
}

/** Minimal HTML escaping. Template bodies carry school-authored text. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Wraps a rendered plain-text body in the school's branding.
 *
 * The body arrives as text from `notification_templates` — that is the existing
 * contract and it is not changed here. Paragraphs are split on blank lines so a
 * template written for SMS still reads correctly as email.
 */
export function renderBrandedEmail(
  body: string,
  branding: EmailBranding | null,
  options: { preheader?: string } = {},
): BrandedEmail {
  const theme = resolveTheme(branding)
  const name = branding?.schoolName?.trim() || 'ZSMS'
  const base = publicBase()

  // The school's mark where it has one, the ZSMS lockup otherwise. Absolute in
  // both cases — a stored R2 URL already is; the default needs the host added.
  const logo = theme.logoUrl ?? `${base}/brand/zsms-lockup.png`

  const anchor = theme.light.colors.anchor[700]
  const primary = theme.light.colors.primary[600]
  const surface = theme.light.surface.surface
  const page = theme.light.surface.background
  const text = theme.light.surface.text
  const muted = theme.light.surface.textMuted
  const border = theme.light.surface.border

  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:${text};">${escapeHtml(p).replace(/\n/g, '<br />')}</p>`,
    )
    .join('')

  // The preheader is the grey line an inbox shows after the subject. Left empty
  // it fills with whatever markup comes first, which is usually "View this email
  // in your browser" or, here, the alt text of a logo.
  const preheader = options.preheader ?? body.slice(0, 120).replace(/\s+/g, ' ').trim()

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light" />
<title>${escapeHtml(name)}</title>
</head>
<body style="margin:0;padding:0;background:${page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${page};">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:${surface};border:1px solid ${border};border-radius:12px;">
        <tr>
          <td align="center" style="padding:28px 24px 8px;">
            <img src="${escapeHtml(logo)}" alt="${escapeHtml(name)}" width="150" style="display:block;width:150px;max-width:60%;height:auto;border:0;" />
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:0 24px 20px;">
            <div style="font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;letter-spacing:0.02em;color:${anchor};text-transform:uppercase;">${escapeHtml(name)}</div>
          </td>
        </tr>
        <tr><td style="padding:0 24px;"><div style="height:1px;background:${border};line-height:1px;font-size:0;">&nbsp;</div></td></tr>
        <tr>
          <td style="padding:24px;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;">
            ${paragraphs}
          </td>
        </tr>
        <tr>
          <td style="padding:0 24px 28px;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;">
            <div style="height:1px;background:${border};line-height:1px;font-size:0;margin-bottom:16px;">&nbsp;</div>
            <p style="margin:0;font-size:12px;line-height:18px;color:${muted};">
              Sent by ${escapeHtml(name)} through ZSMS.
              This message relates to your child&rsquo;s school record &mdash; please do not reply to this address.
            </p>
          </td>
        </tr>
      </table>
      <p style="margin:16px 0 0;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;font-size:11px;color:${muted};">
        <span style="color:${primary};">ZSMS</span> &middot; AfriTech Systems Limited
      </p>
    </td>
  </tr>
</table>
</body>
</html>`

  return {
    html,
    // The text part is the body as it arrived, with the same footer the HTML
    // carries. A parent reading the text alternative should not get less
    // information than one reading the HTML.
    text: `${body.trim()}\n\n—\nSent by ${name} through ZSMS. Please do not reply to this address.`,
  }
}
