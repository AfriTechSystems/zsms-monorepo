-- ===========================================================================
-- 0223 — audit the tables that were missed
--
-- `0131` attached `audit_row_change()` by iterating a list, and the list was
-- written when that migration was. Everything created since has no trigger, and
-- nothing reminds anybody — the same standing trap `0149`'s status guard has,
-- which CLAUDE.md already records.
--
-- Found by a deliberate audit on 2026-10-06. Of fifteen tables that matter,
-- eight were audited and seven were not. Four of those seven are serious:
--
-- * **`school_payment_details`** — where the school's money is sent. Created two
--   days ago, by me, and the single most valuable row in this schema to tamper
--   with: change the account number and every fee payment goes to a stranger.
--   Nothing recorded who changed it.
-- * **`student_parent_links`** — who may see a child. The skill's own rule is
--   "every act that changes money, a child's record, or who can see what", and
--   this is the third one exactly.
-- * **`attendance_records`** — a child's record, and the thing that triggers a
--   message to their parent. A mark changed after the fact left no trace.
-- * **`announcements`** — what the school told people, and when.
--
-- ## What is deliberately NOT audited
--
-- * `ai_conversations` / `ai_messages` — the rows ARE the record. A row-change
--   trigger on them would duplicate every message into `audit_logs`, which is
--   both useless and a second copy of something a user is entitled to have kept
--   private from management.
-- * `teaching_resources` — a teacher's own drafts. Auditing every keystroke on
--   somebody's lesson plan is surveillance, not accountability, and nothing
--   financial or safeguarding-related turns on it.
--
-- Stating the exclusions matters as much as the additions: a list with no
-- reasoning becomes a list nobody revisits.
-- ===========================================================================

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    -- Where the money goes.
    'school_payment_details',
    -- Who may see a child.
    'student_parent_links',
    -- A child's record, and what their parent is told.
    'attendance_records',
    -- What the school said, and when.
    'announcements',
    -- Who is timetabled where. Changed quietly, it moves a teacher's workload.
    'timetable_slots'
  ]
  LOOP
    -- Skip a table that does not exist rather than failing the migration: this
    -- list will be edited again, and a typo should not block an unrelated fix.
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relkind = 'r'
    ) THEN
      RAISE NOTICE '0223: no such table %, skipping', t;
      CONTINUE;
    END IF;

    EXECUTE format(
      'DROP TRIGGER IF EXISTS audit_changes_on_%1$s ON public.%1$I', t);
    EXECUTE format(
      'CREATE TRIGGER audit_changes_on_%1$s
         AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
         FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()', t);

    RAISE NOTICE '0223: auditing %', t;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- Prove it by writing, not by reading the catalogue.
-- ---------------------------------------------------------------------------

/*
  `0173` attached an audit trigger and asserted it was ATTACHED. It was, and
  every write through it then failed — because the trigger assumed `school_id`
  was a UUID and on `schools` it is the business identifier.

  So: perform a real write on the most important of the newly-audited tables and
  fail if no audit row appears.
*/
DO $$
DECLARE
  v_school UUID;
  v_id     UUID;
  v_before INT;
  v_after  INT;
BEGIN
  SELECT s.id INTO v_school FROM public.schools s WHERE s.status = 'active' LIMIT 1;

  IF v_school IS NULL THEN
    RAISE NOTICE '0223: no active school to exercise against; skipping the write test';
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_before FROM public.audit_logs
  WHERE table_name = 'school_payment_details';

  INSERT INTO public.school_payment_details
    (school_id, method_kind, label, bank_name, account_name, account_number)
  VALUES (v_school, 'bank_account', '0223 probe', 'Zanaco', 'Probe', '000111222')
  RETURNING id INTO v_id;

  -- The change that matters: redirecting the account.
  UPDATE public.school_payment_details
  SET account_number = '999888777'
  WHERE id = v_id;

  DELETE FROM public.school_payment_details WHERE id = v_id;

  -- Counted AFTER all three writes. The first attempt counted before the delete
  -- and then asserted three rows, which failed on its own ordering rather than
  -- on anything wrong with the trigger.
  SELECT COUNT(*) INTO v_after FROM public.audit_logs
  WHERE table_name = 'school_payment_details';

  /*
    Three writes, three rows: insert, update, delete. Asserting ">= 2" rather than
    "= 3" would pass even if the UPDATE — the one that redirects the money — were
    not recorded.
  */
  IF v_after - v_before < 3 THEN
    RAISE EXCEPTION
      '0223: three writes to school_payment_details produced only % audit row(s)',
      v_after - v_before;
  END IF;

  RAISE NOTICE '0223: verified — an account redirect is recorded';
END;
$$;

DO $$
DECLARE v_missing TEXT;
BEGIN
  SELECT string_agg(t, ', ') INTO v_missing
  FROM unnest(ARRAY[
    'school_payment_details', 'student_parent_links', 'attendance_records',
    'announcements', 'timetable_slots'
  ]) AS t
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_trigger tr
    JOIN pg_class c ON c.oid = tr.tgrelid
    WHERE c.relname = t AND NOT tr.tgisinternal AND tr.tgname LIKE 'audit%'
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '0223: still unaudited: %', v_missing;
  END IF;
END;
$$;
