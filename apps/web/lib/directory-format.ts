/**
 * How the directory's verified numbers are written.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/PUBLIC_DIRECTORY.md`
 *
 * ## Why the ratio stopped being a decimal
 *
 * `school_verified_metrics()` returns it to one decimal place, so the directory showed **10.1**. A
 * parent reading that has to work out what it is a ratio *of*, and then what the tenth of a teacher
 * means. Reported as confusing from the running product, which is the only place that could have
 * shown it.
 *
 * Written as **1 : 10** instead — one teacher to ten pupils, in the form a school prospectus already
 * uses. The decimal goes because it is spurious: the number moves the moment a pupil enrols, and
 * nobody chooses a school on a tenth of a teacher.
 *
 * ## Rounded here rather than in SQL
 *
 * The function keeps its precision. Rounding in the database would settle the question for every
 * caller and take the school's own settings screen with it — and that screen is the one place a head
 * teacher checks the figure against their own records, where 22.4 versus 22 is a real difference when
 * they are trying to work out whether we counted their part-time teacher.
 *
 * So the database stays exact and the display rounds, which is the usual way round.
 */

/**
 * `1 : 22`, or null when the figure is unknowable.
 *
 * Null means the school has no teaching assignments recorded, not that the answer is zero — and the
 * callers render it as an absent line rather than a dash, because a dash reads as an answer.
 */
export function formatPupilTeacherRatio(pupilsPerTeacher: number | null): string | null {
  if (pupilsPerTeacher === null || !Number.isFinite(pupilsPerTeacher)) return null

  const perTeacher = Math.round(pupilsPerTeacher)

  /**
   * Below one pupil per teacher, `1 : 0` would be nonsense — and a school with more teachers than
   * pupils is a real early state, not a data error: a new school configuring its staff before its
   * first intake sits there for weeks.
   */
  if (perTeacher < 1) return 'Fewer than 1 pupil per teacher'

  return `1 : ${perTeacher}`
}

/** `28 pupils`, rounded for the same reason. Null when there is nothing to average over. */
export function formatClassSize(avgClassSize: number | null): string | null {
  if (avgClassSize === null || !Number.isFinite(avgClassSize)) return null
  const size = Math.round(avgClassSize)
  return `${size} pupil${size === 1 ? '' : 's'}`
}

/**
 * `K1,200 – 2,800`.
 *
 * The currency symbol appears once. Repeating it on both ends reads as two separate prices rather
 * than a range, which is the thing a parent is scanning for.
 */
export function formatFeeBand(min: number | null, max: number | null): string | null {
  if (min === null || max === null) return null
  if (min === max) return `K${min.toLocaleString()}`
  return `K${min.toLocaleString()} – ${max.toLocaleString()}`
}
