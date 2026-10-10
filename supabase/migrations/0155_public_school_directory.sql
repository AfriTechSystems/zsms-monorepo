-- Migration: 0155_public_school_directory.sql
-- Created: 2026-09-30
-- Description: The public school directory — searchable by anyone, with verified metrics a school
--              opts into publishing. No ranking.
-- Related documents: Official Documentation/06 School and Tenant Management/PUBLIC_DIRECTORY.md
--                    Official Documentation/15 Super Admin and Platform/SCHOOL_HEALTH_SCORES.md
--                    Official Documentation/05 Core Database and API Reference/RATE_LIMITS.md
--
-- ===========================================================================
-- THE FIRST THING IN THIS SCHEMA THAT `anon` MAY READ
--
-- Every other read path in ZSMS resolves through a Clerk claim. This one has no caller identity at
-- all: a parent searching for their child's school has no account, and requiring one would defeat
-- the purpose. So the rules are different, and they are worth stating before the DDL.
--
-- **Nothing is exposed by widening a policy.** `public.schools` has RLS with no `anon` policy, and it
-- stays that way — RLS decides which ROWS, and what this needs is a restriction on COLUMNS. Two
-- SECURITY DEFINER functions return the safe columns and nothing else, which is the shape `CLAUDE.md`
-- already prescribes for the unbuilt Community Library. A single careless `GRANT SELECT ... TO anon`
-- on `schools` would publish owner emails and trial end dates.
--
-- ---------------------------------------------------------------------------
-- WHY THERE IS NO RANK, WHICH IS A PRODUCT DECISION AND NOT AN OMISSION
-- ---------------------------------------------------------------------------
-- The obvious thing to publish is the school health score. It must not be published, and the reason
-- is that it measures the wrong thing: `SCHOOL_HEALTH_SCORES.md` answers *"is this school genuinely
-- using ZSMS?"* from attendance-marking compliance, marks-entry completion, staff logins, **fee
-- collection rate** and payment verification speed.
--
-- Published, that would rank a good school badly because its bursar is slow, and it would broadcast
-- how many of each school's parents are in arrears. It would also hand every school outside the top
-- three a reason to churn — a public face that attacks the revenue base behind it.
--
-- Decided 2026-09-30: **verified facts, no rank.** The moat is not a score. Anyone can list Zambian
-- schools; only ZSMS can say a number was computed from the school's live records. That makes the
-- badge something a school wants rather than fears, and leaves the health score pointing where it
-- belongs — inward, as the school's private incentive to qualify.
--
-- ---------------------------------------------------------------------------
-- THE RATIO IS PUBLISHED. THE COUNTS BEHIND IT ARE NOT.
-- ---------------------------------------------------------------------------
-- `PUBLIC_DIRECTORY.md` withholds student count as competitively sensitive, and that survives here:
-- the public functions return **ratios and averages, never the raw pupil or teacher counts.**
--
-- This is not tidiness. Publishing the teacher count alongside a 1:22 ratio lets anybody multiply and
-- recover the roll exactly — the withheld number reconstructed from two published ones. So the
-- derived figures go out and the inputs stay in.
--
-- And the teacher count comes from `teacher_assignments`, not `staff_members`. A school's staff list
-- includes the bursar, the matron and the driver; counting them would flatter every school with a
-- large office and make the ratio a vanity metric rather than a signal.
-- ===========================================================================

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- 1. What a school chooses to publish.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_public_profiles (
  school_id            UUID PRIMARY KEY REFERENCES public.schools(id),

  /**
   * The master switch for the EXTRAS only. A school cannot hide from the directory itself —
   * business rule 6 makes the base listing a platform feature — but everything below is theirs to
   * withhold. Default FALSE: a school publishes by deciding to, never by forgetting not to.
   */
  is_published         BOOLEAN NOT NULL DEFAULT FALSE,

  -- The school's own words. Shown as text, never as markup.
  about                TEXT CHECK (about IS NULL OR LENGTH(about) <= 2000),
  established_year     INT CHECK (established_year IS NULL
                                  OR established_year BETWEEN 1850 AND EXTRACT(YEAR FROM NOW())::INT),
  website_url          TEXT CHECK (website_url IS NULL OR website_url ~ '^https?://'),

  -- Verified metrics, each behind its own switch. A school may publish its ratio and withhold its
  -- class sizes, and the two say different things.
  publish_ratio        BOOLEAN NOT NULL DEFAULT FALSE,
  publish_class_sizes  BOOLEAN NOT NULL DEFAULT FALSE,

  /**
   * The fee band, and it is the school's STATED range rather than anything derived from
   * `fee_structures`.
   *
   * Deliberate. A derived figure would leak the real fee table — which `PUBLIC_DIRECTORY.md` calls
   * commercially sensitive and is right to — and would also be wrong, since a term's structure
   * carries optional lines a parent may never pay. The school says what a parent should expect;
   * ZSMS does not claim to have verified it, and the profile does not badge it as verified.
   */
  publish_fee_band     BOOLEAN NOT NULL DEFAULT FALSE,
  fee_band_min         NUMERIC(12,2) CHECK (fee_band_min IS NULL OR fee_band_min >= 0),
  fee_band_max         NUMERIC(12,2) CHECK (fee_band_max IS NULL OR fee_band_max >= 0),
  CONSTRAINT school_public_profiles_fee_band_ordered
    CHECK (fee_band_min IS NULL OR fee_band_max IS NULL OR fee_band_min <= fee_band_max),
  CONSTRAINT school_public_profiles_fee_band_complete
    CHECK (NOT publish_fee_band OR (fee_band_min IS NOT NULL AND fee_band_max IS NOT NULL)),

  -- What a parent filters on. Booleans rather than a tag array, because "has transport" is a filter
  -- and a free-text tag is not.
  has_boarding         BOOLEAN NOT NULL DEFAULT FALSE,
  has_transport        BOOLEAN NOT NULL DEFAULT FALSE,
  has_science_lab      BOOLEAN NOT NULL DEFAULT FALSE,
  has_computer_lab     BOOLEAN NOT NULL DEFAULT FALSE,
  has_library          BOOLEAN NOT NULL DEFAULT FALSE,
  has_sports          BOOLEAN NOT NULL DEFAULT FALSE,
  has_feeding          BOOLEAN NOT NULL DEFAULT FALSE,
  has_special_needs    BOOLEAN NOT NULL DEFAULT FALSE,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by           TEXT
);

DROP TRIGGER IF EXISTS update_timestamp_on_school_public_profiles ON public.school_public_profiles;
CREATE TRIGGER update_timestamp_on_school_public_profiles
  BEFORE UPDATE ON public.school_public_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.school_public_profiles IS
  'What a school chooses to publish in the directory beyond the mandatory listing. Every field '
  'defaults to withheld. The fee band is the school''s stated range, NOT derived from '
  'fee_structures — see 0155.';

ALTER TABLE public.school_public_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_public_profiles FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "afritech_admin_all_public_profiles" ON public.school_public_profiles;
CREATE POLICY "afritech_admin_all_public_profiles"
ON public.school_public_profiles FOR ALL
USING (public.is_afritech_admin())
WITH CHECK (public.is_afritech_admin());

-- A school reads its own, published or not — it is their draft as much as their listing.
DROP POLICY IF EXISTS "school_staff_read_own_public_profile" ON public.school_public_profiles;
CREATE POLICY "school_staff_read_own_public_profile"
ON public.school_public_profiles FOR SELECT
USING (school_id = public.current_school_uuid());

/**
 * Only leadership writes it. What a school says about itself in public is a marketing decision with
 * commercial consequences, not a data-entry task — a teacher should not be able to publish a fee
 * band, and `org:accountant` should not be describing the school.
 */
DROP POLICY IF EXISTS "management_write_own_public_profile" ON public.school_public_profiles;
CREATE POLICY "management_write_own_public_profile"
ON public.school_public_profiles FOR ALL
USING (
  school_id = public.current_school_uuid()
  AND public.get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
)
WITH CHECK (
  school_id = public.current_school_uuid()
  AND public.get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
);

-- `anon` gets nothing here. The public read path is the two functions below, which name their
-- columns.
REVOKE ALL ON public.school_public_profiles FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.school_public_profiles TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. The verified metrics.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.school_verified_metrics(p_school_id UUID)
RETURNS TABLE (
  out_pupils          INT,
  out_teachers        INT,
  out_classes         INT,
  out_pupils_per_teacher NUMERIC,
  out_avg_class_size  NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
-- DEFINER so the counts are taken over the whole school rather than the slice a caller can see.
-- The public functions below expose only the two derived figures; the raw counts are returned here
-- for the school's own settings screen, which is entitled to them.
SET search_path = public, pg_temp
AS $$
  WITH roll AS (
    SELECT s.class_id
      FROM public.students s
     WHERE s.school_id = p_school_id
       AND s.status IN ('active', 'on_leave')
       AND s.is_deleted IS NOT TRUE
  ),
  teaching AS (
    /**
     * Distinct people with a live teaching assignment — NOT `staff_members`, which includes the
     * bursar, the matron and the driver. Counting those would flatter every school with a big
     * office and turn the ratio into a vanity metric.
     */
    SELECT COUNT(DISTINCT t.teacher_user_id) AS n
      FROM public.teacher_assignments t
     WHERE t.school_id = p_school_id
       AND t.is_active
  )
  SELECT
    (SELECT COUNT(*) FROM roll)::INT,
    (SELECT n FROM teaching)::INT,
    (SELECT COUNT(DISTINCT class_id) FROM roll)::INT,
    -- NULLIF so a school with no assignments reports nothing rather than dividing by zero. NULL
    -- here means "not enough data to say", which is the honest answer and is what the profile
    -- renders as an absent line rather than a zero.
    ROUND((SELECT COUNT(*) FROM roll)::NUMERIC / NULLIF((SELECT n FROM teaching), 0), 1),
    ROUND((SELECT COUNT(*) FROM roll)::NUMERIC
          / NULLIF((SELECT COUNT(DISTINCT class_id) FROM roll), 0), 1);
$$;

REVOKE EXECUTE ON FUNCTION public.school_verified_metrics(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.school_verified_metrics(UUID) TO authenticated;

COMMENT ON FUNCTION public.school_verified_metrics(UUID) IS
  'Pupil, teacher and class counts plus the two derived ratios. Teachers come from '
  'teacher_assignments, not staff_members. NOT granted to anon — the public functions expose the '
  'ratios only, because publishing a count alongside a ratio reconstructs the withheld roll.';

-- ---------------------------------------------------------------------------
-- 3. Search. Reachable with no account at all.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_schools(
  p_country_code TEXT DEFAULT 'ZM',
  p_search       TEXT DEFAULT NULL,
  p_province     TEXT DEFAULT NULL,
  p_city         TEXT DEFAULT NULL,
  p_type         TEXT DEFAULT NULL,
  p_level        TEXT DEFAULT NULL,
  p_boarding     BOOLEAN DEFAULT NULL,
  p_transport    BOOLEAN DEFAULT NULL,
  p_fee_max      NUMERIC DEFAULT NULL,
  p_limit        INT DEFAULT 20,
  p_offset       INT DEFAULT 0
)
RETURNS TABLE (
  out_school_code      TEXT,
  out_name             TEXT,
  out_city_code        TEXT,
  out_province_code    TEXT,
  out_type             TEXT,
  out_level            TEXT,
  out_logo_url         TEXT,
  out_status           TEXT,
  out_about            TEXT,
  out_pupils_per_teacher NUMERIC,
  out_avg_class_size   NUMERIC,
  out_fee_band_min     NUMERIC,
  out_fee_band_max     NUMERIC,
  out_has_boarding     BOOLEAN,
  out_has_transport    BOOLEAN,
  out_total            BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH listed AS (
    /**
     * Columns named rather than `s.*, p.*`. Both tables carry a `school_id` and they mean different
     * things — the TEXT code on one, the UUID foreign key on the other — so a star join makes every
     * later reference to it ambiguous. Postgres says so at CREATE FUNCTION time for a LANGUAGE sql
     * body, which is the one mercy here: a plpgsql body would have waited for the first caller.
     */
    SELECT s.id              AS id,
           s.school_id       AS school_code,
           s.name            AS name,
           s.display_name    AS display_name,
           s.city_code       AS city_code,
           s.province_code   AS province_code,
           s.type            AS type,
           s.level           AS level,
           s.logo_url        AS logo_url,
           s.status          AS status,
           COALESCE(p.is_published, FALSE) AS is_published,
           p.about           AS about,
           p.publish_ratio   AS publish_ratio,
           p.publish_class_sizes AS publish_class_sizes,
           p.publish_fee_band    AS publish_fee_band,
           p.fee_band_min    AS fee_band_min,
           p.fee_band_max    AS fee_band_max,
           p.has_boarding    AS has_boarding,
           p.has_transport   AS has_transport
      FROM public.schools s
      LEFT JOIN public.school_public_profiles p ON p.school_id = s.id
     WHERE s.country_code = p_country_code
       -- Business rule 1. `pending_verification` is excluded too: AfriTech has not yet confirmed
       -- the school is real, and listing it would lend ZSMS's name to that claim.
       AND s.status IN ('active', 'trial')
       AND (p_search   IS NULL OR p_search = '' OR s.name ILIKE '%' || p_search || '%')
       AND (p_province IS NULL OR p_province = '' OR s.province_code = p_province)
       AND (p_city     IS NULL OR p_city = ''     OR s.city_code = p_city)
       AND (p_type     IS NULL OR p_type = ''     OR s.type = p_type)
       AND (p_level    IS NULL OR p_level = ''    OR s.level = p_level)
       -- A facility filter matches only a school that PUBLISHED the answer. A school that has not
       -- said must not be excluded by a "no transport" filter it never answered — so the filter
       -- narrows to confirmed yes rather than assuming no.
       AND (p_boarding  IS NOT TRUE OR (COALESCE(p.is_published, FALSE) AND p.has_boarding))
       AND (p_transport IS NOT TRUE OR (COALESCE(p.is_published, FALSE) AND p.has_transport))
       AND (p_fee_max IS NULL
            OR (COALESCE(p.is_published, FALSE) AND p.publish_fee_band
                AND p.fee_band_min <= p_fee_max))
  ),
  counted AS (SELECT COUNT(*) AS n FROM listed)
  SELECT
    l.school_code,
    COALESCE(l.display_name, l.name),
    l.city_code,
    l.province_code,
    l.type,
    l.level,
    l.logo_url,
    l.status,
    CASE WHEN l.is_published THEN LEFT(l.about, 300) ELSE NULL END,
    -- Each metric behind its own switch, and computed rather than stored. NULL where withheld,
    -- which the UI renders as an absent line rather than a zero.
    CASE WHEN l.is_published AND l.publish_ratio
         THEN (SELECT out_pupils_per_teacher FROM public.school_verified_metrics(l.id)) END,
    CASE WHEN l.is_published AND l.publish_class_sizes
         THEN (SELECT out_avg_class_size FROM public.school_verified_metrics(l.id)) END,
    CASE WHEN l.is_published AND l.publish_fee_band THEN l.fee_band_min END,
    CASE WHEN l.is_published AND l.publish_fee_band THEN l.fee_band_max END,
    CASE WHEN l.is_published THEN l.has_boarding  ELSE NULL END,
    CASE WHEN l.is_published THEN l.has_transport ELSE NULL END,
    (SELECT n FROM counted)
  FROM listed l
  ORDER BY COALESCE(l.display_name, l.name) ASC
  -- The page size is capped here rather than trusted from the caller. There is no rate limiter in
  -- front of this yet (no Redis — see CREDENTIALS_CHECKLIST.md), so the one control available is
  -- how much a single request can carry away.
  LIMIT LEAST(COALESCE(p_limit, 20), 50)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

REVOKE EXECUTE ON FUNCTION public.search_schools(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, NUMERIC, INT, INT) FROM PUBLIC;

/**
 * Granted to `anon` DELIBERATELY, which is the only such grant in this schema outside the sign-in
 * branding lookup. A parent searching for their child's school has no account, and requiring one
 * would defeat the directory's purpose.
 *
 * Every column it returns is named above. Nothing reaches a caller that is not on that list —
 * no owner name, no contact details, no trial dates, no counts.
 */
GRANT EXECUTE ON FUNCTION public.search_schools(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, NUMERIC, INT, INT)
  TO anon, authenticated;

COMMENT ON FUNCTION public.search_schools(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, NUMERIC, INT, INT) IS
  'Public school search. Granted to anon on purpose; exposes only the columns in its RETURNS TABLE. '
  'Ratios are published, the counts behind them are not — a count plus a ratio reconstructs the roll.';

-- ---------------------------------------------------------------------------
-- 4. One school's public profile.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.school_public_profile(p_school_code TEXT)
RETURNS TABLE (
  out_school_code        TEXT,
  out_name               TEXT,
  out_city_code          TEXT,
  out_province_code      TEXT,
  out_type               TEXT,
  out_level              TEXT,
  out_logo_url           TEXT,
  out_status             TEXT,
  out_about              TEXT,
  out_established_year   INT,
  out_website_url        TEXT,
  out_pupils_per_teacher NUMERIC,
  out_avg_class_size     NUMERIC,
  out_fee_band_min       NUMERIC,
  out_fee_band_max       NUMERIC,
  out_has_boarding       BOOLEAN,
  out_has_transport      BOOLEAN,
  out_has_science_lab    BOOLEAN,
  out_has_computer_lab   BOOLEAN,
  out_has_library        BOOLEAN,
  out_has_sports         BOOLEAN,
  out_has_feeding        BOOLEAN,
  out_has_special_needs  BOOLEAN,
  out_grade_levels       TEXT[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    s.school_id,
    COALESCE(s.display_name, s.name),
    s.city_code,
    s.province_code,
    s.type,
    s.level,
    s.logo_url,
    s.status,
    CASE WHEN p.is_published THEN p.about ELSE NULL END,
    CASE WHEN p.is_published THEN p.established_year ELSE NULL END,
    CASE WHEN p.is_published THEN p.website_url ELSE NULL END,
    CASE WHEN p.is_published AND p.publish_ratio
         THEN (SELECT out_pupils_per_teacher FROM public.school_verified_metrics(s.id)) END,
    CASE WHEN p.is_published AND p.publish_class_sizes
         THEN (SELECT out_avg_class_size FROM public.school_verified_metrics(s.id)) END,
    CASE WHEN p.is_published AND p.publish_fee_band THEN p.fee_band_min END,
    CASE WHEN p.is_published AND p.publish_fee_band THEN p.fee_band_max END,
    CASE WHEN p.is_published THEN p.has_boarding      ELSE NULL END,
    CASE WHEN p.is_published THEN p.has_transport     ELSE NULL END,
    CASE WHEN p.is_published THEN p.has_science_lab   ELSE NULL END,
    CASE WHEN p.is_published THEN p.has_computer_lab  ELSE NULL END,
    CASE WHEN p.is_published THEN p.has_library       ELSE NULL END,
    CASE WHEN p.is_published THEN p.has_sports        ELSE NULL END,
    CASE WHEN p.is_published THEN p.has_feeding       ELSE NULL END,
    CASE WHEN p.is_published THEN p.has_special_needs ELSE NULL END,
    /**
     * Which grades the school teaches. Always public and never behind a switch: a parent's first
     * question is whether the school takes a child of their child's age, and a directory that
     * cannot answer it is not a directory. It also discloses nothing — a school's grade range is
     * on its gate.
     */
    (SELECT ARRAY_AGG(g.display_name ORDER BY g.level_order)
       FROM public.school_grade_levels g
      WHERE g.school_id = s.id AND g.is_active)
  FROM public.schools s
  LEFT JOIN public.school_public_profiles p ON p.school_id = s.id
  WHERE s.school_id = UPPER(BTRIM(p_school_code))
    AND s.status IN ('active', 'trial');
$$;

REVOKE EXECUTE ON FUNCTION public.school_public_profile(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.school_public_profile(TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.school_public_profile(TEXT) IS
  'One school''s public profile, by school code. Granted to anon on purpose. Returns nothing for a '
  'suspended, terminated or unverified school — business rule 1.';

-- ---------------------------------------------------------------------------
-- 5. The school's own view of what it publishes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_school_public_profile(
  p_is_published        BOOLEAN DEFAULT NULL,
  p_about               TEXT DEFAULT NULL,
  p_established_year    INT DEFAULT NULL,
  p_website_url         TEXT DEFAULT NULL,
  p_publish_ratio       BOOLEAN DEFAULT NULL,
  p_publish_class_sizes BOOLEAN DEFAULT NULL,
  p_publish_fee_band    BOOLEAN DEFAULT NULL,
  p_fee_band_min        NUMERIC DEFAULT NULL,
  p_fee_band_max        NUMERIC DEFAULT NULL,
  p_has_boarding        BOOLEAN DEFAULT NULL,
  p_has_transport       BOOLEAN DEFAULT NULL,
  p_has_science_lab     BOOLEAN DEFAULT NULL,
  p_has_computer_lab    BOOLEAN DEFAULT NULL,
  p_has_library         BOOLEAN DEFAULT NULL,
  p_has_sports          BOOLEAN DEFAULT NULL,
  p_has_feeding         BOOLEAN DEFAULT NULL,
  p_has_special_needs   BOOLEAN DEFAULT NULL
)
RETURNS public.school_public_profiles
LANGUAGE plpgsql
SECURITY INVOKER
-- INVOKER, not DEFINER. The policies above already say who may write this and for which school;
-- a DEFINER function would need to re-derive both and would be a second rule nothing tests.
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID;
  v_row    public.school_public_profiles;
BEGIN
  v_school := public.current_school_uuid();
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'No school in this session.' USING ERRCODE = '42501';
  END IF;

  -- Upsert, because a school reaching this screen for the first time has no row and should not
  -- have to create one before editing it.
  INSERT INTO public.school_public_profiles (school_id, updated_by)
  VALUES (v_school, public.get_user_id())
  ON CONFLICT (school_id) DO NOTHING;

  UPDATE public.school_public_profiles AS pr
     SET is_published       = COALESCE(p_is_published,        pr.is_published),
         about              = COALESCE(NULLIF(BTRIM(p_about), ''), pr.about),
         established_year   = COALESCE(p_established_year,    pr.established_year),
         website_url        = COALESCE(NULLIF(BTRIM(p_website_url), ''), pr.website_url),
         publish_ratio      = COALESCE(p_publish_ratio,       pr.publish_ratio),
         publish_class_sizes= COALESCE(p_publish_class_sizes, pr.publish_class_sizes),
         publish_fee_band   = COALESCE(p_publish_fee_band,    pr.publish_fee_band),
         fee_band_min       = COALESCE(p_fee_band_min,        pr.fee_band_min),
         fee_band_max       = COALESCE(p_fee_band_max,        pr.fee_band_max),
         has_boarding       = COALESCE(p_has_boarding,        pr.has_boarding),
         has_transport      = COALESCE(p_has_transport,       pr.has_transport),
         has_science_lab    = COALESCE(p_has_science_lab,     pr.has_science_lab),
         has_computer_lab   = COALESCE(p_has_computer_lab,    pr.has_computer_lab),
         has_library        = COALESCE(p_has_library,         pr.has_library),
         has_sports         = COALESCE(p_has_sports,          pr.has_sports),
         has_feeding        = COALESCE(p_has_feeding,         pr.has_feeding),
         has_special_needs  = COALESCE(p_has_special_needs,   pr.has_special_needs),
         updated_by         = public.get_user_id()
   WHERE pr.school_id = v_school
  RETURNING pr.* INTO v_row;

  -- An RLS-blocked UPDATE matches zero rows and raises nothing, so the row count is the only
  -- signal. A teacher reaching this function gets a refusal rather than a silent no-op.
  IF v_row.school_id IS NULL THEN
    RAISE EXCEPTION
      'Only the school owner, principal or administrator may change the public profile.'
      USING ERRCODE = '42501';
  END IF;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_school_public_profile(
  BOOLEAN, TEXT, INT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, NUMERIC, NUMERIC,
  BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_school_public_profile(
  BOOLEAN, TEXT, INT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, NUMERIC, NUMERIC,
  BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN) TO authenticated;

-- === MIGRATION END ===
