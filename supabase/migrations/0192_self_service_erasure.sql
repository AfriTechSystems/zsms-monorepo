-- ---------------------------------------------------------------------------
-- 0192 — a person can ask ZSMS to erase them, without telephoning anybody
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/01 Foundation Layer/COMPLIANCE.md`
--       Zambia Data Protection Act 2021 — right to erasure
--
-- `0187` built erasure as something AfriTech performs on somebody's behalf
-- (`admin_anonymise_data_subject`). That satisfies the obligation only if the person
-- can reach AfriTech. The Act gives the right to the data subject, so the request has
-- to start with them.
--
-- ## A request, not a button that deletes
--
-- Erasure is irreversible and entangled: a parent who leaves still has fee records a
-- school is legally required to keep, and a school owner who erases themselves orphans
-- every colleague's account. So this records an intent, states plainly what will and
-- will not go, and hands it to the existing review — which already anonymises correctly
-- and already has a screen.
--
-- The grace period is the other reason. An erasure actioned the instant it is clicked
-- is one nobody can take back after a bad afternoon.
--
-- ## What is kept, and why
--
-- Financial records are retained for **six years** — the Zambia Revenue Authority's
-- standard period for business records — with the person's name replaced by the pupil
-- number already printed on every receipt. The number is kept because a receipt that
-- cannot be tied to a payment is not a record of anything; the name is not, because the
-- number is sufficient for the tax purpose that justifies keeping it at all.
--
-- The period lives in `afritech.platform_settings` rather than in this function, so
-- changing it is a configuration decision and not a migration against a table holding
-- live financial history.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Settings that are policy rather than code.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS afritech.platform_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  description TEXT NOT NULL,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE afritech.platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE afritech.platform_settings FORCE ROW LEVEL SECURITY;

INSERT INTO afritech.platform_settings (key, value, description)
VALUES
  ('financial_retention_years', '6',
   'Years that payments, invoices and receipts are kept after an erasure request, '
   'pseudonymised. Set to the Zambia Revenue Authority''s standard period for business '
   'records. Confirm with an accountant before launch.'),
  ('erasure_grace_days', '7',
   'Days between an erasure request and it being actioned, so a request made in haste '
   'can be withdrawn.')
ON CONFLICT (key) DO NOTHING;

-- Readable from a route, which cannot see `afritech`.
CREATE OR REPLACE FUNCTION public.platform_setting(p_key TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, afritech, pg_temp
AS $$
  SELECT value FROM afritech.platform_settings WHERE key = p_key;
$$;

-- ---------------------------------------------------------------------------
-- 2. The request.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.data_erasure_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The Clerk user id. Not a foreign key: the whole point is that this row outlives the
  -- account it describes, as the evidence that the request was handled.
  user_id       TEXT NOT NULL,
  email         TEXT,
  -- What they are to ZSMS, which decides what erasure even means for them.
  subject_kind  TEXT NOT NULL,
  reason        TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Nothing is actioned before this. A request made in haste can be withdrawn.
  action_after  TIMESTAMPTZ NOT NULL,
  resolved_at   TIMESTAMPTZ,
  resolved_by   TEXT,
  resolution_note TEXT,

  CONSTRAINT erasure_status_known
    CHECK (status IN ('pending', 'withdrawn', 'completed', 'refused')),
  CONSTRAINT erasure_kind_known
    CHECK (subject_kind IN ('parent', 'staff', 'teacher_hub', 'unknown'))
);

-- One live request per person. A second does not make the first happen sooner.
CREATE UNIQUE INDEX IF NOT EXISTS idx_erasure_one_pending
  ON public.data_erasure_requests (user_id) WHERE status = 'pending';

ALTER TABLE public.data_erasure_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_erasure_requests FORCE ROW LEVEL SECURITY;

-- A person sees their own. AfriTech sees all, and acts on them.
CREATE POLICY own_read_erasure_requests ON public.data_erasure_requests
  FOR SELECT TO authenticated
  USING (user_id = public.get_user_id() OR public.is_afritech_admin());

CREATE POLICY afritech_manage_erasure_requests ON public.data_erasure_requests
  FOR ALL TO authenticated
  USING (public.is_afritech_admin())
  WITH CHECK (public.is_afritech_admin());

GRANT SELECT ON public.data_erasure_requests TO authenticated;
GRANT INSERT, UPDATE ON public.data_erasure_requests TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Asking.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_my_erasure(p_reason TEXT DEFAULT NULL)
RETURNS TABLE (out_done BOOLEAN, out_message TEXT, out_action_after TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user   TEXT := public.get_user_id();
  v_email  TEXT := auth.jwt() ->> 'email';
  v_kind   TEXT := 'unknown';
  v_grace  INT  := COALESCE(public.platform_setting('erasure_grace_days')::INT, 7);
  v_after  TIMESTAMPTZ;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;

  /*
    A school owner cannot erase themselves.

    Their account owns the organisation every colleague signs in through, so erasing it
    locks a whole school out of ZSMS — people who never asked for anything. Refused
    with the actual remedy rather than a generic denial.
  */
  IF public.get_user_role() = 'org:owner' THEN
    RETURN QUERY SELECT FALSE,
      'You own a school on ZSMS. Transfer ownership to a colleague first, or ask '
      'AfriTech to close the school — erasing the owner would lock out everyone who '
      'works there.'::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  -- What they are decides what erasure means for them, and the reviewer needs it.
  IF EXISTS (SELECT 1 FROM public.student_parent_links l
              WHERE l.parent_user_id = v_user AND l.is_active) THEN
    v_kind := 'parent';
  ELSIF EXISTS (SELECT 1 FROM public.staff_members s WHERE s.user_id = v_user) THEN
    v_kind := 'staff';
  ELSIF EXISTS (SELECT 1 FROM public.teacher_profiles t WHERE t.user_id = v_user) THEN
    v_kind := 'teacher_hub';
  END IF;

  v_after := NOW() + (v_grace || ' days')::INTERVAL;

  INSERT INTO public.data_erasure_requests
    (user_id, email, subject_kind, reason, action_after)
  VALUES (v_user, v_email, v_kind, NULLIF(btrim(p_reason), ''), v_after)
  ON CONFLICT (user_id) WHERE status = 'pending' DO NOTHING;

  IF NOT FOUND THEN
    SELECT r.action_after INTO v_after
    FROM public.data_erasure_requests r
    WHERE r.user_id = v_user AND r.status = 'pending';

    RETURN QUERY SELECT TRUE,
      'You have already asked. Nothing more is needed.'::TEXT, v_after;
    RETURN;
  END IF;

  PERFORM public.log_audit_event(
    'erasure_requested', 'data_erasure_requests', NULL,
    jsonb_build_object('kind', v_kind), NULL
  );

  RETURN QUERY SELECT TRUE,
    'Your request is recorded.'::TEXT, v_after;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Changing your mind, which is what the grace period is for.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.withdraw_my_erasure()
RETURNS TABLE (out_done BOOLEAN, out_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user TEXT := public.get_user_id();
  v_rows INT;
BEGIN
  UPDATE public.data_erasure_requests
     SET status = 'withdrawn', resolved_at = NOW(), resolved_by = v_user
   WHERE user_id = v_user AND status = 'pending';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN QUERY SELECT FALSE, 'You have no request waiting.'::TEXT;
    RETURN;
  END IF;

  PERFORM public.log_audit_event(
    'erasure_withdrawn', 'data_erasure_requests', NULL, '{}'::JSONB, NULL
  );
  RETURN QUERY SELECT TRUE, 'Withdrawn. Nothing will be erased.'::TEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. What to show the person on their account page.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_erasure_status()
RETURNS TABLE (
  out_pending      BOOLEAN,
  out_requested_at TIMESTAMPTZ,
  out_action_after TIMESTAMPTZ,
  out_can_request  BOOLEAN,
  out_blocked_why  TEXT,
  out_retain_years INT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user TEXT := public.get_user_id();
  v_r    RECORD;
BEGIN
  SELECT * INTO v_r FROM public.data_erasure_requests
   WHERE user_id = v_user AND status = 'pending' LIMIT 1;

  RETURN QUERY SELECT
    v_r.id IS NOT NULL,
    v_r.requested_at,
    v_r.action_after,
    -- A school owner is told before they fill anything in, not after.
    public.get_user_role() IS DISTINCT FROM 'org:owner',
    CASE WHEN public.get_user_role() = 'org:owner'
      THEN 'You own a school on ZSMS. Transfer ownership to a colleague first, or ask '
           'AfriTech to close the school.'
    END,
    COALESCE(public.platform_setting('financial_retention_years')::INT, 6);
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_fn TEXT;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.platform_setting(TEXT)',
    'public.request_my_erasure(TEXT)',
    'public.withdraw_my_erasure()',
    'public.my_erasure_status()'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', v_fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_fn);

    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon can execute %', v_fn;
    END IF;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- Prove the settings resolve, since two functions fall back silently if they do not.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF public.platform_setting('financial_retention_years') IS DISTINCT FROM '6' THEN
    RAISE EXCEPTION 'the retention setting did not seed';
  END IF;
  IF public.platform_setting('erasure_grace_days') IS DISTINCT FROM '7' THEN
    RAISE EXCEPTION 'the grace setting did not seed';
  END IF;
  RAISE NOTICE 'verified: retention 6 years, grace 7 days, both readable from public';
END;
$$;
