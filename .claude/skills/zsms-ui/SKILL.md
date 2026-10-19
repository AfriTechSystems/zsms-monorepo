---
name: zsms-ui
description: Redesign or build a ZSMS screen so it matches the agreed visual direction and stays consistent with every other portal. Use when changing any web or mobile screen's layout, adding a dashboard, list, record detail, settings page or data-entry grid, or when reaching for a chart, stat tile, table or empty state. Carries the archetypes, the component rules, and the business behaviour a visual change must not break.
---

# Redesigning a ZSMS screen

The agreed direction is **clean and professional, modern and colourful**: structured layouts,
tasteful pastel accents, restrained colour, clear hierarchy, and room to breathe. The twelve
reference images live in `Official Documentation/19 Design System/`, and the brief that governs
them is `ZSMS_UI_REDESIGN_MASTER_PROMPT.md` in the same folder.

**The images are suggestion, not specification.** Where one conflicts with real functionality,
a permission, an accessibility rule or a business rule, the existing behaviour wins and the
design adapts around it.

---

## 1. The rule that outranks every visual decision

**This is a visual redesign. It changes how things look, never what they do.**

Before touching a screen, read what it currently does. Never remove, weaken or bypass
behaviour to make a screen resemble a reference image. If a visual change genuinely requires a
functional change, stop and say so rather than making it quietly.

These seven are the ones most likely to be broken by a careless redesign. Each is real, each
was found the hard way:

| Rule | What breaks it |
|---|---|
| **An empty marks box is not a zero** | A placeholder `0`, or a styled input that looks filled when it is empty. A zero is a pupil who sat the paper and scored nothing; an empty box is a pupil who was not examined |
| **Grades are shown, never typed** | Adding a grade input. The only exception is the deliberate override, which carries an asterisk and a required reason |
| **Publishing is one-way** | A "unpublish" affordance. A published result is corrected through the granular per-pupil unlock, never withdrawn |
| **A parent's "pay" records a CLAIM** | Changing the confirmation wording. The button may say pay; the confirmation must say it is a claim the school will verify |
| **Offline must not imply saved** | A success tick on a failed save. The mobile register says "nothing was saved, your marks are still here" |
| **`can()` returns false for an UNKNOWN key** | Renaming a permission key, or inventing one. A typo silently hides the row for everybody, with no error |
| **School colour is an accent, never the chrome** | Theming a sidebar or page background with `primary_color`. It is for buttons, links and active states only |

---

## 2. Use the tokens. There is no second palette.

`packages/design-tokens` is the only source. A repository-wide search for hardcoded hex in
`apps/web/app` and `apps/web/components` should return **13 occurrences and no more** — a
global error boundary that renders outside the app's CSS, two `themeColor` metas, and one
input placeholder. If your change adds a fourteenth, it is wrong.

Brand: navy `#1E2A3F` · blue `#3A8DDE` · green `#4A9B4F` · amber `#F5A623` · coral `#E15A44`
· teal `#1BA0B0`. Neutrals are a 13-step blue-tinted ramp, deliberately not grey.

Use the Tailwind token classes, never a raw value: `bg-surface`, `bg-surface-sunken`,
`text-muted-foreground`, `border-border`, `p-card`, `gap-stack`, `gap-cards`, `min-h-tap`.
Numeric figures get `data-numeric` so columns align.

**Per-school theming is validated in the database**, not in CSS: `anchor_color` must clear
4.5:1 and `primary_color` 3:1 against the page `#F1F3FA`, as a `CHECK` that refuses rather
than warns. Never work around it.

---

## 3. Reach for the existing primitive first

42 modules in `apps/web/components/ui/` — 40 components, plus `auth-appearance.ts` (the
Clerk appearance object) and `subject-colour.ts` (`subjectColour()`, `NON_TEACHING`), which
are not components. This line said 28 until 2026-10-18; **count it before quoting it.**

Six of the 40 are feature components that happen to live in `ui/` rather than primitives —
`activity-feed`, `settings-history`, `staff-record-sync` (returns `null`, side-effect only),
`custom-field-input`, `draft-notice`, and `school-logo` (which duplicates
`brand/school-logo.tsx`). Do not treat everything in this folder as a primitive.

### Mobile: the shared chrome lives in `components/shell` (added 2026-10-18)

Built against the four reference mockups in `Official Documentation/19 Design System/`.
`ui.tsx` holds what a screen is *made of*; `shell.tsx` holds what every screen
*repeats*. Reach for these before drawing one:

- **`IconTile`** — the rounded tinted square that fronts almost every row and grid
  cell. Six screens had each hand-rolled it at a different size and radius (38, 40,
  42, 44), which is how an app comes to look assembled rather than designed and is
  invisible in review because each copy looks right on its own. A grep for the
  hand-rolled pattern should return only `stats.tsx` and `wordmark.tsx`.
- **`AppHeader`** — mark, school name, bell with a count, avatar. Pinned outside the
  ScrollView: a notification count that scrolls away is one nobody sees. Both portals
  put it in the same corner, because a parent who is also a teacher switches between
  them.
- **`Greeting`**, **`SectionHeader`** (with the mockups' "View All"), **`ListRow`**,
  **`RowDivider`**, **`Segmented`**.
- **`TodaySchedule`** (`components/today-schedule`) — the home timeline with the NOW
  badge, computed from the device clock against the wall-clock times the API returns.
  Those carry no timezone, which is correct for a school day and the reason they must
  never be compared against a UTC instant.
- **`NoticeList`** (`components/notice-list`) — both portals' notices. The endpoint is
  a prop; everything else is shared.
- **`Donut`** (`components/stats`) — the mobile counterpart of the web's `DonutChart`.

**Tones are `primary | success | warning | danger | accent | neutral` and nothing
else.** `accent` and `anchor` were added to the mobile palette on 2026-10-18; they had
existed in the token package since the foundation and mobile exposed neither, so the
action grid drew all twelve tiles in one blue. **Do not add a seventh hue to match a
mockup pixel-for-pixel** — a colour outside the token package is one no school can
theme and no contrast check has measured.

Assign a tone by what a thing IS, never by where it sits: colour follows the entity,
not its rank, so gating or re-ordering a list never repaints what remains.

**`todayIso()` is in `apps/mobile/lib/dates`**, and the UTC form is a real bug here
too — the register computed `toISOString().slice(0, 10)` and so opened *yesterday's*
sheet before 02:00, seeding yesterday's marks into one a teacher was about to correct.

**The mockups are suggestion, not specification**, and two departures are recorded in
code: the notices filter is All/Unread/Important rather than All/Notices/**Messages**
(no message category exists in the data — that tab would always be empty or imply a
channel somebody waits on), and a child's result never gets a traffic light, because
red-amber-green on a mark is ZSMS passing a judgement the school has not.

### Added 2026-10-18 — reach for these before writing the behaviour again

- **Dates: `DateField` / `DateRangeField`** (`components/ui/date-field`), never a raw
  `<input type="date">`. There were eighteen of those across twelve files.
  `DateRangeField` links the two bounds — the `from` input's `max` is whatever `to`
  holds and vice versa — so an inverted range cannot be entered. Five existing
  from/to pairs had no such check and returned an empty result that read as "no
  data". Use `notFuture` where a future value is always a typo (a date of birth, a
  join date, an audit window, a register) and leave it off where the future is
  legitimate (an enrolment next term, a fee due date).
- **`todayIso()` lives in `lib/dates`**, and it is the only correct one. **Never
  `new Date().toISOString().slice(0, 10)`** — that is UTC, and Zambia is UTC+2, so
  for the first two hours of every local day it returns *yesterday*. As a default it
  opens the wrong day; as a `max` it refuses the date a teacher is sitting in.
- **Menus and dropdowns: `usePopover()`** (`lib/use-popover`). Handles Escape,
  outside click, Tab-out, `aria-expanded`/`aria-haspopup`/`aria-controls`, and
  **returns focus to the trigger on close**. Three components had hand-rolled copies
  that drifted. A menu must **not** trap focus — that is a modal's job and
  `ui/dialog` already does it natively; see the file for why.
- **Stacking: `z-raised` / `z-sticky` / `z-chrome` / `z-overlay` / `z-popover` /
  `z-top`**, not `z-10`…`z-50`. If you are reaching for `z-[60]`, the layer you want
  is `z-top`.
- **Motion: `duration-fast|base|slow` and `ease-standard|gentle|emphasised`.** The
  ambient loop timings in `globals.css` are deliberately not tokens — they are scene
  timings, not a scale.
- **One breakpoint.** `BREAKPOINT_SM` (640) is the only one; Tailwind's `sm` is
  imported from it and `lib/breakpoints.test.ts` fails the build if they diverge. The
  token layer swaps type and spacing below it, which is why `p-card` and `text-3xl`
  need no responsive modifier.

The ones people get wrong:

- **`EmptyState` is in its own module** (`components/ui/empty-state`), not in `data-states`
  with `ErrorState`, `TableSkeleton`, `StatSkeleton` and `PageHeader`. This has caused build
  errors more than once.
- **`Button` has no `danger`.** It is `destructive`. Variants: `default destructive outline
  secondary ghost link`.
- **`Badge` has no `secondary`.** It is `neutral`. Variants: `neutral success warning danger
  info primary`.
- **`Field` takes a render prop**, not a child element: `<Field id label>{(props) => <Input
  {...props} />}</Field>`.
- **`toast(message, tone)`** takes two positional arguments and the tone is `'success' |
  'danger'` only — there is no object form and no `neutral`.
- **`formatKwacha`** lives in `app/admin/health-shared`, and local `kwacha` helpers differ per
  file in whether they take a string or a number. Check before calling.

Before writing a component, check whether one exists:

```bash
ls apps/web/components/ui/
grep -rn "ComponentName" apps/web/components --include=*.tsx | head
```

---

## 4. The archetypes

Seven web shapes cover almost every screen. Pick one deliberately; do not invent an eighth
because a page feels special.

| Archetype | Shape | Reference screen |
|---|---|---|
| **Dashboard** | Stat row → charts → two columns of lists | `/admin`, `/school/[code]` |
| **List** | Stat row → tabs → filter bar → table → pagination, with an optional right rail | `/school/[code]/students` |
| **Record detail** | Identity header → key-metric row → tabs → panels, with a right rail of related info | `/school/[code]/students/[id]` |
| **Settings** | Section tabs → one section at a time → explicit save, with a right rail of read-only context | `/school/[code]/settings` |
| **Dense entry** | Context row → toolbar → the grid → a summary rail | `/school/[code]/results`, `/attendance` |
| **Auth** | Centred card on the branded `auth-shell` | `/sign-in` |
| **States** | Every interface state, rendered against the live tokens | `/design` |

`/design` has eleven sections, each with an `id` — `#palette`, `#contrast`, `#typography`,
`#buttons`, `#forms`, `#loading`, `#responsive`, `#dashboard`, `#tints`, `#semantic`,
`#theming`. There is **no `#states` section**: the state examples live inside `#forms`
(error, loading, empty, and the three `Alert` variants) and `#loading` (`BrandSplash`
against skeletons). This row claimed "the eight states side by side" until 2026-10-18 and
nothing on the page ever matched it.

**Tabs must switch the view, not scroll to a section.** Use `SectionTabs` with its URL state so
the browser back button works and a link can address a tab.

---

## 5. Layout rules that keep it from feeling cluttered

- **One stat row, maximum five cards.** More than five and none of them is read.
- **A chart earns its place or it goes.** A donut for three or fewer categories is decoration.
- **Right rail is for context, never for primary actions.** The main column must stand alone.
- **Group by the user's job, not the data type.** "Money" beats "Tables involving amounts".
- **A group whose items are all permission-filtered renders nothing** — heading included.
- **Never show an actionable control the user cannot use.** Explain the gate instead: "Layout
  variants are included from the Growth tier" beats a disabled select with no reason.
- **Unavailable is not zero.** An em dash plus a sentence saying why. A `0%` conversion rate
  when no trial has finished is a lie the dashboard tells confidently.

---

## 6. Charts

**Load the `dataviz` skill before writing any chart code.** It is not optional here.

Build charts as **inline SVG against the tokens**. Do not add a charting dependency: the master
prompt says avoid unnecessary dependencies, the palette has to come from
`packages/design-tokens`, and every chart in the references is simple enough that a library
would cost more than it saves.

Three shapes cover the references: a line/area trend, a donut with a legend carrying value and
percentage, and a horizontal or vertical bar. Each needs a real empty state — a chart with no
data must say so, not render an empty axis.

---

## 7. Mobile is a separate implementation

React Native has no CSS, no Tailwind and no `:focus-visible`. **Nothing in
`apps/web/components/ui` can be reused.** Only the token *values* cross, through
`apps/mobile/theme/index.ts`, which calls `resolveTheme()` from the token package.

Mobile has its own 12 primitives in `apps/mobile/components/ui.tsx`: `Screen Card Title Body
Caption Button Badge Empty ErrorNote Loading Row usePalette`.

Rules that are mobile-specific:

- Bottom tabs, not a sidebar. The parent portal uses them on web too, being phone-first.
- 44px minimum touch target, always.
- Bottom sheets for short flows; a full screen for anything long.
- No hover states — every affordance must survive without one.
- `lib/features.ts` distinguishes **"coming soon"** from **"needs your school"**. Keep them
  visually different: a teacher can act on the second.

---

## 8. Before claiming a screen is done

```bash
npm run ci:checks     # type-check, lint, build, gaps, unit tests
```

Then **walk the path**. The two worst defects found in this repository were invisible to every
automated check: a mark input that stayed `disabled` after a correction was unlocked, and a
Save button hidden whenever any row was published — so the only control that could save a
correction vanished exactly when one became possible.

Ask: can a real person with the right role actually finish this, start to end?

**Do not report a screen as verified unless you have actually looked at it.** The dev server's
first load is slow — 50.9s for the homepage under webpack, about half that with
`npm run dev:fast` — and a screen that has not finished compiling is not a screen you have
seen.

---

## Links: button or text?

Settled 2026-10-12 after a sweep of every underlined link in the application.

| Shape | Treatment | Why |
|---|---|---|
| **Standalone navigation** — "View all", "Pricing", "See the roll" after an import | `SectionLink` (a `Button` with a trailing arrow) | It is an affordance, not prose. It should look pressable. |
| **Inside a sentence** — "recorded in the audit trail", "your logo is set on the school profile" | Underlined link, unchanged | Turning a phrase into a button breaks the sentence it belongs to. |
| **A row's identity** — a school name in a table cell | Underlined link | It names the row; it is not a call to action. |

Three of the four candidates found by the sweep were the second kind, so the rule
is **not** "no underlined links anywhere".

---

## Printing

Global rules live in `app/globals.css` under "Printing", and they are global on
purpose: `DataTable` renders a real table from `sm` up and one card per row below,
and **print media does not match `sm`** — so without a global rule every printed
list is one card per pupil. Opt-in per screen would mean the next list prints wrongly
and nobody finds out until a school has wasted the paper.

A screen adds two things: `PrintButton` and `PrintHeading`. The heading is invisible
on screen and carries the class, the date covered, and the date printed — the last two
are different facts, and a register with neither is not a record of anything.

---

## The aura

`AiAura` is three CSS gradients on their own layer behind a scrim, not a canvas. The
scrim is what guarantees readability: contrast is one fixed decision rather than a
function of where a blob has drifted to. Anything placed inside the assistant panel
must be `relative`, or it paints *under* the aura.
