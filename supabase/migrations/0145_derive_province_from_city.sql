-- Migration: 0145_derive_province_from_city.sql
-- Created: 2026-09-29
-- Description: `0142` made province_code NOT NULL with no way to supply it. CI found that this
--              broke twenty-two existing test suites and dev_seed.sql — every writer of `schools`.
-- Related documents: Official Documentation/04 Country and Configuration/ZM.md
--                    Official Documentation/06 School and Tenant Management/SCHOOL_SETUP.md
--
-- ===========================================================================
-- WHAT WENT WRONG, AND WHY IT IS THE SAME MISTAKE AS LAST TIME
--
-- `0142` added `province_code` as NOT NULL, backfilled the rows that existed, and stopped. Every
-- INSERT into `public.schools` written before that migration supplies no province — which is
-- twenty-two pgTAP suites and `dev_seed.sql`, all of which began failing on their first statement.
--
-- `CLAUDE.md` already names this shape: *reasoning about one migration in isolation without
-- re-running the suites that already covered the ground it touched.* The plan counter cannot catch
-- it, because it counts assertions without executing them. Only a real database running every
-- suite finds it, and that is precisely what happened.
--
-- ---------------------------------------------------------------------------
-- THE FIX IS NOT "UPDATE THE FIXTURES"
-- ---------------------------------------------------------------------------
-- Editing twenty-two suites to add a province would work and would be the wrong lesson. The real
-- observation is this: **the province is a function of the city.** `ZM-LSK-0001` is in Lusaka
-- Province because `LSK` is Lusaka. Asking every caller to state both invites a row where the two
-- contradict each other, and the database would store it happily.
--
-- So the derivation moves into the schema. `province_for_city()` is the single authority; a BEFORE
-- trigger fills `province_code` when a caller omits it. Existing writers keep working unchanged,
-- new ones may still state it explicitly — the registration form does, and the API cross-checks —
-- and a school can never end up in a province its city is not in by simple omission.
--
-- BEFORE is correct here, and is not in tension with the AFTER rule `0103` established. That rule
-- is about a trigger that *raises a message describing tenant state* speaking before RLS has
-- decided whether the caller may hear it. This trigger raises nothing and discloses nothing; it
-- computes a default from a value the caller already supplied.
--
-- ---------------------------------------------------------------------------
-- NOT A GENERATED COLUMN, AND NOT A TABLE
-- ---------------------------------------------------------------------------
-- `GENERATED ALWAYS AS ... STORED` would make the contradiction impossible rather than merely
-- unlikely, and was rejected for one reason: the city list will grow to real Zambian towns, and a
-- town may be added before anyone decides its province. With a generated column that is a schema
-- change; with a trigger it is a row that fails loudly on the NOT NULL until the mapping is
-- extended, which is the better failure.
--
-- A lookup table was rejected because ADR-040 puts country configuration in code deliberately —
-- adding a country is a reviewed, tested event, not a form submission. `packages/config`'s
-- `cityProvince` map carries the same pairs for the registration form, which cannot query the
-- database while the user is choosing. The two must agree, and `assertEveryCityHasAProvince()`
-- fails the build if the TypeScript side has a gap.
-- ===========================================================================

-- === MIGRATION START ===

CREATE OR REPLACE FUNCTION public.province_for_city(p_city_code TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  -- Codes from `ZM.md`. `packages/config/src/countries/zm.ts` carries the same pairs for the
  -- registration form and must agree with this.
  --
  -- `CBE` is the awkward one: Copperbelt is a province, listed as a city alongside Ndola and Kitwe
  -- which are both in it. It maps to Copperbelt Province and stays, because it is inside the
  -- identifier of every school already registered under it.
  SELECT CASE p_city_code
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
  END;
$$;

GRANT EXECUTE ON FUNCTION public.province_for_city(TEXT) TO authenticated;

COMMENT ON FUNCTION public.province_for_city(TEXT) IS
  'The province a ZSMS city code belongs to. Single authority in the database; '
  'packages/config/src/countries/zm.ts carries the same pairs for the registration form.';

CREATE OR REPLACE FUNCTION public.set_province_from_city()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  /**
   * Only when the caller said nothing. An explicit province is honoured even if it disagrees with
   * the city, because `SCHOOL_SETUP.md`'s edge cases describe correcting a school registered under
   * the wrong details — and the city code cannot be corrected, since it is inside the identifier.
   * Overriding a deliberate value here would make that correction impossible.
   */
  IF NEW.province_code IS NULL THEN
    NEW.province_code := public.province_for_city(NEW.city_code);
  END IF;

  /**
   * Still NULL means the city is not in the mapping — a town added to `cities` without anybody
   * deciding its province. Named here rather than left to the NOT NULL constraint, which would
   * report "province_code contains null values" and not say which city caused it.
   */
  IF NEW.province_code IS NULL THEN
    RAISE EXCEPTION
      'City code % has no province. Add it to province_for_city() and to '
      'packages/config/src/countries/zm.ts, which must carry the same mapping.',
      NEW.city_code
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_province_from_city_on_schools ON public.schools;
CREATE TRIGGER set_province_from_city_on_schools
  BEFORE INSERT OR UPDATE OF city_code, province_code ON public.schools
  FOR EACH ROW EXECUTE FUNCTION public.set_province_from_city();

COMMENT ON FUNCTION public.set_province_from_city() IS
  'Fills schools.province_code from city_code when a caller omits it. 0142 made the column NOT '
  'NULL with no way to supply it, which broke every writer of the table.';

-- === MIGRATION END ===
