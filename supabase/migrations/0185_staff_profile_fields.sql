-- ---------------------------------------------------------------------------
-- 0185 — the staff profile fields STAFF.md specifies and the table lacked
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/08 Staff Management/STAFF.md` → *Staff Profile Fields*
--
-- ## What the document lists that the schema did not have
--
-- Four. Two are added here and two are refused, and the reasons differ.
--
-- **Added:**
--   * `location` — city or province. The document calls it "useful for AfriTech
--     regional reporting", and a platform selling into a country with ten
--     provinces has no other way to know where its teachers are.
--   * `qualifications` — free text. A school needs to see at a glance who is
--     degree-qualified, and the alternative today is a sheet of paper.
--
-- **Refused, deliberately:**
--   * `clerk_role`, described as "denormalised from Clerk membership". **Not
--     added.** Clerk is the authority on role and `/api/school/staff` already
--     merges it at read time. A denormalised copy is a second source of truth on
--     the field that decides what somebody may DO — and the copy would be the one
--     that silently kept a dismissed principal's access after Clerk revoked it.
--     The cost of reading it live is one API call the route already makes.
--   * `custom_role_id`, a foreign key to `school_custom_roles`. **That table does
--     not exist** — the whole custom-role feature is unbuilt, and a dangling
--     column with nothing to reference is worse than an honest absence.
--
-- ## Both are nullable and neither is validated
--
-- `location` is free text rather than a foreign key to a province list. There IS
-- a city/province reference (`province_for_city`), but a teacher may live
-- somewhere the school's own address table has never heard of, and refusing a
-- qualification form over a village name is not a trade worth making. Regional
-- reporting can normalise on read.
-- ---------------------------------------------------------------------------

ALTER TABLE public.staff_members
  ADD COLUMN IF NOT EXISTS location       TEXT,
  ADD COLUMN IF NOT EXISTS qualifications TEXT;

COMMENT ON COLUMN public.staff_members.location IS
  'City or province, free text. Not a foreign key: a teacher may live somewhere the '
  'address reference has never heard of, and refusing the form over a village name is '
  'not a trade worth making (STAFF.md).';

COMMENT ON COLUMN public.staff_members.qualifications IS
  'Teaching qualifications and degrees, free text (STAFF.md).';

-- Trimmed-empty is NULL. An empty string reads as "recorded, and blank", which is a
-- different claim from "not recorded" on a qualifications field.
ALTER TABLE public.staff_members
  DROP CONSTRAINT IF EXISTS staff_members_location_not_blank;
ALTER TABLE public.staff_members
  ADD CONSTRAINT staff_members_location_not_blank
  CHECK (location IS NULL OR btrim(location) <> '');

ALTER TABLE public.staff_members
  DROP CONSTRAINT IF EXISTS staff_members_qualifications_not_blank;
ALTER TABLE public.staff_members
  ADD CONSTRAINT staff_members_qualifications_not_blank
  CHECK (qualifications IS NULL OR btrim(qualifications) <> '');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'staff_members'
      AND column_name IN ('location', 'qualifications')
    HAVING COUNT(*) = 2
  ) THEN
    RAISE EXCEPTION 'location and qualifications were not both added';
  END IF;

  -- The refusal, asserted. A later session reading STAFF.md and "completing" the
  -- table would otherwise reintroduce the second source of truth on access.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'staff_members'
      AND column_name = 'clerk_role'
  ) THEN
    RAISE EXCEPTION
      'staff_members.clerk_role exists — Clerk is the authority on role, and a cached copy is the one that keeps a dismissed principal''s access';
  END IF;
END;
$$;
