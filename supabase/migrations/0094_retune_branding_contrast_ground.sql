-- Migration: 0094_retune_branding_contrast_ground.sql
-- Created: 2026-08-17
-- Description: Re-measures the school-palette guardrail against the page
--              background instead of white, following the design foundation's
--              move to a tinted page.
-- Related documents: Official Documentation/01 Foundation Layer/DECISIONS.md — ADR-043
--                    Official Documentation/01 Foundation Layer/DESIGN_SYSTEM.md

-- === MIGRATION START ===

-- `0092` measured both thresholds against `#FFFFFF`, because at the time the
-- page was white. The design foundation now puts a soft lavender-grey ground
-- (`#F1F3FA`) behind white cards, and that ground is **darker than white** — so
-- every threshold measured against white is measured against the easier of the
-- two surfaces a colour is actually drawn on.
--
-- The gap is small and entirely one-directional: a palette can pass `0092` and
-- still be unreadable on the page. `#6E7690` is a concrete example — 4.51:1 on
-- white, 4.07:1 on the page. Accepted by the old constraint, rejected by this
-- one, and genuinely too light for body text where it lands.
--
-- Measuring against the page subsumes the white case rather than trading one
-- for the other. For a dark anchor, contrast against white is always higher than
-- against the page, so clearing the page clears white too — including the rarer
-- layout where white text sits on a solid anchor panel.
--
-- `PAGE_GROUND` in `packages/design-tokens/src/theme.ts` holds the same value
-- and `validateTheme()` uses it. These two move together or the database and the
-- API start disagreeing about which palettes a school may save.
--
-- No existing rows are affected: `zsms-dev` holds no branding rows, and the only
-- palette in use is the ZSMS default, which clears both thresholds with room
-- (navy 12.99:1, blue 3.13:1).

ALTER TABLE public.school_branding
  DROP CONSTRAINT IF EXISTS school_branding_anchor_readable,
  DROP CONSTRAINT IF EXISTS school_branding_primary_readable;

-- The anchor's primary job is INK — body text, headings, navigation labels — on
-- the page. Normal-size text, so WCAG 1.4.3 asks 4.5:1.
ALTER TABLE public.school_branding
  ADD CONSTRAINT school_branding_anchor_readable CHECK (
    anchor_color IS NULL
    OR public.wcag_contrast_ratio('#F1F3FA', anchor_color) >= 4.5
  );

-- The primary colour is used unmodified as a button and chip fill. Below 3:1 the
-- control's own edge disappears — WCAG 1.4.11 non-text contrast.
ALTER TABLE public.school_branding
  ADD CONSTRAINT school_branding_primary_readable CHECK (
    primary_color IS NULL
    OR public.wcag_contrast_ratio(primary_color, '#F1F3FA') >= 3.0
  );

COMMENT ON COLUMN public.school_branding.anchor_color IS
  'Ink colour — body text, headings, navigation. Must reach 4.5:1 against the page ground #F1F3FA.';
COMMENT ON COLUMN public.school_branding.primary_color IS
  'Action colour. Must reach 3:1 against the page ground #F1F3FA — used unmodified as a button fill.';

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_count INT;
  v_ratio DOUBLE PRECISION;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_constraint
  WHERE conrelid = 'public.school_branding'::regclass
    AND conname IN ('school_branding_anchor_readable', 'school_branding_primary_readable');

  IF v_count <> 2 THEN
    RAISE EXCEPTION '0094: % of 2 contrast constraints present after the swap', v_count;
  END IF;

  -- The shipped default must clear its own guardrail. A design change that made
  -- the product's own palette unsavable would be caught here rather than by the
  -- first school to try setting a colour.
  v_ratio := public.wcag_contrast_ratio('#F1F3FA', '#1E2A3F');
  IF v_ratio IS NULL OR v_ratio < 4.5 THEN
    RAISE EXCEPTION '0094: the ZSMS default anchor measures % on the page — below its own threshold', v_ratio;
  END IF;

  v_ratio := public.wcag_contrast_ratio('#3A8DDE', '#F1F3FA');
  IF v_ratio IS NULL OR v_ratio < 3.0 THEN
    RAISE EXCEPTION '0094: the ZSMS default primary measures % on the page — below its own threshold', v_ratio;
  END IF;

  -- And the tightening must actually bite. #6E7690 is the worked example from
  -- the header comment: acceptable to 0092, unreadable in practice.
  v_ratio := public.wcag_contrast_ratio('#F1F3FA', '#6E7690');
  IF v_ratio IS NULL OR v_ratio >= 4.5 THEN
    RAISE EXCEPTION
      '0094: #6E7690 measures % on the page — the constraint did not tighten', v_ratio;
  END IF;
END;
$$;

-- === MIGRATION END ===
