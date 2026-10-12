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

28 modules in `apps/web/components/ui/`. The ones people get wrong:

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
| **States** | The eight states side by side | `/design` |

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
