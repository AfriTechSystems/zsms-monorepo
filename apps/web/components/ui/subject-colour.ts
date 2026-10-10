/**
 * A stable colour per subject.
 *
 * Spec: the agreed timetable design — each subject carries its own colour across the
 * whole grid, so a reader finds "all the Mathematics" by colour before reading a word.
 *
 * ## Why derived rather than stored
 *
 * A colour column on `school_subjects` would be one more thing to set when a school
 * adds a subject, and a school that skipped it would get a grey grid. Deriving from
 * the subject's own name means every school gets a full palette immediately, and the
 * same subject is the same colour on every screen and every device.
 *
 * ## Why a hash and not an index
 *
 * Index-into-palette changes every colour when a subject is inserted alphabetically
 * before another. A hash of the name is stable: adding Art never recolours Biology.
 *
 * The palette is the design's, and every pairing is a dark-on-light tint that holds up
 * in both themes — the text token is fixed per entry rather than left to inherit,
 * because a tint that works on white does not work on near-black.
 */

export interface SubjectColour {
  /** Tailwind classes for the cell background and border. */
  cell: string
  /** The subject name's colour. */
  title: string
  /** The room badge. */
  badge: string
  /** A single hex for places that cannot take a class, such as a legend dot. */
  dot: string
}

/*
  Five pairs, taken from the agreed design: blue, amber, green, orange, violet.

  Each carries an explicit dark-mode variant. Relying on opacity alone produced tints
  that were legible on white and muddy on near-black, which `/design`'s contrast audit
  would fail.
*/
const PALETTE: SubjectColour[] = [
  {
    cell: 'bg-blue-100 border-blue-200 dark:bg-blue-950 dark:border-blue-900',
    title: 'text-blue-900 dark:text-blue-100',
    badge: 'bg-blue-200 text-blue-900 dark:bg-blue-900 dark:text-blue-100',
    dot: '#3b82f6',
  },
  {
    cell: 'bg-amber-100 border-amber-200 dark:bg-amber-950 dark:border-amber-900',
    title: 'text-amber-900 dark:text-amber-100',
    badge: 'bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-100',
    dot: '#f59e0b',
  },
  {
    cell: 'bg-emerald-100 border-emerald-200 dark:bg-emerald-950 dark:border-emerald-900',
    title: 'text-emerald-900 dark:text-emerald-100',
    badge: 'bg-emerald-200 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100',
    dot: '#10b981',
  },
  {
    cell: 'bg-orange-100 border-orange-200 dark:bg-orange-950 dark:border-orange-900',
    title: 'text-orange-900 dark:text-orange-100',
    badge: 'bg-orange-200 text-orange-900 dark:bg-orange-900 dark:text-orange-100',
    dot: '#f97316',
  },
  {
    cell: 'bg-violet-100 border-violet-200 dark:bg-violet-950 dark:border-violet-900',
    title: 'text-violet-900 dark:text-violet-100',
    badge: 'bg-violet-200 text-violet-900 dark:bg-violet-900 dark:text-violet-100',
    dot: '#8b5cf6',
  },
]

/** Break, lunch and assembly: deliberately colourless, so lessons stand out. */
export const NON_TEACHING: SubjectColour = {
  cell: 'bg-sunken border-border',
  title: 'text-muted-foreground',
  badge: 'bg-muted text-muted-foreground',
  dot: '#94a3b8',
}

export function subjectColour(name: string | null | undefined): SubjectColour {
  if (!name) return NON_TEACHING

  // A small deterministic hash. Stable across sessions, schools and devices, and
  // unaffected by a subject being added alphabetically before another.
  let hash = 0
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0
  }

  return PALETTE[Math.abs(hash) % PALETTE.length] ?? NON_TEACHING
}
