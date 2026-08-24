-- Migration: 0105_normalise_org_role_claim.sql
-- Created: 2026-08-23
-- Description: get_user_role() accepts Clerk's native `o.rol` form ("admin") as
--              well as the fully-qualified form ("org:admin") the policies use.
-- Related documents: Official Documentation/01 Foundation Layer/RLS.md
--                    Official Documentation/02 Authentication and Identity/ROLES.md
--                    Official Documentation/03 Infrastructure Services/CLERK.md

-- === MIGRATION START ===

-- THE DEFECT, AND WHY IT LOOKED LIKE NOTHING WAS WRONG
-- ----------------------------------------------------
-- ZSMS reads identity from two places, and they are not the same thing:
--
--   * The application reads Clerk's server SDK — `auth().orgRole` — which
--     returns the fully-qualified key, `org:admin`. That decides which nav links
--     render and which buttons appear.
--   * Every RLS policy reads the `o.rol` claim inside the Supabase JWT, through
--     `get_user_role()`.
--
-- **Clerk's v2 session token puts the BARE role in `o.rol`**: `admin`, not
-- `org:admin`. The claim shape ZSMS adopted — `o.id` / `o.slg` / `o.rol` — is
-- Clerk's own v2 shape, and this is the one field where its content differs from
-- what `ROLES.md` specifies.
--
-- The result presents as a contradiction. Measured on the dev instance:
--
--   app layer:      role = "org:admin"     → renders an administrator's portal
--   database layer: o.rol = "admin"        → matches no policy, refuses every write
--
-- So the operator is an Administrator who is told they do not have permission,
-- and neither layer looks wrong when inspected on its own. Every school-scoped
-- write fails; every role-gated read returns zero rows, which is indistinguishable
-- from an empty school.
--
-- WHY THIS IS FIXED HERE RATHER THAN IN THE CLERK DASHBOARD
-- ---------------------------------------------------------
-- The alternative is a session-token template emitting `org:{{org.role}}`, and
-- it works. It was rejected because it is **undocumented instance configuration
-- that every environment must remember** — staging and production would each
-- need the same hand-edit, and a missed one fails exactly this way: silently,
-- as an empty school rather than as an error. `CLAUDE.md` already tracks
-- "Clerk instance settings are undocumented configuration" as an open risk;
-- this would add to it.
--
-- Normalising here instead means ZSMS works against Clerk's defaults. Both forms
-- are accepted, so an instance that DOES emit the qualified form keeps working
-- unchanged — including every pgTAP suite, which sets `org:owner` directly.
--
-- The prefix is added only when the value has no `:` at all. A claim that
-- already carries a namespace — `org:teacher`, or a platform role like
-- `afritech:super_admin` — is passed through untouched, so this cannot turn one
-- namespace into another.

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN auth.jwt() -> 'o' ->> 'rol' IS NULL THEN 'none'
    -- Already namespaced (org:*, afritech:*, platform:*) — leave it alone.
    WHEN position(':' IN (auth.jwt() -> 'o' ->> 'rol')) > 0
      THEN auth.jwt() -> 'o' ->> 'rol'
    -- Clerk's native form. Organisation membership roles are the only ones this
    -- claim ever carries, so `org:` is the only prefix that can be correct.
    ELSE 'org:' || (auth.jwt() -> 'o' ->> 'rol')
  END::TEXT;
$$;

COMMENT ON FUNCTION public.get_user_role() IS
  'The caller''s role from the o.rol claim. Accepts Clerk''s bare v2 form ("admin") and the qualified form ("org:admin"); always returns the qualified form the policies compare against (0105).';

-- ---------------------------------------------------------------------------
-- Verification
--
-- Both input forms, plus the two ways this could go wrong: mangling a claim that
-- is already namespaced, and inventing a role where there is none.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"u","o":{"id":"o1","slg":"s","rol":"admin"}}', TRUE);
  SELECT public.get_user_role() INTO v;
  IF v <> 'org:admin' THEN
    RAISE EXCEPTION '0105: Clerk''s bare "admin" resolved to %, expected org:admin', v;
  END IF;

  PERFORM set_config('request.jwt.claims',
    '{"sub":"u","o":{"id":"o1","slg":"s","rol":"org:owner"}}', TRUE);
  SELECT public.get_user_role() INTO v;
  IF v <> 'org:owner' THEN
    RAISE EXCEPTION '0105: qualified "org:owner" resolved to %, expected unchanged', v;
  END IF;

  -- A platform role must not be dragged into the org namespace.
  PERFORM set_config('request.jwt.claims',
    '{"sub":"u","o":{"id":"o1","slg":"s","rol":"afritech:super_admin"}}', TRUE);
  SELECT public.get_user_role() INTO v;
  IF v <> 'afritech:super_admin' THEN
    RAISE EXCEPTION '0105: platform role resolved to %, expected unchanged', v;
  END IF;

  -- No org claim at all must stay 'none'. Turning it into 'org:' would be a
  -- role string no policy matches but every policy has to evaluate.
  PERFORM set_config('request.jwt.claims', '{"sub":"u"}', TRUE);
  SELECT public.get_user_role() INTO v;
  IF v <> 'none' THEN
    RAISE EXCEPTION '0105: a session with no organisation resolved to %, expected none', v;
  END IF;

  -- Clerk's other built-in role is NOT a ZSMS role. It must normalise to
  -- something no policy grants, rather than to anything privileged.
  PERFORM set_config('request.jwt.claims',
    '{"sub":"u","o":{"id":"o1","slg":"s","rol":"member"}}', TRUE);
  SELECT public.get_user_role() INTO v;
  IF v <> 'org:member' THEN
    RAISE EXCEPTION '0105: "member" resolved to %, expected org:member', v;
  END IF;

  PERFORM set_config('request.jwt.claims', NULL, TRUE);
END;
$$;

-- === MIGRATION END ===
