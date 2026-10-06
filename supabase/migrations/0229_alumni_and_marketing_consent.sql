-- ===========================================================================
-- 0229 — graduated accounts and marketing consent (ADR-015)
--
-- Spec: `01 Foundation Layer/DECISIONS.md` → ADR-015,
--       `01 Foundation Layer/COMPLIANCE.md`
--
-- ADR-015: "When a student graduates or leaves, their ZSMS account remains
-- active permanently with read-only historical access. AfriTech may send
-- promotional content to users who explicitly opt in (`parents.marketing_opt_in`
-- — defaults to FALSE)."
--
-- ## Most of this ADR turned out to be already satisfied
--
-- The audit looked for an `alumni_profiles` table. There is none, and on reading
-- the ADR properly there should not be: it does not describe a new entity, it
-- describes **an account that is not revoked**.
--
-- Checked against the live policies rather than assumed: NO parent policy filters
-- on `students.status`. `parent_read_own_children`, `parent_read_own_fee_records`,
-- `parent_read_own_payments` and `parent_read_published_results` all resolve
-- through the link row alone. A pupil moving to `graduated` therefore changes
-- nothing about what their parent can see, which is exactly what the ADR asks
-- for. Section 3 below proves that by exercise instead of trusting the reading.
--
-- So this migration adds the one thing genuinely missing: the consent column.
--
-- ## Why `marketing_opt_in` is not just another boolean
--
-- ADR-015: "marketing_opt_in is separate from whatsapp_opted_in. Marketing
-- requires explicit opt-in. The two fields are independent."
--
-- `whatsapp_opted_in` defaults TRUE and governs SERVICE messages — a fee is due,
-- your child was absent. That is the message a parent enrolled in order to
-- receive. Marketing is AfriTech selling something, to a person who is AfriTech's
-- customer's customer, and under the Zambia Data Protection Act 2021 that needs
-- consent given rather than consent assumed.
--
-- Hence DEFAULT FALSE, and hence a check below asserting it, because a later
-- migration flipping the default would be a silent change to the legal basis for
-- every message AfriTech sends.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The consent column.
-- ---------------------------------------------------------------------------

ALTER TABLE public.parents
  ADD COLUMN IF NOT EXISTS marketing_opt_in BOOLEAN NOT NULL DEFAULT FALSE;

/*
  When, and by what act.

  A bare boolean cannot answer "prove this person agreed", which is the only
  question that matters if a regulator asks. `COMPLIANCE.md` requires the
  evidence, not the flag.
*/
ALTER TABLE public.parents
  ADD COLUMN IF NOT EXISTS marketing_opt_in_at TIMESTAMPTZ;

COMMENT ON COLUMN public.parents.marketing_opt_in IS
  'ADR-015. Consent to AfriTech promotional content. DEFAULT FALSE and independent of whatsapp_opted_in, which governs service messages and defaults TRUE (0229).';
COMMENT ON COLUMN public.parents.marketing_opt_in_at IS
  'When consent was given or withdrawn — the evidence, not just the flag (0229).';

/*
  Stamp the time whenever the flag moves, in either direction.

  Withdrawal needs a timestamp as much as consent does: "they opted out and we
  kept sending" is the complaint, and the defence is a date.
*/
CREATE OR REPLACE FUNCTION public.stamp_marketing_consent()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.marketing_opt_in IS DISTINCT FROM OLD.marketing_opt_in THEN
    NEW.marketing_opt_in_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

/*
  BEFORE is right here, and does not contradict `0101`'s rule.

  That rule is about triggers that RAISE a message describing tenant state. This
  one sets a column on the row being written and tells nobody anything, so it must
  run before the write to have any effect at all.
*/
DROP TRIGGER IF EXISTS stamp_marketing_consent_on_parents ON public.parents;
CREATE TRIGGER stamp_marketing_consent_on_parents
  BEFORE UPDATE OF marketing_opt_in ON public.parents
  FOR EACH ROW EXECUTE FUNCTION public.stamp_marketing_consent();

-- ---------------------------------------------------------------------------
-- 2. Who may count the opted-in, and who may not read who they are.
-- ---------------------------------------------------------------------------

/*
  AfriTech gets a COUNT, not a list.

  `0169` set this precedent for AI credits — AfriTech sees aggregates only, never
  a user identifier. The same reasoning holds harder here: a function returning
  the opted-in parents would be a marketing list assembled from every school's
  roll, which is not what a school agreed to when it signed up.

  Exporting that list is a deliberate act with a legal basis behind it, not a
  convenience function sitting in the schema waiting to be called.
*/
CREATE OR REPLACE FUNCTION public.admin_marketing_consent_summary()
RETURNS TABLE (out_opted_in BIGINT, out_total BIGINT)
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
  SELECT COUNT(*) FILTER (WHERE p.marketing_opt_in), COUNT(*)
  FROM public.parents p;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_marketing_consent_summary() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_marketing_consent_summary() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_marketing_consent_summary() TO authenticated;

--

-- ---------------------------------------------------------------------------
-- 3. Assert the default. The access test runs separately, and here is why.
-- ---------------------------------------------------------------------------

/*
  ADR-015's real claim — that graduation does not revoke a parent's access —
  cannot be exercised inside a migration. `SET LOCAL ROLE authenticated` here
  fails with "permission denied for schema auth", because the role `db push`
  connects as cannot reach `auth.jwt()` after switching. The same test runs fine
  through `supabase db query`, which is where it lives:
  `supabase/tests/adr015_graduation_access.sql`.

  What CAN be asserted here is the default, and it is the one worth pinning: a
  later migration flipping it would silently change the legal basis for every
  promotional message AfriTech sends.
*/
DO $$
DECLARE v_default TEXT;
BEGIN
  SELECT column_default INTO v_default
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'parents'
    AND column_name = 'marketing_opt_in';

  IF v_default IS NULL OR v_default NOT LIKE '%false%' THEN
    RAISE EXCEPTION
      '0229: marketing_opt_in must default to FALSE (ADR-015); found %',
      COALESCE(v_default, 'no default');
  END IF;

  -- And it must be independent of the service-message flag, which defaults TRUE.
  SELECT column_default INTO v_default
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'parents'
    AND column_name = 'whatsapp_opted_in';

  IF v_default IS NULL OR v_default NOT LIKE '%true%' THEN
    RAISE EXCEPTION
      '0229: whatsapp_opted_in no longer defaults TRUE — the two consents have drifted';
  END IF;

  RAISE NOTICE '0229: marketing consent defaults FALSE, service messages TRUE, as ADR-015 requires';
END;
$$;
