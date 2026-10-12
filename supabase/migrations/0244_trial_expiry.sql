-- ===========================================================================
-- 0244 — trials actually expire (TRIAL.md)
--
-- Spec: `06 School and Tenant Management/TRIAL.md`,
--       `01 Foundation Layer/DECISIONS.md` → ADR-?? (trial length, `0150`)
--
-- ## The gap, which has a live instance
--
-- `schools.status` has admitted `trial_expired` since `0003`. `register_school()`
-- sets `trial_ends_at` to 30 days out. **Nothing ever makes the transition.**
--
-- Checked on 2026-10-11: one school on `zsms-dev` is past its trial end date and
-- still carries `status = 'trial'`, with full access. That is not a missing
-- feature; it is a school using ZSMS for free with no mechanism that would ever
-- notice.
--
-- ## What expiry does and deliberately does not do
--
-- It moves `trial` to `trial_expired`. That is all.
--
-- `0149`'s status guard already refuses writes for a school that is not writable,
-- so the expired state is enforced by machinery that exists. What this does NOT
-- do is delete anything, and TRIAL.md is emphatic about why: "Your data is safe —
-- subscribe to regain access" is sent at day 33 and again at 37. A school that
-- lets a trial lapse over a school holiday and subscribes in February must find
-- its pupils where it left them.
--
-- ## Why a function and not a trigger
--
-- There is no write to hang a trigger on. A trial expires because time passed,
-- not because anybody did anything — the defining property of this transition is
-- that nothing happens. So it needs something that runs on a clock, which is the
-- worker in `apps/workers` calling this on a cron.
--
-- ## Idempotent, and that matters more than it looks
--
-- Running it twice changes nothing the second time: the WHERE clause only matches
-- `status = 'trial'`. A cron that fires twice during a deploy, or a worker
-- restarted mid-run, must not double-handle a school — and because the function
-- returns what it changed, a retry returning zero rows is the honest answer
-- rather than a silent success.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.worker_expire_overdue_trials()
RETURNS TABLE (
  out_school_id   UUID,
  out_school_code TEXT,
  out_name        TEXT,
  out_ended_at    TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  /*
    `worker_` prefix and `service_role` only.

    ADR-042: a worker's connection bypasses RLS, so all of its data access goes
    through functions like this rather than through `.from()`. The boundary is
    asserted by `worker_boundary_test`.
  */
  RETURN QUERY
  UPDATE public.schools s
  SET status = 'trial_expired',
      updated_at = NOW()
  WHERE s.status = 'trial'
    AND s.trial_ends_at IS NOT NULL
    AND s.trial_ends_at < NOW()
  RETURNING s.id, s.school_id, s.name, s.trial_ends_at;
END;
$$;

COMMENT ON FUNCTION public.worker_expire_overdue_trials() IS
  'Moves schools past trial_ends_at from trial to trial_expired. Idempotent. Data is never deleted — TRIAL.md promises it is recoverable on subscribing (0244).';

REVOKE ALL ON FUNCTION public.worker_expire_overdue_trials() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.worker_expire_overdue_trials() FROM anon;
REVOKE ALL ON FUNCTION public.worker_expire_overdue_trials() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.worker_expire_overdue_trials() TO service_role;

-- ---------------------------------------------------------------------------
-- What the admin screen and the trial banner need.
-- ---------------------------------------------------------------------------

/*
  Days remaining, computed here rather than in the browser.

  TRIAL.md's notification schedule turns on exact day counts — 25, 28, 30, 33, 37
  — and a browser clock in a different timezone would put a school on the wrong
  rung. One answer, from the database, for the banner and for the notifier when
  it exists.

  Returns a row for every school with a trial, expired or not, because "expired
  four days ago" is as much a thing the admin screen needs to say as "five days
  left".
*/
CREATE OR REPLACE FUNCTION public.admin_trial_status()
RETURNS TABLE (
  out_school_id    UUID,
  out_school_code  TEXT,
  out_name         TEXT,
  out_status       TEXT,
  out_trial_ends_at TIMESTAMPTZ,
  out_days_left    INT,
  out_is_overdue   BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_afritech_capability('schools:read') THEN
    RAISE EXCEPTION
      'Your AfriTech role does not include school data' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT s.id, s.school_id, s.name, s.status, s.trial_ends_at,
         /*
           `date_part('day', interval)` truncates toward zero, so a trial with
           eighteen hours left reads 0 rather than 1 — which is right: "0 days
           left" on the last day is what a school needs to see.
         */
         CASE WHEN s.trial_ends_at IS NULL THEN NULL
              ELSE date_part('day', s.trial_ends_at - NOW())::INT
         END,
         s.trial_ends_at IS NOT NULL
           AND s.trial_ends_at < NOW()
           AND s.status = 'trial'
  FROM public.schools s
  WHERE s.status IN ('trial', 'trial_expired')
  ORDER BY s.trial_ends_at NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_trial_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_trial_status() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_trial_status() TO authenticated;

-- ---------------------------------------------------------------------------
-- Exercise it, including the overdue school that exists today.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_school   UUID;
  v_expired  INT;
  v_again    INT;
  v_students INT;
BEGIN
  BEGIN
    -- A school deliberately overdue, so the test does not depend on dev's data.
    SELECT id INTO v_school FROM public.schools WHERE status = 'active' LIMIT 1;
    IF v_school IS NULL THEN
      RAISE NOTICE '0244: no school fixture; skipping';
      RAISE EXCEPTION 'ZSMS_0244_ROLLBACK';
    END IF;

    SELECT COUNT(*) INTO v_students FROM public.students WHERE school_id = v_school;

    UPDATE public.schools
    SET status = 'trial', trial_ends_at = NOW() - INTERVAL '2 days'
    WHERE id = v_school;

    SELECT COUNT(*) INTO v_expired FROM public.worker_expire_overdue_trials();
    IF v_expired < 1 THEN
      RAISE EXCEPTION '0244: an overdue trial was not expired';
    END IF;

    IF (SELECT status FROM public.schools WHERE id = v_school) <> 'trial_expired' THEN
      RAISE EXCEPTION '0244: the status did not change';
    END IF;

    -- Idempotent: the second run must change nothing.
    SELECT COUNT(*) INTO v_again FROM public.worker_expire_overdue_trials();
    IF v_again <> 0 THEN
      RAISE EXCEPTION '0244: running twice expired % school(s) again', v_again;
    END IF;

    /*
      The promise TRIAL.md makes twice. Nothing is deleted, so a school that
      subscribes in February finds its pupils where it left them.
    */
    IF (SELECT COUNT(*) FROM public.students WHERE school_id = v_school) <> v_students THEN
      RAISE EXCEPTION '0244: expiring a trial removed pupil records';
    END IF;

    -- A trial still in date must be left alone.
    UPDATE public.schools
    SET status = 'trial', trial_ends_at = NOW() + INTERVAL '10 days'
    WHERE id = v_school;

    SELECT COUNT(*) INTO v_again FROM public.worker_expire_overdue_trials();
    IF v_again <> 0 THEN
      RAISE EXCEPTION '0244: a trial with 10 days left was expired';
    END IF;

    RAISE EXCEPTION 'ZSMS_0244_ROLLBACK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'ZSMS_0244_ROLLBACK' THEN
        RAISE NOTICE '0244: verified — overdue expires, idempotent, data kept, in-date untouched';
      ELSE
        RAISE;
      END IF;
  END;
END;
$$;
