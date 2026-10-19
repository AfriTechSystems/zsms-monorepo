/**
 * Date helpers for form controls.
 *
 * Spec: `.claude/skills/zsms-ui/SKILL.md`
 *
 * One function so far, and it is here rather than beside `DateField` because it is
 * pure — `npm run test:unit` globs `apps/web/lib/**` and a component module is not
 * somewhere a Node test can reach.
 */

/**
 * Today as `YYYY-MM-DD`, in the **browser's local timezone**.
 *
 * ## Why not `toISOString().slice(0, 10)`
 *
 * Because that is UTC. Zambia is UTC+2, so for the first two hours of every local
 * day `toISOString()` still reports **yesterday**. The consequences are not
 * cosmetic:
 *
 *  - As a **default**, a register or an export window opens on the wrong day.
 *  - As a **`max`**, it refuses today — a teacher marking an early register is told
 *    the date is out of range, with nothing on screen explaining why.
 *
 * Two correct copies of this function already existed, in `attendance/page.tsx` and
 * `students/new/page.tsx`, byte for byte identical. Around eight other sites wrote
 * the UTC form inline, including the Sage 50 export window. This is the one
 * definition; `date-field.tsx` and every screen take it from here.
 *
 * `getFullYear`/`getMonth`/`getDate` are the local-time accessors, which is the
 * whole point — `getUTCFullYear` and friends would reintroduce the bug.
 */
export function todayIso(): string {
  const d = new Date()
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}
