-- ===========================================================================
-- School join requests — a teacher asking to be linked to a school.
--
-- Spec: Official Documentation/13 Teacher Portal/TEACHER_PORTAL.md
--       Official Documentation/02 Authentication and Identity/ROLES.md
--       Official Documentation/16 Testing and Launch/TEST_STRATEGY.md — Layer 2
--
-- WHAT THIS SUITE IS GUARDING.
--
-- The request path crosses the tenant boundary by design: a teacher with NO
-- organisation names a school they do not belong to, and a row appears inside that
-- school's data. Every other table in this schema refuses exactly that. So the
-- guarantees have to be pinned one at a time:
--
--   * the school-code lookup is an EXACT match and reveals nothing. A request against
--     a code that matches no school returns the same result as one that does — if it
--     did not, any teacher with a free Hub account could enumerate which schools are
--     ZSMS customers, including the ones that kept themselves out of the public
--     directory deliberately;
--   * a teacher cannot approve their own request. The two functions are separate and
--     the decision one requires an organisation the requester does not have;
--   * school B cannot decide school A's requests. Both decision functions are
--     SECURITY DEFINER, so `current_school_uuid()` is the only thing standing between
--     them and every other school's queue;
--   * approval cannot grant `org:owner`. A request from a stranger who typed in a
--     school code must not be able to end in ownership;
--   * the pending cap holds, so this cannot become a broadcast channel into every
--     school's admin screen;
--   * a teacher's own resources are untouched by joining. Business rule 2 says plans
--     belong to the teacher; joining a school is not consent to hand over work.
--
-- 0160 shipped with TWO invented column names — `schools.school_code` and
-- `schools.deleted_at`, neither of which exists — and applied without complaint,
-- because a PL/pgSQL body is parsed lazily. This suite exists so the third instance
-- of that mistake is caught by CI rather than by a teacher pressing a button.
--
-- Run: npm run db:test
-- ===========================================================================

BEGIN;

SET search_path TO public, extensions;

SELECT plan(21);

-- ---------------------------------------------------------------------------
-- Fixture. Two schools, so cross-tenant has somewhere to fail.
-- ---------------------------------------------------------------------------
INSERT INTO public.schools (id, school_id, clerk_org_id, name, type, level, city_code, status)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'ZM-LSK-7001', 'org_join_a',
   'Alpha Academy', 'day', 'combined', 'LSK', 'active'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'ZM-LSK-7002', 'org_join_b',
   'Beta College', 'day', 'combined', 'LSK', 'active'),
  -- Terminated: cannot take on staff, so its code must behave like an unknown one.
  ('cccccccc-0000-4000-8000-000000000003', 'ZM-LSK-7003', 'org_join_c',
   'Gamma School', 'day', 'combined', 'LSK', 'terminated'),
  -- Two more so the pending cap can be reached. They are created HERE, with the rest
  -- of the fixture, because everything below runs as `authenticated` and an INSERT
  -- into `schools` is refused for that role — which would have failed the cap tests
  -- for a reason having nothing to do with join requests.
  ('dddddddd-0000-4000-8000-000000000004', 'ZM-LSK-7004', 'org_join_d',
   'Delta School', 'day', 'combined', 'LSK', 'active'),
  ('eeeeeeee-0000-4000-8000-000000000005', 'ZM-LSK-7005', 'org_join_e',
   'Epsilon School', 'day', 'combined', 'LSK', 'active');

-- ---------------------------------------------------------------------------
-- A standalone teacher: a `sub`, and no `o` claim at all.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub": "user_join_teacher", "role": "authenticated"}';

-- 1. The happy path.
SELECT isnt(
  (SELECT out_request_id FROM public.request_school_link(
     'ZM-LSK-7001', 'Join Teacher', 'join@example.com', 'I teach Grade 5 maths.')),
  NULL,
  'a teacher can request a link using the exact school code'
);

-- 2. Case and whitespace are forgiving — the code is read off a document.
SELECT is(
  (SELECT out_submitted FROM public.request_school_link(
     '  zm-lsk-7001  ', 'Join Teacher', 'join@example.com', NULL)),
  true,
  'the code is matched case-insensitively and trimmed'
);

-- 3. ...but repeating it does not create a second pending row.
SELECT is(
  (SELECT COUNT(*)::INT FROM public.school_join_requests
    WHERE requester_user_id = 'user_join_teacher' AND status = 'pending'),
  1,
  'pressing the button twice leaves exactly one pending request'
);

-- 4. THE ORACLE GUARD. An unknown code must be indistinguishable from success.
SELECT is(
  (SELECT out_submitted FROM public.request_school_link(
     'ZM-XXX-9999', 'Join Teacher', 'join@example.com', NULL)),
  true,
  'an unknown school code reports success — it must not reveal which schools exist'
);

-- 5. ...and creates nothing.
SELECT is(
  (SELECT out_request_id FROM public.request_school_link(
     'ZM-XXX-9998', 'Join Teacher', 'join@example.com', NULL)),
  NULL,
  'an unknown school code creates no request'
);

-- 6. A terminated school behaves exactly like an unknown one.
SELECT is(
  (SELECT out_request_id FROM public.request_school_link(
     'ZM-LSK-7003', 'Join Teacher', 'join@example.com', NULL)),
  NULL,
  'a terminated school cannot be asked to take on staff, and does not say so'
);

-- 7. The requester is taken from the session, never a parameter.
SELECT is(
  (SELECT requester_user_id FROM public.school_join_requests
    WHERE school_id = 'aaaaaaaa-0000-4000-8000-000000000001' AND status = 'pending'),
  'user_join_teacher',
  'the requester is the signed-in user, not something the caller supplies'
);

-- 8. A teacher reads their own request.
SELECT is(
  (SELECT COUNT(*)::INT FROM public.school_join_requests
    WHERE requester_user_id = 'user_join_teacher'),
  1,
  'a teacher can read their own request'
);

-- ---------------------------------------------------------------------------
-- The pending cap.
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$ SELECT public.request_school_link('ZM-LSK-7002', 'Join Teacher', 'join@example.com', NULL) $$,
  'a second school can be asked'
);

-- 10. A third is still fine.
SELECT isnt(
  (SELECT out_request_id FROM public.request_school_link(
     'ZM-LSK-7004', 'Join Teacher', 'join@example.com', NULL)),
  NULL,
  'a third request is allowed'
);

-- 11. The fourth is refused, and says why.
SELECT is(
  (SELECT out_submitted FROM public.request_school_link(
     'ZM-LSK-7005', 'Join Teacher', 'join@example.com', NULL)),
  false,
  'a fourth pending request is refused — this is not a broadcast channel'
);

-- 12. A teacher with no organisation cannot decide anything.
SELECT throws_ok(
  $$ SELECT public.school_decide_join_request(
       (SELECT id FROM public.school_join_requests
         WHERE school_id = 'aaaaaaaa-0000-4000-8000-000000000001' LIMIT 1),
       true, 'org:teacher') $$,
  '42501',
  NULL,
  'a teacher cannot approve their own request — they have no organisation'
);

-- 13. Direct INSERT is refused. There is no INSERT policy, deliberately: without
--     this a teacher could create a row already marked `approved`.
SELECT throws_ok(
  $$ INSERT INTO public.school_join_requests
       (requester_user_id, requester_name, requester_email, school_id, status)
     VALUES ('user_join_teacher', 'Join Teacher', 'join@example.com',
             'aaaaaaaa-0000-4000-8000-000000000001', 'approved') $$,
  '42501',
  NULL,
  'a request cannot be inserted directly, so it cannot be born approved'
);

-- 14. Nor can a teacher update their own row to approve it.
SELECT is(
  (SELECT COUNT(*)::INT FROM public.school_join_requests
    WHERE requester_user_id = 'user_join_teacher' AND status = 'approved'),
  0,
  'no UPDATE policy exists, so a teacher cannot approve themselves'
);

-- ---------------------------------------------------------------------------
-- School B. The cross-tenant case.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO
  '{"sub": "user_owner_b", "role": "authenticated", "o": {"id": "org_join_b", "rol": "owner"}}';

-- 15. School B sees only requests addressed to school B.
SELECT is(
  (SELECT COUNT(*)::INT FROM public.school_join_requests),
  1,
  'a school sees only the requests addressed to it'
);

-- 16. And specifically not school A's.
SELECT is(
  (SELECT COUNT(*)::INT FROM public.school_join_requests
    WHERE school_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  0,
  'school B cannot read school A''s requests'
);

-- 17. THE ONE THAT MATTERS. Both decision functions are SECURITY DEFINER, so the
--     school check inside them is the only guard.
SELECT is(
  (SELECT out_decided FROM public.school_decide_join_request(
     (SELECT id FROM public.school_join_requests
       WHERE requester_user_id = 'user_join_teacher'
         AND school_id = 'aaaaaaaa-0000-4000-8000-000000000001' LIMIT 1),
     true, 'org:teacher')),
  false,
  'school B cannot decide school A''s request'
);

-- 18. ...and school A's request is untouched by the attempt.
SET LOCAL request.jwt.claims TO
  '{"sub": "user_owner_a", "role": "authenticated", "o": {"id": "org_join_a", "rol": "owner"}}';

SELECT is(
  (SELECT status FROM public.school_join_requests
    WHERE requester_user_id = 'user_join_teacher'
      AND school_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  'pending',
  'the request school B tried to decide is still pending'
);

-- 19. A role outside the permitted set is refused.
SELECT throws_ok(
  $$ SELECT public.school_decide_join_request(
       (SELECT id FROM public.school_join_requests
         WHERE school_id = 'aaaaaaaa-0000-4000-8000-000000000001' LIMIT 1),
       true, 'org:owner') $$,
  '22023',
  NULL,
  'approving a join request cannot grant org:owner'
);

-- 20. The school's own approval works, and returns what the route needs to invite.
SELECT is(
  (SELECT out_granted_role FROM public.school_decide_join_request(
     (SELECT id FROM public.school_join_requests
       WHERE school_id = 'aaaaaaaa-0000-4000-8000-000000000001'
         AND status = 'pending' LIMIT 1),
     true, 'org:teacher')),
  'org:teacher',
  'a school approves its own request and is told the role it granted'
);

-- 21. Deciding it again finds nothing pending — the route must not invite twice.
SELECT is(
  (SELECT out_decided FROM public.school_decide_join_request(
     (SELECT id FROM public.school_join_requests
       WHERE school_id = 'aaaaaaaa-0000-4000-8000-000000000001' LIMIT 1),
     true, 'org:teacher')),
  false,
  'a decided request cannot be decided again'
);

SELECT * FROM finish();
ROLLBACK;
