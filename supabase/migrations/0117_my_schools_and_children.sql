-- Migration: 0117_my_schools_and_children.sql
-- Created: 2026-09-27
-- Description: Lets a signed-in user see which ZSMS schools they are connected
--              to, and a parent see every one of their children across schools,
--              without first switching into each school.
-- Related documents: Official Documentation/02 Authentication and Identity/AUTH.md
--                    Official Documentation/07 Student and Parent Modules/PARENTS.md
--
-- ===========================================================================
-- THE PROBLEM
--
-- A Clerk session acts in ONE organisation, so `current_school_uuid()` resolves to
-- one school and every tenant policy scopes to it. That is the tenancy model and
-- it is correct.
--
-- It also means a parent with Alice at Alpha and Ben at Beta can only ever see one
-- of them. The portal cannot even offer to switch, because it has no way to know
-- Ben exists — the row is in another school, invisible to every policy.
--
-- WHY A DEFINER FUNCTION IS THE RIGHT ANSWER HERE, AND NOT A WIDENING
--
-- The scoping key for a parent's children is not the school. It is
-- `student_parent_links.parent_user_id`, which is compared against
-- `get_user_id()` — a value read from the caller's own JWT and unforgeable from
-- SQL. So "every child of the calling parent" is a well-defined, self-scoped
-- question that happens to cross schools.
--
-- Answering it exposes nothing the parent is not already entitled to: they are the
-- parent. This is emphatically NOT the same as letting a parent read across
-- schools generally — the functions below return only their own children, and only
-- the identifying fields a switcher needs. Marks, fees, attendance and everything
-- else stay behind the org switch and the 75 tenant policies.
--
-- The same argument covers staff: "which schools am I employed at" is keyed on the
-- caller's own user id.
-- ===========================================================================

-- === MIGRATION START ===

/**
 * Schools the calling user is connected to, whatever their relationship.
 *
 * A staff member through `staff_members`, a parent through a child, a pupil
 * through their own record. Returns the relationship so a switcher can label it —
 * "Teacher at Alpha Academy" is more use than "Alpha Academy".
 *
 * Deliberately does NOT consult Clerk organisation membership. Clerk knows which
 * orgs a user belongs to, but the client already has that from
 * `useOrganizationList`; what the client cannot get from Clerk is *why* the user
 * is connected, which is a ZSMS fact. The two are cross-checked on the client:
 * a school here with no matching Clerk membership cannot be switched into, and
 * that is worth showing rather than hiding.
 */
CREATE OR REPLACE FUNCTION public.my_schools()
RETURNS TABLE (
  out_school_uuid   UUID,
  out_school_code   TEXT,
  out_school_name   TEXT,
  out_clerk_org_id  TEXT,
  out_relationship  TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH me AS (SELECT public.get_user_id() AS uid)
  SELECT DISTINCT ON (s.id)
         s.id, s.school_id, s.name, s.clerk_org_id, rel.relationship
  FROM   me
  CROSS JOIN LATERAL (
    SELECT sm.school_id, 'staff'::TEXT AS relationship
    FROM   public.staff_members sm
    WHERE  sm.clerk_user_id = me.uid AND sm.is_active = TRUE

    UNION ALL

    SELECT st.school_id, 'parent'::TEXT
    FROM   public.student_parent_links spl
    JOIN   public.students st ON st.id = spl.student_id
    WHERE  spl.parent_user_id = me.uid
      AND  spl.is_active = TRUE
      AND  st.is_deleted = FALSE

    UNION ALL

    SELECT st.school_id, 'student'::TEXT
    FROM   public.students st
    WHERE  st.clerk_user_id = me.uid AND st.is_deleted = FALSE
  ) rel
  JOIN public.schools s ON s.id = rel.school_id
  -- A suspended or closed school is not offered as somewhere to switch into.
  -- Landing in one would render a portal whose every query returns nothing, which
  -- reads as a broken product rather than a closed school.
  WHERE s.status = 'active'
  ORDER BY s.id, rel.relationship;
$$;

COMMENT ON FUNCTION public.my_schools() IS
  'Schools the calling user is connected to, with why. Self-scoped on '
  'get_user_id(), so it crosses schools without widening anything. See 0117.';

/**
 * Every child of the calling parent, across every school.
 *
 * Only the fields a picker needs: who they are, and where. Not their class, not
 * their status beyond being on the roll, and certainly nothing academic or
 * financial — those require switching into the school, where the ordinary policies
 * apply.
 *
 * Grace-period links are included, matching `is_linked_parent_of()`. A parent
 * whose link lapsed last week can still reach the term they paid for, which is the
 * entire reason the grace period exists; excluding them here would make the child
 * vanish from the switcher while still being readable inside the school.
 */
CREATE OR REPLACE FUNCTION public.my_children()
RETURNS TABLE (
  out_student_uuid  UUID,
  out_student_code  TEXT,
  out_first_name    TEXT,
  out_last_name     TEXT,
  out_school_uuid   UUID,
  out_school_code   TEXT,
  out_school_name   TEXT,
  out_clerk_org_id  TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT st.id, st.student_id, st.first_name, st.last_name,
         s.id, s.school_id, s.name, s.clerk_org_id
  FROM   public.student_parent_links spl
  JOIN   public.students st ON st.id = spl.student_id
  JOIN   public.schools  s  ON s.id = st.school_id
  WHERE  spl.parent_user_id = public.get_user_id()
    AND  st.is_deleted = FALSE
    AND  (
      spl.is_active = TRUE
      OR (spl.is_active = FALSE AND spl.grace_period_ends_at > NOW())
    )
  ORDER BY s.name, st.first_name, st.last_name;
$$;

COMMENT ON FUNCTION public.my_children() IS
  'Every child of the calling parent across all schools, identifying fields only. '
  'Self-scoped on get_user_id(). Academic and financial data still require '
  'switching into the school. See 0117.';

GRANT EXECUTE ON FUNCTION public.my_schools()  TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_children() TO authenticated;

-- === MIGRATION END ===
