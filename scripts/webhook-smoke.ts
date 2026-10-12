/**
 * Proves the webhook signature verification is correct.
 *
 * Run: npm run webhook:smoke
 *
 * ## Why this needs testing more than most things
 *
 * A signature check that is wrong in the ACCEPTING direction is a public endpoint
 * anybody can post to. It fails silently — everything works, deliveries are processed,
 * and the only symptom is that forged ones are processed too.
 *
 * Hand-written crypto with no test is the thing that goes wrong, so each case below is
 * a specific way this implementation could be wrong and is not:
 *
 *   - a correctly signed body is ACCEPTED (otherwise nothing works at all);
 *   - a tampered body is refused (the signature actually covers the content);
 *   - a wrong secret is refused (it is really keyed);
 *   - an old timestamp is refused (replay has a window);
 *   - a FUTURE timestamp is refused (a fast clock is not a free replay window);
 *   - rotation works — two signatures, one valid — so a secret can be changed
 *     without dropping deliveries mid-flight;
 *   - the `whsec_` prefix is stripped (decoding it as key material yields a
 *     signature that never matches, with nothing to explain why).
 */

import { verifySvixSignature, verifyHmacHex } from '../apps/web/lib/webhook-verify'

const checks: { name: string; pass: boolean; detail?: string }[] = []
function check(name: string, pass: boolean, detail?: string): void {
  checks.push({ name, pass, detail })
}

/** Signs a body the way Svix does, so the test exercises the real algorithm. */
async function sign(secret: string, id: string, timestamp: number, body: string) {
  const raw = secret.startsWith('whsec_') ? secret.slice(6) : secret
  const key = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)) as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`),
  )
  return btoa(String.fromCharCode(...new Uint8Array(mac)))
}

async function main(): Promise<void> {
  // A real-shaped secret: `whsec_` plus base64.
  const secret = 'whsec_' + btoa('a-test-signing-secret-of-decent-length')
  const body = JSON.stringify({ type: 'user.updated', data: { id: 'user_123' } })
  const id = 'msg_2abc'
  const now = Math.floor(Date.now() / 1000)

  const good = await sign(secret, id, now, body)

  check(
    'a correctly signed body is accepted',
    (
      await verifySvixSignature({
        rawBody: body,
        signingSecret: secret,
        svixId: id,
        svixTimestamp: String(now),
        svixSignature: `v1,${good}`,
      })
    ).valid,
  )

  const tampered = await verifySvixSignature({
    rawBody: JSON.stringify({ type: 'user.updated', data: { id: 'user_EVIL' } }),
    signingSecret: secret,
    svixId: id,
    svixTimestamp: String(now),
    svixSignature: `v1,${good}`,
  })
  check('a tampered body is refused', !tampered.valid, tampered.reason)

  const wrongSecret = await verifySvixSignature({
    rawBody: body,
    signingSecret: 'whsec_' + btoa('a-completely-different-secret-value'),
    svixId: id,
    svixTimestamp: String(now),
    svixSignature: `v1,${good}`,
  })
  check('a wrong secret is refused', !wrongSecret.valid, wrongSecret.reason)

  const old = now - 600
  const oldSig = await sign(secret, id, old, body)
  const replayed = await verifySvixSignature({
    rawBody: body,
    signingSecret: secret,
    svixId: id,
    svixTimestamp: String(old),
    svixSignature: `v1,${oldSig}`,
  })
  check('a ten-minute-old delivery is refused', !replayed.valid, replayed.reason)

  // A sender with a fast clock must not hand out a free replay window.
  const future = now + 600
  const futureSig = await sign(secret, id, future, body)
  const fromFuture = await verifySvixSignature({
    rawBody: body,
    signingSecret: secret,
    svixId: id,
    svixTimestamp: String(future),
    svixSignature: `v1,${futureSig}`,
  })
  check('a future-dated delivery is refused', !fromFuture.valid, fromFuture.reason)

  // Rotation: the old signature first, the valid one second.
  const rotation = await verifySvixSignature({
    rawBody: body,
    signingSecret: secret,
    svixId: id,
    svixTimestamp: String(now),
    svixSignature: `v1,${btoa('an-obsolete-signature')} v1,${good}`,
  })
  check('a valid signature among several is accepted', rotation.valid, rotation.reason)

  // The prefix must be stripped, or the key material is wrong and nothing matches.
  const noPrefix = await verifySvixSignature({
    rawBody: body,
    signingSecret: secret.slice(6),
    svixId: id,
    svixTimestamp: String(now),
    svixSignature: `v1,${good}`,
  })
  check('the whsec_ prefix is handled either way', noPrefix.valid, noPrefix.reason)

  const missing = await verifySvixSignature({
    rawBody: body,
    signingSecret: secret,
    svixId: null,
    svixTimestamp: String(now),
    svixSignature: `v1,${good}`,
  })
  check('a missing header is refused', !missing.valid, missing.reason)

  // The gateway path, which no handler uses yet and will.
  const gwSecret = 'gateway-shared-secret'
  const gwKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(gwSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const gwMac = await crypto.subtle.sign('HMAC', gwKey, new TextEncoder().encode(body))
  const gwHex = Array.from(new Uint8Array(gwMac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  check(
    'a gateway hex HMAC verifies',
    (await verifyHmacHex({ rawBody: body, secret: gwSecret, signature: gwHex })).valid,
  )
  check(
    'an uppercase hex signature still verifies',
    (
      await verifyHmacHex({
        rawBody: body,
        secret: gwSecret,
        signature: gwHex.toUpperCase(),
      })
    ).valid,
  )

  for (const c of checks) {
    console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`)
  }

  const failed = checks.filter((c) => !c.pass).length
  console.log('')
  if (failed > 0) {
    console.error(`${failed} check(s) failed. A webhook endpoint is public — do not ship this.`)
    process.exit(1)
  }
  console.log('Webhook verification is correct: signed accepted, everything else refused.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
