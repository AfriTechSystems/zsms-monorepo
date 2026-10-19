-- ===========================================================================
-- The anon execute boundary — the layer in front of every policy this suite set
-- otherwise covers.
--
-- Spec: migration `0272`
--       Official Documentation/01 Foundation Layer/RLS.md
--
-- Every other suite here asserts an RLS policy. This one asserts a GRANT, because
-- Postgres checks EXECUTE **before** RLS is consulted and a `SECURITY DEFINER`
-- function never consults a policy at all. `0272` found 67 DEFINER functions in
-- `public` that `anon` could execute over PostgREST, among them
-- `worker_parent_push_tokens()` — a function written to bypass RLS for a worker
-- holding the service role key, and therefore carrying no tenant clause and no role
-- check to refuse anybody with.
--
-- `parent_push_tokens` already had a 22-assertion suite and it passed throughout. It
-- asserted the table's policies. The exposure was one layer in front of them.
--
-- There is no fixture here and nothing is inserted. The subject is the catalogue.
--
-- ## Why this is an assertion and not a list
--
-- The gap produced no symptom: no error, no failed test, no log line. A hand-written
-- list of what is closed would go stale the first time somebody adds a function and
-- grants it broadly, which is exactly how the 67 accumulated. So `0272` ships the
-- specification as `anon_executable_definer_functions()` and this suite asserts it
-- returns nothing — the same answer `0270` reached for the status-guard catalogue, and
-- for the same reason.
-- ===========================================================================

BEGIN;

SET search_path TO public, extensions;

SELECT plan(12);

-- ---------------------------------------------------------------------------
-- The invariant itself.
-- ---------------------------------------------------------------------------

SELECT is(
  (SELECT count(*)::INT FROM public.anon_executable_definer_functions()),
  0,
  'no SECURITY DEFINER function in public is executable by anon, bar the public directory'
);

SELECT is(
  (SELECT string_agg(out_function_name, ', ' ORDER BY out_function_name)
     FROM public.anon_executable_definer_functions()),
  NULL,
  'and if one is, this names it'
);

-- ---------------------------------------------------------------------------
-- The three that must stay reachable. `anon` can read no table, so these functions
-- ARE the public disclosure boundary — closing one does not harden anything, it
-- breaks the school directory and every branded sign-in page.
-- ---------------------------------------------------------------------------

SELECT ok(
  (SELECT has_function_privilege('anon', p.oid, 'EXECUTE')
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'search_schools'),
  'anon may still search the public school directory'
);

SELECT ok(
  (SELECT has_function_privilege('anon', p.oid, 'EXECUTE')
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'school_public_profile'),
  'anon may still read a published school profile'
);

SELECT ok(
  (SELECT has_function_privilege('anon', p.oid, 'EXECUTE')
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'school_branding_by_slug'),
  'anon may still resolve a school theme for a branded sign-in page'
);

-- ---------------------------------------------------------------------------
-- `worker_*` is a stronger rule than the one above: the service role bypasses grants
-- entirely, so no user-facing role has any reason to hold EXECUTE. Declarative, so a
-- worker function written next year is covered without editing this file.
-- ---------------------------------------------------------------------------

SELECT is(
  (SELECT count(*)::INT
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname LIKE 'worker=_%' ESCAPE '='
      AND (has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  0,
  'no worker_* function is reachable with an anon or a user token'
);

-- Named individually because this is the one with a victim: it returns parents'
-- device push tokens for any user ids the caller cares to guess.
SELECT ok(
  NOT (SELECT has_function_privilege('anon', p.oid, 'EXECUTE')
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'worker_parent_push_tokens'),
  'anon cannot harvest parent push tokens'
);

SELECT ok(
  NOT (SELECT has_function_privilege('authenticated', p.oid, 'EXECUTE')
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'worker_parent_push_tokens'),
  'nor can a signed-in user — one parent must not read every other parent''s tokens'
);

-- ---------------------------------------------------------------------------
-- Capability preserved. "anon cannot" is the easy half of `0272`; these two are the
-- half that would have made it a silent outage. The privileges came from two places
-- — an explicit grant and Postgres's PUBLIC default — so revoking PUBLIC without
-- granting `authenticated` first would have removed the capability with the exposure.
-- ---------------------------------------------------------------------------

SELECT ok(
  (SELECT has_function_privilege('authenticated', p.oid, 'EXECUTE')
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'my_children'),
  'a signed-in parent can still reach their own children'
);

SELECT ok(
  (SELECT has_function_privilege('authenticated', p.oid, 'EXECUTE')
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'verify_payment'),
  'the office can still verify a payment'
);

-- ---------------------------------------------------------------------------
-- The two premises the whole boundary rests on.
-- ---------------------------------------------------------------------------

-- If `anon` could read even one table directly, the three directory functions would
-- stop being the disclosure boundary and this suite would be measuring the wrong
-- thing. Asserted rather than assumed.
SELECT is(
  (SELECT count(*)::INT
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'v', 'm')
      AND has_table_privilege('anon', c.oid, 'SELECT')),
  0,
  'anon can SELECT no relation in public, so the directory functions are the whole boundary'
);

-- A DEFINER function with a mutable search_path is hijackable by anybody who can
-- create an object in a schema it resolves through. The discipline is currently
-- perfect — every one of them pins it — which makes this cheap to keep.
SELECT is(
  (SELECT count(*)::INT
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND NOT EXISTS (
        SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}')) cfg
         WHERE cfg LIKE 'search\_path=%'
      )),
  0,
  'every SECURITY DEFINER function in public pins its search_path'
);

SELECT * FROM finish();
ROLLBACK;
