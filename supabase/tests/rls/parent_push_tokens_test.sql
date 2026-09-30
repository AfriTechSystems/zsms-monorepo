-- ===========================================================================
-- Parent push tokens — a person's phones, and who may know about them.
--
-- Spec: Official Documentation/10 Attendance/NOTIFICATIONS.md
--
-- Push is the free channel that makes per-absence alerts viable: `NOTIFICATIONS.md` keeps per-absence
-- WhatsApp off by default because every message spends the school's quota, so without push a parent's
-- only per-absence signal is remembering to open the portal.
--
-- WHAT THIS SUITE IS ACTUALLY DEFENDING
--
--   1. **A school must not learn which phones a family owns.** There is no school-side policy on this
--      table at all. A school reading it could infer which parents have the app — and therefore which
--      are worth expecting a reply from — which is not information the product should hand out about a
--      family.
--   2. **Two parents sharing one account both get alerts.** `NOTIFICATIONS.md` keyed the table on
--      `(parent_user_id, platform)`, which caps a family at one Android phone and silently drops the
--      second. `0157` keys it on the token instead, and the assertions below pin that.
--   3. **A handset passed to somebody else stops delivering the previous owner's alerts.**
--
-- Run: npm run db:test
-- ===========================================================================

BEGIN;

SET search_path TO public, extensions;

SELECT plan(18);

-- ---------------------------------------------------------------------------
-- Shape.
-- ---------------------------------------------------------------------------
/**
 * No `school_id`, and that is a design assertion rather than an observation.
 *
 * `0117` established that not one parent policy is school-scoped — a parent reads across every school
 * their children attend from one session. A push token belongs to a phone, so a school column would
 * make a parent with two children at two schools register the same handset twice, and would drag this
 * table into `0149`'s per-school write guard, where a lapsed school could stop a parent receiving
 * anything about their other child.
 */
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'parent_push_tokens'
       AND column_name = 'school_id'
  ),
  'the table is not school-scoped — a token belongs to a phone, not to a school'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
     WHERE c.relname = 'parent_push_tokens' AND t.tgname LIKE 'enforce_school_writable_%'
  ),
  '...so 0149''s write guard does not reach it, which is correct: one lapsed school must not silence '
  'a parent''s alerts about a child at another'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.parent_push_tokens', 'DELETE'),
  'and nobody may delete a token — a device going quiet stays answerable'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.parent_push_tokens', 'SELECT'),
  'nor may an anonymous caller read one'
);

SELECT ok(
  has_function_privilege('service_role', 'public.worker_parent_push_tokens(text[])', 'EXECUTE')
  AND NOT has_function_privilege('authenticated',
        'public.worker_parent_push_tokens(text[])', 'EXECUTE'),
  'the worker reads tokens through a worker_ function only — prohibition 1'
);

-- ---------------------------------------------------------------------------
-- A parent registers two phones.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub": "user_parent_grace", "role": "authenticated"}';

SELECT is(
  (SELECT platform FROM public.register_push_token('ExponentPushToken[mother-phone]', 'android')),
  'android',
  'a parent registers their phone'
);

/**
 * THE ASSERTION THE DOCUMENTED DDL WOULD HAVE FAILED.
 *
 * `UNIQUE (parent_user_id, platform)` would have replaced the row above, leaving one of two parents
 * sharing the account receiving nothing — and nothing would appear to have failed, which is the
 * hardest kind of fault to report.
 */
SELECT lives_ok(
  $$ SELECT public.register_push_token('ExponentPushToken[father-phone]', 'android') $$,
  'and a second Android phone on the same account registers alongside it, not over it'
);

SELECT is(
  (SELECT COUNT(*)::INT FROM public.parent_push_tokens WHERE is_active),
  2,
  'so both parents sharing one account are reachable'
);

SELECT is(
  (SELECT COUNT(*)::INT FROM public.worker_parent_push_tokens(ARRAY['user_parent_grace'])),
  2,
  '...and the worker is told about both'
);

-- Re-registering the same token is a refresh, not a duplicate.
SELECT is(
  (SELECT COUNT(*)::INT FROM (
     SELECT public.register_push_token('ExponentPushToken[mother-phone]', 'android')
   ) again),
  1,
  'registering a token already held refreshes it'
);

SELECT is(
  (SELECT COUNT(*)::INT FROM public.parent_push_tokens),
  2,
  '...and does not create a second row'
);

-- ---------------------------------------------------------------------------
-- Signing out on one device.
-- ---------------------------------------------------------------------------
SELECT ok(
  (SELECT public.retire_push_token('ExponentPushToken[father-phone]')),
  'signing out retires that device'
);

SELECT is(
  (SELECT COUNT(*)::INT FROM public.worker_parent_push_tokens(ARRAY['user_parent_grace'])),
  1,
  '...and the worker stops being told about it'
);

SELECT is(
  (SELECT retired_reason FROM public.parent_push_tokens
    WHERE push_token = 'ExponentPushToken[father-phone]'),
  'signed_out',
  'but the row remains, with why — "it stopped working in March" is a diagnosis, a missing row is not'
);

-- ---------------------------------------------------------------------------
-- A handset changing hands.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{"sub": "user_parent_john", "role": "authenticated"}';

/**
 * The mother's old phone is handed to another family member who signs in as themselves. The token is
 * the same — Expo issues it per installation, not per account — so without reassignment Expo would
 * keep delivering the previous owner's children's absences to that handset.
 */
SELECT lives_ok(
  $$ SELECT public.register_push_token('ExponentPushToken[mother-phone]', 'android') $$,
  'a handset signed into by somebody else re-registers'
);

SELECT is(
  (SELECT COUNT(*)::INT FROM public.worker_parent_push_tokens(ARRAY['user_parent_grace'])),
  0,
  '...and the previous owner stops receiving alerts on it'
);

SELECT is(
  (SELECT COUNT(*)::INT FROM public.worker_parent_push_tokens(ARRAY['user_parent_john'])),
  1,
  '...while the new owner starts'
);

/**
 * And one parent cannot see another's devices. Asserted from a session that has just written to the
 * table, which is the case where a missing policy would go unnoticed — the caller sees a row and
 * assumes the filter works.
 */
SELECT is(
  (SELECT COUNT(*)::INT FROM public.parent_push_tokens),
  1,
  'a parent sees only their own devices, never another family''s'
);

SELECT * FROM finish();
ROLLBACK;
