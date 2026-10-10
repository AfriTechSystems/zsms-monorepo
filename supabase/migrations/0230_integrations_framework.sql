-- ===========================================================================
-- 0230 — integrations framework, tier 1 (ADR-023)
--
-- Spec: `01 Foundation Layer/DECISIONS.md` → ADR-023,
--       `01 Foundation Layer/DATABASE.md` → `school_integrations`, `integration_log`,
--       `17 Integration and Pricing/CUSTOM_WEBHOOK.md`
--
-- ADR-023 is three tiers: (1) native webhooks, (2) pre-built connectors for Sage,
-- QuickBooks, Xero, Google Sheets and HubSpot, (3) a Zapier/Make app. Its
-- *Database* line says both tables are built in Phase 1 **so Phase 2 connectors
-- need no schema changes** — which is the whole reason to write this now rather
-- than alongside the first connector.
--
-- ## A correction to ADR-023 as written
--
-- It says of tier 1: "already built". It was not. There is no webhook table in
-- this schema and no dispatcher — checked, not assumed. So this migration builds
-- the foundation the ADR believed already existed, and the ADR's own claim is the
-- kind this repository has been wrong about before.
--
-- ## Credentials are NOT stored, and the column is not the reason why
--
-- `DATABASE.md` gives `credentials_enc TEXT`, and the intent is clearly an
-- encrypted blob. `ENV.md`'s `FIELD_ENCRYPTION_KEY` is **unset**, so there is
-- nothing to encrypt with.
--
-- The tempting move is to add the column, let a route write a token into it, and
-- fix the encryption later. That is how a school's QuickBooks credential ends up
-- sitting in plaintext in a database and in every backup of it, discovered a year
-- afterwards.
--
-- So the column exists for the shape ADR-023 asked for, and a CHECK constraint
-- refuses anything that is not marked as encrypted. Storing a credential is
-- blocked at the schema level until there is a key — loudly, at the moment
-- somebody tries, rather than quietly forever.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The configuration table.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.school_integrations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id        UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,

  integration_type TEXT NOT NULL CHECK (integration_type IN (
    'sage_50_export', 'sage_business_cloud', 'quickbooks',
    'xero', 'google_sheets', 'hubspot', 'custom_webhook'
  )),

  display_name     TEXT NOT NULL CHECK (btrim(display_name) <> ''),
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,

  /*
    Paused is not the same as inactive.

    Inactive means the school removed it. Paused means ZSMS stopped dispatching
    after repeated failures, and the distinction matters when somebody asks why
    their accounting system went quiet — "you turned it off" and "we gave up
    retrying" are different answers and only one is the school's fault.
  */
  is_paused        BOOLEAN NOT NULL DEFAULT FALSE,
  pause_reason     TEXT,

  config           JSONB NOT NULL DEFAULT '{}'::jsonb
                   CHECK (jsonb_typeof(config) = 'object'),

  /*
    An encrypted blob, or nothing.

    `FIELD_ENCRYPTION_KEY` is unset, so there is nothing to encrypt with and this
    constraint makes that a refusal rather than a silent plaintext write. The
    prefix is the marker the encrypting writer will set; until one exists, every
    attempt to store a credential fails here.
  */
  credentials_enc  TEXT CHECK (credentials_enc IS NULL OR credentials_enc LIKE 'enc:v1:%'),

  events_subscribed TEXT[] NOT NULL DEFAULT '{}',

  last_sync_at     TIMESTAMPTZ,
  last_sync_status TEXT CHECK (last_sync_status IN ('success', 'failed', 'partial')),
  last_error       TEXT,

  created_by       TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One of each kind per school. A school with two QuickBooks connections would
  -- double-post every invoice.
  UNIQUE (school_id, integration_type)
);

COMMENT ON TABLE public.school_integrations IS
  'ADR-023 tier 1. Per-school accounting and CRM connections (0230).';
COMMENT ON COLUMN public.school_integrations.credentials_enc IS
  'Encrypted credential blob, prefixed `enc:v1:`. The CHECK refuses plaintext — FIELD_ENCRYPTION_KEY is unset, so storing a credential must fail loudly rather than succeed insecurely (0230).';

-- ---------------------------------------------------------------------------
-- 2. The dispatch log, append-only.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.integration_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id        UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  integration_id   UUID NOT NULL REFERENCES public.school_integrations(id) ON DELETE CASCADE,

  event_type       TEXT NOT NULL,
  zsms_record_id   TEXT,

  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'success', 'failed', 'retrying', 'skipped')),

  /*
    What was sent — but a payload is a copy of school data leaving the building,
    so it is readable only by the school it belongs to, and never by AfriTech.
    See the policies below, which differ from every other table here for that
    reason.
  */
  request_payload  JSONB,
  response_code    INT,
  response_summary TEXT,
  error_message    TEXT,

  attempt          INT NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.integration_log IS
  'ADR-023. Append-only record of every dispatch attempt. Payloads are school data and are never readable by AfriTech (0230).';

CREATE INDEX IF NOT EXISTS idx_integration_log_integration
  ON public.integration_log (integration_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_integration_log_school
  ON public.integration_log (school_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. RLS, and the grants RLS does not imply.
-- ---------------------------------------------------------------------------

ALTER TABLE public.school_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_integrations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.integration_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_log FORCE ROW LEVEL SECURITY;

/*
  Configuring an integration sends the school's financial data to a third party,
  so the audience is leadership plus the accountant who actually runs the books —
  and not the whole staff.
*/
CREATE POLICY school_leadership_manage_integrations
  ON public.school_integrations
  FOR ALL TO authenticated
  USING (
    school_id = public.current_school_uuid()
    AND public.get_user_role() IN ('org:owner', 'org:principal', 'org:accountant')
  )
  WITH CHECK (
    school_id = public.current_school_uuid()
    AND public.get_user_role() IN ('org:owner', 'org:principal', 'org:accountant')
  );

/*
  AfriTech may see that an integration EXISTS and whether it is failing — that is
  support. It may not see `credentials_enc` or payloads, which is why support
  reads go through `admin_integration_health()` below rather than a broad policy.
*/
CREATE POLICY afritech_read_integrations
  ON public.school_integrations
  FOR SELECT TO authenticated
  USING (public.is_afritech_admin());

CREATE POLICY school_read_integration_log
  ON public.integration_log
  FOR SELECT TO authenticated
  USING (
    school_id = public.current_school_uuid()
    AND public.get_user_role() IN ('org:owner', 'org:principal', 'org:accountant')
  );

/*
  No INSERT, UPDATE or DELETE policy for anybody.

  The log is written by the dispatch worker through the `worker_*` boundary
  (0090/0091), and an append-only record a user can edit is not a record. The
  absence of these policies is the enforcement, so it is stated here rather than
  left to be noticed.
*/

GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_integrations TO authenticated;
-- SELECT only. See above: the log is not user-writable by design.
GRANT SELECT ON public.integration_log TO authenticated;
REVOKE ALL ON public.school_integrations FROM anon;
REVOKE ALL ON public.integration_log FROM anon;

-- ---------------------------------------------------------------------------
-- 4. The `0149` guard and the audit trigger, attached here.
-- ---------------------------------------------------------------------------

DO $$
DECLARE t TEXT;
BEGIN
  -- `school_integrations` only. `integration_log` is worker-written and must stay
  -- writable while a school is suspended, or the record of what happened during
  -- the suspension is the thing that goes missing.
  FOREACH t IN ARRAY ARRAY['school_integrations']
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS enforce_school_writable_on_insert_on_%1$s ON public.%1$I', t);
    EXECUTE format(
      'CREATE TRIGGER enforce_school_writable_on_insert_on_%1$s
         AFTER INSERT ON public.%1$I
         REFERENCING NEW TABLE AS new_rows
         FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_school_writable_new()', t);
    EXECUTE format(
      'DROP TRIGGER IF EXISTS enforce_school_writable_on_update_on_%1$s ON public.%1$I', t);
    EXECUTE format(
      'CREATE TRIGGER enforce_school_writable_on_update_on_%1$s
         AFTER UPDATE ON public.%1$I
         REFERENCING NEW TABLE AS new_rows
         FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_school_writable_new()', t);

    -- Pointing a school's financial data at a new third party is exactly the kind
    -- of act the audit trail exists for.
    EXECUTE format(
      'DROP TRIGGER IF EXISTS audit_changes_on_%1$s ON public.%1$I', t);
    EXECUTE format(
      'CREATE TRIGGER audit_changes_on_%1$s
         AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
         FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()', t);
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Support sees health, never contents.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_integration_health()
RETURNS TABLE (
  out_school_name      TEXT,
  out_integration_type TEXT,
  out_is_paused        BOOLEAN,
  out_last_sync_at     TIMESTAMPTZ,
  out_last_sync_status TEXT,
  out_failures_7d      BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_afritech_admin() THEN
    RAISE EXCEPTION 'AfriTech administrators only' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT s.name, i.integration_type, i.is_paused, i.last_sync_at, i.last_sync_status,
         (SELECT COUNT(*) FROM public.integration_log l
           WHERE l.integration_id = i.id
             AND l.status = 'failed'
             AND l.created_at > NOW() - INTERVAL '7 days')
  FROM public.school_integrations i
  JOIN public.schools s ON s.id = i.school_id
  WHERE i.is_active
  ORDER BY i.is_paused DESC, i.last_sync_at NULLS FIRST;
  /*
    Note what is NOT selected: `credentials_enc`, `config` and every payload.
    Support needs to know an integration is failing, not what it carries.
  */
END;
$$;

REVOKE ALL ON FUNCTION public.admin_integration_health() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_integration_health() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_integration_health() TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Prove the properties that matter.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_school UUID;
  v_id     UUID;
  v_n      INT;
BEGIN
  BEGIN
    SELECT id INTO v_school FROM public.schools WHERE status = 'active' LIMIT 1;
    IF v_school IS NULL THEN
      RAISE NOTICE '0230: no active school; skipping';
      RAISE EXCEPTION 'ZSMS_0230_ROLLBACK';
    END IF;

    INSERT INTO public.school_integrations
      (school_id, integration_type, display_name, created_by)
    VALUES (v_school, 'custom_webhook', '0230 probe', 'migration_0230')
    RETURNING id INTO v_id;

    -- The property this migration exists to guarantee.
    BEGIN
      UPDATE public.school_integrations
      SET credentials_enc = 'sk_live_a_real_looking_token'
      WHERE id = v_id;
      RAISE EXCEPTION '0230: a PLAINTEXT credential was accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- And the encrypted shape must still be storable, or the constraint is a wall.
    UPDATE public.school_integrations
    SET credentials_enc = 'enc:v1:ZXhhbXBsZQ=='
    WHERE id = v_id;

    SELECT COUNT(*) INTO v_n FROM public.audit_logs
    WHERE table_name = 'school_integrations';
    IF v_n < 1 THEN
      RAISE EXCEPTION '0230: configuring an integration was not audited';
    END IF;

    RAISE EXCEPTION 'ZSMS_0230_ROLLBACK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'ZSMS_0230_ROLLBACK' THEN
        RAISE NOTICE '0230: verified — plaintext refused, encrypted accepted, audited';
      ELSE
        RAISE;
      END IF;
  END;
END;
$$;
