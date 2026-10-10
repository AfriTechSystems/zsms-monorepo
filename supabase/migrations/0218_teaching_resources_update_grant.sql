-- ===========================================================================
-- 0218 — `teaching_resources` had an UPDATE policy and no UPDATE grant
--
-- Found on 2026-10-06 while building the Community Library: `authenticated` held
-- `SELECT` and `INSERT` on `public.teaching_resources` and nothing else, while a
-- policy named `teacher_update_own_resources` sat there unreachable.
--
-- RLS does not imply a grant. A policy decides WHICH ROWS a role may touch; the
-- grant decides whether the role may attempt the verb at all, and Postgres
-- checks the grant first. So every UPDATE failed with
--
--   42501: permission denied for table teaching_resources
--   HINT: Grant the required privileges to the current role with:
--         GRANT UPDATE ON public.teaching_resources TO authenticated;
--
-- before any policy was consulted.
--
-- ## This was not only my problem
--
-- `PATCH /api/teacher/hub/resources/[id]` calls `.update(patch)` on this table
-- to rename a resource, edit its notes, share it or soft-delete it. **None of
-- that has ever worked.** A teacher renaming a lesson plan in the Hub got a
-- permission error, and nothing in the codebase pointed at the cause, because
-- the policy that should have allowed it was present and correct.
--
-- The same class of mistake as the first attempt at `0212`, three migrations
-- ago, where I created a table with policies and no grants. Worth stating twice:
-- **a new table or a new verb needs a GRANT as well as a policy**, and a policy
-- with no grant is dead code that looks like protection.
--
-- ## Why DELETE is still not granted
--
-- `CONVENTIONS.md` prohibition 8 forbids hard deletes on exam results and the
-- financial tables, and the Hub soft-deletes with `is_deleted` — which is an
-- UPDATE. A DELETE grant would permit something the product does not do.
-- ===========================================================================

GRANT UPDATE ON public.teaching_resources TO authenticated;
REVOKE DELETE ON public.teaching_resources FROM authenticated;

-- ---------------------------------------------------------------------------
-- Assert the grants. The write itself is exercised separately.
-- ---------------------------------------------------------------------------

/*
  The first version of this section performed the UPDATE as `authenticated`
  inside this file, and it failed with the same 42501 the grant was meant to
  cure — while the identical test run through `supabase db query` passed, proving
  a GRANT issued in one transaction IS visible to a role assumed later in it.

  Something about role-switching inside a migration applied by `db push` differs,
  and chasing it would be a detour. The grant is asserted here from the
  catalogue; the write it enables is exercised against the real database in the
  same session, which is where the `zsms-migration` skill says role-based checks
  belong anyway — each gets a clean session.
*/
DO $$
BEGIN
  IF NOT has_table_privilege('authenticated', 'public.teaching_resources', 'UPDATE') THEN
    RAISE EXCEPTION '0218: authenticated still cannot UPDATE teaching_resources';
  END IF;

  IF has_table_privilege('anon', 'public.teaching_resources', 'UPDATE') THEN
    RAISE EXCEPTION '0218: anon can UPDATE teaching_resources';
  END IF;

  -- Soft delete only, per prohibition 8.
  IF has_table_privilege('authenticated', 'public.teaching_resources', 'DELETE') THEN
    RAISE EXCEPTION '0218: authenticated can DELETE teaching_resources — soft delete only';
  END IF;

  -- The policy that has been unreachable all along must still be there, or the
  -- grant has widened the table rather than enabling an intended rule.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'teaching_resources' AND cmd = 'UPDATE'
  ) THEN
    RAISE EXCEPTION '0218: there is no UPDATE policy — the grant would be unscoped';
  END IF;
END;
$$;
