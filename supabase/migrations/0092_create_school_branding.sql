-- Migration: 0092_create_school_branding.sql
-- Created: 2026-08-16
-- Description: Per-school theming — two brand colours and two logo variants,
--              with the WCAG AA contrast guardrail enforced in the database
--              rather than only in the application.
-- Related documents: Official Documentation/01 Foundation Layer/DECISIONS.md — ADR-043
--                    Official Documentation/01 Foundation Layer/DYNAMIC_CONFIG.md — School Branding
--                    Official Documentation/01 Foundation Layer/DESIGN_SYSTEM.md
--                    Official Documentation/05 Core Database and API Reference/SCHEMA.md

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- WCAG relative luminance and contrast ratio
--
-- These exist so the accessibility guardrail is a constraint rather than a
-- convention. `validateTheme()` in `packages/design-tokens/src/theme.ts` applies
-- the same two thresholds at the API boundary, which is where a school gets a
-- readable error message. But an admin tool, a support script, or a future
-- bulk-import that writes this table directly would bypass that check entirely,
-- and the people who then cannot read their fee balance are parents who never
-- chose the colour. The rule belongs where it cannot be routed around.
--
-- WCAG 2.1 §1.4.3 (contrast minimum), using the sRGB relative luminance
-- definition verbatim.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.srgb_relative_luminance(p_hex TEXT)
RETURNS DOUBLE PRECISION
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_bytes  BYTEA;
  v_c      DOUBLE PRECISION;
  v_linear DOUBLE PRECISION[] := ARRAY[]::DOUBLE PRECISION[];
  i        INT;
BEGIN
  -- Returns NULL rather than raising: this is called from CHECK constraints,
  -- and a format error is reported by the format constraint, not this one.
  IF p_hex IS NULL OR p_hex !~ '^#[0-9A-Fa-f]{6}$' THEN
    RETURN NULL;
  END IF;

  v_bytes := decode(substr(p_hex, 2), 'hex');

  FOR i IN 0..2 LOOP
    v_c := get_byte(v_bytes, i)::DOUBLE PRECISION / 255.0;
    v_linear := v_linear || CASE
      WHEN v_c <= 0.03928 THEN v_c / 12.92
      ELSE power((v_c + 0.055) / 1.055, 2.4)
    END;
  END LOOP;

  RETURN 0.2126 * v_linear[1] + 0.7152 * v_linear[2] + 0.0722 * v_linear[3];
END;
$$;

COMMENT ON FUNCTION public.srgb_relative_luminance(TEXT) IS
  'WCAG 2.1 sRGB relative luminance for a #RRGGBB colour. NULL if not valid hex.';

CREATE OR REPLACE FUNCTION public.wcag_contrast_ratio(p_a TEXT, p_b TEXT)
RETURNS DOUBLE PRECISION
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN t.la IS NULL OR t.lb IS NULL THEN NULL
    ELSE (greatest(t.la, t.lb) + 0.05) / (least(t.la, t.lb) + 0.05)
  END
  FROM (
    SELECT public.srgb_relative_luminance(p_a) AS la,
           public.srgb_relative_luminance(p_b) AS lb
  ) t;
$$;

COMMENT ON FUNCTION public.wcag_contrast_ratio(TEXT, TEXT) IS
  'WCAG 2.1 contrast ratio between two #RRGGBB colours, 1.0–21.0. NULL if either is not valid hex.';

-- ---------------------------------------------------------------------------
-- school_branding
--
-- One row per school. Colours and logo only — a school cannot move navigation,
-- rename a column, or change a layout (ADR-043). Structure is what makes the
-- product learnable by staff who use it daily and support answerable by one team.
--
-- Semantic colours are deliberately absent. Green-means-paid and red-means-
-- overdue are comprehension aids, not brand expression; a school that set
-- "overdue" to green would be creating a misreading of money.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_branding (
  school_id      UUID PRIMARY KEY REFERENCES public.schools(id),
  -- The school IS the key. One branding row per school, and school_id is
  -- therefore also the tenant column every RLS policy below filters on.

  anchor_color   TEXT,
  -- Header, navigation, primary text. NULL = ZSMS navy (#2B3A55).

  primary_color  TEXT,
  -- Buttons, links, active states. NULL = ZSMS blue (#3A8DDE).

  logo_url       TEXT,
  -- Full wordmark, R2 public bucket. NULL = school initials fallback.

  icon_url       TEXT,
  -- Square mark for favicon and collapsed navigation. NULL = initials fallback.

  updated_by     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Format first. These are not redundant with the contrast constraints below:
  -- a CHECK that evaluates to NULL *passes*, and wcag_contrast_ratio() returns
  -- NULL for a malformed colour. Without these, '#GGGGGG' would be stored.
  CONSTRAINT school_branding_anchor_is_hex CHECK (
    anchor_color IS NULL OR anchor_color ~ '^#[0-9A-Fa-f]{6}$'
  ),
  CONSTRAINT school_branding_primary_is_hex CHECK (
    primary_color IS NULL OR primary_color ~ '^#[0-9A-Fa-f]{6}$'
  ),

  -- The anchor fills the header and side navigation with white text on it.
  -- That is normal-size text, so WCAG AA asks 4.5:1.
  CONSTRAINT school_branding_anchor_readable CHECK (
    anchor_color IS NULL
    OR public.wcag_contrast_ratio('#FFFFFF', anchor_color) >= 4.5
  ),

  -- The primary colour is used unmodified as a button fill. Its text-bearing
  -- step is derived by darkening, which always succeeds, so the only
  -- unrecoverable case is a colour so pale its own button edge vanishes against
  -- a white page — WCAG 1.4.11 non-text contrast, 3:1.
  CONSTRAINT school_branding_primary_readable CHECK (
    primary_color IS NULL
    OR public.wcag_contrast_ratio(primary_color, '#FFFFFF') >= 3.0
  ),

  -- The logo is rendered on an unauthenticated page. A URL pointing anywhere
  -- other than storage we control would let a third party observe every parent
  -- who opens the login screen. Host allowlisting belongs at upload time — the
  -- API only ever stores a URL it minted itself against R2 — but requiring
  -- HTTPS here rules out the plainly wrong cases and mixed-content breakage.
  CONSTRAINT school_branding_logo_https CHECK (
    logo_url IS NULL OR logo_url ~ '^https://'
  ),
  CONSTRAINT school_branding_icon_https CHECK (
    icon_url IS NULL OR icon_url ~ '^https://'
  )
);

COMMENT ON TABLE public.school_branding IS
  'Per-school theme: two brand colours and two logo variants. Colours are constrained to WCAG AA (ADR-043). Absent row or NULL column = ZSMS default.';
COMMENT ON COLUMN public.school_branding.anchor_color IS
  'Header/navigation colour. Must reach 4.5:1 against white — white nav text sits on it.';
COMMENT ON COLUMN public.school_branding.primary_color IS
  'Action colour. Must reach 3:1 against white — used unmodified as a button fill.';

DROP TRIGGER IF EXISTS update_timestamp_on_school_branding ON public.school_branding;
CREATE TRIGGER update_timestamp_on_school_branding
  BEFORE UPDATE ON public.school_branding
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- `schools.logo_url` predates this table and is still read by
-- worker_school_branding() below as a fallback. New writes go here.
COMMENT ON COLUMN public.schools.logo_url IS
  'Superseded by school_branding.logo_url. Retained as a fallback for schools onboarded before 0092; not written by new code.';

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------

REVOKE ALL ON public.school_branding FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.school_branding TO authenticated;
-- No DELETE: reverting to the ZSMS default is setting the columns to NULL, not
-- removing the row, so the audit trail of who changed the brand survives.
REVOKE DELETE, TRUNCATE ON public.school_branding FROM authenticated, anon;

ALTER TABLE public.school_branding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_branding FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "afritech_admin_all_school_branding" ON public.school_branding;
CREATE POLICY "afritech_admin_all_school_branding"
ON public.school_branding FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

-- Every member of the school reads it — parents, students, and teachers all
-- render the theme, so this is not management-scoped like most configuration.
DROP POLICY IF EXISTS "school_members_read_school_branding" ON public.school_branding;
CREATE POLICY "school_members_read_school_branding"
ON public.school_branding FOR SELECT
USING (school_id = current_school_uuid());

DROP POLICY IF EXISTS "management_insert_school_branding" ON public.school_branding;
CREATE POLICY "management_insert_school_branding"
ON public.school_branding FOR INSERT
WITH CHECK (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
);

DROP POLICY IF EXISTS "management_update_school_branding" ON public.school_branding;
CREATE POLICY "management_update_school_branding"
ON public.school_branding FOR UPDATE
USING (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
)
WITH CHECK (school_id = current_school_uuid());

-- ---------------------------------------------------------------------------
-- school_branding_by_slug() — the unauthenticated surface
--
-- The parent login screen must show the school's own logo and colours: a parent
-- who lands on a generic page is a parent who is not sure they are in the right
-- place. But nobody is authenticated at a login screen, so RLS has nothing to
-- resolve and `current_school_uuid()` is NULL.
--
-- A blanket `anon` SELECT policy on the table would answer that, and would also
-- hand any caller the full branding table. This function is the narrow version:
-- one school, by the slug already in the URL, returning only what a login page
-- draws.
--
-- The slug is `lower(schools.school_id)` — the same value used as the Clerk
-- organisation slug (CLERK.md), so no new public identifier is introduced.
-- It is sequential and therefore enumerable, which is accepted: what a walk of
-- the sequence yields is a school's name, two colours, and a logo — public
-- signage, not personal data. Nothing here is scoped to a person, and a
-- terminated or unverified school returns nothing at all.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.school_branding_by_slug(p_slug TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'schoolName',   s.name,
    'anchorColor',  b.anchor_color,
    'primaryColor', b.primary_color,
    'logoUrl',      COALESCE(b.logo_url, s.logo_url),
    'iconUrl',      b.icon_url
  )
  FROM public.schools s
  LEFT JOIN public.school_branding b ON b.school_id = s.id
  WHERE lower(s.school_id) = lower(p_slug)
    AND s.status IN ('trial', 'active');
$$;

COMMENT ON FUNCTION public.school_branding_by_slug(TEXT) IS
  'Login-screen branding for one school by its public slug (lower(school_id)). Readable by anon: name, colours, logo only.';

REVOKE ALL ON FUNCTION public.school_branding_by_slug(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.school_branding_by_slug(TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- worker_school_branding() — extended with colours
--
-- Replaces the 0091 definition. A themed receipt, statement, or report card
-- needs the same two colours the web UI uses; without them a school's PDFs stay
-- ZSMS-blue while its portal is not, which is the mismatch parents notice.
--
-- Still ADR-042-shaped: one school by id, service role only, and nothing beyond
-- what a document prints. The returned keys are additive — 0091's five callers
-- keep working unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.worker_school_branding(p_school_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'name',         s.name,
    'schoolCode',   s.school_id,
    'address',      s.address,
    'phone',        s.phone,
    'email',        s.email,
    'logoUrl',      COALESCE(b.logo_url, s.logo_url),
    'iconUrl',      b.icon_url,
    'anchorColor',  b.anchor_color,
    'primaryColor', b.primary_color
  )
  FROM public.schools s
  LEFT JOIN public.school_branding b ON b.school_id = s.id
  WHERE s.id = p_school_id;
$$;

COMMENT ON FUNCTION public.worker_school_branding(UUID) IS
  'Document header fields and brand colours for one school. Service role only (ADR-042).';

REVOKE ALL ON FUNCTION public.worker_school_branding(UUID) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.worker_school_branding(UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- Verification — fails the migration rather than reporting a warning
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_count INT;
  v_ratio DOUBLE PRECISION;
BEGIN
  -- The contrast maths must agree with packages/design-tokens/src/contrast.ts.
  -- Known values, taken from that implementation: white on ZSMS navy is
  -- 11.4185:1, and ZSMS blue on white is 3.4742:1 — the latter clearing the 3:1
  -- fill threshold by a margin narrow enough that a drifting implementation
  -- would show up here rather than in a button nobody can see the edge of.
  v_ratio := public.wcag_contrast_ratio('#FFFFFF', '#2B3A55');
  IF v_ratio IS NULL OR abs(v_ratio - 11.4185) > 0.005 THEN
    RAISE EXCEPTION '0092: navy contrast is %, expected 11.4185 — luminance maths is wrong', v_ratio;
  END IF;

  v_ratio := public.wcag_contrast_ratio('#3A8DDE', '#FFFFFF');
  IF v_ratio IS NULL OR abs(v_ratio - 3.4742) > 0.005 THEN
    RAISE EXCEPTION '0092: blue contrast is %, expected 3.4742 — luminance maths is wrong', v_ratio;
  END IF;

  -- The guardrail must be wired, not merely available: a correct
  -- wcag_contrast_ratio() that no constraint references would pass every check
  -- above and still admit an unreadable palette. Asserted from the catalog
  -- rather than by a trial INSERT, because this block runs with migration
  -- privileges and no JWT — an insert here would exercise neither the seat nor
  -- the policies a real write goes through. The behavioural test, from an
  -- actual school-owner session, is in supabase/tests/rls/school_branding_test.sql.
  SELECT count(*) INTO v_count
  FROM pg_constraint
  WHERE conrelid = 'public.school_branding'::regclass
    AND conname IN (
      'school_branding_anchor_is_hex',   'school_branding_primary_is_hex',
      'school_branding_anchor_readable', 'school_branding_primary_readable'
    );

  IF v_count <> 4 THEN
    RAISE EXCEPTION '0092: % of 4 colour constraints present — the AA guardrail is incomplete', v_count;
  END IF;

  -- And the thresholds must bite. A pale yellow anchor is the case they exist
  -- for: 1.07:1 against white nav text.
  v_ratio := public.wcag_contrast_ratio('#FFFFFF', '#FFF9C4');
  IF v_ratio IS NULL OR v_ratio >= 4.5 THEN
    RAISE EXCEPTION '0092: pale yellow measured % against white — the guardrail would admit it', v_ratio;
  END IF;

  -- anon must not reach the table itself, only the function.
  SELECT count(*) INTO v_count
  FROM information_schema.table_privileges
  WHERE table_schema = 'public'
    AND table_name = 'school_branding'
    AND grantee = 'anon';

  IF v_count > 0 THEN
    RAISE EXCEPTION '0092: anon holds % privilege(s) on school_branding — must go through school_branding_by_slug()', v_count;
  END IF;
END;
$$;

-- === MIGRATION END ===
