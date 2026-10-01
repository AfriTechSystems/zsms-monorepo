-- ---------------------------------------------------------------------------
-- 0170 — a parent who signs up finds their own children
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/02 Authentication and Identity/AUTH.md`
--       `Official Documentation/07 Students and Parents/PARENTS.md`
--       `Official Documentation/01 Foundation Layer/COMPLIANCE.md`
--
-- ## The defect, which is total and silent
--
-- `parents.clerk_user_id` exists, is UNIQUE, and a trigger (0013) propagates it
-- to `student_parent_links.parent_user_id`, which is what every parent policy
-- reads. **Nothing in the product has ever written it.** The only thing in the
-- repository that sets it is `scripts/link-dev-parent.mjs`, a dev-only helper.
--
-- So in production a parent signs up, the column stays NULL, `is_linked_parent_of()`
-- matches nothing, and the portal renders CORRECTLY EMPTY. It does not error. It
-- looks exactly like a school that has entered no data — which is the worst
-- possible presentation of "we have not connected your account yet".
--
-- ## Parents do not need a Clerk organisation, and the docs say they do
--
-- `AUTH.md` lists parents as `org:parent | Clerk org member`, and
-- `apps/web/app/parent/layout.tsx` records a limitation built on that premise:
-- "a parent with children at two ZSMS schools is in two Clerk organisations, and
-- a session acts in one at a time".
--
-- The premise is false. `is_linked_parent_of()` reads:
--
--     spl.parent_user_id = public.get_user_id()
--
-- and nothing else. No `current_school_uuid()`, no org claim. A parent's access is
-- scoped by the LINK ROW, not by an organisation — which is why
-- `/api/parent/overview` already notes "parent policies already span schools".
--
-- The consequence is that the multi-school case is easier than documented, not
-- harder: once `clerk_user_id` is set, a parent sees every child at every school
-- automatically, and choosing a school is a screen rather than an auth problem.
--
-- ## The email comes from the TOKEN, never from a parameter
--
-- `claim_parent_links()` takes no email argument. It reads `auth.jwt() ->> 'email'`.
--
-- This is the whole security of the feature. A function that accepted an email
-- would be callable directly over PostgREST by any signed-in user — and linking
-- is exactly the operation you must not let somebody perform on an address they
-- do not own. `p_email => 'someone.else@example.com'` would hand a stranger
-- another family's children.
--
-- **This requires a Clerk configuration step.** `email` is not in Clerk's default
-- session token; it must be added under Sessions → Customize session token as
-- `{"email": "{{user.primary_email_address}}"}`. Until it is, the claim is NULL —
-- so the function raises a NAMED error rather than reporting "no children found",
-- because a configuration fault that presents as an empty portal is the same
-- failure this migration exists to fix.
--
-- ## Phone is matched but never trusted on its own
--
-- A school recording a parent's phone is a real act of vouching, and an OTP sent
-- to THAT STORED NUMBER would prove the person signing up holds the handset the
-- school recorded — as strong as the email match.
--
-- That OTP cannot be delivered yet: there are no Meta or Twilio credentials and
-- every channel runs through the mock provider. So a phone match raises a CLAIM
-- for the school to approve rather than linking. When delivery exists, the OTP
-- becomes the automatic path and this stays as the fallback for a code that
-- never arrives.
--
-- ## There is no school-code entry for parents, deliberately
--
-- A teacher has no record at the school at all, so a code is the only way for
-- them to name one (0160). A parent is already a row, created at enrolment. Where
-- matching fails, the school must edit the parent record regardless — so a code
-- box would add a queue that resolves exactly as a phone call does, and invite
-- parents to treat a Student ID as a password. The unmatched screen shows the
-- parent their own verified email to read to the office instead.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The verified email on the current token.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_email()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
$$;

COMMENT ON FUNCTION public.get_user_email() IS
  'The verified email on the session token, lowercased. NULL when Clerk has not been '
  'configured to include the claim — callers must treat NULL as a configuration fault, '
  'never as "this user has no email".';

-- ---------------------------------------------------------------------------
-- 2. Claims awaiting a school's decision.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.parent_link_claims (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The parent row being claimed. The claimant is asserting they ARE this person.
  parent_id       UUID NOT NULL REFERENCES public.parents(id),
  school_id       UUID NOT NULL REFERENCES public.schools(id),

  claimant_user_id TEXT NOT NULL,
  claimant_email   TEXT,
  -- What the claimant supplied that matched. Stored so the school can see WHY
  -- this person believes they are the parent.
  matched_on       TEXT NOT NULL CHECK (matched_on IN ('phone', 'email_mismatch')),

  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'declined', 'withdrawn')),

  requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at      TIMESTAMPTZ,
  decided_by      TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One live claim per claimant per parent row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_parent_link_claims_one_pending
  ON public.parent_link_claims(claimant_user_id, parent_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_parent_link_claims_school
  ON public.parent_link_claims(school_id, requested_at DESC)
  WHERE status = 'pending';

ALTER TABLE public.parent_link_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parent_link_claims FORCE  ROW LEVEL SECURITY;

CREATE POLICY claimant_read_parent_link_claims
  ON public.parent_link_claims FOR SELECT
  USING (claimant_user_id = public.get_user_id());

CREATE POLICY school_read_parent_link_claims
  ON public.parent_link_claims FOR SELECT
  USING (school_id = public.current_school_uuid());

CREATE POLICY afritech_all_parent_link_claims
  ON public.parent_link_claims FOR ALL
  USING (public.is_afritech_admin())
  WITH CHECK (public.is_afritech_admin());

-- No write policy for anybody: every write is through the functions below, which
-- is what stops a claimant inserting a row already marked `approved`.

-- ---------------------------------------------------------------------------
-- 3. Link by verified email. The path almost every parent takes.
--
-- Links EVERY matching parent row, across every school. A parent with children at
-- three schools has three `parents` rows (the table has no school_id, but
-- enrolment creates one per school that enters them), and linking only the first
-- would show them one family and hide two.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_parent_links()
RETURNS TABLE (
  out_linked         INT,
  out_already_linked INT,
  out_email          TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user   TEXT := public.get_user_id();
  v_email  TEXT := public.get_user_email();
  v_linked INT  := 0;
  v_had    INT  := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501';
  END IF;

  IF v_email IS NULL THEN
    /*
      A NAMED failure, not an empty result.

      This means Clerk is not sending the `email` claim, which is configuration
      rather than a property of the user. Returning "no children found" would make
      a misconfigured instance indistinguishable from a parent whose school has
      not recorded their address — and that is precisely the silent-empty-portal
      failure this migration exists to end.
    */
    RAISE EXCEPTION
      'No verified email on this session. Clerk must be configured to include an "email" claim in the session token.'
      USING ERRCODE = 'P0003';
  END IF;

  -- Already linked to this account.
  SELECT COUNT(*) INTO v_had
  FROM public.parents
  WHERE clerk_user_id = v_user;

  /*
    Link every unclaimed parent row with this email.

    `clerk_user_id IS NULL` is the critical clause. A row already bearing somebody
    else's id is NOT taken over — two people sharing an address (a couple using
    one family inbox) must not be able to displace each other, and the UNIQUE index
    on `clerk_user_id` would make the second one an error rather than a silent
    takeover anyway. This leaves it as a claim the school can resolve.
  */
  WITH linked AS (
    UPDATE public.parents AS p
       SET clerk_user_id = v_user,
           updated_at = NOW()
     WHERE lower(p.email) = v_email
       AND p.clerk_user_id IS NULL
    RETURNING p.id
  )
  SELECT COUNT(*) INTO v_linked FROM linked;

  IF v_linked > 0 THEN
    PERFORM public.log_audit_event(
      'parent_self_linked', 'parents', NULL,
      jsonb_build_object('rows', v_linked, 'basis', 'verified_email'),
      NULL
    );
  END IF;

  RETURN QUERY SELECT v_linked, v_had, v_email;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Claim by phone, for a parent the school recorded by number only.
--
-- Raises a claim; it does NOT link. See the header on why the OTP that would
-- justify linking cannot be delivered yet.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_parent_link_by_phone(p_phone TEXT)
RETURNS TABLE (out_submitted BOOLEAN, out_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user    TEXT := public.get_user_id();
  v_email   TEXT := public.get_user_email();
  v_digits  TEXT;
  v_count   INT := 0;
  r         RECORD;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501';
  END IF;

  -- Compare on digits only: a school may have typed 0977123456, +260977123456 or
  -- 260977 123456 for the same handset, and refusing a parent over a space would
  -- be a support call about punctuation.
  v_digits := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  -- Last nine digits: the national significant number for Zambia, which makes the
  -- country prefix optional on both sides of the comparison.
  v_digits := right(v_digits, 9);

  IF length(v_digits) < 9 THEN
    RETURN QUERY SELECT FALSE, 'That does not look like a phone number.'::TEXT;
    RETURN;
  END IF;

  FOR r IN
    SELECT DISTINCT p.id AS parent_id, spl.school_id
    FROM public.parents AS p
    JOIN public.student_parent_links AS spl ON spl.parent_id = p.id
    WHERE right(regexp_replace(COALESCE(p.phone_e164, ''), '\D', '', 'g'), 9) = v_digits
      AND p.clerk_user_id IS NULL
      AND spl.is_active
  LOOP
    INSERT INTO public.parent_link_claims
      (parent_id, school_id, claimant_user_id, claimant_email, matched_on)
    VALUES (r.parent_id, r.school_id, v_user, v_email, 'phone')
    ON CONFLICT DO NOTHING;
    v_count := v_count + 1;
  END LOOP;

  /*
    The same answer whether or not the number matched.

    Saying "no record of that number" would turn this into a check for whether a
    given phone belongs to a ZSMS parent — a lookup that reveals something about
    a family to anybody who can sign up. The identical reasoning as 0160's school
    codes, applied to a far more sensitive identifier.
  */
  RETURN QUERY SELECT
    TRUE,
    'If that number is on a school''s records, your request has been sent to them.'::TEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. The school decides.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.school_decide_parent_claim(
  p_claim_id UUID,
  p_approve  BOOLEAN
)
RETURNS TABLE (out_decided BOOLEAN, out_linked BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_user   TEXT := public.get_user_id();
  v_claim  RECORD;
  v_linked BOOLEAN := FALSE;
BEGIN
  IF v_school IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'Only a school can decide its own parent claims' USING ERRCODE = '42501';
  END IF;

  UPDATE public.parent_link_claims AS c
     SET status     = CASE WHEN p_approve THEN 'approved' ELSE 'declined' END,
         decided_at = NOW(),
         decided_by = v_user
   WHERE c.id = p_claim_id
     -- Own school's claims only; this is a DEFINER function.
     AND c.school_id = v_school
     AND c.status = 'pending'
  RETURNING c.parent_id, c.claimant_user_id INTO v_claim;

  IF v_claim IS NULL THEN
    RETURN QUERY SELECT FALSE, FALSE;
    RETURN;
  END IF;

  IF p_approve THEN
    -- Still `IS NULL`: between the claim and the decision, the parent may have
    -- linked by email anyway.
    UPDATE public.parents AS p
       SET clerk_user_id = v_claim.claimant_user_id,
           updated_at = NOW()
     WHERE p.id = v_claim.parent_id
       AND p.clerk_user_id IS NULL;

    v_linked := FOUND;
  END IF;

  PERFORM public.log_audit_event(
    CASE WHEN p_approve THEN 'parent_claim_approved' ELSE 'parent_claim_declined' END,
    'parent_link_claims', p_claim_id,
    jsonb_build_object('linked', v_linked),
    v_school
  );

  RETURN QUERY SELECT TRUE, v_linked;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_fn TEXT;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.get_user_email()',
    'public.claim_parent_links()',
    'public.request_parent_link_by_phone(TEXT)',
    'public.school_decide_parent_claim(UUID, BOOLEAN)'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', v_fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_fn);

    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon can execute %', v_fn;
    END IF;
    IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated cannot execute %', v_fn;
    END IF;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- Assert the linking function takes no email parameter.
--
-- The entire security of this feature is that the address comes from the token.
-- A future edit adding `p_email` for convenience would make it possible to link
-- to any address over a direct PostgREST call, and it would look helpful in
-- review. This fails the migration instead.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'claim_parent_links'
      AND pg_get_function_identity_arguments(p.oid) <> ''
  ) THEN
    RAISE EXCEPTION
      'claim_parent_links() must take no arguments — the email comes from the session token';
  END IF;
END;
$$;
