-- ===========================================================================
-- 0257 — the accountant can read the message log
--
-- Spec: `12 Communication System/MESSAGE_LOG.md` → *Admin Communication Log View*
--
-- ## The discrepancy
--
-- MESSAGE_LOG.md: "School admins, **accountants**, and principals can view their
-- school's message history."
--
-- `school_management_read_message_log` admits `org:owner`, `org:principal` and
-- `org:admin`. The accountant is missing — and they are the person most likely to
-- need it. Every fee reminder in the log is theirs: a parent says they were never
-- told, and the accountant is the one who has to answer. Sending them to the
-- principal to read a delivery receipt for a fee notice is the wrong shape.
--
-- ## Why widening this policy is safe to do without widening others
--
-- The log holds message bodies, which for a fee reminder names a child and an
-- amount. The accountant already sees both — `fee_records` and
-- `student_fee_balance` are theirs by role. This grants no new category of
-- information; it grants the delivery history of information they hold already.
--
-- A teacher is still excluded, and deliberately: a teacher has no reason to read
-- what the office told a parent about money.
-- ===========================================================================

ALTER POLICY school_management_read_message_log
  ON public.message_log
  USING (
    school_id = public.current_school_uuid()
    AND public.get_user_role() = ANY (ARRAY[
      'org:owner',
      'org:principal',
      'org:admin',
      -- Added by `0257`. Every fee reminder in this log is the accountant's to
      -- answer for, and MESSAGE_LOG.md always said they could read it.
      'org:accountant'
    ])
  );

-- ---------------------------------------------------------------------------
-- Assert the policy admits the accountant.
--
-- ## Why this checks the definition and the pgTAP suite checks the behaviour
--
-- Two drafts of this block switched to `SET LOCAL ROLE authenticated` to read the
-- log as an accountant, which is the only way to observe a policy at all — a
-- migration runs as a role RLS does not apply to, so an unswitched count passes
-- whatever the policy says.
--
-- Both drafts left the role switched when the block ended, so the CLI's own
-- `INSERT INTO supabase_migrations.schema_migrations` then ran as `authenticated`
-- and failed with "permission denied for schema supabase_migrations". `RESET ROLE`
-- before the raise did not cure it.
--
-- Role-switching verification belongs in the pgTAP suites, which exist for this,
-- run under a harness built to switch identity, and are executed by CI against a
-- database built from nothing. The behavioural assertions are therefore in
-- `supabase/tests/rls/communications_test.sql`, where an accountant reading their
-- own school, not reading another, and a teacher reading neither are all
-- exercised for real.
--
-- What is left here is the one thing a migration can honestly check: that the
-- policy it just wrote says what it meant to say.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_qual TEXT;
BEGIN
  SELECT qual INTO v_qual
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'message_log'
    AND policyname = 'school_management_read_message_log';

  IF v_qual IS NULL THEN
    RAISE EXCEPTION '0257: the policy is gone, so the message log is unreadable';
  END IF;

  IF v_qual NOT LIKE '%org:accountant%' THEN
    RAISE EXCEPTION '0257: the policy does not admit org:accountant';
  END IF;

  -- The tenant clause must survive the rewrite. A policy that admits the
  -- accountant and forgets the school is far worse than the gap it closed.
  IF v_qual NOT LIKE '%current_school_uuid()%' THEN
    RAISE EXCEPTION '0257: the rewritten policy lost its tenant clause';
  END IF;

  -- And a teacher must not have crept in.
  IF v_qual LIKE '%org:teacher%' THEN
    RAISE EXCEPTION '0257: the policy now admits teachers';
  END IF;

  RAISE NOTICE '0257: policy admits the accountant, keeps its tenant clause, excludes teachers';
END;
$$;
