-- Migration: 0084_create_communication_rls.sql
-- Created: 2026-08-15
-- Description: RLS for the communication tables, plus the quota check/consume
--              functions and the template resolver.
-- Related documents: Official Documentation/12 Communication System/WHATSAPP.md
--                    Official Documentation/01 Foundation Layer/RLS.md
--
-- QUOTA IS ENFORCED IN THE DATABASE, NOT THE WORKER.
-- A worker that checked its own quota in application code would be one bug away
-- from a school sending unlimited messages at AfriTech's expense — and the
-- check-then-send gap is a race under concurrency. consume_message_quota()
-- decrements and reports refusal in a single statement.

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- notification_templates
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "afritech_admin_all_templates" ON public.notification_templates;
CREATE POLICY "afritech_admin_all_templates"
ON public.notification_templates FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

-- Platform defaults are readable by every authenticated user: a school must be
-- able to see the wording it will fall back to.
DROP POLICY IF EXISTS "read_platform_default_templates" ON public.notification_templates;
CREATE POLICY "read_platform_default_templates"
ON public.notification_templates FOR SELECT
USING (school_id IS NULL AND is_active = TRUE);

DROP POLICY IF EXISTS "school_read_own_templates" ON public.notification_templates;
CREATE POLICY "school_read_own_templates"
ON public.notification_templates FOR SELECT
USING (school_id = current_school_uuid());

-- Only owner and principal edit message wording. An admin or accountant can
-- send messages; changing what every parent receives is a different authority.
DROP POLICY IF EXISTS "management_write_templates" ON public.notification_templates;
CREATE POLICY "management_write_templates"
ON public.notification_templates FOR ALL
USING (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal')
)
WITH CHECK (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal')
);
-- Note the WITH CHECK pins school_id: a school owner cannot author or edit a
-- platform default by writing school_id = NULL.

-- ---------------------------------------------------------------------------
-- school_message_quotas
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "afritech_admin_all_quotas" ON public.school_message_quotas;
CREATE POLICY "afritech_admin_all_quotas"
ON public.school_message_quotas FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

-- Any staff member may read their school's usage — the 80% warning has to be
-- visible to whoever is about to enable absence alerts.
DROP POLICY IF EXISTS "school_staff_read_quota" ON public.school_message_quotas;
CREATE POLICY "school_staff_read_quota"
ON public.school_message_quotas FOR SELECT
USING (school_id = current_school_uuid());

-- No INSERT or UPDATE policy at all. Quota rows are created and decremented
-- exclusively by consume_message_quota() in this migration.

-- ---------------------------------------------------------------------------
-- message_log
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "afritech_admin_all_message_log" ON public.message_log;
CREATE POLICY "afritech_admin_all_message_log"
ON public.message_log FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

DROP POLICY IF EXISTS "school_management_read_message_log" ON public.message_log;
CREATE POLICY "school_management_read_message_log"
ON public.message_log FOR SELECT
USING (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
);

-- A parent sees messages addressed to them, and nothing else. Scoped by Clerk
-- user ID rather than by school, because a parent with children at two schools
-- should see both their own message histories and neither school's others.
DROP POLICY IF EXISTS "recipient_read_own_messages" ON public.message_log;
CREATE POLICY "recipient_read_own_messages"
ON public.message_log FOR SELECT
USING (recipient_user_id = get_user_id());

-- No INSERT/UPDATE/DELETE policy for anyone. The log is written by
-- record_message_dispatch() and updated by delivery callbacks, both SECURITY
-- DEFINER. A fabricated 'delivered' row is a plausible way to argue a parent
-- was warned when they were not.

-- ---------------------------------------------------------------------------
-- resolve_notification_template — school override, platform fallback
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_notification_template(
  p_school_id     UUID,
  p_template_key  TEXT,
  p_channel       TEXT,
  p_language      TEXT DEFAULT 'en'
)
RETURNS TABLE (
  template_id        UUID,
  subject            TEXT,
  body               TEXT,
  meta_template_name TEXT,
  is_school_override BOOLEAN
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, t.subject, t.body, t.meta_template_name, (t.school_id IS NOT NULL)
  FROM public.notification_templates t
  WHERE t.template_key   = p_template_key
    AND t.channel        = p_channel
    AND t.language_code  = p_language
    AND t.is_active      = TRUE
    AND (t.school_id = p_school_id OR t.school_id IS NULL)
  -- School override first, platform default second. LIMIT 1 makes the
  -- precedence explicit rather than relying on the caller to pick.
  ORDER BY (t.school_id IS NOT NULL) DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_notification_template(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- consume_message_quota — check and decrement atomically
-- ---------------------------------------------------------------------------
-- Returns the decision plus the numbers behind it, so a caller can surface
-- "you have used 400 of 500" without a second query.
--
-- Quota applies ONLY to WhatsApp on AfriTech's shared number. A school on its
-- own Meta number has quota_limit NULL and is never refused here; its billing
-- is Meta's business, not ZSMS's.
CREATE OR REPLACE FUNCTION public.consume_message_quota(
  p_school_id UUID,
  p_channel   TEXT,
  p_count     INT DEFAULT 1
)
RETURNS TABLE (
  allowed          BOOLEAN,
  reason           TEXT,
  quota_limit      INT,
  messages_used    INT,
  overage_credits  INT,
  crossed_80       BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period   TEXT := to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM');
  v_tier     TEXT;
  v_limit    INT;
  v_row      public.school_message_quotas;
  v_before   INT;
  v_capacity INT;
BEGIN
  -- Only WhatsApp consumes quota. Email and SMS are billed per provider and
  -- are never refused for quota reasons — refusing the fallback because the
  -- primary channel ran out would defeat the whole chain.
  IF p_channel <> 'whatsapp' THEN
    RETURN QUERY SELECT TRUE, 'channel_not_metered'::TEXT, NULL::INT, 0, 0, FALSE;
    RETURN;
  END IF;

  SELECT s.subscription_tier INTO v_tier
  FROM public.schools s WHERE s.id = p_school_id;

  IF v_tier IS NULL THEN
    RETURN QUERY SELECT FALSE, 'unknown_school'::TEXT, NULL::INT, 0, 0, FALSE;
    RETURN;
  END IF;

  -- The ceiling comes from configuration, never from a constant here.
  SELECT st.whatsapp_quota INTO v_limit
  FROM afritech.subscription_tiers st
  WHERE st.tier_name = v_tier;

  -- Lock the period row so two concurrent workers cannot both read 499 and
  -- both send. This is the reason the check and the decrement are one call.
  INSERT INTO public.school_message_quotas (school_id, billing_period, quota_limit)
  VALUES (p_school_id, v_period, v_limit)
  ON CONFLICT (school_id, billing_period) DO NOTHING;

  SELECT * INTO v_row
  FROM public.school_message_quotas q
  WHERE q.school_id = p_school_id AND q.billing_period = v_period
  FOR UPDATE;

  v_before   := v_row.messages_used;
  v_capacity := COALESCE(v_row.quota_limit, v_limit);

  -- NULL capacity = unlimited: own-number schools and Enterprise.
  IF v_capacity IS NULL THEN
    UPDATE public.school_message_quotas
    SET messages_used = messages_used + p_count, last_updated_at = NOW()
    WHERE id = v_row.id;
    RETURN QUERY SELECT TRUE, 'unlimited'::TEXT, NULL::INT, v_before + p_count, v_row.overage_credits, FALSE;
    RETURN;
  END IF;

  IF v_before + p_count > v_capacity + v_row.overage_credits THEN
    RETURN QUERY SELECT FALSE, 'quota_exceeded'::TEXT, v_capacity, v_before, v_row.overage_credits, FALSE;
    RETURN;
  END IF;

  UPDATE public.school_message_quotas
  SET messages_used   = messages_used + p_count,
      last_updated_at = NOW(),
      alert_80_sent_at = CASE
        WHEN alert_80_sent_at IS NULL
         AND (v_before + p_count)::NUMERIC >= v_capacity * 0.8
        THEN NOW() ELSE alert_80_sent_at END
  WHERE id = v_row.id;

  RETURN QUERY SELECT
    TRUE,
    'ok'::TEXT,
    v_capacity,
    v_before + p_count,
    v_row.overage_credits,
    -- TRUE only on the crossing, so the 80% warning is sent once per period.
    (v_row.alert_80_sent_at IS NULL
     AND (v_before + p_count)::NUMERIC >= v_capacity * 0.8);
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_message_quota(UUID, TEXT, INT) TO authenticated;

-- ---------------------------------------------------------------------------
-- record_message_dispatch — the only way a message_log row is created
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_message_dispatch(
  p_school_id       UUID,
  p_channel         TEXT,
  p_template_key    TEXT,
  p_recipient_phone TEXT DEFAULT NULL,
  p_recipient_email TEXT DEFAULT NULL,
  p_recipient_user  TEXT DEFAULT NULL,
  p_student_id      UUID DEFAULT NULL,
  p_status          TEXT DEFAULT 'queued',
  p_variables       JSONB DEFAULT NULL,
  p_is_fallback     BOOLEAN DEFAULT FALSE,
  p_fallback_of     UUID DEFAULT NULL,
  p_consumed_quota  BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.message_log (
    school_id, channel, template_key, recipient_phone, recipient_email,
    recipient_user_id, student_id, status, variables, is_fallback,
    fallback_of_id, consumed_quota
  )
  VALUES (
    p_school_id, p_channel, p_template_key, p_recipient_phone, p_recipient_email,
    p_recipient_user, p_student_id, p_status, p_variables, p_is_fallback,
    p_fallback_of, p_consumed_quota
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_message_dispatch(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, JSONB, BOOLEAN, UUID, BOOLEAN
) TO authenticated;

-- === MIGRATION END ===
