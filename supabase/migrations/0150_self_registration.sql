-- Migration: 0150_self_registration.sql
-- Created: 2026-09-30
-- Description: Path 2 — a school owner registers their own school and starts a 30-day trial.
-- Related documents: Official Documentation/06 School and Tenant Management/SCHOOL_SETUP.md
--                    Official Documentation/06 School and Tenant Management/TRIAL.md
--                    Official Documentation/01 Foundation Layer/COMPLIANCE.md
--
-- ===========================================================================
-- A PUBLIC ENDPOINT THAT CREATES A TENANT IS THE RISKIEST SURFACE IN THE PRODUCT
--
-- Everything else in this schema defends a boundary that already exists. `admin_create_school()`
-- draws a new one and is gated on `is_afritech_admin()`. This function draws a new one for
-- **anyone who asks**, which needs its own reasoning rather than a copy of that one's.
--
-- ---------------------------------------------------------------------------
-- THE CALLER MUST ALREADY BE AUTHENTICATED, WHICH REORDERS THE DOCUMENTED FLOW
-- ---------------------------------------------------------------------------
-- `SCHOOL_SETUP.md` describes a fully public three-step form that creates the school and then
-- "School owner Clerk account created with email OTP verification". Built in that order, the
-- endpoint is reachable by anybody with `curl` and every request mints a school identifier, a Clerk
-- organisation and fourteen checklist rows. There is no rate limiter to put in front of it —
-- Upstash Redis does not exist yet (see CREDENTIALS_CHECKLIST.md) — so the abuse ceiling would be
-- whatever a script can do in an afternoon.
--
-- So the two halves are **swapped**: the visitor signs up with Clerk first (email OTP, which Clerk
-- rate-limits and verifies), and only a session with a verified email can call this. The end state
-- is identical to the document's — a school, an organisation, an owner — and the verification that
-- was going to happen anyway now happens before anything is created rather than after.
--
-- It also removes a step. The registering user **becomes** the owner rather than being emailed an
-- invitation to a school they just created, which is a confusing email to receive.
--
-- ---------------------------------------------------------------------------
-- ONE OPEN TRIAL PER PERSON
-- ---------------------------------------------------------------------------
-- A verified email raises the cost of abuse; it does not cap it. `school_onboarding.created_by`
-- records who registered each school, so the guard below refuses a second registration while the
-- caller still has one in `trial`.
--
-- Deliberately narrow. It does **not** stop somebody who genuinely runs two schools — they finish
-- or convert the first trial, or AfriTech creates the second for them, which is the path a real
-- multi-school owner is on anyway (`my_schools()` has always supported it). What it stops is one
-- account opening trials in a loop.
--
-- ---------------------------------------------------------------------------
-- TERMS AND PRIVACY ARE RECORDED, NOT ASSUMED
-- ---------------------------------------------------------------------------
-- `SCHOOL_SETUP.md` step 3 requires both checkboxes. A checkbox that gates a button and leaves no
-- row behind is not consent anybody can later evidence — and under the Zambia Data Protection Act
-- the school is about to become a data controller for several hundred children. Both timestamps are
-- columns, both are required by this function, and the API cannot pass them unless the caller
-- actually ticked.
-- ===========================================================================

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- 1. Consent, as data.
-- ---------------------------------------------------------------------------
ALTER TABLE public.school_onboarding
  ADD COLUMN IF NOT EXISTS terms_accepted_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS privacy_accepted_at TIMESTAMPTZ;

COMMENT ON COLUMN public.school_onboarding.terms_accepted_at IS
  'When the registering owner accepted the Terms of Service. NULL for an AfriTech-created school, '
  'where the agreement is signed outside the product.';

COMMENT ON COLUMN public.school_onboarding.privacy_accepted_at IS
  'When the registering owner accepted the Privacy Policy. Evidence of consent for ZDPA purposes — '
  'the school becomes a data controller for its pupils.';

-- ---------------------------------------------------------------------------
-- 2. Registration.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_school(
  p_name             TEXT,
  p_type             TEXT,
  p_level            TEXT,
  p_province_code    TEXT,
  p_city_code        TEXT,
  p_owner_first_name TEXT,
  p_owner_last_name  TEXT,
  p_owner_email      TEXT,
  p_owner_phone_e164 TEXT DEFAULT NULL,
  p_referral_source  TEXT DEFAULT NULL,
  p_country_code     TEXT DEFAULT 'ZM'
)
RETURNS TABLE (
  -- `out_` prefixed throughout. 0146 and 0147 each cost a CI round trip to a RETURNS TABLE column
  -- name colliding with a column inside the body; the prefix makes that impossible here.
  out_id            UUID,
  out_school_id     TEXT,
  out_clerk_slug    TEXT,
  out_trial_ends_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, afritech, pg_temp
AS $$
DECLARE
  v_caller    TEXT;
  v_sequence  INT;
  v_code      TEXT;
  v_slug      TEXT;
  v_new_id    UUID;
  v_trial_end TIMESTAMPTZ;
BEGIN
  v_caller := public.get_user_id();

  /**
   * An authenticated caller and nothing more. No role is required and none is checked: the person
   * registering has no organisation yet, so they hold no `org:*` role and `current_school_uuid()`
   * is NULL for them. Requiring one would make the function uncallable by exactly the people it
   * exists for.
   */
  IF v_caller IS NULL OR v_caller = '' THEN
    RAISE EXCEPTION
      'Sign in before registering a school. Registration needs a verified email address.'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(BTRIM(p_name), '') = '' THEN
    RAISE EXCEPTION 'A school needs a name.' USING ERRCODE = '22023';
  END IF;

  -- One open trial per person. See the header for why this is narrow on purpose.
  IF EXISTS (
    SELECT 1
      FROM public.school_onboarding o
      JOIN public.schools s ON s.id = o.school_id
     WHERE o.created_by = v_caller
       AND o.source = 'self_registration'
       AND s.status = 'trial'
  ) THEN
    RAISE EXCEPTION
      'You already have a school on trial. Finish or convert it first, or ask AfriTech to set up '
      'the second one for you.'
      USING ERRCODE = '42710';
  END IF;

  -- Same advisory lock as admin_create_school(). Without it two simultaneous registrations in one
  -- city read the same MAX and mint the same identifier.
  PERFORM pg_advisory_xact_lock(hashtext(p_country_code || ':' || p_city_code));

  v_sequence := public.get_next_school_sequence(p_country_code, p_city_code);
  v_code     := p_country_code || '-' || p_city_code || '-' || LPAD(v_sequence::TEXT, 4, '0');
  v_slug     := LOWER(v_code);

  IF v_slug IN ('afritech-systems-admin', 'afritech', 'admin') THEN
    RAISE EXCEPTION 'Generated slug % is reserved.', v_slug USING ERRCODE = '42710';
  END IF;

  /**
   * Thirty days, per TRIAL.md. Hardcoded rather than read from configuration, and that is a
   * deliberate limit of this migration rather than a claim that it should never change: a
   * promotional 14- or 60-day trial is a marketing decision that wants a row somewhere, and there
   * is no platform-settings table to put it in yet. Tracked in CLAUDE.md.
   */
  v_trial_end := NOW() + INTERVAL '30 days';

  INSERT INTO public.schools (
    school_id, clerk_org_id, name, type, level,
    country_code, province_code, city_code,
    status, subscription_tier, trial_ends_at
  )
  VALUES (
    v_code,
    -- Placeholder until the route creates the Clerk organisation and attaches it. Matches no JWT,
    -- so the school is reachable by nobody in the meantime — including the person registering.
    'pending_' || gen_random_uuid()::TEXT,
    BTRIM(p_name), p_type, p_level,
    p_country_code, p_province_code, p_city_code,
    -- `trial`, never `pending_verification`. Business rule 3 of SCHOOL_SETUP.md is explicit that
    -- the two paths produce different statuses, and it is the difference between "we vouched for
    -- this school" and "this school vouched for itself".
    'trial',
    'starter',
    v_trial_end
  )
  RETURNING schools.id INTO v_new_id;

  INSERT INTO public.school_onboarding (
    school_id, source,
    owner_first_name, owner_last_name, owner_email, owner_phone_e164,
    referral_source, created_by,
    terms_accepted_at, privacy_accepted_at,
    -- They are the caller. There is no invitation to wait for, so acceptance is now.
    owner_accepted_at
  )
  VALUES (
    v_new_id, 'self_registration',
    BTRIM(p_owner_first_name), BTRIM(p_owner_last_name),
    LOWER(BTRIM(p_owner_email)), p_owner_phone_e164,
    p_referral_source, v_caller,
    NOW(), NOW(),
    NOW()
  );

  -- NOT EXISTS rather than ON CONFLICT, per 0146.
  INSERT INTO public.onboarding_checklists (school_id, item_key)
  SELECT v_new_id, i.item_key
    FROM afritech.onboarding_checklist_items i
   WHERE i.is_active
     AND NOT EXISTS (
       SELECT 1 FROM public.onboarding_checklists c
        WHERE c.school_id = v_new_id AND c.item_key = i.item_key
     );

  PERFORM public.log_audit_event(
    'school_registered', 'schools', v_new_id,
    jsonb_build_object(
      'school_code', v_code,
      'source', 'self_registration',
      'trial_ends_at', v_trial_end,
      'referral_source', p_referral_source
    ),
    v_new_id
  );

  RETURN QUERY
  SELECT s.id, s.school_id, v_slug, s.trial_ends_at
    FROM public.schools s WHERE s.id = v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_school(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;

/**
 * NOT granted to `anon`, and that is the security boundary rather than an oversight.
 *
 * An anonymous caller has no verified email, so nothing would connect a created school to a real
 * person, and there is no rate limiter in front of this yet. `authenticated` means Clerk has
 * already verified an email address by OTP.
 */
REVOKE ALL ON FUNCTION public.register_school(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM anon;

COMMENT ON FUNCTION public.register_school(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) IS
  'Self-registration (SCHOOL_SETUP.md Path 2). Creates a trial school for the CALLING user, who '
  'becomes its owner. Requires an authenticated session — never granted to anon — and refuses a '
  'second registration while the caller has one still on trial.';

-- ---------------------------------------------------------------------------
-- 3. Attaching the organisation, for a caller who is not AfriTech.
-- ---------------------------------------------------------------------------
/**
 * `admin_attach_clerk_org()` (0144) requires `is_afritech_admin()`, so a self-registering owner
 * cannot finish their own provisioning with it.
 *
 * This one is scoped by authorship instead: it attaches an organisation only to a school that the
 * calling user registered, and only while that school still holds a placeholder. Both halves
 * matter — the placeholder check means the window closes after one use, and the authorship check
 * means the window is only ever open for the one person it belongs to.
 */
CREATE OR REPLACE FUNCTION public.attach_own_registered_school(
  p_school_id    UUID,
  p_clerk_org_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller   TEXT;
  v_existing TEXT;
BEGIN
  v_caller := public.get_user_id();
  IF v_caller IS NULL OR v_caller = '' THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  SELECT s.clerk_org_id INTO v_existing
    FROM public.schools s
    JOIN public.school_onboarding o ON o.school_id = s.id
   WHERE s.id = p_school_id
     AND o.created_by = v_caller
     AND o.source = 'self_registration';

  -- Indistinguishable from "no such school", deliberately. Telling a caller that a school exists
  -- but is somebody else's confirms the existence of another tenant.
  IF v_existing IS NULL THEN
    RAISE EXCEPTION 'No school of yours is awaiting an organisation.' USING ERRCODE = 'P0002';
  END IF;

  IF v_existing NOT LIKE 'pending\_%' THEN
    RAISE EXCEPTION 'That school is already set up.' USING ERRCODE = '42710';
  END IF;

  IF p_clerk_org_id IS NULL OR p_clerk_org_id NOT LIKE 'org\_%' THEN
    RAISE EXCEPTION 'That is not a Clerk organisation id.' USING ERRCODE = '22023';
  END IF;

  -- Aliased, per 0147.
  UPDATE public.schools AS s
     SET clerk_org_id = p_clerk_org_id,
         updated_at   = NOW()
   WHERE s.id = p_school_id;

  PERFORM public.log_audit_event(
    'school_provisioned', 'schools', p_school_id,
    jsonb_build_object('clerk_org_id', p_clerk_org_id, 'source', 'self_registration'),
    p_school_id
  );

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.attach_own_registered_school(UUID, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.attach_own_registered_school(UUID, TEXT) FROM anon;

COMMENT ON FUNCTION public.attach_own_registered_school(UUID, TEXT) IS
  'Lets a self-registering owner finish their own provisioning. Scoped to schools the caller '
  'registered AND still holding a placeholder, so the window closes after one use.';

-- === MIGRATION END ===
