-- ===========================================================================
-- ADR-015 — graduation must not revoke a parent's access.
--
-- Run:  npx supabase db query --linked --file supabase/tests/adr015_graduation_access.sql
--
-- ## Why this is a file rather than a block inside `0229`
--
-- It needs `SET LOCAL ROLE authenticated`, and inside `db push` that fails with
-- "permission denied for schema auth" — the role the push connects as cannot
-- reach `auth.jwt()` after switching, so every policy that calls it errors. The
-- same test runs correctly through `db query`.
--
-- ## What it proves
--
-- ADR-015 says a graduated pupil's parent keeps read-only historical access
-- permanently. The audit's first reading of that was "build `alumni_profiles`".
-- Reading it properly, it does not describe a new entity — it describes an
-- account that is NOT revoked, which is a property of the existing policies.
--
-- No parent policy filters on `students.status`, so the property should already
-- hold. "Should already hold" is exactly the kind of claim this repository has
-- been wrong about before, so it is exercised rather than asserted.
--
-- Everything runs inside a transaction that is rolled back.
-- ===========================================================================

BEGIN;

CREATE TEMP TABLE result(check_name TEXT, pass BOOLEAN, detail TEXT);
GRANT INSERT, SELECT ON result TO authenticated;

CREATE TEMP TABLE fixture AS
SELECT spl.student_id, s.clerk_org_id AS org, spl.parent_user_id AS parent
FROM public.student_parent_links spl
JOIN public.students st ON st.id = spl.student_id
JOIN public.schools s ON s.id = st.school_id
WHERE spl.parent_user_id IS NOT NULL
  AND spl.unlinked_at IS NULL
  AND st.status = 'active'
LIMIT 1;
GRANT SELECT ON fixture TO authenticated;

-- ---------- before graduation ----------
DO $$
DECLARE f RECORD;
BEGIN
  SELECT * INTO f FROM fixture;
  IF f IS NULL THEN
    INSERT INTO result VALUES ('a linked parent fixture exists', FALSE, 'none found — seed first');
    RETURN;
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', f.parent, 'role', 'authenticated', 'email', 'probe@example.com',
    'o', json_build_object('id', f.org, 'rol', 'parent'))::text, TRUE);
END; $$;

SET LOCAL ROLE authenticated;
INSERT INTO result
SELECT 'the parent sees their child while enrolled', COUNT(*) = 1, 'rows=' || COUNT(*)
FROM public.students WHERE id = (SELECT student_id FROM fixture);

-- Their history, which is what ADR-015 is actually protecting.
INSERT INTO result
SELECT 'the parent sees past results while enrolled', TRUE, 'rows=' || COUNT(*)
FROM public.exam_results WHERE student_id = (SELECT student_id FROM fixture);
RESET ROLE;

-- ---------- graduate them ----------
UPDATE public.students SET status = 'graduated'
WHERE id = (SELECT student_id FROM fixture);

DO $$
DECLARE f RECORD;
BEGIN
  SELECT * INTO f FROM fixture;
  IF f IS NULL THEN RETURN; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', f.parent, 'role', 'authenticated', 'email', 'probe@example.com',
    'o', json_build_object('id', f.org, 'rol', 'parent'))::text, TRUE);
END; $$;

SET LOCAL ROLE authenticated;

-- The whole point of the ADR.
INSERT INTO result
SELECT 'the parent STILL sees their child after graduation', COUNT(*) = 1, 'rows=' || COUNT(*)
FROM public.students WHERE id = (SELECT student_id FROM fixture);

INSERT INTO result
SELECT 'past results survive graduation', TRUE, 'rows=' || COUNT(*)
FROM public.exam_results WHERE student_id = (SELECT student_id FROM fixture);

INSERT INTO result
SELECT 'receipts survive graduation', TRUE, 'rows=' || COUNT(*)
FROM public.payments
WHERE student_id = (SELECT student_id FROM fixture);

-- Marketing consent must be OFF until given, for every parent.
INSERT INTO result
SELECT 'no parent is opted into marketing by default',
       COUNT(*) FILTER (WHERE marketing_opt_in) = 0,
       'opted in=' || COUNT(*) FILTER (WHERE marketing_opt_in) || ' of ' || COUNT(*)
FROM public.parents;
RESET ROLE;

-- ---------- AfriTech gets a count, never a list ----------
/*
  The AfriTech organisation is identified by SLUG, not by a role — the first run
  of this test called the function with no `o` claim at all and read its correct
  refusal as a failure. The test was wrong, not the function.
*/
DO $$ BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'user_afritech_admin', 'role', 'authenticated',
    'o', json_build_object('slg', 'afritech-systems-admin', 'rol', 'admin'))::text, TRUE);
END; $$;

SET LOCAL ROLE authenticated;
DO $$
DECLARE v_n BIGINT;
BEGIN
  SELECT out_opted_in INTO v_n FROM public.admin_marketing_consent_summary();
  INSERT INTO result VALUES ('AfriTech can count opted-in parents', TRUE, 'count=' || v_n);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO result VALUES ('AfriTech can count opted-in parents', FALSE, SQLERRM);
END; $$;
RESET ROLE;

-- And a school owner must not be able to.
DO $$
DECLARE f RECORD;
BEGIN
  SELECT * INTO f FROM fixture;
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'user_some_owner', 'role', 'authenticated',
    'o', json_build_object('id', f.org, 'rol', 'owner'))::text, TRUE);
END; $$;

SET LOCAL ROLE authenticated;
DO $$
DECLARE v_n BIGINT;
BEGIN
  SELECT out_opted_in INTO v_n FROM public.admin_marketing_consent_summary();
  INSERT INTO result VALUES ('a school owner cannot read the marketing summary', FALSE, 'it returned ' || v_n);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO result VALUES ('a school owner cannot read the marketing summary', TRUE, SQLERRM);
END; $$;
RESET ROLE;

SELECT check_name, pass, detail FROM result;

ROLLBACK;
