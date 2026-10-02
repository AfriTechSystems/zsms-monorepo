/**
 * The origin a BROWSER can actually reach.
 *
 * ## The bug this exists to prevent
 *
 * Reported from the running application on 2026-10-02: every staff invitation email
 * contained a link to `http://0.0.0.0:3000/sign-up`, which no browser can resolve. The
 * teacher saw "This site can't be reached" and had to hand-edit the URL.
 *
 * The cause is a collision between two correct decisions. `npm run dev` binds
 * `-H 0.0.0.0` deliberately, so a phone on the LAN can reach the dev server. And the
 * invitation route derived its redirect from `request.nextUrl.origin`, reasoning that the
 * request already knows where it came from — which is true of a request and **false of
 * `nextUrl`**: that reflects the address the server is BOUND to, not the one the client
 * typed. `0.0.0.0` means "every interface" to a listener and "nowhere" to a browser.
 *
 * ## The `Host` header is the client's own answer
 *
 * It carries exactly what the browser put in the address bar — `localhost:3000`, a LAN
 * address, or `zsms.co.zm` — so a link built from it is reachable by definition from the
 * machine that asked.
 *
 * `x-forwarded-host` comes first because Vercel and Cloudflare terminate TLS and rewrite
 * `Host` to an internal name; the forwarded header is the public one. Both are
 * client-supplied and therefore spoofable, which matters here: a forged `Host` on an
 * invitation request would send the invitation link to an attacker's domain. That is why
 * `PUBLIC_APP_URL` wins when it is set — production pins the value rather than trusting a
 * header, and only development falls back to inference.
 */

/** Never usable in a link, whatever a header says. */
const UNREACHABLE = new Set(['0.0.0.0', '::', '[::]'])

export function publicOrigin(request: Request): string {
  /*
    Configuration beats inference wherever it exists.

    In production this should be set, and then no header can redirect an invitation
    anywhere else. Inference is the development convenience, not the security model.
  */
  const configured = process.env['PUBLIC_APP_URL'] ?? process.env['NEXT_PUBLIC_APP_URL']
  if (configured) return configured.replace(/\/+$/, '')

  const headers = request.headers
  // A proxy may send a list; the first entry is the original client's.
  const forwardedHost = headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const host = forwardedHost || headers.get('host') || ''
  const hostname = host.split(':')[0] ?? ''

  if (!host || UNREACHABLE.has(hostname)) {
    /*
      Fall back to the request URL, and if that is unreachable too, to localhost.

      `0.0.0.0` reaching here means the request itself arrived with no usable Host, which
      is close to impossible from a browser. Returning something a developer can click
      beats returning a link that silently fails in an email nobody can retract.
    */
    try {
      const fromUrl = new URL(request.url)
      if (!UNREACHABLE.has(fromUrl.hostname)) return fromUrl.origin
      return `http://localhost:${fromUrl.port || '3000'}`
    } catch {
      return 'http://localhost:3000'
    }
  }

  const forwardedProto = headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  // A bare hostname with no dot is a development machine; everything else is assumed
  // to be served over TLS, which is true of every host this will ever run on.
  const proto = forwardedProto || (hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname) ? 'http' : 'https')

  return `${proto}://${host}`
}
