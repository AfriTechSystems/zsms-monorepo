-- ---------------------------------------------------------------------------
-- 0176 — which network is "the default" must be the one RLS actually picks
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/06 School and Tenant Management/SCHOOL_NETWORKS.md`
--
-- ## The bug in 0175
--
-- `my_networks()` flagged the default by comparing each row's `created_at` to the
-- minimum. Two memberships added in ONE statement share a timestamp — `NOW()` is
-- transaction time, not statement time — so both rows came back flagged, and a
-- screen offering "your default network" would have shown two.
--
-- Caught by exercising it: adding a person to two networks at once is not an edge
-- case, it is what an administrator does in a single action when setting up a
-- group.
--
-- ## The fix is to stop reimplementing the answer
--
-- The default is not "the earliest membership". The default is **whichever
-- network `my_network_id()` returns**, because that is the one every RLS policy
-- resolves to. Comparing against it directly makes the two agree by construction
-- rather than by two pieces of code implementing the same ORDER BY and hoping.
--
-- ## A latent ambiguity in 0119, left alone deliberately
--
-- The same tie exists inside `my_network_id()`: `ORDER BY m.created_at LIMIT 1`
-- with two equal timestamps picks arbitrarily, and Postgres is free to pick
-- differently between calls. For a member of two networks that means RLS could
-- resolve to a different network on two consecutive requests.
--
-- It is NOT fixed here. Adding a tie-break changes which rows existing policies
-- admit, for every table that calls it — a security change that deserves its own
-- migration, its own pgTAP suite, and a deliberate decision about which network
-- wins. Recorded in `CLAUDE.md` instead, so it is chosen rather than discovered.
--
-- The practical exposure today is small: a tie needs two memberships created in
-- the same transaction, and `my_networks()` now reports the same answer the
-- policies do either way.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.my_networks()
RETURNS TABLE (
  out_network_id   UUID,
  out_name         TEXT,
  out_slug         TEXT,
  out_role         TEXT,
  out_role_label   TEXT,
  out_schools      INT,
  out_is_default   BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    n.id,
    n.name,
    n.slug,
    m.network_role,
    COALESCE(r.label, m.network_role),
    (SELECT COUNT(*)::INT
       FROM public.school_network_schools AS sns
      WHERE sns.network_id = n.id),
    -- Exact: the network the policies resolve to, asked rather than recomputed.
    n.id IS NOT DISTINCT FROM public.my_network_id()
  FROM public.school_network_members AS m
  JOIN public.school_networks AS n ON n.id = m.network_id
  LEFT JOIN public.school_network_roles AS r ON r.role_key = m.network_role
  WHERE m.clerk_user_id = public.get_user_id()
    AND m.is_active
    AND n.status = 'active'
  -- `id` as the tie-break so a list of networks is at least stable between
  -- renders, even while which one is default remains 0119's question.
  ORDER BY m.created_at, n.id;
$$;

-- `CREATE OR REPLACE` keeps the grants, but assert rather than assume.
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.my_networks()', 'EXECUTE') THEN
    RAISE EXCEPTION 'my_networks is executable by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.my_networks()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot execute my_networks';
  END IF;
END;
$$;
