-- Migration: 0142_school_provinces_and_trial_expired.sql
-- Created: 2026-09-29
-- Description: The province both registration forms require and the schema never had, plus the
--              sixth school status the lifecycle table has always named.
-- Related documents: Official Documentation/06 School and Tenant Management/SCHOOL_SETUP.md
--                    Official Documentation/04 Country and Configuration/ZM.md
--                    Official Documentation/06 School and Tenant Management/TRIAL.md
--
-- ===========================================================================
-- TWO THINGS THE DOCUMENTS DESCRIBE AND THE TABLE COULD NOT HOLD
--
-- 1. PROVINCE
--
-- `SCHOOL_SETUP.md` lists Province as required on both the AfriTech creation form and the public
-- self-registration form. `schools` has `city_code` and nothing else, so neither form could have
-- been built without inventing a column. `ZM.md` already publishes the ten province codes — they
-- are used here verbatim rather than re-derived, because a second opinion about how to abbreviate
-- "North-Western" is exactly the kind of drift this repository keeps finding.
--
-- **The city codes are NOT touched.** `school_id` is `ZM-LSK-0001` — the city code is inside every
-- school identifier, and every pupil identifier and receipt number derived from it. `CBE` is a
-- known oddity (Copperbelt is a province, listed as a city alongside Ndola and Kitwe, both of which
-- are in it). Renaming it would leave existing schools carrying an identifier that disagrees with
-- the map, with nothing to say which is right. It maps to Copperbelt Province below and stays.
--
-- 2. `trial_expired`
--
-- `SCHOOL_SETUP.md`'s lifecycle table has six statuses; the CHECK admitted five. The missing one is
-- the one that distinguishes "can read their data, cannot write" from "suspended" (which also
-- restricts login to the owner) and from "terminated" (gone). Without it, a trial that lapses has
-- nowhere to go but `suspended`, which locks out every teacher at a school that has merely not paid
-- yet — a worse outcome than the one the status exists to describe.
--
-- **Adding the value does not enforce it.** Nothing in this schema blocks a write by status today,
-- for any status, including `suspended`. That is a real gap and it is deliberately not addressed
-- here: the write-blocking rule touches every policy in the database and wants its own migration,
-- its own pgTAP suite, and its own CI run. This migration makes the status *recordable and
-- correct*; the next one makes it *binding*. Recording a status the system does not honour is
-- worth doing first only because the alternative is recording a status that is actively wrong.
-- ===========================================================================

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- 1. Province.
-- ---------------------------------------------------------------------------
ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS province_code TEXT;

/**
 * Backfill from the city code. This mapping is the authority for which province each ZSMS city
 * code belongs to; `packages/config/src/countries/zm.ts` carries the same table for the forms, and
 * the two must agree.
 *
 * `CBE` maps to Copperbelt Province — see the header. It is the only entry where the city code and
 * the province describe the same place.
 */
UPDATE public.schools SET province_code = CASE city_code
  WHEN 'LSK' THEN 'LSK'   -- Lusaka
  WHEN 'KAF' THEN 'LSK'   -- Kafue
  WHEN 'CBE' THEN 'CBR'   -- Copperbelt (province-as-city; kept for identifier stability)
  WHEN 'NDL' THEN 'CBR'   -- Ndola
  WHEN 'KIT' THEN 'CBR'   -- Kitwe
  WHEN 'KWE' THEN 'CPR'   -- Kabwe
  WHEN 'SER' THEN 'CPR'   -- Serenje
  WHEN 'LVS' THEN 'SPR'   -- Livingstone
  WHEN 'MAZ' THEN 'SPR'   -- Mazabuka
  WHEN 'CHO' THEN 'SPR'   -- Choma
  WHEN 'CHI' THEN 'EPR'   -- Chipata
  WHEN 'SOL' THEN 'NWP'   -- Solwezi
  WHEN 'MKS' THEN 'WPR'   -- Mongu
  ELSE NULL
END
WHERE province_code IS NULL;

/**
 * Fail loudly and by name rather than through a NOT NULL violation.
 *
 * If a city code appears that this mapping does not cover, the next statement would abort with
 * "column province_code contains null values" — true, and useless. This names the code that is
 * missing, which is the one fact needed to fix it.
 */
DO $$
DECLARE
  v_unmapped TEXT;
BEGIN
  SELECT string_agg(DISTINCT city_code, ', ')
    INTO v_unmapped
    FROM public.schools
   WHERE province_code IS NULL;

  IF v_unmapped IS NOT NULL THEN
    RAISE EXCEPTION
      'City code(s) % have no province in migration 0142. Add them to the CASE above and to '
      'packages/config/src/countries/zm.ts, which must carry the same mapping.', v_unmapped;
  END IF;
END;
$$;

ALTER TABLE public.schools
  ALTER COLUMN province_code SET NOT NULL;

-- Codes are `ZM.md`'s, verbatim. A CHECK rather than a reference table because the provinces of a
-- country are not configuration a school operator edits — ADR-040 already tracks the country
-- hardcoding this joins, and it is listed there rather than solved twice.
ALTER TABLE public.schools
  DROP CONSTRAINT IF EXISTS schools_province_code_check;
ALTER TABLE public.schools
  ADD CONSTRAINT schools_province_code_check CHECK (province_code IN (
    'LSK',  -- Lusaka
    'CPR',  -- Central
    'CBR',  -- Copperbelt
    'EPR',  -- Eastern
    'LPR',  -- Luapula
    'MPR',  -- Muchinga
    'NPR',  -- Northern
    'NWP',  -- North-Western
    'SPR',  -- Southern
    'WPR'   -- Western
  ));

COMMENT ON COLUMN public.schools.province_code IS
  'Province code from ZM.md. Required on both registration forms. Unlike city_code this is NOT '
  'part of the school identifier, so it may be corrected if a school was registered under the '
  'wrong province.';

CREATE INDEX IF NOT EXISTS idx_schools_province_code
  ON public.schools(province_code);

/**
 * Province IS editable, unlike city_code, and for the reason the comment gives: it appears in no
 * identifier. `SCHOOL_SETUP.md`'s edge cases say a school registered under the wrong city keeps
 * its school_id and AfriTech corrects the field — the same argument applies more cleanly here,
 * since correcting a province breaks nothing at all.
 *
 * Added to the profile grant `0140` established. That grant is additive per column, so this
 * neither widens nor disturbs what 0140 closed.
 */
GRANT UPDATE (province_code) ON public.schools TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. The sixth status.
-- ---------------------------------------------------------------------------
ALTER TABLE public.schools
  DROP CONSTRAINT IF EXISTS schools_status_check;

ALTER TABLE public.schools
  ADD CONSTRAINT schools_status_check CHECK (status IN (
    'pending_verification',  -- AfriTech created it; not yet verified by a call
    'trial',                 -- Self-registered; 30 days, full access
    'trial_expired',         -- Trial lapsed unsubscribed. Reads, does not write. NEW in 0142.
    'active',                -- Paying, or a pilot school AfriTech activated
    'suspended',             -- Subscription lapsed after grace. Owner-only login
    'terminated'             -- Ended by AfriTech. Data archived
  ));

COMMENT ON COLUMN public.schools.status IS
  'Lifecycle per SCHOOL_SETUP.md. NOTE: the read/write effects of each status are NOT enforced by '
  'this schema as of 0142 — a suspended school can still write. Enforcement is its own migration.';

-- === MIGRATION END ===
