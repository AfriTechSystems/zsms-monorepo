-- Migration: 0146_create_school_conflict_target.sql
-- Created: 2026-09-29
-- Description: `admin_create_school()` raised "column reference school_id is ambiguous" on every
--              call. An ON CONFLICT target is substituted against PL/pgSQL variables.
-- Related documents: Official Documentation/06 School and Tenant Management/SCHOOL_SETUP.md
--
-- ===========================================================================
-- THE ONE PLACE A RETURNS TABLE COLUMN NAME BITES
--
-- `admin_create_school()` declares `RETURNS TABLE (id, school_id, clerk_slug, name, status, ...)`,
-- and every one of those is a PL/pgSQL variable for the whole function body. That is normally
-- harmless — `admin_update_school_commercial()` in `0140` returns the same shape and has always
-- worked — because every statement in these functions qualifies its columns.
--
-- **`ON CONFLICT (school_id, item_key)` cannot be qualified.** The conflict target is parsed as a
-- list of index expressions, so PL/pgSQL substitutes variables into it, and `school_id` matches
-- the OUT parameter as well as the column. Postgres cannot tell which is meant and refuses.
--
-- Nothing catches this before execution: the function body is only parsed when it first runs, so
-- the migration applies cleanly, `npm run db:push` reports success, and the failure arrives on the
-- first call. Here that was the first pgTAP assertion that created a school.
--
-- Rewritten as `NOT EXISTS`, where every reference can be and is qualified. The alternatives were
-- renaming the OUT parameters to the `out_` prefix the `worker_*` functions use — which would
-- change the shape every caller reads — or `#variable_conflict use_column`, which fixes this line
-- by changing name resolution for the entire body, including statements written later by someone
-- who does not know the pragma is there.
-- ===========================================================================

-- === MIGRATION START ===

CREATE OR REPLACE FUNCTION public.admin_create_school(
  p_name              TEXT,
  p_type              TEXT,
  p_level             TEXT,
  p_province_code     TEXT,
  p_city_code         TEXT,
  p_owner_first_name  TEXT,
  p_owner_last_name   TEXT,
  p_owner_email       TEXT,
  p_owner_phone_e164  TEXT DEFAULT NULL,
  p_subscription_tier TEXT DEFAULT 'starter',
  p_address           TEXT DEFAULT NULL,
  p_ministry_reg_number TEXT DEFAULT NULL,
  p_internal_notes    TEXT DEFAULT NULL,
  p_country_code      TEXT DEFAULT 'ZM'
)
RETURNS TABLE (
  id            UUID,
  school_id     TEXT,
  clerk_slug    TEXT,
  name          TEXT,
  status        TEXT,
  province_code TEXT,
  city_code     TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, afritech, pg_temp
AS $$
DECLARE
  v_sequence  INT;
  v_school_id TEXT;
  v_slug      TEXT;
  v_new_id    UUID;
BEGIN
  IF COALESCE(public.is_afritech_admin(), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Only AfriTech creates a school.' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(BTRIM(p_name), '') = '' THEN
    RAISE EXCEPTION 'A school needs a name.' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(BTRIM(p_owner_email), '') = '' THEN
    RAISE EXCEPTION 'A school needs an owner email — it is how the owner is invited.'
      USING ERRCODE = '22023';
  END IF;

  /**
   * Serialise identifier allocation for this country and city.
   *
   * `pg_advisory_xact_lock` on the hash of the pair: two creations in Lusaka queue, a creation in
   * Lusaka and one in Ndola do not. Released automatically at commit, so the lock is held only for
   * the insert below and never across the Clerk call, which happens in a later request entirely.
   */
  PERFORM pg_advisory_xact_lock(hashtext(p_country_code || ':' || p_city_code));

  v_sequence  := public.get_next_school_sequence(p_country_code, p_city_code);
  v_school_id := p_country_code || '-' || p_city_code || '-' || LPAD(v_sequence::TEXT, 4, '0');
  v_slug      := LOWER(v_school_id);

  /**
   * Business rule 2 of SCHOOL_SETUP.md: the AfriTech organisation slug is permanently reserved.
   *
   * A generated slug is always `cc-city-nnnn`, so it cannot structurally collide with
   * `afritech-systems-admin`. Checked anyway, because the rule is about the reserved name and not
   * about today's format — if the format ever changes, this is the line that catches it, and a
   * school provisioned into the AfriTech organisation's slug would be a tenancy breach rather
   * than a naming inconvenience.
   */
  IF v_slug IN ('afritech-systems-admin', 'afritech', 'admin') THEN
    RAISE EXCEPTION 'Generated slug % is reserved.', v_slug USING ERRCODE = '42710';
  END IF;

  INSERT INTO public.schools (
    school_id, clerk_org_id, name, type, level,
    country_code, province_code, city_code,
    address, ministry_reg_number, status, subscription_tier, trial_ends_at
  )
  VALUES (
    v_school_id,
    -- The placeholder. Not a Clerk id (those begin `org_`), unique by construction, and matched by
    -- no JWT — so this row is reachable by nobody until admin_attach_clerk_org() replaces it.
    'pending_' || gen_random_uuid()::TEXT,
    BTRIM(p_name), p_type, p_level,
    p_country_code, p_province_code, p_city_code,
    p_address, p_ministry_reg_number,
    -- AfriTech-created schools are never `trial`. Business rule 3 of SCHOOL_SETUP.md, and
    -- business rule 1 of TRIAL.md: manual onboarding skips the trial entirely.
    'pending_verification',
    p_subscription_tier,
    NULL
  )
  RETURNING schools.id INTO v_new_id;

  INSERT INTO public.school_onboarding (
    school_id, source,
    owner_first_name, owner_last_name, owner_email, owner_phone_e164,
    internal_notes, created_by
  )
  VALUES (
    v_new_id, 'afritech',
    BTRIM(p_owner_first_name), BTRIM(p_owner_last_name),
    LOWER(BTRIM(p_owner_email)), p_owner_phone_e164,
    p_internal_notes, public.get_user_id()
  );

  /**
   * Every catalogue item, incomplete. Inlined rather than calling ensure_onboarding_checklist()
   * so this stays one transaction with one authorisation check.
   *
   * NOT EXISTS rather than ON CONFLICT — see this migration's header. The school was created three
   * statements ago, so nothing can collide; the guard is here to keep the statement idempotent if
   * it is ever reused.
   */
  INSERT INTO public.onboarding_checklists (school_id, item_key)
  SELECT v_new_id, i.item_key
    FROM afritech.onboarding_checklist_items i
   WHERE i.is_active
     AND NOT EXISTS (
       SELECT 1 FROM public.onboarding_checklists c
        WHERE c.school_id = v_new_id
          AND c.item_key  = i.item_key
     );

  PERFORM public.log_audit_event(
    'school_created', 'schools', v_new_id,
    jsonb_build_object(
      'school_code', v_school_id,
      'source', 'afritech',
      'tier', p_subscription_tier,
      'owner_email', LOWER(BTRIM(p_owner_email))
    ),
    v_new_id
  );

  RETURN QUERY
  SELECT s.id, s.school_id, v_slug, s.name, s.status, s.province_code, s.city_code
    FROM public.schools s WHERE s.id = v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_school(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;

COMMENT ON FUNCTION public.admin_create_school(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) IS
  'Allocates the school identifier and inserts the school, the onboarding record and the full '
  'checklist in one transaction. Leaves clerk_org_id as a placeholder — the caller then creates '
  'the Clerk organisation with the returned clerk_slug and calls admin_attach_clerk_org(). '
  'Rewritten in 0146: an ON CONFLICT target collided with the school_id OUT parameter.';

-- === MIGRATION END ===
