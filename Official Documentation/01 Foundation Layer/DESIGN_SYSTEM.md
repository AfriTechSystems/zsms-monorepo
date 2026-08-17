# DESIGN_SYSTEM.md — Visual Design System and Per-School Theming

## Related Documents

- `01 Foundation Layer/DECISIONS.md` — ADR-043 records the theming decision and its constraints
- `01 Foundation Layer/DYNAMIC_CONFIG.md` — school branding as school-scoped dynamic configuration
- `01 Foundation Layer/CONVENTIONS.md` — file, component, and token naming
- `01 Foundation Layer/COMPLIANCE.md` — accessibility obligations
- `05 Core Database and API Reference/SCHEMA.md` — `public.school_branding`
- `13 Document and PDF System/PDF_GENERATION.md` — where the theme reaches printed documents
- `12 Communication System/TEMPLATES.md` — where the theme reaches email
- `15 Super Admin and Platform/SUPERADMIN.md` — the AfriTech dashboard, which is never themed
- `16 Testing and Launch/UAT_CHECKLIST.md` — accessibility acceptance

---

## Purpose

This document defines the single source of truth for how ZSMS looks: the colour tokens, the type scale, the spacing rhythm, the component variants, and the rules under which a school may substitute its own brand. It exists so that no screen invents its own colour, no component hardcodes a hex value, and no school can configure an interface its own parents cannot read.

It is authoritative for `packages/design-tokens`, `apps/web/components`, and any future surface — mobile, PDF, or email — that renders a school's identity.

---

## Overview

ZSMS is used every working day by people who did not choose it and were not trained on it: a bursar reconciling forty payments before break, a teacher entering marks between lessons, a parent checking a fee balance on a phone with two bars of signal. The design system is built for that reader, and the priority order is fixed:

> **Legibility first, then calm, then brand.**

Three structural decisions follow from that ordering and are not negotiable per screen.

**1. Nothing is styled per screen.** Every colour, radius, shadow, and font size is a token in `packages/design-tokens`, emitted as CSS custom properties. A component reads `var(--primary)`; it never reads `#3A8DDE`. This is what makes per-school theming free: the school's colours arrive as different values for the same variables, and no component knows the difference.

**2. Colour is applied as a tint, not as a block, and it carries hierarchy.** The brand palette has six colours; used at equal weight and full saturation they produce a carnival. They are ranked instead — see *Colour Hierarchy* — and applied as pale chips with darker text on top rather than as saturated panels. A row of saturated cards competes with the data underneath it: every card shouts equally, so none of them signals anything.

**Navy is ink, not fill.** The anchor colour's job is body text, headings, and navigation labels. It should rarely appear as a large solid block — a saturated navy panel reads as chrome from an older generation of admin software, while the same navy used as ink on a light ground reads as considered. The airiness comes from what is left uncoloured.

**3. Accessibility is arithmetic, not opinion.** WCAG AA contrast is computed, asserted in tests, and enforced by a database constraint. It is not reviewed by eye. The palette a school supplies is checked before it is stored, and a palette that fails is refused rather than warned about.

---

## The Token Layer

`packages/design-tokens` is a dependency-free TypeScript package. It has no framework imports because it runs in three places that share nothing else: the browser, the Next.js server, and the pdf-lib renderer inside a Railway worker.

| Module | Responsibility |
|---|---|
| `contrast.ts` | WCAG relative luminance, contrast ratio, AA thresholds, `readableTextOn()` |
| `scale.ts` | Derives an 8-step colour scale from one brand hex |
| `tokens.ts` | Brand, neutral, typography, spacing, radius, shadow; builds light and dark themes |
| `theme.ts` | School branding input, validation, logo fallback, resolution |
| `css.ts` | Tokens → CSS custom properties |

### Why a scale is derived rather than authored

The supplied ZSMS brand palette is a *brand* palette, not an interface palette. Measured against the ground it is drawn on, only the anchor navy passes WCAG AA for normal text:

| Role | Hex | vs page `#F1F3FA` | Passes AA text (4.5:1)? | Passes AA non-text (3:1)? |
|---|---|---|---|---|
| Anchor navy | `#1E2A3F` | 12.99:1 | Yes | Yes |
| Primary blue | `#3A8DDE` | 3.13:1 | **No** | Yes |
| Success green | `#4A9B4F` | 3.11:1 | **No** | Yes |
| Warning amber | `#F5A623` | 1.83:1 | **No** | **No** |
| Danger coral | `#E15A44` | 3.30:1 | **No** | Yes |
| Accent teal | `#1BA0B0` | 2.83:1 | **No** | **No** |

**Measured against the page, not white.** The page ground is a soft lavender-grey, and it is darker than white, so it is the binding surface — a colour derived to clear 4.5:1 on `#FFFFFF` lands at 4.15:1 once it is drawn on the page. That is the easier test passing while the real one fails, and it is exactly what happened when the page stopped being white; the audit caught it the same afternoon.

Using these directly as text colours would fail accessibility on nearly every label in the product. Discarding them would throw away the brand. The resolution is a derived scale:

| Step | Role | Guarantee |
|---|---|---|
| 50 / 100 / 200 | Tints — stat-card, badge, and callout backgrounds | Light enough to carry step-700 text; progressively desaturated as they lighten |
| **500** | **The brand hex, unmodified** — large decorative fills, swatches | None. It is the brand as given. |
| **mark** | Icons, status dots, bar segments | ≥3:1 against this hue's own `100` tint |
| 600 | Text and solid button backgrounds | Darkened in HSL until ≥4.5:1 against the page |
| 700 | Text on a tint of the same hue | ≥7:1 |
| 800 | Deepest step, borders on dark fills | — |

**Why `mark` exists as a separate step.** WCAG 1.4.11 asks 3:1 of a graphical object against what surrounds it, and the ground these marks sit on is the hue's own `100` chip — the tightest pairing in the system. Measured flat, the brand hues do not all clear it: blue lands at 2.93, teal at 2.79, and **amber at 1.80**, which is a status dot invisible on the chip it is meant to label. So the mark is derived to guarantee the bar, exactly as `600` is derived to guarantee text. For hues that already pass, it is indistinguishable from `500`.

**Tints are desaturated as they lighten.** Raising lightness alone preserves saturation, and a fully saturated colour at 93% lightness reads as sherbet. Pulling saturation down as lightness rises gives the chalky, slightly greyed tint the aesthetic wants. It is the single adjustment that most changes how designed the result looks, and it costs one multiplier.

**The brand colour itself is preserved exactly, at step 500.** A parent looking at a fee card sees the school's actual green on the status bar. The 4.5:1 obligation is met by step 600, which is the same hue at lower lightness — recognisably the same colour, legibly darker.

Amber is the case that proves the rule: it cannot carry white text at any usable lightness, so `AMBER_REQUIRES_DARK_TEXT` is exported and warning fills take dark text rather than white.

### Dark mode

Dark mode is **not** an inversion. Inverting a light theme puts step-600 text (chosen to be dark) on a dark surface, which fails immediately. `deriveDarkScale()` takes the *light* end of each hue for text on dark surfaces and the mid steps for fills, and the audit is re-run against the dark surface set rather than assumed to transfer.

Three properties, each chosen against a specific failure:

| Property | Value | Why |
|---|---|---|
| Ground | `#14181F` — deep charcoal, never pure black | Text on `#000` produces halation, the smearing where light letterforms bleed at their edges. It is the most common complaint about dark themes from people who read them all day, and a charcoal a few points off black removes it at no measurable cost. |
| Card | `#1A1F2A` — one step **lighter** than the page | In light mode elevation reads as a shadow; on a dark ground shadows are invisible, so lightness is the only depth cue left. Cards darker than the page — the naive inversion — read as holes. |
| Accents | Desaturated ~18% | A fully saturated hue on charcoal does not read as brighter, it reads as *vibrating*: the eye cannot settle on the edge between a neon accent and a near-black ground. Over a shift that is fatigue, not emphasis. |

Dark scales are derived against the **card**, not the page, because tinted chips and their text live inside cards. Deriving against the darker page returns steps that pass there and fall short by a hair where they are actually drawn. Body text sits at `#F1F3FA` rather than pure white, again for halation rather than for WCAG.

`data-theme` on `<html>` is the single switch. Tailwind's `dark:` utilities compile against a selector, and CSS custom properties can flip on a media query; if both mechanisms were live they would disagree for every user on the "system" setting — variables dark, utilities light. A pre-paint script resolves "system" to an explicit `data-theme` value so exactly one mechanism is ever in play. The `prefers-color-scheme` block in the emitted stylesheet is scoped to `:root:not([data-theme])` and exists only as a no-JavaScript fallback.

---

## Colour Hierarchy

Equal-weight use of six brand colours produces a carnival. The ranking is:

| Rank | Colour | Where it may appear |
|---|---|---|
| Workhorse | Navy ink + white cards + lavender-grey page | Body text, headings, navigation labels, surfaces, borders. The majority of every screen, and almost none of it as a solid navy area. |
| Single action | Blue | Primary buttons, links, active states, focus rings. **One filled primary button per view.** |
| Semantic | Green / amber / coral | Only where they carry meaning — see the mapping below |
| Sparing accent | Teal | Informational figures and occasional highlight. Never a status. |

All six hues — plus a lavender-grey derived from the anchor — are available as **soft-tint chips**: `bg-<role>-tint` for the panel, `text-<role>-text` for its text, `text-<role>-fill` for its icon or status dot. Warmth comes from having six quiet tints available, not from turning any one of them up.

### Semantic mapping — fixed across every domain

| Meaning | Colour | Fees | Attendance | Results |
|---|---|---|---|---|
| Positive / settled | Green | Paid, credit balance | Present | Pass, published |
| Attention soon | Amber | Due soon, partially paid | Late | Borderline |
| Negative / overdue | Coral-red | Overdue, arrears | Absent | Fail, unpublished |

This mapping is learned once and reused everywhere, which is most of its value. It is also why **semantic colours are not themeable** (see below): a school that set "overdue" to green would not be expressing a brand, it would be creating a misreading of money.

**Colour is never the only signal.** Every status that is coloured is also written in words, and every proportional bar carries a text alternative. Roughly 8% of male users cannot reliably distinguish the green/amber/coral set, and a fee balance is not a place to find out.

---

## Typography

**Inter throughout** — body, headings, and data tables. One family, because the interface is dense with tabular data and a second display face would buy personality at the cost of the vertical rhythm that makes a fifty-row marks table scannable.

| Token | Size | Use |
|---|---|---|
| `xs` | 12px | Table meta, timestamps |
| `sm` | 14px | Secondary text, labels |
| `base` | **15px** | Body |
| `lg` | 17px | Card titles |
| `xl` – `4xl` | 20–34px | Headings |

Body is 15px rather than the more common 16px: the product is table-dense, and 15px Inter fits meaningfully more of a fee statement on a laptop screen without dropping below comfortable reading size.

**`font-variant-numeric: tabular-nums` is applied globally to `table` and to any element marked `data-numeric`.** Proportional figures make a column of money ragged, and comparing two amounts becomes a reading task rather than a glance. This is not cosmetic — it is the single highest-value typographic decision in a fees product.

---

## Spacing, Radius, and Elevation

- **Spacing** is a 4px base scale. Nothing sits at an off-scale value.
- **Radius** is `sm 4 / md 6 / lg 8 / xl 12`. Cards use `lg`, inputs and buttons `md`.
- **Elevation** is three shadows only. Depth is used to separate a floating layer from the page, never to decorate a card that is already bounded.
- **Touch targets** are 44px minimum on the default control size. Below that, tapping on a phone in a school corridor is a coin toss.

---

## Component Rules

- **Colour arrives as a tint.** A coloured area is `bg-<role>-tint` with `text-<role>-text` on it. Saturated fills are reserved for the one primary button and for small marks — icons, status dots, bar segments — drawn in `<role>-fill`, the step derived to clear 3:1 against its own tint.
- **One filled primary button per view.** A screen with three competing filled buttons is a screen where a tired bursar clicks the wrong one. Secondary actions are `outline`, `secondary`, or `ghost`.
- **`destructive` is reserved** for actions that delete or reverse money. It is not a general-purpose red button.
- **Every input has a visible label.** Placeholder-as-label disappears exactly when the user needs it.
- **Errors preserve input.** A validation failure never clears the field it rejected.
- **Every list has a designed empty state and a designed loading state.** Both are components, not afterthoughts: a blank panel is indistinguishable from a broken one.
- **Focus is visible everywhere.** A single global `:focus-visible` ring, using a mode-aware token, applied once rather than per component.
- **Loading buttons stay focusable.** `aria-busy` and `aria-disabled` rather than `disabled`, which would drop the control out of the tab order mid-interaction and move focus somewhere unpredictable.

---

## Per-School Theming

A school configures **colours and a logo. Nothing else.**

### What a school may set

| Field | Meaning | Unset behaviour |
|---|---|---|
| `anchor_color` | Ink — body text, headings, navigation | ZSMS navy `#1E2A3F` |
| `primary_color` | Buttons, links, active states | ZSMS blue `#3A8DDE` |
| `logo_url` | Full wordmark | School initials |
| `icon_url` | Square mark — favicon, collapsed nav | School initials |

Stored in `public.school_branding`, one row per school, keyed on `school_id`. Every field falls back independently: a school that sets only a logo keeps ZSMS colours, and a school that sets only colours gets its initials in its own navy. Partial configuration is the normal state during onboarding, not an error.

### What a school may not set

**Layout and structure are fixed.** No school moves navigation, renames a column, or reorders a form. Two reasons, both practical: staff move between schools and the product should not need relearning, and one support team cannot answer "where is the button" for forty different layouts.

**Semantic colours are fixed.** Green/amber/coral mean paid/due-soon/overdue everywhere. See the mapping above.

**Typography, spacing, and radius are fixed.** A school changing the type scale would be changing how much of a marks table fits on screen.

### Where the theme propagates

A theme is not a web-UI feature. It reaches every surface a family sees:

| Surface | Mechanism |
|---|---|
| School staff portal | CSS custom properties, server-rendered into `<head>` |
| Parent and student portals | Same, inherited via `school_id` |
| Teacher web | Same |
| **Parent login screen** (unauthenticated) | `school_branding_by_slug()` — see *Security Considerations* |
| **PDFs** — receipts, statements, report cards | `worker_school_branding()` and `worker_payment_context()` return the colours; `packages/documents` draws the school name and header rule in the anchor colour |
| **Emails** | Template colours resolved from the same row |
| **AfriTech admin dashboard** | **Never themed.** Always ZSMS. |

The admin exclusion is deliberate and important. An operator moves between forty schools in a session and impersonates users inside them. If the platform's own tooling adopted each school's colours, *"am I in AfriTech admin or inside a school"* would become a question answered by reading the URL — exactly when getting it wrong is most costly.

Colours are emitted **server-side into the first HTML response**. There is no client-side theme fetch and therefore no flash of ZSMS blue before a school's own blue loads. On the parent portal — a phone, a slow connection — that is the difference between arriving at your school's system and arriving at a generic one.

### The accessibility guardrail

A school's colour choice is validated before it is stored, against two thresholds:

| Field | Requirement | Why |
|---|---|---|
| `anchor_color` | ≥ **4.5:1** against the page `#F1F3FA` | It is the ink the interface is written in — normal-size text, WCAG 1.4.3 |
| `primary_color` | ≥ **3:1** against the page `#F1F3FA` | Used unmodified as a button and chip fill; below this the control's own edge vanishes — WCAG 1.4.11 |

Both are measured against the **page**, not white, because the page is the darker of the two light grounds and therefore the binding one. Measuring against white would let a near-miss through: `#6E7690` reaches 4.51:1 on white and falls to 4.07:1 on the page. This changed in migration `0094`, after the page stopped being white.

**These are refusals, not warnings.** A warning would be dismissed by whoever is setting the school up at 9pm the night before launch, and the people who then cannot read their fee balance are parents who never chose the colour.

The rule is enforced in **two independent places**: `validateTheme()` in `packages/design-tokens`, which produces the readable error a school sees; and CHECK constraints on `public.school_branding`, which hold when the API is not in the path — an admin tool, a support script, a bulk import. The SQL implementation of the WCAG luminance formula is asserted against fixed ratios that the TypeScript produces, so the two cannot drift silently.

Only these two colours are constrained because only these two are configurable. Text steps are *derived* by darkening, which always succeeds; the guardrail covers the two cases derivation cannot rescue.

### Logo fallback

No logo is the normal state for a new school. The fallback is the school's initials, with stopwords dropped: *"The Lusaka Academy of Science"* gives **LAS**, not TLA — the letters a parent recognises. Capped at three characters, because four squeezed into a 32px avatar is illegible, which defeats the point.

---

## Business Rules

1. No component may contain a hardcoded colour, radius, shadow, or font size. Tokens only.
2. Exactly one filled primary action per view.
3. Semantic colour is always accompanied by text. Colour is never the sole carrier of meaning.
4. A school's theme is colours and logo only. Layout, structure, typography, and semantic colours are not configurable.
5. A school theme failing WCAG AA is refused at write time, in both the application and the database.
6. The AfriTech admin dashboard is never themed.
7. School-facing surfaces — including the unauthenticated parent login screen — show the school's logo and colours.
8. The theme applies to PDFs and emails, not only to the web UI.
9. Every school-facing view supports keyboard navigation, has visible focus, and meets WCAG AA contrast.
10. Every list has a designed empty state and a designed loading state.
11. Layouts are verified at 375px width.

---

## Edge Cases and Error Handling

| Case | Behaviour |
|---|---|
| School has no branding row | ZSMS default. Absent is the normal state, not an error. |
| Some fields set, others null | Each field falls back independently. |
| Stored colour is not valid hex | `resolveTheme()` falls back to the default rather than throwing. Bad data here means validation was bypassed, but a parent checking a fee balance should see a stock-themed page, not a 500. |
| Colour fails AA on write | Refused with a message naming the measured ratio and the required one. |
| Logo URL 404s or is corrupt | Web falls back to initials; PDF renders without a logo. A broken image never fails a receipt. |
| Logo is neither PNG nor JPEG | PDF embed is attempted as PNG, then JPEG, then skipped. Cosmetic failure only. |
| School is terminated or unverified | `school_branding_by_slug()` returns nothing; the login page renders ZSMS default. |
| User is on "system" colour scheme | Pre-paint script resolves to an explicit `data-theme` so variables and Tailwind utilities cannot disagree. |
| JavaScript disabled | The `prefers-color-scheme` fallback in the emitted stylesheet still produces a correctly themed page. |
| `prefers-reduced-motion` | Transitions and animations are suppressed globally. |

---

## Integration Points

| System | Interaction |
|---|---|
| `packages/design-tokens` | The token source. Consumed by web, PDF renderer, and email templates. |
| `apps/web/lib/theme.tsx` | Server-side resolution: `loadSchoolBranding()`, `loadSchoolBrandingBySlug()`, `platformTheme()`, `ThemeStyle`. |
| `public.school_branding` (0092) | Storage, RLS, and the AA constraints. |
| `school_branding_by_slug()` (0092) | The unauthenticated login-screen surface. |
| `worker_school_branding()` (0092) | Report cards and statements. |
| `worker_payment_context()` (0093) | Receipts. |
| `packages/documents` | `brandColor()` and the themed `header()`. |
| Cloudflare R2 | Public bucket holds logo and icon. Only URLs the API minted are stored. |
| Clerk | The organisation slug (`zm-lsk-0001`) is the same public slug the login route uses. |

---

## Security Considerations

**The login-screen surface is a `SECURITY DEFINER` function, not an `anon` policy.** The parent login page must be branded before anyone has a session, so RLS has nothing to resolve. A blanket `anon` SELECT policy on `school_branding` would answer that and would also hand any caller the entire branding table. `school_branding_by_slug()` returns one school, by the slug already in the URL, with exactly five keys — name, two colours, two logo URLs. The key set is pinned by a test so that adding a column to `schools` cannot widen an anon-readable surface by accident.

**Enumeration is accepted and bounded.** The slug is `lower(schools.school_id)` — sequential, and therefore walkable. What a walk yields is a school's name, two colours, and a logo: public signage, not personal data. No count, no status detail, no person. A terminated or unverified school returns nothing. Introducing a second, unguessable public identifier was considered and rejected: the Clerk organisation slug already uses this value, and a parallel identifier would be one more thing that can disagree.

**A logo URL is rendered on an unauthenticated page.** A URL pointing at storage we do not control would let a third party observe every parent who opens a school's login screen. The database requires HTTPS; host restriction is enforced at upload time, where the API only ever stores a URL it minted itself against R2.

**No school-supplied string reaches the emitted stylesheet.** `ThemeStyle` uses `dangerouslySetInnerHTML`, which is unavoidable for a `<style>` element. It is safe because every value originates from `@zsms/design-tokens`, which returns only hex strings it generated; a stored value that is not valid hex is discarded by `resolveTheme()` rather than passed through.

**Writing a brand is management-only.** Owner, principal, and admin. Not accountant, not teacher — a brand change is visible to every family at the school. Reading is deliberately wider than most configuration, because parents, students, and teachers all render the theme.

---

## Known Limitations and Future Work

| Item | Status |
|---|---|
| **Email theming is plumbed, not rendered.** The colours are available to the notification layer, but the HTML email templates still use fixed ZSMS colours. | Open — Phase 4 sub-phase 3 |
| **Logo upload flow does not exist.** `school_branding` stores URLs; nothing yet writes to R2 or mints them. Until the school-portal settings screen is built, branding is set by direct write. | Open — Phase 4 sub-phase 2 |
| **The AA guardrail checks the two configurable colours only.** It does not simulate colour-vision deficiency or check a school's colour against its own logo. | Accepted. Broader simulation is a design-review task, not a write-time gate. |
| **Dark mode for PDFs is not a thing and will not be.** Paper is white. | Closed by decision. |
| **No visual regression testing.** Contrast is asserted arithmetically; layout is not asserted at all. | Open — depends on CI, which does not exist (Layer 7). |
| **`schools.logo_url` is superseded but not dropped.** Retained as a fallback for schools onboarded before 0092. | Accepted. Removal is a destructive migration and needs a backfill first. |

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-08-16 | Initial version — token layer, colour hierarchy, typography, component rules | Layer 1 (Frontend) had no foundation document; Phase 4 needed one before any screen |
| 2026-08-16 | Documented the derived-scale approach and the measured brand-palette contrast failures | Five of six brand colours fail AA as text; recording the measurements prevents the decision being relitigated by eye |
| 2026-08-16 | Per-school theming defined — scope, propagation, guardrail, logo fallback | ADR-043 |
| 2026-08-16 | Recorded the two-place enforcement of the AA guardrail and the SQL/TS agreement assertions | A guardrail present in only one of two writers is one that will eventually be walked past |
| 2026-08-17 | Anchor navy deepened to `#1E2A3F` and reframed as **ink rather than fill** | A saturated navy bar reads as older admin chrome; the same colour as text reads as considered, and the airiness comes from what is left uncoloured |
| 2026-08-17 | Page ground moved to lavender-grey `#F1F3FA` with white cards | A white page with white cards must draw every boundary with a line; a tinted ground lets a card sit on the page without one |
| 2026-08-17 | Text steps re-derived against the **page** rather than white; guardrail thresholds moved with them (migration `0094`) | A link derived to clear 4.5:1 on white lands at 4.15:1 on the page — the easier test passing while the real one fails. Caught by the audit, not by review |
| 2026-08-17 | Added the derived **`mark`** step and the tint/fill/text triple for all six hues | Flat brand hues do not clear 3:1 on their own chips — amber measures 1.80:1, an invisible status dot |
| 2026-08-17 | Tints desaturated as they lighten | Full saturation at 93% lightness reads as sherbet; damping saturation gives the chalky tint the aesthetic wants |
| 2026-08-17 | Dark mode retuned — charcoal `#14181F` ground, `#1A1F2A` cards one step lighter, accents desaturated ~18% | Halation on pure black; shadows are invisible on dark so lightness is the only depth cue; saturated hues on charcoal vibrate rather than glow |
| 2026-08-17 | Dark/light CSS blocks made element-scoped rather than `:root`-scoped | Lets a dark panel sit inside a light page — the only way to review both modes at once — and matches Tailwind's `dark:` variant, which was already element-scoped |
