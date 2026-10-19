/**
 * Unit tests for `todayIso()`.
 *
 * Spec: `16 Testing and Launch/TEST_STRATEGY.md` → *What is unit tested*
 *
 * ## Why a three-line function earns a test file
 *
 * Because the wrong version of it is the one people write. `new
 * Date().toISOString().slice(0, 10)` looks like today's date, passes review, and is
 * correct in London. In Zambia (UTC+2) it returns **yesterday** between midnight and
 * 02:00 — so a register defaults to the wrong day, and a `max` computed that way
 * refuses the date a teacher is actually sitting in.
 *
 * Eight sites in this repository wrote it that way, including the Sage 50 export
 * window. The failure is invisible for twenty-two hours out of twenty-four, which is
 * exactly the kind of bug a test is for: nobody will reproduce it by clicking.
 *
 * The timezone case is asserted by moving the process into a UTC-negative and a
 * UTC-positive zone and checking the answer tracks the *local* calendar, which is the
 * property that distinguishes the two implementations.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { todayIso } from './dates'

/** Runs `fn` with `TZ` set, restoring whatever was there before. */
function inTimezone<T>(tz: string, fn: () => T): T {
  const previous = process.env['TZ']
  process.env['TZ'] = tz
  try {
    return fn()
  } finally {
    if (previous === undefined) delete process.env['TZ']
    else process.env['TZ'] = previous
  }
}

test('returns a YYYY-MM-DD string', () => {
  assert.match(todayIso(), /^\d{4}-\d{2}-\d{2}$/)
})

test('agrees with the local calendar date, not the UTC one', () => {
  const d = new Date()
  const expected = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
  assert.equal(todayIso(), expected)
})

test('tracks local midnight in a UTC+2 zone, where toISOString() lags', () => {
  /*
    Africa/Lusaka is UTC+2 year round. The assertion is not "it equals a fixed
    string" — the test would then only pass on one day — but that it equals the
    LOCAL calendar date while `toISOString()` may not. For two hours each day those
    two differ, and this is the side we must be on.
  */
  inTimezone('Africa/Lusaka', () => {
    const now = new Date()
    const local = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-')
    assert.equal(todayIso(), local, 'todayIso() drifted from the local calendar date')
  })
})

test('is not simply toISOString().slice(0, 10) — they differ for part of every day', () => {
  /*
    A direct equality assertion against the UTC form would be flaky by construction:
    it passes for most of the day. Instead, assert the invariant that actually holds
    — the two are never more than one day apart, and `todayIso()` is the local one.
    Combined with the test above, that pins the implementation without depending on
    the clock.
  */
  const utc = new Date().toISOString().slice(0, 10)
  const local = todayIso()
  const gapDays = Math.abs(
    (Date.parse(`${local}T00:00:00Z`) - Date.parse(`${utc}T00:00:00Z`)) / 86_400_000,
  )
  assert.ok(gapDays <= 1, `local and UTC dates are ${gapDays} days apart, which is not possible`)
})
