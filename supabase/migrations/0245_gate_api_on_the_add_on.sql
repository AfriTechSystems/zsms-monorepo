-- ===========================================================================
-- 0245 — the API is a paid add-on and was free (SUBSCRIPTION.md)
--
-- Spec: `06 School and Tenant Management/SUBSCRIPTION.md` → *Feature Add-Ons*,
--       `01 Foundation Layer/DYNAMIC_CONFIG.md`, ADR-014
--
-- ## What `0241` got wrong
--
-- SUBSCRIPTION.md prices **API Read at K138 a month** and **API Write at K275**.
-- `afritech.feature_flags` has carried `api_read` and `api_write` all along.
--
-- `0241` built the whole key system — issue, verify, scope, revoke — and checked
-- neither. Any school on any tier could issue a key and pull its roll through
-- `/api/v1/` without buying anything. That is a commercial hole rather than a
-- security one, and it was mine.
--
-- ## Checked in TWO places, and the second is the one that matters
--
-- Issuing is the obvious gate: a school without the add-on cannot create a key.
--
-- **Verifying is the gate that is easy to forget.** A school buys the add-on,
-- issues a key, wires it into their accounting system, then cancels the add-on
-- next term — and the key keeps working forever, because nothing re-asks. So
-- `verify_api_key()` now resolves the feature on every call.
--
-- `CLAUDE.md` warns never to hardcode a price, tier or feature inclusion. This
-- resolves through `school_has_feature()`, whose order is fixed: revoke override
-- → grant override → tier override → tier matrix. A school given the add-on as a
-- goodwill grant gets it without a code change, which is the point.
--
-- ## Existing keys are left active
--
-- No key is revoked by this migration. A school that has been using the API
-- without the add-on is AfriTech's commercial conversation to have, not a
-- Tuesday-morning outage to inflict — and `admin_api_key_entitlement()` below
-- exists so that conversation can start from a list rather than a surprise.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Issuing requires the add-on.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.issue_api_key(
  p_name       TEXT,
  p_key_hash   TEXT,
  p_key_prefix TEXT,
  p_scopes     TEXT[],
  p_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_rate_limit INT DEFAULT 60
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_user   TEXT := public.get_user_id();
  v_id     UUID;
  v_write  BOOLEAN;
BEGIN
  IF v_school IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in to your school first' USING ERRCODE = '42501';
  END IF;

  IF public.get_user_role() <> 'org:owner' THEN
    RAISE EXCEPTION
      'Only the school owner can issue an API key — it acts as the school with no name attached'
      USING ERRCODE = '42501';
  END IF;

  IF p_scopes IS NULL OR array_length(p_scopes, 1) IS NULL THEN
    RAISE EXCEPTION
      'Choose at least one scope. A key with none can do nothing.'
      USING ERRCODE = '22023';
  END IF;

  /*
    The add-on, resolved rather than hardcoded.

    Named in the message, because "upgrade your plan" sends a head teacher to the
    wrong screen — they need to know it is the API Read add-on specifically.
  */
  IF NOT public.school_has_feature(v_school, 'api_read') THEN
    RAISE EXCEPTION
      'The API Read add-on is not on your plan. Ask AfriTech to add it, then issue a key.'
      USING ERRCODE = '42501';
  END IF;

  -- A write scope needs the separate, dearer add-on.
  v_write := EXISTS (
    SELECT 1 FROM unnest(p_scopes) AS s
    WHERE s LIKE '%:write' OR s = 'communication:send'
  );

  IF v_write AND NOT public.school_has_feature(v_school, 'api_write') THEN
    RAISE EXCEPTION
      'Write scopes need the API Write add-on. Remove them, or ask AfriTech to add it.'
      USING ERRCODE = '42501';
  END IF;

  IF p_expires_at IS NOT NULL AND p_expires_at <= NOW() THEN
    RAISE EXCEPTION 'An expiry date must be in the future' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.school_api_keys
    (school_id, name, key_hash, key_prefix, scopes, expires_at, rate_limit_rpm, created_by)
  VALUES
    (v_school, btrim(p_name), p_key_hash, p_key_prefix, p_scopes,
     p_expires_at, COALESCE(p_rate_limit, 60), v_user)
  RETURNING id INTO v_id;

  PERFORM public.log_audit_event(
    'api_key_issued', 'school_api_keys', v_id,
    jsonb_build_object('name', btrim(p_name), 'scopes', p_scopes, 'prefix', p_key_prefix));

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_api_key(TEXT, TEXT, TEXT, TEXT[], TIMESTAMPTZ, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_api_key(TEXT, TEXT, TEXT, TEXT[], TIMESTAMPTZ, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.issue_api_key(TEXT, TEXT, TEXT, TEXT[], TIMESTAMPTZ, INT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Verifying re-asks, every call.
-- ---------------------------------------------------------------------------

/*
  The gate that is easy to forget.

  Without this a school buys the add-on, issues a key, cancels the add-on, and the
  key works forever. Resolving on every call costs one more predicate on an
  already-indexed lookup, and it is the difference between a subscription and a
  one-off purchase.

  Returning NOTHING rather than a reason is unchanged: an expired key, a revoked
  key, a key for a suspended school, a key whose school dropped the add-on, and a
  key that never existed are all one answer.
*/
CREATE OR REPLACE FUNCTION public.verify_api_key(p_key_hash TEXT)
RETURNS TABLE (
  out_key_id     UUID,
  out_school_id  UUID,
  out_scopes     TEXT[],
  out_rate_limit INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT k.id INTO v_id
  FROM public.school_api_keys k
  JOIN public.schools s ON s.id = k.school_id
  WHERE k.key_hash = p_key_hash
    AND k.is_active
    AND (k.expires_at IS NULL OR k.expires_at > NOW())
    AND s.status = 'active'
    -- The add-on, re-resolved. See the header.
    AND public.school_has_feature(k.school_id, 'api_read');

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.school_api_keys
  SET last_used_at = NOW()
  WHERE id = v_id;

  RETURN QUERY
  SELECT k.id, k.school_id, k.scopes, k.rate_limit_rpm
  FROM public.school_api_keys k
  WHERE k.id = v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_api_key(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_api_key(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.verify_api_key(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.verify_api_key(TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Who is using the API without paying for it.
-- ---------------------------------------------------------------------------

/*
  Deliberately a report rather than an enforcement sweep.

  A school already wired into the API without the add-on is a commercial
  conversation, not a Tuesday-morning outage. This exists so the conversation
  starts from a list.
*/
CREATE OR REPLACE FUNCTION public.admin_api_key_entitlement()
RETURNS TABLE (
  out_school_id   UUID,
  out_school_name TEXT,
  out_active_keys BIGINT,
  out_has_read    BOOLEAN,
  out_has_write   BOOLEAN,
  out_write_scoped BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_afritech_capability('billing:read') THEN
    RAISE EXCEPTION
      'Your AfriTech role does not include revenue data' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT s.id, s.name,
         COUNT(k.id) FILTER (WHERE k.is_active),
         public.school_has_feature(s.id, 'api_read'),
         public.school_has_feature(s.id, 'api_write'),
         bool_or(EXISTS (
           SELECT 1 FROM unnest(k.scopes) AS sc
           WHERE sc LIKE '%:write' OR sc = 'communication:send'
         )) FILTER (WHERE k.is_active)
  FROM public.schools s
  JOIN public.school_api_keys k ON k.school_id = s.id
  GROUP BY s.id, s.name
  HAVING COUNT(k.id) FILTER (WHERE k.is_active) > 0
  ORDER BY s.name;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_api_key_entitlement() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_api_key_entitlement() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_api_key_entitlement() TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Exercise both gates.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_school UUID;
  v_org    TEXT;
  v_hash   TEXT := repeat('c', 64);
  v_found  INT;
  v_has    BOOLEAN;
BEGIN
  BEGIN
    SELECT id, clerk_org_id INTO v_school, v_org
    FROM public.schools
    WHERE status = 'active' AND clerk_org_id IS NOT NULL LIMIT 1;

    IF v_school IS NULL THEN
      RAISE NOTICE '0245: no school fixture; skipping';
      RAISE EXCEPTION 'ZSMS_0245_ROLLBACK';
    END IF;

    v_has := public.school_has_feature(v_school, 'api_read');

    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', 'probe_owner', 'role', 'authenticated',
      'o', json_build_object('id', v_org, 'rol', 'owner'))::text, TRUE);

    IF v_has THEN
      -- The school HAS the add-on: issuing must work.
      PERFORM public.issue_api_key(
        '0245 probe', v_hash, 'zsms_live_p0245', ARRAY['students:read']);
      RAISE NOTICE '0245: school has api_read; issuing succeeded as expected';
    ELSE
      -- It does not: issuing must be refused, naming the add-on.
      BEGIN
        PERFORM public.issue_api_key(
          '0245 probe', v_hash, 'zsms_live_p0245', ARRAY['students:read']);
        RAISE EXCEPTION '0245: a key was issued without the api_read add-on';
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE '0245: issuing correctly refused without api_read';
      END;

      -- Insert one directly to prove VERIFY also refuses it.
      INSERT INTO public.school_api_keys
        (school_id, name, key_hash, key_prefix, scopes, created_by)
      VALUES (v_school, '0245 direct', v_hash, 'zsms_live_p0245',
              ARRAY['students:read'], 'migration_0245');

      SELECT COUNT(*) INTO v_found FROM public.verify_api_key(v_hash);
      IF v_found <> 0 THEN
        RAISE EXCEPTION
          '0245: a key for a school WITHOUT api_read still verified — the API is free';
      END IF;
      RAISE NOTICE '0245: verify correctly refused a key whose school lacks api_read';
    END IF;

    RAISE EXCEPTION 'ZSMS_0245_ROLLBACK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'ZSMS_0245_ROLLBACK' THEN
        RAISE NOTICE '0245: verified — the API is gated on the add-on at issue AND at verify';
      ELSE
        RAISE;
      END IF;
  END;
END;
$$;
