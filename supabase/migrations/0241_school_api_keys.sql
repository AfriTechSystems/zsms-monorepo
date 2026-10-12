-- ===========================================================================
-- 0241 — API keys for external integrations (API_INTEGRATION.md)
--
-- Spec: `03 Infrastructure Services/API_INTEGRATION.md`
--
-- ## What this is for
--
-- A school that already runs its own management system and wants one piece of
-- ZSMS — the loan module, or fee tracking, or communication — without migrating
-- everything. Machine-to-machine, so there is no user session and a Clerk JWT is
-- the wrong instrument.
--
-- ## The key is never stored
--
-- Only `sha256(plaintext)` is kept. A key is shown exactly once, on creation,
-- and cannot be retrieved afterwards — if it is lost, a new one is issued and
-- the old one revoked. A database that can show you the key is one a stolen
-- backup can show an attacker.
--
-- `key_prefix` holds the first 18 characters so a school can tell two keys apart
-- in a list without the database holding anything usable. 18 is enough to be
-- distinctive and far short of the 42-character whole.
--
-- ## Lookup is by hash, so the plaintext never travels to SQL as a predicate
--
-- `verify_api_key()` takes the hash the caller's route computed. The key itself
-- never appears in a query, a query plan, or a slow-query log.
--
-- ## Why a DEFINER function rather than a policy
--
-- There is no session when an API key authenticates — `get_user_id()` is NULL
-- and `current_school_uuid()` is NULL, so every policy that scopes by them
-- refuses. The key IS the identity, and resolving it has to happen before RLS
-- can mean anything. That makes it a SECURITY DEFINER lookup by necessity, not
-- by preference, and the function is correspondingly narrow: it returns a school
-- id and a scope list and nothing else.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The table, to the DDL the document specifies.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.school_api_keys (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,

  name           TEXT NOT NULL CHECK (btrim(name) <> ''),

  /** SHA-256 of the plaintext, hex. The plaintext is shown once and never stored. */
  key_hash       TEXT NOT NULL UNIQUE CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  /** First 18 characters, for telling keys apart in a list. Not usable to authenticate. */
  key_prefix     TEXT NOT NULL,

  /*
    The scopes API_INTEGRATION.md defines, enforced.

    An unconstrained array means a typo stores cleanly and grants nothing — the
    same failure `0236` fixed on permission grants, and just as hard to notice.
  */
  scopes         TEXT[] NOT NULL DEFAULT '{}' CHECK (
    scopes <@ ARRAY[
      'students:read', 'students:write',
      'fees:read', 'fees:write',
      'attendance:read', 'attendance:write',
      'results:read',
      'communication:send',
      'loans:read', 'loans:write',
      'webhooks:receive'
    ]::TEXT[]
  ),

  rate_limit_rpm INT NOT NULL DEFAULT 60 CHECK (rate_limit_rpm BETWEEN 1 AND 6000),

  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at   TIMESTAMPTZ,
  expires_at     TIMESTAMPTZ,

  revoked_at     TIMESTAMPTZ,
  revoked_by     TEXT,

  created_by     TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One live key per name per school, so "the fee system key" is unambiguous.
  CONSTRAINT school_api_keys_name_unique UNIQUE (school_id, name)
);

COMMENT ON TABLE public.school_api_keys IS
  'Machine-to-machine keys for schools integrating one ZSMS module into their own system (API_INTEGRATION.md). Only the SHA-256 hash is stored; the key is shown once (0241).';

CREATE INDEX IF NOT EXISTS idx_api_keys_hash
  ON public.school_api_keys (key_hash) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_api_keys_school
  ON public.school_api_keys (school_id, is_active);

-- ---------------------------------------------------------------------------
-- 2. The call log — what a key did, and what it was refused.
-- ---------------------------------------------------------------------------

/*
  Not in the document, and built anyway.

  A school hands a key to a third-party developer. When something goes wrong at
  2am — a duplicate payment, a pupil created twice — the only question that
  matters is what that key did and when. `audit_logs` records the row change but
  not that it arrived over the API, nor the calls that were REFUSED, and a
  sequence of 403s is the clearest evidence that a key has been stolen.
*/
CREATE TABLE IF NOT EXISTS public.api_key_usage (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id    UUID NOT NULL REFERENCES public.school_api_keys(id) ON DELETE CASCADE,
  school_id     UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,

  method        TEXT NOT NULL,
  path          TEXT NOT NULL,
  status_code   INT NOT NULL,
  /** The scope the route demanded, so a refusal explains itself. */
  required_scope TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_key_usage_key
  ON public.api_key_usage (api_key_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. RLS.
-- ---------------------------------------------------------------------------

ALTER TABLE public.school_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_api_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE public.api_key_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_key_usage FORCE ROW LEVEL SECURITY;

/*
  The owner alone, and not the principal.

  A key is a credential that bypasses the user model entirely — whoever holds it
  acts as the school within its scopes, with no name attached. That is an
  ownership decision, narrower even than the permission grants in `0236`.
*/
CREATE POLICY owner_manage_api_keys
  ON public.school_api_keys
  FOR SELECT TO authenticated
  USING (
    school_id = public.current_school_uuid()
    AND public.get_user_role() = 'org:owner'
  );

CREATE POLICY afritech_read_api_keys
  ON public.school_api_keys
  FOR SELECT TO authenticated
  USING (public.is_afritech_admin());

CREATE POLICY owner_read_api_key_usage
  ON public.api_key_usage
  FOR SELECT TO authenticated
  USING (
    school_id = public.current_school_uuid()
    AND public.get_user_role() = 'org:owner'
  );

-- SELECT only. Issuing and revoking go through the functions below, and the
-- usage log is written by the server. A credential table a user can UPDATE is
-- one where somebody widens their own scopes.
GRANT SELECT ON public.school_api_keys TO authenticated;
GRANT SELECT ON public.api_key_usage TO authenticated;
REVOKE ALL ON public.school_api_keys FROM anon;
REVOKE ALL ON public.api_key_usage FROM anon;

-- ---------------------------------------------------------------------------
-- 4. Issuing.
-- ---------------------------------------------------------------------------

/*
  Takes the HASH, never the key.

  The route generates the key, hashes it, sends the hash here and returns the
  plaintext to the browser once. The plaintext never reaches the database, so it
  cannot appear in a log, a query plan, or a backup.
*/
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

CREATE OR REPLACE FUNCTION public.revoke_api_key(p_key_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_user   TEXT := public.get_user_id();
BEGIN
  IF public.get_user_role() <> 'org:owner' THEN
    RAISE EXCEPTION 'Only the school owner can revoke an API key' USING ERRCODE = '42501';
  END IF;

  -- Soft, so the usage log keeps meaning. A deleted key leaves calls attributed
  -- to nothing, which is the opposite of what a log is for.
  UPDATE public.school_api_keys
  SET is_active = FALSE, revoked_at = NOW(), revoked_by = v_user
  WHERE id = p_key_id AND school_id = v_school AND is_active;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That key is not available' USING ERRCODE = '22023';
  END IF;

  PERFORM public.log_audit_event('api_key_revoked', 'school_api_keys', p_key_id, '{}'::jsonb);
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_api_key(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_api_key(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.revoke_api_key(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Verifying — the hot path.
-- ---------------------------------------------------------------------------

/*
  Called on every API-key request, so it does the minimum: one indexed lookup,
  and a `last_used_at` stamp.

  Returns NOTHING rather than a reason when a key is bad. An expired key, a
  revoked key, a key for a suspended school and a key that never existed are one
  answer — telling a caller which would confirm that a key is real.
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
    -- A suspended school's integrations stop with everything else.
    AND s.status = 'active';

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  /*
    Stamped on use, which makes "this key has not been touched in a year" a
    question somebody can answer before deciding to revoke it.
  */
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
-- `service_role` only: this is called by the server before any user identity
-- exists, and `authenticated` must never be able to probe hashes.
GRANT EXECUTE ON FUNCTION public.verify_api_key(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.record_api_key_usage(
  p_key_id   UUID,
  p_method   TEXT,
  p_path     TEXT,
  p_status   INT,
  p_scope    TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.api_key_usage
    (api_key_id, school_id, method, path, status_code, required_scope)
  SELECT p_key_id, k.school_id, p_method, left(p_path, 200), p_status, p_scope
  FROM public.school_api_keys k WHERE k.id = p_key_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_api_key_usage(UUID, TEXT, TEXT, INT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_api_key_usage(UUID, TEXT, TEXT, INT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_api_key_usage(UUID, TEXT, TEXT, INT, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. The 0149 status guard and the audit trigger.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  EXECUTE 'DROP TRIGGER IF EXISTS audit_changes_on_school_api_keys ON public.school_api_keys';
  EXECUTE 'CREATE TRIGGER audit_changes_on_school_api_keys
             AFTER INSERT OR UPDATE OR DELETE ON public.school_api_keys
             FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()';
  -- `api_key_usage` is append-only server-written telemetry; auditing an audit
  -- log doubles the write volume and answers nothing new.
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Exercise it.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_school UUID;
  v_org    TEXT;
  v_id     UUID;
  v_hash   TEXT := repeat('a', 64);
  v_found  INT;
BEGIN
  BEGIN
    SELECT id, clerk_org_id INTO v_school, v_org
    FROM public.schools WHERE status = 'active' AND clerk_org_id IS NOT NULL LIMIT 1;

    IF v_school IS NULL THEN
      RAISE NOTICE '0241: no active school; skipping';
      RAISE EXCEPTION 'ZSMS_0241_ROLLBACK';
    END IF;

    -- A principal must not be able to issue one.
    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', 'probe_principal', 'role', 'authenticated',
      'o', json_build_object('id', v_org, 'rol', 'principal'))::text, TRUE);
    BEGIN
      PERFORM public.issue_api_key('Probe', v_hash, 'zsms_live_probe', ARRAY['students:read']);
      RAISE EXCEPTION '0241: a principal issued an API key';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    -- The owner may.
    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', 'probe_owner', 'role', 'authenticated',
      'o', json_build_object('id', v_org, 'rol', 'owner'))::text, TRUE);

    v_id := public.issue_api_key(
      'Fee System', v_hash, 'zsms_live_abc12345', ARRAY['fees:read', 'students:read']);

    IF v_id IS NULL THEN
      RAISE EXCEPTION '0241: issuing returned no id';
    END IF;

    -- An invented scope must be refused, not stored.
    BEGIN
      PERFORM public.issue_api_key(
        'Bad Scope', repeat('b', 64), 'zsms_live_bad', ARRAY['everything:read']);
      RAISE EXCEPTION '0241: an unknown scope was accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- Verification resolves the school and the scopes.
    SELECT COUNT(*) INTO v_found FROM public.verify_api_key(v_hash);
    IF v_found <> 1 THEN
      RAISE EXCEPTION '0241: a live key did not verify (% rows)', v_found;
    END IF;

    -- A wrong hash resolves nothing, and says nothing about why.
    SELECT COUNT(*) INTO v_found FROM public.verify_api_key(repeat('f', 64));
    IF v_found <> 0 THEN
      RAISE EXCEPTION '0241: an unknown hash verified';
    END IF;

    -- Revoking stops it.
    PERFORM public.revoke_api_key(v_id);
    SELECT COUNT(*) INTO v_found FROM public.verify_api_key(v_hash);
    IF v_found <> 0 THEN
      RAISE EXCEPTION '0241: a revoked key still verifies';
    END IF;

    RAISE EXCEPTION 'ZSMS_0241_ROLLBACK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'ZSMS_0241_ROLLBACK' THEN
        RAISE NOTICE '0241: verified — owner only, scopes constrained, verify resolves, revoke stops it';
      ELSE
        RAISE;
      END IF;
  END;
END;
$$;
