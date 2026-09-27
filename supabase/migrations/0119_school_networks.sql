-- Migration: 0119_school_networks.sql
-- Created: 2026-09-27
-- Description: School Networks — an umbrella over many schools under one owner,
--              with membership, dynamically attached schools, and role permissions
--              held as data rather than as CHECK constraints.
-- Related documents: Official Documentation/01 Foundation Layer/DATABASE.md
--                      — "Known Limitations": school-group views RLS can scope to
--                        owner-level access across their registered schools
--                    Official Documentation/01 Foundation Layer/DECISIONS.md — ADR-040
--
-- ===========================================================================
-- WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
--
-- A School Network is an owner — often a company or a family trust — running
-- several schools that are each separately onboarded onto ZSMS. It gives them one
-- place to see all of them.
--
-- It is **not** a new tenancy layer. Every one of the 75 policies that scope on
-- `current_school_uuid()` is untouched by this migration and by 0120. A network
-- member reads aggregates through SECURITY DEFINER functions that do their own
-- membership check — exactly the shape `is_afritech_admin()` already uses for 40
-- policies — and to actually *work inside* a school they switch into it and become
-- an ordinary `org:owner`. Two surfaces, two mechanisms, and the tenant-isolation
-- guarantee that 72 assertions protect is not renegotiated for a reporting screen.
--
-- WHY SCHOOLS ARE A JOIN TABLE, NOT A COLUMN ON `schools`
--
-- Schools join a network one at a time, and a school can leave or move. A
-- `schools.network_id` column would record only the present and would mean writing
-- to `schools` — a table 75 policies and several triggers already guard — every
-- time a network changed shape. The join table keeps the history, keeps `schools`
-- untouched, and a partial unique index enforces the actual rule: a school belongs
-- to at most ONE network at a time.
--
-- WHY ROLE PERMISSIONS ARE A TABLE
--
-- ADR-040 is a tracked problem precisely because `curriculum_type`, `level_type`
-- and friends were written as hardcoded CHECKs, and each now needs a migration to
-- admit a second country. A network's roles are a permission matrix — the same
-- shape as `afritech.tier_features`, which is already data — so a new role is a
-- row, not a migration.
--
-- That is not blanket anti-hardcoding: `data_scope` below IS a CHECK, because each
-- of its values gates a different code path in 0120. A value the code cannot
-- honour must not be insertable, or an operator would set "full" and get
-- aggregates with no error.
-- ===========================================================================

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- 1. The network.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_networks (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  name          TEXT NOT NULL CHECK (btrim(name) <> ''),
  -- URL-safe handle, so a network dashboard can live at a readable address.
  slug          TEXT NOT NULL UNIQUE
                CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,48}$'),

  /**
   * How much a network member may see WITHOUT switching into a school.
   *
   * aggregates_only   — counts, totals and rates per school. No pupil names, no
   *                     individual fee records, nothing academic. The default, and
   *                     the defensible position under the Data Protection Act's
   *                     minimisation principle.
   * financial_detail  — the above plus individual fee records and payments, for an
   *                     owner who genuinely reconciles money across schools.
   * full              — the above plus pupil-level academic data.
   *
   * A per-network setting rather than a rule in code, so a network that needs more
   * does not require a migration — but it defaults to the safe value, and only
   * AfriTech can change it. The safe thing is the default, not the only option.
   */
  data_scope    TEXT NOT NULL DEFAULT 'aggregates_only'
                CHECK (data_scope IN ('aggregates_only', 'financial_detail', 'full')),

  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'suspended')),

  -- No cap on member or school count anywhere in this schema: a network of 5 and a
  -- network of 100 differ in how the dashboard queries, not in what is legal.
  notes         TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_timestamp_on_school_networks ON public.school_networks;
CREATE TRIGGER update_timestamp_on_school_networks
  BEFORE UPDATE ON public.school_networks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.school_networks IS
  'An owner running several separately-onboarded schools. Read-only aggregate '
  'surface; working inside a school still means switching into it. See 0119/0120.';

-- ---------------------------------------------------------------------------
-- 2. Role permissions, as data.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_network_roles (
  role_key            TEXT PRIMARY KEY
                      CHECK (role_key ~ '^[a-z][a-z0-9_]{1,30}$'),
  label               TEXT NOT NULL,
  description         TEXT,

  can_view_network    BOOLEAN NOT NULL DEFAULT TRUE,
  can_manage_members  BOOLEAN NOT NULL DEFAULT FALSE,
  can_attach_schools  BOOLEAN NOT NULL DEFAULT FALSE,
  -- Gated additionally by the network's own data_scope: a role may permit reading
  -- financial detail and still see none, because the network is aggregates-only.
  -- Both have to allow it, which is why this is a separate flag rather than a tier.
  can_view_financial  BOOLEAN NOT NULL DEFAULT FALSE,

  display_order       INT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.school_network_roles
  (role_key, label, description, can_view_network, can_manage_members,
   can_attach_schools, can_view_financial, display_order)
VALUES
  ('owner', 'Network owner',
   'Sees every school in the network and manages who else can.',
   TRUE, TRUE, TRUE, TRUE, 1),
  ('finance', 'Network finance',
   'Sees the network and its money, but does not manage membership.',
   TRUE, FALSE, FALSE, TRUE, 2),
  ('viewer', 'Network viewer',
   'Sees how the schools are doing. No financial detail, no membership changes.',
   TRUE, FALSE, FALSE, FALSE, 3)
ON CONFLICT (role_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Who is in a network.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_network_members (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  network_id     UUID NOT NULL REFERENCES public.school_networks(id) ON DELETE CASCADE,

  -- The Clerk user id. A network is not a Clerk organisation: Clerk does not nest
  -- organisations, and inventing a parent org would mean every school's org had a
  -- second membership model. Membership here is a ZSMS fact keyed on the user.
  clerk_user_id  TEXT NOT NULL,

  network_role   TEXT NOT NULL REFERENCES public.school_network_roles(role_key),

  full_name      TEXT,
  email          TEXT,

  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  added_by       TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (network_id, clerk_user_id)
);

CREATE INDEX IF NOT EXISTS idx_school_network_members_user
  ON public.school_network_members(clerk_user_id) WHERE is_active;

DROP TRIGGER IF EXISTS update_timestamp_on_school_network_members
  ON public.school_network_members;
CREATE TRIGGER update_timestamp_on_school_network_members
  BEFORE UPDATE ON public.school_network_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Which schools are in a network — added one at a time, with history.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_network_schools (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  network_id   UUID NOT NULL REFERENCES public.school_networks(id) ON DELETE CASCADE,
  school_id    UUID NOT NULL REFERENCES public.schools(id),

  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  attached_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  detached_at  TIMESTAMPTZ,
  attached_by  TEXT,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT network_schools_detached_shape CHECK (
    (is_active AND detached_at IS NULL) OR (NOT is_active AND detached_at IS NOT NULL)
  )
);

-- A school belongs to at most ONE network at a time. Partial on `is_active` so a
-- school that moved between networks keeps both rows as history.
CREATE UNIQUE INDEX IF NOT EXISTS idx_network_schools_one_active_per_school
  ON public.school_network_schools(school_id) WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_network_schools_network
  ON public.school_network_schools(network_id) WHERE is_active;

-- ---------------------------------------------------------------------------
-- 5. Resolving membership. Every function in 0120 is gated on these.
-- ---------------------------------------------------------------------------

/**
 * The network the calling user belongs to, or NULL.
 *
 * SECURITY DEFINER because it is the gate itself — a policy on
 * `school_network_members` cannot be expressed in terms of a function that reads
 * `school_network_members` without circularity.
 *
 * One network per user, deliberately for now: somebody running two unrelated
 * networks is a case nobody has asked for, and `LIMIT 1` fails closed and visibly
 * rather than silently merging two networks' figures into one dashboard.
 */
CREATE OR REPLACE FUNCTION public.my_network_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.network_id
  FROM   public.school_network_members m
  JOIN   public.school_networks n ON n.id = m.network_id
  WHERE  m.clerk_user_id = public.get_user_id()
    AND  m.is_active
    AND  n.status = 'active'
  ORDER  BY m.created_at
  LIMIT  1;
$$;

/**
 * What the caller may do in their network, with the network's own data_scope
 * already applied.
 *
 * Returning the resolved answer rather than the raw role means a caller cannot be
 * granted financial detail by a role when the network is aggregates-only — the
 * two conditions are combined here, once, instead of in every reader.
 */
CREATE OR REPLACE FUNCTION public.my_network_access()
RETURNS TABLE (
  out_network_id       UUID,
  out_network_name     TEXT,
  out_network_slug     TEXT,
  out_role             TEXT,
  out_role_label       TEXT,
  out_data_scope       TEXT,
  out_can_manage       BOOLEAN,
  out_can_attach       BOOLEAN,
  out_can_see_money    BOOLEAN,
  out_can_see_academic BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT n.id, n.name, n.slug, r.role_key, r.label, n.data_scope,
         r.can_manage_members,
         r.can_attach_schools,
         -- Both the role and the network must allow it.
         (r.can_view_financial AND n.data_scope IN ('financial_detail', 'full')),
         (n.data_scope = 'full')
  FROM   public.school_network_members m
  JOIN   public.school_networks n ON n.id = m.network_id
  JOIN   public.school_network_roles r ON r.role_key = m.network_role
  WHERE  m.clerk_user_id = public.get_user_id()
    AND  m.is_active
    AND  n.status = 'active'
    AND  r.can_view_network
  ORDER  BY m.created_at
  LIMIT  1;
$$;

/** TRUE when the calling user may read the given school through a network. */
CREATE OR REPLACE FUNCTION public.network_reaches_school(p_school_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM   public.school_network_schools ns
    WHERE  ns.school_id = p_school_id
      AND  ns.is_active
      AND  ns.network_id = public.my_network_id()
  );
$$;

-- ---------------------------------------------------------------------------
-- 6. RLS. A new table without a policy is a defect (prohibition 4).
-- ---------------------------------------------------------------------------
ALTER TABLE public.school_networks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_networks         FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.school_network_roles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_network_roles    FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.school_network_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_network_members  FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.school_network_schools  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_network_schools  FORCE  ROW LEVEL SECURITY;

-- AfriTech provisions networks. This is the agreed decision: self-service creation
-- would let any owner claim schools they do not own, and there is no
-- proof-of-ownership check in this system to prevent it.
DROP POLICY IF EXISTS "afritech_admin_all_networks" ON public.school_networks;
CREATE POLICY "afritech_admin_all_networks" ON public.school_networks FOR ALL
USING (is_afritech_admin()) WITH CHECK (is_afritech_admin());

DROP POLICY IF EXISTS "afritech_admin_all_network_roles" ON public.school_network_roles;
CREATE POLICY "afritech_admin_all_network_roles" ON public.school_network_roles FOR ALL
USING (is_afritech_admin()) WITH CHECK (is_afritech_admin());

DROP POLICY IF EXISTS "afritech_admin_all_network_members" ON public.school_network_members;
CREATE POLICY "afritech_admin_all_network_members" ON public.school_network_members FOR ALL
USING (is_afritech_admin()) WITH CHECK (is_afritech_admin());

DROP POLICY IF EXISTS "afritech_admin_all_network_schools" ON public.school_network_schools;
CREATE POLICY "afritech_admin_all_network_schools" ON public.school_network_schools FOR ALL
USING (is_afritech_admin()) WITH CHECK (is_afritech_admin());

-- A member reads their own network's record.
DROP POLICY IF EXISTS "member_read_own_network" ON public.school_networks;
CREATE POLICY "member_read_own_network" ON public.school_networks FOR SELECT
USING (id = public.my_network_id());

-- Role definitions are readable by anyone signed in: a member screen has to render
-- the label for a role, and the table holds no tenant data — only what each role
-- is permitted to do.
DROP POLICY IF EXISTS "authenticated_read_network_roles" ON public.school_network_roles;
CREATE POLICY "authenticated_read_network_roles" ON public.school_network_roles FOR SELECT
USING (TRUE);

DROP POLICY IF EXISTS "member_read_own_network_members" ON public.school_network_members;
CREATE POLICY "member_read_own_network_members" ON public.school_network_members FOR SELECT
USING (network_id = public.my_network_id());

/**
 * A member with `can_manage_members` adds and removes colleagues.
 *
 * Note what is NOT permitted: nothing here lets a member attach a SCHOOL. That
 * stays with AfriTech even for a role whose `can_attach_schools` is true — the flag
 * exists so the permission model is complete, and 0120 will honour it through a
 * named function with its own ownership check, rather than a blanket policy that
 * would let a network claim any school by id.
 */
DROP POLICY IF EXISTS "manager_write_own_network_members" ON public.school_network_members;
CREATE POLICY "manager_write_own_network_members" ON public.school_network_members FOR ALL
USING (
  network_id = public.my_network_id()
  AND EXISTS (SELECT 1 FROM public.my_network_access() a WHERE a.out_can_manage)
)
WITH CHECK (
  network_id = public.my_network_id()
  AND EXISTS (SELECT 1 FROM public.my_network_access() a WHERE a.out_can_manage)
);

DROP POLICY IF EXISTS "member_read_own_network_schools" ON public.school_network_schools;
CREATE POLICY "member_read_own_network_schools" ON public.school_network_schools FOR SELECT
USING (network_id = public.my_network_id());

REVOKE ALL ON public.school_networks        FROM anon;
REVOKE ALL ON public.school_network_roles   FROM anon;
REVOKE ALL ON public.school_network_members FROM anon;
REVOKE ALL ON public.school_network_schools FROM anon;

GRANT SELECT ON public.school_networks        TO authenticated;
GRANT SELECT ON public.school_network_roles   TO authenticated;
GRANT SELECT ON public.school_network_schools TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.school_network_members TO authenticated;

GRANT EXECUTE ON FUNCTION public.my_network_id()              TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_network_access()          TO authenticated;
GRANT EXECUTE ON FUNCTION public.network_reaches_school(UUID) TO authenticated;

-- === MIGRATION END ===
