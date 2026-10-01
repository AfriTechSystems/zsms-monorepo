-- ---------------------------------------------------------------------------
-- 0175 — belonging to more than one network, and spotting one that should exist
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/06 School and Tenant Management/SCHOOL_NETWORKS.md`
--       `Official Documentation/15 Super Admin and Platform/ONBOARDING.md`
--
-- ## What `0119` already got right, so this does not relitigate it
--
-- The many-to-many is built: `school_network_members` joins Clerk accounts to
-- networks with a role, `school_network_roles` carries granular permissions, and
-- `my_network_access()` resolves them LIVE on every call rather than from a token
-- claim. That last property is the one that matters most — a Clerk token outlives
-- a revocation by up to a minute, and for a network that minute is fifty schools
-- of fees and pupil records.
--
-- Two things it does not do.
--
-- ## 1. `my_network_id()` silently answers for ONE network
--
-- It ends `ORDER BY m.created_at LIMIT 1`. A person who belongs to two networks —
-- which is ordinary once several owners share overlapping groups — sees the first
-- one they were added to and has no indication the second exists. Not an error:
-- a wrong answer delivered confidently.
--
-- `my_network_id()` is left exactly as it is, because RLS policies call it and
-- changing what a policy resolves to is not a thing to do in passing. `my_networks()`
-- is added beside it for screens, which can then offer a choice.
--
-- ## 2. Nothing notices when a network should exist
--
-- `ONBOARDING.md` has AfriTech building the group; nothing tells them a group is
-- there to build. An owner who registers a second school is the clearest signal
-- in the system and it was going unread.
--
-- **A suggestion, never an automatic merge.** Registering a second school is not
-- the same as declaring a group, and silently joining two schools' dashboards is
-- hard to undo and alarming to see. The function proposes; a human attaches.
--
-- ### Two signals, and why the weaker one is still worth having
--
--   * **the same Clerk account** registered both schools. Exact, and what was
--     asked for.
--   * **the same owner email** across onboarding records. Weaker — people use
--     several addresses — but it is the ONLY signal for a school AfriTech
--     provisioned, where `created_by` is the AfriTech administrator and would
--     otherwise group every school they ever created into one false network.
--
-- That exclusion is the whole reason `source` is read: without it the first
-- suggestion would be "these 40 schools share an owner", naming an AfriTech
-- admin.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Every network the caller belongs to.
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
    -- The one `my_network_id()` would have picked, so a screen can default to the
    -- same network the policies resolve to rather than disagreeing with them.
    m.created_at = (
      SELECT MIN(m2.created_at)
      FROM public.school_network_members AS m2
      JOIN public.school_networks AS n2 ON n2.id = m2.network_id
      WHERE m2.clerk_user_id = public.get_user_id()
        AND m2.is_active
        AND n2.status = 'active'
    )
  FROM public.school_network_members AS m
  JOIN public.school_networks AS n ON n.id = m.network_id
  LEFT JOIN public.school_network_roles AS r ON r.role_key = m.network_role
  WHERE m.clerk_user_id = public.get_user_id()
    AND m.is_active
    AND n.status = 'active'
  ORDER BY m.created_at;
$$;

-- ---------------------------------------------------------------------------
-- 2. Networks that should probably exist.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_network_suggestions()
RETURNS TABLE (
  out_basis          TEXT,
  out_identifier     TEXT,
  out_owner_name     TEXT,
  out_school_count   INT,
  out_school_ids     UUID[],
  out_school_names   TEXT[],
  out_already_networked INT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_afritech_admin() THEN
    RAISE EXCEPTION 'AfriTech only' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    /*
      The same Clerk account registered both. Restricted to self-registration:
      on an AfriTech-provisioned school `created_by` is the administrator who
      created it, and including those would propose one network containing every
      school AfriTech has ever set up.
    */
    SELECT
      'same_account'::TEXT AS basis,
      o.created_by         AS identifier,
      MAX(COALESCE(o.owner_first_name || ' ' || o.owner_last_name, o.owner_email)) AS owner_name,
      array_agg(o.school_id ORDER BY o.created_at) AS school_ids
    FROM public.school_onboarding AS o
    WHERE o.created_by IS NOT NULL
      AND o.source = 'self_registration'
    GROUP BY o.created_by
    HAVING COUNT(*) > 1

    UNION ALL

    /*
      The same owner email. Weaker — people use several addresses — but the only
      signal available for a school AfriTech provisioned, where the registrant is
      an administrator rather than the owner.
    */
    SELECT
      'same_email'::TEXT,
      lower(btrim(o.owner_email)),
      MAX(COALESCE(o.owner_first_name || ' ' || o.owner_last_name, o.owner_email)),
      array_agg(o.school_id ORDER BY o.created_at)
    FROM public.school_onboarding AS o
    WHERE o.owner_email IS NOT NULL
      AND btrim(o.owner_email) <> ''
    GROUP BY lower(btrim(o.owner_email))
    HAVING COUNT(*) > 1
  )
  SELECT
    c.basis,
    c.identifier,
    c.owner_name,
    array_length(c.school_ids, 1),
    c.school_ids,
    ARRAY(
      SELECT s.name FROM public.schools AS s
      WHERE s.id = ANY (c.school_ids)
      ORDER BY s.name
    ),
    -- How many are already in a network. A group entirely networked needs no
    -- suggestion; a group half networked is the interesting case, because it is
    -- usually a school that was added later and forgotten.
    (
      SELECT COUNT(*)::INT
      FROM public.school_network_schools AS sns
      WHERE sns.school_id = ANY (c.school_ids)
    )
  FROM candidates AS c
  WHERE
    -- Nothing to suggest once every school in the group is already attached.
    (
      SELECT COUNT(*)
      FROM public.school_network_schools AS sns
      WHERE sns.school_id = ANY (c.school_ids)
    ) < array_length(c.school_ids, 1)
  ORDER BY array_length(c.school_ids, 1) DESC, c.basis;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_fn TEXT;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.my_networks()',
    'public.admin_network_suggestions()'
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
-- `my_network_id()` is untouched, and that is deliberate.
--
-- RLS policies call it. Widening what a policy resolves to — from "the first
-- network" to "any network" — would change who can read what across every table
-- that references it, which is a security change and not a refactor. Asserted so
-- a later edit that quietly rewrites it fails here.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'my_network_id'
      AND pg_get_functiondef(p.oid) ILIKE '%LIMIT  1%'
  ) THEN
    RAISE WARNING
      'my_network_id() no longer resolves to a single network — check what RLS now admits';
  END IF;
END;
$$;
