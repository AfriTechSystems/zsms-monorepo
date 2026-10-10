-- Migration: 0152_onboarding_task_queue.sql
-- Created: 2026-09-30
-- Description: The onboarding task queue and the 24-hour outreach rule — the last part of
--              ONBOARDING.md with nothing behind it.
-- Related documents: Official Documentation/15 Super Admin and Platform/ONBOARDING.md
--                    Official Documentation/06 School and Tenant Management/TRIAL.md
--
-- ===========================================================================
-- THE MOST IMPORTANT OPERATIONAL RULE AT AFRITECH, ENFORCED BY NOTHING
--
-- `ONBOARDING.md` opens by calling the 24-hour outreach rule "the most important operational rule at
-- AfriTech" and closes with an escalation table built on it. No table recorded a contact attempt, so
-- there was no way to know which schools had been called, let alone which were overdue.
--
-- ---------------------------------------------------------------------------
-- THE RULE IS DERIVED, NOT SCHEDULED
-- ---------------------------------------------------------------------------
-- That document implements the rule as a queued job fired 24 hours after registration. There is no
-- Redis (`CREDENTIALS_CHECKLIST.md`), so that job cannot run — and building it now would mean
-- shipping an untestable handler and an admin panel that shows nothing until credentials arrive.
--
-- So the split, decided 2026-09-29: **overdue is computed in SQL** from registration time against
-- recorded contacts, which makes the panel correct from the day it ships and needs no scheduler at
-- all. Only the *push* — the urgent notification to the super admin — waits for Redis.
--
-- This is a better decomposition than the document's rather than a workaround for a missing
-- dependency. A derived flag cannot drift from reality: there is no row saying "overdue" that a
-- failed job forgot to write, and no backfill needed when the rule changes from 24 hours to 12.
-- `platform_incidents` already exists for the push to land in when it is built.
--
-- ---------------------------------------------------------------------------
-- WHAT IS STORED AND WHAT IS COMPUTED
-- ---------------------------------------------------------------------------
-- `ONBOARDING.md` lists nine task states. Four of them are facts about the world and are computed:
-- *New* (no contact recorded), *Converted* (paying), *Expired* (trial lapsed), and the completion
-- percentage behind *Complete*. Five are judgements a person makes — assigned to whom, whether the
-- school is actually engaging, whether they said no — and judgements have to be stored.
--
-- Business rule 2 is the reason the line falls there: "onboarding tasks are never automatically
-- closed — a human must mark them as Complete or Converted." A state machine that closed itself
-- would contradict it.
-- ===========================================================================

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- 1. The judgement half, on the onboarding record.
-- ---------------------------------------------------------------------------
ALTER TABLE public.school_onboarding
  ADD COLUMN IF NOT EXISTS task_status TEXT NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS assigned_to TEXT,
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;

ALTER TABLE public.school_onboarding
  DROP CONSTRAINT IF EXISTS school_onboarding_task_status_check;

/**
 * The five states a person sets. The document's *Converted* and *Expired* are absent on purpose —
 * they are facts about `schools.status`, and storing them would create two answers to one question
 * that could disagree. The queue view below reports them as derived.
 */
ALTER TABLE public.school_onboarding
  ADD CONSTRAINT school_onboarding_task_status_check CHECK (task_status IN (
    'new',             -- nobody has picked it up
    'assigned',        -- a regional manager owns it
    'in_progress',     -- actively being set up with the school
    'not_interested',  -- they registered and decided against it. Re-outreach quarterly
    'complete'         -- a human judged the school set up. Business rule 2
  ));

CREATE INDEX IF NOT EXISTS idx_school_onboarding_task
  ON public.school_onboarding(task_status, created_at);

CREATE INDEX IF NOT EXISTS idx_school_onboarding_assigned
  ON public.school_onboarding(assigned_to)
  WHERE assigned_to IS NOT NULL;

COMMENT ON COLUMN public.school_onboarding.task_status IS
  'What a human decided about this onboarding. Converted and Expired from ONBOARDING.md are NOT '
  'here — they are facts about schools.status, reported as derived by public.onboarding_queue.';

-- ---------------------------------------------------------------------------
-- 2. Contact attempts.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_onboarding_contacts (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id     UUID NOT NULL REFERENCES public.schools(id),

  contacted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Clerk user id of the AfriTech person who made the attempt.
  contacted_by  TEXT NOT NULL,

  channel       TEXT NOT NULL DEFAULT 'phone'
                CHECK (channel IN ('phone', 'whatsapp', 'email', 'in_person')),

  outcome       TEXT NOT NULL
                CHECK (outcome IN (
                  'spoke',           -- reached them and talked
                  'call_scheduled',  -- reached them, onboarding call booked
                  'no_answer',       -- tried, nobody picked up
                  'wrong_number',    -- the number does not reach the school
                  'not_interested'   -- reached them, they declined
                )),

  /**
   * What was said. Required, and that is the point: an outcome of `no_answer` with no note is fine,
   * but `spoke` with no note leaves the next person ringing the same school with nothing to go on.
   * The CHECK below allows an empty note only where there was nobody to quote.
   */
  note          TEXT,

  -- When the next attempt is due, if one is. Drives the amber rows in the queue.
  follow_up_at  TIMESTAMPTZ,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT school_onboarding_contacts_note_required CHECK (
    outcome IN ('no_answer', 'wrong_number')
    OR COALESCE(BTRIM(note), '') <> ''
  )
);

CREATE INDEX IF NOT EXISTS idx_school_onboarding_contacts_school
  ON public.school_onboarding_contacts(school_id, contacted_at DESC);

COMMENT ON TABLE public.school_onboarding_contacts IS
  'Every outreach attempt, append-only in practice. The 24-hour rule is computed from the earliest '
  'row here against the school''s registration time — no scheduled job writes an "overdue" flag.';

ALTER TABLE public.school_onboarding_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_onboarding_contacts FORCE  ROW LEVEL SECURITY;

/**
 * AfriTech only, with no school-side policy at all — the same reasoning as `school_onboarding`.
 * A note reading "head teacher was evasive about their numbers" is an internal judgement, and a
 * school reading its own outreach history would read all of them.
 */
DROP POLICY IF EXISTS "afritech_admin_all_onboarding_contacts"
  ON public.school_onboarding_contacts;
CREATE POLICY "afritech_admin_all_onboarding_contacts"
ON public.school_onboarding_contacts FOR ALL
USING (public.is_afritech_admin())
WITH CHECK (public.is_afritech_admin());

REVOKE ALL ON public.school_onboarding_contacts FROM anon;
GRANT SELECT, INSERT ON public.school_onboarding_contacts TO authenticated;

/**
 * No UPDATE and no DELETE, deliberately. A contact log whose entries can be edited afterwards is
 * not a record of what happened — and the escalation table in ONBOARDING.md hands consequences to
 * a super admin based on it. A mistaken entry is corrected by adding another, the same way the
 * rest of this schema treats a record of an act.
 */

-- ---------------------------------------------------------------------------
-- 3. The queue.
-- ---------------------------------------------------------------------------
/**
 * One row per school that has an onboarding record, with everything the panel needs resolved in a
 * single grouped scan rather than a query per school. `0104` learned that lesson on
 * `school_health_scores`; this is the same shape.
 *
 * `security_invoker` so the policies above apply to the caller. A school user reaches this view and
 * sees nothing, because `school_onboarding` has no policy for them.
 */
CREATE OR REPLACE VIEW public.onboarding_queue
WITH (security_invoker = true) AS
WITH contacts AS (
  SELECT c.school_id,
         COUNT(*)                     AS attempts,
         MIN(c.contacted_at)          AS first_contact_at,
         MAX(c.contacted_at)          AS last_contact_at,
         MIN(c.follow_up_at) FILTER (WHERE c.follow_up_at > NOW()) AS next_follow_up_at
    FROM public.school_onboarding_contacts c
   GROUP BY c.school_id
)
SELECT
  s.id                      AS school_id,
  s.school_id               AS school_code,
  s.name                    AS school_name,
  s.status                  AS school_status,
  s.city_code,
  s.province_code,
  s.subscription_tier,
  s.trial_ends_at,
  o.source,
  o.owner_first_name,
  o.owner_last_name,
  o.owner_email,
  o.owner_phone_e164,
  o.owner_accepted_at,
  o.task_status,
  o.assigned_to,
  o.created_at              AS registered_at,
  COALESCE(k.attempts, 0)   AS contact_attempts,
  k.first_contact_at,
  k.last_contact_at,
  k.next_follow_up_at,
  q.completion_pct,
  q.critical_pct,

  /**
   * THE 24-HOUR RULE.
   *
   * Applies to **self-registration only**. An AfriTech-created school was created by somebody who
   * was already talking to it, so a 24-hour clock on calling them back measures nothing.
   *
   * `first_contact_at IS NULL` rather than "no recent contact": the rule is about the first attempt,
   * and once one is recorded the escalation table's other rows take over.
   */
  (o.source = 'self_registration'
   AND k.first_contact_at IS NULL
   AND o.created_at < NOW() - INTERVAL '24 hours')       AS outreach_overdue,

  -- 48 hours is where ONBOARDING.md hands it to the super admin personally.
  (o.source = 'self_registration'
   AND k.first_contact_at IS NULL
   AND o.created_at < NOW() - INTERVAL '48 hours')       AS outreach_escalated,

  -- How long is left to make the first call. Negative once the window has passed, which is what
  -- lets a screen sort by urgency without re-deriving the rule.
  EXTRACT(EPOCH FROM (o.created_at + INTERVAL '24 hours' - NOW())) / 3600 AS hours_to_contact,

  -- Derived, never stored — see the migration header.
  (s.status = 'active')                                  AS converted,
  (s.status IN ('trial_expired', 'suspended'))           AS lapsed,
  CASE
    WHEN s.trial_ends_at IS NULL THEN NULL
    ELSE (s.trial_ends_at::DATE - CURRENT_DATE)
  END                                                    AS trial_days_left

FROM public.school_onboarding o
JOIN public.schools s ON s.id = o.school_id
LEFT JOIN contacts k ON k.school_id = o.school_id
LEFT JOIN LATERAL public.school_onboarding_completion(o.school_id) q ON TRUE;

COMMENT ON VIEW public.onboarding_queue IS
  'The onboarding task queue. outreach_overdue and outreach_escalated are COMPUTED from the first '
  'recorded contact against registration time — there is no scheduled job and no stored flag, so '
  'the rule cannot drift from reality. security_invoker: AfriTech only, via school_onboarding.';

GRANT SELECT ON public.onboarding_queue TO authenticated;
REVOKE ALL  ON public.onboarding_queue FROM anon;

-- ---------------------------------------------------------------------------
-- 4. Recording a contact, and assigning a task.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_record_onboarding_contact(
  p_school_id    UUID,
  p_outcome      TEXT,
  p_note         TEXT DEFAULT NULL,
  p_channel      TEXT DEFAULT 'phone',
  p_follow_up_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  out_id           UUID,
  out_contacted_at TIMESTAMPTZ,
  out_task_status  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor TEXT;
  v_row   UUID;
BEGIN
  IF COALESCE(public.is_afritech_admin(), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Only AfriTech records onboarding outreach.' USING ERRCODE = '42501';
  END IF;

  v_actor := public.get_user_id();

  INSERT INTO public.school_onboarding_contacts
    (school_id, contacted_by, channel, outcome, note, follow_up_at)
  VALUES
    (p_school_id, v_actor, p_channel, p_outcome, NULLIF(BTRIM(p_note), ''), p_follow_up_at)
  RETURNING school_onboarding_contacts.id INTO v_row;

  /**
   * The task moves itself out of `new` on first contact, and only out of `new`.
   *
   * Business rule 2 says a human must mark Complete or Converted, so nothing here closes anything.
   * But leaving a task at `new` after somebody has demonstrably called is a different kind of wrong
   * — the queue's whole job is to show what has not been touched, and a touched task sitting in the
   * untouched column is the one state that makes it useless.
   *
   * `not_interested` is carried across because it is the school's answer, not a judgement, and the
   * escalation table treats it as a terminal state with quarterly re-outreach.
   */
  UPDATE public.school_onboarding AS o
     SET task_status = CASE
           WHEN p_outcome = 'not_interested' THEN 'not_interested'
           WHEN o.task_status = 'new'        THEN 'in_progress'
           ELSE o.task_status
         END
   WHERE o.school_id = p_school_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No onboarding record for that school.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.log_audit_event(
    'onboarding_contact_recorded', 'school_onboarding_contacts', v_row,
    jsonb_build_object('outcome', p_outcome, 'channel', p_channel),
    p_school_id
  );

  RETURN QUERY
  SELECT c.id, c.contacted_at, o.task_status
    FROM public.school_onboarding_contacts c
    JOIN public.school_onboarding o ON o.school_id = c.school_id
   WHERE c.id = v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_record_onboarding_contact(
  UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_record_onboarding_contact(
  UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_onboarding_task(
  p_school_id   UUID,
  p_task_status TEXT DEFAULT NULL,
  p_assigned_to TEXT DEFAULT NULL
)
RETURNS TABLE (
  out_task_status TEXT,
  out_assigned_to TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(public.is_afritech_admin(), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Only AfriTech manages onboarding tasks.' USING ERRCODE = '42501';
  END IF;

  -- NULL means "leave it alone", the convention admin_update_tier() established. Assigning to
  -- nobody is done by passing the empty string, which NULLIF turns back into NULL.
  UPDATE public.school_onboarding AS o
     SET task_status = COALESCE(p_task_status, o.task_status),
         assigned_to = CASE
           WHEN p_assigned_to IS NULL THEN o.assigned_to
           ELSE NULLIF(BTRIM(p_assigned_to), '')
         END,
         assigned_at = CASE
           WHEN p_assigned_to IS NULL THEN o.assigned_at
           WHEN NULLIF(BTRIM(p_assigned_to), '') IS NULL THEN NULL
           ELSE NOW()
         END
   WHERE o.school_id = p_school_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No onboarding record for that school.' USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  SELECT o.task_status, o.assigned_to
    FROM public.school_onboarding o WHERE o.school_id = p_school_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_set_onboarding_task(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_onboarding_task(UUID, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.admin_set_onboarding_task(UUID, TEXT, TEXT) IS
  'Assigns an onboarding task or sets its state. Nothing else may write task_status — the queue is '
  'AfriTech''s operational record, not the school''s.';

-- === MIGRATION END ===
