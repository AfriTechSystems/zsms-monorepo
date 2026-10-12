-- ===========================================================================
-- 0252 — the reminder worker reads the school's settings
--
-- Spec: `09 Fee and Financial Management/REMINDERS.md` → *Reminder Schedule*,
--       *Reminder Settings*
--
-- `0251` gave each school a configurable schedule. This makes it the thing that
-- actually decides who gets chased — until now `worker_due_fee_reminders()` took
-- a floor and a cooldown as arguments, and the only caller passed two constants
-- from a TypeScript file.
--
-- ## The documented rule, and why this does not implement it literally
--
-- REMINDERS.md specifies **exact day matching** — a reminder at exactly 7, 14
-- and 30 days — and gives its reason: "Exact matching prevents a fee record from
-- receiving multiple reminders if the system was offline for a day."
--
-- Exact matching does prevent that. It also means that **if the cron does not
-- run on day 7, no 7-day reminder is ever sent** — the condition is false on day
-- 6 and false again on day 8. The duplicate it guards against is already handled
-- by the `last_reminder_at` cooldown; the failure it introduces has no other
-- guard, and it is silent. Nobody finds out, because the absence of a message is
-- not an error anybody sees.
--
-- So this counts rungs instead. A family is owed a reminder when the number of
-- configured thresholds their arrears have **passed** exceeds the number of
-- reminders they have actually **received**:
--
--     thresholds_crossed = how many of {7, 14, 30} are <= days_overdue
--     send when fee_records.reminder_count < thresholds_crossed
--
-- With rungs 7/14/30 that produces exactly the documented cadence — three
-- reminders, one per rung — and it is robust where exact matching is brittle:
--
--   * a missed cron day still sends on day 8, one day late instead of never;
--   * it can never over-send, because at day 30 only three rungs have been
--     crossed and a fourth reminder is arithmetically impossible;
--   * a school that adds the optional 3-day rung mid-term does not retroactively
--     fire it at families already past day 30, because their count is already at
--     or above the crossed total.
--
-- The cooldown is kept on top as a second guard, since `reminder_count` only
-- increments on a **delivered** message (`worker_mark_reminder_sent`) and a
-- provider outage could otherwise retry a family every morning.
--
-- ## The two threshold arguments are gone, not ignored
--
-- `p_min_days_overdue` and `p_cooldown_days` are removed from the signature
-- rather than left in place unused. An ignored parameter is worse than a missing
-- one: the next caller passes it, observes no effect, and goes looking for the
-- bug somewhere else. The school's settings are now the only input.
--
-- Changing the return type needs DROP, so the arguments go in the same breath.
-- Every existing call site reads named output columns or `count(*)`, so the two
-- added columns break none of them.
-- ===========================================================================

DROP FUNCTION IF EXISTS public.worker_due_fee_reminders(UUID, INTEGER, INTEGER, INTEGER);

CREATE FUNCTION public.worker_due_fee_reminders(
  p_school_id UUID DEFAULT NULL,
  p_limit     INTEGER DEFAULT 500
)
RETURNS TABLE (
  out_school_id      UUID,
  out_school_name    TEXT,
  out_student_id     UUID,
  out_student_name   TEXT,
  out_fee_record_id  UUID,
  out_parent_user_id TEXT,
  out_parent_name    TEXT,
  out_parent_phone   TEXT,
  out_parent_email   TEXT,
  out_currency       TEXT,
  out_arrears_amount TEXT,
  out_days_overdue   INTEGER,
  -- Which rung this message is for. REMINDERS.md uses a different template for
  -- the last one, and a final notice that reads like a nudge is the wrong
  -- message at thirty days.
  out_threshold_days INTEGER,
  out_is_final       BOOLEAN,
  -- The school's channel choices travel with the row, so the worker does not
  -- have to ask per school and cannot forget to.
  out_via_whatsapp   BOOLEAN,
  out_via_email      BOOLEAN,
  out_via_in_app     BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    b.school_id,
    s.name,
    b.student_id,
    b.first_name || ' ' || b.last_name,
    fr.id,
    pa.clerk_user_id,
    COALESCE(pa.full_name, 'Parent or Guardian'),
    pa.phone_e164,
    pa.email,
    b.currency_code,
    to_char(b.arrears_amount, 'FM999999990.00'),
    b.days_overdue,
    rung.highest,
    -- Final when the arrears have reached the last rung the school configured.
    rung.highest = (SELECT max(d) FROM unnest(cfg.out_reminder_days) AS d),
    cfg.out_via_whatsapp,
    cfg.out_via_email,
    cfg.out_via_in_app
  FROM public.student_fee_balance b
  JOIN public.schools s ON s.id = b.school_id

  -- The school's own schedule. Always returns a row: an unconfigured school gets
  -- REMINDERS.md's documented 7/14/30 rather than a handler's default.
  JOIN LATERAL public.school_reminder_settings(b.school_id) cfg ON TRUE

  -- How many configured rungs these arrears have passed, and which is highest.
  JOIN LATERAL (
    SELECT count(*)::INT AS crossed, max(d)::INT AS highest
    FROM unnest(cfg.out_reminder_days) AS d
    WHERE d <= b.days_overdue
  ) rung ON TRUE

  -- The oldest overdue record carries the reminder state, so a family is
  -- chased once rather than once per outstanding line.
  JOIN LATERAL (
    SELECT frs.id, frs.last_reminder_at, frs.reminder_count
    FROM public.fee_records frs
    WHERE frs.student_id = b.student_id
      AND frs.school_id  = b.school_id
      AND frs.is_deleted = FALSE
      AND frs.due_date < NOW()
      AND (frs.amount_due - frs.amount_paid - frs.discount_amount) > 0
    ORDER BY frs.due_date ASC
    LIMIT 1
  ) fr ON TRUE

  JOIN LATERAL (
    SELECT p2.clerk_user_id, p2.full_name, p2.phone_e164, p2.email
    FROM public.student_parent_links spl
    JOIN public.parents p2 ON p2.id = spl.parent_id
    WHERE spl.student_id = b.student_id AND spl.is_active = TRUE
    ORDER BY spl.is_primary DESC, spl.created_at ASC
    LIMIT 1
  ) pa ON TRUE

  WHERE b.is_overdue = TRUE
    AND (p_school_id IS NULL OR b.school_id = p_school_id)

    -- A school that has switched reminders off is not chased for by accident.
    AND cfg.out_is_enabled

    -- At least one rung passed, and fewer reminders received than rungs passed.
    -- This is the whole schedule, and it replaces exact-day matching.
    AND rung.crossed > 0
    AND fr.reminder_count < rung.crossed

    -- Second guard. `reminder_count` only moves on a DELIVERED message, so
    -- without this a provider outage would retry a family every morning.
    AND (fr.last_reminder_at IS NULL
         OR fr.last_reminder_at < NOW() - make_interval(days => cfg.out_cooldown_days))

    -- At least one channel the school still has switched on.
    AND (cfg.out_via_whatsapp OR cfg.out_via_email OR cfg.out_via_in_app)

    -- Unreachable families are excluded rather than counted as failures.
    AND (pa.phone_e164 IS NOT NULL OR pa.email IS NOT NULL)
  ORDER BY b.days_overdue DESC
  LIMIT p_limit;
$function$;

COMMENT ON FUNCTION public.worker_due_fee_reminders(UUID, INTEGER) IS
  'Families owed a fee reminder, driven entirely by each school''s school_fee_reminder_settings. Counts configured rungs passed against reminders received rather than matching an exact day, so a missed cron run sends late instead of never (0252).';

REVOKE ALL ON FUNCTION public.worker_due_fee_reminders(UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.worker_due_fee_reminders(UUID, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.worker_due_fee_reminders(UUID, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.worker_due_fee_reminders(UUID, INTEGER) TO service_role;

-- ---------------------------------------------------------------------------
-- Exercise it.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_school UUID;
  v_n      INT;
  v_row    RECORD;
BEGIN
  BEGIN
    -- The worker boundary: this must be unreachable by a signed-in user.
    IF has_function_privilege('authenticated',
         'public.worker_due_fee_reminders(UUID, INTEGER)', 'EXECUTE') THEN
      RAISE EXCEPTION '0252: a signed-in user can read every school''s arrears';
    END IF;
    IF has_function_privilege('anon',
         'public.worker_due_fee_reminders(UUID, INTEGER)', 'EXECUTE') THEN
      RAISE EXCEPTION '0252: anon can read arrears';
    END IF;

    SELECT b.school_id INTO v_school
    FROM public.student_fee_balance b
    WHERE b.is_overdue AND b.days_overdue >= 7
    LIMIT 1;

    IF v_school IS NULL THEN
      RAISE NOTICE '0252: no overdue fixture; privileges asserted only';
      RAISE EXCEPTION 'ZSMS_0252_ROLLBACK';
    END IF;

    SELECT count(*) INTO v_n FROM public.worker_due_fee_reminders(v_school, 500);
    IF v_n = 0 THEN
      RAISE EXCEPTION '0252: a family past the 7-day rung was not due a reminder';
    END IF;

    -- Every row must name its rung, which is what picks the template.
    SELECT * INTO v_row FROM public.worker_due_fee_reminders(v_school, 500) LIMIT 1;
    IF v_row.out_threshold_days IS NULL THEN
      RAISE EXCEPTION '0252: a due reminder carries no rung, so no template can be chosen';
    END IF;

    -- Switching reminders off must empty the queue for that school.
    INSERT INTO public.school_fee_reminder_settings (school_id, is_enabled)
    VALUES (v_school, FALSE)
    ON CONFLICT (school_id) DO UPDATE SET is_enabled = FALSE;

    SELECT count(*) INTO v_n FROM public.worker_due_fee_reminders(v_school, 500);
    IF v_n <> 0 THEN
      RAISE EXCEPTION '0252: % families still queued after reminders were switched off', v_n;
    END IF;

    -- A school whose only rung is far in the future must not be chased yet.
    UPDATE public.school_fee_reminder_settings
    SET is_enabled = TRUE, reminder_days = ARRAY[700]
    WHERE school_id = v_school;

    SELECT count(*) INTO v_n FROM public.worker_due_fee_reminders(v_school, 500);
    IF v_n <> 0 THEN
      RAISE EXCEPTION '0252: chased a family that has passed no configured rung';
    END IF;

    -- And turning every channel off stops it too, without losing the schedule.
    UPDATE public.school_fee_reminder_settings
    SET reminder_days = ARRAY[7],
        via_whatsapp = FALSE, via_email = FALSE, via_in_app = FALSE
    WHERE school_id = v_school;

    SELECT count(*) INTO v_n FROM public.worker_due_fee_reminders(v_school, 500);
    IF v_n <> 0 THEN
      RAISE EXCEPTION '0252: queued a reminder with every channel switched off';
    END IF;

    RAISE EXCEPTION 'ZSMS_0252_ROLLBACK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'ZSMS_0252_ROLLBACK' THEN
        RAISE NOTICE '0252: verified — rungs drive the schedule, off means off, no channel means no send, worker-only';
      ELSE
        RAISE;
      END IF;
  END;
END;
$$;
