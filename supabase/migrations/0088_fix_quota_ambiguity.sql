-- Migration: 0088_fix_quota_ambiguity.sql
-- Created: 2026-08-15
-- Description: Fixes ambiguous column references in consume_message_quota().
-- Related documents: Official Documentation/12 Communication System/WHATSAPP.md
--
-- Caught by the communications suite on its first run:
--
--   ERROR 42702: column reference "messages_used" is ambiguous
--
-- THE SAME MISTAKE AS 0080. A RETURNS TABLE column becomes a PL/pgSQL variable
-- inside the body, so the OUT columns `quota_limit`, `messages_used`, and
-- `overage_credits` collided with the identically named columns of
-- school_message_quotas. The function aborted on its first UPDATE, meaning
-- quota enforcement did not work at all — every send would have failed rather
-- than been counted.
--
-- 0080 fixed exactly this shape in allocate_payment() and I reproduced it here.
-- The rule worth carrying forward: in a plpgsql function with a RETURNS TABLE
-- clause, OUT column names share a namespace with every table column the body
-- touches. Prefix them, or qualify every reference.

-- === MIGRATION START ===

DROP FUNCTION IF EXISTS public.consume_message_quota(UUID, TEXT, INT);

CREATE OR REPLACE FUNCTION public.consume_message_quota(
  p_school_id UUID,
  p_channel   TEXT,
  p_count     INT DEFAULT 1
)
RETURNS TABLE (
  out_allowed         BOOLEAN,
  out_reason          TEXT,
  out_quota_limit     INT,
  out_messages_used   INT,
  out_overage_credits INT,
  out_crossed_80      BOOLEAN
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
  v_crossed  BOOLEAN := FALSE;
BEGIN
  -- Only WhatsApp is metered. Refusing the fallback because the primary
  -- channel ran out would defeat the whole chain.
  IF p_channel <> 'whatsapp' THEN
    RETURN QUERY SELECT TRUE, 'channel_not_metered'::TEXT, NULL::INT, 0, 0, FALSE;
    RETURN;
  END IF;

  SELECT s.subscription_tier INTO v_tier FROM public.schools s WHERE s.id = p_school_id;

  IF v_tier IS NULL THEN
    RETURN QUERY SELECT FALSE, 'unknown_school'::TEXT, NULL::INT, 0, 0, FALSE;
    RETURN;
  END IF;

  -- The ceiling comes from configuration, never a constant here.
  SELECT st.whatsapp_quota INTO v_limit
  FROM afritech.subscription_tiers st
  WHERE st.tier_name = v_tier;

  INSERT INTO public.school_message_quotas (school_id, billing_period, quota_limit)
  VALUES (p_school_id, v_period, v_limit)
  ON CONFLICT (school_id, billing_period) DO NOTHING;

  -- Lock the period row: two concurrent workers must not both read 499 and
  -- both send. This is why check and decrement are a single call.
  SELECT q.* INTO v_row
  FROM public.school_message_quotas q
  WHERE q.school_id = p_school_id AND q.billing_period = v_period
  FOR UPDATE;

  v_before   := v_row.messages_used;
  v_capacity := COALESCE(v_row.quota_limit, v_limit);

  -- NULL capacity is UNLIMITED, not unset: Enterprise, and any school on its
  -- own Meta number.
  IF v_capacity IS NULL THEN
    UPDATE public.school_message_quotas q
    SET messages_used = q.messages_used + p_count, last_updated_at = NOW()
    WHERE q.id = v_row.id;
    RETURN QUERY SELECT TRUE, 'unlimited'::TEXT, NULL::INT, v_before + p_count, v_row.overage_credits, FALSE;
    RETURN;
  END IF;

  IF v_before + p_count > v_capacity + v_row.overage_credits THEN
    RETURN QUERY SELECT FALSE, 'quota_exceeded'::TEXT, v_capacity, v_before, v_row.overage_credits, FALSE;
    RETURN;
  END IF;

  v_crossed := (v_row.alert_80_sent_at IS NULL
                AND (v_before + p_count)::NUMERIC >= v_capacity * 0.8);

  UPDATE public.school_message_quotas q
  SET messages_used    = q.messages_used + p_count,
      last_updated_at  = NOW(),
      alert_80_sent_at = CASE WHEN v_crossed THEN NOW() ELSE q.alert_80_sent_at END
  WHERE q.id = v_row.id;

  RETURN QUERY SELECT
    TRUE, 'ok'::TEXT, v_capacity, v_before + p_count, v_row.overage_credits, v_crossed;
END;
$$;

COMMENT ON FUNCTION public.consume_message_quota(UUID, TEXT, INT) IS
  'Atomically checks and decrements the monthly WhatsApp quota. Only WhatsApp is metered; email and SMS always pass so the fallback chain survives quota exhaustion.';

GRANT EXECUTE ON FUNCTION public.consume_message_quota(UUID, TEXT, INT) TO authenticated;

-- === MIGRATION END ===
