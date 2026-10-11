/**
 * Webhook signature verification.
 *
 * Spec: `05 Core Database and API Reference/WEBHOOKS.md`
 *
 * ## Why this is hand-written rather than `svix`
 *
 * WEBHOOKS.md's example imports the Svix SDK. The algorithm it implements is four lines
 * — HMAC-SHA256 over `id.timestamp.body`, base64, compared against one of the signatures
 * in the header — and writing it here instead of adding a dependency buys two things
 * that matter more than the convenience.
 *
 * It runs on the Edge runtime, because `crypto.subtle` is available there and Node's
 * `crypto` is not. And the same timing-safe comparison serves the seven payment gateways
 * in WEBHOOKS.md, none of which uses Svix — so one implementation covers all of them
 * rather than one SDK covering one.
 *
 * ## The comparison is constant-time, and that is not pedantry
 *
 * A `===` on a signature leaks, through timing, how many leading bytes were correct. An
 * attacker who can send unlimited requests — which is exactly what a public webhook
 * endpoint allows — can recover a valid signature byte by byte. The loop below always
 * examines every byte.
 *
 * ## Replay is a separate check
 *
 * A signature stays valid forever; it proves the body came from the sender, not that it
 * came recently. Without a timestamp window, a captured delivery can be replayed years
 * later. `webhook_events` (`0243`) catches a repeat of a delivery ZSMS has already seen,
 * and the window catches an old one it has not — the two cover different halves.
 */

/** Five minutes, which is Svix's own default and ample for a slow network. */
const TOLERANCE_SECONDS = 5 * 60

/** Compares two byte strings without leaking where they first differ. */
function timingSafeEqual(a: string, b: string): boolean {
  /*
    Lengths are compared first and the function returns early, which does leak the
    LENGTH. That is harmless: signature length is fixed and public, so an attacker
    learns nothing they could not read in the documentation.
  */
  if (a.length !== b.length) return false

  let diff = 0
  for (let i = 0; i < a.length; i += 1) {
    // Bitwise OR, never a branch — a short-circuit here would reintroduce the leak.
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

async function hmacBase64(secret: Uint8Array, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    secret as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
}

export interface VerifyResult {
  valid: boolean
  /** Why it failed, for the log. Never returned to the caller — see the route. */
  reason?: string
}

/**
 * Verifies a Svix-signed webhook, which is what Clerk sends.
 *
 * `rawBody` must be the body EXACTLY as received. Parsing and re-serialising changes
 * key order and whitespace, and the signature is over the bytes — this is the single
 * most common way a correct implementation fails.
 */
export async function verifySvixSignature(params: {
  rawBody: string
  signingSecret: string
  svixId: string | null
  svixTimestamp: string | null
  svixSignature: string | null
}): Promise<VerifyResult> {
  const { rawBody, signingSecret, svixId, svixTimestamp, svixSignature } = params

  if (!svixId || !svixTimestamp || !svixSignature) {
    return { valid: false, reason: 'missing svix headers' }
  }

  const timestamp = Number(svixTimestamp)
  if (!Number.isFinite(timestamp)) {
    return { valid: false, reason: 'unparseable timestamp' }
  }

  /*
    Absolute difference, so a timestamp in the FUTURE is refused too. A sender whose
    clock is an hour fast would otherwise hand an attacker an hour of replay window.
  */
  const age = Math.abs(Date.now() / 1000 - timestamp)
  if (age > TOLERANCE_SECONDS) {
    return { valid: false, reason: `timestamp outside tolerance (${Math.round(age)}s)` }
  }

  /*
    The secret is `whsec_<base64>`. The prefix is a label, not part of the key, and
    decoding without stripping it produces a signature that never matches — with no
    error to explain why.
  */
  const rawSecret = signingSecret.startsWith('whsec_')
    ? signingSecret.slice('whsec_'.length)
    : signingSecret

  let secretBytes: Uint8Array
  try {
    secretBytes = Uint8Array.from(atob(rawSecret), (c) => c.charCodeAt(0))
  } catch {
    return { valid: false, reason: 'signing secret is not valid base64' }
  }

  const expected = await hmacBase64(secretBytes, `${svixId}.${svixTimestamp}.${rawBody}`)

  /*
    The header carries SPACE-SEPARATED signatures, each `v1,<base64>`. More than one
    appears during a secret rotation, and accepting any of them is what lets a secret be
    rotated without dropping deliveries mid-flight.
  */
  for (const entry of svixSignature.split(' ')) {
    const [version, value] = entry.split(',')
    if (version !== 'v1' || !value) continue
    if (timingSafeEqual(expected, value)) return { valid: true }
  }

  return { valid: false, reason: 'no signature matched' }
}

/**
 * Verifies a plain HMAC-SHA256 hex signature, which is what most payment gateways send.
 *
 * Flutterwave, PawaPay, Airtel and MTN each sign the raw body with a shared secret and
 * send the hex digest in a header of their own naming. Written now because the handlers
 * are not: when a gateway account finally exists, the part that is easy to get subtly
 * wrong is already here and already constant-time.
 */
export async function verifyHmacHex(params: {
  rawBody: string
  secret: string
  signature: string | null
}): Promise<VerifyResult> {
  const { rawBody, secret, signature } = params
  if (!signature) return { valid: false, reason: 'missing signature header' }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  const expected = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  // Lowercased: some gateways send uppercase hex, and a case mismatch is not a forgery.
  return timingSafeEqual(expected, signature.toLowerCase())
    ? { valid: true }
    : { valid: false, reason: 'signature mismatch' }
}
