/**
 * ZSMS design tokens — the single source of truth.
 *
 * Consumed by three surfaces that must not drift apart:
 *
 *   - `apps/web`          → CSS custom properties, then Tailwind
 *   - `@zsms/documents`   → PDF receipts, statements, report cards
 *   - `@zsms/notifications` → transactional email
 *
 * A parent who receives a receipt PDF, opens the email it came in, and then logs
 * into the portal is looking at one school three times. If the header navy in
 * the PDF is a different navy, the product looks assembled rather than designed.
 * Hence one definition, imported everywhere, never a hex typed into a component.
 *
 * Scale note: `spacing` and `radius` are plain numbers in px. Tailwind's own
 * scale is used for layout; these exist for the PDF renderer, which has no
 * Tailwind and would otherwise grow its own magic numbers.
 */

import { deriveDarkScale, deriveScale, type ColorScale } from './scale'

// ---------------------------------------------------------------------------
// Brand — the colours as given, before any derivation
// ---------------------------------------------------------------------------

/**
 * The ZSMS brand hexes exactly as specified from the logo.
 *
 * These are the *inputs*. Nothing renders text directly from them — see
 * `scale.ts` for why. Kept separate so the brand definition stays legible and
 * an audit can compare it against the logo without reading derivation code.
 */
export const BRAND = {
  /**
   * Near-charcoal navy. Deliberately deeper than the original `#2B3A55`.
   *
   * This colour's job is **text and structure, not fill.** At 14.4:1 on white it
   * is a body-text colour first, a heading colour second, and a navigation
   * colour third — and it should rarely appear as a large solid block. A saturated
   * navy panel reads as a heavy chrome bar from an older generation of admin
   * software; the same navy used as *ink* on a light ground reads as considered.
   * The airiness the product wants comes from what is left uncoloured.
   */
  navy: '#1E2A3F',
  blue: '#3A8DDE',
  green: '#4A9B4F',
  amber: '#F5A623',
  coral: '#E15A44',
  teal: '#1BA0B0',
} as const

/**
 * Neutrals, tinted toward lavender-blue rather than pure grey.
 *
 * The hue runs at roughly 228°, at very low saturation. Two things follow:
 *
 * The **page** can be a soft tinted ground (`100`) rather than white, with cards
 * in true white on top. That inversion — coloured page, white card — is most of
 * what makes an interface feel modern and calm rather than flat. A white page
 * with white cards has to draw every boundary with a line; a tinted page lets the
 * card float without one.
 *
 * And the neutrals sit in the *same hue family* as the navy, so greys next to
 * navy text read as one palette. Pure `#808080` beside a blue-black looks like
 * two products glued together.
 */
export const NEUTRAL = {
  0: '#FFFFFF',
  25: '#FAFBFE',
  50: '#F6F7FC',
  /** The page ground. Soft lavender-grey — the surface everything else sits on. */
  100: '#F1F3FA',
  /** Recessed inside a card: zebra rows, track fills, ghost-button hover. */
  150: '#E9ECF6',
  /** Decorative dividers and card edges. */
  200: '#E0E4F0',
  300: '#C7CDDF',
  400: '#98A0B8',
  /** 5.19:1 on white, 4.69:1 on the page ground — safe as subtle text on both. */
  500: '#646C88',
  600: '#4C5470',
  700: '#363D54',
  800: '#232838',
  /** Dark-mode card. A touch lighter than the page, which is the whole depth cue. */
  850: '#1A1F2A',
  /** Dark-mode page ground. Deep charcoal, never pure black. */
  900: '#14181F',
} as const

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

/**
 * Inter throughout, per the brand direction: one family for headings, body, and
 * data tables.
 *
 * `tabular-nums` is not decoration. A fees table where 1,200.00 and 990.00 do
 * not align on the decimal is materially harder to scan, and a bursar scans
 * hundreds of rows. Every numeric cell and every money figure opts in.
 */
export const TYPOGRAPHY = {
  fontFamily: {
    sans: "'Inter Variable', 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
    // The PDF renderer embeds real font files; this names them for that path.
    pdf: 'Inter',
  },
  /** px, paired with its line-height. */
  size: {
    xs: { size: 12, lineHeight: 16 },
    sm: { size: 13, lineHeight: 20 },
    base: { size: 15, lineHeight: 24 },
    lg: { size: 17, lineHeight: 26 },
    xl: { size: 20, lineHeight: 28 },
    '2xl': { size: 24, lineHeight: 32 },
    '3xl': { size: 30, lineHeight: 38 },
    '4xl': { size: 36, lineHeight: 44 },
  },
  /**
   * Small-screen overrides, applied below 480px.
   *
   * **Headings and chrome shrink. Body text does not.** A 15px body is already
   * at the floor of comfortable reading, and the users who most need this
   * product to work on a phone — a parent checking a fee balance outside a
   * school gate — are the least able to zoom their way out of a bad decision.
   * What actually wastes a small screen is display type sized for a 27" monitor:
   * a 36px page title costs three lines and most of the fold before any content
   * appears.
   *
   * `base`, `sm`, and `xs` are deliberately absent from this map.
   */
  mobileSize: {
    lg: { size: 16, lineHeight: 24 },
    xl: { size: 17, lineHeight: 24 },
    '2xl': { size: 19, lineHeight: 26 },
    '3xl': { size: 22, lineHeight: 28 },
    '4xl': { size: 26, lineHeight: 32 },
  },
  weight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  /** Tightened on display sizes only; body text keeps default tracking. */
  letterSpacing: {
    tight: '-0.02em',
    normal: '0',
    wide: '0.02em',
  },
} as const

// ---------------------------------------------------------------------------
// Spacing, radius, elevation
// ---------------------------------------------------------------------------

/** 4px base. Every gap in the product is a multiple of it. */
export const SPACING = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
} as const

/**
 * Layout sizing that changes with the viewport.
 *
 * Emitted as CSS custom properties and swapped in one media query, so a
 * component writes `p-[var(--zsms-card-padding)]` once and is correct at every
 * width. The alternative — `p-3 sm:p-5` scattered across sixty components — is
 * the same decision made sixty times, and it drifts.
 *
 * **`tapTarget` is in this object and is identical in both rows.** That is the
 * point of listing it: it makes "this one does not shrink" a visible property of
 * the system rather than something a reviewer has to notice is missing. 44px is
 * the WCAG 2.5.5 / iOS floor, and a school corridor with a cracked screen
 * protector is not the place to test whether 36px is good enough.
 */
export const SIZING = {
  /** ≥ 480px. */
  base: {
    cardPadding: 20,
    cardGap: 20,
    stackGap: 16,
    sectionGap: 40,
    pageGutter: 24,
    tapTarget: 44,
  },
  /** < 480px. */
  mobile: {
    cardPadding: 14,
    cardGap: 12,
    stackGap: 12,
    sectionGap: 28,
    pageGutter: 16,
    tapTarget: 44,
  },
} as const

/** The breakpoint the mobile row applies below. */
export const MOBILE_MAX_WIDTH = 480

export const RADIUS = {
  none: 0,
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  full: 9999,
} as const

/**
 * Shadows are deliberately restrained. A school system is read all day; heavy
 * elevation on every card produces visual noise that costs attention without
 * adding information. Cards use a border by default and reserve shadow for
 * things that genuinely float — menus, dialogs, toasts.
 */
export const SHADOW = {
  none: 'none',
  sm: '0 1px 2px 0 rgb(21 26 36 / 0.05)',
  md: '0 2px 8px -1px rgb(21 26 36 / 0.08), 0 1px 3px -1px rgb(21 26 36 / 0.06)',
  lg: '0 8px 24px -4px rgb(21 26 36 / 0.12), 0 2px 6px -2px rgb(21 26 36 / 0.06)',
  focus: `0 0 0 3px ${BRAND.blue}40`,
} as const

// ---------------------------------------------------------------------------
// Semantic roles
// ---------------------------------------------------------------------------

/**
 * The colour hierarchy, stated as a type.
 *
 * The brief is explicit that these are not equal-weight colours: navy and white
 * do the work, blue is the *single* primary action colour, and the rest are
 * semantic only. Modelling that here means a component asks for `danger` or
 * `primary` and cannot ask for "the coral one" to decorate something.
 */
export interface SemanticColors {
  /** Navy. Headers, primary text, navigation. The anchor. */
  anchor: ColorScale
  /** Blue. THE action colour — buttons, links, active states. Nothing else. */
  primary: ColorScale
  /** Green. Paid, positive balance, present. */
  success: ColorScale
  /** Amber. Due soon, pending, partial. Never carries white text — see below. */
  warning: ColorScale
  /** Coral-red. Overdue, arrears, errors, destructive actions. */
  danger: ColorScale
  /** Teal. Used sparingly — secondary charts, informational accents. */
  accent: ColorScale
}

export interface SurfaceColors {
  /**
   * The page ground.
   *
   * Not white. A soft lavender-grey in light mode, deep charcoal in dark — in
   * both cases a shade *away* from the card colour, so a card reads as sitting
   * on the page rather than being cut out of it.
   */
  background: string
  /** Cards and panels. White in light mode; one step up from the page in dark. */
  surface: string
  /** A recessed area — table zebra striping, track fills, ghost-button hover. */
  surfaceSunken: string
  /**
   * Decorative dividers — card edges, table rules, separators.
   *
   * Deliberately low contrast and **not** subject to WCAG 1.4.11, which governs
   * the boundary of *active controls*, not ornamental lines. Forcing 3:1 here
   * would box every card in hard grey and make a dense fees table harder to
   * read, not easier.
   */
  border: string
  /**
   * The boundary of an interactive control — input, select, checkbox.
   *
   * This one **is** governed by 1.4.11 and must clear 3:1 against the surface
   * behind it. A form field whose edge is invisible is the classic failure, and
   * it lands hardest on the users this product is built for: staff entering
   * hundreds of rows on cheap screens in bright rooms.
   */
  borderStrong: string
  text: string
  textMuted: string
  textSubtle: string
  /**
   * Text on a filled primary/danger button.
   *
   * In dark mode the button fill is *lightened* to clear AA, so its label turns
   * dark. This is why it cannot be assumed to be white.
   */
  textOnFill: string
  /**
   * Text on the anchor-coloured header and side navigation.
   *
   * Separate from `textOnFill` because the two diverge in dark mode: buttons get
   * lighter and take dark labels, while the header stays deep navy and keeps
   * light ones. Collapsing them put near-black text on the dark header at
   * 1.53:1 — caught by `auditTheme`, which is what it is for.
   */
  textOnAnchor: string
  /**
   * The keyboard focus indicator.
   *
   * Cannot simply be the brand colour. A school whose primary is a deep forest
   * green gets a ring measuring 2.82:1 against the dark-mode background —
   * invisible, which for a keyboard user means losing their place entirely.
   * So the ring resolves per mode to the step that clears 1.4.11 against the
   * surface it is drawn on.
   */
  focusRing: string
}

export interface ThemeTokens {
  colors: SemanticColors
  surface: SurfaceColors
  mode: 'light' | 'dark'
}

/**
 * Amber carries dark text, always.
 *
 * At 2.03:1 against white, amber fails even the 3:1 non-text bar, so it can
 * never be a solid fill behind white letters. Its role is a tint background with
 * navy text — which measures ~10:1 and reads clearly. This constant exists so
 * the rule is enforced in one place rather than remembered per component.
 */
export const AMBER_REQUIRES_DARK_TEXT = true

// ---------------------------------------------------------------------------
// The default ZSMS theme
// ---------------------------------------------------------------------------

export function buildLightTheme(brand: {
  navy: string
  blue: string
  green: string
  amber: string
  coral: string
  teal: string
}): ThemeTokens {
  // Text steps are derived against the PAGE, not white — the page is the darker
  // of the two light grounds, so clearing it clears the card too. See
  // `deriveScale`'s note for the failure that made this explicit.
  const ground = NEUTRAL[100]
  const primary = deriveScale(brand.blue, ground)

  return {
    mode: 'light',
    colors: {
      anchor: deriveScale(brand.navy, ground),
      primary,
      success: deriveScale(brand.green, ground),
      warning: deriveScale(brand.amber, ground),
      danger: deriveScale(brand.coral, ground),
      accent: deriveScale(brand.teal, ground),
    },
    surface: {
      // Tinted page, white cards. See NEUTRAL's note — this pairing is what
      // carries the airy, modern feel, and it costs nothing at runtime.
      background: NEUTRAL[100],
      surface: NEUTRAL[0],
      surfaceSunken: NEUTRAL[150],
      border: NEUTRAL[200],
      // 5.19:1 against white, 4.69:1 against the page. Input borders are held to
      // the control-boundary rule, and this errs deliberately on the dark side —
      // GOV.UK, the most rigorously tested accessible form system in production,
      // goes darker still.
      borderStrong: NEUTRAL[500],
      text: brand.navy,
      textMuted: NEUTRAL[600],
      textSubtle: NEUTRAL[500],
      textOnFill: NEUTRAL[0],
      textOnAnchor: NEUTRAL[0],
      // On white, step 500 always clears 3:1 — a colour pale enough to fail is
      // already refused by `validateTheme`.
      focusRing: primary[500],
    },
  }
}

/**
 * Dark mode, derived from the same brand input rather than authored separately.
 *
 * Three properties, each chosen against a specific failure:
 *
 * **The ground is deep charcoal (`#14181F`), never pure black.** Pure black
 * maximises contrast and is worse for it: text on `#000` produces halation, the
 * smearing effect where light letterforms bleed at their edges, and it is the
 * single most common complaint about dark themes from people who read them all
 * day. A charcoal a few points off black removes it and costs nothing measurable.
 *
 * **Cards sit one step *lighter* than the page (`#1A1F2A`).** In light mode
 * elevation reads as a shadow; on a dark ground shadows are invisible, so
 * lightness is the only depth cue available. Cards darker than the page — the
 * naive inversion of the light theme — read as holes.
 *
 * **Accents are desaturated**, in `deriveDarkScale`. See its note.
 *
 * Body text sits at `NEUTRAL[100]` rather than pure white for the same
 * halation reason; it is not a WCAG requirement, it is a comfort one.
 */
export function buildDarkTheme(brand: {
  navy: string
  blue: string
  green: string
  amber: string
  coral: string
  teal: string
}): ThemeTokens {
  const page = NEUTRAL[900]
  const card = NEUTRAL[850]

  // Scales are derived against the CARD, not the page. Tinted chips and their
  // text live inside cards, so the card is the ground the contrast search must
  // clear — deriving against the darker page would return steps that pass there
  // and fall short by a hair where they are actually drawn.
  const primary = deriveDarkScale(brand.blue, card)

  return {
    mode: 'dark',
    colors: {
      anchor: deriveDarkScale(brand.navy, card),
      primary,
      success: deriveDarkScale(brand.green, card),
      warning: deriveDarkScale(brand.amber, card),
      danger: deriveDarkScale(brand.coral, card),
      accent: deriveDarkScale(brand.teal, card),
    },
    surface: {
      background: page,
      surface: card,
      surfaceSunken: '#232935',
      border: '#2B3240',
      // 3.47:1 against the card — the same control-boundary rule as light mode,
      // measured against a different ground.
      borderStrong: NEUTRAL[500],
      text: NEUTRAL[100],
      // Both bumped lighter than the light-mode equivalents: on a dark surface,
      // NEUTRAL[500] as body text fails AA.
      textMuted: NEUTRAL[300],
      textSubtle: NEUTRAL[400],
      textOnFill: NEUTRAL[900],
      // In dark mode the anchor is a light ink on a dark ground, not a navy
      // block, so "text on anchor" means text on the anchor's tinted panel.
      textOnAnchor: NEUTRAL[100],
      // Step 600, not 500: lightened until it clears 4.5:1 against this ground,
      // so the ring stays visible whatever colour the school chose.
      focusRing: primary[600],
    },
  }
}

/** The ZSMS default theme — the fallback whenever a school has set nothing. */
export const ZSMS_LIGHT = buildLightTheme(BRAND)
export const ZSMS_DARK = buildDarkTheme(BRAND)
