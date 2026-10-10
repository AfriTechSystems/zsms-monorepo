/**
 * A stable colour per subject, for the phone.
 *
 * The web has the same idea in `components/ui/subject-colour.ts`. The two cannot share
 * a module — one emits Tailwind class names, the other React Native style values — but
 * they share the HASH, so Mathematics is the same hue on a laptop and on a phone. A
 * parent comparing the two should not see different colours for the same lesson.
 *
 * ## Derived, not stored
 *
 * A colour column on `school_subjects` would be one more thing to set when a school
 * adds a subject, and a school that skipped it would get a grey timetable. Hashing the
 * name gives every school a full palette immediately.
 *
 * ## Hash, not index
 *
 * Index-into-palette recolours everything when a subject is inserted alphabetically
 * before another. A hash is stable: adding Art never recolours Biology.
 */

import { LIGHT, type Palette } from '../theme'

export interface SubjectTone {
  background: string
  text: string
  badge: string
}

/*
  Five hues, matching the web palette and the agreed design: blue, amber, green,
  orange, violet.

  Light and dark are chosen per theme rather than by applying opacity to one value —
  a tint that reads on white goes muddy on near-black, which `/design`'s contrast
  audit would fail.
*/
const ON_LIGHT: SubjectTone[] = [
  { background: '#dbeafe', text: '#1e3a8a', badge: '#bfdbfe' },
  { background: '#fef3c7', text: '#78350f', badge: '#fde68a' },
  { background: '#d1fae5', text: '#064e3b', badge: '#a7f3d0' },
  { background: '#ffedd5', text: '#7c2d12', badge: '#fed7aa' },
  { background: '#ede9fe', text: '#4c1d95', badge: '#ddd6fe' },
]

const ON_DARK: SubjectTone[] = [
  { background: '#1e3a5f', text: '#dbeafe', badge: '#1e40af' },
  { background: '#4a3410', text: '#fef3c7', badge: '#78350f' },
  { background: '#0f3d2e', text: '#d1fae5', badge: '#065f46' },
  { background: '#4a2410', text: '#ffedd5', badge: '#7c2d12' },
  { background: '#2e2152', text: '#ede9fe', badge: '#4c1d95' },
]

/**
 * A subject's tone, or a flat one for break, lunch and assembly.
 *
 * Passing `null` is how a caller says "this is not a lesson" — those are deliberately
 * colourless so the lessons stand out, which is what the design does with Lunch Break.
 */
export function subjectTone(name: string | null | undefined, palette: Palette): SubjectTone {
  if (!name) {
    return {
      background: palette.surfaceSunken,
      text: palette.textMuted,
      badge: palette.border,
    }
  }

  // The same hash the web uses, so the hue matches across devices.
  let hash = 0
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0
  }

  /*
    Which theme is in force, without threading a flag through every caller.

    Compared against the LIGHT palette's own background rather than a hardcoded hex:
    the token comes from `@zsms/design-tokens` and a literal here would silently stop
    matching the first time the design system adjusted its surface colour.
  */
  const dark = palette.background !== LIGHT.background
  const set = dark ? ON_DARK : ON_LIGHT
  return set[Math.abs(hash) % set.length] ?? set[0]!
}
