/**
 * Unit tests for webhook signature verification.
 *
 * Spec: `16 Testing and Launch/TEST_STRATEGY.md` → *What is unit tested*
 *       `16 Testing and Launch/SECURITY_AUDIT.md` → *3.4 Clerk Webhook Svix Verification*
 *
 * ## Why this file is the first unit test in the repository
 *
 * TEST_STRATEGY.md describes three layers: unit, RLS integration, and Playwright E2E.
 * Only the middle one existed — 38 pgTAP suites, 892 assertions, run by CI against a
 * database built from nothing. That is the right layer to have built first, because it
 * guards tenant isolation.
 *
 * This is the highest-value thing the other layers were missing. Signature verification
 * is **pure, security-critical logic with no database**: nothing in SQL can test it, and
 * the failure mode is silent — a verifier that accepts anything looks identical to one
 * that works until somebody posts a forged payload. Every test below is a way that has
 * actually happened to somebody.
 *
 * ## No new dependency
 *
 * `node:test` ships with Node, so this needed no framework. Run with
 * `npm run test:unit`, which uses `tsx` as the loader the repo already relies on.
 */

import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { describe, it } from 'node:test'

import { verifyHmacHex, verifySvixSignature } from './webhook-verify'

// Real base64 after the prefix: the verifier decodes it, and `_` is not base64.
const SECRET = 'whsec_MfKQ9r8sTuVwXyZ0123456789abcdefghijklmA='
const BODY = '{"type":"user.updated","data":{"id":"user_abc"}}'
const ID = 'msg_2abc'

/** Exactly what Svix does: HMAC-SHA256 over `id.timestamp.body`, base64. */
function sign(id: string, timestamp: number, body: string, secret = SECRET): string {
  /*
    The `whsec_` prefix is a LABEL and the rest is base64 — decoding it is what the
    verifier does, so the test has to do the same or every signature mismatches for a
    reason that looks like a broken verifier.
  */
  const key = secret.startsWith('whsec_')
    ? Buffer.from(secret.slice('whsec_'.length), 'base64')
    : Buffer.from(secret)
  return createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')
}

function now(): number {
  return Math.floor(Date.now() / 1000)
}

describe('verifySvixSignature', () => {
  it('accepts a correctly signed, current delivery', async () => {
    const ts = now()
    const result = await verifySvixSignature({
      signingSecret: SECRET,
      rawBody: BODY,
      svixId: ID,
      svixTimestamp: String(ts),
      svixSignature: `v1,${sign(ID, ts, BODY)}`,
    })
    assert.equal(result.valid, true, result.valid ? '' : `rejected: ${result.reason}`)
  })

  it('rejects a body that changed after signing', async () => {
    /*
      The whole point of a signature. If this passes, an attacker can take a real
      delivery and rewrite which user it concerns.
    */
    const ts = now()
    const result = await verifySvixSignature({
      signingSecret: SECRET,
      rawBody: '{"type":"user.deleted","data":{"id":"user_victim"}}',
      svixId: ID,
      svixTimestamp: String(ts),
      svixSignature: `v1,${sign(ID, ts, BODY)}`,
    })
    assert.equal(result.valid, false)
  })

  it('rejects a signature made with a different secret', async () => {
    const ts = now()
    const result = await verifySvixSignature({
      signingSecret: SECRET,
      rawBody: BODY,
      svixId: ID,
      svixTimestamp: String(ts),
      svixSignature: `v1,${sign(ID, ts, BODY, 'whsec_WlpaWllZWVhYWFdXV1ZWVlVVVVRUVFM=')}`,
    })
    assert.equal(result.valid, false)
  })

  it('rejects a replay from outside the tolerance window', async () => {
    /*
      A captured delivery stays validly signed forever. Without the timestamp window,
      replaying one from last year re-applies whatever it said — which for a Clerk
      `user.deleted` is somebody's account.
    */
    const old = now() - 60 * 60
    const result = await verifySvixSignature({
      signingSecret: SECRET,
      rawBody: BODY,
      svixId: ID,
      svixTimestamp: String(old),
      svixSignature: `v1,${sign(ID, old, BODY)}`,
    })
    assert.equal(result.valid, false)
    assert.match(result.reason ?? '', /tolerance/)
  })

  it('rejects a timestamp in the future, not just the past', async () => {
    /*
      Absolute difference matters. A sender with a skewed clock is a configuration
      problem; an attacker choosing a far-future timestamp to buy a replay window is
      not, and a one-sided check would admit them.
    */
    const future = now() + 60 * 60
    const result = await verifySvixSignature({
      signingSecret: SECRET,
      rawBody: BODY,
      svixId: ID,
      svixTimestamp: String(future),
      svixSignature: `v1,${sign(ID, future, BODY)}`,
    })
    assert.equal(result.valid, false)
  })

  it('rejects an unparseable timestamp rather than treating it as zero', async () => {
    /*
      `Number('')` is 0 and `Number('abc')` is NaN. Either coerced into a comparison
      would make an absent timestamp look like 1970 — rejected by luck rather than by
      the check, and a different coercion elsewhere would flip it to accepted.
    */
    const result = await verifySvixSignature({
      signingSecret: SECRET,
      rawBody: BODY,
      svixId: ID,
      svixTimestamp: 'not-a-number',
      svixSignature: `v1,${sign(ID, now(), BODY)}`,
    })
    assert.equal(result.valid, false)
    assert.match(result.reason ?? '', /timestamp/)
  })

  it('accepts when the correct signature is one of several', async () => {
    /*
      Svix sends more than one signature during a secret rotation, space-separated.
      A verifier that checked only the first would reject every delivery for the
      duration of a rotation — and the symptom is "webhooks stopped working" with no
      error anywhere.
    */
    const ts = now()
    const header = [
      `v1,${sign(ID, ts, BODY, 'whsec_QUJDREVGR0hJSktMTU5PUFFSU1RVVld=')}`,
      `v1,${sign(ID, ts, BODY)}`,
    ].join(' ')

    const result = await verifySvixSignature({
      signingSecret: SECRET,
      rawBody: BODY,
      svixId: ID,
      svixTimestamp: String(ts),
      svixSignature: header,
    })
    assert.equal(result.valid, true, result.valid ? '' : `rejected: ${result.reason}`)
  })

  it('ignores signature entries of an unknown version', async () => {
    // A `v2,` entry must not be treated as a v1 candidate.
    const ts = now()
    const result = await verifySvixSignature({
      signingSecret: SECRET,
      rawBody: BODY,
      svixId: ID,
      svixTimestamp: String(ts),
      svixSignature: `v2,${sign(ID, ts, BODY)}`,
    })
    assert.equal(result.valid, false)
  })

  it('rejects an empty signature header', async () => {
    const ts = now()
    const result = await verifySvixSignature({
      signingSecret: SECRET,
      rawBody: BODY,
      svixId: ID,
      svixTimestamp: String(ts),
      svixSignature: '',
    })
    assert.equal(result.valid, false)
  })
})

describe('verifyHmacHex', () => {
  const hex = (body: string, secret = SECRET): string =>
    createHmac('sha256', secret).update(body).digest('hex')

  it('accepts a correct hex signature', async () => {
    const result = await verifyHmacHex({
      secret: SECRET,
      rawBody: BODY,
      signature: hex(BODY),
    })
    assert.equal(result.valid, true, result.valid ? '' : `rejected: ${result.reason}`)
  })

  it('rejects a tampered body', async () => {
    const result = await verifyHmacHex({
      secret: SECRET,
      rawBody: '{"amount":999999}',
      signature: hex(BODY),
    })
    assert.equal(result.valid, false)
  })

  it('rejects a truncated signature', async () => {
    /*
      A length mismatch must fail before any comparison. Comparing a short string
      against a long one by prefix would let an attacker brute-force one character at
      a time — which is the attack constant-time comparison exists to stop.
    */
    const result = await verifyHmacHex({
      secret: SECRET,
      rawBody: BODY,
      signature: hex(BODY).slice(0, 16),
    })
    assert.equal(result.valid, false)
  })

  it('rejects an empty signature', async () => {
    const result = await verifyHmacHex({ secret: SECRET, rawBody: BODY, signature: '' })
    assert.equal(result.valid, false)
  })
})
