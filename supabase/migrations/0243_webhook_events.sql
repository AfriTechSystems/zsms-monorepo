-- ===========================================================================
-- 0243 — webhook idempotency (WEBHOOKS.md)
--
-- Spec: `05 Core Database and API Reference/WEBHOOKS.md`,
--       `01 Foundation Layer/DECISIONS.md` → ADR-044
--
-- ## The one thing every webhook needs and none of them can skip
--
-- **Webhook delivery is at-least-once, never exactly-once.** Every sender in
-- WEBHOOKS.md — Clerk, seven payment gateways, Meta, lending partners — retries
-- on timeout, on a 500, and sometimes on a 200 their side did not see. A handler
-- without idempotency does the work twice, and for a payment gateway that means
-- crediting a fee twice from one transaction.
--
-- So this table exists before any handler does. A handler records the provider's
-- own event id here FIRST; the unique constraint refuses the second delivery, and
-- the handler returns 200 without repeating itself.
--
-- ## Why 200 on a duplicate
--
-- A sender retrying a delivery ZSMS has already processed wants to stop retrying.
-- Returning an error would make it retry harder, and the most common cause of a
-- retry storm is a receiver answering "no" to a question it already answered
-- "yes" to.
--
-- ## Why the payload is kept
--
-- A webhook is the only record of something that happened outside ZSMS. When a
-- school says a payment was taken and ZSMS has no fee against it, the gateway's
-- own body is the evidence — and it is unavailable from anywhere else once the
-- sender's retention window closes.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.webhook_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  /** `clerk`, `flutterwave`, `meta_whatsapp` … */
  provider      TEXT NOT NULL CHECK (btrim(provider) <> ''),

  /*
    The provider's OWN id for this delivery, which is what makes a retry
    recognisable. Clerk sends `svix-id`; a gateway sends a transaction reference.
    Not generated here — an id ZSMS invented would be different on every retry
    and would defeat the entire purpose of the table.
  */
  event_id      TEXT NOT NULL,
  event_type    TEXT,

  payload       JSONB NOT NULL,

  status        TEXT NOT NULL DEFAULT 'received'
                CHECK (status IN ('received', 'processed', 'failed', 'ignored')),
  error_message TEXT,

  /** Set when the event resolves to a school, so support can find it by customer. */
  school_id     UUID REFERENCES public.schools(id) ON DELETE SET NULL,

  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at  TIMESTAMPTZ,

  -- The idempotency guarantee itself. Two providers may legitimately use the same
  -- id, so it is scoped by provider rather than global.
  CONSTRAINT webhook_events_unique_delivery UNIQUE (provider, event_id)
);

COMMENT ON TABLE public.webhook_events IS
  'Every inbound webhook delivery, keyed on the PROVIDER''s own event id. Webhook delivery is at-least-once, so this unique constraint is what stops a retried payment being credited twice (0243).';

CREATE INDEX IF NOT EXISTS idx_webhook_events_provider
  ON public.webhook_events (provider, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_events_unprocessed
  ON public.webhook_events (received_at) WHERE status = 'received';

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events FORCE ROW LEVEL SECURITY;

/*
  AfriTech reads everything; a school reads deliveries that concern it.

  A school owner asking "did the gateway tell you about my payment" is a fair
  question with an answer, and making them raise a support ticket for it wastes
  everybody's time.
*/
CREATE POLICY afritech_read_webhook_events
  ON public.webhook_events
  FOR SELECT TO authenticated
  USING (public.is_afritech_admin());

CREATE POLICY school_read_own_webhook_events
  ON public.webhook_events
  FOR SELECT TO authenticated
  USING (
    school_id = public.current_school_uuid()
    AND public.get_user_role() IN ('org:owner', 'org:principal', 'org:accountant')
  );

-- SELECT only. Handlers write through the service role; a webhook record a user
-- can edit is not evidence of anything.
GRANT SELECT ON public.webhook_events TO authenticated;
REVOKE ALL ON public.webhook_events FROM anon;

-- ---------------------------------------------------------------------------
-- Claiming a delivery.
-- ---------------------------------------------------------------------------

/*
  Insert-or-report-duplicate, in one statement.

  `ON CONFLICT DO NOTHING` plus `RETURNING` gives no row when the delivery is a
  repeat, which is exactly the signal the handler needs — and it is atomic, so two
  simultaneous retries cannot both win. Checking for existence and then inserting
  would be a race, and the race is likeliest under precisely the retry storm this
  defends against.
*/
CREATE OR REPLACE FUNCTION public.claim_webhook_event(
  p_provider   TEXT,
  p_event_id   TEXT,
  p_event_type TEXT,
  p_payload    JSONB
)
RETURNS TABLE (out_id UUID, out_is_duplicate BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.webhook_events (provider, event_id, event_type, payload)
  VALUES (p_provider, p_event_id, p_event_type, p_payload)
  ON CONFLICT (provider, event_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, FALSE;
    RETURN;
  END IF;

  -- A repeat. Hand back the original so the handler can log against it.
  SELECT w.id INTO v_id
  FROM public.webhook_events w
  WHERE w.provider = p_provider AND w.event_id = p_event_id;

  RETURN QUERY SELECT v_id, TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_webhook_event(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_webhook_event(TEXT, TEXT, TEXT, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_webhook_event(TEXT, TEXT, TEXT, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_webhook_event(
  p_id        UUID,
  p_status    TEXT,
  p_error     TEXT DEFAULT NULL,
  p_school_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.webhook_events
  SET status = p_status,
      error_message = p_error,
      school_id = COALESCE(p_school_id, school_id),
      processed_at = NOW()
  WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_webhook_event(UUID, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_webhook_event(UUID, TEXT, TEXT, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_webhook_event(UUID, TEXT, TEXT, UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- Exercise the property the whole table exists for.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_first  RECORD;
  v_second RECORD;
  v_eid    TEXT := 'probe_' || gen_random_uuid()::text;
BEGIN
  BEGIN
    SELECT * INTO v_first FROM public.claim_webhook_event(
      'probe', v_eid, 'test.event', '{"amount": 100}'::jsonb);

    IF v_first.out_is_duplicate THEN
      RAISE EXCEPTION '0243: a first delivery was reported as a duplicate';
    END IF;

    -- The retry. This is the whole point.
    SELECT * INTO v_second FROM public.claim_webhook_event(
      'probe', v_eid, 'test.event', '{"amount": 100}'::jsonb);

    IF NOT v_second.out_is_duplicate THEN
      RAISE EXCEPTION
        '0243: a retried delivery was NOT recognised — a payment would be credited twice';
    END IF;

    IF v_second.out_id <> v_first.out_id THEN
      RAISE EXCEPTION '0243: the retry returned a different row than the original';
    END IF;

    -- The same id from a DIFFERENT provider must not collide.
    SELECT * INTO v_second FROM public.claim_webhook_event(
      'other_probe', v_eid, 'test.event', '{}'::jsonb);
    IF v_second.out_is_duplicate THEN
      RAISE EXCEPTION '0243: two providers sharing an event id collided';
    END IF;

    PERFORM public.complete_webhook_event(v_first.out_id, 'processed');
    IF NOT EXISTS (
      SELECT 1 FROM public.webhook_events
      WHERE id = v_first.out_id AND status = 'processed' AND processed_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION '0243: completing an event did not record it';
    END IF;

    RAISE EXCEPTION 'ZSMS_0243_ROLLBACK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'ZSMS_0243_ROLLBACK' THEN
        RAISE NOTICE '0243: verified — a retry is recognised, providers do not collide, completion records';
      ELSE
        RAISE;
      END IF;
  END;
END;
$$;
